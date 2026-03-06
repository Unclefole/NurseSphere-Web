/**
 * tRPC Proxy Route
 *
 * Forwards all /api/trpc/* requests from nursesphere-web (Next.js) to the
 * NurseSphere Hono backend, which hosts the full tRPC router with 150+ procedures.
 *
 * The Expo app uses EXPO_PUBLIC_RORK_API_BASE_URL=https://nursesphere-web.vercel.app,
 * so all tRPC calls land here and are transparently proxied to the real backend.
 *
 * Backend URL: process.env.RORK_BACKEND_URL (set in .env.local / Vercel env vars)
 */
import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL =
  process.env.RORK_BACKEND_URL || 'https://rork-nursesphere-624.vercel.app'

/**
 * Build the upstream URL by replacing our origin with the backend URL.
 * e.g. https://nursesphere-web.vercel.app/api/trpc/notifications.getUnreadCount?batch=1&input=...
 *   → https://rork-nursesphere-624.vercel.app/api/trpc/notifications.getUnreadCount?batch=1&input=...
 */
function buildUpstreamUrl(request: NextRequest): string {
  const url = new URL(request.url)
  return `${BACKEND_URL}${url.pathname}${url.search}`
}

/**
 * Strip hop-by-hop headers that must not be forwarded.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  // Next.js/Vercel internal headers
  'x-middleware-preflight',
  'x-nextjs-data',
])

function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  // Identify the proxy to the backend for debugging
  headers.set('x-forwarded-by', 'nursesphere-web-trpc-proxy')
  return headers
}

async function proxyRequest(request: NextRequest): Promise<NextResponse> {
  const upstreamUrl = buildUpstreamUrl(request)

  let body: BodyInit | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Read and forward the raw body (tRPC uses JSON)
    body = await request.text()
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildForwardHeaders(request),
      body,
      // Required for fetch in Node.js server environments
      // @ts-ignore — duplex is valid but not in all TS type definitions
      duplex: 'half',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Proxy fetch failed'
    console.error('[tRPC Proxy] Upstream fetch error:', message, upstreamUrl)
    return NextResponse.json(
      [
        {
          error: {
            message: `tRPC proxy: upstream unreachable — ${message}`,
            code: -32603,
            data: {
              code: 'INTERNAL_SERVER_ERROR',
              httpStatus: 503,
              cause: 'PROXY_FETCH_ERROR',
            },
          },
        },
      ],
      { status: 200 } // tRPC batch responses always return 200
    )
  }

  // Forward response headers (strip hop-by-hop)
  const responseHeaders = new Headers()
  upstreamResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })
  // Ensure CORS for the mobile app
  responseHeaders.set('Access-Control-Allow-Origin', '*')
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  responseHeaders.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  )

  const responseBody = await upstreamResponse.text()

  return new NextResponse(responseBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request)
}

// Handle CORS preflight from the mobile app
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}
