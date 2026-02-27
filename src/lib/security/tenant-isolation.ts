/**
 * Tenant Isolation — NurseSphere
 *
 * Zero Trust enforcement helpers for multi-tenant facility scoping.
 * Every DB query touching tenant data MUST be scoped to a facility_id.
 *
 * Usage:
 *   1. Call assertFacilityScope(query, facilityId) before DB calls in service functions
 *   2. Use buildScopedQuery(supabase, table, facilityId) for pre-scoped SELECT builders
 *   3. Call validateTenantContext(userId, facilityId, supabase) in API routes to
 *      authenticate cross-facility access attempts
 *
 * All cross-facility violations throw — never silently degrade to unscoped queries.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Query scope assertion
// ---------------------------------------------------------------------------

/**
 * Asserts that a query object includes a facility_id scope.
 *
 * Checks for:
 *  - { facility_id: string }
 *  - { facility_id: { eq: string } }  (filter object style)
 *
 * Throws "Query missing facility_id scope" if not found.
 * Use at the top of service functions before executing DB queries.
 *
 * @param query      - Query parameters object to inspect
 * @param facilityId - Expected facility_id value (for validation)
 */
export function assertFacilityScope(query: object, facilityId: string): void {
  if (!facilityId || typeof facilityId !== 'string' || !facilityId.trim()) {
    throw new Error('[TenantIsolation] assertFacilityScope: facilityId must be a non-empty string')
  }

  const q = query as Record<string, unknown>

  // Check direct key
  if ('facility_id' in q) {
    const val = q['facility_id']
    // Accept direct value match
    if (val === facilityId) return
    // Accept filter object { eq: facilityId }
    if (val && typeof val === 'object' && (val as Record<string, unknown>)['eq'] === facilityId) return
    // facility_id key present but scoped to wrong facility — hard fail
    throw new Error(
      `[TenantIsolation] Query facility_id mismatch: expected="${facilityId}" got="${String(val)}"`
    )
  }

  throw new Error('[TenantIsolation] Query missing facility_id scope')
}

// ---------------------------------------------------------------------------
// Scoped query builder
// ---------------------------------------------------------------------------

/**
 * Returns a pre-scoped Supabase query builder for a given table.
 * Requires an explicit column list — no `select('*')` allowed.
 *
 * Usage:
 *
 *   const { data } = await buildScopedQuery(
 *     supabase, 'shifts', facilityId,
 *     'id, start_time, end_time, role, rate, status'
 *   ).order('start_time')
 *
 * @param supabase    - Supabase client instance
 * @param table       - Table name to query
 * @param facilityId  - Facility UUID to scope the query
 * @param columns     - Explicit comma-separated column list (required — minimum necessary data)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildScopedQuery(
  supabase: SupabaseClient,
  table: string,
  facilityId: string,
  columns: string
): any {
  if (!facilityId || typeof facilityId !== 'string' || !facilityId.trim()) {
    throw new Error('[TenantIsolation] buildScopedQuery: facilityId must be a non-empty string')
  }
  if (!columns || columns.trim() === '*') {
    throw new Error('[TenantIsolation] buildScopedQuery: explicit column list required — select("*") is prohibited')
  }
  return supabase.from(table).select(columns).eq('facility_id', facilityId)
}

// ---------------------------------------------------------------------------
// Tenant context validation
// ---------------------------------------------------------------------------

/**
 * Validates that a user belongs to a specific facility.
 *
 * Queries facility_admins table:
 *   profile_id = userId AND facility_id = facilityId
 *
 * Returns:
 *   true  — user is a confirmed admin of this facility
 *   false — user is NOT associated with this facility (cross-facility attempt)
 *
 * Use in API route handlers before processing any facility-scoped action.
 *
 * @param userId     - Auth user UUID (from auth.uid())
 * @param facilityId - Facility UUID to check membership
 * @param supabase   - Supabase client (use server client in API routes)
 */
export async function validateTenantContext(
  userId: string,
  facilityId: string,
  supabase: SupabaseClient
): Promise<boolean> {
  if (!userId || !facilityId) return false

  try {
    const { data, error } = await supabase
      .from('facility_admins')
      .select('profile_id, facility_id')
      .eq('profile_id', userId)
      .eq('facility_id', facilityId)
      .single()

    if (error || !data) return false
    return true
  } catch {
    return false
  }
}
