import { z } from 'zod';

// Structured output of list_buckets — declared as an MCP outputSchema and
// shared (type-only) with the browser view.  Zod-only, like objects/output.ts.
export const listBucketsOutput = {
  buckets: z.array(
    z.object({
      name: z.string(),
      created: z.string().describe('ISO timestamp in the display time zone'),
    }),
  ),
};

export type ListBucketsResult = z.infer<z.ZodObject<typeof listBucketsOutput>>;
