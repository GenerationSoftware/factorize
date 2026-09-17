/** Best-effort redaction boundary for agent transcripts. Never persist the input. */
const REDACTED = "[REDACTED]";

const patterns: RegExp[] = [
  /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi,
  /\b(?:gh[pousr]|github_pat|lin_api|lin_oauth)_[a-z0-9_]+|\bsk-[a-z0-9_-]+|\bxox[baprs]-[a-z0-9-]+/gi,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\-/]+=*/gi,
  /https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd|authorization|client[_-]?secret)\s*[:=]\s*(['"]?)[^\s,'"}]+\1/gi,
  /\b(?:CF|CLOUDFLARE|LINEAR|GITHUB|AWS)[A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)\s*=\s*(['"]?)[^\s,'"}]+\1/gi,
];

export function scrubSession(value: string): string {
  if (typeof value !== "string") throw new TypeError("Agent session must be text");
  return patterns.reduce((text, pattern) => text.replace(pattern, REDACTED), value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

export function safeSession(value: unknown): string | null {
  try {
    if (typeof value !== "string" || !value.trim()) return null;
    return scrubSession(value);
  } catch {
    return null;
  }
}
