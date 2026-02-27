/**
 * POST /api/notifications/read-all
 *
 * Mark all unread notifications as read for the authenticated user.
 * Returns the count of notifications marked.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { markAllAsRead } from '@/lib/notifications/in-app-notifications'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const count = await markAllAsRead(user.userId)
    return NextResponse.json({ ok: true, marked: count })
  } catch (err) {
    console.error('[POST /api/notifications/read-all] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
