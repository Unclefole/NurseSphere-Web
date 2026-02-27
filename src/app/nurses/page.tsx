'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  Search,
  Users,
  ChevronRight,
  Loader2,
  Award,
  Briefcase,
  CheckCircle,
} from 'lucide-react'

interface NurseWithProfile {
  id: string
  user_id: string
  specialty: string | null
  years_experience: number | null
  hourly_rate: number | null
  available: boolean
  license_state: string | null
  profiles: {
    full_name: string | null
    email: string
    avatar_url: string | null
    phone: string | null
  }
  _applicationCount?: number
}

export default function NursesPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [nurses, setNurses] = useState<NurseWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

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
    if (!user?.facilityId) return

    const fetchNurses = async () => {
      setLoading(true)
      try {
        // Runtime guard: applications table not yet provisioned
        // TODO: Replace with real query when applications table exists
        const nurseIds: string[] = []

        if (nurseIds.length === 0) {
          setNurses([])
          setLoading(false)
          return
        }

        const { data, error } = await supabase
          .from('profiles')
          .select(`
            id,
            user_id,
            specialty,
            years_experience,
            hourly_rate,
            available,
            license_state,
            profiles:profiles!inner (
              full_name,
              email,
              avatar_url,
              phone
            )
          `)
          .in('id', nurseIds)
          .order('created_at', { ascending: false })

        if (error) {
          console.error('Error fetching nurses:', error)
          return
        }

        setNurses(data as unknown as NurseWithProfile[] || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchNurses()
  }, [user])

  const filteredNurses = nurses.filter((nurse) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      nurse.profiles.full_name?.toLowerCase().includes(searchLower) ||
      nurse.profiles.email.toLowerCase().includes(searchLower) ||
      nurse.specialty?.toLowerCase().includes(searchLower) ||
      nurse.license_state?.toLowerCase().includes(searchLower)
    )
  })

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading...</div>
      </div>
    )
  }

  if (!user || !isHospital) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Nurses</h1>
            <p className="text-gray-400 text-sm">View your approved nursing staff</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, specialty, or license state..."
            className="ns-input pl-10 w-full"
          />
        </div>

        {/* Nurses list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredNurses.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No nurses found</h3>
            <p className="text-gray-400">
              {searchQuery
                ? 'Try adjusting your search'
                : 'Approved nurse applicants will appear here'}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNurses.map((nurse) => (
              <Link
                key={nurse.id}
                href={`/nurses/${nurse.id}`}
                className="ns-card-hover p-4 group"
              >
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="w-14 h-14 rounded-full bg-ns-dark-700 flex items-center justify-center flex-shrink-0">
                    {nurse.profiles.avatar_url ? (
                      <img
                        src={nurse.profiles.avatar_url}
                        alt=""
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-xl font-medium text-ns-teal">
                        {nurse.profiles.full_name?.[0] || 'N'}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white truncate">
                        {nurse.profiles.full_name || 'Unknown'}
                      </h3>
                      {nurse.available && (
                        <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-ns-teal truncate">
                      {nurse.specialty || 'General Nursing'}
                    </p>
                  </div>

                  <ChevronRight className="h-5 w-5 text-gray-600 group-hover:text-ns-teal transition-colors" />
                </div>

                <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    {nurse.years_experience || 0}+ yrs
                  </span>
                  {nurse.license_state && (
                    <span className="flex items-center gap-1">
                      <Award className="h-3.5 w-3.5" />
                      {nurse.license_state}
                    </span>
                  )}
                  {nurse.hourly_rate && (
                    <span>${nurse.hourly_rate}/hr</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

