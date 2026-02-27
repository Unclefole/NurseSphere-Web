/**
 * POST /api/notifications/[id]/read
 *
 * Mark a single notification as read for the authenticated user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { markAsRead } from '@/lib/notifications/in-app-notifications'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing notification id' }, { status: 400 })
    }

    const success = await markAsRead(id, user.userId)

    if (!success) {
      // Could be already read or not found — treat as idempotent success
      return NextResponse.json({ ok: true, alreadyRead: true })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/notifications/[id]/read] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
