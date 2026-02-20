import { DashboardLayout } from '@/components/layout'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function TermsOfServicePage() {
  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
        </div>

        <div className="ns-card p-6 prose prose-invert prose-sm max-w-none">
          <p className="text-gray-400">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-white">1. Acceptance of Terms</h2>
          <p className="text-gray-300">
            By accessing and using NurseSphere, you accept and agree to be bound by the terms and
            provisions of this agreement.
          </p>

          <h2 className="text-white">2. Description of Service</h2>
          <p className="text-gray-300">
            NurseSphere provides a healthcare staffing platform that connects hospitals and healthcare
            facilities with nursing professionals. Our services include shift management, contract
            generation, compliance tracking, and analytics.
          </p>

          <h2 className="text-white">3. User Accounts</h2>
          <p className="text-gray-300">
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activities that occur under your account. You must notify us immediately of any
            unauthorized use of your account.
          </p>

          <h2 className="text-white">4. Contract Signatures</h2>
          <p className="text-gray-300">
            Electronic signatures made through NurseSphere are legally binding. Once a contract is
            signed by all parties, it becomes immutable and cannot be altered.
          </p>

          <h2 className="text-white">5. Limitation of Liability</h2>
          <p className="text-gray-300">
            NurseSphere shall not be liable for any indirect, incidental, special, consequential,
            or punitive damages resulting from your use of the service.
          </p>

          <h2 className="text-white">6. Contact</h2>
          <p className="text-gray-300">
            For questions about these Terms of Service, please contact us at legal@nursesphere.io.
          </p>
        </div>
      </div>
    </DashboardLayout>
  )
}

