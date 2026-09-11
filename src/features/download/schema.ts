import { z } from 'zod';
import { bucketField, keyField, chunkSizeField } from '../../shared/fields.js';

export const downloadTextSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) to download'),
  chunk_size: chunkSizeField,
});

export const downloadFileSchema = z.object({
  bucket: bucketField,
  key: keyField.describe('Object key (path) on Storj'),
  file_path: z
    .string()
    .min(1)
    .describe('Local path where the file will be saved, e.g. "/tmp/photo.jpg"'),
  chunk_size: chunkSizeField,
});

export const downloadPrefixSchema = z.object({
  bucket: bucketField,
  prefix: z
    .string()
    .optional()
    .describe('Download all objects under this prefix, e.g. "photos/2024/". Omit to download the whole bucket.'),
  dest_dir: z.string().min(1).describe('Local directory to save files into, e.g. "./restore"'),
  chunk_size: chunkSizeField,
});
