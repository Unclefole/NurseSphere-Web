/**
 * NurseSphere Push Sender (web / server-side)
 *
 * Sends push notifications via the Expo Push Notification API.
 * No Expo SDK required — plain fetch to https://exp.host/--/api/v2/push/send
 *
 * Rules:
 *   - No PHI in logs (no notification body content logged)
 *   - 'DeviceNotRegistered' errors auto-deactivate token in DB
 *   - All sends are audit-logged (type + count only, no body)
 *   - Graceful degradation: failures are caught and logged, never re-thrown
 *
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */

import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PushNotificationPayload {
  title: string
  body: string
  data: {
    type: string
    id?: string
    [key: string]: unknown
  }
  badge?: number
}

interface ExpoMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
  sound?: 'default' | null
  priority?: 'default' | 'normal' | 'high'
  channelId?: string
}

interface ExpoTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

// ─── Supabase admin client ─────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Fetch active tokens for a user ──────────────────────────────────────────

async function getActiveTokens(userId: string): Promise<{ id: string; token: string; platform: string }[]> {
  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('push_tokens')
    .select('id, token, platform')
    .eq('user_id', userId)
    .eq('active', true)

  if (error) {
    console.error('[PushSender] Error fetching tokens for', userId, ':', error.message)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as any[]
}

// ─── Deactivate a stale token ────────────────────────────────────────────────

async function deactivateToken(tokenId: string): Promise<void> {
  try {
    const supabase = getAdminClient()
    await supabase
      .from('push_tokens')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', tokenId)
    console.log('[PushSender] Token deactivated:', tokenId)
  } catch (err) {
    console.error('[PushSender] Failed to deactivate token:', err)
  }
}

// ─── Send to Expo Push API ────────────────────────────────────────────────────

async function sendToExpo(
  messages: ExpoMessage[],
  tokenIds: string[]
): Promise<void> {
  if (messages.length === 0) return

  // Expo API accepts up to 100 messages per request
  const chunks: Array<{ msgs: ExpoMessage[]; ids: string[] }> = []
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push({
      msgs: messages.slice(i, i + 100),
      ids: tokenIds.slice(i, i + 100),
    })
  }

  for (const chunk of chunks) {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.msgs),
      })

      if (!response.ok) {
        console.error('[PushSender] Expo API HTTP error:', response.status)
        continue
      }

      const result = await response.json() as { data: ExpoTicket[] }
      const tickets: ExpoTicket[] = result.data ?? []

      // Handle per-message errors
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j]
        if (ticket.status === 'error') {
          const errCode = ticket.details?.error
          console.error('[PushSender] Ticket error:', errCode, ticket.message)

          if (errCode === 'DeviceNotRegistered') {
            // Token is invalid — deactivate in DB
            await deactivateToken(chunk.ids[j])
          }
        }
      }
    } catch (chunkErr) {
      console.error('[PushSender] Chunk send failed:', chunkErr)
    }
  }
}

// ─── sendPushNotification ─────────────────────────────────────────────────────

/**
 * Send a push notification to a single user's active devices.
 *
 * @param userId        Target user UUID
 * @param notification  Payload (title, body, data, badge)
 */
export async function sendPushNotification(
  userId: string,
  notification: PushNotificationPayload
): Promise<void> {
  try {
    const tokens = await getActiveTokens(userId)
    if (tokens.length === 0) {
      console.log('[PushSender] No active tokens for user:', userId)
      return
    }

    const messages: ExpoMessage[] = tokens.map((t) => ({
      to: t.token,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      badge: notification.badge,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }))

    const tokenIds = tokens.map((t) => t.id)
    await sendToExpo(messages, tokenIds)

    // Audit log — PHI-safe: no body content, just type and count
    await writeAuditLog({
      actor_id: 'system',
      action: 'push.sent',
      target_id: userId,
      target_type: 'profile',
      metadata: {
        type: notification.data.type,
        tokens_sent: tokens.length,
        // HIPAA: body content intentionally omitted
      },
    })
  } catch (err) {
    // Graceful degradation — push failure must never block other operations
    console.error('[PushSender] sendPushNotification failed:', err)
  }
}

// ─── sendPushToFacilityAdmins ─────────────────────────────────────────────────

/**
 * Send a push notification to all active facility admins.
 *
 * @param facilityId   Facility UUID
 * @param notification  Payload
 */
export async function sendPushToFacilityAdmins(
  facilityId: string,
  notification: PushNotificationPayload
): Promise<void> {
  try {
    const supabase = getAdminClient()

    const { data: admins, error } = await supabase
      .from('facility_admins')
      .select('profile_id')
      .eq('facility_id', facilityId)

    if (error || !admins || admins.length === 0) {
      console.log('[PushSender] No admins found for facility:', facilityId)
      return
    }

    // Fire-and-forget to each admin (errors are swallowed inside sendPushNotification)
    await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admins.map((a: any) => sendPushNotification(a.profile_id, notification))
    )

    await writeAuditLog({
      actor_id: 'system',
      action: 'push.sent_facility_admins',
      target_id: facilityId,
      target_type: 'facility',
      metadata: {
        type: notification.data.type,
        admin_count: admins.length,
      },
    })
  } catch (err) {
    console.error('[PushSender] sendPushToFacilityAdmins failed:', err)
  }
}
