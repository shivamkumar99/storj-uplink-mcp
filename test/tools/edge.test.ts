import { describe, it, expect, vi, beforeEach } from 'vitest';
import { textOf } from '../helpers/tmp.js';

const m = vi.hoisted(() => ({ register: vi.fn(), joinUrl: vi.fn(), share: vi.fn() }));
vi.mock('storj-uplink-nodejs', () => ({
  edgeRegisterAccess: m.register,
  edgeJoinShareUrl: m.joinUrl,
  EdgeRegions: {
    US1: { authService: 'auth.us1:7777', linkshare: 'https://link.us1' },
    EU1: { authService: 'auth.eu1:7777', linkshare: 'https://link.eu1' },
    AP1: { authService: 'auth.ap1:7777', linkshare: 'https://link.ap1' },
  },
  StorjError: class extends Error {},
}));
vi.mock('../../src/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { requireAccess } from '../../src/auth.js';
import { generateShareUrl, getS3Credentials, shareAccess, serializeAccess, tools } from '../../src/tools/edge.js';

const shared = { _nativeHandle: 'shared-handle', serialize: async () => 'SHARED-GRANT' };
const access = { share: m.share, serialize: async () => 'ROOT-GRANT', satelliteAddress: async () => 'us1.storj.io:7777' };

beforeEach(() => {
  vi.mocked(requireAccess).mockResolvedValue(access as never);
  m.share.mockReset().mockResolvedValue(shared);
  m.register.mockReset().mockResolvedValue({ accessKeyId: 'AKID', secretKey: 'SECRET', endpoint: 'https://gateway' });
  m.joinUrl.mockReset().mockResolvedValue('https://link.us1/s/AKID/b/k');
});

describe('generate_share_url', () => {
  it('mints a public read-only grant scoped to the object and joins the URL', async () => {
    expect(textOf(await generateShareUrl({ bucket: 'b', key: 'k' }))).toBe('Share URL for "b/k":\nhttps://link.us1/s/AKID/b/k');
    expect(m.share).toHaveBeenCalledWith({ allowDownload: true, allowList: true, notAfter: undefined }, [{ bucket: 'b', prefix: 'k' }]);
    expect(m.register).toHaveBeenCalledWith({ authServiceAddress: 'auth.us1:7777' }, 'shared-handle', { isPublic: true });
    expect(m.joinUrl).toHaveBeenCalledWith('https://link.us1', 'AKID', 'b', 'k', { raw: true });
  });
  it('honours region, raw=false and an expiry', async () => {
    const t = textOf(await generateShareUrl({ bucket: 'b', key: 'k', region: 'EU1', raw: false, expires_in_hours: 2 }));
    expect(t).toMatch(/\nExpires: \d{4}-\d{2}-\d{2}T/);
    expect(m.register.mock.calls[0][0]).toEqual({ authServiceAddress: 'auth.eu1:7777' });
    expect(m.joinUrl.mock.calls[0][4]).toEqual({ raw: false });
    expect(m.share.mock.calls[0][0].notAfter).toBeInstanceOf(Date);
  });
});

describe('get_s3_credentials', () => {
  it('defaults to private, read-only, whole-bucket, non-expiring credentials', async () => {
    const t = textOf(await getS3Credentials({ bucket: 'b' }));
    expect(t).toContain('Endpoint:        https://gateway');
    expect(t).toContain('Access Key ID:   AKID');
    expect(t).toContain('Secret Key:      SECRET');
    expect(t).toContain('Scope:           b (whole bucket)');
    expect(t).toContain('Permissions:     download, list');
    expect(t).toContain('Expires:         never');
    expect(t).toContain('aws s3 --endpoint-url https://gateway ls s3://b/');
    expect(m.share).toHaveBeenCalledWith({ allowDownload: true, allowUpload: false, allowList: true, allowDelete: false, notAfter: undefined }, [{ bucket: 'b', prefix: undefined }]);
    expect(m.register).toHaveBeenCalledWith({ authServiceAddress: 'auth.us1:7777' }, 'shared-handle', { isPublic: false });
  });
  it('maps explicit permissions, prefix scope and expiry', async () => {
    const t = textOf(await getS3Credentials({ bucket: 'b', prefix: 'p/', allow_download: false, allow_upload: true, allow_delete: true, expires_in_hours: 1, region: 'AP1' }));
    expect(t).toContain('Scope:           b/p/');
    expect(t).toContain('Permissions:     upload, list, delete');
    expect(t).toMatch(/Expires:\s+\d{4}-/);
    expect(m.share.mock.calls[0][0]).toMatchObject({ allowDownload: false, allowUpload: true, allowList: true, allowDelete: true });
  });
});

describe('share_access / serialize_access', () => {
  it('share_access returns a serialized restricted grant with a permissions summary', async () => {
    const t = textOf(await shareAccess({ bucket: 'b', allow_list: false }));
    expect(t).toBe('Restricted access grant created:\n  Bucket: b\n  Prefix: (all objects)\n  Permissions: download\n  Expires: never\n\nAccess Grant:\nSHARED-GRANT');
    expect(textOf(await shareAccess({ bucket: 'b', prefix: 'p/', expires_in_hours: 3 }))).toMatch(/Prefix: p\/\n  Permissions: download, list\n  Expires: \d{4}-/);
  });
  it('serialize_access returns the root grant with its satellite', async () => {
    expect(textOf(await serializeAccess())).toBe('Current access grant:\n  Satellite: us1.storj.io:7777\n\nSerialized grant (keep this secret):\nROOT-GRANT');
  });
});

it('exports 4 tool definitions', () => {
  expect(tools.map((t) => t.name)).toEqual(['generate_share_url', 'get_s3_credentials', 'share_access', 'serialize_access']);
});
