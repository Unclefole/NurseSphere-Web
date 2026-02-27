'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  Mail,
  Phone,
  Clock,
  Calendar,
  DollarSign,
  Award,
  Briefcase,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
} from 'lucide-react'
import { format } from 'date-fns'
import type { ApplicationStatus } from '@/types/database'

interface ApplicationDetail {
  id: string
  shift_id: string
  nurse_id: string
  status: ApplicationStatus
  applied_at: string
  cover_letter: string | null
  reviewed_at: string | null
  notes: string | null
  nurse: {
    id: string
    specialty: string | null
    years_experience: number | null
    hourly_rate: number | null
    license_number: string | null
    license_state: string | null
    license_expiry: string | null
    certifications: string[] | null
    bio: string | null
    profiles: {
      full_name: string | null
      email: string
      phone: string | null
      avatar_url: string | null
    }
  }
  shift: {
    id: string
    title: string
    department: string | null
    description: string | null
    start_time: string
    end_time: string
    hourly_rate: number
    specialty_required: string | null
  }
}

export default function ApplicantDetailPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const params = useParams()
  const applicationId = params.id as string

  const [application, setApplication] = useState<ApplicationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

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
    if (!user?.facilityId || !applicationId) return

    const fetchApplication = async () => {
      setLoading(true)
      try {
        // Runtime guard: applications table not yet provisioned
        console.warn('[Applicant Detail] Feature coming soon: applications table not provisioned')
        setLoading(false)
        return
        // Dead code below — preserved for when applications table is created
        const { data, error } = await supabase
          .from('applications')
          .select(`
            id,
            shift_id,
            nurse_id,
            status,
            applied_at,
            cover_letter,
            reviewed_at,
            notes,
            nurse:profiles!inner (
              id,
              specialty,
              years_experience,
              hourly_rate,
              license_number,
              license_state,
              license_expiry,
              certifications,
              bio,
              profiles:profiles!inner (
                full_name,
                email,
                phone,
                avatar_url
              )
            ),
            shift:shifts!inner (
              id,
              title,
              department,
              description,
              start_time,
              end_time,
              hourly_rate,
              specialty_required
            )
          `)
          .eq('id', applicationId)
          .eq('facility_id', user?.facilityId ?? '')
          .single()

        if (error) {
          console.error('Error fetching application:', error)
          router.push('/applicants')
          return
        }

        setApplication(data as unknown as ApplicationDetail)
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchApplication()
  }, [user, applicationId, router])

  const handleStatusChange = async (newStatus: 'approved' | 'rejected') => {
    if (!application || !user) return

    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('applications')
        .update({
          status: newStatus,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', application.id)

      if (error) {
        console.error('Error updating application:', error)
        return
      }

      // If approved, update the shift with the nurse
      if (newStatus === 'approved') {
        await supabase
          .from('shifts')
          .update({
            status: 'filled',
            nurse_id: application.nurse_id,
          })
          .eq('id', application.shift_id)
      }

      // Refresh the application data
      setApplication({ ...application, status: newStatus, reviewed_at: new Date().toISOString() })
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
      </div>
    )
  }

  if (!user || !isHospital || !application) {
    return null
  }

  const isPending = application.status === 'pending'

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/applicants"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Applicant Details</h1>
            <p className="text-gray-400 text-sm">Review application and nurse credentials</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Nurse Info Card */}
            <div className="ns-card p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-ns-dark-700 flex items-center justify-center flex-shrink-0">
                  {application.nurse.profiles.avatar_url ? (
                    <img
                      src={application.nurse.profiles.avatar_url}
                      alt=""
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-medium text-ns-teal">
                      {application.nurse.profiles.full_name?.[0] || 'N'}
                    </span>
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {application.nurse.profiles.full_name || 'Unknown Nurse'}
                  </h2>
                  <p className="text-ns-teal">{application.nurse.specialty || 'General Nursing'}</p>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                    <span className="flex items-center gap-1">
                      <Mail className="h-4 w-4" />
                      {application.nurse.profiles.email}
                    </span>
                    {application.nurse.profiles.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-4 w-4" />
                        {application.nurse.profiles.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-ns-dark-700 rounded-lg p-3 text-center">
                  <Briefcase className="h-5 w-5 mx-auto mb-1 text-ns-teal" />
                  <p className="text-lg font-bold text-white">
                    {application.nurse.years_experience || 0}+
                  </p>
                  <p className="text-xs text-gray-400">Years Exp.</p>
                </div>
                <div className="bg-ns-dark-700 rounded-lg p-3 text-center">
                  <DollarSign className="h-5 w-5 mx-auto mb-1 text-ns-teal" />
                  <p className="text-lg font-bold text-white">
                    ${application.nurse.hourly_rate || 0}/hr
                  </p>
                  <p className="text-xs text-gray-400">Rate</p>
                </div>
                <div className="bg-ns-dark-700 rounded-lg p-3 text-center">
                  <Award className="h-5 w-5 mx-auto mb-1 text-ns-teal" />
                  <p className="text-lg font-bold text-white">
                    {application.nurse.license_state || 'N/A'}
                  </p>
                  <p className="text-xs text-gray-400">License State</p>
                </div>
                <div className="bg-ns-dark-700 rounded-lg p-3 text-center">
                  <Calendar className="h-5 w-5 mx-auto mb-1 text-ns-teal" />
                  <p className="text-lg font-bold text-white">
                    {application.nurse.license_expiry
                      ? format(new Date(application.nurse.license_expiry), 'MM/yy')
                      : 'N/A'}
                  </p>
                  <p className="text-xs text-gray-400">License Exp.</p>
                </div>
              </div>

              {/* Bio */}
              {application.nurse.bio && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-300 mb-2">About</h3>
                  <p className="text-gray-400 text-sm">{application.nurse.bio}</p>
                </div>
              )}

              {/* Certifications */}
              {application.nurse.certifications && application.nurse.certifications.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-300 mb-2">Certifications</h3>
                  <div className="flex flex-wrap gap-2">
                    {application.nurse.certifications.map((cert, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-ns-dark-700 rounded-full text-sm text-gray-300"
                      >
                        {cert}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Cover Letter */}
            {application.cover_letter && (
              <div className="ns-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="h-5 w-5 text-ns-teal" />
                  <h3 className="text-lg font-medium text-white">Cover Letter</h3>
                </div>
                <p className="text-gray-400 whitespace-pre-wrap">{application.cover_letter}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Shift Info */}
            <div className="ns-card p-6">
              <h3 className="text-lg font-medium text-white mb-4">Applied Shift</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-400">Position</p>
                  <p className="text-white font-medium">{application.shift.title}</p>
                </div>
                <div>
                  <p className="text-gray-400">Department</p>
                  <p className="text-white">{application.shift.department || 'General'}</p>
                </div>
                <div>
                  <p className="text-gray-400">Date & Time</p>
                  <p className="text-white">
                    {format(new Date(application.shift.start_time), 'MMM d, yyyy')}
                  </p>
                  <p className="text-gray-400">
                    {format(new Date(application.shift.start_time), 'h:mm a')} -{' '}
                    {format(new Date(application.shift.end_time), 'h:mm a')}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Rate</p>
                  <p className="text-white">${application.shift.hourly_rate}/hr</p>
                </div>
              </div>
            </div>

            {/* Status & Actions */}
            <div className="ns-card p-6">
              <h3 className="text-lg font-medium text-white mb-4">Application Status</h3>
              <div className="mb-4">
                <span
                  className={`ns-badge ${
                    application.status === 'approved'
                      ? 'ns-badge-success'
                      : application.status === 'rejected'
                      ? 'ns-badge-error'
                      : application.status === 'withdrawn'
                      ? 'ns-badge-warning'
                      : 'ns-badge-pending'
                  }`}
                >
                  {application.status.charAt(0).toUpperCase() + application.status.slice(1)}
                </span>
                {application.reviewed_at && (
                  <p className="text-xs text-gray-500 mt-2">
                    Reviewed on {format(new Date(application.reviewed_at), 'MMM d, yyyy')}
                  </p>
                )}
              </div>

              {isPending && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleStatusChange('approved')}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Approve
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleStatusChange('rejected')}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" />
                        Reject
                      </>
                    )}
                  </button>
                </div>
              )}

              <p className="text-xs text-gray-500 mt-4">
                <Clock className="h-3 w-3 inline mr-1" />
                Applied {format(new Date(application.applied_at), 'MMM d, yyyy \'at\' h:mm a')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

