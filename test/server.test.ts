import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fakeProject } from './helpers/fake-project.js';
import { UI } from '../src/core/ui-resources.js';

// Real server, real protocol, in-memory transport — only the Storj connection is faked.
vi.mock('../src/core/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../src/core/auth.js';
import { createServer } from '../src/server.js';
import { ENV } from '../src/core/env.js';
import { getDisplayTimeZone, setDisplayTimeZone } from '../src/lib/format.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { JSON_SCHEMA_2020_12 } from '../src/core/registry.js';

const server = createServer();
const client = new Client({ name: 'test-client', version: '0' });

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
});
afterAll(async () => { await client.close(); await server.close(); vi.restoreAllMocks(); });

describe('startup display time zone (STORJ_MCP_TIMEZONE)', () => {
  const restore = () => { delete process.env[ENV.TIMEZONE]; setDisplayTimeZone('UTC'); };

  it('applies a valid zone and ignores an unknown one with a stderr warning', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      process.env[ENV.TIMEZONE] = 'Asia/Kolkata';
      await createServer().close();
      expect(getDisplayTimeZone()).toBe('Asia/Kolkata');

      process.env[ENV.TIMEZONE] = 'Mars/Olympus';
      await createServer().close();
      expect(getDisplayTimeZone()).toBe('Asia/Kolkata'); // unchanged
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring STORJ_MCP_TIMEZONE="Mars/Olympus"'));

      restore();
      await createServer().close();
      expect(getDisplayTimeZone()).toBe('UTC');
    } finally {
      restore();
      warn.mockRestore();
    }
  });
});

describe('server over the MCP protocol', () => {
  it('lists all 28 tools, each with explicit annotations, in a deterministic order', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(28);
    expect(new Set(tools.map((t) => t.name)).size).toBe(28);
    for (const t of tools) expect(t.annotations, t.name).toMatchObject({ readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean) });
    expect(tools.find((t) => t.name === 'delete_bucket')?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(tools.find((t) => t.name === 'list_buckets')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools[0].name).toBe('list_buckets');
  });

  it('reports tool execution failures with isError: true', async () => {
    vi.mocked(getProject).mockRejectedValueOnce(new Error('No Storj credentials found.'));
    const res = await client.callTool({ name: 'list_buckets', arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toContain('No Storj credentials found');
  });

  it('delivers notifications/progress to a client that asked for them', async () => {
    const fake = fakeProject({ objects: { 'b/a.txt': { data: Buffer.from('12345') } } });
    vi.mocked(getProject).mockResolvedValue(fake.project);
    const progress: Array<{ progress: number; message?: string }> = [];
    const res = await client.callTool({ name: 'bucket_usage', arguments: { bucket: 'b' } }, undefined, { onprogress: (p) => progress.push(p) });
    expect(res.isError).toBeUndefined();
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[0].message).toBe('⏳ Calculating usage for "b": 0 B so far… — listing objects…');
    expect(progress.at(-1)?.message).toBe('✅ Usage calculated for "b"');
    for (let i = 1; i < progress.length; i++) expect(progress[i].progress).toBeGreaterThan(progress[i - 1].progress);
  });

  it('emits every tool schema in the 2020-12 dialect that hosts validate with', async () => {
    const { tools } = await client.listTools();
    // Same validator configuration hosts use: 2020-12 only, strict keywords.
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    for (const tool of tools) {
      expect(tool.inputSchema.$schema, tool.name).toBe(JSON_SCHEMA_2020_12);
      expect(() => ajv.compile(tool.inputSchema), `${tool.name} inputSchema`).not.toThrow();
      const out = tool.outputSchema;
      if (out) {
        expect(out.$schema, tool.name).toBe(JSON_SCHEMA_2020_12);
        expect(() => ajv.compile(out), `${tool.name} outputSchema`).not.toThrow();
      }
    }
    expect(JSON.stringify(tools)).not.toContain('draft-07');
    // and a real result validates against the emitted outputSchema
    const fake = fakeProject({ objects: { 'b/x.txt': { data: Buffer.from('1') } } });
    vi.mocked(getProject).mockResolvedValue(fake.project);
    const res = await client.callTool({ name: 'list_objects', arguments: { bucket: 'b' } });
    const validate = ajv.compile(tools.find((t) => t.name === 'list_objects')!.outputSchema!);
    expect(validate(res.structuredContent), JSON.stringify(validate.errors)).toBe(true);
  });

  it('advertises the object-browser app on list_objects and serves it as a ui:// resource', async () => {
    const { tools } = await client.listTools();
    const listObjects = tools.find((t) => t.name === 'list_objects');
    expect(listObjects?._meta).toEqual({ ui: { resourceUri: UI.listObjects } });
    expect(listObjects?.outputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['bucket', 'objects']) });
    expect(tools.filter((t) => t._meta)).toHaveLength(1);                     // only the one view so far

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(UI.listObjects);
    const { contents } = await client.readResource({ uri: UI.listObjects });
    expect(contents[0]).toMatchObject({ uri: UI.listObjects, mimeType: 'text/html;profile=mcp-app' });
    const html = String((contents[0] as { text: string }).text);
    expect(html).toContain('<title>Storj object browser</title>');
    expect(html).toContain('<script type="module">');
    expect(html).toContain('ui/initialize');                                   // the App SDK is inlined, not linked
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('returns validated structuredContent from list_objects for the app to render', async () => {
    const fake = fakeProject({ objects: { 'b/docs/a.txt': { data: Buffer.from('12345') }, 'b/z.bin': { data: Buffer.from('x') } } });
    vi.mocked(getProject).mockResolvedValue(fake.project);
    const res = await client.callTool({ name: 'list_objects', arguments: { bucket: 'b', recursive: true } });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({
      bucket: 'b', prefix: '', recursive: true,
      objects: [
        { key: 'docs/a.txt', is_prefix: false, size_bytes: 5, created: '2023-11-14T22:13:20.000Z' },
        { key: 'z.bin', is_prefix: false, size_bytes: 1, created: '2023-11-14T22:13:20.000Z' },
      ],
    });
    const empty = await client.callTool({ name: 'list_objects', arguments: { bucket: 'b', prefix: 'none/' } });
    expect(empty.structuredContent).toEqual({ bucket: 'b', prefix: 'none/', recursive: false, objects: [] });
  });

  it('returns a protocol error (isError) for invalid arguments before the handler runs', async () => {
    const res = await client.callTool({ name: 'stat_object', arguments: { bucket: 'b' } });   // key missing
    expect(res.isError).toBe(true);
  });
});
