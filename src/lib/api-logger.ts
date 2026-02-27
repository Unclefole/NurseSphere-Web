/**
 * API Error Logging Wrapper
 * Wraps Next.js API route handlers to:
 *  - Add a unique request ID to every response
 *  - Catch unhandled errors and report to Sentry
 *  - Log errors to the audit_logs table (without PHI)
 *  - Sanitize any PHI before persisting/sending logs
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';

// Use native crypto.randomUUID — available in Node.js ≥14.17 and all modern browsers
const uuidv4 = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ─── PHI field names to scrub from log payloads ───────────────────────────────
const PHI_FIELDS = new Set([
  'name', 'firstName', 'lastName', 'first_name', 'last_name',
  'email', 'phone', 'phoneNumber', 'phone_number',
  'dob', 'dateOfBirth', 'date_of_birth',
  'ssn', 'socialSecurityNumber',
  'mrn', 'medicalRecordNumber', 'medical_record_number',
  'address', 'street', 'city', 'zip', 'postalCode',
  'diagnosis', 'medication', 'allergy',
  'notes', 'comments',
  'password', 'token', 'secret', 'apiKey', 'api_key',
]);

type PlainObject = Record<string, unknown>;

/**
 * Recursively scrub PHI fields from an object.
 * Mutates a deep-cloned copy only.
 */
function sanitizePHI(data: unknown, depth = 0): unknown {
  if (depth > 10 || data === null || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePHI(item, depth + 1));
  }

  const obj = data as PlainObject;
  const sanitized: PlainObject = {};

  for (const [key, value] of Object.entries(obj)) {
    if (PHI_FIELDS.has(key.toLowerCase()) || PHI_FIELDS.has(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePHI(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

type ApiHandler = (
  req: NextRequest,
  context?: { params?: Record<string, string> }
) => Promise<NextResponse> | NextResponse;

/**
 * Lazily create a Supabase admin client for server-side audit logging.
 * Falls back gracefully if env vars are missing.
 */
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function writeAuditLog(
  requestId: string,
  method: string,
  pathname: string,
  statusCode: number,
  errorMessage?: string
) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return;

    await supabase.from('audit_logs').insert({
      id: uuidv4(),
      request_id: requestId,
      action: `API_${method}`,
      resource: pathname,
      status_code: statusCode,
      error_message: errorMessage ? errorMessage.slice(0, 500) : null,
      metadata: sanitizePHI({ pathname, method, statusCode }),
      created_at: new Date().toISOString(),
    });
  } catch {
    // Never let audit logging break the response
    console.warn('[api-logger] Failed to write audit log');
  }
}

/**
 * Wraps an App Router API handler with:
 *  - Request ID injection
 *  - Sentry error capture
 *  - Audit log on error
 */
export function withApiLogging(handler: ApiHandler): ApiHandler {
  return async (req, context) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    const method = req.method ?? 'UNKNOWN';
    const pathname = new URL(req.url).pathname;

    try {
      const response = await handler(req, context);

      // Clone to inject headers (NextResponse headers are immutable after creation)
      const headers = new Headers(response.headers);
      headers.set('X-Request-Id', requestId);
      headers.set('X-Response-Time', `${Date.now() - startTime}ms`);

      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Report to Sentry with request context (no PHI in extras)
      Sentry.captureException(err, {
        tags: {
          request_id: requestId,
          api_method: method,
          api_pathname: pathname,
        },
        extra: {
          requestId,
          method,
          pathname,
          // Never log body/params — may contain PHI
        },
      });

      // Audit log the failure
      await writeAuditLog(requestId, method, pathname, 500, err.message);

      // Generic error response — never expose internal details
      return new NextResponse(
        JSON.stringify({
          error: 'Internal server error',
          requestId,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
            'X-Response-Time': `${Date.now() - startTime}ms`,
          },
        }
      );
    }
  };
}
