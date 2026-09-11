import type { z, ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { auditLog } from './audit.js';
import { guard } from './guard.js';
import { runWithRequestContext } from './context.js';
import type { McpTextResponse } from './utils.js';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<McpTextResponse>;
}

/** Define a tool with full type inference from its schema. */
export function defineTool<S extends ZodRawShape>(def: ToolDefinition<S>): Tool {
  return def;
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
      { description: tool.description, annotations: tool.annotations, inputSchema: tool.schema.shape },
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
}
