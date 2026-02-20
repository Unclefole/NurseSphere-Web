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
  UserCheck, 
  Clock, 
  CheckCircle, 
  XCircle,
  ChevronRight,
  Loader2
} from 'lucide-react'
import { format } from 'date-fns'
import type { ApplicationStatus } from '@/types/database'

interface ApplicationWithDetails {
  id: string
  shift_id: string
  nurse_id: string
  status: ApplicationStatus
  applied_at: string
  cover_letter: string | null
  nurse: {
    id: string
    specialty: string | null
    years_experience: number | null
    user_id: string
    profiles: {
      full_name: string | null
      email: string
      avatar_url: string | null
    }
  }
  shift: {
    id: string
    title: string
    department: string | null
    start_time: string
    end_time: string
    hourly_rate: number
  }
}

const statusConfig: Record<ApplicationStatus, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending Review', color: 'ns-badge-pending', icon: Clock },
  approved: { label: 'Approved', color: 'ns-badge-success', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'ns-badge-error', icon: XCircle },
  withdrawn: { label: 'Withdrawn', color: 'ns-badge-warning', icon: XCircle },
}

export default function ApplicantsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [applications, setApplications] = useState<ApplicationWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'all'>('all')

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

    const fetchApplications = async () => {
      setLoading(true)
      try {
        let query = supabase
          .from('applications')
          .select(`
            id,
            shift_id,
            nurse_id,
            status,
            applied_at,
            cover_letter,
            nurse:nurses!inner (
              id,
              specialty,
              years_experience,
              user_id,
              profiles:profiles!inner (
                full_name,
                email,
                avatar_url
              )
            ),
            shift:shifts!inner (
              id,
              title,
              department,
              start_time,
              end_time,
              hourly_rate
            )
          `)
          .eq('hospital_id', user.hospitalId)
          .order('applied_at', { ascending: false })

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter)
        }

        const { data, error } = await query

        if (error) {
          console.error('Error fetching applications:', error)
          return
        }

        setApplications(data as unknown as ApplicationWithDetails[] || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchApplications()
  }, [user, statusFilter])

  const filteredApplications = applications.filter((app) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      app.nurse.profiles.full_name?.toLowerCase().includes(searchLower) ||
      app.nurse.profiles.email.toLowerCase().includes(searchLower) ||
      app.shift.title.toLowerCase().includes(searchLower) ||
      app.nurse.specialty?.toLowerCase().includes(searchLower)
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
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Applicants</h1>
            <p className="text-gray-400 text-sm">Review and manage shift applications</p>
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
              placeholder="Search by name, email, or shift..."
              className="ns-input pl-10 w-full"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | 'all')}
              className="ns-input pl-10 pr-8 appearance-none cursor-pointer min-w-[180px]"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        </div>

        {/* Applications list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <UserCheck className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No applications found</h3>
            <p className="text-gray-400">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'New applications will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredApplications.map((application) => {
              const status = statusConfig[application.status]
              const StatusIcon = status.icon

              return (
                <Link
                  key={application.id}
                  href={`/applicants/${application.id}`}
                  className="ns-card-hover p-4 flex items-center gap-4 group"
                >
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-ns-dark-700 flex items-center justify-center flex-shrink-0">
                    {application.nurse.profiles.avatar_url ? (
                      <img
                        src={application.nurse.profiles.avatar_url}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-medium text-ns-teal">
                        {application.nurse.profiles.full_name?.[0] || 'N'}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-white truncate">
                        {application.nurse.profiles.full_name || 'Unknown Nurse'}
                      </h3>
                      <span className={status.color}>
                        <StatusIcon className="h-3 w-3 inline mr-1" />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 truncate">
                      {application.shift.title} • {application.shift.department || 'General'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Applied {format(new Date(application.applied_at), 'MMM d, yyyy')}
                      {application.nurse.specialty && ` • ${application.nurse.specialty}`}
                      {application.nurse.years_experience && ` • ${application.nurse.years_experience}+ years`}
                    </p>
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

