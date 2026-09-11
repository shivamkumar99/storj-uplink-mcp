import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeProject } from '../helpers/fake-project.js';
import { textOf } from '../helpers/tmp.js';

vi.mock('../../src/core/auth.js', () => ({ getProject: vi.fn(), requireAccess: vi.fn() }));
import { getProject } from '../../src/core/auth.js';
import { listBuckets, createBucket, statBucket, bucketUsage, deleteBucket } from '../../src/features/buckets/handlers.js';
import { deleteBuckets } from '../../src/features/buckets/delete-many.js';
import { tools } from '../../src/features/buckets/tools.js';

let fake: ReturnType<typeof fakeProject>;
const use = (f: ReturnType<typeof fakeProject>) => { fake = f; vi.mocked(getProject).mockResolvedValue(f.project); };
beforeEach(() => use(fakeProject({ buckets: ['alpha', 'logs-2024', 'logs-2025', 'zeta'], objects: { 'alpha/a.txt': { data: Buffer.from('12345') }, 'alpha/dir/b.txt': { data: Buffer.from('123') } } })));

describe('list / create / stat', () => {
  it('lists buckets or reports none', async () => {
    expect(textOf(await listBuckets())).toBe(
      'Buckets (4):\n  - alpha  (created: 2023-11-14T22:13:20.000Z)\n  - logs-2024  (created: 2023-11-14T22:13:20.000Z)\n  - logs-2025  (created: 2023-11-14T22:13:20.000Z)\n  - zeta  (created: 2023-11-14T22:13:20.000Z)');
    use(fakeProject());
    expect(textOf(await listBuckets())).toBe('No buckets found in this project.');
  });

  it('creates idempotently and stats', async () => {
    expect(textOf(await createBucket({ name: 'new' }))).toBe('Bucket "new" is ready (created: 2023-11-14T22:13:20.000Z)');
    expect(JSON.parse(textOf(await statBucket({ name: 'new' })))).toEqual({ name: 'new', created: '2023-11-14T22:13:20.000Z' });
    expect(textOf(await statBucket({ name: 'nope' }))).toBe('Error: bucket not found: nope');
  });
});

describe('bucket_usage', () => {
  it('sums sizes, optionally under a prefix', async () => {
    expect(JSON.parse(textOf(await bucketUsage({ bucket: 'alpha' })))).toEqual({ scope: 'alpha', object_count: 2, total_size: '8 B', total_size_bytes: 8, average_size: '4 B' });
    expect(JSON.parse(textOf(await bucketUsage({ bucket: 'alpha', prefix: 'dir/' })))).toMatchObject({ scope: 'alpha/dir/', object_count: 1, total_size_bytes: 3 });
    expect(JSON.parse(textOf(await bucketUsage({ bucket: 'zeta' })))).toMatchObject({ object_count: 0, average_size: '0 B' });
  });
});

describe('delete_bucket', () => {
  it('deletes an empty bucket, refuses a non-empty one, and empties with with_objects', async () => {
    expect(textOf(await deleteBucket({ name: 'zeta' }))).toBe('Bucket "zeta" has been deleted.');
    expect(textOf(await deleteBucket({ name: 'alpha' }))).toBe('Error: bucket not empty: alpha');
    expect(textOf(await deleteBucket({ name: 'alpha', with_objects: true }))).toBe('Bucket "alpha" and all its objects have been deleted.');
    expect(fake.calls).toEqual(['deleteBucket:zeta', 'deleteBucket:alpha', 'deleteBucketWithObjects:alpha']);
  });
});

describe('delete_buckets', () => {
  it('requires confirm_all when no filter is given', async () => {
    expect(textOf(await deleteBuckets({}))).toContain('WARNING: No names or pattern specified');
    expect(fake.buckets.size).toBe(4);
  });

  it('deletes by glob pattern in alphabetical order and reports results', async () => {
    expect(textOf(await deleteBuckets({ pattern: 'logs-*' }))).toBe('Deleted 2 of 2 bucket(s):\n\n✅ Deleted:\n  - logs-2024\n  - logs-2025');
    expect(textOf(await deleteBuckets({ pattern: 'nomatch-*' }))).toBe('No buckets matched the pattern "nomatch-*".');
  });

  it('reports per-bucket failures without stopping', async () => {
    expect(textOf(await deleteBuckets({ names: ['zeta', 'alpha', 'ghost'] }))).toBe(
      'Deleted 1 of 3 bucket(s):\n\n✅ Deleted:\n  - zeta\n\n❌ Failed:\n  - alpha: bucket not empty: alpha\n  - ghost: bucket not found: ghost');
  });

  it('confirm_all deletes everything, honouring with_objects', async () => {
    expect(textOf(await deleteBuckets({ confirm_all: true, with_objects: true }))).toContain('Deleted 4 of 4 bucket(s):');
    expect(fake.buckets.size).toBe(0);
    use(fakeProject());
    expect(textOf(await deleteBuckets({ confirm_all: true }))).toBe('No buckets found to delete.');
  });
});

it('exports 6 tool definitions', () => {
  expect(tools.map((t) => t.name)).toEqual(['list_buckets', 'create_bucket', 'stat_bucket', 'bucket_usage', 'delete_bucket', 'delete_buckets']);
});
