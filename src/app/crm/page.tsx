'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { ArrowLeft, UserCog, Construction } from 'lucide-react'

export default function CRMPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/signin')
    }
    if (!loading && user && !isHospital) {
      router.push('/nurse')
    }
  }, [user, loading, isHospital, router])

  if (loading || !user || !isHospital) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">CRM</h1>
            <p className="text-gray-400 text-sm">Customer relationship management</p>
          </div>
        </div>

        <div className="ns-card p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-500/20 flex items-center justify-center">
            <UserCog className="h-8 w-8 text-indigo-400" />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">CRM Module</h3>
          <p className="text-gray-400 mb-4">
            Customer relationship and nurse management tools coming soon.
          </p>
          <div className="inline-flex items-center gap-2 text-sm text-yellow-400">
            <Construction className="h-4 w-4" />
            Under Development
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

