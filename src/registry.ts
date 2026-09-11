import type { z, ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { auditLog } from './audit.js';
import { guard } from './guard.js';
import type { McpTextResponse } from './utils.js';

// ---------------------------------------------------------------------------
// Tool registry — Registry + Decorator.
//
// A tool describes itself (name, description, input schema, handler) right
// next to its implementation via defineTool().  Each tool module exports a
// `tools` array; server.ts only concatenates those arrays and hands them to
// registerTools(), which applies the behaviour every tool needs — the
// concurrency guard and audit logging — in exactly one place.
//
// Consequences:
//   • Adding a tool to an existing module touches only that module.
//   • The tool name is a single source of truth: the same string is used for
//     registration and for the audit log, so the two can never drift apart.
//   • A new cross-cutting concern (timing, per-tool rate limits, …) is one
//     edit in registerTools(), not one per tool.
// ---------------------------------------------------------------------------

/** A fully-typed tool definition; the handler's `args` is inferred from `schema`. */
export interface ToolDefinition<S extends ZodRawShape> {
  /** Unique name exposed to MCP clients, e.g. "upload_file". */
  name: string;
  /** What the tool does — shown to the LLM so it can decide when to call it. */
  description: string;
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
  schema: z.ZodObject<ZodRawShape>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<McpTextResponse>;
}

/** Define a tool with full type inference from its schema. */
export function defineTool<S extends ZodRawShape>(def: ToolDefinition<S>): Tool {
  return def;
}

/**
 * Register every tool on the server, wrapping each handler with the
 * concurrency guard and audit logging.  Registration order is the order
 * clients list the tools in.  Throws on a duplicate name.
 */
export function registerTools(server: McpServer, tools: readonly Tool[]): void {
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name: "${tool.name}"`);
    }
    seen.add(tool.name);

    server.tool(tool.name, tool.description, tool.schema.shape, (args) =>
      guard(() => {
        auditLog(tool.name, args);
        return tool.handler(args);
      }),
    );
  }
}
