/**
 * POST /api/stripe/connect/onboard
 *
 * Initiates Stripe Connect Express onboarding for an authenticated nurse.
 * Creates (or reuses) a Stripe Express account, saves the account ID to profiles,
 * generates an AccountLink, and returns the hosted onboarding URL.
 *
 * Auth: Nurse only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    // Fetch nurse profile — confirm role and check for existing account
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, full_name, email')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only nurses can onboard via Connect
    if ((profile as { role: string }).role !== 'nurse') {
      return NextResponse.json({ error: 'Only nurses can set up payout accounts' }, { status: 403 })
    }

    // Check for an existing stripe_account_id on the profile
    const { data: stripeData } = await (supabase as any)
      .from('profiles')
      .select('stripe_account_id, stripe_onboarding_status')
      .eq('id', user.id)
      .single()

    let accountId: string = stripeData?.stripe_account_id ?? ''
    const stripe = getStripe()

    if (!accountId) {
      // Create a new Stripe Connect Express account
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: (profile as any).email ?? user.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          nurse_id: user.id,
          platform: 'nursesphere',
        },
      })
      accountId = account.id

      // Persist account ID and set status to pending
      await (supabase as any)
        .from('profiles')
        .update({
          stripe_account_id: accountId,
          stripe_onboarding_status: 'pending',
        })
        .eq('id', user.id)
    }

    // Generate a fresh account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${APP_URL}/api/stripe/connect/return?refresh=1`,
      return_url: `${APP_URL}/api/stripe/connect/return`,
      type: 'account_onboarding',
    })

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.id,
      action: 'stripe_connect.onboard_started',
      target_type: 'stripe_connect_account',
      target_id: accountId,
      metadata: {
        stripe_account_id: accountId,
        nurse_id: user.id,
      },
      ip_address,
    })

    return NextResponse.json({ url: accountLink.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[StripeConnect/Onboard] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
