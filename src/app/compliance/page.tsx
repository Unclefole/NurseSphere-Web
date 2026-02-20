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
  Shield,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronRight,
  Loader2,
  FileCheck,
} from 'lucide-react'
import { format } from 'date-fns'

type ComplianceStatus = 'valid' | 'expiring' | 'expired' | 'pending'

interface ComplianceWithNurse {
  id: string
  nurse_id: string
  document_type: string
  document_name: string
  status: ComplianceStatus
  issued_at: string | null
  expires_at: string | null
  verified_at: string | null
  nurse: {
    profiles: {
      full_name: string | null
      email: string
    }
    specialty: string | null
  }
}

const statusConfig: Record<ComplianceStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  valid: { label: 'Valid', color: 'ns-badge-success', icon: CheckCircle },
  expiring: { label: 'Expiring Soon', color: 'ns-badge-warning', icon: AlertTriangle },
  expired: { label: 'Expired', color: 'ns-badge-error', icon: XCircle },
  pending: { label: 'Pending Verification', color: 'ns-badge-pending', icon: Clock },
}

export default function CompliancePage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [records, setRecords] = useState<ComplianceWithNurse[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ComplianceStatus | 'all'>('all')

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

    const fetchCompliance = async () => {
      setLoading(true)
      try {
        // Get nurses associated with this hospital through shifts/applications
        const { data: hospitalNurses } = await supabase
          .from('applications')
          .select('nurse_id')
          .eq('hospital_id', user.hospitalId)
          .eq('status', 'approved')

        const nurseIds = [...new Set(hospitalNurses?.map(a => a.nurse_id) || [])]

        if (nurseIds.length === 0) {
          setRecords([])
          setLoading(false)
          return
        }

        let query = supabase
          .from('compliance_records')
          .select(`
            id,
            nurse_id,
            document_type,
            document_name,
            status,
            issued_at,
            expires_at,
            verified_at,
            nurse:nurses!inner (
              profiles:profiles!inner (
                full_name,
                email
              ),
              specialty
            )
          `)
          .in('nurse_id', nurseIds)
          .order('expires_at', { ascending: true, nullsFirst: false })

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter)
        }

        const { data, error } = await query

        if (error) {
          console.error('Error fetching compliance:', error)
          return
        }

        setRecords(data as unknown as ComplianceWithNurse[] || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchCompliance()
  }, [user, statusFilter])

  const filteredRecords = records.filter((record) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      record.nurse.profiles.full_name?.toLowerCase().includes(searchLower) ||
      record.nurse.profiles.email.toLowerCase().includes(searchLower) ||
      record.document_name.toLowerCase().includes(searchLower) ||
      record.document_type.toLowerCase().includes(searchLower)
    )
  })

  // Group by status for summary
  const summary = {
    valid: records.filter(r => r.status === 'valid').length,
    expiring: records.filter(r => r.status === 'expiring').length,
    expired: records.filter(r => r.status === 'expired').length,
    pending: records.filter(r => r.status === 'pending').length,
  }

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
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Compliance</h1>
            <p className="text-gray-400 text-sm">Monitor nurse credentials and licenses</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="ns-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.valid}</p>
              <p className="text-xs text-gray-400">Valid</p>
            </div>
          </div>
          <div className="ns-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.expiring}</p>
              <p className="text-xs text-gray-400">Expiring</p>
            </div>
          </div>
          <div className="ns-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
              <XCircle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.expired}</p>
              <p className="text-xs text-gray-400">Expired</p>
            </div>
          </div>
          <div className="ns-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.pending}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by nurse or document..."
              className="ns-input pl-10 w-full"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ComplianceStatus | 'all')}
              className="ns-input pl-10 pr-8 appearance-none cursor-pointer min-w-[180px]"
            >
              <option value="all">All Status</option>
              <option value="valid">Valid</option>
              <option value="expiring">Expiring Soon</option>
              <option value="expired">Expired</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        {/* Records list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No compliance records found</h3>
            <p className="text-gray-400">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Compliance records will appear once nurses are approved'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecords.map((record) => {
              const status = statusConfig[record.status]
              const StatusIcon = status.icon

              return (
                <div
                  key={record.id}
                  className="ns-card p-4 flex items-center gap-4"
                >
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    record.status === 'valid' ? 'bg-green-500/20' :
                    record.status === 'expiring' ? 'bg-yellow-500/20' :
                    record.status === 'expired' ? 'bg-red-500/20' :
                    'bg-purple-500/20'
                  }`}>
                    <FileCheck className={`h-5 w-5 ${
                      record.status === 'valid' ? 'text-green-400' :
                      record.status === 'expiring' ? 'text-yellow-400' :
                      record.status === 'expired' ? 'text-red-400' :
                      'text-purple-400'
                    }`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-white truncate">
                        {record.document_name}
                      </h3>
                      <span className={status.color}>
                        <StatusIcon className="h-3 w-3 inline mr-1" />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 truncate">
                      {record.nurse.profiles.full_name || record.nurse.profiles.email} • {record.document_type}
                    </p>
                    <p className="text-xs text-gray-500">
                      {record.expires_at && (
                        <>
                          Expires {format(new Date(record.expires_at), 'MMM d, yyyy')}
                          {record.verified_at && ` • Verified ${format(new Date(record.verified_at), 'MMM d, yyyy')}`}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Read-only notice */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Compliance records are read-only. Nurses update their credentials via the mobile app.
        </p>
      </div>
    </DashboardLayout>
  )
}

