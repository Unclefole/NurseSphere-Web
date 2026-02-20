'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Sparkles,
  Lock,
  Calendar,
  User,
  Building2,
  Edit,
  Send,
} from 'lucide-react'
import { format } from 'date-fns'
import type { ContractStatus } from '@/types/database'

interface ContractDetail {
  id: string
  title: string
  content: string
  status: ContractStatus
  terms: Record<string, unknown> | null
  hospital_signed: boolean
  hospital_signed_at: string | null
  hospital_signed_by: string | null
  nurse_signed: boolean
  nurse_signed_at: string | null
  spheri_generated: boolean
  spheri_optimized: boolean
  created_at: string
  updated_at: string
  expires_at: string | null
  nurse: {
    id: string
    profiles: {
      full_name: string | null
      email: string
    }
  }
  shift: {
    id: string
    title: string
    start_time: string
    end_time: string
    hourly_rate: number
  } | null
}

export default function ContractDetailPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const params = useParams()
  const contractId = params.id as string

  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
      return
    }

    if (!authLoading && user && !isHospital) {
      router.push('/nurse')
      return
    }
  }, [user, authLoading, isHospital, router])

  useEffect(() => {
    if (!user?.hospitalId || !contractId) return

    const fetchContract = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('contracts')
          .select(`
            id,
            title,
            content,
            status,
            terms,
            hospital_signed,
            hospital_signed_at,
            hospital_signed_by,
            nurse_signed,
            nurse_signed_at,
            spheri_generated,
            spheri_optimized,
            created_at,
            updated_at,
            expires_at,
            nurse:nurses!inner (
              id,
              profiles:profiles!inner (
                full_name,
                email
              )
            ),
            shift:shifts (
              id,
              title,
              start_time,
              end_time,
              hourly_rate
            )
          `)
          .eq('id', contractId)
          .eq('hospital_id', user.hospitalId)
          .single()

        if (error) {
          console.error('Error fetching contract:', error)
          router.push('/contracts')
          return
        }

        setContract(data as unknown as ContractDetail)
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchContract()
  }, [user, contractId, router])

  // Sign contract as hospital
  const handleHospitalSign = async () => {
    if (!contract || !user || contract.hospital_signed) return

    // Signed contracts are immutable - this check respects the mobile app behavior
    if (contract.status === 'signed') {
      alert('This contract is already fully signed and cannot be modified.')
      return
    }

    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = {
        hospital_signed: true,
        hospital_signed_at: new Date().toISOString(),
        hospital_signed_by: user.id,
        updated_at: new Date().toISOString(),
      }

      // If nurse has also signed, mark as fully signed
      if (contract.nurse_signed) {
        updates.status = 'signed'
      } else if (contract.status === 'draft') {
        updates.status = 'pending'
      }

      const { error } = await supabase
        .from('contracts')
        .update(updates)
        .eq('id', contract.id)

      if (error) {
        console.error('Error signing contract:', error)
        return
      }

      // Refresh contract data
      setContract({
        ...contract,
        hospital_signed: true,
        hospital_signed_at: new Date().toISOString(),
        hospital_signed_by: user.id,
        status: contract.nurse_signed ? 'signed' : (contract.status === 'draft' ? 'pending' : contract.status),
      })
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setActionLoading(false)
    }
  }

  // Send contract to nurse
  const handleSendToNurse = async () => {
    if (!contract || contract.status !== 'draft') return

    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('contracts')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', contract.id)

      if (error) {
        console.error('Error sending contract:', error)
        return
      }

      setContract({ ...contract, status: 'pending' })
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
      </div>
    )
  }

  if (!user || !isHospital || !contract) {
    return null
  }

  const isSigned = contract.status === 'signed'
  const isFullySigned = contract.hospital_signed && contract.nurse_signed
  const canEdit = contract.status === 'draft' && !contract.hospital_signed
  const canSign = !contract.hospital_signed && contract.status !== 'signed' && contract.status !== 'cancelled'

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/contracts"
              className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">{contract.title}</h1>
                {isSigned && <Lock className="h-5 w-5 text-green-400" />}
              </div>
              <p className="text-gray-400 text-sm">Contract Details</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link
                href={`/contracts/${contract.id}/edit`}
                className="ns-btn-secondary flex items-center gap-2"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Link>
            )}
            {contract.status === 'draft' && (
              <button
                onClick={handleSendToNurse}
                disabled={actionLoading}
                className="ns-btn-primary flex items-center gap-2"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send to Nurse
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Signed contract notice */}
        {isSigned && (
          <div className="mb-6 p-4 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-3">
            <Lock className="h-5 w-5 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-green-400 font-medium">Contract Signed & Locked</p>
              <p className="text-sm text-green-400/80">
                This contract was fully signed on{' '}
                {contract.nurse_signed_at && format(new Date(contract.nurse_signed_at), 'MMMM d, yyyy \'at\' h:mm a')}.
                It cannot be modified.
              </p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contract content */}
            <div className="ns-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5 text-ns-teal" />
                <h2 className="text-lg font-medium text-white">Contract Content</h2>
                {contract.spheri_generated && (
                  <span className="ns-badge bg-purple-500/20 text-purple-400 ml-auto">
                    <Sparkles className="h-3 w-3 inline mr-1" />
                    Spheri Generated
                  </span>
                )}
              </div>
              <div className="prose prose-invert prose-sm max-w-none">
                <div
                  className="text-gray-300 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: contract.content }}
                />
              </div>
            </div>

            {/* Terms */}
            {contract.terms && Object.keys(contract.terms).length > 0 && (
              <div className="ns-card p-6">
                <h2 className="text-lg font-medium text-white mb-4">Contract Terms</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {Object.entries(contract.terms).map(([key, value]) => (
                    <div key={key} className="bg-ns-dark-700 rounded-lg p-3">
                      <p className="text-xs text-gray-400 capitalize">{key.replace(/_/g, ' ')}</p>
                      <p className="text-white font-medium">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status card */}
            <div className="ns-card p-6">
              <h3 className="text-lg font-medium text-white mb-4">Status</h3>
              <div className="space-y-4">
                {/* Status badge */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Status</span>
                  <span className={`ns-badge ${
                    contract.status === 'signed' ? 'ns-badge-success' :
                    contract.status === 'pending' ? 'ns-badge-pending' :
                    contract.status === 'expired' ? 'ns-badge-warning' :
                    contract.status === 'cancelled' ? 'ns-badge-error' :
                    'ns-badge-info'
                  }`}>
                    {contract.status.charAt(0).toUpperCase() + contract.status.slice(1)}
                  </span>
                </div>

                {/* Hospital signature */}
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-gray-400">
                    <Building2 className="h-4 w-4" />
                    Hospital
                  </span>
                  {contract.hospital_signed ? (
                    <div className="text-right">
                      <span className="ns-badge-success">Signed</span>
                      {contract.hospital_signed_at && (
                        <p className="text-xs text-gray-500 mt-1">
                          {format(new Date(contract.hospital_signed_at), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500">Not signed</span>
                  )}
                </div>

                {/* Nurse signature */}
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-gray-400">
                    <User className="h-4 w-4" />
                    Nurse
                  </span>
                  {contract.nurse_signed ? (
                    <div className="text-right">
                      <span className="ns-badge-success">Signed</span>
                      {contract.nurse_signed_at && (
                        <p className="text-xs text-gray-500 mt-1">
                          {format(new Date(contract.nurse_signed_at), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500">Not signed</span>
                  )}
                </div>

                {/* Sign button */}
                {canSign && (
                  <button
                    onClick={handleHospitalSign}
                    disabled={actionLoading}
                    className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Sign as Hospital
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Parties */}
            <div className="ns-card p-6">
              <h3 className="text-lg font-medium text-white mb-4">Parties</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Nurse</p>
                  <p className="text-white font-medium">
                    {contract.nurse.profiles.full_name || 'Unknown'}
                  </p>
                  <p className="text-sm text-gray-400">{contract.nurse.profiles.email}</p>
                </div>
                {contract.shift && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Related Shift</p>
                    <p className="text-white font-medium">{contract.shift.title}</p>
                    <p className="text-sm text-gray-400">
                      {format(new Date(contract.shift.start_time), 'MMM d, yyyy')} • ${contract.shift.hourly_rate}/hr
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="ns-card p-6">
              <h3 className="text-lg font-medium text-white mb-4">Timeline</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                  <Calendar className="h-4 w-4" />
                  <span>Created {format(new Date(contract.created_at), 'MMM d, yyyy')}</span>
                </div>
                {contract.updated_at !== contract.created_at && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Clock className="h-4 w-4" />
                    <span>Updated {format(new Date(contract.updated_at), 'MMM d, yyyy')}</span>
                  </div>
                )}
                {contract.expires_at && (
                  <div className="flex items-center gap-2 text-yellow-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>Expires {format(new Date(contract.expires_at), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

