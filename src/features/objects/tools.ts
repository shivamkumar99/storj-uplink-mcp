import { defineTool, annotations } from '../../core/registry.js';
import { UI } from '../../core/ui-resources.js';
import {
  listObjectsSchema, statObjectSchema, deleteObjectSchema, deleteObjectsSchema,
  copyObjectSchema, moveObjectSchema, updateMetadataSchema,
} from './schema.js';
import { listObjectsOutput } from './output.js';
import { listObjects, statObject, deleteObject, copyObject, moveObject, updateMetadata } from './handlers.js';
import { deleteObjects } from './delete-many.js';

export const tools = [
  defineTool({
    name: 'list_objects',
    annotations: annotations.readOnly,
    description: 'List objects in a Storj bucket, optionally filtered by prefix',
    schema: listObjectsSchema,
    outputSchema: listObjectsOutput,
    ui: { resourceUri: UI.listObjects },
    handler: listObjects,
  }),
  defineTool({
    name: 'stat_object',
    annotations: annotations.readOnly,
    description: 'Get information about a Storj object: size, creation date, expiry, and custom metadata',
    schema: statObjectSchema,
    handler: statObject,
  }),
  defineTool({
    name: 'delete_object',
    annotations: annotations.deletes,
    description: 'Delete an object from a Storj bucket',
    schema: deleteObjectSchema,
    handler: deleteObject,
  }),
  defineTool({
    name: 'delete_objects',
    annotations: annotations.deletes,
    description: 'Batch-delete multiple objects by key list, prefix, or glob pattern (e.g. "*.log", "photos/**/*.tmp"). Shows progress and reports per-object success/failure.',
    schema: deleteObjectsSchema,
    handler: deleteObjects,
  }),
  defineTool({
    name: 'copy_object',
    annotations: annotations.overwrites,
    description: 'Copy an object to a new key or bucket on Storj',
    schema: copyObjectSchema,
    handler: copyObject,
  }),
  defineTool({
    name: 'move_object',
    annotations: annotations.deletes,
    description: 'Move or rename an object on Storj',
    schema: moveObjectSchema,
    handler: moveObject,
  }),
  defineTool({
    name: 'update_metadata',
    annotations: annotations.overwrites,
    description: 'Update custom metadata key-value pairs on an existing Storj object',
    schema: updateMetadataSchema,
    handler: updateMetadata,
  }),
];
