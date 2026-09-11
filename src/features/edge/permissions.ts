import {
  edgeRegisterAccess,
  EdgeRegions,
  type AccessResultStruct,
  type EdgeCredentials,
  type Permission,
  type SharePrefix,
} from 'storj-uplink-nodejs';
import type { ProgressReporter } from '../../core/progress.js';

// ---------------------------------------------------------------------------
// Shared helpers — the permission mapping, its description, and the
// "mint a restricted grant → register with edge" step used by
// generate_share_url, get_s3_credentials and share_access.
// ---------------------------------------------------------------------------

export type EdgeRegion = keyof typeof EdgeRegions;

export interface PermissionArgs {
  allow_download?: boolean;
  allow_upload?: boolean;
  allow_list?: boolean;
  allow_delete?: boolean;
}

/** Build a Permission from the tool's allow_* flags (download/list default on, upload/delete off). */
export function permissionFromArgs(args: PermissionArgs, notAfter?: Date): Permission {
  return {
    allowDownload: args.allow_download ?? true,
    allowUpload: args.allow_upload ?? false,
    allowList: args.allow_list ?? true,
    allowDelete: args.allow_delete ?? false,
    notAfter,
  };
}

/** Human-readable summary, e.g. "download, list". */
export function describePermissions(p: Permission): string {
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
export async function registerRestrictedAccess(
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
