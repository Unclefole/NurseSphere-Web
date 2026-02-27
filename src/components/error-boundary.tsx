'use client';

import React from 'react';
import * as Sentry from '@sentry/nextjs';

interface ErrorBoundaryState {
  hasError: boolean;
  eventId: string | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const eventId = Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
    this.setState({ eventId: eventId ?? null });
    console.error('[ErrorBoundary] Caught render error:', error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, eventId: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0a0e14',
            color: '#ffffff',
            fontFamily: 'system-ui, sans-serif',
            padding: '2rem',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              width: '100%',
              textAlign: 'center',
              background: 'linear-gradient(145deg, rgba(28,36,46,0.8) 0%, rgba(20,26,34,0.9) 100%)',
              border: '1px solid rgba(37,47,59,1)',
              borderRadius: '16px',
              padding: '3rem 2rem',
              backdropFilter: 'blur(10px)',
            }}
          >
            {/* Icon */}
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>

            {/* Heading */}
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                marginBottom: '0.75rem',
                color: '#ffffff',
              }}
            >
              Something went wrong
            </h1>

            {/* Message */}
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

            {/* Event ID */}
            {this.state.eventId && (
              <p
                style={{
                  fontSize: '0.75rem',
                  color: '#6b7280',
                  marginBottom: '1.5rem',
                  fontFamily: 'monospace',
                }}
              >
                Reference: {this.state.eventId}
              </p>
            )}

            {/* Retry button */}
            <button
              onClick={this.handleRetry}
              style={{
                background: 'linear-gradient(135deg, #0d9488 0%, #06b6d4 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.75rem 2rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.2s',
                marginRight: '0.75rem',
              }}
              onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.opacity = '0.85')}
              onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.opacity = '1')}
            >
              Try Again
            </button>

            {/* Reload page button */}
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'transparent',
                color: '#9ca3af',
                border: '1px solid rgba(37,47,59,1)',
                borderRadius: '8px',
                padding: '0.75rem 2rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.color = '#ffffff')}
              onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.color = '#9ca3af')}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
