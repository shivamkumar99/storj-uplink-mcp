import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, registerTools } from '../src/registry.js';
import { ok } from '../src/utils.js';

afterEach(() => vi.restoreAllMocks());

describe('defineTool / registerTools', () => {
  const schema = z.object({ bucket: z.string() });
  const handler = vi.fn(async (args: { bucket: string }) => ok(`got ${args.bucket}`));
  const tool = defineTool({ name: 'echo_bucket', description: 'Echo', schema, handler });

  it('defineTool returns the definition unchanged', () => {
    expect(tool).toMatchObject({ name: 'echo_bucket', description: 'Echo', schema });
  });

  it('registers via registerTool with description + input schema, wrapping the handler in guard + audit', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    const spy = vi.spyOn(server, 'registerTool');
    registerTools(server, [tool]);

    expect(spy).toHaveBeenCalledTimes(1);
    const [name, config, cb] = spy.mock.calls[0] as unknown as [string, { description: string; inputSchema: unknown }, (a: unknown, e: unknown) => Promise<unknown>];
    expect(name).toBe('echo_bucket');
    expect(config).toEqual({ description: 'Echo', inputSchema: schema.shape });
    expect(Object.keys((server as unknown as { _registeredTools: object })._registeredTools)).toEqual(['echo_bucket']);

    const audit = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await cb({ bucket: 'b1' }, {})).toEqual(ok('got b1'));
    expect(handler).toHaveBeenCalledWith({ bucket: 'b1' });
    expect(audit).toHaveBeenCalledWith('[storj-mcp] AUDIT: echo_bucket bucket="b1"');
  });

  it('rejects duplicate tool names at startup', () => {
    const server = new McpServer({ name: 't', version: '0' });
    expect(() => registerTools(server, [tool, tool])).toThrow('Duplicate tool name: "echo_bucket"');
  });
});
