const SENSITIVE_KEY =
  /(?:authorization|cookie|secret|token|password|credential|client[_-]?secret|api[_-]?key|private[_-]?key)/i;
const REDACTED = '[REDACTED]';

export function maskCredential(value: string): string {
  const suffix = Array.from(value.trim()).slice(-4).join('');
  return suffix.length === 0 ? REDACTED : `••••${suffix}`;
}

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(item, depth + 1);
  }
  return output;
}
