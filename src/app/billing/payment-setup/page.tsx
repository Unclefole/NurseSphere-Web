'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { ArrowLeft, CreditCard, Check, AlertCircle, Shield } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface PaymentMethod {
  id: string
  type: 'card'
  card: {
    brand: string
    last4: string
    exp_month: number
    exp_year: number
  }
}

export default function PaymentSetupPage() {
  const { user, session, loading, isHospital } = useAuth()
  const router = useRouter()
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [isSetupLoading, setIsSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [hasCustomerId, setHasCustomerId] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/signin')
    }
    if (!loading && user && !isHospital) {
      router.push('/nurse')
    }
  }, [user, loading, isHospital, router])

  useEffect(() => {
    if (user?.facilityId) {
      checkCustomerSetup()
    }
  }, [user])

  const checkCustomerSetup = async () => {
    try {
      const { data: hospital, error } = await supabase
        .from('hospitals')
        .select('billing_stripe_customer_id')
        .eq('id', user?.facilityId)
        .single()

      if (error) throw error

      setHasCustomerId(!!hospital?.billing_stripe_customer_id)
    } catch (error) {
      console.error('Error checking customer setup:', error)
    }
  }

  const initializeStripeCustomer = async () => {
    if (!user?.facilityId) return

    setIsSetupLoading(true)
    setSetupError(null)

    try {
      // Call backend API to initialize Stripe customer
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/billing/initialize-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          hospital_id: user.facilityId
        })
      })

      if (!response.ok) {
        throw new Error('Failed to initialize Stripe customer')
      }

      const { customer_id } = await response.json()
      
      if (customer_id) {
        setHasCustomerId(true)
        // In a real implementation, redirect to Stripe Setup Intent flow
        console.log('Stripe customer initialized:', customer_id)
      }
    } catch (error: any) {
      setSetupError(error.message || 'Setup failed')
    } finally {
      setIsSetupLoading(false)
    }
  }

  const addPaymentMethod = async () => {
    // In production, this would integrate with Stripe Elements
    // For now, simulate adding a payment method
    setIsSetupLoading(true)
    
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Add mock payment method
      const mockMethod: PaymentMethod = {
        id: `pm_${Date.now()}`,
        type: 'card',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2028
        }
      }
      
      setPaymentMethods(prev => [...prev, mockMethod])
    } catch (error: any) {
      setSetupError(error.message || 'Failed to add payment method')
    } finally {
      setIsSetupLoading(false)
    }
  }

  if (loading || !user || !isHospital) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/billing"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Payment Setup</h1>
            <p className="text-gray-400 text-sm">Configure payment methods for automatic billing</p>
          </div>
        </div>

        {setupError && (
          <div className="ns-card mb-6 border-red-500/50">
            <div className="flex items-center gap-3 p-4">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <div>
                <h3 className="text-sm font-medium text-red-400">Setup Error</h3>
                <p className="text-xs text-red-300 mt-1">{setupError}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6">
          {/* Setup Status */}
          <div className="ns-card">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="h-6 w-6 text-cyan-400" />
                <h2 className="text-lg font-medium text-white">Payment Setup Status</h2>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {hasCustomerId ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-gray-600" />
                  )}
                  <span className={hasCustomerId ? 'text-green-400' : 'text-gray-400'}>
                    Stripe account initialized
                  </span>
                </div>
                
                <div className="flex items-center gap-3">
                  {paymentMethods.length > 0 ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-gray-600" />
                  )}
                  <span className={paymentMethods.length > 0 ? 'text-green-400' : 'text-gray-400'}>
                    Payment method added
                  </span>
                </div>
              </div>

              {!hasCustomerId && (
                <button
                  onClick={initializeStripeCustomer}
                  disabled={isSetupLoading}
                  className="mt-4 ns-btn-primary text-sm"
                >
                  {isSetupLoading ? 'Initializing...' : 'Initialize Payment Setup'}
                </button>
              )}
            </div>
          </div>

          {/* Payment Methods */}
          <div className="ns-card">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-white">Payment Methods</h2>
                {hasCustomerId && (
                  <button
                    onClick={addPaymentMethod}
                    disabled={isSetupLoading}
                    className="ns-btn-secondary text-sm"
                  >
                    {isSetupLoading ? 'Adding...' : 'Add Payment Method'}
                  </button>
                )}
              </div>

              {paymentMethods.length === 0 ? (
                <div className="text-center py-8">
                  <CreditCard className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">No payment methods configured</p>
                  {!hasCustomerId && (
                    <p className="text-gray-500 text-xs mt-1">Initialize payment setup first</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {paymentMethods.map((method) => (
                    <div key={method.id} className="flex items-center justify-between p-3 bg-ns-dark-800 rounded-lg">
                      <div className="flex items-center gap-3">
                        <CreditCard className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-white text-sm">
                            {method.card.brand.toUpperCase()} •••• {method.card.last4}
                          </p>
                          <p className="text-gray-400 text-xs">
                            Expires {method.card.exp_month}/{method.card.exp_year}
                          </p>
                        </div>
                      </div>
                      <div className="text-green-400 text-xs">Default</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Security Notice */}
          <div className="ns-card bg-blue-500/5 border-blue-500/20">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-blue-400 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-blue-400">Secure Payment Processing</h3>
                  <p className="text-blue-300 text-xs mt-1">
                    All payment information is securely processed by Stripe. 
                    NurseSphere never stores or has access to your payment details.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}