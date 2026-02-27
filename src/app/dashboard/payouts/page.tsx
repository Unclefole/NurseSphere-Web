'use client'

/**
 * /dashboard/payouts
 *
 * Nurse payout setup page — Stripe Connect Express onboarding.
 *
 * States:
 *   not_started → "Set Up Payouts" button initiates onboarding
 *   pending     → "Check Status" button + link to continue onboarding
 *   complete    → "Payouts Active ✅" with bank account last4
 *   restricted  → Warning banner with action required
 *
 * Note: useSearchParams requires a Suspense boundary (Next.js 15 requirement).
 */
import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Clock,
  ShieldAlert,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type OnboardingStatus = 'not_started' | 'pending' | 'complete' | 'restricted'

interface StatusData {
  status: OnboardingStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements: {
    currently_due?: string[]
    eventually_due?: string[]
    disabled_reason?: string | null
  } | null
  bank_last4: string | null
}

type PageState = 'loading' | 'idle' | 'submitting' | 'error'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OnboardingStatus }) {
  const configs: Record<OnboardingStatus, { label: string; className: string }> = {
    not_started: { label: 'Not Connected', className: 'bg-gray-700 text-gray-300' },
    pending: {
      label: 'Pending Setup',
      className: 'bg-yellow-900/60 text-yellow-300 border border-yellow-600/40',
    },
    complete: {
      label: 'Active ✅',
      className: 'bg-green-900/60 text-green-300 border border-green-600/40',
    },
    restricted: {
      label: 'Restricted ⚠️',
      className: 'bg-red-900/60 text-red-300 border border-red-600/40',
    },
  }
  const { label, className } = configs[status]
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  )
}

// ─── Inner component (uses useSearchParams) ───────────────────────────────────

