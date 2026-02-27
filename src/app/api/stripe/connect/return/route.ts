/**
 * GET /api/stripe/connect/return
 *
 * Stripe redirects nurses here after the hosted onboarding flow (success or refresh).
 * Checks account status, updates the profile, then redirects to the payouts dashboard.
 *
 * Auth: Nurse only (session must be active when Stripe redirects back).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    // If not authenticated, redirect to sign-in
    if (authError || !user) {
      return NextResponse.redirect(`${APP_URL}/auth/signin?redirect=/dashboard/payouts`)
    }

    // Fetch stripe account ID from profile
    const { data: profileRaw } = await (supabase as any)
      .from('profiles')
      .select('stripe_account_id, stripe_onboarding_status')
      .eq('id', user.id)
      .single()

    const profile = profileRaw as {
      stripe_account_id: string | null
      stripe_onboarding_status: string | null
    } | null

    if (!profile?.stripe_account_id) {
      // No account — redirect to start
      return NextResponse.redirect(`${APP_URL}/dashboard/payouts?onboarding=incomplete`)
    }

    // Check live account status
    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(profile.stripe_account_id)

    const isComplete = account.charges_enabled && account.payouts_enabled

    // Determine new status
    let newStatus: string
    if (isComplete) {
      newStatus = 'complete'
    } else if (
      account.requirements?.disabled_reason &&
      account.requirements.disabled_reason !== 'requirements.past_due'
    ) {
      newStatus = 'restricted'
    } else {
      newStatus = 'pending'
    }

    // Update profile
    await (supabase as any)
      .from('profiles')
      .update({ stripe_onboarding_status: newStatus })
      .eq('id', user.id)

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.id,
      action: 'stripe_connect.onboard_returned',
      target_type: 'stripe_connect_account',
      target_id: profile.stripe_account_id,
      metadata: {
        stripe_account_id: profile.stripe_account_id,
        onboarding_status: newStatus,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      },
      ip_address,
    })

    // Redirect to payouts dashboard
    const outcome = isComplete ? 'complete' : 'incomplete'
    return NextResponse.redirect(`${APP_URL}/dashboard/payouts?onboarding=${outcome}`)
  } catch (err: unknown) {
    console.error('[StripeConnect/Return] Error:', err)
    return NextResponse.redirect(`${APP_URL}/dashboard/payouts?onboarding=error`)
  }
}
