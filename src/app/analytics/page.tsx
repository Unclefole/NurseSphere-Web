'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  BarChart3,
  FileText,
  CheckCircle,
  Clock,
  Sparkles,
  Zap,
  TrendingUp,
  Calendar,
  Loader2,
} from 'lucide-react'

interface SpherAnalyticsData {
  totalContracts: number
  signedContracts: number
  pendingContracts: number
  avgTimeToSign: number // hours
  spheriGenerated: number
  manuallyCreated: number
  optimizationRate: number // percentage
  weeklyTrend: {
    week: string
    contracts: number
    signed: number
  }[]
}

export default function AnalyticsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [analytics, setAnalytics] = useState<SpherAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d')

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
    if (!user?.facilityId) return

    const fetchAnalytics = async () => {
      setLoading(true)
      try {
        // Calculate date range
        const now = new Date()
        let startDate: Date | null = null
        
        switch (timeRange) {
          case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
            break
          case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            break
          case '90d':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
            break
          case 'all':
            startDate = null
            break
        }

        // Fetch contracts data
        let contractsQuery = supabase
          .from('contracts')
          .select('id, status, spheri_generated, spheri_optimized, created_at, nurse_signed_at')
          .eq('facility_id', user.facilityId)

        if (startDate) {
          contractsQuery = contractsQuery.gte('created_at', startDate.toISOString())
        }

        const { data: contracts, error: contractsError } = await contractsQuery

        if (contractsError) {
          console.error('Error fetching contracts:', contractsError)
          return
        }

        // Calculate analytics from contracts
        const totalContracts = contracts?.length || 0
        const signedContracts = contracts?.filter(c => c.status === 'signed').length || 0
        const pendingContracts = contracts?.filter(c => c.status === 'pending').length || 0
        const spheriGenerated = contracts?.filter(c => c.spheri_generated).length || 0
        const manuallyCreated = totalContracts - spheriGenerated
        const optimizedContracts = contracts?.filter(c => c.spheri_optimized).length || 0
        const optimizationRate = totalContracts > 0 ? (optimizedContracts / totalContracts) * 100 : 0

        // Calculate average time to sign (for signed contracts)
        const signedWithTimes = contracts?.filter(c => c.status === 'signed' && c.nurse_signed_at && c.created_at) || []
        let avgTimeToSign = 0
        if (signedWithTimes.length > 0) {
          const totalTime = signedWithTimes.reduce((sum, c) => {
            const created = new Date(c.created_at).getTime()
            const signed = new Date(c.nurse_signed_at!).getTime()
            return sum + (signed - created)
          }, 0)
          avgTimeToSign = totalTime / signedWithTimes.length / (1000 * 60 * 60) // Convert to hours
        }

        // Runtime guard: analytics table not yet provisioned
        const storedAnalytics: any[] | null = null

        // Calculate weekly trend
        const weeklyTrend: { week: string; contracts: number; signed: number }[] = []
        const weeks = timeRange === '7d' ? 1 : timeRange === '30d' ? 4 : timeRange === '90d' ? 12 : 8
        
        for (let i = 0; i < weeks; i++) {
          const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
          const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
          
          const weekContracts = contracts?.filter(c => {
            const created = new Date(c.created_at)
            return created >= weekStart && created < weekEnd
          }) || []
          
          weeklyTrend.unshift({
            week: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            contracts: weekContracts.length,
            signed: weekContracts.filter(c => c.status === 'signed').length,
          })
        }

        setAnalytics({
          totalContracts,
          signedContracts,
          pendingContracts,
          avgTimeToSign: Math.round(avgTimeToSign * 10) / 10,
          spheriGenerated,
          manuallyCreated,
          optimizationRate: Math.round(optimizationRate),
          weeklyTrend,
        })
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
  }, [user, timeRange])

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
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-purple-400" />
                Spheri Analytics
              </h1>
              <p className="text-gray-400 text-sm">Contract and performance insights</p>
            </div>
          </div>

          {/* Time range selector */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
              className="ns-input py-1.5 text-sm min-w-[120px]"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : analytics ? (
          <div className="space-y-6">
            {/* Main stats grid */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Contracts */}
              <div className="ns-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <FileText className="h-8 w-8 text-blue-400" />
                  <span className="text-xs text-gray-500 uppercase">Total</span>
                </div>
                <p className="text-3xl font-bold text-white">{analytics.totalContracts}</p>
                <p className="text-sm text-gray-400">Contracts</p>
              </div>

              {/* Signed Contracts */}
              <div className="ns-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <CheckCircle className="h-8 w-8 text-green-400" />
                  <span className="text-xs text-gray-500 uppercase">Signed</span>
                </div>
                <p className="text-3xl font-bold text-white">{analytics.signedContracts}</p>
                <p className="text-sm text-gray-400">
                  {analytics.totalContracts > 0
                    ? `${Math.round((analytics.signedContracts / analytics.totalContracts) * 100)}% completion`
                    : 'No contracts yet'}
                </p>
              </div>

              {/* Avg Time to Sign */}
              <div className="ns-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <Clock className="h-8 w-8 text-yellow-400" />
                  <span className="text-xs text-gray-500 uppercase">Avg Time</span>
                </div>
                <p className="text-3xl font-bold text-white">
                  {analytics.avgTimeToSign > 24
                    ? `${Math.round(analytics.avgTimeToSign / 24)}d`
                    : `${analytics.avgTimeToSign}h`}
                </p>
                <p className="text-sm text-gray-400">Time to sign</p>
              </div>

              {/* Optimization Rate */}
              <div className="ns-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <Zap className="h-8 w-8 text-purple-400" />
                  <span className="text-xs text-gray-500 uppercase">Optimized</span>
                </div>
                <p className="text-3xl font-bold text-white">{analytics.optimizationRate}%</p>
                <p className="text-sm text-gray-400">Spheri optimization</p>
              </div>
            </div>

            {/* Spheri vs Manual breakdown */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Generation breakdown */}
              <div className="ns-card p-6">
                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  Contract Generation
                </h3>
                <div className="space-y-4">
                  {/* Visual bar */}
                  <div className="h-4 bg-ns-dark-700 rounded-full overflow-hidden flex">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-purple-400 h-full transition-all duration-500"
                      style={{
                        width: `${analytics.totalContracts > 0 ? (analytics.spheriGenerated / analytics.totalContracts) * 100 : 0}%`
                      }}
                    />
                    <div
                      className="bg-gray-600 h-full transition-all duration-500"
                      style={{
                        width: `${analytics.totalContracts > 0 ? (analytics.manuallyCreated / analytics.totalContracts) * 100 : 0}%`
                      }}
                    />
                  </div>

                  {/* Legend */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-purple-500" />
                      <span className="text-gray-300">Spheri Generated</span>
                      <span className="text-white font-medium">{analytics.spheriGenerated}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gray-600" />
                      <span className="text-gray-300">Manual</span>
                      <span className="text-white font-medium">{analytics.manuallyCreated}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status breakdown */}
              <div className="ns-card p-6">
                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-ns-teal" />
                  Contract Status
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Signed</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-ns-dark-700 rounded-full overflow-hidden">
                        <div
                          className="bg-green-500 h-full"
                          style={{
                            width: `${analytics.totalContracts > 0 ? (analytics.signedContracts / analytics.totalContracts) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <span className="text-white font-medium w-8 text-right">{analytics.signedContracts}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Pending</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-ns-dark-700 rounded-full overflow-hidden">
                        <div
                          className="bg-purple-500 h-full"
                          style={{
                            width: `${analytics.totalContracts > 0 ? (analytics.pendingContracts / analytics.totalContracts) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <span className="text-white font-medium w-8 text-right">{analytics.pendingContracts}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Other</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-ns-dark-700 rounded-full overflow-hidden">
                        <div
                          className="bg-gray-500 h-full"
                          style={{
                            width: `${analytics.totalContracts > 0 ? ((analytics.totalContracts - analytics.signedContracts - analytics.pendingContracts) / analytics.totalContracts) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <span className="text-white font-medium w-8 text-right">
                        {analytics.totalContracts - analytics.signedContracts - analytics.pendingContracts}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Weekly trend */}
            <div className="ns-card p-6">
              <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-ns-teal" />
                Weekly Trend
              </h3>
              <div className="flex items-end gap-2 h-40">
                {analytics.weeklyTrend.map((week, index) => (
                  <div key={index} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center gap-1" style={{ height: '120px' }}>
                      <div
                        className="w-full bg-ns-teal/80 rounded-t transition-all duration-300"
                        style={{
                          height: `${Math.max(4, (week.contracts / Math.max(...analytics.weeklyTrend.map(w => w.contracts), 1)) * 100)}%`
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 truncate w-full text-center">{week.week}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-6 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-ns-teal/80" />
                  <span className="text-gray-400">Total Contracts</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="ns-card p-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No analytics data</h3>
            <p className="text-gray-400">Analytics will appear once you have contracts</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

