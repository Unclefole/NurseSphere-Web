'use client'

/**
 * /dashboard/invoices
 *
 * Full invoice management page for hospitals.
 * - Lists invoices with status badges
 * - Pay invoice via Stripe PaymentIntent
 * - Export to CSV
 * - Loading and empty states
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  FileText,
  DollarSign,
  Download,
  RefreshCw,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Filter,
  ChevronRight,
} from 'lucide-react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = 'paid' | 'pending' | 'failed' | 'overdue' | 'processing'

interface Invoice {
  id: string
  invoice_number: string
  total: number
  status: InvoiceStatus
  due_date: string
  created_at: string
  description?: string | null
  stripe_payment_intent_id?: string | null
}

type FilterStatus = 'all' | InvoiceStatus

// ─── Stripe loader ────────────────────────────────────────────────────────────

let stripePromise: Promise<Stripe | null> | null = null
function getStripePromise() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    stripePromise = key ? loadStripe(key) : Promise.resolve(null)
  }
  return stripePromise
}

// ─── Status helpers ───────────────────────────────────────────────────────────

interface StatusConfig {
  label: string
  textColor: string
  bgColor: string
  borderColor: string
  Icon: React.ComponentType<{ className?: string }>
}

const STATUS_MAP: Record<InvoiceStatus, StatusConfig> = {
  paid: {
    label: 'Paid',
    textColor: 'text-green-400',
    bgColor: 'bg-green-400/10',
    borderColor: 'border-green-400/30',
    Icon: CheckCircle2,
  },
  pending: {
    label: 'Pending',
    textColor: 'text-yellow-400',
    bgColor: 'bg-yellow-400/10',
    borderColor: 'border-yellow-400/30',
    Icon: Clock,
  },
  processing: {
    label: 'Processing',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    borderColor: 'border-blue-400/30',
    Icon: Loader2,
  },
  failed: {
    label: 'Failed',
    textColor: 'text-red-400',
    bgColor: 'bg-red-400/10',
    borderColor: 'border-red-400/30',
    Icon: AlertCircle,
  },
  overdue: {
    label: 'Overdue',
    textColor: 'text-red-400',
    bgColor: 'bg-red-400/10',
    borderColor: 'border-red-400/30',
    Icon: AlertCircle,
  },
}

function getEffectiveStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === 'pending' && new Date(invoice.due_date) < new Date()) {
    return 'overdue'
  }
  return invoice.status as InvoiceStatus
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.pending
  const { Icon } = cfg
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.textColor} ${cfg.bgColor} ${cfg.borderColor}`}
    >
      <Icon className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  )
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportToCSV(invoices: Invoice[]) {
  const headers = ['Invoice #', 'Description', 'Amount', 'Status', 'Due Date', 'Created']
  const rows = invoices.map((inv) => [
    inv.invoice_number,
    inv.description ?? '',
    `$${inv.total.toFixed(2)}`,
    getEffectiveStatus(inv),
    new Date(inv.due_date).toLocaleDateString(),
    new Date(inv.created_at).toLocaleDateString(),
  ])

  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    )
    .join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nursesphere-invoices-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardInvoicesPage() {
  const { user, session, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [fetchLoading, setFetchLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [paySuccess, setPaySuccess] = useState<string | null>(null)

  // Summary stats
  const totalPending = invoices
    .filter((i) => i.status === 'pending')
    .reduce((s, i) => s + i.total, 0)
  const totalPaid = invoices
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + i.total, 0)
  const totalOverdue = invoices
    .filter((i) => getEffectiveStatus(i) === 'overdue')
    .reduce((s, i) => s + i.total, 0)

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.push('/auth/signin')
    if (!authLoading && user && !isHospital) router.push('/nurse')
  }, [authLoading, user, isHospital, router])

  // Fetch invoices
  const fetchInvoices = useCallback(async () => {
    if (!session?.access_token) return
    setFetchLoading(true)
    setFetchError(null)

    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filterStatus !== 'all') params.set('status', filterStatus)

      const res = await fetch(`/api/billing/invoices?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to load invoices')
      }

      const { invoices: data } = await res.json()
      setInvoices(data ?? [])
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load invoices')
    } finally {
      setFetchLoading(false)
    }
  }, [session?.access_token, filterStatus])

  useEffect(() => {
    if (!authLoading && user && isHospital) {
      fetchInvoices()
    }
  }, [authLoading, user, isHospital, fetchInvoices])

  // Pay invoice
  const handlePayInvoice = async (invoice: Invoice) => {
    if (!session?.access_token) return
    setPayingInvoiceId(invoice.id)
    setPayError(null)
    setPaySuccess(null)

    try {
      const res = await fetch('/api/billing/pay-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ invoice_id: invoice.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? 'Payment failed')
      }

      // If requires 3DS action, handle with Stripe.js
      if (data.requires_action && data.client_secret) {
        const stripe = await getStripePromise()
        if (stripe) {
          const { error } = await stripe.handleNextAction({ clientSecret: data.client_secret })
          if (error) throw new Error(error.message ?? 'Authentication failed')
        }
      }

      setPaySuccess(`Invoice ${invoice.invoice_number} is being processed.`)
      // Refresh list
      await fetchInvoices()
    } catch (err: unknown) {
      setPayError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPayingInvoiceId(null)
    }
  }

  // Filtered view
  const displayedInvoices = invoices.filter((inv) => {
    if (filterStatus === 'all') return true
    if (filterStatus === 'overdue') return getEffectiveStatus(inv) === 'overdue'
    return inv.status === filterStatus
  })

  if (authLoading || !user || !isHospital) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <Loader2 className="h-8 w-8 text-ns-teal animate-spin" />
      </div>
    )
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-gray-400" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">Invoices</h1>
              <p className="text-gray-400 text-sm mt-0.5">
                Manage and pay your NurseSphere invoices
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => exportToCSV(invoices)}
              disabled={invoices.length === 0}
              className="ns-btn-secondary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              onClick={fetchInvoices}
              disabled={fetchLoading}
              className="ns-btn-secondary text-sm flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${fetchLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Feedback banners */}
        {paySuccess && (
          <div className="flex items-center gap-3 p-4 mb-4 rounded-lg bg-green-400/10 border border-green-400/30">
            <CheckCircle2 className="h-5 w-5 text-green-400 flex-shrink-0" />
            <p className="text-sm text-green-300">{paySuccess}</p>
          </div>
        )}
        {payError && (
          <div className="flex items-center gap-3 p-4 mb-4 rounded-lg bg-red-400/10 border border-red-400/30">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{payError}</p>
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="ns-card p-5 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-yellow-400/10">
              <Clock className="h-6 w-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Pending</p>
              <p className="text-xl font-bold text-white mt-0.5">${totalPending.toFixed(2)}</p>
            </div>
          </div>

          <div className="ns-card p-5 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-green-400/10">
              <CheckCircle2 className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Paid</p>
              <p className="text-xl font-bold text-white mt-0.5">${totalPaid.toFixed(2)}</p>
            </div>
          </div>

          <div className="ns-card p-5 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-red-400/10">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Overdue</p>
              <p className="text-xl font-bold text-white mt-0.5">${totalOverdue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Invoice table */}
        <div className="ns-card">
          {/* Toolbar */}
          <div className="flex items-center justify-between p-5 border-b border-ns-dark-600">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-400 mr-2">Filter:</span>
              {(['all', 'pending', 'paid', 'overdue', 'failed'] as FilterStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors capitalize ${
                    filterStatus === s
                      ? 'bg-ns-teal/20 border-ns-teal text-ns-teal'
                      : 'border-ns-dark-600 text-gray-400 hover:border-ns-teal/50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              {displayedInvoices.length} invoice{displayedInvoices.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Loading */}
          {fetchLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 text-ns-teal animate-spin" />
              <p className="text-gray-400 text-sm">Loading invoices…</p>
            </div>
          )}

          {/* Error */}
          {!fetchLoading && fetchError && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <p className="text-gray-300 text-sm">{fetchError}</p>
              <button
                onClick={fetchInvoices}
                className="ns-btn-secondary text-sm flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          )}

          {/* Empty */}
          {!fetchLoading && !fetchError && displayedInvoices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <FileText className="h-12 w-12 text-gray-600" />
              <p className="text-gray-300 font-medium">No invoices found</p>
              <p className="text-gray-500 text-sm">
                {filterStatus !== 'all'
                  ? `No ${filterStatus} invoices. Try a different filter.`
                  : 'Invoices will appear here after shifts are completed.'}
              </p>
              {filterStatus !== 'all' && (
                <button
                  onClick={() => setFilterStatus('all')}
                  className="ns-btn-secondary text-sm"
                >
                  Clear filter
                </button>
              )}
            </div>
          )}

          {/* Table */}
          {!fetchLoading && !fetchError && displayedInvoices.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-ns-dark-600">
                    <th className="px-5 py-3 font-medium">Invoice</th>
                    <th className="px-5 py-3 font-medium">Description</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Due Date</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ns-dark-600">
                  {displayedInvoices.map((invoice) => {
                    const effectiveStatus = getEffectiveStatus(invoice)
                    const isPaying = payingInvoiceId === invoice.id
                    const canPay = ['pending', 'overdue', 'failed'].includes(effectiveStatus)

                    return (
                      <tr
                        key={invoice.id}
                        className="hover:bg-ns-dark-700/50 transition-colors"
                      >
                        {/* Invoice number */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-gray-500 flex-shrink-0" />
                            <span className="text-sm font-mono text-white">
                              {invoice.invoice_number}
                            </span>
                          </div>
                        </td>

                        {/* Description */}
                        <td className="px-5 py-4">
                          <span className="text-sm text-gray-400 truncate max-w-[180px] block">
                            {invoice.description ?? '—'}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-4 w-4 text-gray-500" />
                            <span className="text-sm font-semibold text-white">
                              {invoice.total.toFixed(2)}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          <StatusBadge status={effectiveStatus} />
                        </td>

                        {/* Due date */}
                        <td className="px-5 py-4">
                          <span
                            className={`text-sm ${
                              effectiveStatus === 'overdue' ? 'text-red-400' : 'text-gray-400'
                            }`}
                          >
                            {new Date(invoice.due_date).toLocaleDateString()}
                          </span>
                        </td>

                        {/* Created */}
                        <td className="px-5 py-4">
                          <span className="text-sm text-gray-500">
                            {new Date(invoice.created_at).toLocaleDateString()}
                          </span>
                        </td>

                        {/* Action */}
                        <td className="px-5 py-4">
                          {canPay ? (
                            <button
                              onClick={() => handlePayInvoice(invoice)}
                              disabled={isPaying || !!payingInvoiceId}
                              className="flex items-center gap-1.5 text-xs ns-btn-primary px-3 py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isPaying ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Paying…
                                </>
                              ) : (
                                <>
                                  <CreditCard className="h-3 w-3" />
                                  Pay Now
                                </>
                              )}
                            </button>
                          ) : effectiveStatus === 'paid' ? (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Paid
                            </span>
                          ) : (
                            <button className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-300 transition-colors">
                              Details
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Table footer */}
          {!fetchLoading && !fetchError && displayedInvoices.length > 0 && (
            <div className="px-5 py-3 border-t border-ns-dark-600 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Showing {displayedInvoices.length} of {invoices.length} total invoices
              </p>
              <Link
                href="/dashboard/billing"
                className="text-xs text-ns-teal hover:text-ns-teal-light flex items-center gap-1"
              >
                Manage payment method
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
