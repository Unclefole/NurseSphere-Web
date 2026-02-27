/**
 * GET /api/stripe/connect/status
 *
 * Returns the authenticated nurse's Stripe Connect onboarding status.
 * Syncs live data from stripe.accounts.retrieve() and updates the profile.
 *
 * Auth: Nurse only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch nurse profile for stripe columns
    const { data: profileRaw } = await (supabase as any)
      .from('profiles')
      .select('role, stripe_account_id, stripe_onboarding_status')
      .eq('id', user.id)
      .single()

    const profile = profileRaw as {
      role: string
      stripe_account_id: string | null
      stripe_onboarding_status: string | null
    } | null

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (profile.role !== 'nurse') {
      return NextResponse.json({ error: 'Nurses only' }, { status: 403 })
    }

    // No account yet → return not_started
    if (!profile.stripe_account_id) {
      return NextResponse.json({
        status: 'not_started',
        charges_enabled: false,
        payouts_enabled: false,
        requirements: null,
      })
    }

    // Retrieve live account data from Stripe
    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(profile.stripe_account_id)

    // Derive status from Stripe account state
    let newStatus: string
    if (account.charges_enabled && account.payouts_enabled) {
      newStatus = 'complete'
    } else if (
      account.requirements?.disabled_reason &&
      account.requirements.disabled_reason !== 'requirements.past_due'
    ) {
      newStatus = 'restricted'
    } else {
      newStatus = 'pending'
    }

    // Update profile if status changed
    if (newStatus !== profile.stripe_onboarding_status) {
      await (supabase as any)
        .from('profiles')
        .update({ stripe_onboarding_status: newStatus })
        .eq('id', user.id)
    }

    // Extract bank account last4 if available (for display)
    let bankLast4: string | null = null
    if (account.external_accounts?.data?.length) {
      const bank = account.external_accounts.data[0]
      bankLast4 = (bank as any).last4 ?? null
    }

    return NextResponse.json({
      status: newStatus,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      requirements: account.requirements,
      bank_last4: bankLast4,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[StripeConnect/Status] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
