// Re-export all types
export * from './database'

// UI-specific types
export interface DashboardTile {
  id: string
  title: string
  icon: string
  href: string
  color: string
  badge?: number
  description?: string
}

export interface NavItem {
  label: string
  href: string
  icon?: string
  badge?: number
  children?: NavItem[]
}

export interface AuthUser {
  id: string
  email: string
  role: 'HOSPITAL' | 'NURSE'
  hospitalId?: string
  profile?: {
    fullName: string | null
    avatarUrl: string | null
  }
}

// Analytics types matching mobile app
export interface SpherAnalytics {
  totalContracts: number
  signedContracts: number
  pendingContracts: number
  avgTimeToSign: number // in hours
  spheriGenerated: number
  manuallyCreated: number
  optimizationRate: number // percentage
}

// Application with related data
export interface ApplicationWithDetails extends Application {
  nurse: {
    id: string
    profile: {
      full_name: string | null
      email: string
      avatar_url: string | null
    }
    specialty: string | null
    years_experience: number | null
    hourly_rate: number | null
  }
  shift: {
    id: string
    title: string
    start_time: string
    end_time: string
    department: string | null
  }
}

// Contract with related data
export interface ContractWithDetails extends Contract {
  nurse: {
    profile: {
      full_name: string | null
      email: string
    }
  }
  hospital: {
    name: string
  }
  shift?: {
    title: string
    start_time: string
    end_time: string
  }
}

// Import base types
import type { Application, Contract } from './database'

