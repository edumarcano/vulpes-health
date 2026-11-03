export function rejectCredentials(text: string): boolean {
  return (
    /(?:\b(?:sk|pk)[-_](?:proj[-_])?[A-Za-z0-9_-]{16,}|\bAIza[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{20,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(
      text,
    ) ||
    /\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S{8,}/i.test(
      text,
    )
  );
}
