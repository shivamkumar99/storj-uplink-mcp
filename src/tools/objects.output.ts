import { z } from 'zod';

// ---------------------------------------------------------------------------
// Structured output of list_objects.  Declared as an MCP outputSchema so
// clients validate it, and imported (type-only) by the object-browser UI so
// the view and the tool can never drift apart.  Kept zod-only so the browser
// bundle's type-check does not pull in server modules.
// ---------------------------------------------------------------------------

export const listObjectsOutput = {
  bucket: z.string(),
  prefix: z.string().describe('Prefix that was listed ("" for the bucket root)'),
  recursive: z.boolean(),
  objects: z.array(
    z.object({
      key: z.string(),
      is_prefix: z.boolean().describe('True for a folder-like prefix rather than an object'),
      size_bytes: z.number().optional(),
      created: z.string().optional().describe('ISO timestamp'),
    }),
  ),
};

export type ListObjectsResult = z.infer<z.ZodObject<typeof listObjectsOutput>>;
