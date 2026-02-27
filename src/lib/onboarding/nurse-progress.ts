/**
 * Nurse onboarding progress calculator.
 * Uses the Supabase service-role client so it works in server components and API routes.
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
  next_step: string // route or step id
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

export async function getNurseOnboardingProgress(
  userId: string,
): Promise<OnboardingProgress> {
  const supabase = getClient()

  // Run all queries in parallel
  const [profileRes, credentialsRes, availabilityShiftsRes, availabilityPrefsRes, payoutRes] =
    await Promise.all([
      // Step 1: Profile completeness
      supabase
        .from('profiles')
        .select('first_name, last_name, phone')
        .eq('id', userId)
        .single(),

      // Step 2: At least one credential
      supabase
        .from('credentials')
        .select('id', { count: 'exact', head: true })
        .eq('nurse_id', userId),

      // Step 3a: Shift preferences / availability records
      supabase
        .from('nurse_availability')
        .select('id', { count: 'exact', head: true })
        .eq('nurse_id', userId),

      // Step 3b: Shift preference table (fallback)
      supabase
        .from('shift_preferences')
        .select('id', { count: 'exact', head: true })
        .eq('nurse_id', userId),

      // Step 4: Stripe payout status
      supabase
        .from('profiles')
        .select('stripe_onboarding_status')
        .eq('id', userId)
        .single(),
    ])

  // --- Evaluate each step ---

  // Step 1: first_name, last_name, phone all set
  const profile = profileRes.data
  const profileComplete = Boolean(
    profile?.first_name && profile?.last_name && profile?.phone,
  )

  // Step 2: at least one credential row
  const credentialCount =
    typeof credentialsRes.count === 'number' ? credentialsRes.count : 0
  const credentialComplete = credentialCount > 0

  // Step 3: at least one availability or shift_preference row
  const availabilityCount =
    typeof availabilityShiftsRes.count === 'number'
      ? availabilityShiftsRes.count
      : 0
  const preferenceCount =
    typeof availabilityPrefsRes.count === 'number'
      ? availabilityPrefsRes.count
      : 0
  const availabilityComplete = availabilityCount + preferenceCount > 0

  // Step 4: Stripe payout connected
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripeStatus = (payoutRes.data as any)?.stripe_onboarding_status
  const payoutComplete = stripeStatus === 'complete'

  const steps: OnboardingStep[] = [
    {
      id: 'profile',
      label: 'Complete your profile',
      description: 'Add your name, phone, specialty and experience',
      completed: profileComplete,
      required: true,
    },
    {
      id: 'credentials',
      label: 'Upload credentials',
      description: 'Add at least one nursing credential or license',
      completed: credentialComplete,
      required: true,
    },
    {
      id: 'availability',
      label: 'Set availability',
      description: 'Choose your preferred days and shift types',
      completed: availabilityComplete,
      required: false,
    },
    {
      id: 'payout',
      label: 'Connect payout',
      description: 'Set up Stripe to receive payments',
      completed: payoutComplete,
      required: false,
    },
  ]

  const completedCount = steps.filter((s) => s.completed).length
  const percent_complete = Math.round((completedCount / steps.length) * 100)

  // next_step: first incomplete step id, or 'dashboard' if all done
  const firstIncomplete = steps.find((s) => !s.completed)
  const next_step = firstIncomplete ? firstIncomplete.id : 'dashboard'

  return { steps, percent_complete, next_step }
}
