/**
 * GET /api/notifications
 *
 * List notifications for the authenticated user.
 *
 * Query params:
 *   ?type=   — filter by notification type
 *   ?unread= — if "true", return only unread
 *   ?limit=  — max results (default 50)
 *   ?offset= — pagination offset (default 0)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { getNotifications, getUnreadNotifications } from '@/lib/notifications/in-app-notifications'
import type { NotificationType } from '@/lib/notifications/in-app-notifications'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get('unread') === 'true'
    const type = searchParams.get('type') as NotificationType | null
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10)

    if (unreadOnly) {
      const result = await getUnreadNotifications(user.userId, limit)
      return NextResponse.json({
        notifications: result.notifications,
        unread_count: result.count,
      })
    }

    const notifications = await getNotifications(user.userId, {
      type: type ?? undefined,
      limit,
      offset,
    })

    return NextResponse.json({ notifications })
  } catch (err) {
    console.error('[GET /api/notifications] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
