import { z } from 'zod';
import { bucketField, metadataField, chunkSizeField, expiresInHoursField } from '../../shared/fields.js';

export const uploadTextSchema = z.object({
  bucket: bucketField,
  key: z.string().min(1).describe('Object key (path), e.g. "notes/hello.txt"'),
  content: z.string().describe('Text content to upload'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
  expires_in_hours: expiresInHoursField,
});

export const uploadFileSchema = z.object({
  bucket: bucketField,
  key: z.string().min(1).describe('Object key (path) on Storj, e.g. "backups/photo.jpg"'),
  file_path: z.string().min(1).describe('Absolute or relative path to the local file to upload'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
  expires_in_hours: expiresInHoursField,
});

export const uploadDirectorySchema = z.object({
  bucket: bucketField,
  dir_path: z.string().min(1).describe('Local directory to upload, e.g. "./photos"'),
  prefix: z
    .string()
    .optional()
    .describe('Object key prefix to upload into, e.g. "backup/2024/". Files keep their relative paths under it.'),
  metadata: metadataField,
  chunk_size: chunkSizeField,
  expires_in_hours: expiresInHoursField,
});
