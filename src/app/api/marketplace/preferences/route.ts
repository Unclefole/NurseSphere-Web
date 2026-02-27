/**
 * GET /api/marketplace/preferences  — Nurse: get own marketplace preferences
 * PUT /api/marketplace/preferences  — Nurse: update marketplace preferences
 *
 * RLS enforced. Nurses only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'

const prefsSchema = z.object({
  max_commute_miles: z.number().int().min(0).max(500).optional(),
  preferred_shift_types: z
    .array(z.enum(['day', 'night', 'weekend', 'prn']))
    .optional(),
  preferred_units: z.array(z.string().max(100)).optional(),
  preferred_roles: z.array(z.string().max(50)).optional(),
  min_hourly_rate: z.number().min(0).max(999).optional(),
  available_days: z
    .array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
    .optional(),
  marketplace_visible: z.boolean().optional(),
})

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'nurse') {
      return NextResponse.json({ error: 'Forbidden: nurse access only' }, { status: 403 })
    }

    const { data, error } = await (supabase as any)
      .from('nurse_marketplace_prefs')
      .select('id, nurse_id, max_commute_miles, preferred_shift_types, preferred_units, preferred_roles, min_hourly_rate, available_days, marketplace_visible, updated_at')
      .eq('nurse_id', user.userId)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows — return defaults
      if (error.code === '42P01') {
        return NextResponse.json({ preferences: null })
      }
      throw error
    }

    return NextResponse.json({ preferences: data ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace Preferences GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'nurse') {
      return NextResponse.json({ error: 'Forbidden: nurse access only' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = prefsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const updates = { ...parsed.data, nurse_id: user.userId }

    // Upsert — create or update
    const { data, error } = await (supabase as any)
      .from('nurse_marketplace_prefs')
      .upsert(updates, { onConflict: 'nurse_id' })
      .select()
      .single()

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ error: 'Preferences table not yet available' }, { status: 503 })
      }
      throw error
    }

    return NextResponse.json({ preferences: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace Preferences PUT] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
