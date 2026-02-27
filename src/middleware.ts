import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { phiGuardMiddleware } from '@/middleware/phi-guard'

// ---------------------------------------------------------------------------
// In-memory rate limiter (Map-based fallback — no Redis required)
// Suitable for single-instance deployments; swap for Redis in multi-instance.
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up stale entries every 5 minutes to prevent unbounded memory growth
let lastCleanup = Date.now()
function maybeCleanupStore() {
  const now = Date.now()
  if (now - lastCleanup > 5 * 60 * 1000) {
    lastCleanup = now
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now - entry.windowStart > 15 * 60 * 1000) {
        rateLimitStore.delete(key)
      }
    }
  }
}

type RateLimitConfig = { limit: number; windowMs: number }

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth:    { limit: 10, windowMs: 15 * 60 * 1000 }, // 10 req / 15 min  (auth endpoints)
  api:     { limit: 30, windowMs:      60 * 1000 }, // 30 req / 1 min   (general API)
  default: { limit: 100, windowMs:     60 * 1000 }, // 100 req / 1 min  (everything else)
}

/**
 * Returns null if request is allowed, or a 429 Response if rate-limited.
 * No PHI is logged — only IP + path prefix.
 */
function checkRateLimit(
  ip: string,
  pathname: string,
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  maybeCleanupStore()

  let config: RateLimitConfig
  let tier: string

  if (pathname.startsWith('/api/auth')) {
    tier = 'auth'
    config = RATE_LIMITS.auth
  } else if (pathname.startsWith('/api/')) {
    tier = 'api'
    config = RATE_LIMITS.api
  } else {
    tier = 'default'
    config = RATE_LIMITS.default
  }

  const key = `${tier}:${ip}`
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  if (!entry || now - entry.windowStart >= config.windowMs) {
    // Start new window
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return { allowed: true }
  }

  entry.count += 1

  if (entry.count > config.limit) {
    const retryAfterSec = Math.ceil((config.windowMs - (now - entry.windowStart)) / 1000)
    console.warn(
      `[RateLimit] BLOCKED ip=${ip} tier=${tier} count=${entry.count} limit=${config.limit} path=${pathname}`,
    )
    return { allowed: false, retryAfterSec }
  }

  return { allowed: true }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientIp(request: NextRequest): string {
  // Prefer forwarded header (set by Vercel / reverse proxy)
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}

// ---------------------------------------------------------------------------
// Middleware entry point
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  // ------------------------------------------------------------------
  // 1. Rate limiting — applied to /api/* routes
  // ------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    const ip = getClientIp(request)
    const result = checkRateLimit(ip, pathname)

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfter: result.retryAfterSec,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(result.retryAfterSec),
            'X-RateLimit-Limit': String(
              pathname.startsWith('/api/auth')
                ? RATE_LIMITS.auth.limit
                : RATE_LIMITS.api.limit,
            ),
          },
        },
      )
    }

    // PHI Guard — block any request body containing PHI field names
    // Runs on all /api/* routes after rate limiting. Returns 400 if PHI detected.
    const phiResponse = await phiGuardMiddleware(request)
    if (phiResponse) {
      return new NextResponse(phiResponse.body, {
        status: phiResponse.status,
        headers: phiResponse.headers,
      })
    }
  }

  // ------------------------------------------------------------------
  // 2. Auth session management (Supabase SSR cookie refresh)
  // ------------------------------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If credentials are not configured, skip auth middleware (allows UI testing)
  if (!supabaseUrl || !supabaseKey) {
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh session if expired — catch errors gracefully
  let session = null
  try {
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch (error) {
    console.error('[Middleware] Auth session error:', error)
  }

  // ------------------------------------------------------------------
  // 3. Onboarding redirect — only fires on /dashboard for authenticated users.
  //    Uses lightweight profile checks via the anon-key Supabase client.
  //    Nurses with no credentials → /onboarding/nurse
  //    Admins with no facility    → /onboarding/admin
  // ------------------------------------------------------------------
  if (pathname === '/dashboard' && session?.user) {
    try {
      const userId = session.user.id

      // Fetch profile role and facility_id in one query
      const profileResp = await supabase
        .from('profiles')
        .select('role, facility_id, first_name')
        .eq('id', userId)
        .single()

      const profile = profileResp.data

      if (profile) {
        if (profile.role === 'nurse') {
          // Check if nurse has at least one credential uploaded
          const credResp = await supabase
            .from('credentials')
            .select('id', { count: 'exact', head: true })
            .eq('nurse_id', userId)
          const credCount = typeof credResp.count === 'number' ? credResp.count : 0
          // percent_complete < 25 means step 1 done but no credentials
          if (credCount === 0) {
            const onboardingUrl = new URL('/onboarding/nurse', request.url)
            return NextResponse.redirect(onboardingUrl)
          }
        } else if (profile.role === 'hospital_admin') {
          // Check if admin has a facility configured with name + address
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const facilityId = (profile as any).facility_id
          if (!facilityId) {
            const onboardingUrl = new URL('/onboarding/admin', request.url)
            return NextResponse.redirect(onboardingUrl)
          }
          const facilityResp = await supabase
            .from('facilities')
            .select('name, address, type')
            .eq('id', facilityId)
            .single()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const facility = facilityResp.data as any
          if (!facility?.name || !facility?.address || !facility?.type) {
            const onboardingUrl = new URL('/onboarding/admin', request.url)
            return NextResponse.redirect(onboardingUrl)
          }
        }
      }
    } catch (err) {
      // Onboarding check is non-critical — log and continue
      console.warn('[Middleware] Onboarding check error:', err)
    }
  }

  // ------------------------------------------------------------------
  // 4. Route protection
  // ------------------------------------------------------------------
  const protectedRoutes = [
    '/dashboard',
    '/applicants',
    '/contracts',
    '/analytics',
    '/compliance',
    '/shifts',
    '/nurses',
    '/messages',
    '/billing',
    '/forecasting',
    '/map',
    '/crm',
    '/incidents',
    '/education',
    '/settings',
    '/admin',
    '/onboarding',
  ]

  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route),
  )

  const authRoutes = ['/auth/signin', '/auth/register']
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute && !session) {
    const redirectUrl = new URL('/auth/signin', request.url)
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (isAuthRoute && session) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image  (image optimisation)
     * - favicon.ico
     * - public-folder assets (files with extensions)
     *
     * NOTE: /api/* IS intentionally included so rate limiting fires.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
