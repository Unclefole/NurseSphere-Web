/**
 * GET /api/audit/export
 * Exports audit logs as CSV for a given date range.
 * Admin-only. Sanitizes PHI from exported records.
 *
 * Query params:
 *   from  — ISO date string (start, inclusive)
 *   to    — ISO date string (end, inclusive)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { writeAuditLog } from '@/lib/audit'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase service env vars')
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
      },
    }
  )
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/** PHI field names to scrub from metadata exports */
const PHI_FIELDS = [
  'full_name', 'name', 'email', 'phone', 'dob', 'date_of_birth',
  'ssn', 'mrn', 'address', 'ip_address', 'content', 'notes',
]

function sanitizeMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return ''
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (PHI_FIELDS.some((f) => key.toLowerCase().includes(f))) {
      cleaned[key] = '[REDACTED]'
    } else {
      cleaned[key] = value
    }
  }
  return JSON.stringify(cleaned)
}

function escapeCsv(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(request: NextRequest) {
  // 1. Authenticate
  const authUser = await getAuthenticatedUser(request)
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // 2. Verify admin role
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', authUser.id)
    .single()

  if (profile?.role !== 'hospital_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Parse date range params
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const to = toParam ? new Date(toParam) : new Date()

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  // Clamp "to" to end of day
  to.setHours(23, 59, 59, 999)

  // 4. Fetch audit logs
  const { data: logs, error } = await admin
    .from('audit_logs')
    .select('id, user_id, action, resource_type, resource_id, metadata, created_at')
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .order('created_at', { ascending: false })
    .limit(10000) // Safety cap

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // 5. Build CSV
  const csvRows: string[] = []
  csvRows.push(
    ['timestamp', 'user_id', 'action', 'resource_type', 'resource_id', 'metadata'].join(',')
  )

  for (const log of logs ?? []) {
    csvRows.push(
      [
        escapeCsv(log.created_at),
        escapeCsv(log.user_id),
        escapeCsv(log.action),
        escapeCsv(log.resource_type),
        escapeCsv(log.resource_id),
        escapeCsv(sanitizeMetadata(log.metadata as Record<string, unknown> | null)),
      ].join(',')
    )
  }

  const csv = csvRows.join('\n')
  const filename = `nursesphere-audit-${from.toISOString().split('T')[0]}-to-${to.toISOString().split('T')[0]}.csv`

  // 6. Log this export event
  await writeAuditLog({
    actor_id: authUser.id,
    action: 'audit_log.exported',
    target_type: 'audit_logs',
    target_id: null,
    metadata: {
      from: from.toISOString(),
      to: to.toISOString(),
      rowsExported: logs?.length ?? 0,
    },
  })

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
