'use client'

import Link from 'next/link'
import {
  Plus,
  CalendarDays,
  UserCheck,
  Users,
  BarChart3,
  DollarSign,
  Shield,
  TrendingUp,
  MapPin,
  UserCog,
  AlertTriangle,
  GraduationCap,
  MessageCircle,
  LucideIcon,
} from 'lucide-react'

// Icon mapping for tiles
const iconMap: Record<string, LucideIcon> = {
  'create-shift': Plus,
  'manage-shifts': CalendarDays,
  'applicants': UserCheck,
  'nurses': Users,
  'analytics': BarChart3,
  'billing': DollarSign,
  'compliance': Shield,
  'forecasting': TrendingUp,
  'live-map': MapPin,
  'crm': UserCog,
  'incidents': AlertTriangle,
  'education': GraduationCap,
  'messages': MessageCircle,
}

// Color mapping for tile icons
const colorMap: Record<string, { bg: string; text: string }> = {
  'create-shift': { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  'manage-shifts': { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  'applicants': { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  'nurses': { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  'analytics': { bg: 'bg-green-500/20', text: 'text-green-400' },
  'billing': { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  'compliance': { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  'forecasting': { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  'live-map': { bg: 'bg-red-500/20', text: 'text-red-400' },
  'crm': { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
  'incidents': { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  'education': { bg: 'bg-teal-500/20', text: 'text-teal-400' },
  'messages': { bg: 'bg-sky-500/20', text: 'text-sky-400' },
}

interface DashboardTileProps {
  id: string
  title: string
  href: string
  badge?: number
  description?: string
  disabled?: boolean
}

export function DashboardTile({
  id,
  title,
  href,
  badge,
  description,
  disabled = false,
}: DashboardTileProps) {
  const Icon = iconMap[id] || Users
  const colors = colorMap[id] || { bg: 'bg-gray-500/20', text: 'text-gray-400' }

  const content = (
    <>
      <div className={`ns-tile-icon ${colors.bg} rounded-lg`}>
        <Icon className={`h-6 w-6 ${colors.text}`} />
      </div>
      <span className="text-sm font-medium text-white">{title}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-2 right-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ns-teal px-1.5 text-xs font-medium text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {description && (
        <span className="text-xs text-gray-400 text-center">{description}</span>
      )}
    </>
  )

  if (disabled) {
    return (
      <div className="ns-card p-4 flex flex-col items-center justify-center gap-2 min-h-[100px] opacity-50 cursor-not-allowed relative">
        {content}
      </div>
    )
  }

  return (
    <Link
      href={href}
      className="ns-tile relative animate-stagger"
    >
      {content}
    </Link>
  )
}