function PayoutsContent() {
  const { user, session, loading: authLoading, isNurse } = useAuth()
  const searchParams = useSearchParams()
  const onboardingParam = searchParams.get('onboarding')

  const [pageState, setPageState] = useState<PageState>('loading')
  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // ── Fetch current status ──────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    if (!session?.access_token) return
    setPageState('loading')
    setErrorMessage(null)

    try {
      const res = await fetch('/api/stripe/connect/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to fetch payout status')
      }
      const data: StatusData = await res.json()
      setStatusData(data)
      setPageState('idle')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load payout status'
      setErrorMessage(msg)
      setPageState('error')
    }
  }, [session?.access_token])

  // ── On mount + on return from Stripe ─────────────────────────────────────
  useEffect(() => {
    if (!authLoading && session?.access_token) {
      fetchStatus()

      // Toast when returning from Stripe
      if (onboardingParam === 'complete') {
        setToastMessage('🎉 Onboarding complete! Your payouts account is now active.')
      } else if (onboardingParam === 'incomplete') {
        setToastMessage(
          'Onboarding not yet complete. Please finish setting up your payout account.'
        )
      } else if (onboardingParam === 'error') {
        setToastMessage('Something went wrong. Please try again.')
      }
    }
  }, [authLoading, session?.access_token, onboardingParam, fetchStatus])

  // ── Start onboarding ──────────────────────────────────────────────────────
  const handleSetupPayouts = async () => {
    if (!session?.access_token) return
    setPageState('submitting')
    setErrorMessage(null)

    try {
      const res = await fetch('/api/stripe/connect/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to initiate onboarding')
      }

      const { url } = await res.json()
      if (url) {
        window.location.href = url
      } else {
        throw new Error('No onboarding URL returned')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start onboarding'
      setErrorMessage(msg)
      setPageState('idle')
    }
  }

  // ── Auth / role guards ────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 text-ns-teal animate-spin" />
      </div>
    )
  }

  if (!isNurse && user) {
    return (
      <div className="ns-card p-8 text-center">
        <ShieldAlert className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Nurses Only</h2>
        <p className="text-gray-400 text-sm">
          The payouts section is for nurses. Facilities manage billing via the Billing page.
        </p>
        <Link href="/dashboard/billing" className="ns-btn-primary mt-4 inline-block">
          Go to Billing
        </Link>
      </div>
    )
  }

  const status = statusData?.status ?? 'not_started'

  return (
    <div className="space-y-4">
      {/* Toast / return message */}
      {toastMessage && (
        <div
          className={`p-4 rounded-lg border text-sm flex items-start gap-3 ${
            onboardingParam === 'complete'
              ? 'bg-green-900/30 border-green-600/40 text-green-300'
              : 'bg-yellow-900/30 border-yellow-600/40 text-yellow-300'
          }`}
        >
          {onboardingParam === 'complete' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          )}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="p-4 rounded-lg border border-red-600/40 bg-red-900/20 text-red-300 text-sm flex items-start gap-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {pageState === 'loading' && !statusData && (
        <div className="ns-card p-8 space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-ns-dark-600 rounded" />
          <div className="h-4 w-60 bg-ns-dark-700 rounded" />
          <div className="h-10 w-32 bg-ns-dark-600 rounded-lg mt-4" />
        </div>
      )}

      {/* Status card */}
      {statusData && (
        <>
          <div className="ns-card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-white mb-1">Payout Account Status</h2>
                <p className="text-gray-400 text-xs">Powered by Stripe Connect</p>
              </div>
              <StatusBadge status={status} />
            </div>

            {/* Complete state */}
            {status === 'complete' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Payouts Active — you will receive payments after completed shifts</span>
                </div>
                {statusData.bank_last4 && (
                  <div className="flex items-center gap-3 bg-ns-dark-700 rounded-lg px-4 py-3 border border-ns-dark-600">
                    <Banknote className="h-5 w-5 text-ns-teal" />
                    <div>
                      <p className="text-white text-sm font-medium">Bank Account</p>
                      <p className="text-gray-400 text-xs">
                        Ending in •••• {statusData.bank_last4}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 text-gray-400 text-xs">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span>Charges enabled: Yes</span>
                  <CheckCircle2 className="h-3 w-3 text-green-500 ml-2" />
                  <span>Payouts enabled: Yes</span>
                </div>
              </div>
            )}

            {/* Pending state */}
            {status === 'pending' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <Clock className="h-4 w-4" />
                  <span>Your account setup is incomplete. Click below to continue.</span>
                </div>
                {statusData.requirements?.currently_due &&
                  statusData.requirements.currently_due.length > 0 && (
                    <div className="bg-ns-dark-700 rounded-lg p-3 border border-yellow-600/20">
                      <p className="text-yellow-300 text-xs font-medium mb-1">
                        Required information:
                      </p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {statusData.requirements.currently_due.map((req) => (
                          <li key={req} className="text-gray-400 text-xs">
                            {req.replace(/_/g, ' ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            )}

            {/* Restricted state */}
            {status === 'restricted' && (
              <div className="mt-4 p-3 rounded-lg bg-red-900/20 border border-red-600/30">
                <p className="text-red-300 text-sm font-medium mb-1">⚠️ Account Restricted</p>
                <p className="text-gray-400 text-xs">
                  {statusData.requirements?.disabled_reason
                    ? `Reason: ${statusData.requirements.disabled_reason}`
                    : 'Please contact support or re-initiate onboarding to resolve.'}
                </p>
              </div>
            )}

            {/* Not started state */}
            {status === 'not_started' && (
              <div className="mt-4">
                <p className="text-gray-400 text-sm">
                  Connect your bank account to receive automatic payouts after each completed shift.
                  NurseSphere uses Stripe Connect for secure, compliant payouts.
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-6 flex flex-wrap gap-3">
              {status !== 'complete' && (
                <button
                  onClick={handleSetupPayouts}
                  disabled={pageState === 'submitting'}
                  className="ns-btn-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {pageState === 'submitting' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Redirecting to Stripe…
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" />
                      {status === 'not_started' ? 'Set Up Payouts' : 'Continue Setup'}
                    </>
                  )}
                </button>
              )}

              <button
                onClick={fetchStatus}
                disabled={pageState === 'loading' || pageState === 'submitting'}
                className="ns-btn-secondary flex items-center gap-2 disabled:opacity-60"
              >
                {pageState === 'loading' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Check Status
              </button>
            </div>
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="ns-card p-4">
              <Banknote className="h-5 w-5 text-ns-teal mb-2" />
              <p className="text-sm font-medium text-white">Automatic Payouts</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Funds transferred within 2 business days after shift completion
              </p>
            </div>
            <div className="ns-card p-4">
              <CheckCircle2 className="h-5 w-5 text-ns-teal mb-2" />
              <p className="text-sm font-medium text-white">Secure &amp; Compliant</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Bank-grade encryption via Stripe. NurseSphere never stores account details.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Page shell (Suspense wrapper required for useSearchParams) ───────────────

export default function PayoutsPage() {
  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-400" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Payout Setup</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Connect your bank account to receive shift payments
            </p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 text-ns-teal animate-spin" />
            </div>
          }
        >
          <PayoutsContent />
        </Suspense>
      </div>
    </DashboardLayout>
  )
}
