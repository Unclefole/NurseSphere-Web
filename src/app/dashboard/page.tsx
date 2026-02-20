'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { DashboardHeader, DashboardGrid } from '@/components/dashboard'
import { supabase } from '@/lib/supabase'

interface DashboardStats {
  pendingApplicants: number
  unreadMessages: number
  openShifts: number
  pendingContracts: number
}

export default function DashboardPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    pendingApplicants: 0,
    unreadMessages: 0,
    openShifts: 0,
    pendingContracts: 0,
  })

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/signin')
      return
    }

    if (!loading && user && !isHospital) {
      router.push('/nurse')
      return
    }
  }, [user, loading, isHospital, router])

  useEffect(() => {
    if (!user?.hospitalId) return

    const fetchStats = async () => {
      try {
        // Fetch pending applicants count
        const { count: applicantsCount } = await supabase
          .from('applications')
          .select('*', { count: 'exact', head: true })
          .eq('hospital_id', user.hospitalId)
          .eq('status', 'pending')

        // Fetch unread messages count
        const { count: messagesCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('recipient_id', user.id)
          .eq('read', false)

        // Fetch open shifts count
        const { count: shiftsCount } = await supabase
          .from('shifts')
          .select('*', { count: 'exact', head: true })
          .eq('hospital_id', user.hospitalId)
          .eq('status', 'open')

        // Fetch pending contracts count
        const { count: contractsCount } = await supabase
          .from('contracts')
          .select('*', { count: 'exact', head: true })
          .eq('hospital_id', user.hospitalId)
          .eq('status', 'pending')

        setStats({
          pendingApplicants: applicantsCount || 0,
          unreadMessages: messagesCount || 0,
          openShifts: shiftsCount || 0,
          pendingContracts: contractsCount || 0,
        })
      } catch (error) {
        console.error('Error fetching dashboard stats:', error)
      }
    }

    fetchStats()
  }, [user])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading dashboard...</div>
      </div>
    )
  }

  if (!user || !isHospital) {
    return null
  }

  const badges: Record<string, number> = {
    applicants: stats.pendingApplicants,
    'manage-shifts': stats.openShifts,
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        <DashboardHeader
          title="Hospital Dashboard"
          subtitle="Manage your staffing needs and operations"
        />
        <DashboardGrid badges={badges} unreadMessages={stats.unreadMessages} />
      </div>
    </DashboardLayout>
  )
}

