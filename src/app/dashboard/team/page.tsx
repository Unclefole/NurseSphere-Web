'use client'

/**
 * /dashboard/team
 *
 * Multi-admin facility team management.
 * - List current admins
 * - Invite new admins via email
 * - View + revoke pending invites
 * - Remove admins
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Users,
  UserPlus,
  Mail,
  Clock,
  CheckCircle2,
  Trash2,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
  Shield,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  profile_id: string
  role: string
  joined_at: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
}

interface PendingInvite {
  id: string
  email: string
  role: string
  created_at: string
  expires_at: string
  status: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  onClose: () => void
  onInvited: (msg: string) => void
}

function InviteModal({ onClose, onInvited }: InviteModalProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('hospital_admin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to send invite')
      onInvited(`Invitation sent to ${email}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a2e] border border-slate-700/50 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Invite Team Member</h2>
            <p className="text-slate-400 text-sm mt-0.5">Send an admin invite to a colleague</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@hospital.org"
                className="w-full bg-[#0f0f23] border border-slate-600 rounded-lg pl-10 pr-4 py-2.5
                  text-sm text-white placeholder:text-slate-500
                  focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-[#0f0f23] border border-slate-600 rounded-lg px-3 py-2.5
                text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="hospital_admin">Hospital Admin</option>
              <option value="billing_admin">Billing Admin</option>
              <option value="scheduler">Scheduler</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300
                hover:bg-slate-700 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700
                text-white transition-colors text-sm font-medium disabled:opacity-50
                disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Send Invite
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Remove Confirm ───────────────────────────────────────────────────────────

interface RemoveConfirmProps {
  member: TeamMember
  onClose: () => void
  onRemoved: () => void
}

function RemoveConfirm({ member, onClose, onRemoved }: RemoveConfirmProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRemove = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/team/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: member.profile_id }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to remove member')
      onRemoved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a2e] border border-red-500/30 rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-red-400">Remove Admin</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-slate-300 text-sm mb-5">
          Remove <strong className="text-white">{member.full_name ?? member.email}</strong> from
          your facility? They will lose admin access immediately.
        </p>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300
              hover:bg-slate-700 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleRemove}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white
              transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TeamPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()

  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && (!user || !isHospital)) {
      router.push('/auth/signin')
    }
  }, [user, authLoading, isHospital, router])

  const fetchData = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch('/api/team/members'),
        fetch('/api/team/invites'),
      ])
      const [membersJson, invitesJson] = await Promise.all([
        membersRes.json(),
        invitesRes.ok ? invitesRes.json() : Promise.resolve({ invites: [] }),
      ])
      setMembers(membersJson.members ?? [])
      setInvites(invitesJson.invites ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error loading team data')
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    if (user && isHospital) fetchData()
  }, [user, isHospital, fetchData])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function handleRevokeInvite(inviteId: string) {
    setRevoking(inviteId)
    try {
      const res = await fetch(`/api/team/invites/${inviteId}/revoke`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? 'Failed to revoke invite')
      }
      showToast('Invite revoked')
      fetchData()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Error revoking invite')
    } finally {
      setRevoking(null)
    }
  }

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-600 text-white px-4 py-3 rounded-lg
          shadow-lg text-sm max-w-sm">
          {toast}
        </div>
      )}

      {/* Modals */}
      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onInvited={(msg) => {
            setShowInviteModal(false)
            showToast(msg)
            fetchData()
          }}
        />
      )}
      {removeTarget && (
        <RemoveConfirm
          member={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null)
            showToast('Team member removed')
            fetchData()
          }}
        />
      )}

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Team Management</h1>
            <p className="text-slate-400 text-sm mt-1">
              Manage facility administrators and pending invitations
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              disabled={fetching}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600
                text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700
                text-white transition-colors text-sm font-medium"
            >
              <UserPlus className="w-4 h-4" />
              Invite Team Member
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 mb-6 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {fetching && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        )}

        {!fetching && (
          <>
            {/* Current Admins */}
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold text-white">Administrators</h2>
                <span className="ml-1 px-2 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs">
                  {members.length}
                </span>
              </div>

              {members.length === 0 ? (
                <div className="text-center py-10 border border-slate-700/50 rounded-xl bg-slate-800/20">
                  <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No team members yet</p>
                </div>
              ) : (
                <div className="bg-[#1a1a2e] border border-slate-700/50 rounded-xl overflow-hidden">
                  {members.map((member, i) => (
                    <div
                      key={member.profile_id}
                      className={`flex items-center justify-between px-4 py-4
                        ${i < members.length - 1 ? 'border-b border-slate-700/30' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-indigo-600/30 flex items-center justify-center
                          text-indigo-300 text-sm font-semibold flex-shrink-0">
                          {getInitials(member.full_name ?? member.email)}
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">
                            {member.full_name ?? 'Unknown Name'}
                          </p>
                          <p className="text-slate-400 text-xs">{member.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="flex items-center gap-1">
                            <Shield className="w-3 h-3 text-slate-500" />
                            <span className="text-xs text-slate-400 capitalize">
                              {member.role.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-slate-500 text-xs mt-0.5">Joined {fmt(member.joined_at)}</p>
                        </div>

                        {member.profile_id !== user?.id && (
                          <button
                            onClick={() => setRemoveTarget(member)}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400
                              transition-colors"
                            title="Remove admin"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {member.profile_id === user?.id && (
                          <span className="text-xs text-slate-600 italic px-2">You</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Pending Invites */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-yellow-400" />
                <h2 className="text-lg font-semibold text-white">Pending Invitations</h2>
                {invites.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-full text-xs">
                    {invites.length}
                  </span>
                )}
              </div>

              {invites.length === 0 ? (
                <div className="text-center py-10 border border-slate-700/50 rounded-xl bg-slate-800/20">
                  <Mail className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No pending invitations</p>
                </div>
              ) : (
                <div className="bg-[#1a1a2e] border border-slate-700/50 rounded-xl overflow-hidden">
                  {invites.map((invite, i) => (
                    <div
                      key={invite.id}
                      className={`flex items-center justify-between px-4 py-4
                        ${i < invites.length - 1 ? 'border-b border-slate-700/30' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-yellow-500/10 border border-yellow-500/20
                          flex items-center justify-center flex-shrink-0">
                          <Mail className="w-4 h-4 text-yellow-400" />
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{invite.email}</p>
                          <p className="text-slate-400 text-xs">
                            Role: <span className="capitalize">{invite.role.replace('_', ' ')}</span>
                            {' · '}Expires {fmt(invite.expires_at)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 px-2 py-1 bg-yellow-500/10 border
                          border-yellow-500/20 text-yellow-400 rounded-full text-xs">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                        <button
                          onClick={() => handleRevokeInvite(invite.id)}
                          disabled={revoking === invite.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/10
                            hover:bg-red-600/20 text-red-400 border border-red-500/20 text-xs transition-colors
                            disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {revoking === invite.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                          Revoke
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* Invite sent confirmation inline */}
        {!fetching && members.length === 1 && invites.length === 0 && (
          <div className="mt-6 flex items-center gap-3 text-sm text-slate-400">
            <CheckCircle2 className="w-4 h-4 text-indigo-400" />
            Invite a colleague using the button above to collaborate on this facility.
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
