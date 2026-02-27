'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  User,
  Building2,
  Mail,
  Phone,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'

export default function SettingsPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profileData, setProfileData] = useState({
    full_name: '',
    phone: '',
  })

  const [hospitalData, setHospitalData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    phone: '',
  })

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
      return
    }
    if (!authLoading && user && !isHospital) {
      router.push('/nurse')
      return
    }
  }, [user, authLoading, isHospital, router])

  useEffect(() => {
    if (!user) return

    // Load profile data
    if (user.profile) {
      setProfileData({
        full_name: user.profile.full_name || '',
        phone: '',
      })
    }

    // Load facility data
    const fetchFacility = async () => {
      if (!user.facilityId) return

      const { data } = await supabase
        .from('facilities')
        .select('name, address, city, state, zip_code, phone')
        .eq('id', user.facilityId)
        .single()

      if (data) {
        setHospitalData({
          name: data.name || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          zip_code: data.zip_code || '',
          phone: data.phone || '',
        })
      }
    }

    fetchFacility()
  }, [user])

  const handleSave = async () => {
    if (!user) return

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: profileData.full_name,
        })
        .eq('id', user.id)

      if (profileError) {
        setError(profileError.message)
        return
      }

      // Update facility
      if (user.facilityId) {
        const { error: facilityError } = await supabase
          .from('facilities')
          .update({
            name: hospitalData.name,
            address: hospitalData.address,
            city: hospitalData.city,
            state: hospitalData.state,
            zip_code: hospitalData.zip_code,
            phone: hospitalData.phone,
          })
          .eq('id', user.facilityId)

        if (facilityError) {
          setError(facilityError.message)
          return
        }
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || !user || !isHospital) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-gray-400 text-sm">Manage your account and hospital settings</p>
          </div>
        </div>

        {/* Success/Error messages */}
        {success && (
          <div className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">
            <CheckCircle className="h-4 w-4" />
            Settings saved successfully
          </div>
        )}
        {error && (
          <div className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Profile Settings */}
          <div className="ns-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-5 w-5 text-ns-teal" />
              <h2 className="text-lg font-medium text-white">Profile</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={profileData.full_name}
                  onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                  className="ns-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="ns-input pl-10 opacity-50 cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Phone
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                  <input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    className="ns-input pl-10"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Hospital Settings */}
          <div className="ns-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-5 w-5 text-ns-teal" />
              <h2 className="text-lg font-medium text-white">Hospital</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Hospital Name
                </label>
                <input
                  type="text"
                  value={hospitalData.name}
                  onChange={(e) => setHospitalData({ ...hospitalData, name: e.target.value })}
                  className="ns-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Address
                </label>
                <input
                  type="text"
                  value={hospitalData.address}
                  onChange={(e) => setHospitalData({ ...hospitalData, address: e.target.value })}
                  className="ns-input"
                  placeholder="Street address"
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    City
                  </label>
                  <input
                    type="text"
                    value={hospitalData.city}
                    onChange={(e) => setHospitalData({ ...hospitalData, city: e.target.value })}
                    className="ns-input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    State
                  </label>
                  <input
                    type="text"
                    value={hospitalData.state}
                    onChange={(e) => setHospitalData({ ...hospitalData, state: e.target.value })}
                    className="ns-input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    value={hospitalData.zip_code}
                    onChange={(e) => setHospitalData({ ...hospitalData, zip_code: e.target.value })}
                    className="ns-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Hospital Phone
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                  <input
                    type="tel"
                    value={hospitalData.phone}
                    onChange={(e) => setHospitalData({ ...hospitalData, phone: e.target.value })}
                    className="ns-input pl-10"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={loading}
              className="ns-btn-primary flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

