/**
 * PHI Guard Middleware — NurseSphere
 *
 * Blocks storage of Protected Health Information (PHI) fields on all API routes.
 * HIPAA constraint: NurseSphere is a workforce scheduling platform.
 * Patient data is architecturally excluded — never stored, never transmitted.
 *
 * Fields blocked: patient identifiers, clinical codes, biometrics.
 * What IS allowed: nurse credentials, facility info, shift metadata, timecard hours, compliance scores.
 */

// ---------------------------------------------------------------------------
// Blocked PHI field names (case-insensitive match)
// ---------------------------------------------------------------------------

export const BLOCKED_PHI_FIELDS: readonly string[] = [
  'patient_name',
  'patient_mrn',
  'diagnosis',
  'icd_code',
  'dob',
  'ssn',
  'social_security',
  'date_of_birth',
  'medical_record',
  'patient_id',
  'mrn',
] as const

/**
 * Allowed data schema — documents what IS permitted in the system.
 * Use this as a reference for API payload validation.
 */
export const ALLOWED_DATA_SCHEMA = {
  nurse: {
    credentials: ['license_number', 'license_state', 'license_type', 'expiry_date', 'file_url', 'file_hash'],
    profile: ['id', 'first_name', 'last_name', 'role', 'facility_id', 'phone', 'email'],
    compliance: ['compliance_score', 'last_sweep_at', 'issues_count'],
  },
  facility: {
    info: ['id', 'name', 'address', 'city', 'state', 'zip', 'type', 'contact_email'],
    settings: ['timezone', 'billing_cycle', 'invoice_terms'],
  },
  shift: {
    metadata: ['id', 'facility_id', 'unit', 'role', 'start_time', 'end_time', 'rate', 'status', 'notes'],
    application: ['id', 'shift_id', 'nurse_id', 'status', 'applied_at'],
  },
  timecard: {
    hours: ['id', 'shift_id', 'nurse_id', 'clock_in', 'clock_out', 'total_hours', 'status', 'disputed'],
  },
  compliance: {
    scores: ['nurse_id', 'facility_id', 'score', 'category', 'checked_at', 'issues'],
  },
} as const

// ---------------------------------------------------------------------------
// Core detection logic
// ---------------------------------------------------------------------------

/**
 * Recursively scans object keys (case-insensitive) for blocked PHI field names.
 * Returns array of detected field names (NOT their values — never log PHI values).
 */
export function detectPHIFields(obj: Record<string, unknown>): string[] {
  const detected: string[] = []
  const blockedSet = new Set(BLOCKED_PHI_FIELDS.map(f => f.toLowerCase()))

  function scan(current: unknown): void {
    if (!current || typeof current !== 'object') return
    if (Array.isArray(current)) {
      current.forEach(item => scan(item))
      return
    }
    const record = current as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (blockedSet.has(key.toLowerCase())) {
        detected.push(key)
      }
      // Recurse into nested objects
      const value = record[key]
      if (value && typeof value === 'object') {
        scan(value)
      }
    }
  }

  scan(obj)

  // Deduplicate while preserving order
  return [...new Set(detected)]
}

/**
 * Asserts that an object contains no PHI fields.
 * Throws a sanitized error if PHI fields are detected.
 * Never logs PHI values — only field names.
 *
 * @param obj     - Object to validate
 * @param context - Human-readable context string (e.g. 'credential upload handler')
 */
export function assertNoPHI(obj: Record<string, unknown>, context: string): void {
  const detected = detectPHIFields(obj)
  if (detected.length > 0) {
    // Warn with field names only — NEVER include values
    console.warn(
      `[PHIGuard] PHI fields detected in context="${context}" fields=[${detected.join(', ')}] — rejecting`
    )
    throw new Error(
      `PHI_FIELD_DETECTED: This platform does not store patient health information. ` +
      `Detected fields: ${detected.join(', ')}. Context: ${context}`
    )
  }
}

// ---------------------------------------------------------------------------
// HTTP middleware
// ---------------------------------------------------------------------------

/**
 * PHI guard middleware for Next.js API routes.
 * Call this for POST/PUT/PATCH requests before processing the body.
 *
 * Returns:
 *   - 400 Response if PHI fields are detected
 *   - null if the request body is clean (or method is not mutating)
 */
export async function phiGuardMiddleware(req: Request): Promise<Response | null> {
  const method = req.method?.toUpperCase()

  // Only inspect mutating requests
  if (!['POST', 'PUT', 'PATCH'].includes(method ?? '')) {
    return null
  }

  // Content-Type guard — only JSON bodies carry named fields
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return null
  }

  let body: Record<string, unknown>
  try {
    // Clone request to avoid consuming the body stream consumed by the real handler
    const cloned = req.clone()
    const text = await cloned.text()
    if (!text) return null
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    body = parsed as Record<string, unknown>
  } catch {
    // Malformed JSON — let the actual handler produce a proper error
    return null
  }

  const detected = detectPHIFields(body)
  if (detected.length > 0) {
    console.warn(`[PHIGuard] HTTP request blocked — PHI fields detected: [${detected.join(', ')}]`)
    return new Response(
      JSON.stringify({
        error: 'PHI_FIELD_DETECTED',
        fields: detected,
        message: 'This platform does not store patient health information',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  return null
}
