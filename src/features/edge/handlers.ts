import type { z } from 'zod';
import { edgeJoinShareUrl } from 'storj-uplink-nodejs';
import { requireAccess } from '../../core/auth.js';
import { createProgress } from '../../core/progress.js';
import { ok, safeCall, type McpTextResponse } from '../../lib/response.js';
import { expiryDate } from '../../lib/format.js';
import { permissionFromArgs, describePermissions, registerRestrictedAccess } from './permissions.js';
import type { generateShareUrlSchema, getS3CredentialsSchema, shareAccessSchema } from './schema.js';

// ---------------------------------------------------------------------------
// generate_share_url — create a public linkshare URL for an object
// ---------------------------------------------------------------------------

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
