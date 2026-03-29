import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setServer } from './progress.js';
import { auditLog } from './audit.js';
import { guard } from './guard.js';

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
  peekObjectHeadSchema, peekObjectHead,
  peekObjectTailSchema, peekObjectTail,
  grepObjectSchema, grepObject,
} from './tools/smart_read.js';

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
    listBucketsSchema.shape, () =>
      guard(() => { auditLog('list_buckets'); return listBuckets(); })),

  (s) => s.tool('create_bucket',
    'Create a new bucket in your Storj project (idempotent — safe to call if bucket already exists)',
    createBucketSchema.shape, (args) =>
      guard(() => { auditLog('create_bucket', args); return createBucket(args); })),

  (s) => s.tool('delete_bucket',
    'Delete a Storj bucket. By default the bucket must be empty; set with_objects=true to delete all contents too.',
    deleteBucketSchema.shape, (args) =>
      guard(() => { auditLog('delete_bucket', args); return deleteBucket(args); })),

  (s) => s.tool('delete_buckets',
    'Batch-delete multiple buckets by name list or glob pattern (e.g. "logs-*", "test-*"). Shows progress and reports per-bucket success/failure.',
    deleteBucketsSchema.shape, (args) =>
      guard(() => { auditLog('delete_buckets', args); return deleteBuckets(args); })),

  // ── Object tools ──────────────────────────────────────────────────────────

  (s) => s.tool('list_objects',
    'List objects in a Storj bucket, optionally filtered by prefix',
    listObjectsSchema.shape, (args) =>
      guard(() => { auditLog('list_objects', args); return listObjects(args); })),

  (s) => s.tool('stat_object',
    'Get information about a Storj object: size, creation date, expiry, and custom metadata',
    statObjectSchema.shape, (args) =>
      guard(() => { auditLog('stat_object', args); return statObject(args); })),

  (s) => s.tool('delete_object',
    'Delete an object from a Storj bucket',
    deleteObjectSchema.shape, (args) =>
      guard(() => { auditLog('delete_object', args); return deleteObject(args); })),

  (s) => s.tool('delete_objects',
    'Batch-delete multiple objects by key list, prefix, or glob pattern (e.g. "*.log", "photos/**/*.tmp"). Shows progress and reports per-object success/failure.',
    deleteObjectsSchema.shape, (args) =>
      guard(() => { auditLog('delete_objects', args); return deleteObjects(args); })),

  (s) => s.tool('copy_object',
    'Copy an object to a new key or bucket on Storj',
    copyObjectSchema.shape, (args) =>
      guard(() => { auditLog('copy_object', args); return copyObject(args); })),

  (s) => s.tool('move_object',
    'Move or rename an object on Storj',
    moveObjectSchema.shape, (args) =>
      guard(() => { auditLog('move_object', args); return moveObject(args); })),

  (s) => s.tool('update_metadata',
    'Update custom metadata key-value pairs on an existing Storj object',
    updateMetadataSchema.shape, (args) =>
      guard(() => { auditLog('update_metadata', args); return updateMetadata(args); })),

  // ── Upload tools ──────────────────────────────────────────────────────────

  (s) => s.tool('upload_text',
    'Upload text or string content as an object to Storj',
    uploadTextSchema.shape, (args) =>
      guard(() => { auditLog('upload_text', args); return uploadText(args); })),

  (s) => s.tool('upload_file',
    'Read a local file from disk and upload it to Storj',
    uploadFileSchema.shape, (args) =>
      guard(() => { auditLog('upload_file', args); return uploadFile(args); })),

  // ── Download tools ────────────────────────────────────────────────────────

  (s) => s.tool('download_text',
    'Download a Storj object and return its content as text. ' +
    'Loads the full file — use peek_object_head, peek_object_tail, or grep_object for large files.',
    downloadTextSchema.shape, (args) =>
      guard(() => { auditLog('download_text', args); return downloadText(args); })),

  (s) => s.tool('download_file',
    'Download a Storj object and save it to a local file path',
    downloadFileSchema.shape, (args) =>
      guard(() => { auditLog('download_file', args); return downloadFile(args); })),

  // ── Smart read tools (inspect large files without a full download) ─────────

  (s) => s.tool('peek_object_head',
    'Read the first N lines of a Storj object without downloading the whole file. ' +
    'Only fetches the minimum bytes needed. ' +
    'Ideal for CSV headers, JSON structure, config files, or any text file. Safe on files of any size.',
    peekObjectHeadSchema.shape, (args) =>
      guard(() => { auditLog('peek_object_head', args); return peekObjectHead(args); })),

  (s) => s.tool('peek_object_tail',
    'Read the last N lines of a Storj object without downloading the whole file. ' +
    'Only fetches the final 512 KB regardless of total size. ' +
    'Ideal for recent log entries, last rows of a CSV, or the tail of any append-only file.',
    peekObjectTailSchema.shape, (args) =>
      guard(() => { auditLog('peek_object_tail', args); return peekObjectTail(args); })),

  (s) => s.tool('grep_object',
    'Stream-search a Storj object for a keyword and return only the matching lines. ' +
    'Aborts as soon as max_matches is reached — never downloads the full file. ' +
    'Supports surrounding context lines (like grep -C). Case-insensitive. ' +
    'Safe for multi-GB log files, large CSVs, or any text file.',
    grepObjectSchema.shape, (args) =>
      guard(() => { auditLog('grep_object', args); return grepObject(args); })),

  // ── Edge / sharing tools ──────────────────────────────────────────────────

  (s) => s.tool('generate_share_url',
    'Generate a public shareable URL for a Storj object using Storj Edge linkshare service',
    generateShareUrlSchema.shape, (args) =>
      guard(() => { auditLog('generate_share_url', args); return generateShareUrl(args); })),

  (s) => s.tool('share_access',
    'Create a restricted, serialized Storj access grant with specific permissions (download/upload/list/delete), optionally scoped to a bucket prefix and with an expiry time',
    shareAccessSchema.shape, (args) =>
      guard(() => { auditLog('share_access', args); return shareAccess(args); })),

  (s) => s.tool('serialize_access',
    'Serialize the current Storj access grant to a string that can be shared or stored',
    serializeAccessSchema.shape, () =>
      guard(() => { auditLog('serialize_access'); return serializeAccess(); })),
];

// ---------------------------------------------------------------------------
// createServer — pure composition root.  Registration logic lives here once.
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'storj-uplink-mcp',
    version: '1.0.0',
  });

  // Wire up progress reporting so tool handlers can send logging notifications
  setServer(server.server);

  for (const register of TOOLS) {
    register(server);
  }

  return server;
}
