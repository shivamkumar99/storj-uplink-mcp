import type { z, ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ListToolsResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { auditLog } from './audit.js';
import { guard } from './guard.js';
import { runWithRequestContext } from './context.js';
import type { McpTextResponse } from '../lib/response.js';

// ---------------------------------------------------------------------------
// Tool registry — Registry + Decorator.
//
// A tool describes itself (name, description, annotations, input schema,
// handler) next to its implementation via defineTool().  Each tool module
// exports a `tools` array; server.ts concatenates those and hands them to
// registerTools(), which applies everything every tool needs in one place:
// the per-request context (cancellation, progress token, request id), the
// concurrency guard, and audit logging.
// ---------------------------------------------------------------------------

/**
 * Behaviour hints clients use to decide how to present a tool — e.g. asking
 * the user to confirm a destructive call.  Note the MCP defaults are the
 * pessimistic ones (destructive, not idempotent, open world), so every tool
 * states its hints explicitly.
 */
export const annotations = {
  /** Reads Storj state only; never changes anything. */
  readOnly:   { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
  /** Creates something new (a bucket, a share, credentials) without touching existing data. */
  creates:    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  /** Writes that can overwrite existing data (uploads, copies, metadata, local downloads). */
  overwrites: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true,  openWorldHint: false },
  /** Removes data — clients should confirm with the user. */
  deletes:    { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: false },
} as const satisfies Record<string, ToolAnnotations>;

/** A fully-typed tool definition; the handler's `args` is inferred from `schema`. */
export interface ToolDefinition<S extends ZodRawShape> {
  /** Unique name exposed to MCP clients, e.g. "upload_file". */
  name: string;
  /** What the tool does — shown to the LLM so it can decide when to call it. */
  description: string;
  annotations: ToolAnnotations;
  /** Zod object schema describing the tool's input. */
  schema: z.ZodObject<S>;
  /**
   * Optional schema for `structuredContent`.  When set, every successful result
   * MUST include conforming structuredContent (the SDK validates it).
   */
  outputSchema?: ZodRawShape;
  /** Optional MCP Apps view (`ui://` resource) hosts may render for this tool's results. */
  ui?: { resourceUri: string };
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<McpTextResponse>;
}

/**
 * Registry element.  The schema shape is erased so tools with different input
 * types can share one list.  The handler's argument type was already checked
 * against its schema in defineTool(), which is why `any` is acceptable here.
 */
export interface Tool {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  schema: z.ZodObject<ZodRawShape>;
  outputSchema?: ZodRawShape;
  ui?: { resourceUri: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<McpTextResponse>;
}

/** Define a tool with full type inference from its schema. */
export function defineTool<S extends ZodRawShape>(def: ToolDefinition<S>): Tool {
  return def;
}

// ---------------------------------------------------------------------------
// JSON Schema dialect.
//
// MCP specifies JSON Schema 2020-12 for tool schemas, and current hosts
// validate a tool's outputSchema with a 2020-12-only validator before the
// call is even made.  The SDK (1.30) converts Zod schemas at tools/list time
// and stamps them "draft-07", which such hosts reject with
// "unsupported dialect" — the tool then never runs.  The generated schemas
// use only keywords that mean the same in both dialects, so relabelling the
// listing is a faithful fix.  (`definitions`/`#/definitions/` are mapped to
// their 2020-12 spellings for completeness; the SDK emits them only when a
// Zod schema object is reused inside one tool schema.)
// ---------------------------------------------------------------------------

export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Return a copy of a JSON Schema relabelled as 2020-12. */
export function toJsonSchema2020(schema: Record<string, unknown>): Record<string, unknown> {
  return { $schema: JSON_SCHEMA_2020_12, ...(walk(schema as JsonValue, '') as { [key: string]: JsonValue }) };
}

/** A `$ref` string gets the 2020-12 definitions container name; everything else passes through. */
function rewriteLeaf(node: JsonValue, path: string): JsonValue {
  return typeof node === 'string' && path.endsWith('.$ref') ? node.replace('#/definitions/', '#/$defs/') : node;
}

/** Top level only: drop the old `$schema`, rename `definitions`. */
function rewriteTopLevelKey(key: string): string | undefined {
  if (key === '$schema') return undefined;
  return key === 'definitions' ? '$defs' : key;
}

function walk(node: JsonValue, path: string): JsonValue {
  if (Array.isArray(node)) return node.map((n, i) => walk(n, `${path}[${i}]`));
  if (node === null || typeof node !== 'object') return rewriteLeaf(node, path);
  return walkObject(node, path);
}

function walkObject(node: { [key: string]: JsonValue }, path: string): JsonValue {
  const out: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(node)) {
    const outKey = path === '' ? rewriteTopLevelKey(key) : key;
    if (outKey !== undefined) out[outKey] = walk(value, `${path}.${key}`);
  }
  return out;
}

/**
 * Wrap the SDK's tools/list handler so every emitted inputSchema/outputSchema
 * is labelled 2020-12.  The SDK keeps handlers in a private map; if that ever
 * changes we fail loudly at startup rather than ship draft-07 again.
 */
function useJsonSchema2020(server: McpServer): void {
  type Handler = (request: unknown, extra: unknown) => Promise<ListToolsResult>;
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })._requestHandlers;
  const original = handlers?.get('tools/list');
  if (!handlers || !original) throw new Error('MCP SDK layout changed: cannot find the tools/list handler to relabel schemas');
  handlers.set('tools/list', async (request, extra) => {
    const result = await original(request, extra);
    return {
      ...result,
      tools: result.tools.map((tool) => ({
        ...tool,
        inputSchema: toJsonSchema2020(tool.inputSchema) as typeof tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: toJsonSchema2020(tool.outputSchema) as typeof tool.outputSchema } : {}),
      })),
    };
  });
}

/**
 * Register every tool on the server.  Each call runs inside its request
 * context, under the concurrency guard, and is audit-logged.  Registration
 * order is the order clients list the tools in.  Throws on a duplicate name.
 */
export function registerTools(server: McpServer, tools: readonly Tool[]): void {
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name: "${tool.name}"`);
    }
    seen.add(tool.name);

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: tool.schema.shape,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(tool.ui ? { _meta: { ui: { resourceUri: tool.ui.resourceUri } } } : {}),
      },
      (args, extra) =>
        runWithRequestContext(
          {
            requestId: extra.requestId,
            signal: extra.signal,
            progressToken: extra._meta?.progressToken,
            sendNotification: extra.sendNotification,
          },
          () =>
            guard(() => {
              auditLog(tool.name, args);
              return tool.handler(args);
            }),
        ),
    );
  }

  // The SDK installs its tools/list handler on the first registerTool call.
  if (tools.length > 0) useJsonSchema2020(server);
}
