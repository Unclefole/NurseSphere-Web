'use client'

/**
 * Reports & Exports Dashboard — TASK 10
 * /dashboard/reports
 *
 * Four downloadable CSV reports: Shift, Payroll, Compliance, Agency Savings.
 * Admin-only. All exports are HIPAA audit-logged server-side.
 */

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { withRoleGuard } from '@/lib/auth/role-guard'
import { DashboardLayout } from '@/components/layout'
import {
  Download,
  FileText,
  DollarSign,
  ShieldCheck,
  TrendingDown,
  Loader2,
  AlertCircle,
  CheckCircle,
  Info,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = 'shifts' | 'payroll' | 'compliance' | 'savings'

interface DownloadState {
  loading: boolean
  error: string | null
  success: boolean
}

// ─── Default dates: last 30 days ──────────────────────────────────────────────

function defaultDateRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 30)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadReport(
  reportType: ReportType,
  params: Record<string, string>,
  filename: string,
) {
  const searchParams = new URLSearchParams(params)
  const url = `/api/reports/${reportType}?${searchParams.toString()}`

  const response = await fetch(url)

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(body.error ?? `HTTP ${response.status}`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

// ─── Report Card Component ────────────────────────────────────────────────────

interface ReportCardProps {
  icon: React.ReactNode
  title: string
  description: string
  hasDateRange: boolean
  reportType: ReportType
  dateStart: string
  dateEnd: string
  onDateChange?: (field: 'start' | 'end', value: string) => void
  onDownload: () => void
  state: DownloadState
}

function ReportCard({
  icon,
  title,
  description,
  hasDateRange,
  reportType,
  dateStart,
  dateEnd,
  onDateChange,
  onDownload,
  state,
}: ReportCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
          {icon}
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>

      {/* Date Range Inputs */}
      {hasDateRange && onDateChange && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
            <input
              type="date"
              value={dateStart}
              max={dateEnd}
              onChange={(e) => onDateChange('start', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <input
              type="date"
              value={dateEnd}
              min={dateStart}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => onDateChange('end', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {!hasDateRange && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Snapshot of current compliance state — no date range needed.</span>
        </div>
      )}

      {/* Status Messages */}
      {state.error && (
        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {state.success && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Report downloaded successfully.</span>
        </div>
      )}

      {/* Download Button */}
      <button
        onClick={onDownload}
        disabled={state.loading}
        className="mt-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {state.loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Download CSV
          </>
        )}
      </button>
    </div>
  )
}

// ─── Initial state factory ────────────────────────────────────────────────────

function makeState(): DownloadState {
  return { loading: false, error: null, success: false }
}

// ─── Page Component ───────────────────────────────────────────────────────────

function ReportsPage() {
  const { user } = useAuth()
  const defaults = defaultDateRange()

  // Per-report date ranges
  const [shiftDates, setShiftDates] = useState(defaults)
  const [payrollDates, setPayrollDates] = useState(defaults)
  const [savingsDates, setSavingsDates] = useState(defaults)

  // Per-report download state
  const [states, setStates] = useState<Record<ReportType, DownloadState>>({
    shifts: makeState(),
    payroll: makeState(),
    compliance: makeState(),
    savings: makeState(),
  })

  function updateState(type: ReportType, patch: Partial<DownloadState>) {
    setStates((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }))
  }

  async function handleDownload(type: ReportType, params: Record<string, string>, filename: string) {
    updateState(type, { loading: true, error: null, success: false })
    try {
      await downloadReport(type, params, filename)
      updateState(type, { loading: false, success: true })
      // Auto-clear success after 4s
      setTimeout(() => updateState(type, { success: false }), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed'
      updateState(type, { loading: false, error: msg })
    }
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports &amp; Exports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Download structured CSV reports for operations, finance, and compliance.
          </p>
        </div>

        {/* HIPAA Notice */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <ShieldCheck className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">HIPAA Compliance Notice:</span> All report exports are
            logged for HIPAA compliance. Export activity is tied to your account and retained in the
            audit log.
          </p>
        </div>

        {/* Report Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 1. Shift Report */}
          <ReportCard
            icon={<FileText className="w-5 h-5" />}
            title="Shift Report"
            description="All shifts with nurse assignments, hours worked, rates, and total cost for the selected period."
            hasDateRange
            reportType="shifts"
            dateStart={shiftDates.start}
            dateEnd={shiftDates.end}
            onDateChange={(field, value) =>
              setShiftDates((prev) => ({ ...prev, [field]: value }))
            }
            onDownload={() =>
              handleDownload(
                'shifts',
                { start: shiftDates.start, end: shiftDates.end },
                `nursesphere-shifts-${shiftDates.start}-to-${shiftDates.end}.csv`,
              )
            }
            state={states.shifts}
          />

          {/* 2. Payroll Report */}
          <ReportCard
            icon={<DollarSign className="w-5 h-5" />}
            title="Payroll Report"
            description="Approved timecards with gross pay, platform fees, net pay, and payout status for the selected period."
            hasDateRange
            reportType="payroll"
            dateStart={payrollDates.start}
            dateEnd={payrollDates.end}
            onDateChange={(field, value) =>
              setPayrollDates((prev) => ({ ...prev, [field]: value }))
            }
            onDownload={() =>
              handleDownload(
                'payroll',
                { start: payrollDates.start, end: payrollDates.end },
                `nursesphere-payroll-${payrollDates.start}-to-${payrollDates.end}.csv`,
              )
            }
            state={states.payroll}
          />

          {/* 3. Compliance Report */}
          <ReportCard
            icon={<ShieldCheck className="w-5 h-5" />}
            title="Compliance Report"
            description="Current snapshot of all nurse credentials with expiration dates, compliance scores, and days until expiry."
            hasDateRange={false}
            reportType="compliance"
            dateStart=""
            dateEnd=""
            onDownload={() =>
              handleDownload(
                'compliance',
                {},
                `nursesphere-compliance-snapshot-${today}.csv`,
              )
            }
            state={states.compliance}
          />

          {/* 4. Agency Savings Report */}
          <ReportCard
            icon={<TrendingDown className="w-5 h-5" />}
            title="Agency Savings Report"
            description="Monthly breakdown of NurseSphere costs vs agency baseline, total savings, and savings percentage."
            hasDateRange
            reportType="savings"
            dateStart={savingsDates.start}
            dateEnd={savingsDates.end}
            onDateChange={(field, value) =>
              setSavingsDates((prev) => ({ ...prev, [field]: value }))
            }
            onDownload={() =>
              handleDownload(
                'savings',
                { start: savingsDates.start, end: savingsDates.end },
                `nursesphere-savings-${savingsDates.start}-to-${savingsDates.end}.csv`,
              )
            }
            state={states.savings}
          />
        </div>
      </div>
    </DashboardLayout>
  )
}

export default withRoleGuard(ReportsPage, ['hospital_admin'])
