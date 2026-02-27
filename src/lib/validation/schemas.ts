/**
 * NurseSphere – Common Zod validation schemas (Zod v4)
 *
 * Usage:
 *   import { validateBody, emailSchema, uuidSchema } from '@/lib/validation/schemas'
 *
 *   const data = await validateBody(loginSchema, requestBody)
 *   // throws ZodValidationError (caught by the API handler) on bad input
 */
import { z, ZodSchema, ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .email('Invalid email address')
  .max(320, 'Email too long')
  .min(1, 'Email is required')

export const uuidSchema = z
  .string()
  .uuid('Invalid UUID format')
  .min(1, 'ID is required')

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')

// ---------------------------------------------------------------------------
// Domain-specific ID schemas (aliases for clarity in API handlers)
// ---------------------------------------------------------------------------

export const hospitalIdSchema = uuidSchema
export const nurseIdSchema = uuidSchema
export const facilityIdSchema = uuidSchema
export const invoiceIdSchema = uuidSchema
export const shiftIdSchema = uuidSchema
export const contractIdSchema = uuidSchema

// ---------------------------------------------------------------------------
// Date / range schemas
// ---------------------------------------------------------------------------

/** ISO 8601 date string (e.g. "2024-01-31") */
export const isodateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(val => !isNaN(Date.parse(val)), 'Invalid date')

export const dateRangeSchema = z
  .object({
    start: isodateSchema,
    end: isodateSchema,
  })
  .refine(range => new Date(range.start) <= new Date(range.end), {
    message: 'Start date must be on or before end date',
    path: ['start'],
  })

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['nurse', 'hospital_admin']).refine(
    val => ['nurse', 'hospital_admin'].includes(val),
    { message: 'Role must be nurse or hospital_admin' }
  ),
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
})

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

// ---------------------------------------------------------------------------
// Billing schemas
// ---------------------------------------------------------------------------

export const createInvoiceSchema = z.object({
  facilityId: facilityIdSchema,
  nurseId: nurseIdSchema.optional(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency must be a 3-letter ISO code').default('USD'),
  description: z.string().trim().max(500, 'Description too long').optional(),
  dueDate: isodateSchema.optional(),
})

export const paymentIntentSchema = z.object({
  invoiceId: invoiceIdSchema,
  amount: z.number().int().positive('Amount must be a positive integer (cents)'),
  currency: z.string().length(3).default('usd'),
})

export const payoutSchema = z.object({
  nurse_id: nurseIdSchema,
  amount: z
    .number()
    .positive('Amount must be > 0')
    .max(100_000, 'Amount exceeds maximum single payout'),
  shift_id: shiftIdSchema.optional(),
  description: z.string().trim().max(500).optional(),
})

export const attachPaymentMethodSchema = z.object({
  payment_method_id: z
    .string()
    .min(1, 'payment_method_id is required')
    .refine(val => val.startsWith('pm_'), 'Must be a valid Stripe payment method ID (starts with pm_)'),
  setup_intent_id: z
    .string()
    .refine(val => val.startsWith('seti_'), 'Must be a valid Stripe SetupIntent ID (starts with seti_)')
    .optional(),
})

export const payInvoiceSchema = z.object({
  invoice_id: invoiceIdSchema,
  payment_method_id: z
    .string()
    .refine(val => val.startsWith('pm_'), 'Must be a valid Stripe payment method ID')
    .optional(),
})

// ---------------------------------------------------------------------------
// Credentials schemas
// ---------------------------------------------------------------------------

export const uploadCredentialSchema = z.object({
  nurseId: nurseIdSchema,
  type: z.enum([
    'license',
    'certification',
    'background_check',
    'vaccination',
    'cpr',
    'other',
  ]),
  expiresAt: isodateSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
})

// ---------------------------------------------------------------------------
// Shift schemas
// ---------------------------------------------------------------------------

export const createShiftSchema = z
  .object({
    facilityId: facilityIdSchema,
    title: z.string().trim().min(1).max(200),
    startTime: z.string().datetime({ message: 'startTime must be ISO 8601 datetime' }),
    endTime: z.string().datetime({ message: 'endTime must be ISO 8601 datetime' }),
    hourlyRate: z.number().positive().optional(),
    specialty: z.string().trim().max(100).optional(),
    requiredCertifications: z.array(z.string()).optional(),
  })
  .refine(data => new Date(data.startTime) < new Date(data.endTime), {
    message: 'Shift start must be before end time',
    path: ['startTime'],
  })

// ---------------------------------------------------------------------------
// Reusable validator helper
// ---------------------------------------------------------------------------

export class ZodValidationError extends Error {
  public readonly fieldErrors: Record<string, string[]>
  public readonly status = 400

  constructor(zodError: ZodError) {
    const flat = zodError.flatten()
    super('Validation failed')
    this.name = 'ZodValidationError'
    this.fieldErrors = flat.fieldErrors as Record<string, string[]>
  }

  toResponse() {
    return {
      error: 'Validation Error',
      message: 'Request body contains invalid data',
      fields: this.fieldErrors,
    }
  }
}

/**
 * Parse and validate `body` against `schema`.
 * Returns the typed, parsed value on success.
 * Throws `ZodValidationError` (status 400) on failure.
 *
 * @example
 * const data = await validateBody(loginSchema, await req.json())
 */
export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ZodValidationError(result.error)
  }
  return result.data
}

/**
 * Convenience wrapper: parse the request body as JSON and validate.
 * Returns [data, null] on success or [null, Response] on failure.
 *
 * @example
 * const [data, errResponse] = await parseAndValidate(loginSchema, request)
 * if (errResponse) return errResponse
 */
export async function parseAndValidate<T>(
  schema: ZodSchema<T>,
  request: Request,
): Promise<[T, null] | [null, Response]> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return [
      null,
      new Response(
        JSON.stringify({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    ]
  }

  const result = schema.safeParse(body)
  if (!result.success) {
    const validationError = new ZodValidationError(result.error)
    return [
      null,
      new Response(JSON.stringify(validationError.toResponse()), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]
  }

  return [result.data, null]
}
