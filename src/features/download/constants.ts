/** Maximum file size for download_text (50 MB) — prevents OOM and context flooding */
export const MAX_DOWNLOAD_TEXT_BYTES = 50 * 1024 * 1024;

/** Maximum number of objects a single download_prefix call will transfer */
export const MAX_PREFIX_OBJECTS = 5_000;
