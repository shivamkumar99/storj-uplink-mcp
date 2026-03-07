import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setServer } from './progress.js';

import {
  listBucketsSchema, listBuckets,
  createBucketSchema, createBucket,
  deleteBucketSchema, deleteBucket,
  deleteBucketsSchema, deleteBuckets,
} from './tools/buckets.js';

import {
  listObjectsSchema, listObjects,
  statObjectSchema, statObject,
  deleteObjectSchema, deleteObject,
  deleteObjectsSchema, deleteObjects,
  copyObjectSchema, copyObject,
  moveObjectSchema, moveObject,
  updateMetadataSchema, updateMetadata,
} from './tools/objects.js';

import {
  uploadTextSchema, uploadText,
  uploadFileSchema, uploadFile,
} from './tools/upload.js';

import {
  downloadTextSchema, downloadText,
  downloadFileSchema, downloadFile,
} from './tools/download.js';

import {
  generateShareUrlSchema, generateShareUrl,
  shareAccessSchema, shareAccess,
  serializeAccessSchema, serializeAccess,
} from './tools/edge.js';

// ---------------------------------------------------------------------------
// Tool registry — OCP: adding a new tool = one new entry here + one import.
//
// Each entry is a closure over (server) that calls server.tool() directly,
// letting TypeScript resolve schema→handler types per-call with full inference.
// The registration loop in createServer() never changes.
// ---------------------------------------------------------------------------

type ToolRegistrar = (server: McpServer) => void;

const TOOLS: ToolRegistrar[] = [

  // ── Bucket tools ──────────────────────────────────────────────────────────

  (s) => s.tool('list_buckets',
    'List all buckets in your Storj project',
    listBucketsSchema.shape, () => listBuckets()),

  (s) => s.tool('create_bucket',
    'Create a new bucket in your Storj project (idempotent — safe to call if bucket already exists)',
    createBucketSchema.shape, (args) => createBucket(args)),

  (s) => s.tool('delete_bucket',
    'Delete a Storj bucket. By default the bucket must be empty; set with_objects=true to delete all contents too.',
    deleteBucketSchema.shape, (args) => deleteBucket(args)),

  (s) => s.tool('delete_buckets',
    'Batch-delete multiple buckets by name list or glob pattern (e.g. "logs-*", "test-*"). Shows progress and reports per-bucket success/failure.',
    deleteBucketsSchema.shape, (args) => deleteBuckets(args)),

  // ── Object tools ──────────────────────────────────────────────────────────

  (s) => s.tool('list_objects',
    'List objects in a Storj bucket, optionally filtered by prefix',
    listObjectsSchema.shape, (args) => listObjects(args)),

  (s) => s.tool('stat_object',
    'Get information about a Storj object: size, creation date, expiry, and custom metadata',
    statObjectSchema.shape, (args) => statObject(args)),

  (s) => s.tool('delete_object',
    'Delete an object from a Storj bucket',
    deleteObjectSchema.shape, (args) => deleteObject(args)),

  (s) => s.tool('delete_objects',
    'Batch-delete multiple objects by key list, prefix, or glob pattern (e.g. "*.log", "photos/**/*.tmp"). Shows progress and reports per-object success/failure.',
    deleteObjectsSchema.shape, (args) => deleteObjects(args)),

  (s) => s.tool('copy_object',
    'Copy an object to a new key or bucket on Storj',
    copyObjectSchema.shape, (args) => copyObject(args)),

  (s) => s.tool('move_object',
    'Move or rename an object on Storj',
    moveObjectSchema.shape, (args) => moveObject(args)),

  (s) => s.tool('update_metadata',
    'Update custom metadata key-value pairs on an existing Storj object',
    updateMetadataSchema.shape, (args) => updateMetadata(args)),

  // ── Upload tools ──────────────────────────────────────────────────────────

  (s) => s.tool('upload_text',
    'Upload text or string content as an object to Storj',
    uploadTextSchema.shape, (args) => uploadText(args)),

  (s) => s.tool('upload_file',
    'Read a local file from disk and upload it to Storj',
    uploadFileSchema.shape, (args) => uploadFile(args)),

  // ── Download tools ────────────────────────────────────────────────────────

  (s) => s.tool('download_text',
    'Download a Storj object and return its content as text',
    downloadTextSchema.shape, (args) => downloadText(args)),

  (s) => s.tool('download_file',
    'Download a Storj object and save it to a local file path',
    downloadFileSchema.shape, (args) => downloadFile(args)),

  // ── Edge / sharing tools ──────────────────────────────────────────────────

  (s) => s.tool('generate_share_url',
    'Generate a public shareable URL for a Storj object using Storj Edge linkshare service',
    generateShareUrlSchema.shape, (args) => generateShareUrl(args)),

  (s) => s.tool('share_access',
    'Create a restricted, serialized Storj access grant with specific permissions (download/upload/list/delete), optionally scoped to a bucket prefix and with an expiry time',
    shareAccessSchema.shape, (args) => shareAccess(args)),

  (s) => s.tool('serialize_access',
    'Serialize the current Storj access grant to a string that can be shared or stored',
    serializeAccessSchema.shape, () => serializeAccess()),
];

// ---------------------------------------------------------------------------
// createServer — pure composition root.  Registration logic lives here once.
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'storj-uplink-mcp',
    version: '0.1.0',
  });

  // Wire up progress reporting so tool handlers can send logging notifications
  setServer(server.server);

  for (const register of TOOLS) {
    register(server);
  }

  return server;
}
