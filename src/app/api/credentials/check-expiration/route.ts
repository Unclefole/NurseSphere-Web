/**
 * GET /api/credentials/check-expiration
 * Cron/scheduled endpoint — runs expiration checks and returns a summary.
 * Protected by CRON_SECRET header. Safe to call from Vercel Cron, GitHub Actions, etc.
 *
 * Status transitions applied:
 *   expired_at < now           → status = 'expired'
 *   1–7 days until expiry      → status = 'expiring_critical'
 *   8–30 days until expiry     → status = 'expiring_soon'
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  checkExpiringCredentials,
  flagExpiredCredentials,
  type ExpirationCheckResult,
} from '@/lib/credentials/expiration-checker'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Validate cron secret to prevent unauthorized triggering
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const startedAt = new Date().toISOString()

  try {
    // Step 1: Flag already-expired credentials
    const expiredResult: ExpirationCheckResult = await flagExpiredCredentials()

    // Step 2: Flag credentials expiring within 30 days (includes critical 7-day window)
    const expiringResult: ExpirationCheckResult = await checkExpiringCredentials(30)

    const summary = {
      status: 'ok',
      startedAt,
      completedAt: new Date().toISOString(),
      actions: {
        expired: {
          checked: expiredResult.checked,
          flagged: expiredResult.flaggedExpired,
          errors: expiredResult.errors,
        },
        expiring: {
          checked: expiringResult.checked,
          flaggedExpiringSoon: expiringResult.flaggedExpiringSoon,     // 8–30 days
          flaggedExpiringCritical: expiringResult.flaggedExpiringCritical, // 1–7 days
          errors: expiringResult.errors,
        },
      },
      totals: {
        credentialsChecked: expiredResult.checked + expiringResult.checked,
        totalFlagged:
          expiredResult.flaggedExpired +
          expiringResult.flaggedExpiringSoon +
          expiringResult.flaggedExpiringCritical,
        totalErrors: expiredResult.errors.length + expiringResult.errors.length,
      },
    }

    const hasErrors = summary.totals.totalErrors > 0
    return NextResponse.json(summary, { status: hasErrors ? 207 : 200 })
  } catch (error) {
    console.error('[check-expiration] Unhandled error:', error)
    return NextResponse.json(
      {
        status: 'error',
        startedAt,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
