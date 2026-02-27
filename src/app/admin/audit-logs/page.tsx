'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

interface AuditLogEntry {
  id: string
  event_type: string
  entity_id: string | null
  entity_type: string | null
  actor_id: string | null
  actor_ip: string | null
  metadata: any
  created_at: string
  hash: string
  // prev_hash is only fetched by the chain-integrity query, not the export query
  prev_hash?: string
}

export default function AuditLogsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    eventType: '',
    actorId: ''
  })
  const [chainIntegrity, setChainIntegrity] = useState<boolean | null>(null)

  // Role guard: hospital_admin only
  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth/signin')
    if (!authLoading && user && user.role !== 'hospital_admin') router.replace('/dashboard')
  }, [authLoading, user, router])

  useEffect(() => {
    fetchAuditLogs()
    verifyChainIntegrity()
  }, [])

  const fetchAuditLogs = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('audit_logs')
        .select('id, event_type, entity_id, entity_type, actor_id, actor_ip, metadata, created_at, hash, prev_hash')
        .order('created_at', { ascending: false })
        .limit(100) // Limit for performance

      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate)
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate)
      }
      if (filters.eventType) {
        query = query.eq('event_type', filters.eventType)
      }
      if (filters.actorId) {
        query = query.eq('actor_id', filters.actorId)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching audit logs:', error)
        return
      }

      setAuditLogs(data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  const verifyChainIntegrity = async () => {
    try {
      const { data: logs, error } = await supabase
        .from('audit_logs')
        .select('id, hash, prev_hash, created_at')
        .order('created_at', { ascending: true })

      if (error) {
        setChainIntegrity(false)
        return
      }

      if (!logs || logs.length === 0) {
        setChainIntegrity(true)
        return
      }

      // Basic chain verification (simplified)
      let isValid = true
      for (let i = 1; i < logs.length; i++) {
        if (logs[i].prev_hash !== logs[i - 1].hash) {
          isValid = false
          break
        }
      }
      setChainIntegrity(isValid)
    } catch (error) {
      console.error('Error verifying chain integrity:', error)
      setChainIntegrity(false)
    }
  }

  const exportAuditLogs = async (format: 'csv' | 'json') => {
    try {
      setExporting(true)

      // Fetch all audit logs for export (remove limit)
      let query = supabase
        .from('audit_logs')
        .select('id, event_type, entity_id, entity_type, actor_id, actor_ip, metadata, created_at, hash')
        .order('created_at', { ascending: false })

      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate)
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate)
      }
      if (filters.eventType) {
        query = query.eq('event_type', filters.eventType)
      }
      if (filters.actorId) {
        query = query.eq('actor_id', filters.actorId)
      }

      const { data: exportData, error } = await query

      if (error) {
        console.error('Error exporting audit logs:', error)
        return
      }

      // Log the export action for compliance — actor identified by ID only, no email
      await supabase.from('audit_logs').insert({
        actor_id: user?.id ?? null,
        action: 'audit_log.exported',
        target_type: 'audit_logs',
        target_id: null,
        metadata: {
          export_format: format,
          exported_count: exportData?.length || 0,
          filters_applied: filters,
          export_timestamp: new Date().toISOString()
        }
      })

      // Generate export file
      if (format === 'csv') {
        exportToCsv(exportData || [])
      } else {
        exportToJson(exportData || [])
      }

    } catch (error) {
      console.error('Error during export:', error)
    } finally {
      setExporting(false)
    }
  }

  const exportToCsv = (data: AuditLogEntry[]) => {
    const headers = ['ID', 'Event Type', 'Entity ID', 'Entity Type', 'Actor ID', 'Actor IP', 'Created At', 'Hash', 'Metadata']
    const csvContent = [
      headers.join(','),
      ...data.map(row => [
        row.id,
        row.event_type,
        row.entity_id || '',
        row.entity_type || '',
        row.actor_id || '',
        row.actor_ip || '',
        row.created_at,
        row.hash,
        JSON.stringify(row.metadata).replace(/"/g, '""')
      ].map(field => `"${field}"`).join(','))
    ].join('\n')

    downloadFile(csvContent, `audit_logs_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv')
  }

  const exportToJson = (data: AuditLogEntry[]) => {
    const jsonContent = JSON.stringify({
      exported_at: new Date().toISOString(),
      exported_by: user?.email,
      filters_applied: filters,
      total_records: data.length,
      chain_integrity_verified: chainIntegrity,
      audit_logs: data
    }, null, 2)

    downloadFile(jsonContent, `audit_logs_${new Date().toISOString().split('T')[0]}.json`, 'application/json')
  }

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchAuditLogs()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">Audit Logs</h1>
                <p className="text-sm text-gray-600 mt-1">
                  HIPAA audit trail and access logging
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                  chainIntegrity === true 
                    ? 'bg-green-100 text-green-800' 
                    : chainIntegrity === false 
                    ? 'bg-red-100 text-red-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  Chain Integrity: {chainIntegrity === true ? 'Valid' : chainIntegrity === false ? 'Invalid' : 'Checking...'}
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <form onSubmit={handleFilterSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="datetime-local"
                  value={filters.startDate}
                  onChange={(e) => setFilters({...filters, startDate: e.target.value})}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">End Date</label>
                <input
                  type="datetime-local"
                  value={filters.endDate}
                  onChange={(e) => setFilters({...filters, endDate: e.target.value})}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Event Type</label>
                <select
                  value={filters.eventType}
                  onChange={(e) => setFilters({...filters, eventType: e.target.value})}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="">All Events</option>
                  <option value="access">Access</option>
                  <option value="create">Create</option>
                  <option value="update">Update</option>
                  <option value="delete">Delete</option>
                  <option value="login">Login</option>
                  <option value="logout">Logout</option>
                  <option value="export">Export</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Apply Filters
                </button>
              </div>
            </form>
          </div>

          {/* Export Controls */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {auditLogs.length} audit log entries
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => exportAuditLogs('csv')}
                  disabled={exporting}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
                <button
                  onClick={() => exportAuditLogs('json')}
                  disabled={exporting}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {exporting ? 'Exporting...' : 'Export JSON'}
                </button>
              </div>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Event
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Entity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hash
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                        Loading audit logs...
                      </td>
                    </tr>
                  ) : auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                        No audit logs found
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(log.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            log.event_type === 'access' ? 'bg-blue-100 text-blue-800' :
                            log.event_type === 'create' ? 'bg-green-100 text-green-800' :
                            log.event_type === 'update' ? 'bg-yellow-100 text-yellow-800' :
                            log.event_type === 'delete' ? 'bg-red-100 text-red-800' :
                            log.event_type === 'login' ? 'bg-purple-100 text-purple-800' :
                            log.event_type === 'export' ? 'bg-orange-100 text-orange-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {log.event_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>
                            {log.entity_type && (
                              <div className="font-medium">{log.entity_type}</div>
                            )}
                            {log.entity_id && (
                              <div className="text-xs text-gray-500 truncate max-w-32">
                                {log.entity_id}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 truncate max-w-32">
                          {log.actor_id || 'System'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {log.actor_ip || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono truncate max-w-32">
                          {log.hash.substring(0, 12)}...
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
