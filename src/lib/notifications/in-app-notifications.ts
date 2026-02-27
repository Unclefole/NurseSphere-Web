/**
 * In-App Notifications — NurseSphere
 * Server-side only. Stores notifications in Supabase `notifications` table.
 *
 * HIPAA: No PHI stored in notifications. Metadata should contain only IDs/counts.
 * All write operations are expected to be audit-logged by the caller.
 */

import { createClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'credential_expiring'
  | 'shift_offer'
  | 'timecard_approved'
  | 'invoice_created'
  | 'compliance_alert'

export interface InAppNotification {
  id: string
  user_id: string
  facility_id: string | null
  type: NotificationType
  title: string
  message: string
  metadata: Record<string, unknown>
  read: boolean
  read_at: string | null
  created_at: string
}

export interface UnreadNotificationsResult {
  count: number
  notifications: InAppNotification[]
}

// ─── Admin Client ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── createInAppNotification ──────────────────────────────────────────────────

/**
 * Insert a new in-app notification for a user.
 * Returns the created notification, or null on failure.
 *
 * Callers are responsible for deduplication (check existing open compliance_alerts
 * before calling to avoid sending duplicate notifications in the same sweep cycle).
 */
export async function createInAppNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  metadata: Record<string, unknown> = {},
  facilityId?: string | null
): Promise<InAppNotification | null> {
  try {
    const supabase = getAdminClient()

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        facility_id: facilityId ?? null,
        type,
        title,
        message,
        metadata,
        read: false,
      })
      .select()
      .single()

    if (error) {
      console.warn('[InAppNotifications] createInAppNotification error:', error.message)
      return null
    }

    return data as InAppNotification
  } catch (err) {
    console.error('[InAppNotifications] createInAppNotification unexpected error:', err)
    return null
  }
}

// ─── getUnreadNotifications ───────────────────────────────────────────────────

/**
 * Returns the count and list of unread notifications for a user.
 * Returns newest first, capped at 50.
 */
export async function getUnreadNotifications(
  userId: string,
  limit = 50
): Promise<UnreadNotificationsResult> {
  try {
    const supabase = getAdminClient()

    const { data, error, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[InAppNotifications] getUnreadNotifications error:', error.message)
      return { count: 0, notifications: [] }
    }

    return {
      count: count ?? (data?.length ?? 0),
      notifications: (data ?? []) as InAppNotification[],
    }
  } catch (err) {
    console.error('[InAppNotifications] getUnreadNotifications unexpected error:', err)
    return { count: 0, notifications: [] }
  }
}

// ─── getNotifications ─────────────────────────────────────────────────────────

/**
 * Returns all notifications for a user (read + unread), newest first.
 * Optionally filter by type.
 */
export async function getNotifications(
  userId: string,
  options?: { type?: NotificationType; limit?: number; offset?: number }
): Promise<InAppNotification[]> {
  try {
    const supabase = getAdminClient()
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase
      .from('notifications')
      .select('id, user_id, facility_id, type, title, message, metadata, read, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (options?.type) {
      query = query.eq('type', options.type)
    }

    const { data, error } = await query
    if (error) {
      console.warn('[InAppNotifications] getNotifications error:', error.message)
      return []
    }

    return (data ?? []) as InAppNotification[]
  } catch (err) {
    console.error('[InAppNotifications] getNotifications unexpected error:', err)
    return []
  }
}

// ─── markAsRead ───────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read for a user.
 * userId check prevents marking other users' notifications.
 */
export async function markAsRead(
  notificationId: string,
  userId: string
): Promise<boolean> {
  try {
    const supabase = getAdminClient()
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: now })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .eq('read', false) // only update if currently unread

    if (error) {
      console.warn('[InAppNotifications] markAsRead error:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.error('[InAppNotifications] markAsRead unexpected error:', err)
    return false
  }
}

// ─── markAllAsRead ────────────────────────────────────────────────────────────

/**
 * Mark all unread notifications for a user as read.
 * Returns the count of notifications marked.
 */
export async function markAllAsRead(userId: string): Promise<number> {
  try {
    const supabase = getAdminClient()
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: now })
      .eq('user_id', userId)
      .eq('read', false)
      .select('id')

    if (error) {
      console.warn('[InAppNotifications] markAllAsRead error:', error.message)
      return 0
    }

    return data?.length ?? 0
  } catch (err) {
    console.error('[InAppNotifications] markAllAsRead unexpected error:', err)
    return 0
  }
}
