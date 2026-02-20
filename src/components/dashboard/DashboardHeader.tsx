'use client'

interface DashboardHeaderProps {
  title: string
  subtitle: string
}

export function DashboardHeader({ title, subtitle }: DashboardHeaderProps) {
  return (
    <div className="ns-header-card mb-6">
      <h1 className="text-2xl font-bold text-white mb-1">{title}</h1>
      <p className="text-white/80 text-sm">{subtitle}</p>
    </div>
  )
}

