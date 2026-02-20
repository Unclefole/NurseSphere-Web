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
  CalendarDays,
  Clock,
  CheckCircle,
  PlayCircle,
  XCircle,
  ChevronRight,
  Loader2,
  Plus,
  MapPin,
  DollarSign,
} from 'lucide-react'
import { format } from 'date-fns'
import type { ShiftStatus } from '@/types/database'

interface ShiftWithNurse {
  id: string
  title: string
  description: string | null
  department: string | null
  specialty_required: string | null
  start_time: string
  end_time: string
  hourly_rate: number
  status: ShiftStatus
  nurse_id: string | null
  created_at: string
  nurse: {
    profiles: {
      full_name: string | null
    }
  } | null
}

const statusConfig: Record<ShiftStatus, { label: string; color: string; icon: typeof Clock }> = {
  open: { label: 'Open', color: 'ns-badge-info', icon: Clock },
  filled: { label: 'Filled', color: 'ns-badge-success', icon: CheckCircle },
  in_progress: { label: 'In Progress', color: 'ns-badge-pending', icon: PlayCircle },
  completed: { label: 'Completed', color: 'ns-badge-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'ns-badge-error', icon: XCircle },
}

export default function ShiftsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [shifts, setShifts] = useState<ShiftWithNurse[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ShiftStatus | 'all'>('all')

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

    const fetchShifts = async () => {
      setLoading(true)
      try {
        let query = supabase
          .from('shifts')
          .select(`
            id,
            title,
            description,
            department,
            specialty_required,
            start_time,
            end_time,
            hourly_rate,
            status,
            nurse_id,
            created_at,
            nurse:nurses (
              profiles:profiles (
                full_name
              )
            )
          `)
          .eq('hospital_id', user.hospitalId)
          .order('start_time', { ascending: false })

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter)
        }

        const { data, error } = await query

        if (error) {
          console.error('Error fetching shifts:', error)
          return
        }

        setShifts(data as unknown as ShiftWithNurse[] || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchShifts()
  }, [user, statusFilter])

  const filteredShifts = shifts.filter((shift) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      shift.title.toLowerCase().includes(searchLower) ||
      shift.department?.toLowerCase().includes(searchLower) ||
      shift.specialty_required?.toLowerCase().includes(searchLower)
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
              <h1 className="text-2xl font-bold text-white">Manage Shifts</h1>
              <p className="text-gray-400 text-sm">View and manage all shifts</p>
            </div>
          </div>
          <Link
            href="/shifts/create"
            className="ns-btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Shift
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
              placeholder="Search shifts..."
              className="ns-input pl-10 w-full"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ShiftStatus | 'all')}
              className="ns-input pl-10 pr-8 appearance-none cursor-pointer min-w-[180px]"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="filled">Filled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Shifts list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredShifts.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <CalendarDays className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No shifts found</h3>
            <p className="text-gray-400 mb-4">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first shift to get started'}
            </p>
            <Link href="/shifts/create" className="ns-btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Shift
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredShifts.map((shift) => {
              const status = statusConfig[shift.status]
              const StatusIcon = status.icon
              const shiftDate = new Date(shift.start_time)
              const isUpcoming = shiftDate > new Date()

              return (
                <Link
                  key={shift.id}
                  href={`/shifts/${shift.id}`}
                  className="ns-card-hover p-4 flex items-center gap-4 group"
                >
                  {/* Date badge */}
                  <div className={`w-14 h-14 rounded-lg flex flex-col items-center justify-center flex-shrink-0 ${
                    isUpcoming ? 'bg-ns-teal/20' : 'bg-ns-dark-700'
                  }`}>
                    <span className={`text-xs font-medium ${isUpcoming ? 'text-ns-teal' : 'text-gray-400'}`}>
                      {format(shiftDate, 'MMM')}
                    </span>
                    <span className={`text-xl font-bold ${isUpcoming ? 'text-white' : 'text-gray-300'}`}>
                      {format(shiftDate, 'd')}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-white truncate">{shift.title}</h3>
                      <span className={status.color}>
                        <StatusIcon className="h-3 w-3 inline mr-1" />
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {format(new Date(shift.start_time), 'h:mm a')} - {format(new Date(shift.end_time), 'h:mm a')}
                      </span>
                      {shift.department && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {shift.department}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5" />
                        ${shift.hourly_rate}/hr
                      </span>
                    </div>
                    {shift.nurse && (
                      <p className="text-xs text-ns-teal mt-1">
                        Assigned to: {shift.nurse.profiles.full_name || 'Unknown'}
                      </p>
                    )}
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

