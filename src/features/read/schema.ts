import { z } from 'zod';
import { bucketField, keyField } from '../../shared/fields.js';
import { MAX_PEEK_LINES, MAX_GREP_MATCHES, MAX_CONTEXT_LINES } from './constants.js';

export const peekObjectHeadSchema = z.object({
  bucket: bucketField,
  key:    keyField.describe('Object key to inspect'),
  lines:  z
    .number().int().min(1).max(MAX_PEEK_LINES)
    .default(20)
    .describe(
      `How many lines to return from the start of the file. ` +
      `Default 20, max ${MAX_PEEK_LINES}. ` +
      `Great for CSV headers, JSON structure, config files.`,
    ),
});

export const peekObjectTailSchema = z.object({
  bucket: bucketField,
  key:    keyField.describe('Object key to inspect'),
  lines:  z
    .number().int().min(1).max(MAX_PEEK_LINES)
    .default(20)
    .describe(
      `How many lines to return from the end of the file. ` +
      `Default 20, max ${MAX_PEEK_LINES}. ` +
      `Great for recent log entries, last rows of a CSV.`,
    ),
});

export const grepObjectSchema = z.object({
  bucket: bucketField,
  key:    keyField.describe('Object key to search through'),

  query: z
    .string().min(1).max(200)
    .describe('Text to search for. Case-insensitive substring match.'),

  context_lines: z
    .number().int().min(0).max(MAX_CONTEXT_LINES)
    .default(0)
    .describe(
      'Number of surrounding lines to show around each match (like grep -C). ' +
      `Default 0. Max ${MAX_CONTEXT_LINES}.`,
    ),

  max_matches: z
    .number().int().min(1).max(MAX_GREP_MATCHES)
    .default(50)
    .describe(
      `Stop after this many matching lines. ` +
      `Default 50, max ${MAX_GREP_MATCHES}. ` +
      `Search aborts early to save bandwidth once the limit is hit.`,
    ),
});
