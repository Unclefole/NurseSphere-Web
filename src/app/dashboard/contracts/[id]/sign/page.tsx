'use client'

/**
 * /dashboard/contracts/[id]/sign
 *
 * Nurse-facing (and admin-facing) contract signing page.
 * Shows the contract document content with a signature agreement checkbox.
 *
 * Query params:
 *   role  - 'nurse' | 'admin' (defaults to 'nurse')
 *   token - signature request token (for display/validation)
 */

import { useState, useEffect, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import {
  CheckCircle2,
  Loader2,
  FileText,
  AlertCircle,
  ArrowLeft,
  Shield,
} from 'lucide-react'

interface PageProps {
  params: Promise<{ id: string }>
}

interface ContractData {
  id: string
  title: string
  content: string
  status: string
  pdf_url: string | null
  nurse_signed_at: string | null
  admin_signed_at: string | null
  facility?: { name: string }
}

export default function SignContractPage({ params }: PageProps) {
  const { id: contractId } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const role = (searchParams.get('role') ?? 'nurse') as 'nurse' | 'admin'

  const [contract, setContract] = useState<ContractData | null>(null)
  const [fetching, setFetching] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/auth/signin?redirect=/dashboard/contracts/${contractId}/sign?role=${role}`)
    }
  }, [user, authLoading, contractId, role, router])

  // Fetch contract
  useEffect(() => {
    if (!user) return
    const fetchContract = async () => {
      try {
        const res = await fetch(`/api/contracts/${contractId}`)
        if (!res.ok) {
          const j = await res.json()
          throw new Error(j.error ?? 'Contract not found')
        }
        const j = await res.json()
        setContract(j.contract ?? j)
      } catch (e: unknown) {
        setFetchError(e instanceof Error ? e.message : 'Failed to load contract')
      } finally {
        setFetching(false)
      }
    }
    fetchContract()
  }, [user, contractId])

  const handleSign = async () => {
    if (!agreed) return
    setSigning(true)
    setSignError(null)
    try {
      const res = await fetch(`/api/contracts/${contractId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to sign contract')
      setSigned(true)
    } catch (e: unknown) {
      setSignError(e instanceof Error ? e.message : 'Signing failed')
    } finally {
      setSigning(false)
    }
  }

  if (authLoading || (fetching && user)) {
    return (
      <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Error Loading Contract</h1>
          <p className="text-slate-400 mb-6">{fetchError}</p>
          <Link href="/dashboard" className="text-indigo-400 hover:underline">
            ← Return to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // Already signed
  const alreadySigned =
    role === 'nurse' ? !!contract?.nurse_signed_at : !!contract?.admin_signed_at

  return (
    <div className="min-h-screen bg-[#0f0f23] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#1a1a2e] border-b border-slate-700/50 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-semibold text-white text-sm">{contract?.title ?? 'Contract Review'}</h1>
              <p className="text-slate-400 text-xs">
                Signing as: <span className="text-indigo-400 capitalize">{role}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Shield className="w-4 h-4 text-indigo-400" />
            Secured by NurseSphere
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Success State */}
        {(signed || alreadySigned) && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">
              {alreadySigned && !signed ? 'Already Signed ✅' : 'Contract Signed ✅'}
            </h2>
            <p className="text-slate-400 mb-8">
              {alreadySigned && !signed
                ? 'You have already signed this contract.'
                : 'Your signature has been recorded successfully.'}
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700
                text-white rounded-lg font-medium transition-colors"
            >
              Return to Dashboard
            </Link>
          </div>
        )}

        {/* Signing UI */}
        {!signed && !alreadySigned && contract && (
          <>
            {/* Contract Document */}
            <div className="bg-white text-gray-900 rounded-xl shadow-2xl mb-8 overflow-hidden">
              {contract.pdf_url ? (
                // Show PDF URL as embed if it's a real URL
                contract.pdf_url.startsWith('data:') ? (
                  <iframe
                    srcDoc={atob(contract.pdf_url.replace('data:text/html;base64,', ''))}
                    className="w-full h-[600px] border-0"
                    title="Contract Document"
                  />
                ) : (
                  <iframe
                    src={contract.pdf_url}
                    className="w-full h-[600px] border-0"
                    title="Contract Document"
                  />
                )
              ) : (
                <div className="p-8">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200">
                    <FileText className="w-6 h-6 text-indigo-600" />
                    <h2 className="text-xl font-bold text-gray-900">{contract.title}</h2>
                  </div>
                  <div
                    className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: contract.content ?? '<p>Contract content not available.</p>' }}
                  />
                </div>
              )}
            </div>

            {/* Signature Panel */}
            <div className="bg-[#1a1a2e] border border-slate-700/50 rounded-xl p-6">
              <h3 className="font-semibold text-white mb-4">Electronic Signature Agreement</h3>

              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4 mb-5 text-sm text-slate-300">
                <p>
                  By checking the box below, you agree that your electronic signature constitutes
                  a legally binding signature equivalent to a handwritten signature, in accordance
                  with the Electronic Signatures in Global and National Commerce (ESIGN) Act and
                  applicable state laws.
                </p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer mb-6 group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`w-5 h-5 rounded border-2 transition-all flex items-center justify-center
                      ${agreed
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'border-slate-500 group-hover:border-indigo-400'
                      }`}
                  >
                    {agreed && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm text-slate-300 leading-relaxed">
                  I have read and agree to all the terms and conditions of this contract.
                  I understand that this electronic signature is legally binding.
                </span>
              </label>

              {signError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 mb-4 text-sm">
                  {signError}
                </div>
              )}

              <div className="flex gap-4">
                <Link
                  href="/dashboard"
                  className="flex-1 px-4 py-3 rounded-lg border border-slate-600 text-slate-300
                    hover:bg-slate-700 transition-colors text-center text-sm"
                >
                  Review Later
                </Link>
                <button
                  onClick={handleSign}
                  disabled={!agreed || signing}
                  className="flex-2 flex-1 px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700
                    text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2 text-sm"
                >
                  {signing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Sign Contract
                    </>
                  )}
                </button>
              </div>

              <p className="text-xs text-slate-500 text-center mt-4">
                Signed by {user?.email} • {new Date().toLocaleDateString()}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
