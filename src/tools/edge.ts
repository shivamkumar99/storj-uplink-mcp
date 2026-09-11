import { z } from 'zod';
import { defineTool } from '../registry.js';
import {
  edgeRegisterAccess,
  edgeJoinShareUrl,
  EdgeRegions,
  type AccessResultStruct,
  type EdgeCredentials,
  type Permission,
  type SharePrefix,
} from 'storj-uplink-nodejs';
import { requireAccess } from '../auth.js';
import { ok, safeCall, expiryDate, type McpTextResponse } from '../utils.js';
import { createProgress, type ProgressReporter } from '../progress.js';
import { bucketField, keyField, expiresInHoursField } from './schemas.js';

type EdgeRegion = keyof typeof EdgeRegions;

// ---------------------------------------------------------------------------
// Shared helpers — the permission mapping, its description, and the
// "mint a restricted grant → register with edge" step were previously
// duplicated across generate_share_url, get_s3_credentials and share_access.
// ---------------------------------------------------------------------------

interface PermissionArgs {
  allow_download?: boolean;
  allow_upload?: boolean;
  allow_list?: boolean;
  allow_delete?: boolean;
}

/** Build a Permission from the tool's allow_* flags (download/list default on, upload/delete off). */
function permissionFromArgs(args: PermissionArgs, notAfter?: Date): Permission {
  return {
    allowDownload: args.allow_download ?? true,
    allowUpload: args.allow_upload ?? false,
    allowList: args.allow_list ?? true,
    allowDelete: args.allow_delete ?? false,
    notAfter,
  };
}

/** Human-readable summary, e.g. "download, list". */
function describePermissions(p: Permission): string {
  return [
    p.allowDownload ? 'download' : null,
    p.allowUpload ? 'upload' : null,
    p.allowList ? 'list' : null,
    p.allowDelete ? 'delete' : null,
  ].filter(Boolean).join(', ');
}

/**
 * Mint a restricted grant scoped to `prefix` and register it with the edge
 * auth service for `region`.  Never registers the root grant.
 */
async function registerRestrictedAccess(
  access: AccessResultStruct,
  region: EdgeRegion,
  permission: Permission,
  prefix: SharePrefix,
  isPublic: boolean,
  progress: ProgressReporter,
): Promise<{ credentials: EdgeCredentials; regionConfig: (typeof EdgeRegions)[EdgeRegion] }> {
  const regionConfig = EdgeRegions[region];

  progress.update(0, 0, 'creating restricted access…');
  const sharedAccess = await access.share(permission, [prefix]);

  progress.update(0, 0, 'registering with edge service…');
  const credentials = await edgeRegisterAccess(
    { authServiceAddress: regionConfig.authService },
    sharedAccess._nativeHandle,
    { isPublic },
  );

  return { credentials, regionConfig };
}

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
  expires_in_hours: expiresInHoursField.describe(
    'Make the share link stop working after this many hours. Omit for a link that never expires.',
  ),
});

export function generateShareUrl(
  args: z.infer<typeof generateShareUrlSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const access = await requireAccess();
    const progress = createProgress(`Generating share URL for "${args.key}"`);
    const notAfter = expiryDate(args.expires_in_hours);

    // Read-only, public, scoped to exactly this object
    const { credentials, regionConfig } = await registerRestrictedAccess(
      access,
      args.region ?? 'US1',
      { allowDownload: true, allowList: true, notAfter },
      { bucket: args.bucket, prefix: args.key },
      true,
      progress,
    );

    const url = await edgeJoinShareUrl(
      regionConfig.linkshare,
      credentials.accessKeyId,
      args.bucket,
      args.key,
      { raw: args.raw ?? true },
    );

    progress.done(`Share URL generated for "${args.key}"`);

    const expiryNote = notAfter ? `\nExpires: ${notAfter.toISOString()}` : '';
    return ok(`Share URL for "${args.bucket}/${args.key}":\n${url}${expiryNote}`);
  });
}

// ---------------------------------------------------------------------------
// get_s3_credentials — issue S3-compatible credentials for use with rclone,
// aws-cli, or any S3 SDK.
//
// Security — least privilege by default:
//   • Credentials are minted from a *restricted* access grant (access.share),
//     never the root grant.  They are scoped to one bucket (+ optional prefix)
//     with explicit, default-read-only permissions and an optional expiry.
//   • isPublic is false — these are private S3 credentials (require the secret),
//     not a public linkshare key.
//   • The returned secretKey is sensitive; the response includes a warning.
//     Audit logging never records tool *outputs*, only inputs (bucket/prefix).
// ---------------------------------------------------------------------------

