// ---------------------------------------------------------------------------
// Output sanitization — neutralize prompt-injection patterns in content
// returned to the LLM.  (OWASP MCP: treat tool outputs as untrusted.)
// Object keys, metadata and file content from a shared bucket all pass
// through here before they reach a model.
// ---------------------------------------------------------------------------

/** Tags commonly used in prompt injection attempts */
const INJECTION_TAG_RE = /<\/?\s*(IMPORTANT|system|admin|instruction|user|assistant|tool_result|function_call|human|claude)[^>]*>/gi;

export function sanitizeOutput(text: string): string {
  return text.replace(INJECTION_TAG_RE, (tag) => `[tag:${tag}]`);
}

/** Sanitise every key and value of a string record (e.g. custom metadata from a shared bucket). */
export function sanitizeRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [sanitizeOutput(k), sanitizeOutput(v)]));
}
