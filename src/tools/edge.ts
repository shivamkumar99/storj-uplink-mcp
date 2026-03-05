import { z } from 'zod';
import { edgeRegisterAccess, edgeJoinShareUrl, EdgeRegions } from 'storj-uplink-nodejs';
import { requireAccess } from '../auth.js';
import { ok, safeCall, type McpTextResponse } from '../utils.js';
import { createProgress } from '../progress.js';
import { bucketField, keyField } from './schemas.js';

// ---------------------------------------------------------------------------
// generate_share_url — create a public linkshare URL for an object
// ---------------------------------------------------------------------------

export const generateShareUrlSchema = z.object({
  bucket: bucketField,
  key: keyField,
  region: z
    .enum(['US1', 'EU1', 'AP1'])
    .optional()
    .describe('Storj region for the edge service. Default: US1'),
  raw: z
    .boolean()
    .optional()
    .describe('If true, URL serves the file directly (for images, videos). Default: true'),
});

export function generateShareUrl(
  args: z.infer<typeof generateShareUrlSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const access = await requireAccess();
    const progress = createProgress(`Generating share URL for "${args.key}"`);

    const region = args.region ?? 'US1';
    const regionConfig = EdgeRegions[region];

    // Create a read-only, public, prefix-scoped access for this object
    progress.update(0, 0, 'creating restricted access…');
    const sharedAccess = await access.share(
      { allowDownload: true, allowList: true },
      [{ bucket: args.bucket, prefix: args.key }],
    );

    progress.update(0, 0, 'registering with edge service…');
    const credentials = await edgeRegisterAccess(
      { authServiceAddress: regionConfig.authService },
      sharedAccess._nativeHandle,
      { isPublic: true },
    );

    const url = await edgeJoinShareUrl(
      regionConfig.linkshare,
      credentials.accessKeyId,
      args.bucket,
      args.key,
      { raw: args.raw ?? true },
    );

    progress.done(`Share URL generated for "${args.key}"`);

    return ok(`Share URL for "${args.bucket}/${args.key}":\n${url}`);
  });
}

// ---------------------------------------------------------------------------
// share_access — create a restricted, serialized access grant string
// ---------------------------------------------------------------------------

export const shareAccessSchema = z.object({
  bucket: bucketField.describe('Bucket to grant access to'),
  prefix: z.string().optional().describe('Limit access to objects with this prefix. Omit for full bucket access'),
  allow_download: z.boolean().optional().describe('Allow downloading objects. Default: true'),
  allow_upload: z.boolean().optional().describe('Allow uploading objects. Default: false'),
  allow_list: z.boolean().optional().describe('Allow listing objects. Default: true'),
  allow_delete: z.boolean().optional().describe('Allow deleting objects. Default: false'),
  expires_in_hours: z
    .number()
    .positive()
    .optional()
    .describe('Access grant expires after this many hours. Omit for no expiry'),
});

export function shareAccess(
  args: z.infer<typeof shareAccessSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const access = await requireAccess();

    const notAfter = args.expires_in_hours
      ? new Date(Date.now() + args.expires_in_hours * 3600 * 1000)
      : undefined;

    const sharedAccess = await access.share(
      {
        allowDownload: args.allow_download ?? true,
        allowUpload: args.allow_upload ?? false,
        allowList: args.allow_list ?? true,
        allowDelete: args.allow_delete ?? false,
        notAfter,
      },
      [{ bucket: args.bucket, prefix: args.prefix }],
    );

    const serialized = await sharedAccess.serialize();

    const permissions = [
      args.allow_download !== false ? 'download' : null,
      args.allow_upload ? 'upload' : null,
      args.allow_list !== false ? 'list' : null,
      args.allow_delete ? 'delete' : null,
    ]
      .filter(Boolean)
      .join(', ');

    return ok(
      `Restricted access grant created:\n` +
        `  Bucket: ${args.bucket}\n` +
        `  Prefix: ${args.prefix ?? '(all objects)'}\n` +
        `  Permissions: ${permissions}\n` +
        `  Expires: ${notAfter ? notAfter.toISOString() : 'never'}\n\n` +
        `Access Grant:\n${serialized}`,
    );
  });
}

// ---------------------------------------------------------------------------
// serialize_access — serialize the current access grant to a string
// ---------------------------------------------------------------------------

export const serializeAccessSchema = z.object({});

export function serializeAccess(): Promise<McpTextResponse> {
  return safeCall(async () => {
    const access = await requireAccess();

    const serialized = await access.serialize();
    const satellite = await access.satelliteAddress();

    return ok(
      `Current access grant:\n` +
        `  Satellite: ${satellite}\n\n` +
        `Serialized grant (keep this secret):\n${serialized}`,
    );
  });
}
