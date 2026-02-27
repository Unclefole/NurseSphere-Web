/**
 * Compliance Center — Client Component
 * NurseSphere TIER 1 — Continuous Compliance Engine
 *
 * Renders the dashboard UI with data passed from the server component.
 * "Export CSV" button hits GET /api/compliance/export-csv.
 */

'use client'

import { useState } from 'react'
import type { ComplianceCenterData } from './page'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SweepStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-400 border border-green-500/30',
    running: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    failed: 'bg-red-500/20 text-red-400 border border-red-500/30',
  }
  const cls = styles[status] ?? 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  }
  const cls = styles[severity] ?? 'bg-gray-500/20 text-gray-400'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ComplianceCenterClient({ data }: { data: ComplianceCenterData }) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const complianceRate = data.totalNurses > 0
    ? Math.round((data.compliantNurses / data.totalNurses) * 100)
    : 0

  const totalActiveAlerts = data.alertsBySeverity.reduce((sum, row) => sum + row.count, 0)

  async function handleExportCSV() {
    setExporting(true)
    setExportError(null)
    try {
      const response = await fetch('/api/compliance/export-csv')
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Export failed' }))
        throw new Error(err.error ?? 'Export failed')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'nursesphere-compliance-export.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Center</h1>
          <p className="text-gray-400 text-sm mt-1">
            Continuous compliance monitoring — TIER 1
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {exporting ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Exporting…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </>
          )}
        </button>
      </div>

      {exportError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          Export error: {exportError}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Last Sweep */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Last Sweep</p>
          {data.lastSweep ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <SweepStatusBadge status={data.lastSweep.status} />
              </div>
              <p className="text-white text-sm font-medium">{formatDate(data.lastSweep.started_at)}</p>
              <p className="text-gray-500 text-xs mt-1">
                {data.lastSweep.nurses_checked} nurses checked
              </p>
            </>
          ) : (
            <p className="text-gray-500 text-sm">No sweeps run yet</p>
          )}
        </div>

        {/* Compliance Rate */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Nurses Compliant</p>
          <p className={`text-3xl font-bold ${complianceRate >= 90 ? 'text-green-400' : complianceRate >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
            {complianceRate}%
          </p>
          <p className="text-gray-500 text-xs mt-1">
            {data.compliantNurses} of {data.totalNurses} (score ≥ 80)
          </p>
        </div>

        {/* Active Alerts */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Active Alerts</p>
          <p className={`text-3xl font-bold ${totalActiveAlerts === 0 ? 'text-green-400' : 'text-yellow-400'}`}>
            {totalActiveAlerts}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {data.alertsBySeverity.map((row) => (
              <span key={row.severity} className="text-xs text-gray-400">
                <SeverityBadge severity={row.severity} /> {row.count}
              </span>
            ))}
            {data.alertsBySeverity.length === 0 && (
              <p className="text-gray-500 text-xs">No open alerts</p>
            )}
          </div>
        </div>

        {/* Suspensions (last 30 days) */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Suspended (30d)</p>
          <p className={`text-3xl font-bold ${data.suspendedLast30Days.length === 0 ? 'text-green-400' : 'text-red-400'}`}>
            {data.suspendedLast30Days.length}
          </p>
          <p className="text-gray-500 text-xs mt-1">Auto-suspended nurses</p>
        </div>
      </div>

      {/* Sweep Details */}
      {data.lastSweep && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <h2 className="text-white font-semibold mb-3">Last Sweep Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Nurses Checked</p>
              <p className="text-white font-medium">{data.lastSweep.nurses_checked}</p>
            </div>
            <div>
              <p className="text-gray-400">Alerts Created</p>
              <p className="text-white font-medium">{data.lastSweep.alerts_created}</p>
            </div>
            <div>
              <p className="text-gray-400">Suspensions Triggered</p>
              <p className="text-white font-medium">{data.lastSweep.suspensions_triggered}</p>
            </div>
            <div>
              <p className="text-gray-400">Errors</p>
              <p className={`font-medium ${data.lastSweep.error_count > 0 ? 'text-red-400' : 'text-white'}`}>
                {data.lastSweep.error_count}
              </p>
            </div>
          </div>
          {data.lastSweep.completed_at && (
            <p className="text-gray-500 text-xs mt-3">
              Completed: {formatDate(data.lastSweep.completed_at)}
            </p>
          )}
        </div>
      )}

      {/* Suspended Nurses List */}
      {data.suspendedLast30Days.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-3">
            Auto-Suspended in Last 30 Days
            <span className="ml-2 text-red-400 text-sm font-normal">({data.suspendedLast30Days.length})</span>
          </h2>
          <div className="space-y-3">
            {data.suspendedLast30Days.map((nurse) => (
              <div
                key={nurse.nurseId}
                className="flex items-start justify-between p-3 bg-gray-800 rounded-lg"
              >
                <div>
                  {/* Only show UUID — no PHI */}
                  <p className="text-gray-300 text-sm font-mono">{nurse.nurseId}</p>
                  {nurse.reason && (
                    <p className="text-gray-500 text-xs mt-1">{nurse.reason}</p>
                  )}
                </div>
                <p className="text-gray-500 text-xs whitespace-nowrap ml-4">
                  {formatDate(nurse.suspendedAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exclusion Checks last run info */}
      <div className="mt-6 p-4 bg-gray-900 border border-gray-800 rounded-xl">
        <p className="text-gray-400 text-sm">
          <span className="text-gray-300 font-medium">Exclusion checks last run: </span>
          {data.lastSweep?.started_at ? formatDate(data.lastSweep.started_at) : 'Never'}
          {' · '}
          <span className="text-gray-300 font-medium">Sources: </span>
          OIG LEIE, NURSYS, SAM.gov (stub)
        </p>
      </div>
    </div>
  )
}
