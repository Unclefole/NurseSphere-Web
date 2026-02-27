/**
 * NurseSphere – Server-side Role Guard
 *
 * requireRole(requiredRole, request) — server-side check for API route handlers.
 * This module runs server-only; never import it in client components.
 *
 * Usage:
 *   import { requireRole } from '@/lib/auth/server-role-guard'
 *
 *   export async function POST(request: Request) {
 *     const check = await requireRole('hospital_admin', request)
 *     if (check.errorResponse) return check.errorResponse
 *     // check.userId is available
 *   }
 */

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { UserRole } from '@/types/database'

/**
 * Checks the Supabase session from cookies and verifies the user has the
 * required role. Returns the user's role on success, or an error Response.
 *
 * Uses the anon key + RLS — does NOT use the service-role key.
 */
export async function requireRole(
  requiredRole: UserRole | UserRole[],
  // request parameter reserved for future per-request IP logging
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _request?: Request,
): Promise<
  | { userId: string; role: UserRole; errorResponse: null }
  | { userId: null; role: null; errorResponse: Response }
> {
  const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole]

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return {
      userId: null,
      role: null,
      errorResponse: new Response(
        JSON.stringify({ error: 'Service Unavailable', message: 'Auth not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  const cookieStore = await cookies()

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Read-only in route handlers; mutations handled by middleware
      setAll: () => {},
    },
  })

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError || !session?.user) {
    return {
      userId: null,
      role: null,
      errorResponse: new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  // Fetch the user's role from profiles
  // (anon key + RLS — user can only read their own profile row)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (profileError || !profile) {
    console.error('[requireRole] Failed to fetch profile:', profileError?.message)
    return {
      userId: null,
      role: null,
      errorResponse: new Response(
        JSON.stringify({ error: 'Forbidden', message: 'Profile not found' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  const userRole = profile.role as UserRole

  if (!allowed.includes(userRole)) {
    console.warn(
      `[requireRole] DENIED userId=${session.user.id} role=${userRole} required=${allowed.join(',')}`,
    )
    return {
      userId: null,
      role: null,
      errorResponse: new Response(
        JSON.stringify({
          error: 'Forbidden',
          message: `Requires role: ${allowed.join(' or ')}`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  return { userId: session.user.id, role: userRole, errorResponse: null }
}
