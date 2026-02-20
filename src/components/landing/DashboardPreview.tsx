'use client'

import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { DashboardGrid } from '@/components/dashboard/DashboardGrid'

export function DashboardPreview() {
  return (
    <section className="max-w-3xl mx-auto mb-12">
      {/* Browser mockup frame */}
      <div className="ns-card rounded-2xl overflow-hidden shadow-2xl">
        {/* Browser header */}
        <div className="bg-ns-dark-700 px-4 py-3 flex items-center justify-between border-b border-ns-dark-600">
          <span className="text-sm text-gray-300">NurseSphere.io</span>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ns-dark-600" />
            <span className="text-xs text-gray-400">Sign up</span>
          </div>
        </div>
        
        {/* Dashboard content */}
        <div className="p-4 sm:p-6 bg-ns-dark-800">
          <DashboardHeader 
            title="Hospital Dashboard"
            subtitle="Manage your staffing needs and operations"
          />
          <DashboardGrid />
        </div>
      </div>

      {/* Download button below preview */}
      <div className="flex justify-center mt-6">
        <a
          href="#download"
          className="ns-btn-primary text-sm"
        >
          Download Nurse App
        </a>
      </div>
    </section>
  )
}

