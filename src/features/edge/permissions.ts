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

const PERMISSION_FLAGS = ['allow_download', 'allow_upload', 'allow_list', 'allow_delete'] as const;

/** Least privilege by default: read and list on, write and delete off. */
const PERMISSION_DEFAULTS: Required<PermissionArgs> = {
  allow_download: true, allow_upload: false, allow_list: true, allow_delete: false,
};

/** Build a Permission from the tool's allow_* flags, filling unset ones from the defaults. */
export function permissionFromArgs(args: PermissionArgs, notAfter?: Date): Permission {
  const flags = { ...PERMISSION_DEFAULTS };
  for (const flag of PERMISSION_FLAGS) {
    const value = args[flag];
    if (value !== undefined) flags[flag] = value;
  }
  return {
    allowDownload: flags.allow_download,
    allowUpload: flags.allow_upload,
    allowList: flags.allow_list,
    allowDelete: flags.allow_delete,
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
