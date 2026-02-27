/**
 * Admin (facility) onboarding progress calculator.
 * Uses service-role client for server-side calls.
 * No PHI is returned — only boolean completion flags and step metadata.
 */
import { createClient } from '@supabase/supabase-js'

export interface OnboardingStep {
  id: string
  label: string
  description: string
  completed: boolean
  required: boolean
}

export interface OnboardingProgress {
  steps: OnboardingStep[]
  percent_complete: number
  next_step: string
}

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase configuration missing for onboarding progress.')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function getAdminOnboardingProgress(
  _userId: string,
  facilityId: string,
): Promise<OnboardingProgress> {
  const supabase = getClient()

  const [facilityRes, baselinesRes, paymentRes, shiftRes] = await Promise.all([
    // Step 1: Facility profile completeness
    supabase
      .from('facilities')
      .select('name, address, type, unit_types')
      .eq('id', facilityId)
      .single(),

    // Step 2: Cost baselines — agency_avg_rate set
    supabase
      .from('cost_baselines')
      .select('agency_avg_rate')
      .eq('facility_id', facilityId)
      .single(),

    // Step 3: Stripe payment method — stripe_payment_method_id on facility or billing profile
    supabase
      .from('facilities')
      .select('stripe_customer_id, stripe_payment_method_id')
      .eq('id', facilityId)
      .single(),

    // Step 4: At least one shift posted
    supabase
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId),
  ])

  // Step 1: name, address, type all set (unit_types is optional but encouraged)
  const facility = facilityRes.data
  const facilityComplete = Boolean(
    facility?.name && facility?.address && facility?.type,
  )

  // Step 2: agency_avg_rate must be a positive number
  const baselines = baselinesRes.data
  const baselineComplete = Boolean(
    baselines &&
      typeof baselines.agency_avg_rate === 'number' &&
      baselines.agency_avg_rate > 0,
  )

  // Step 3: payment method added
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentData = paymentRes.data as any
  const paymentComplete = Boolean(
    paymentData?.stripe_payment_method_id || paymentData?.stripe_customer_id,
  )

  // Step 4: at least one shift
  const shiftCount = typeof shiftRes.count === 'number' ? shiftRes.count : 0
  const shiftPosted = shiftCount > 0

  const steps: OnboardingStep[] = [
    {
      id: 'facility',
      label: 'Complete facility profile',
      description: 'Enter your facility name, address, type and unit types',
      completed: facilityComplete,
      required: true,
    },
    {
      id: 'baselines',
      label: 'Set cost baselines',
      description: 'Configure agency average rate and MSP fee percentage',
      completed: baselineComplete,
      required: false,
    },
    {
      id: 'payment',
      label: 'Add payment method',
      description: 'Connect a credit card or bank account for billing',
      completed: paymentComplete,
      required: false,
    },
    {
      id: 'shift',
      label: 'Post your first shift',
      description: 'Create a shift to start finding qualified nurses',
      completed: shiftPosted,
      required: false,
    },
  ]

  const completedCount = steps.filter((s) => s.completed).length
  const percent_complete = Math.round((completedCount / steps.length) * 100)

  const firstIncomplete = steps.find((s) => !s.completed)
  const next_step = firstIncomplete ? firstIncomplete.id : 'dashboard'

  return { steps, percent_complete, next_step }
}
