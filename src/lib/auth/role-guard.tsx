'use client'

/**
 * NurseSphere – Client-side Role Guard HOC
 *
 * withRoleGuard(WrappedComponent, allowedRoles) — React HOC for page-level
 * role protection. Wraps a component and guards it with role-based access.
 *
 * For server-side API route role checking, use:
 *   import { requireRole } from '@/lib/auth/server-role-guard'
 *
 * Usage:
 *   export default withRoleGuard(MyPage, ['hospital_admin'])
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'

/**
 * Higher-order component that restricts a page to users with one of the
 * specified roles. Unauthenticated users are redirected to /auth/signin.
 * Users with the wrong role see an Access Denied screen.
 */
export function withRoleGuard<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  allowedRoles: UserRole[],
): React.ComponentType<P> {
  function RoleGuardedComponent(props: P) {
    const { user, loading } = useAuth()
    const router = useRouter()

    useEffect(() => {
      if (!loading && !user) {
        router.replace('/auth/signin')
      }
    }, [user, loading, router])

    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
          <div className="animate-pulse text-ns-teal">Verifying access…</div>
        </div>
      )
    }

    if (!user) {
      return null as unknown as React.ReactElement
    }

    if (!allowedRoles.includes(user.role)) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-ns-dark-950 gap-4">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400 mb-6">
              You do not have permission to view this page.
              <br />
              Required role:{' '}
              <code className="text-ns-teal">{allowedRoles.join(' or ')}</code>
            </p>
            <button
              onClick={() => router.replace('/dashboard')}
              className="px-4 py-2 bg-ns-teal text-white rounded hover:bg-opacity-90 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )
    }

    return <WrappedComponent {...props} />
  }

  RoleGuardedComponent.displayName = `withRoleGuard(${WrappedComponent.displayName ?? WrappedComponent.name})`
  return RoleGuardedComponent
}
