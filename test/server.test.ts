import { describe, it, expect, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { createProgress } from '../src/progress.js';

describe('createServer', () => {
  it('registers all 28 tools with unique names', () => {
    const server = createServer();
    const names = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(names).toHaveLength(28);
    expect(new Set(names).size).toBe(28);
    for (const n of ['list_buckets', 'upload_file', 'download_prefix', 'get_s3_credentials', 'grep_object', 'abort_multipart_upload']) {
      expect(names).toContain(n);
    }
  });

  it('wires progress reporting to the server', () => {
    const server = createServer();
    const spy = vi.spyOn(server.server, 'sendLoggingMessage').mockResolvedValue(undefined);
    createProgress('op').done('all done');
    expect(spy).toHaveBeenCalledWith({ level: 'info', data: '✅ all done' });
  });
});
