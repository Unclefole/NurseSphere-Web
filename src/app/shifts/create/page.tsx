'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  Calendar,
  Clock,
  DollarSign,
  Building2,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle,
  CreditCard,
} from 'lucide-react'

export default function CreateShiftPage() {
  const { user, session, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [paymentRequired, setPaymentRequired] = useState(false)

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    department: '',
    specialty_required: '',
    date: '',
    start_time: '',
    end_time: '',
    hourly_rate: '',
  })
  const [marketplaceVisible, setMarketplaceVisible] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
    }
    if (!authLoading && user && !isHospital) {
      router.push('/nurse')
    }
  }, [user, authLoading, isHospital, router])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPaymentRequired(false)
    setLoading(true)

    if (!user?.facilityId) {
      setError('Facility not found. Please set up your facility first.')
      setLoading(false)
      return
    }

    try {
      // Combine date and times
      const startDateTime = new Date(`${formData.date}T${formData.start_time}`)
      const endDateTime = new Date(`${formData.date}T${formData.end_time}`)

      // Validate times
      if (endDateTime <= startDateTime) {
        setError('End time must be after start time')
        setLoading(false)
        return
      }

      // Use API endpoint so the payment guard runs server-side
      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          facilityId: user.facilityId,
          title: formData.title,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          hourlyRate: formData.hourly_rate ? parseFloat(formData.hourly_rate) : undefined,
          specialty: formData.specialty_required || undefined,
        }),
      })

      // 402 = payment method required before posting shifts
      if (res.status === 402) {
        setPaymentRequired(true)
        setLoading(false)
        return
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setError(errData.message ?? errData.error ?? 'Failed to create shift')
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/shifts')
      }, 1500)
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || !user || !isHospital) {
    return null
  }

  if (success) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="ns-card p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Shift Created!</h2>
            <p className="text-gray-400">Redirecting to shifts...</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/shifts"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Create Shift</h1>
            <p className="text-gray-400 text-sm">Post a new shift opening</p>
          </div>
        </div>

        {/* Form */}
        <div className="ns-card p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Payment method required — 402 response */}
            {paymentRequired && (
              <div className="p-4 rounded-lg bg-amber-900/20 border border-amber-600/40 text-amber-300 text-sm">
                <div className="flex items-start gap-3 mb-3">
                  <CreditCard className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <p className="font-semibold text-amber-200 mb-0.5">Payment Method Required</p>
                    <p className="text-amber-300/80">
                      Add a payment method to your account before posting shifts. Nurses are
                      automatically paid after each completed shift.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/billing"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors"
                >
                  <CreditCard className="h-4 w-4" />
                  Add a Payment Method
                </Link>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-300 mb-1.5">
                Shift Title *
              </label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <input
                  id="title"
                  name="title"
                  type="text"
                  value={formData.title}
                  onChange={handleChange}
                  className="ns-input pl-10"
                  placeholder="e.g., RN - Night Shift"
                  required
                />
              </div>
            </div>

            {/* Department & Specialty */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="department" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Department
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                  <input
                    id="department"
                    name="department"
                    type="text"
                    value={formData.department}
                    onChange={handleChange}
                    className="ns-input pl-10"
                    placeholder="e.g., Emergency"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="specialty_required" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Specialty Required
                </label>
                <select
                  id="specialty_required"
                  name="specialty_required"
                  value={formData.specialty_required}
                  onChange={handleChange}
                  className="ns-input"
                >
                  <option value="">Any specialty</option>
                  <option value="ICU">ICU</option>
                  <option value="ER">Emergency Room</option>
                  <option value="OR">Operating Room</option>
                  <option value="Pediatrics">Pediatrics</option>
                  <option value="Med-Surg">Med-Surg</option>
                  <option value="Labor & Delivery">Labor & Delivery</option>
                  <option value="Oncology">Oncology</option>
                  <option value="Cardiac">Cardiac</option>
                </select>
              </div>
            </div>

            {/* Date */}
            <div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-300 mb-1.5">
                Date *
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <input
                  id="date"
                  name="date"
                  type="date"
                  value={formData.date}
                  onChange={handleChange}
                  className="ns-input pl-10"
                  min={new Date().toISOString().split('T')[0]}
                  required
                />
              </div>
            </div>

            {/* Times */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="start_time" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Start Time *
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                  <input
                    id="start_time"
                    name="start_time"
                    type="time"
                    value={formData.start_time}
                    onChange={handleChange}
                    className="ns-input pl-10"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="end_time" className="block text-sm font-medium text-gray-300 mb-1.5">
                  End Time *
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                  <input
                    id="end_time"
                    name="end_time"
                    type="time"
                    value={formData.end_time}
                    onChange={handleChange}
                    className="ns-input pl-10"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Hourly Rate */}
            <div>
              <label htmlFor="hourly_rate" className="block text-sm font-medium text-gray-300 mb-1.5">
                Hourly Rate ($) *
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <input
                  id="hourly_rate"
                  name="hourly_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.hourly_rate}
                  onChange={handleChange}
                  className="ns-input pl-10"
                  placeholder="45.00"
                  required
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-1.5">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                className="ns-input min-h-[100px]"
                placeholder="Additional details about the shift..."
              />
            </div>

            {/* Marketplace Visibility */}
            <div className="flex items-center justify-between p-4 bg-ns-dark-800 border border-ns-dark-600 rounded-lg">
              <div>
                <label className="text-sm font-medium text-gray-300">Marketplace Visibility</label>
                <p className="text-xs text-gray-500 mt-0.5">
                  Allow nurses to find and apply to this shift via the marketplace
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMarketplaceVisible(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  marketplaceVisible ? 'bg-ns-teal' : 'bg-ns-dark-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    marketplaceVisible ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <Link
                href="/shifts"
                className="flex-1 ns-btn-secondary text-center"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 ns-btn-primary flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Shift'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DashboardLayout>
  )
}

