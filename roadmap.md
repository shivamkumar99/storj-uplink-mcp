# storj-uplink-mcp — Feature Roadmap

---

## Sprint: Code Quality Refactor — DRY / SOLID / Clean Architecture
**Status: COMPLETE**

Violations identified and fixed based on code audit:

### DRY Fixes
- [x] Wire up `safeCall()` in all 13 tool functions — eliminated manual `try/catch` repetition
- [x] Add `requireAccess()` to `auth.ts` — eliminate the 3× `getProject() + getAccess() + null-check` pattern in `edge.ts`
- [x] Extract shared Zod field constants to `src/tools/schemas.ts` — `bucketField`, `keyField`, `srcBucketField`, `srcKeyField`, `dstBucketField`, `dstKeyField`, `metadataField`
- [x] Extract `uploadData()` helper in `upload.ts` — eliminate duplicated `metadata → write chunks → commit / abort-on-error` logic

### SOLID Fixes
- [x] **SRP** — move `process.on(SIGINT/SIGTERM)` signal handlers out of `auth.ts` into `index.ts` (auth module no longer manages process lifecycle)
- [x] **SRP** — export `shutdown()` from `auth.ts` so `index.ts` can call it without circular coupling
- [x] **DIP** — `requireAccess()` hides the side-effect workaround; `edge.ts` tools no longer depend on the internal `_access` module state

### Clean Architecture Notes
The following architectural improvements are deferred to a future sprint as they require broader refactoring:
- Separate use-case layer from MCP presentation layer
- Move `fs` infrastructure calls (`readFileSync`, `writeFileSync`) out of tool handlers into a dedicated IO adapter
- Decouple tool return types from `McpTextResponse` to allow reuse outside MCP

---

## Planned & Suggested Features

### 1. Advanced Sharing & Access Control
- Generate time-limited, expiring share URLs for objects
- Create access grants with custom permissions (read-only, upload, list, delete)
- Share buckets or objects with specific users or groups

### 2. Object Versioning & History
- Support object versioning (keep previous versions, restore, diff)
- List object history and audit actions

### 3. Bulk Operations
- Bulk upload/download (multiple files, folders)
- Bulk delete, copy, or move objects

### 4. Metadata & Tagging
- Add, update, and search custom metadata/tags on objects
- Filter/list objects by metadata or tags

### 5. CLI/Interactive Mode
- Interactive CLI for browsing buckets, objects, and performing actions
- Command-line prompts for common workflows

### 6. Integration & Automation
- Webhook support: trigger actions on upload/download
- Scheduled tasks: auto-backup, sync, cleanup

### 7. Security & Audit
- Audit logs for all actions (who, when, what)
- Option to encrypt objects with user-supplied keys

### 8. Notifications
- Email or desktop notifications for completed uploads/downloads, share events

### 9. Usage & Billing
- Show storage usage, bandwidth, and billing info
- Warn when approaching limits

### 10. Local Cache & Offline Mode
- Local cache for frequently accessed objects
- Offline access with sync when online

### 11. MCP API Extensions
- Support for custom MCP commands (e.g., AI-driven file search, summarization)
- Integration with other AI tools (e.g., summarize bucket contents, auto-tag files)

### 12. User Experience
- Easy migration/import from other storage providers
- Quickstart templates for common use cases (backup, media, docs)

---

**Prioritize features based on user feedback and demand.**
