'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  Search,
  Filter,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
  Loader2,
  Sparkles,
  Lock,
} from 'lucide-react'
import { format } from 'date-fns'
import type { ContractStatus } from '@/types/database'

interface ContractWithDetails {
  id: string
  title: string
  status: ContractStatus
  hospital_signed: boolean
  hospital_signed_at: string | null
  nurse_signed: boolean
  nurse_signed_at: string | null
  spheri_generated: boolean
  spheri_optimized: boolean
  created_at: string
  expires_at: string | null
  nurse: {
    profiles: {
      full_name: string | null
      email: string
    }
  }
  shift: {
    title: string
    start_time: string
  } | null
}

const statusConfig: Record<ContractStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'ns-badge-info', icon: FileText },
  pending: { label: 'Pending Signature', color: 'ns-badge-pending', icon: Clock },
  signed: { label: 'Signed', color: 'ns-badge-success', icon: CheckCircle },
  expired: { label: 'Expired', color: 'ns-badge-warning', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: 'ns-badge-error', icon: XCircle },
}

export default function ContractsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [contracts, setContracts] = useState<ContractWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all')

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
    if (!user?.hospitalId) return

    const fetchContracts = async () => {
      setLoading(true)
      try {
        let query = supabase
          .from('contracts')
          .select(`
            id,
            title,
            status,
            hospital_signed,
            hospital_signed_at,
            nurse_signed,
            nurse_signed_at,
            spheri_generated,
            spheri_optimized,
            created_at,
            expires_at,
            nurse:nurses!inner (
              profiles:profiles!inner (
                full_name,
                email
              )
            ),
            shift:shifts (
              title,
              start_time
            )
          `)
          .eq('hospital_id', user.hospitalId)
          .order('created_at', { ascending: false })

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter)
        }

        const { data, error } = await query

        if (error) {
          console.error('Error fetching contracts:', error)
          return
        }

        setContracts(data as unknown as ContractWithDetails[] || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchContracts()
  }, [user, statusFilter])

  const filteredContracts = contracts.filter((contract) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      contract.title.toLowerCase().includes(searchLower) ||
      contract.nurse.profiles.full_name?.toLowerCase().includes(searchLower) ||
      contract.nurse.profiles.email.toLowerCase().includes(searchLower)
    )
  })

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading...</div>
      </div>
    )
  }

  if (!user || !isHospital) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">Contracts</h1>
              <p className="text-gray-400 text-sm">Manage and review contracts</p>
            </div>
          </div>
          <Link
            href="/contracts/create"
            className="ns-btn-primary flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            New Contract
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title or nurse name..."
              className="ns-input pl-10 w-full"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ContractStatus | 'all')}
              className="ns-input pl-10 pr-8 appearance-none cursor-pointer min-w-[180px]"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Contracts list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredContracts.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No contracts found</h3>
            <p className="text-gray-400">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first contract to get started'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredContracts.map((contract) => {
              const status = statusConfig[contract.status]
              const StatusIcon = status.icon
              const isSigned = contract.status === 'signed'
              const isFullySigned = contract.hospital_signed && contract.nurse_signed

              return (
                <Link
                  key={contract.id}
                  href={`/contracts/${contract.id}`}
                  className="ns-card-hover p-4 flex items-center gap-4 group"
                >
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isSigned ? 'bg-green-500/20' : 'bg-ns-dark-700'
                  }`}>
                    {isSigned ? (
                      <Lock className="h-6 w-6 text-green-400" />
                    ) : (
                      <FileText className="h-6 w-6 text-ns-teal" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium text-white truncate">
                        {contract.title}
                      </h3>
                      <span className={status.color}>
                        <StatusIcon className="h-3 w-3 inline mr-1" />
                        {status.label}
                      </span>
                      {contract.spheri_generated && (
                        <span className="ns-badge bg-purple-500/20 text-purple-400">
                          <Sparkles className="h-3 w-3 inline mr-1" />
                          Spheri
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 truncate">
                      {contract.nurse.profiles.full_name || contract.nurse.profiles.email}
                      {contract.shift && ` • ${contract.shift.title}`}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                      <span>Created {format(new Date(contract.created_at), 'MMM d, yyyy')}</span>
                      {isFullySigned && contract.nurse_signed_at && (
                        <span className="text-green-400">
                          Signed {format(new Date(contract.nurse_signed_at), 'MMM d, yyyy')}
                        </span>
                      )}
                      {contract.expires_at && !isSigned && (
                        <span className="text-yellow-400">
                          Expires {format(new Date(contract.expires_at), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Signature status */}
                  <div className="hidden sm:flex items-center gap-2 text-xs">
                    <div className={`px-2 py-1 rounded ${
                      contract.hospital_signed ? 'bg-green-500/20 text-green-400' : 'bg-ns-dark-700 text-gray-400'
                    }`}>
                      Hospital {contract.hospital_signed ? '✓' : '○'}
                    </div>
                    <div className={`px-2 py-1 rounded ${
                      contract.nurse_signed ? 'bg-green-500/20 text-green-400' : 'bg-ns-dark-700 text-gray-400'
                    }`}>
                      Nurse {contract.nurse_signed ? '✓' : '○'}
                    </div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight className="h-5 w-5 text-gray-600 group-hover:text-ns-teal transition-colors" />
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

