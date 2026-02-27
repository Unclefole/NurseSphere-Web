/**
 * POST  /api/push/register  — Register / update an Expo push token
 * DELETE /api/push/register — Deactivate a push token on logout
 *
 * Supports both cookie-based sessions (web) and Bearer-token auth (mobile).
 * Upserts on (user_id, platform) — one active token per platform per user.
 *
 * Body: { token: string, platform: 'ios'|'android'|'web', device_id?: string }
 *
 * HIPAA / Security:
 *   - Tokens are not PHI but must be user-scoped (RLS enforced)
 *   - Audit logged (action, user_id, platform only — no token value logged)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'

// ─── Auth helper: cookie OR Bearer ────────────────────────────────────────────

async function resolveUserId(request: NextRequest): Promise<string | null> {
  // 1. Try Bearer token from Authorization header (mobile)
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const jwt = authHeader.slice(7)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    if (!url || !anonKey) return null

    // Create a user-scoped client with the provided JWT
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error } = await supabase.auth.getUser()
    if (!error && user?.id) return user.id
  }

  // 2. Fall back to cookie-based session (web)
  const supabase = await createSupabaseServerClient()
  const user = await getAuthenticatedUser(supabase)
  return user?.userId ?? null
}

// ─── POST — register / upsert token ───────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await resolveUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.token || !body?.platform) {
      return NextResponse.json(
        { error: 'Missing required fields: token, platform' },
        { status: 400 }
      )
    }

    const { token, platform, device_id } = body as {
      token: string
      platform: 'ios' | 'android' | 'web'
      device_id?: string
    }

    if (!['ios', 'android', 'web'].includes(platform)) {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: upsertError } = await admin
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          token,
          platform,
          device_id: device_id ?? null,
          active: true,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      )

    if (upsertError) {
      console.error('[POST /api/push/register] Upsert error:', upsertError.message)
      return NextResponse.json({ error: 'Failed to register token' }, { status: 500 })
    }

    await writeAuditLog({
      actor_id: userId,
      action: 'push.token_registered',
      target_id: userId,
      target_type: 'push_token',
      metadata: {
        platform,
        // HIPAA: never log the token value itself
        has_device_id: Boolean(device_id),
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/push/register] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── DELETE — deactivate token on logout ──────────────────────────────────────

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await resolveUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.token) {
      return NextResponse.json({ error: 'Missing required field: token' }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error } = await admin
      .from('push_tokens')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('token', body.token)

    if (error) {
      console.error('[DELETE /api/push/register] Update error:', error.message)
      return NextResponse.json({ error: 'Failed to deactivate token' }, { status: 500 })
    }

    await writeAuditLog({
      actor_id: userId,
      action: 'push.token_deactivated',
      target_id: userId,
      target_type: 'push_token',
      metadata: { reason: 'user_request' },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/push/register] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