export const getS3CredentialsSchema = z.object({
  bucket: bucketField.describe('Bucket the credentials may access'),
  prefix: z.string().optional().describe('Restrict access to objects under this prefix. Omit for the whole bucket.'),
  allow_download: z.boolean().optional().describe('Allow downloading (GET) objects. Default: true'),
  allow_upload: z.boolean().optional().describe('Allow uploading (PUT) objects. Default: false'),
  allow_list: z.boolean().optional().describe('Allow listing objects. Default: true'),
  allow_delete: z.boolean().optional().describe('Allow deleting objects. Default: false'),
  region: z
    .enum(['US1', 'EU1', 'AP1'])
    .optional()
    .describe('Storj region for the edge auth service. Default: US1'),
  expires_in_hours: expiresInHoursField.describe(
    'Credentials stop working after this many hours. Strongly recommended. Omit for non-expiring credentials.',
  ),
});

export function getS3Credentials(
  args: z.infer<typeof getS3CredentialsSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const access = await requireAccess();
    const notAfter = expiryDate(args.expires_in_hours);
    const permission = permissionFromArgs(args, notAfter);
    const progress = createProgress(`Issuing S3 credentials for "${args.bucket}"`);

    // isPublic: false → private S3 credentials (secret required to use them).
    const { credentials } = await registerRestrictedAccess(
      access,
      args.region ?? 'US1',
      permission,
      { bucket: args.bucket, prefix: args.prefix },
      false,
      progress,
    );

    progress.done(`S3 credentials issued for "${args.bucket}"`);
    const scope = args.prefix ? `/${args.prefix}` : ' (whole bucket)';

    return ok(
      `S3-compatible credentials (keep the secret key safe — anyone with it has the access above):\n\n` +
        `  Endpoint:        ${credentials.endpoint}\n` +
        `  Access Key ID:   ${credentials.accessKeyId}\n` +
        `  Secret Key:      ${credentials.secretKey}\n\n` +
        `  Scope:           ${args.bucket}${scope}\n` +
        `  Permissions:     ${describePermissions(permission)}\n` +
        `  Expires:         ${notAfter ? notAfter.toISOString() : 'never'}\n\n` +
        `Use with rclone/aws-cli/S3 SDKs, e.g.:\n` +
        `  aws s3 --endpoint-url ${credentials.endpoint} ls s3://${args.bucket}/${args.prefix ?? ''}`,
    );
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
  expires_in_hours: expiresInHoursField.describe(
    'Access grant expires after this many hours. Omit for no expiry',
  ),
});

export function shareAccess(
  args: z.infer<typeof shareAccessSchema>,
): Promise<McpTextResponse> {
  return safeCall(async () => {
    const access = await requireAccess();
    const notAfter = expiryDate(args.expires_in_hours);
    const permission = permissionFromArgs(args, notAfter);

    const sharedAccess = await access.share(permission, [{ bucket: args.bucket, prefix: args.prefix }]);
    const serialized = await sharedAccess.serialize();

    return ok(
      `Restricted access grant created:\n` +
        `  Bucket: ${args.bucket}\n` +
        `  Prefix: ${args.prefix ?? '(all objects)'}\n` +
        `  Permissions: ${describePermissions(permission)}\n` +
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

// ---------------------------------------------------------------------------
// Tool registry for this module (see registry.ts)
// ---------------------------------------------------------------------------

export const tools = [
  defineTool({
    name: 'generate_share_url',
    description: 'Generate a public shareable URL for a Storj object using Storj Edge linkshare service. Optionally set an expiry.',
    schema: generateShareUrlSchema,
    handler: generateShareUrl,
  }),
  defineTool({
    name: 'get_s3_credentials',
    description:
      'Issue S3-compatible credentials (access key, secret, endpoint) for use with rclone, aws-cli, or any S3 SDK. ' +
      'Scoped to one bucket/prefix with least-privilege permissions (read-only by default) and an optional expiry. ' +
      'The secret key is sensitive — handle with care.',
    schema: getS3CredentialsSchema,
    handler: getS3Credentials,
  }),
  defineTool({
    name: 'share_access',
    description: 'Create a restricted, serialized Storj access grant with specific permissions (download/upload/list/delete), optionally scoped to a bucket prefix and with an expiry time',
    schema: shareAccessSchema,
    handler: shareAccess,
  }),
  defineTool({
    name: 'serialize_access',
    description: 'Serialize the current Storj access grant to a string that can be shared or stored',
    schema: serializeAccessSchema,
    handler: serializeAccess,
  }),
];
