'use client'

/**
 * Labor Cost Savings Dashboard — MODULE 3
 * /dashboard/finance
 *
 * KPI cards, period selector, cost events table, CSV export, baseline config.
 * HIPAA: No PHI displayed. All data facility-scoped via server RLS.
 */

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { withRoleGuard } from '@/lib/auth/role-guard'
import { DashboardLayout } from '@/components/layout'
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Clock,
  BarChart2,
  Download,
  RefreshCw,
  Settings,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type KPIPeriod = '30d' | '90d' | 'ytd'

interface KPISnapshot {
  facility_id: string
  period_start: string
  period_end: string
  total_hours: number
  total_cost: number
  total_savings: number
  agency_dependency_ratio: number
  overtime_hours: number
  computed_at: string
}

interface KPIData {
  period: KPIPeriod
  current: KPISnapshot | null
  previous: KPISnapshot | null
  trend: {
    savings_delta: number
    agency_ratio_delta: number
  }
  cost_per_hour: number
}

interface CostEvent {
  id: string
  event_type: 'staffed_internal' | 'staffed_nursesphere' | 'staffed_agency'
  hours: number
  cost: number
  baseline_cost: number
  savings: number
  created_at: string
}

interface Baseline {
  id: string
  baseline_type: 'agency_avg_rate' | 'overtime_avg' | 'msp_fee_pct'
  value: number
  effective_from: string
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

function KPICard({
  title,
  value,
  delta,
  icon: Icon,
  format = 'currency',
  invertDelta = false,
}: {
  title: string
  value: number
  delta?: number
  icon: React.ComponentType<{ className?: string }>
  format?: 'currency' | 'percent' | 'hours' | 'number'
  invertDelta?: boolean
}) {
  const formatValue = (v: number) => {
    if (format === 'currency') return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    if (format === 'percent') return `${(v * 100).toFixed(1)}%`
    if (format === 'hours') return `${v.toFixed(0)}h`
    return v.toFixed(2)
  }

  const isPositive = delta !== undefined && (invertDelta ? delta < 0 : delta > 0)
  const isNegative = delta !== undefined && (invertDelta ? delta > 0 : delta < 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{title}</span>
        <Icon className="h-5 w-5 text-gray-400" />
      </div>
      <div className="text-3xl font-bold text-gray-900">{formatValue(value)}</div>
      {delta !== undefined && (
        <div className={`flex items-center gap-1 text-sm font-medium ${
          isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-500'
        }`}>
          {isPositive ? <TrendingUp className="h-4 w-4" /> : isNegative ? <TrendingDown className="h-4 w-4" /> : null}
          <span>{delta >= 0 ? '+' : ''}{formatValue(delta)} vs prev period</span>
        </div>
      )}
    </div>
  )
}

function EventTypeBadge({ type }: { type: CostEvent['event_type'] }) {
  const config = {
    staffed_internal: { label: 'Internal', color: 'bg-blue-100 text-blue-800' },
    staffed_nursesphere: { label: 'NurseSphere', color: 'bg-green-100 text-green-800' },
    staffed_agency: { label: 'Agency', color: 'bg-red-100 text-red-800' },
  }
  const { label, color } = config[type]
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{label}</span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function FinanceDashboardPageInner() {
  const { user, loading } = useAuth()

  const [period, setPeriod] = useState<KPIPeriod>('30d')
  const [kpiData, setKpiData] = useState<KPIData | null>(null)
  const [events, setEvents] = useState<CostEvent[]>([])
  const [baselines, setBaselines] = useState<Baseline[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Baseline form state
  const [baselineForm, setBaselineForm] = useState<{
    baseline_type: string
    value: string
  }>({ baseline_type: 'agency_avg_rate', value: '' })
  const [savingBaseline, setSavingBaseline] = useState(false)

  // Auth redirect handled by withRoleGuard HOC

  const fetchKPIs = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const [kpiRes, baselineRes] = await Promise.all([
        fetch(`/api/finance/kpis?period=${period}`),
        fetch('/api/finance/baselines'),
      ])

      if (!kpiRes.ok) throw new Error(`KPI fetch failed: ${kpiRes.status}`)
      const kpiJson = await kpiRes.json()
      setKpiData(kpiJson)

      if (baselineRes.ok) {
        const bJson = await baselineRes.json()
        setBaselines(bJson.baselines ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setFetching(false)
    }
  }, [period])

  useEffect(() => {
    if (user) fetchKPIs()
  }, [user, fetchKPIs])

  const handleSaveBaseline = async () => {
    setSavingBaseline(true)
    setStatusMsg(null)
    try {
      const res = await fetch('/api/finance/baselines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline_type: baselineForm.baseline_type,
          value: parseFloat(baselineForm.value),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setStatusMsg('Baseline saved successfully.')
      setBaselineForm({ baseline_type: 'agency_avg_rate', value: '' })
      await fetchKPIs()
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save baseline')
    } finally {
      setSavingBaseline(false)
    }
  }

  const handleExportCSV = () => {
    const headers = ['Date', 'Type', 'Hours', 'Cost', 'Baseline Cost', 'Savings']
    const rows = events
      .filter(e => filterType === 'all' || e.event_type === filterType)
      .map(e => [
        new Date(e.created_at).toLocaleDateString(),
        e.event_type,
        e.hours,
        e.cost.toFixed(2),
        e.baseline_cost.toFixed(2),
        e.savings.toFixed(2),
      ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nursesphere-cost-events-${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading || fetching) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      </DashboardLayout>
    )
  }

  const current = kpiData?.current
  const trend = kpiData?.trend

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Labor Cost Savings Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              Track savings, agency dependency, and cost efficiency
            </p>
          </div>
          {/* Period Selector */}
          <div className="flex gap-2">
            {(['30d', '90d', 'ytd'] as KPIPeriod[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p === 'ytd' ? 'YTD' : p}
              </button>
            ))}
            <button
              onClick={fetchKPIs}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {statusMsg && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            {statusMsg}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total Savings"
            value={current?.total_savings ?? 0}
            delta={trend?.savings_delta}
            icon={DollarSign}
            format="currency"
          />
          <KPICard
            title="Agency Dependency"
            value={current?.agency_dependency_ratio ?? 0}
            delta={trend?.agency_ratio_delta}
            icon={BarChart2}
            format="percent"
            invertDelta  // lower = better
          />
          <KPICard
            title="Cost Per Hour"
            value={kpiData?.cost_per_hour ?? 0}
            icon={DollarSign}
            format="currency"
          />
          <KPICard
            title="Overtime Hours"
            value={current?.overtime_hours ?? 0}
            icon={Clock}
            format="hours"
          />
        </div>

        {/* Cost Events Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Cost Events</h2>
            <div className="flex items-center gap-3">
              {/* Filter */}
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All types</option>
                <option value="staffed_internal">Internal</option>
                <option value="staffed_nursesphere">NurseSphere</option>
                <option value="staffed_agency">Agency</option>
              </select>
              {/* Export */}
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              <BarChart2 className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No cost events recorded yet for this period.</p>
              <p className="text-xs mt-1">Events are recorded when shifts are staffed.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-700">Date</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Hours</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Cost</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Baseline</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Savings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {events
                    .filter(e => filterType === 'all' || e.event_type === filterType)
                    .map(e => (
                      <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(e.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <EventTypeBadge type={e.event_type} />
                        </td>
                        <td className="px-4 py-3 text-gray-700">{e.hours}h</td>
                        <td className="px-4 py-3 text-gray-700">${e.cost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-gray-700">${e.baseline_cost.toFixed(2)}</td>
                        <td className={`px-4 py-3 font-semibold ${e.savings >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {e.savings >= 0 ? '+' : ''}${e.savings.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Baseline Configuration */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Cost Baselines</h2>
          </div>
          <div className="p-6 space-y-6">
            {/* Current baselines */}
            {baselines.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {baselines.map(b => (
                  <div key={b.id} className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                      {b.baseline_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-2xl font-bold text-gray-900">
                      {b.baseline_type === 'msp_fee_pct' ? `${b.value}%` : `$${b.value}/hr`}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Effective {new Date(b.effective_from).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Set baseline form */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Update Baseline</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Type</label>
                  <select
                    value={baselineForm.baseline_type}
                    onChange={e => setBaselineForm(f => ({ ...f, baseline_type: e.target.value }))}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="agency_avg_rate">Agency Avg Rate ($/hr)</option>
                    <option value="overtime_avg">Overtime Avg ($/hr)</option>
                    <option value="msp_fee_pct">MSP Fee (%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={baselineForm.value}
                    onChange={e => setBaselineForm(f => ({ ...f, value: e.target.value }))}
                    placeholder="e.g. 75"
                    className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={handleSaveBaseline}
                  disabled={savingBaseline || !baselineForm.value}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingBaseline ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save Baseline
                </button>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs text-amber-800">
                <strong>Savings Methodology:</strong> Savings are calculated as agency/MSP baseline rate
                minus the NurseSphere staffed cost for each shift. Baselines are configurable above and
                apply to all future cost calculations. Historical events are not retroactively recalculated.
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

export default withRoleGuard(FinanceDashboardPageInner, ['hospital_admin'])
