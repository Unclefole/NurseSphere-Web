'use client'

import Link from 'next/link'
import { Apple } from 'lucide-react'

export function CTASection() {
  return (
    <section className="py-16 border-t border-ns-dark-700">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Hospital CTA */}
          <div className="text-center">
            <h3 className="text-xl font-bold text-white mb-3">
              Hospital & Clinic Staffing
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              Manage shifts, compliance, billing, and staff coordination.
            </p>
            <div className="space-y-3">
              <Link
                href="/auth/signin"
                className="block w-full max-w-xs mx-auto ns-btn-primary text-center"
              >
                Sign In
              </Link>
              <Link
                href="/auth/register"
                className="block w-full max-w-xs mx-auto ns-btn-secondary text-center"
              >
                Register Your Hospital
              </Link>
            </div>
          </div>

          {/* Nurse CTA */}
          <div className="text-center">
            <h3 className="text-xl font-bold text-white mb-3">
              Registered Nurses & Staff
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              Access your schedule, pay-stubs, and workflows via the mobile app.
            </p>
            <div className="space-y-3">
              <a
                href="#download"
                className="flex items-center justify-center gap-2 w-full max-w-xs mx-auto ns-btn-primary"
              >
                <Apple className="h-4 w-4" />
                Download Nurse App
              </a>
              <Link
                href="/nurse"
                className="block w-full max-w-xs mx-auto text-sm text-gray-400 hover:text-white transition-colors"
              >
                Nurse Web Access (Read-Only)
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

