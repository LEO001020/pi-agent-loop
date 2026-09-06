/** Client-side redact helper for Doctor export / logs display. */

const SENSITIVE =
  /\b(sk-[A-Za-z0-9]{10,}|xai-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/gi;

export function redact(text: string): string {
  return text.replace(SENSITIVE, "[REDACTED]");
}
