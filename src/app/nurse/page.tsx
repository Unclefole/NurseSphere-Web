'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  Calendar,
  FileText,
  Clock,
  Shield,
  Eye,
  Apple,
  Smartphone,
} from 'lucide-react'
import { format } from 'date-fns'

interface NurseData {
  upcomingShifts: number
  activeContracts: number
  pendingSignatures: number
  complianceItems: number
}

export default function NursePortalPage() {
  const { user, loading, isNurse } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<NurseData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/signin')
      return
    }

    // If hospital user, redirect to hospital dashboard
    if (!loading && user && !isNurse) {
      router.push('/dashboard')
      return
    }
  }, [user, loading, isNurse, router])

  useEffect(() => {
    if (!user || !isNurse) return

    const fetchNurseData = async () => {
      setDataLoading(true)
      try {
        // Get nurse profile
        const { data: nurseProfile } = await supabase
          .from('nurses')
          .select('id')
          .eq('user_id', user.id)
          .single()

        if (!nurseProfile) {
          setDataLoading(false)
          return
        }

        // Fetch counts
        const [shiftsRes, contractsRes, complianceRes] = await Promise.all([
          supabase
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('nurse_id', nurseProfile.id)
            .gte('start_time', new Date().toISOString()),
          supabase
            .from('contracts')
            .select('id, nurse_signed', { count: 'exact' })
            .eq('nurse_id', nurseProfile.id)
            .in('status', ['pending', 'signed']),
          supabase
            .from('compliance_records')
            .select('id', { count: 'exact', head: true })
            .eq('nurse_id', nurseProfile.id)
            .in('status', ['expiring', 'expired', 'pending']),
        ])

        const contracts = contractsRes.data || []
        const pendingSignatures = contracts.filter(c => !c.nurse_signed).length

        setData({
          upcomingShifts: shiftsRes.count || 0,
          activeContracts: contracts.length,
          pendingSignatures,
          complianceItems: complianceRes.count || 0,
        })
      } catch (error) {
        console.error('Error fetching nurse data:', error)
      } finally {
        setDataLoading(false)
      }
    }

    fetchNurseData()
  }, [user, isNurse])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading...</div>
      </div>
    )
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome, {user.profile?.full_name || 'Nurse'}
          </h1>
          <p className="text-gray-400">Nurse Web Portal (Read-Only)</p>
        </div>

        {/* Read-only notice */}
        <div className="mb-8 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-3">
          <Eye className="h-5 w-5 text-yellow-400 flex-shrink-0" />
          <div>
            <p className="text-yellow-400 font-medium">Read-Only Access</p>
            <p className="text-sm text-yellow-400/80">
              This web portal is for viewing only. To accept shifts, sign contracts, and manage your profile,
              please use the NurseSphere mobile app.
            </p>
          </div>
        </div>

        {/* Quick stats */}
        {data && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="ns-card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{data.upcomingShifts}</p>
                  <p className="text-xs text-gray-400">Upcoming Shifts</p>
                </div>
              </div>
            </div>
            <div className="ns-card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{data.activeContracts}</p>
                  <p className="text-xs text-gray-400">Active Contracts</p>
                </div>
              </div>
            </div>
            <div className="ns-card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{data.pendingSignatures}</p>
                  <p className="text-xs text-gray-400">Pending Signatures</p>
                </div>
              </div>
            </div>
            <div className="ns-card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{data.complianceItems}</p>
                  <p className="text-xs text-gray-400">Compliance Alerts</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mobile app CTA */}
        <div className="ns-card p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-ns-teal/20 flex items-center justify-center">
            <Smartphone className="h-10 w-10 text-ns-teal" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            Get the Full Experience
          </h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Download the NurseSphere mobile app to accept shifts, sign contracts with tap-to-sign,
            manage your credentials, and access all features.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#download-ios"
              className="flex items-center gap-2 bg-white text-black font-medium py-3 px-6 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Apple className="h-5 w-5" />
              Download for iOS
            </a>
            <a
              href="#download-android"
              className="flex items-center gap-2 bg-ns-dark-700 text-white font-medium py-3 px-6 rounded-lg border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.523 15.341l-.001-.002-4.19-7.257a.88.88 0 00-.761-.439H11.43a.88.88 0 00-.761.439l-4.19 7.257-.001.002a.88.88 0 00.761 1.322h9.523a.88.88 0 00.761-1.322zM3.293 20.707a1 1 0 010-1.414l3.293-3.293H3a1 1 0 110-2h6a1 1 0 011 1v6a1 1 0 11-2 0v-3.586l-3.293 3.293a1 1 0 01-1.414 0zM21 14h-6a1 1 0 01-1-1V7a1 1 0 112 0v3.586l3.293-3.293a1 1 0 111.414 1.414L17.414 12H21a1 1 0 110 2z"/>
              </svg>
              Download for Android
            </a>
          </div>
        </div>

        {/* Quick links */}
        <div className="mt-8 grid sm:grid-cols-2 gap-4">
          <div className="ns-card p-4">
            <h3 className="font-medium text-white mb-2">View Schedule</h3>
            <p className="text-sm text-gray-400 mb-3">See your upcoming assigned shifts</p>
            <p className="text-xs text-gray-500">Available in mobile app only</p>
          </div>
          <div className="ns-card p-4">
            <h3 className="font-medium text-white mb-2">Contracts</h3>
            <p className="text-sm text-gray-400 mb-3">View and sign pending contracts</p>
            <p className="text-xs text-gray-500">Signing available in mobile app only</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

