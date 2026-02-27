'use client'

/**
 * /dashboard/billing
 *
 * Hospital billing page — Stripe Elements payment method collection.
 * Uses SetupIntent flow: creates intent on the server, mounts Stripe Elements,
 * confirms the setup, then attaches the payment method to the hospital profile.
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripeCardElement,
} from '@stripe/stripe-js'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  CreditCard,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  RefreshCw,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type PageState = 'loading' | 'idle' | 'submitting' | 'success' | 'error'

interface SavedPaymentMethod {
  id: string
  card: {
    brand: string
    last4: string
    exp_month: number
    exp_year: number
  }
}

// ─── Stripe loader (singleton) ────────────────────────────────────────────────

let stripePromise: Promise<Stripe | null> | null = null

function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!key) {
      console.error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set')
      return Promise.resolve(null)
    }
    stripePromise = loadStripe(key)
  }
  return stripePromise
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cardBrandLabel(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    diners: 'Diners Club',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  }
  return brands[brand?.toLowerCase()] ?? brand?.toUpperCase() ?? 'Card'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardBillingPage() {
  const { user, session, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()

  const [pageState, setPageState] = useState<PageState>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [savedPaymentMethod, setSavedPaymentMethod] = useState<SavedPaymentMethod | null>(null)
  const [stripeReady, setStripeReady] = useState(false)

  // Stripe internals — we manage Elements manually (no @stripe/react-stripe-js)
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null)
  const [elementsInstance, setElementsInstance] = useState<StripeElements | null>(null)
  const [cardElement, setCardElement] = useState<StripeCardElement | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null)

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push('/auth/signin')
    if (!authLoading && user && !isHospital) router.push('/nurse')
  }, [authLoading, user, isHospital, router])

  // ── Initialize Stripe + fetch SetupIntent ──────────────────────────────────
  const initializeStripe = useCallback(async () => {
    if (!user?.facilityId || !session?.access_token) return
    setPageState('loading')
    setErrorMessage(null)

    try {
      // Load Stripe.js
      const stripe = await getStripePromise()
      if (!stripe) throw new Error('Failed to load Stripe.js')
      setStripeInstance(stripe)

      // Create SetupIntent on server
      const res = await fetch('/api/billing/setup-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to create setup intent')
      }

      const { client_secret, setup_intent_id } = await res.json()
      setClientSecret(client_secret)
      setSetupIntentId(setup_intent_id)

      // Mount Stripe Elements
      const elements = stripe.elements({ clientSecret: client_secret })
      setElementsInstance(elements)

      const card = elements.create('card', {
        style: {
          base: {
            color: '#ffffff',
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#6b7280' },
            iconColor: '#0d9488',
          },
          invalid: { color: '#f87171', iconColor: '#f87171' },
        },
        hidePostalCode: false,
      })

      // Wait for DOM mount
      setTimeout(() => {
        const mountEl = document.getElementById('stripe-card-element')
        if (mountEl && !mountEl.childElementCount) {
          card.mount('#stripe-card-element')
          setCardElement(card)
          setStripeReady(true)
        }
      }, 100)

      setPageState('idle')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Initialization failed'
      setErrorMessage(msg)
      setPageState('error')
    }
  }, [user?.facilityId, session?.access_token])

  useEffect(() => {
    if (!authLoading && user && isHospital) {
      initializeStripe()
    }
    return () => {
      // Cleanup card element on unmount
      cardElement?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, isHospital])

  // ── Submit payment method ──────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripeInstance || !cardElement || !clientSecret || !session?.access_token) return

    setPageState('submitting')
    setErrorMessage(null)

    try {
      // Confirm setup intent with card element
      const { setupIntent, error: stripeError } = await stripeInstance.confirmCardSetup(
        clientSecret,
        { payment_method: { card: cardElement } }
      )

      if (stripeError) {
        throw new Error(stripeError.message ?? 'Card setup failed')
      }

      if (!setupIntent?.payment_method) {
        throw new Error('No payment method returned from Stripe')
      }

      const pmId =
        typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method.id

      // Attach to hospital profile
      const attachRes = await fetch('/api/billing/attach-payment-method', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          payment_method_id: pmId,
          setup_intent_id: setupIntentId,
        }),
      })

      if (!attachRes.ok) {
        const err = await attachRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to save payment method')
      }

      // Show saved card details from setupIntent
      const pm = setupIntent.payment_method
      if (typeof pm !== 'string' && pm.card) {
        setSavedPaymentMethod({
          id: pm.id,
          card: {
            brand: pm.card.brand,
            last4: pm.card.last4,
            exp_month: pm.card.exp_month,
            exp_year: pm.card.exp_year,
          },
        })
      }

      setSuccessMessage('Payment method saved successfully.')
      setPageState('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Submission failed'
      setErrorMessage(msg)
      setPageState('idle')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || !user || !isHospital) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <Loader2 className="h-8 w-8 text-ns-teal animate-spin" />
      </div>
    )
  }

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
            <h1 className="text-2xl font-bold text-white">Payment Method</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Securely add a card for automatic billing
            </p>
          </div>
        </div>

        {/* Success state */}
        {pageState === 'success' && (
          <div className="ns-card border-green-500/40 mb-6">
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <h2 className="text-lg font-semibold text-white">Payment Method Saved</h2>
              <p className="text-gray-400 text-sm">{successMessage}</p>

              {savedPaymentMethod && (
                <div className="flex items-center gap-3 mt-2 bg-ns-dark-700 rounded-lg px-5 py-3 border border-ns-dark-600">
                  <CreditCard className="h-5 w-5 text-ns-teal" />
                  <div className="text-left">
                    <p className="text-white text-sm font-medium">
                      {cardBrandLabel(savedPaymentMethod.card.brand)} •••• {savedPaymentMethod.card.last4}
                    </p>
                    <p className="text-gray-400 text-xs">
                      Expires {String(savedPaymentMethod.card.exp_month).padStart(2, '0')}/
                      {savedPaymentMethod.card.exp_year}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-2">
                <Link href="/dashboard" className="ns-btn-secondary text-sm px-5 py-2.5">
                  Back to Dashboard
                </Link>
                <Link href="/dashboard/invoices" className="ns-btn-primary text-sm px-5 py-2.5">
                  View Invoices
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Error loading state */}
        {pageState === 'error' && (
          <div className="ns-card border-red-500/40 mb-6">
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <h2 className="text-base font-semibold text-white">Failed to load payment form</h2>
              <p className="text-gray-400 text-sm">{errorMessage}</p>
              <button
                onClick={initializeStripe}
                className="ns-btn-secondary text-sm flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Payment form */}
        {pageState !== 'success' && pageState !== 'error' && (
          <div className="ns-card">
            <div className="p-6">
              {/* Form header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-ns-teal/10 rounded-lg">
                  <CreditCard className="h-5 w-5 text-ns-teal" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Add Payment Card</h2>
                  <p className="text-gray-400 text-xs mt-0.5">
                    Card details are encrypted and processed by Stripe
                  </p>
                </div>
              </div>

              {/* Loading skeleton */}
              {(pageState === 'loading' || !stripeReady) && (
                <div className="space-y-4">
                  <div>
                    <div className="h-4 w-24 bg-ns-dark-600 rounded animate-pulse mb-2" />
                    <div className="h-12 bg-ns-dark-700 border border-ns-dark-600 rounded-lg animate-pulse" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="h-4 w-20 bg-ns-dark-600 rounded animate-pulse mb-2" />
                      <div className="h-12 bg-ns-dark-700 border border-ns-dark-600 rounded-lg animate-pulse" />
                    </div>
                    <div>
                      <div className="h-4 w-12 bg-ns-dark-600 rounded animate-pulse mb-2" />
                      <div className="h-12 bg-ns-dark-700 border border-ns-dark-600 rounded-lg animate-pulse" />
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className={stripeReady ? 'block' : 'hidden'}>
                {/* Stripe Card Element mount point */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Card Information
                  </label>
                  <div
                    id="stripe-card-element"
                    className="bg-ns-dark-700 border border-ns-dark-600 rounded-lg px-4 py-3.5 focus-within:border-ns-teal transition-colors min-h-[48px]"
                  />
                  {errorMessage && pageState === 'idle' && (
                    <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      {errorMessage}
                    </p>
                  )}
                </div>

                {/* Security note */}
                <div className="flex items-start gap-2 mb-6 p-3 rounded-lg bg-ns-dark-700 border border-ns-dark-600">
                  <Shield className="h-4 w-4 text-ns-teal flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-400">
                    Your card details are encrypted using industry-standard TLS and processed
                    directly by{' '}
                    <span className="text-ns-teal font-medium">Stripe</span>. NurseSphere never
                    stores raw card numbers.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={pageState === 'submitting' || !stripeReady}
                  className="w-full ns-btn-primary flex items-center justify-center gap-2 py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {pageState === 'submitting' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving card…
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" />
                      Save Payment Method
                    </>
                  )}
                </button>
              </form>

              {/* PCI badge */}
              <p className="text-center text-xs text-gray-500 mt-4">
                🔒 Secured by Stripe · PCI DSS Level 1
              </p>
            </div>
          </div>
        )}

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="ns-card p-4 flex items-start gap-3">
            <Shield className="h-5 w-5 text-ns-teal flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-white">HIPAA Compliant</p>
              <p className="text-xs text-gray-400 mt-0.5">Encrypted at rest & in transit</p>
            </div>
          </div>
          <div className="ns-card p-4 flex items-start gap-3">
            <CreditCard className="h-5 w-5 text-ns-teal flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-white">Automatic Billing</p>
              <p className="text-xs text-gray-400 mt-0.5">Invoiced after each shift</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
