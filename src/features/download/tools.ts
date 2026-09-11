import { defineTool, annotations } from '../../core/registry.js';
import { downloadTextSchema, downloadFileSchema, downloadPrefixSchema } from './schema.js';
import { downloadText, downloadFile } from './handlers.js';
import { downloadPrefix } from './prefix.js';

export const tools = [
  defineTool({
    name: 'download_text',
    annotations: annotations.readOnly,
    description:
      'Download a Storj object and return its content as text. ' +
      'Loads the full file — use peek_object_head, peek_object_tail, or grep_object for large files.',
    schema: downloadTextSchema,
    handler: downloadText,
  }),
  defineTool({
    name: 'download_file',
    annotations: annotations.overwrites,
    description: 'Download a Storj object and save it to a local file path',
    schema: downloadFileSchema,
    handler: downloadFile,
  }),
  defineTool({
    name: 'download_prefix',
    annotations: annotations.overwrites,
    description:
      'Bulk-download every object under a prefix (or a whole bucket) to a local directory, preserving folder layout. ' +
      'Guards against path-escape from hostile object keys; shows progress and reports per-object success/failure.',
    schema: downloadPrefixSchema,
    handler: downloadPrefix,
  }),
];
