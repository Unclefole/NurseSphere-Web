import { DashboardLayout } from '@/components/layout'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPolicyPage() {
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
          <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
        </div>

        <div className="ns-card p-6 prose prose-invert prose-sm max-w-none">
          <p className="text-gray-400">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-white">1. Information We Collect</h2>
          <p className="text-gray-300">
            NurseSphere collects information you provide directly to us, including but not limited to
            your name, email address, phone number, professional credentials, and employment information.
          </p>

          <h2 className="text-white">2. How We Use Your Information</h2>
          <p className="text-gray-300">
            We use the information we collect to provide, maintain, and improve our services,
            to process transactions, and to communicate with you about our services.
          </p>

          <h2 className="text-white">3. Data Security</h2>
          <p className="text-gray-300">
            We implement appropriate technical and organizational measures to protect your personal
            information against unauthorized access, alteration, disclosure, or destruction.
          </p>

          <h2 className="text-white">4. Healthcare Compliance</h2>
          <p className="text-gray-300">
            NurseSphere is committed to compliance with applicable healthcare regulations, including
            HIPAA where applicable. We maintain appropriate safeguards for protected health information.
          </p>

          <h2 className="text-white">5. Contact Us</h2>
          <p className="text-gray-300">
            If you have any questions about this Privacy Policy, please contact us at privacy@nursesphere.io.
          </p>
        </div>
      </div>
    </DashboardLayout>
  )
}

