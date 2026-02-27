/**
 * Next.js Client Instrumentation File
 * Initializes Sentry for the browser (client) runtime.
 * Replaces the deprecated sentry.client.config.ts for Turbopack compatibility.
 *
 * References process.env.NEXT_PUBLIC_SENTRY_DSN — never hardcode.
 */

import * as Sentry from '@sentry/nextjs';

// Required for Next.js 15 App Router navigation tracing
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
    Sentry.browserTracingIntegration(),
  ],
  debug: process.env.NODE_ENV === 'development',
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    /^Network request failed/,
    /^ChunkLoadError/,
  ],
  beforeSend(event) {
    if (event.request?.data) {
      delete event.request.data;
    }
    return event;
  },
});
