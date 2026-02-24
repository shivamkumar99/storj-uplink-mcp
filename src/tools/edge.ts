import { z } from 'zod';
import { edgeRegisterAccess, edgeJoinShareUrl, EdgeRegions } from 'storj-uplink-nodejs';
import { getProject, getAccess } from '../auth.js';
import { ok, errorResponse, type McpTextResponse } from '../utils.js';

// ---------------------------------------------------------------------------
// generate_share_url — create a public linkshare URL for an object
// ---------------------------------------------------------------------------

export const generateShareUrlSchema = z.object({
  bucket: z.string().min(1).describe('Bucket name'),
  key: z.string().min(1).describe('Object key (path)'),
  region: z
    .enum(['US1', 'EU1', 'AP1'])
    .optional()
    .describe('Storj region for the edge service. Default: US1'),
  raw: z
    .boolean()
    .optional()
    .describe('If true, URL serves the file directly (for images, videos). Default: true'),
});

export async function generateShareUrl(
  args: z.infer<typeof generateShareUrlSchema>,
): Promise<McpTextResponse> {
  try {
    // Ensure auth is initialized
    await getProject();
    const access = getAccess();
    if (!access) {
      return errorResponse(new Error('Not connected to Storj. Try listing buckets first.'));
    }

    const region = args.region ?? 'US1';
    const regionConfig = EdgeRegions[region];

    // Create a read-only, public, prefix-scoped access for this object
    const sharedAccess = await access.share(
      { allowDownload: true, allowList: true },
      [{ bucket: args.bucket, prefix: args.key }],
    );

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

    return ok(`Share URL for "${args.bucket}/${args.key}":\n${url}`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// share_access — create a restricted, serialized access grant string
// ---------------------------------------------------------------------------

export const shareAccessSchema = z.object({
  bucket: z.string().min(1).describe('Bucket to grant access to'),
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

export async function shareAccess(
  args: z.infer<typeof shareAccessSchema>,
): Promise<McpTextResponse> {
  try {
    await getProject();
    const access = getAccess();
    if (!access) {
      return errorResponse(new Error('Not connected to Storj. Try listing buckets first.'));
    }

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
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// serialize_access — serialize the current access grant to a string
// ---------------------------------------------------------------------------

export const serializeAccessSchema = z.object({});

export async function serializeAccess(): Promise<McpTextResponse> {
  try {
    await getProject();
    const access = getAccess();
    if (!access) {
      return errorResponse(new Error('Not connected to Storj. Try listing buckets first.'));
    }

    const serialized = await access.serialize();
    const satellite = await access.satelliteAddress();

    return ok(
      `Current access grant:\n` +
        `  Satellite: ${satellite}\n\n` +
        `Serialized grant (keep this secret):\n${serialized}`,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
