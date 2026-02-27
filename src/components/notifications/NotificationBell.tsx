'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Bell, BellRing, Check, CheckCheck, ChevronRight, X } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  metadata: Record<string, unknown>
  read: boolean
  read_at: string | null
  created_at: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function typeColor(type: string): string {
  switch (type) {
    case 'credential_expiring': return 'text-amber-400'
    case 'compliance_alert': return 'text-red-400'
    case 'shift_offer': return 'text-ns-teal'
    case 'timecard_approved': return 'text-green-400'
    case 'invoice_created': return 'text-blue-400'
    default: return 'text-gray-400'
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?unread=false&limit=5')
      if (!res.ok) return
      const json = await res.json()
      setNotifications(json.notifications ?? [])

      // Also get unread count separately
      const unreadRes = await fetch('/api/notifications?unread=true&limit=1')
      if (unreadRes.ok) {
        const unreadJson = await unreadRes.json()
        setUnreadCount(unreadJson.unread_count ?? 0)
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount + poll every 60s for badge updates
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleToggle = () => {
    if (!open) fetchNotifications()
    setOpen((v) => !v)
  }

  const handleMarkRead = async (id: string) => {
    // Optimistic update
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
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative flex items-center justify-center w-9 h-9 rounded-full border border-ns-dark-600 bg-ns-dark-800 text-gray-300 hover:text-white hover:border-ns-teal/50 transition-colors"
      >
        {unreadCount > 0 ? (
          <BellRing className="w-4 h-4 text-ns-teal animate-pulse" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-lg border border-ns-dark-600 bg-ns-dark-800 shadow-xl animate-fade-in z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-ns-dark-600">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAll}
                  disabled={markingAll}
                  className="flex items-center gap-1 text-xs text-ns-teal hover:text-ns-teal/80 transition-colors disabled:opacity-50"
                  title="Mark all read"
                >
                  <CheckCheck className="w-3 h-3" />
                  {markingAll ? 'Marking…' : 'Mark all read'}
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-white transition-colors"
                aria-label="Close notifications"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
                Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-500">
                <Bell className="w-6 h-6 opacity-40" />
                <span className="text-sm">No notifications</span>
              </div>
            ) : (
              <ul className="py-1">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-ns-dark-700/50 transition-colors ${
                      !n.read ? 'bg-ns-dark-750/30' : ''
                    }`}
                  >
                    {/* Unread dot */}
                    <div className="flex-shrink-0 mt-1.5">
                      {!n.read ? (
                        <div className="w-2 h-2 rounded-full bg-ns-teal" />
                      ) : (
                        <div className="w-2 h-2" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold uppercase tracking-wider mb-0.5 ${typeColor(n.type)}`}>
                        {n.type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-sm text-white leading-snug">{n.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{n.message}</p>
                      <p className="text-xs text-gray-600 mt-1">{timeAgo(n.created_at)}</p>
                    </div>

                    {/* Mark read button */}
                    {!n.read && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        className="flex-shrink-0 mt-1 text-gray-500 hover:text-ns-teal transition-colors"
                        title="Mark as read"
                        aria-label="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-ns-dark-600 px-4 py-2">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between text-xs text-ns-teal hover:text-ns-teal/80 transition-colors"
            >
              <span>View all notifications</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
