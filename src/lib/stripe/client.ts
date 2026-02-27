/**
 * Server-side Stripe client — singleton
 * Never import this in client components.
 */
import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set.')
    }
    _stripe = new Stripe(key, {
      apiVersion: '2026-01-28.clover',
      appInfo: {
        name: 'NurseSphere',
        version: '1.0.0',
      },
    })
  }
  return _stripe
}
