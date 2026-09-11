import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, registerTools, annotations } from '../src/registry.js';
import { currentRequest } from '../src/context.js';
import { ok } from '../src/utils.js';

afterEach(() => vi.restoreAllMocks());

describe('defineTool / registerTools', () => {
  const schema = z.object({ bucket: z.string() });
  let seenRequestId: unknown;
  const handler = vi.fn(async (args: { bucket: string }) => { seenRequestId = currentRequest()?.requestId; return ok(`got ${args.bucket}`); });
  const tool = defineTool({ name: 'echo_bucket', description: 'Echo', annotations: annotations.readOnly, schema, handler });

  it('defineTool returns the definition unchanged', () => {
    expect(tool).toMatchObject({ name: 'echo_bucket', description: 'Echo', schema, annotations: { readOnlyHint: true, destructiveHint: false } });
  });

  it('registers with description, annotations and input schema; runs the handler in its request context under guard + audit', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    const spy = vi.spyOn(server, 'registerTool');
    registerTools(server, [tool]);

    const [name, config, cb] = spy.mock.calls[0] as unknown as [string, object, (a: unknown, e: unknown) => Promise<unknown>];
    expect(name).toBe('echo_bucket');
    expect(config).toEqual({ description: 'Echo', annotations: annotations.readOnly, inputSchema: schema.shape });

    const audit = vi.spyOn(console, 'error').mockImplementation(() => {});
    const extra = { requestId: 7, signal: new AbortController().signal, sendNotification: async () => {}, _meta: { progressToken: 'p1' } };
    expect(await cb({ bucket: 'b1' }, extra)).toEqual(ok('got b1'));
    expect(handler).toHaveBeenCalledWith({ bucket: 'b1' });
    expect(seenRequestId).toBe(7);                                    // context was established for the handler
    expect(audit).toHaveBeenCalledWith(expect.stringMatching(/^\[storj-mcp\] AUDIT \S+ \[req 7\] echo_bucket bucket="b1"$/));
  });

  it('rejects duplicate tool names at startup', () => {
    const server = new McpServer({ name: 't', version: '0' });
    expect(() => registerTools(server, [tool, tool])).toThrow('Duplicate tool name: "echo_bucket"');
  });

  it('annotation presets state every hint explicitly (MCP defaults are the pessimistic ones)', () => {
    for (const a of Object.values(annotations)) {
      expect(Object.keys(a).sort()).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint']);
    }
    expect(annotations.deletes.destructiveHint).toBe(true);
    expect(annotations.readOnly.readOnlyHint).toBe(true);
  });
});
