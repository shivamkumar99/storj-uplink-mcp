import { defineTool, annotations } from '../../core/registry.js';
import { peekObjectHeadSchema, peekObjectTailSchema, grepObjectSchema } from './schema.js';
import { peekObjectHead } from './peek-head.js';
import { peekObjectTail } from './peek-tail.js';
import { grepObject } from './grep.js';

export const tools = [
  defineTool({
    name: 'peek_object_head',
    annotations: annotations.readOnly,
    description:
      'Read the first N lines of a Storj object without downloading the whole file. ' +
      'Only fetches the minimum bytes needed. ' +
      'Ideal for CSV headers, JSON structure, config files, or any text file. Safe on files of any size.',
    schema: peekObjectHeadSchema,
    handler: peekObjectHead,
  }),
  defineTool({
    name: 'peek_object_tail',
    annotations: annotations.readOnly,
    description:
      'Read the last N lines of a Storj object without downloading the whole file. ' +
      'Only fetches the final 512 KB regardless of total size. ' +
      'Ideal for recent log entries, last rows of a CSV, or the tail of any append-only file.',
    schema: peekObjectTailSchema,
    handler: peekObjectTail,
  }),
  defineTool({
    name: 'grep_object',
    annotations: annotations.readOnly,
    description:
      'Stream-search a Storj object for a keyword and return only the matching lines. ' +
      'Aborts as soon as max_matches is reached — never downloads the full file. ' +
      'Supports surrounding context lines (like grep -C). Case-insensitive. ' +
      'Safe for multi-GB log files, large CSVs, or any text file.',
    schema: grepObjectSchema,
    handler: grepObject,
  }),
];
