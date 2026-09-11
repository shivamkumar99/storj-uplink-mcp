# Architecture

The server is organised as **vertical slices**: one folder per feature, and
inside each folder a fixed set of files split by concern. Cross-cutting
infrastructure and pure helpers live outside the slices.

```
src/
  index.ts            stdio entry point
  setup.ts            `storj-uplink-mcp-setup` entry point (flags only)
  server.ts           composition root — imports each feature's tools.ts
  core/               runtime infrastructure: registry, request context,
                      progress, concurrency guard, audit log, env, config,
                      auth, MCP Apps resource registration
  lib/                pure helpers with no project imports: response,
                      sanitize, paths, format, glob
  transfer/           shared streaming algorithms: upload/download templates,
                      chunk sources/sinks, batch runner, tuning constants
  shared/fields.ts    Zod input fields used by more than one feature
  cli/                the interactive setup wizard
  features/
    <feature>/
      schema.ts       Zod input schemas (+ output.ts for structured output)
      constants.ts    limits and tuning values (only when the feature has any)
      handlers.ts     simple one-call tools
      <tool>.ts       one file per complex tool (e.g. delete-many.ts, grep.ts)
      tools.ts        defineTool() list — the only file server.ts imports
ui/
  browser/            the MCP Apps view (browser code, own tsconfig with DOM
                      lib) shared by list_buckets and list_objects, bundled by
                      scripts/build-ui.mjs into dist/ui/browser.html
test/                 mirrors src/ one-to-one (test/core, test/lib, …)
```

## Rules

- **Dependency direction is one way.** `features` may import `core`, `lib`,
  `transfer` and `shared`. `core` and `transfer` may import `lib`. `lib`
  imports nothing from the project. Nothing imports from `features` except
  `server.ts`, and features never import each other.
- **200 lines per file**, enforced by ESLint `max-lines`. When a file grows
  past it, split by concern (schema / constants / handler / tool) — do not
  raise the limit.
- **Same file names in every feature.** Anyone can open any feature and know
  where the schema, the constants, the handlers and the registration are.
- **UI stays outside `src/`.** It needs the DOM lib and a bundler, and must
  never be compiled by the server's `tsc`. Views import only the feature
  `output.ts` files (type-only) so the view and the tool cannot drift.
- **Adding a tool**: add the schema to `schema.ts`, the handler to
  `handlers.ts` (or its own file), and one `defineTool()` entry to `tools.ts`.
  Nothing else changes.
- **Adding a feature**: create the folder with the files above, then add one
  import and one spread to `server.ts`.
