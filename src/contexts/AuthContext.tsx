'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types/database'

interface AuthUser {
  id: string
  email: string
  role: UserRole
  hospitalId: string | null
  profile: Profile | null
}

interface AuthContextType {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  isHospital: boolean
  isNurse: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUserProfile = useCallback(async (supabaseUser: User): Promise<AuthUser | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', supabaseUser.id)
        .single()

      if (error) {
        console.error('Error fetching profile:', error)
        return null
      }

      const profile = data as Profile | null
      if (!profile) return null

      return {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        role: profile.role as UserRole,
        hospitalId: profile.hospital_id,
        profile,
      }
    } catch (error) {
      console.error('Error in fetchUserProfile:', error)
      return null
    }
  }, [])

  useEffect(() => {
    // Get initial session
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

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        if (event === 'SIGNED_IN' && currentSession?.user) {
          const authUser = await fetchUserProfile(currentSession.user)
          setUser(authUser)
          setSession(currentSession)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
          setSession(null)
        } else if (event === 'TOKEN_REFRESHED' && currentSession?.user) {
          setSession(currentSession)
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
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      
      if (error) {
        return { error }
      }
      
      return { error: null }
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
    isHospital: user?.role === 'HOSPITAL',
    isNurse: user?.role === 'NURSE',
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

    if (!user) {
      // Redirect to login will be handled by middleware
      return null
    }

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

