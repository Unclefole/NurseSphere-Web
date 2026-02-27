'use client'

import { DashboardTile } from './DashboardTile'
import { MessageCircle } from 'lucide-react'
import Link from 'next/link'

// Dashboard tiles configuration - matches mobile app structure
const dashboardTiles = [
  { id: 'create-shift', title: 'Create Shift', href: '/shifts/create' },
  { id: 'manage-shifts', title: 'Manage Shifts', href: '/shifts' },
  { id: 'applicants', title: 'Applicants', href: '/applicants' },
  { id: 'nurses', title: 'Nurses', href: '/nurses' },
  { id: 'analytics', title: 'Analytics', href: '/analytics' },
  { id: 'billing', title: 'Billing', href: '/billing' },
  { id: 'invoices', title: 'Invoices', href: '/contracts' },
  { id: 'credentials', title: 'Credentials', href: '/dashboard/credentials' },
  { id: 'compliance', title: 'Compliance', href: '/compliance' },
  { id: 'forecasting', title: 'Forecasting', href: '/forecasting' },
  { id: 'live-map', title: 'Live Map', href: '/map' },
  { id: 'crm', title: 'CRM', href: '/crm' },
  { id: 'incidents', title: 'Incidents', href: '/incidents' },
  { id: 'education', title: 'Education', href: '/education' },
  { id: 'audit-log', title: 'Audit Log', href: '/dashboard/audit-log' },
  { id: 'security', title: 'Security', href: '/dashboard/security' },
]

interface DashboardGridProps {
  badges?: Record<string, number>
  unreadMessages?: number
}

export function DashboardGrid({ badges = {}, unreadMessages = 0 }: DashboardGridProps) {
  return (
    <div className="space-y-4">
      {/* Main tiles grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {dashboardTiles.map((tile) => (
          <DashboardTile
            key={tile.id}
            id={tile.id}
            title={tile.title}
            href={tile.href}
            badge={badges[tile.id]}
          />
        ))}
      </div>

      {/* Messages tile - wider format as shown in design */}
      <Link
        href="/messages"
        className="ns-card-hover p-4 flex items-center gap-4 animate-fade-in"
      >
        <div className="ns-tile-icon bg-sky-500/20 rounded-lg">
          <MessageCircle className="h-6 w-6 text-sky-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-white">Messages</h3>
          <p className="text-xs text-gray-400">View conversations</p>
        </div>
        {unreadMessages > 0 && (
          <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-ns-teal px-2 text-xs font-medium text-white">
            {unreadMessages > 99 ? '99+' : unreadMessages}
          </span>
        )}
      </Link>
    </div>
  )
}

