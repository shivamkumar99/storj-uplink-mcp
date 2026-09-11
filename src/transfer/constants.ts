// ---------------------------------------------------------------------------
// Transfer tuning constants (shared by the upload/download algorithms and the
// chunk_size input field).
// ---------------------------------------------------------------------------

/** Default upload chunk size: 1 MB */
export const DEFAULT_UPLOAD_CHUNK = 1024 * 1024;

/** Default download read buffer: 64 KB */
export const DEFAULT_DOWNLOAD_CHUNK = 64 * 1024;

/** Minimum allowed chunk size: 4 KB */
export const MIN_CHUNK = 4 * 1024;

/** Maximum allowed chunk size: 64 MB */
export const MAX_CHUNK = 64 * 1024 * 1024;
