/**
 * Web Vitals reporting
 * Captures Core Web Vitals (LCP, FID, CLS, FCP, TTFB) and:
 *  - Logs to console in development
 *  - Sends to Sentry as measurements in production (when DSN is present)
 */

import type { Metric } from 'web-vitals';

function sendToSentry(metric: Metric) {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  // Dynamically import Sentry to avoid loading it until needed
  import('@sentry/nextjs').then((Sentry) => {
    Sentry.setMeasurement(metric.name, metric.value, metric.name === 'CLS' ? '' : 'millisecond');
    Sentry.addBreadcrumb({
      category: 'web-vitals',
      message: `${metric.name}: ${metric.value.toFixed(2)}`,
      level: metric.rating === 'good' ? 'info' : metric.rating === 'needs-improvement' ? 'warning' : 'error',
      data: {
        id: metric.id,
        value: metric.value,
        rating: metric.rating,
        navigationType: metric.navigationType,
      },
    });
  }).catch(() => {
    // Sentry unavailable — ignore
  });
}

export function reportWebVitals(metric: Metric): void {
  const label = `[Web Vitals] ${metric.name}`;
  const value = metric.name === 'CLS'
    ? metric.value.toFixed(4)
    : `${Math.round(metric.value)}ms`;
  const rating = metric.rating;

  if (process.env.NODE_ENV !== 'production') {
    const style =
      rating === 'good'
        ? 'color: #0d9488; font-weight: bold'
        : rating === 'needs-improvement'
        ? 'color: #f59e0b; font-weight: bold'
        : 'color: #ef4444; font-weight: bold';
    console.log(`%c${label}: ${value} (${rating})`, style);
  } else {
    // Production: send to Sentry only (no console noise)
    sendToSentry(metric);
  }
}
