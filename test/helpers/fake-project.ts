import type { ProjectResultStruct } from 'storj-uplink-nodejs';

// ---------------------------------------------------------------------------
// In-memory stand-in for the parts of ProjectResultStruct the tools use, so
// tool logic can be exercised without a Storj connection. Reproduces the SDK
// quirk that matters to the transfer code: a read at EOF *throws* an error
// carrying `bytesRead`.
// ---------------------------------------------------------------------------

export interface FakeObject {
  data: Buffer;
  /** Override the reported content length (e.g. to simulate a huge object cheaply). */
  size?: number;
  created?: number;
  expires?: number | null;
  custom?: Record<string, string>;
}

export interface UploadRecord {
  bucket: string;
  key: string;
  opts: unknown;
  metadata: unknown;
  data: Buffer;
  committed: boolean;
  aborted: boolean;
}

const objKey = (bucket: string, key: string) => `${bucket}/${key}`;

/** Storj lists buckets/objects in byte order (listing is cursor-paginated by name/key). */
function byteOrder(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
const CREATED = 1_700_000_000;

export function fakeProject(initial: { buckets?: string[]; objects?: Record<string, FakeObject> } = {}) {
  const buckets = new Set(initial.buckets ?? []);
  const store = new Map<string, FakeObject>(Object.entries(initial.objects ?? {}));
  for (const k of store.keys()) buckets.add(k.split('/')[0]);
  const uploads: UploadRecord[] = [];
  const downloads: Array<{ closed: boolean }> = [];
  const calls: string[] = [];

  const info = (key: string, o: FakeObject) => ({
    key,
    isPrefix: false,
    system: { created: o.created ?? CREATED, expires: o.expires ?? null, contentLength: o.size ?? o.data.length },
    custom: o.custom ?? {},
  });
  const requireObject = (bucket: string, key: string): FakeObject => {
    const o = store.get(objKey(bucket, key));
    if (!o) throw new Error(`object not found: ${bucket}/${key}`);
    return o;
  };

  const project = {
    isOpen: true,
    _nativeHandle: { fake: true },
    async close() { calls.push('close'); },

    // ---- buckets
    async listBuckets() { return [...buckets].sort(byteOrder).map((name) => ({ name, created: CREATED })); },
    async createBucket(name: string) { buckets.add(name); return { name, created: CREATED }; },
    async ensureBucket(name: string) { buckets.add(name); return { name, created: CREATED }; },
    async statBucket(name: string) {
      if (!buckets.has(name)) throw new Error(`bucket not found: ${name}`);
      return { name, created: CREATED };
    },
    async deleteBucket(name: string) {
      calls.push(`deleteBucket:${name}`);
      if (!buckets.has(name)) throw new Error(`bucket not found: ${name}`);
      if ([...store.keys()].some((k) => k.startsWith(`${name}/`))) throw new Error(`bucket not empty: ${name}`);
      buckets.delete(name);
    },
    async deleteBucketWithObjects(name: string) {
      calls.push(`deleteBucketWithObjects:${name}`);
      if (!buckets.has(name)) throw new Error(`bucket not found: ${name}`);
      for (const k of [...store.keys()]) if (k.startsWith(`${name}/`)) store.delete(k);
      buckets.delete(name);
    },

    // ---- objects
    async statObject(bucket: string, key: string) { return info(key, requireObject(bucket, key)); },
    async listObjects(bucket: string, opts: { prefix?: string } = {}) {
      const prefix = opts.prefix ?? '';
      return [...store.entries()]
        .filter(([k]) => k.startsWith(`${bucket}/`))
        .map(([k, o]) => ({ k: k.slice(bucket.length + 1), o }))
        .filter(({ k }) => k.startsWith(prefix))
        .sort((x, y) => byteOrder(x.k, y.k))
        .map(({ k, o }) => info(k, o));
    },
    async deleteObject(bucket: string, key: string) {
      calls.push(`deleteObject:${bucket}/${key}`);
      const o = requireObject(bucket, key);
      store.delete(objKey(bucket, key));
      return info(key, o);
    },
    async copyObject(sb: string, sk: string, db: string, dk: string) {
      const o = requireObject(sb, sk);
      store.set(objKey(db, dk), { ...o });
      return info(dk, o);
    },
    async moveObject(sb: string, sk: string, db: string, dk: string) {
      const o = requireObject(sb, sk);
      store.delete(objKey(sb, sk));
      store.set(objKey(db, dk), o);
    },
    async updateObjectMetadata(bucket: string, key: string, metadata: Record<string, string>) {
      requireObject(bucket, key).custom = metadata;
    },

    // ---- transfer
    async uploadObject(bucket: string, key: string, opts?: unknown) {
      const rec: UploadRecord = { bucket, key, opts, metadata: undefined, data: Buffer.alloc(0), committed: false, aborted: false };
      uploads.push(rec);
      return {
        async setCustomMetadata(m: Record<string, string>) { rec.metadata = m; },
        async write(buf: Buffer, n: number) { rec.data = Buffer.concat([rec.data, Buffer.from(buf.subarray(0, n))]); return n; },
        async commit() { rec.committed = true; store.set(objKey(bucket, key), { data: rec.data, custom: rec.metadata as Record<string, string> | undefined }); buckets.add(bucket); },
        async abort() { rec.aborted = true; },
      };
    },
    async downloadObject(bucket: string, key: string, opts: { offset?: number; length?: number } = {}) {
      const o = requireObject(bucket, key);
      let pos = opts.offset ?? 0;
      const end = opts.length !== undefined && opts.length >= 0 ? Math.min(o.data.length, pos + opts.length) : o.data.length;
      const handle = { closed: false };
      downloads.push(handle);
      return {
        async read(buf: Buffer, n: number) {
          if (pos >= end) throw Object.assign(new Error('EOF'), { bytesRead: 0 }); // the SDK quirk
          const take = Math.min(n, end - pos);
          o.data.copy(buf, 0, pos, pos + take);
          pos += take;
          return { bytesRead: take };
        },
        async close() { handle.closed = true; },
      };
    },
  };

  return { project: project as unknown as ProjectResultStruct, buckets, store, uploads, downloads, calls };
}
