import { defineTool, annotations } from '../../core/registry.js';
import { uploadTextSchema, uploadFileSchema, uploadDirectorySchema } from './schema.js';
import { uploadText, uploadFile } from './handlers.js';
import { uploadDirectory } from './directory.js';

export const tools = [
  defineTool({
    name: 'upload_text',
    annotations: annotations.overwrites,
    description: 'Upload text or string content as an object to Storj',
    schema: uploadTextSchema,
    handler: uploadText,
  }),
  defineTool({
    name: 'upload_file',
    annotations: annotations.overwrites,
    description: 'Read a local file from disk and upload it to Storj',
    schema: uploadFileSchema,
    handler: uploadFile,
  }),
  defineTool({
    name: 'upload_directory',
    annotations: annotations.overwrites,
    description:
      'Recursively upload a local folder to a Storj bucket under an optional key prefix. ' +
      'Skips symlinks and sensitive paths; shows progress and reports per-file success/failure.',
    schema: uploadDirectorySchema,
    handler: uploadDirectory,
  }),
];
