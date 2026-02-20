'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { HeroSection, DashboardPreview, CTASection } from '@/components/landing'

export default function HomePage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Redirect authenticated hospital users to dashboard
    if (!loading && user && isHospital) {
      router.push('/dashboard')
    }
  }, [user, loading, isHospital, router])

  // Show landing page for unauthenticated users
  return (
    <DashboardLayout>
      <div className="container mx-auto px-4">
        <HeroSection />
        <DashboardPreview />
        <CTASection />
      </div>
    </DashboardLayout>
  )
}

