'use client'

/**
 * /invite/[token]
 *
 * Public invite acceptance page.
 * - Shows invite details (facility name, role, inviter)
 * - If not logged in: prompts to create account or sign in
 * - If logged in: shows "Accept Invitation" button
 * - After accept: redirects to /dashboard
 */

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import {
  Building2,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LogIn,
  UserPlus,
  ArrowRight,
} from 'lucide-react'

interface PageProps {
  params: Promise<{ token: string }>
}

interface InviteDetails {
  invite_id: string
  email: string
  role: string
  facility_id: string
  facility_name: string
  invited_by_name: string
  expires_at: string
}

export default function InviteAcceptPage({ params }: PageProps) {
  const { token } = use(params)
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [invite, setInvite] = useState<InviteDetails | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  // Fetch invite details (public endpoint)
  useEffect(() => {
    const fetchInvite = async () => {
      try {
        const res = await fetch(`/api/team/invite/${token}`)
        const j = await res.json()
        if (!res.ok) throw new Error(j.error ?? 'Invalid invitation')
        setInvite(j)
      } catch (e: unknown) {
        setFetchError(e instanceof Error ? e.message : 'Failed to load invitation')
      } finally {
        setFetching(false)
      }
    }
    fetchInvite()
  }, [token])

  const handleAccept = async () => {
    if (!user) return
    setAccepting(true)
    setAcceptError(null)
    try {
      const res = await fetch(`/api/team/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to accept invitation')
      setAccepted(true)
      // Redirect to dashboard after brief delay
      setTimeout(() => router.push('/dashboard'), 2000)
    } catch (e: unknown) {
      setAcceptError(e instanceof Error ? e.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  const formatRole = (role: string) =>
    role.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

  // Loading
  if (fetching || authLoading) {
    return (
      <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-indigo-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading invitation...</p>
        </div>
      </div>
    )
  }

  // Invalid/expired/used invite
  if (fetchError) {
    return (
      <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Invitation Invalid</h1>
          <p className="text-slate-400 mb-8">{fetchError}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700
              text-white rounded-lg font-medium transition-colors"
          >
            Go to NurseSphere
          </Link>
        </div>
      </div>
    )
  }

  // Success state
  if (accepted) {
    return (
      <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Welcome to the Team! 🎉</h1>
          <p className="text-slate-400 mb-2">
            You&apos;ve been added as <strong className="text-white">{invite ? formatRole(invite.role) : ''}</strong> at{' '}
            <strong className="text-white">{invite?.facility_name}</strong>.
          </p>
          <p className="text-slate-500 text-sm">Redirecting to your dashboard...</p>
          <div className="mt-6">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700
                text-white rounded-lg font-medium transition-colors"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f23] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-white">NurseSphere</span>
          </div>
          <h1 className="text-2xl font-bold text-white">You&apos;ve been invited!</h1>
          <p className="text-slate-400 mt-2 text-sm">
            {invite?.invited_by_name} has invited you to join their team
          </p>
        </div>

        {/* Invite Card */}
        <div className="bg-[#1a1a2e] border border-slate-700/50 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-indigo-600/20 border border-indigo-500/30
              flex items-center justify-center flex-shrink-0">
              <Building2 className="w-7 h-7 text-indigo-400" />
            </div>
            <div>
              <p className="text-white font-semibold text-lg">{invite?.facility_name}</p>
              <p className="text-slate-400 text-sm">
                Role: <span className="text-indigo-400 font-medium">{invite ? formatRole(invite.role) : ''}</span>
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Invited to</span>
              <span className="text-slate-300">{invite?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Invited by</span>
              <span className="text-slate-300">{invite?.invited_by_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Expires</span>
              <span className="text-slate-300">
                {invite?.expires_at
                  ? new Date(invite.expires_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Area */}
        {!user ? (
          // Not logged in
          <div className="space-y-3">
            <p className="text-slate-400 text-sm text-center mb-4">
              Sign in or create an account with <strong className="text-white">{invite?.email}</strong> to accept this invitation.
            </p>
            <Link
              href={`/auth/signin?email=${encodeURIComponent(invite?.email ?? '')}&redirect=/invite/${token}`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600
                hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors text-sm"
            >
              <LogIn className="w-4 h-4" />
              Sign In to Accept
            </Link>
            <Link
              href={`/auth/register?email=${encodeURIComponent(invite?.email ?? '')}&redirect=/invite/${token}`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-700
                hover:bg-slate-600 text-white rounded-lg font-medium transition-colors text-sm border border-slate-600"
            >
              <UserPlus className="w-4 h-4" />
              Create Account
            </Link>
          </div>
        ) : (
          // Logged in — show accept button
          <div>
            {acceptError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3
                mb-4 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {acceptError}
              </div>
            )}

            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-3 mb-4 text-sm text-slate-300">
              Signed in as <strong className="text-white">{user.email}</strong>
            </div>

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600
                hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {accepting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Accepting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Accept Invitation
                </>
              )}
            </button>

            <p className="text-slate-500 text-xs text-center mt-3">
              By accepting, you&apos;ll be added as an admin for {invite?.facility_name}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
