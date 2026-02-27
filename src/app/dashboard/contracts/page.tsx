'use client'

/**
 * /dashboard/contracts
 *
 * Admin contract management page.
 * Lists all contracts for the facility with full e-signature workflow.
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  FileText,
  Send,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  X,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ContractStatus = 'draft' | 'pending' | 'pending_signature' | 'executed' | 'voided' | 'signed' | 'expired' | 'cancelled'

interface ContractRow {
  id: string
  title: string
  status: ContractStatus
  pdf_url: string | null
  signature_request_id: string | null
  nurse_signed_at: string | null
  admin_signed_at: string | null
  voided_at: string | null
  voided_reason: string | null
  nurse_signing_url: string | null
  admin_signing_url: string | null
  created_at: string
  nurse_id: string
  nurse?: { profiles?: { full_name: string | null; email: string } }
  shift?: { title: string; start_time: string } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StatusConfig {
  label: string
  textColor: string
  bgColor: string
  borderColor: string
  Icon: React.ComponentType<{ className?: string }>
}

function fmt(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_MAP: Record<string, StatusConfig> = {
  draft: {
    label: 'Draft',
    textColor: 'text-slate-300',
    bgColor: 'bg-slate-700/40',
    borderColor: 'border-slate-600/40',
    Icon: FileText,
  },
  pending: {
    label: 'Pending',
    textColor: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    Icon: Clock,
  },
  pending_signature: {
    label: 'Awaiting Signatures',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    Icon: Send,
  },
  executed: {
    label: 'Executed',
    textColor: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    Icon: CheckCircle2,
  },
  signed: {
    label: 'Signed',
    textColor: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    Icon: CheckCircle2,
  },
  voided: {
    label: 'Voided',
    textColor: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    Icon: XCircle,
  },
  expired: {
    label: 'Expired',
    textColor: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    Icon: AlertCircle,
  },
  cancelled: {
    label: 'Cancelled',
    textColor: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    Icon: XCircle,
  },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? {
    label: status,
    textColor: 'text-slate-300',
    bgColor: 'bg-slate-700/40',
    borderColor: 'border-slate-600/40',
    Icon: FileText,
  }
  const { Icon } = cfg
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border
        ${cfg.textColor} ${cfg.bgColor} ${cfg.borderColor}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  )
}

// ─── Void Modal ───────────────────────────────────────────────────────────────

interface VoidModalProps {
  contractId: string
  contractTitle: string
  onClose: () => void
  onVoided: () => void
}

function VoidModal({ contractId, contractTitle, onClose, onVoided }: VoidModalProps) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleVoid = async () => {
    if (!reason.trim()) {
      setError('Please provide a reason for voiding this contract.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/contracts/${contractId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? 'Failed to void contract')
      }
      onVoided()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a2e] border border-red-500/30 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-red-400">Void Contract</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-300 mb-4">
          You are about to void <strong className="text-white">{contractTitle}</strong>.
          This action cannot be undone.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for voiding (required)"
          rows={3}
          className="w-full bg-[#0f0f23] border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
            placeholder:text-slate-500 focus:outline-none focus:border-red-500 resize-none mb-4"
        />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300
              hover:bg-slate-700 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleVoid}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white
              transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Void Contract
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardContractsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()

  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({}) // contractId → action
  const [voidTarget, setVoidTarget] = useState<ContractRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && (!user || !isHospital)) {
      router.push('/auth/signin')
    }
  }, [user, authLoading, isHospital, router])

  const fetchContracts = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const res = await fetch('/api/contracts')
      if (!res.ok) throw new Error('Failed to load contracts')
      const j = await res.json()
      setContracts(j.contracts ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error loading contracts')
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    if (user && isHospital) fetchContracts()
  }, [user, isHospital, fetchContracts])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function handleGeneratePdf(contract: ContractRow) {
    setActionLoading((p) => ({ ...p, [contract.id]: 'pdf' }))
    try {
      const res = await fetch(`/api/contracts/${contract.id}/generate-pdf`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to generate PDF')
      showToast('Document generated successfully!')
      fetchContracts()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Error generating PDF')
    } finally {
      setActionLoading((p) => { const n = { ...p }; delete n[contract.id]; return n })
    }
  }

  async function handleRequestSignature(contract: ContractRow) {
    setActionLoading((p) => ({ ...p, [contract.id]: 'sig' }))
    try {
      const res = await fetch(`/api/contracts/${contract.id}/request-signature`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to request signatures')
      showToast('Signature request created! Signing links generated.')
      fetchContracts()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Error requesting signature')
    } finally {
      setActionLoading((p) => { const n = { ...p }; delete n[contract.id]; return n })
    }
  }

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-600 text-white px-4 py-3 rounded-lg shadow-lg
          text-sm max-w-sm animate-pulse">
          {toast}
        </div>
      )}

      {/* Void Modal */}
      {voidTarget && (
        <VoidModal
          contractId={voidTarget.id}
          contractTitle={voidTarget.title}
          onClose={() => setVoidTarget(null)}
          onVoided={() => { setVoidTarget(null); fetchContracts(); showToast('Contract voided.') }}
        />
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Contracts</h1>
            <p className="text-slate-400 text-sm mt-1">
              Manage facility contracts and e-signatures
            </p>
          </div>
          <button
            onClick={fetchContracts}
            disabled={fetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-600
              text-slate-300 hover:bg-slate-700 transition-colors text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {fetching && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        )}

        {/* Empty */}
        {!fetching && contracts.length === 0 && (
          <div className="text-center py-20 border border-slate-700/50 rounded-xl bg-slate-800/20">
            <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 font-medium">No contracts yet</p>
            <p className="text-slate-500 text-sm mt-1">Contracts will appear here once created.</p>
          </div>
        )}

        {/* Table */}
        {!fetching && contracts.length > 0 && (
          <div className="bg-[#1a1a2e] border border-slate-700/50 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 text-left">
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Contract
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Nurse
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Nurse Signed
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Admin Signed
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {contracts.map((contract) => {
                  const isLoading = !!actionLoading[contract.id]
                  const action = actionLoading[contract.id]
                  const isVoidable = !['executed', 'voided', 'cancelled'].includes(contract.status)
                  const canRequestSig = ['draft', 'pending', 'pending_signature'].includes(contract.status)
                  const nurseName = contract.nurse?.profiles?.full_name ?? 'Unknown Nurse'

                  return (
                    <tr key={contract.id} className="hover:bg-slate-700/20 transition-colors">
                      {/* Contract */}
                      <td className="px-4 py-4">
                        <Link
                          href={`/contracts/${contract.id}`}
                          className="text-white font-medium text-sm hover:text-indigo-400 transition-colors"
                        >
                          {contract.title}
                        </Link>
                        <p className="text-slate-500 text-xs mt-0.5">{fmt(contract.created_at)}</p>
                      </td>

                      {/* Nurse */}
                      <td className="px-4 py-4">
                        <span className="text-slate-300 text-sm">{nurseName}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <StatusBadge status={contract.status} />
                        {contract.voided_reason && (
                          <p className="text-slate-500 text-xs mt-1 max-w-xs truncate" title={contract.voided_reason}>
                            {contract.voided_reason}
                          </p>
                        )}
                      </td>

                      {/* Nurse Signed */}
                      <td className="px-4 py-4 text-sm">
                        {contract.nurse_signed_at ? (
                          <span className="text-green-400">{fmt(contract.nurse_signed_at)}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                        {contract.nurse_signing_url && !contract.nurse_signed_at && (
                          <a
                            href={contract.nurse_signing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-indigo-400 hover:underline mt-0.5"
                          >
                            Copy link ↗
                          </a>
                        )}
                      </td>

                      {/* Admin Signed */}
                      <td className="px-4 py-4 text-sm">
                        {contract.admin_signed_at ? (
                          <span className="text-green-400">{fmt(contract.admin_signed_at)}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                        {contract.admin_signing_url && !contract.admin_signed_at && (
                          <a
                            href={contract.admin_signing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-indigo-400 hover:underline mt-0.5"
                          >
                            Sign now ↗
                          </a>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Generate PDF */}
                          {contract.status !== 'voided' && (
                            <button
                              onClick={() => handleGeneratePdf(contract)}
                              disabled={isLoading}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40
                                text-indigo-400 border border-indigo-500/30 text-xs transition-colors
                                disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isLoading && action === 'pdf' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                              {contract.pdf_url ? 'Regenerate' : 'Generate PDF'}
                            </button>
                          )}

                          {/* View Document */}
                          {contract.pdf_url && (
                            <a
                              href={contract.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700/40 hover:bg-slate-700
                                text-slate-300 border border-slate-600/40 text-xs transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View Doc
                            </a>
                          )}

                          {/* Send for Signature */}
                          {canRequestSig && (
                            <button
                              onClick={() => handleRequestSignature(contract)}
                              disabled={isLoading}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/40
                                text-blue-400 border border-blue-500/30 text-xs transition-colors
                                disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isLoading && action === 'sig' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              Send for Sig
                            </button>
                          )}

                          {/* Void */}
                          {isVoidable && (
                            <button
                              onClick={() => setVoidTarget(contract)}
                              disabled={isLoading}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/10 hover:bg-red-600/20
                                text-red-400 border border-red-500/20 text-xs transition-colors
                                disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
