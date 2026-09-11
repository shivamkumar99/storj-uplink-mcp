import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fakeProject } from './helpers/fake-project.js';

// Real server, real protocol, in-memory transport — only the Storj connection is faked.
vi.mock('../src/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../src/auth.js';
import { createServer } from '../src/server.js';

const server = createServer();
const client = new Client({ name: 'test-client', version: '0' });

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
});
afterAll(async () => { await client.close(); await server.close(); vi.restoreAllMocks(); });

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

  it('returns a protocol error (isError) for invalid arguments before the handler runs', async () => {
    const res = await client.callTool({ name: 'stat_object', arguments: { bucket: 'b' } });   // key missing
    expect(res.isError).toBe(true);
  });
});
