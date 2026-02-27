/**
 * Server-side Supabase helpers for Next.js App Router API routes.
 * Uses @supabase/ssr for cookie-based session management.
 */
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

/**
 * Create a Supabase client for use in Server Components and Route Handlers.
 * This respects the logged-in user's session via cookies.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Route Handler context — ignore
          }
        },
      },
    }
  )
}

/**
 * Create a Supabase admin client using the service role key.
 * Only use for privileged server operations (webhooks, cron jobs).
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin operations.')
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Get the authenticated user's ID and hospital association from the session.
 * Returns null if not authenticated.
 */
export async function getAuthenticatedHospital(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<{
  userId: string
  hospitalId: string
  email: string
} | null> {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  // Look up facility association
  const { data: facilityAdminRaw } = await supabase
    .from('facility_admins')
    .select('facility_id')
    .eq('profile_id', user.id)
    .limit(1)
    .single()

  const facilityAdmin = facilityAdminRaw as { facility_id: string } | null

  if (!facilityAdmin?.facility_id) return null

  return {
    userId: user.id,
    hospitalId: facilityAdmin.facility_id,
    email: user.email ?? '',
  }
}

/**
 * Get the authenticated user from the session (any role).
 */
export async function getAuthenticatedUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<{
  userId: string
  email: string
  role: string
} | null> {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: string } | null

  return {
    userId: user.id,
    email: user.email ?? '',
    role: profile?.role ?? 'unknown',
  }
}
