'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ShieldCheck,
  CheckCircle,
  Info,
  Download,
  Globe,
  Activity,
  ShieldAlert,
} from 'lucide-react'

interface RecentActivity {
  id: string
  action: string
  created_at: string
  metadata: Record<string, unknown> | null
}

const SECURITY_CONTROLS = [
  {
    id: 'audit-logging',
    label: 'HIPAA-aligned audit logging',
    status: 'Active',
    description: 'All access to PHI and system actions are logged with timestamps, user IDs, and IP addresses.',
  },
  {
    id: 'session-timeout',
    label: 'Session timeout',
    status: '15 minutes',
    description: 'Idle sessions are automatically terminated after 15 minutes of inactivity.',
  },
  {
    id: 'encryption',
    label: 'Data encryption',
    status: 'AES-256 at rest, TLS 1.3 in transit',
    description: 'All stored data is encrypted with AES-256. Data in transit uses TLS 1.3.',
  },
  {
    id: 'rls',
    label: 'Row-level security',
    status: 'Enabled on all tables',
    description: 'Supabase RLS enforces multi-tenant isolation — users can only access their own facility data.',
  },
  {
    id: 'phi-logging',
    label: 'PHI access logging',
    status: 'Active',
    description: 'Every read and write involving protected health information generates an audit entry.',
  },
  {
    id: 'rate-limiting',
    label: 'Rate limiting',
    status: 'Active',
    description: 'API endpoints are rate-limited to prevent brute force and abuse.',
  },
]

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SecurityPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [activityLoading, setActivityLoading] = useState(true)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
    if (!loading && user && !isHospital) router.push('/nurse')
  }, [user, loading, isHospital, router])

  useEffect(() => {
    if (!user) return

    const fetchActivity = async () => {
      setActivityLoading(true)
      try {
        const { data } = await supabase
          .from('audit_logs')
          .select('id, action, created_at, metadata')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10)

        setRecentActivity(
          (data ?? []).map((r) => ({
            ...r,
            metadata: r.metadata as Record<string, unknown> | null,
          }))
        )
      } catch (err) {
        console.error('[Security] Activity fetch error:', err)
      } finally {
        setActivityLoading(false)
      }
    }

    fetchActivity()
  }, [user])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading security status...</div>
      </div>
    )
  }

  if (!user || !isHospital) return null

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <ShieldCheck className="h-7 w-7 text-ns-teal" />
          <div>
            <h1 className="text-2xl font-bold text-white">Security Status</h1>
            <p className="text-sm text-gray-400">
              Enterprise-grade security controls and HIPAA compliance overview
            </p>
          </div>
        </div>

        {/* Security Controls */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Security Controls</h2>
          <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-900 divide-y divide-ns-dark-700 overflow-hidden">
            {SECURITY_CONTROLS.map((control) => (
              <div key={control.id} className="flex items-start gap-4 px-5 py-4">
                <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-white">{control.label}</span>
                    <span className="inline-flex items-center rounded-full bg-green-500/20 border border-green-500/30 px-2.5 py-0.5 text-xs font-medium text-green-400">
                      {control.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{control.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* IP Logging Notice */}
        <section className="mb-8">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-5 py-4 flex items-start gap-3">
            <Globe className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-300">IP Address Logging</p>
              <p className="text-xs text-gray-400 mt-1">
                Your IP address is logged on every authenticated request for security and compliance purposes.
                IP addresses are stored in audit logs and retained per our data retention policy.
                This information is never shared with third parties except as required by law.
              </p>
            </div>
          </div>
        </section>

        {/* Recent Session Activity */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-gray-400" />
            <h2 className="text-lg font-semibold text-white">Recent Session Activity</h2>
          </div>
          <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-900 overflow-hidden">
            {activityLoading ? (
              <div className="py-8 text-center text-gray-500 text-sm">Loading activity...</div>
            ) : recentActivity.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-sm">No recent activity</div>
            ) : (
              <div className="divide-y divide-ns-dark-700">
                {recentActivity.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <span className="font-mono text-xs text-ns-teal bg-ns-teal/10 rounded px-1.5 py-0.5">
                        {entry.action}
                      </span>
                      {entry.metadata?.ipAddress != null && (
                        <span className="ml-3 text-xs text-gray-600 font-mono">
                          from {String(entry.metadata.ipAddress as string)}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(entry.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Fraud & Identity Shield */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Fraud & Identity Shield</h2>
          <Link
            href="/dashboard/security/fraud"
            className="flex items-center gap-4 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 hover:border-red-500/40 transition-colors group"
          >
            <ShieldAlert className="h-6 w-6 text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Suspicious Activity Events</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Review duplicate account detections, IP anomalies, rapid cancellations, and other
                fraud signals flagged by the Fraud Shield engine.
              </p>
            </div>
            <span className="text-xs text-gray-500 group-hover:text-ns-teal transition-colors">
              View →
            </span>
          </Link>
        </section>

        {/* Document Downloads */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Compliance Documents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/privacy"
              className="flex items-center gap-3 rounded-xl border border-ns-dark-700 bg-ns-dark-900 px-5 py-4 hover:border-ns-teal/40 transition-colors group"
            >
              <Download className="h-5 w-5 text-gray-500 group-hover:text-ns-teal transition-colors" />
              <div>
                <p className="text-sm font-medium text-white">Privacy Policy</p>
                <p className="text-xs text-gray-500">How we collect, use, and protect your data</p>
              </div>
            </Link>
            <Link
              href="/terms"
              className="flex items-center gap-3 rounded-xl border border-ns-dark-700 bg-ns-dark-900 px-5 py-4 hover:border-ns-teal/40 transition-colors group"
            >
              <Download className="h-5 w-5 text-gray-500 group-hover:text-ns-teal transition-colors" />
              <div>
                <p className="text-sm font-medium text-white">Data Security Disclosure</p>
                <p className="text-xs text-gray-500">Technical and organizational security measures</p>
              </div>
            </Link>
          </div>
        </section>

        {/* Info callout */}
        <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-800/50 px-5 py-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
          <p className="text-xs text-gray-500">
            NurseSphere operates under HIPAA Business Associate Agreement (BAA) requirements.
            For security incidents or data requests, contact{' '}
            <a href="mailto:security@nursesphere.io" className="text-ns-teal hover:underline">
              security@nursesphere.io
            </a>
            . All security events are responded to within 24 hours.
          </p>
        </div>
      </div>
    </DashboardLayout>
  )
}
