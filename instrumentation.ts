/**
 * Next.js Instrumentation File (App Router)
 * Initializes Sentry for both the Node.js server runtime and Edge runtime.
 * This file is required for Sentry v8+ with Next.js 14/15.
 *
 * References:
 *   - process.env.SENTRY_DSN         (server)
 *   - process.env.NEXT_PUBLIC_SENTRY_DSN (edge)
 * Never hardcode DSN values.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Node.js server runtime
    const { init } = await import('@sentry/nextjs');
    init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      debug: process.env.NODE_ENV === 'development',
      beforeSend(event) {
        if (event.request?.data) {
          delete event.request.data;
        }
        if (event.request?.cookies) {
          event.request.cookies = { filtered: '[Filtered]' };
        }
        return event;
      },
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime
    const { init } = await import('@sentry/nextjs');
    init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      debug: process.env.NODE_ENV === 'development',
      beforeSend(event) {
        if (event.request?.data) {
          delete event.request.data;
        }
        return event;
      },
    });
  }
}
