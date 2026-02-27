'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Filter, RefreshCw } from 'lucide-react'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  metadata: Record<string, unknown>
  read: boolean
  read_at: string | null
  created_at: string
  facility_id: string | null
}

const TYPE_LABELS: Record<string, string> = {
  credential_expiring: 'Credential Expiring',
  shift_offer: 'Shift Offer',
  timecard_approved: 'Timecard Approved',
  invoice_created: 'Invoice Created',
  compliance_alert: 'Compliance Alert',
}

const TYPE_COLORS: Record<string, string> = {
  credential_expiring: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  compliance_alert: 'bg-red-500/10 text-red-400 border-red-500/20',
  shift_offer: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  timecard_approved: 'bg-green-500/10 text-green-400 border-green-500/20',
  invoice_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ')
}

function typeBadge(type: string) {
  return TYPE_COLORS[type] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const ALL_TYPES = Object.keys(TYPE_LABELS)

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (unreadOnly) params.set('unread', 'true')
      if (typeFilter !== 'all') params.set('type', typeFilter)
      const res = await fetch(`/api/notifications?${params}`)
      if (!res.ok) return
      const json = await res.json()
      setNotifications(json.notifications ?? [])
      if (unreadOnly) {
        setUnreadCount(json.unread_count ?? 0)
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [typeFilter, unreadOnly])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Separate unread count poll
  useEffect(() => {
    async function pollUnread() {
      try {
        const res = await fetch('/api/notifications?unread=true&limit=1')
        if (!res.ok) return
        const json = await res.json()
        setUnreadCount(json.unread_count ?? 0)
      } catch { /* swallow */ }
    }
    pollUnread()
  }, [])

  const handleMarkRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n))
    )
    setUnreadCount((c) => Math.max(0, c - 1))
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' })
  }

  const handleMarkAll = async () => {
    setMarkingAll(true)
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' })
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read: true, read_at: new Date().toISOString() }))
      )
      setUnreadCount(0)
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <DashboardHeader
        title="Notifications"
        subtitle="Stay up to date with credential alerts, shift offers, and compliance events"
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Type filter */}
        <div className="flex items-center gap-2 bg-ns-dark-800 border border-ns-dark-600 rounded-lg px-3 py-2">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-transparent text-sm text-white focus:outline-none"
          >
            <option value="all">All types</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </div>

        {/* Unread toggle */}
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border transition-colors ${
            unreadOnly
              ? 'bg-ns-teal/10 border-ns-teal/40 text-ns-teal'
              : 'bg-ns-dark-800 border-ns-dark-600 text-gray-300 hover:text-white'
          }`}
        >
          <Bell className="w-4 h-4" />
          Unread only
          {unreadCount > 0 && (
            <span className="ml-1 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Mark all read */}
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAll}
            disabled={markingAll}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-ns-dark-800 border border-ns-dark-600 text-gray-300 hover:text-white hover:border-ns-teal/40 transition-colors disabled:opacity-50"
          >
            <CheckCheck className="w-4 h-4" />
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        )}

        {/* Refresh */}
        <button
          onClick={fetchNotifications}
          disabled={loading}
          className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
          title="Refresh"
          aria-label="Refresh notifications"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
          <Bell className="w-10 h-10 opacity-30" />
          <p className="text-sm">No notifications found</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              onClick={() => { if (!n.read) handleMarkRead(n.id) }}
              className={`rounded-lg border px-4 py-4 transition-all cursor-pointer select-none ${
                n.read
                  ? 'bg-ns-dark-850/40 border-ns-dark-700/50 opacity-70 hover:opacity-90'
                  : 'bg-ns-dark-800 border-ns-dark-600 hover:border-ns-teal/30'
              }`}
              title={n.read ? undefined : 'Click to mark as read'}
            >
              <div className="flex items-start gap-3">
                {/* Unread indicator */}
                <div className="flex-shrink-0 mt-2">
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-ns-teal" />
                  )}
                  {n.read && (
                    <div className="w-2 h-2" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {/* Type badge */}
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadge(n.type)}`}>
                      {typeLabel(n.type)}
                    </span>
                    {!n.read && (
                      <span className="text-[10px] font-semibold text-ns-teal uppercase tracking-wider">
                        New
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-white">{n.title}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{n.message}</p>

                  <p className="text-xs text-gray-600 mt-2">{formatDate(n.created_at)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
