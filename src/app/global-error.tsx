'use client';

/**
 * global-error.tsx — Root error handler for React rendering errors in App Router.
 * This replaces the root layout when an error is caught at the root boundary.
 * Errors are automatically reported to Sentry via withSentryConfig.
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#0a0e14',
          color: '#ffffff',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
            background:
              'linear-gradient(145deg, rgba(28,36,46,0.8) 0%, rgba(20,26,34,0.9) 100%)',
            border: '1px solid rgba(37,47,59,1)',
            borderRadius: '16px',
            padding: '3rem 2rem',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.75rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              color: '#9ca3af',
              lineHeight: 1.6,
              marginBottom: '2rem',
              fontSize: '0.95rem',
            }}
          >
            Something went wrong. Our team has been notified and is working to
            fix this as quickly as possible.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: '0.75rem',
                color: '#6b7280',
                marginBottom: '1.5rem',
                fontFamily: 'monospace',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: 'linear-gradient(135deg, #0d9488 0%, #06b6d4 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '0.75rem 2rem',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
