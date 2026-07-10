export function assertSameOrigin(request: Request): void {
  const expected = applicationOrigin(request);
  const origin = request.headers.get('origin');
  if (origin !== expected) throw new Error('csrf_origin_invalid');
}

export function applicationOrigin(request: Request): string {
  const configured = process.env['WEB_ORIGIN'];
  if (process.env['NODE_ENV'] === 'production' && !configured) {
    throw new Error('WEB_ORIGIN is required in production');
  }
  return new URL(configured ?? request.url).origin;
}
