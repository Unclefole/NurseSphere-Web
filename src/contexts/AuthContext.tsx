'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, Facility, UserRole } from '@/types/database'

// HIPAA-compliant session timeout: 15 minutes
const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const WARNING_TIMEOUT_MS = 13 * 60 * 1000 // Show warning at 13 minutes

interface AuthUser {
  id: string
  email: string
  role: UserRole
  facilityId: string | null
  profile: Profile | null
  facility: Facility | null
}

interface AuthContextType {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  isHospital: boolean
  isNurse: boolean
  showTimeoutWarning: boolean
  extendSession: () => void
  timeoutCountdown: number
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false)
  const [timeoutCountdown, setTimeoutCountdown] = useState(0)
  const [lastActivity, setLastActivity] = useState(Date.now())
  
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Reset session timeout timers
  const resetSessionTimeout = useCallback(() => {
    const now = Date.now()
    setLastActivity(now)
    setShowTimeoutWarning(false)
    
    // Clear existing timers
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current)
    
    if (user) {
      // Set warning timer (13 minutes)
      warningTimerRef.current = setTimeout(() => {
        setShowTimeoutWarning(true)
        setTimeoutCountdown(2 * 60) // 2 minutes countdown
        
        // Start countdown
        const countdown = setInterval(() => {
          setTimeoutCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdown)
              handleSessionTimeout()
              return 0
            }
            return prev - 1
          })
        }, 1000)
        
        countdownTimerRef.current = countdown as any
      }, WARNING_TIMEOUT_MS)
      
      // Set automatic logout timer (15 minutes)
      timeoutTimerRef.current = setTimeout(() => {
        handleSessionTimeout()
      }, SESSION_TIMEOUT_MS)
    }
  }, [user])

  // Handle session timeout
  const handleSessionTimeout = useCallback(async () => {
    console.log('[Auth] Session timeout - auto logout')
    
    // Log the session timeout for audit
    if (user) {
      try {
        await fetch('/api/audit/session-timeout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            sessionDuration: Date.now() - lastActivity,
            reason: 'inactivity_timeout'
          })
        })
      } catch (e) {
        console.error('[Auth] Failed to log session timeout:', e)
      }
    }
    
    await signOut()
    setShowTimeoutWarning(false)
    
    // Show timeout message
    alert('Your session has expired due to inactivity. Please sign in again for security.')
  }, [user, lastActivity])

  // Extend session (called when user interacts during warning)
  const extendSession = useCallback(() => {
    console.log('[Auth] Session extended by user')
    resetSessionTimeout()
  }, [resetSessionTimeout])

  // Track user activity
  const trackActivity = useCallback(() => {
    if (user && !showTimeoutWarning) {
      resetSessionTimeout()
    }
  }, [user, showTimeoutWarning, resetSessionTimeout])

  // Set up activity listeners
  useEffect(() => {
    if (user) {
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
      
      events.forEach(event => {
        document.addEventListener(event, trackActivity, true)
      })
      
      return () => {
        events.forEach(event => {
          document.removeEventListener(event, trackActivity, true)
        })
      }
    }
  }, [user, trackActivity])

  const fetchUserProfile = useCallback(async (supabaseUser: User): Promise<AuthUser | null> => {
    try {
      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role, email, phone, created_at')
        .eq('id', supabaseUser.id)
        .single()

      if (profileError || !profile) {
        console.error('Error fetching profile:', profileError)
        return null
      }

      // If user is a HOSPITAL role, get their associated facility via facility_admins junction table
      let facility: Facility | null = null
      let facilityId: string | null = null

      if ((profile as Profile).role === 'hospital_admin') {
        // Use proper junction table instead of email matching for security
        const { data: facilityAdminData } = await supabase
          .from('facility_admins')
          .select(`
            facility_id,
            facilities!inner (*)
          `)
          .eq('user_id', supabaseUser.id)
          .limit(1)
          .single()

        if (facilityAdminData?.facilities) {
          facility = Array.isArray(facilityAdminData.facilities) 
            ? facilityAdminData.facilities[0] as Facility 
            : facilityAdminData.facilities as Facility
          facilityId = facilityAdminData.facility_id
        }
      }

      return {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        role: (profile as Profile).role,
        facilityId,
        profile: profile as Profile,
        facility,
      }
    } catch (error) {
      console.error('Error in fetchUserProfile:', error)
      return null
    }
  }, [])

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession()
        
        if (initialSession?.user) {
          const authUser = await fetchUserProfile(initialSession.user)
          setUser(authUser)
          setSession(initialSession)
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
      } finally {
        setLoading(false)
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        if (event === 'SIGNED_IN' && currentSession?.user) {
          const authUser = await fetchUserProfile(currentSession.user)
          setUser(authUser)
          setSession(currentSession)
          // Start session timeout tracking
          setTimeout(() => resetSessionTimeout(), 100)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
          setSession(null)
          setShowTimeoutWarning(false)
          // Clear all timers
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current)
          if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
          if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current)
        } else if (event === 'TOKEN_REFRESHED' && currentSession?.user) {
          setSession(currentSession)
          // Reset timeout on token refresh
          resetSessionTimeout()
        }
        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [fetchUserProfile])

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? error : null }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }

  const value: AuthContextType = {
    user,
    session,
    loading,
    signIn,
    signOut,
    isHospital: user?.role === 'hospital_admin',
    isNurse: user?.role === 'nurse',
    showTimeoutWarning,
    extendSession,
    timeoutCountdown,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// HOC for protecting routes - Hospital only
export function withHospitalAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>
) {
  return function WithHospitalAuthComponent(props: P) {
    const { user, loading, isHospital } = useAuth()

    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
          <div className="animate-pulse text-ns-teal">Loading...</div>
        </div>
      )
    }

    if (!user) return null

    if (!isHospital) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Access Denied</h1>
            <p className="text-gray-400">
              This area is for hospital administrators only.
            </p>
          </div>
        </div>
      )
    }

    return <WrappedComponent {...props} />
  }
}
