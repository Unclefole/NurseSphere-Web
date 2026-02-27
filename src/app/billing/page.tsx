'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { ArrowLeft, DollarSign, CreditCard, FileText, AlertCircle, Plus, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Invoice {
  id: string
  invoice_number: string
  total: number
  status: string
  due_date: string
  created_at: string
}

export default function BillingPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false)
  const [billingStats, setBillingStats] = useState({
    pendingAmount: 0,
    paidThisMonth: 0,
    overdue: 0
  })

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
      fetchBillingData()
      checkPaymentMethodStatus()
    }
  }, [user])

  const fetchBillingData = async () => {
    try {
      const { data: invoiceData, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total, status, due_date, created_at')
        .eq('hospital_id', user?.facilityId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error

      setInvoices(invoiceData || [])

      // Calculate stats
      const pending = invoiceData?.filter(i => i.status === 'pending').reduce((sum, i) => sum + i.total, 0) || 0
      const paid = invoiceData?.filter(i => i.status === 'paid' && 
        new Date(i.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      ).reduce((sum, i) => sum + i.total, 0) || 0
      const overdue = invoiceData?.filter(i => 
        i.status === 'pending' && new Date(i.due_date) < new Date()
      ).reduce((sum, i) => sum + i.total, 0) || 0

      setBillingStats({ pendingAmount: pending, paidThisMonth: paid, overdue })
    } catch (error) {
      console.error('Error fetching billing data:', error)
    }
  }

  const checkPaymentMethodStatus = async () => {
    try {
      const { data: hospital, error } = await supabase
        .from('hospitals')
        .select('billing_stripe_customer_id')
        .eq('id', user?.facilityId)
        .single()

      if (error) throw error
      
      // In a real implementation, check if customer has payment methods
      setHasPaymentMethod(!!hospital?.billing_stripe_customer_id)
    } catch (error) {
      console.error('Error checking payment method:', error)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'text-green-400'
      case 'pending': return 'text-yellow-400'
      case 'overdue': return 'text-red-400'
      default: return 'text-gray-400'
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
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Billing</h1>
            <p className="text-gray-400 text-sm">Manage payments and invoices</p>
          </div>
          <Link
            href="/billing/payment-setup"
            className="ns-btn-secondary text-sm"
          >
            <Settings className="h-4 w-4 mr-2" />
            Payment Setup
          </Link>
        </div>

        {/* Payment Method Warning */}
        {!hasPaymentMethod && (
          <div className="ns-card border-yellow-500/50 mb-6">
            <div className="flex items-center gap-3 p-4">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-yellow-400">Payment Method Required</h3>
                <p className="text-xs text-yellow-300 mt-1">
                  Set up a payment method to enable automatic billing for your shifts.
                </p>
              </div>
              <Link
                href="/billing/payment-setup"
                className="text-xs text-yellow-400 hover:text-yellow-300 underline"
              >
                Setup Now
              </Link>
            </div>
          </div>
        )}

        {/* Billing Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="ns-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs">Pending Amount</p>
                <p className="text-white text-xl font-bold">${billingStats.pendingAmount.toFixed(2)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-yellow-400" />
            </div>
          </div>
          
          <div className="ns-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs">Paid This Month</p>
                <p className="text-white text-xl font-bold">${billingStats.paidThisMonth.toFixed(2)}</p>
              </div>
              <CreditCard className="h-8 w-8 text-green-400" />
            </div>
          </div>
          
          <div className="ns-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs">Overdue</p>
                <p className="text-white text-xl font-bold">${billingStats.overdue.toFixed(2)}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="ns-card">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-white">Recent Invoices</h2>
              <button className="ns-btn-secondary text-sm">
                <FileText className="h-4 w-4 mr-2" />
                View All
              </button>
            </div>

            {invoices.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No invoices yet</p>
                <p className="text-gray-500 text-xs mt-1">Invoices will appear here after shifts are completed</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-ns-dark-600">
                      <th className="pb-3">Invoice</th>
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Due Date</th>
                      <th className="pb-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ns-dark-600">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="text-sm">
                        <td className="py-3">
                          <p className="text-white">{invoice.invoice_number}</p>
                          <p className="text-gray-400 text-xs">
                            {new Date(invoice.created_at).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="py-3 text-white font-medium">
                          ${invoice.total.toFixed(2)}
                        </td>
                        <td className="py-3">
                          <span className={`text-xs font-medium ${getStatusColor(invoice.status)}`}>
                            {invoice.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 text-gray-400">
                          {new Date(invoice.due_date).toLocaleDateString()}
                        </td>
                        <td className="py-3">
                          <button className="text-xs text-gray-400 hover:text-white">
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

