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
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { format } from 'date-fns'

type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'closed'

interface Incident {
  id: string
  title: string
  description: string
  severity: IncidentSeverity
  status: IncidentStatus
  created_at: string
  resolved_at: string | null
}

const severityConfig: Record<IncidentSeverity, { color: string; label: string }> = {
  low: { color: 'bg-blue-500/20 text-blue-400', label: 'Low' },
  medium: { color: 'bg-yellow-500/20 text-yellow-400', label: 'Medium' },
  high: { color: 'bg-orange-500/20 text-orange-400', label: 'High' },
  critical: { color: 'bg-red-500/20 text-red-400', label: 'Critical' },
}

const statusConfig: Record<IncidentStatus, { color: string; label: string }> = {
  open: { color: 'ns-badge-error', label: 'Open' },
  investigating: { color: 'ns-badge-warning', label: 'Investigating' },
  resolved: { color: 'ns-badge-success', label: 'Resolved' },
  closed: { color: 'ns-badge-info', label: 'Closed' },
}

export default function IncidentsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('all')

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
    }
    if (!authLoading && user && !isHospital) {
      router.push('/nurse')
    }
  }, [user, authLoading, isHospital, router])

  useEffect(() => {
    if (!user?.facilityId) return

    const fetchIncidents = async () => {
      setLoading(true)
      try {
        // Runtime guard: incidents table not yet provisioned
        console.warn('[Incidents] Feature coming soon: incidents table not provisioned')
        setIncidents([])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchIncidents()
  }, [user, statusFilter])

  const filteredIncidents = incidents.filter((incident) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      incident.title.toLowerCase().includes(searchLower) ||
      incident.description.toLowerCase().includes(searchLower)
    )
  })

  if (authLoading || !user || !isHospital) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Incidents</h1>
            <p className="text-gray-400 text-sm">Track and manage incident reports</p>
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
              placeholder="Search incidents..."
              className="ns-input pl-10 w-full"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as IncidentStatus | 'all')}
              className="ns-input pl-10 pr-8 appearance-none cursor-pointer min-w-[180px]"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        {/* Incidents list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No incidents found</h3>
            <p className="text-gray-400">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Incident reports will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredIncidents.map((incident) => {
              const severity = severityConfig[incident.severity]
              const status = statusConfig[incident.status]

              return (
                <Link
                  key={incident.id}
                  href={`/incidents/${incident.id}`}
                  className="ns-card-hover p-4 flex items-center gap-4 group"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${severity.color.split(' ')[0]}`}>
                    <AlertTriangle className={`h-5 w-5 ${severity.color.split(' ')[1]}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-white truncate">{incident.title}</h3>
                      <span className={`ns-badge ${severity.color}`}>{severity.label}</span>
                      <span className={status.color}>{status.label}</span>
                    </div>
                    <p className="text-sm text-gray-400 truncate">{incident.description}</p>
                    <p className="text-xs text-gray-500">
                      Reported {format(new Date(incident.created_at), 'MMM d, yyyy')}
                      {incident.resolved_at && ` • Resolved ${format(new Date(incident.resolved_at), 'MMM d, yyyy')}`}
                    </p>
                  </div>

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

