'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { useAuth } from '@/contexts/AuthContext'

export default function HomePage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && isHospital) {
      router.push('/dashboard')
    }
  }, [user, loading, isHospital, router])

  return (
    <div className="bg-nurse-dark text-slate-200 font-sans min-h-screen selection:bg-nurse-teal selection:text-white">

      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full px-6 py-4 bg-nurse-dark/80 backdrop-blur-md border-b border-white/5">
        <nav className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-2">
            <Logo height={34} variant="dark" />
          </div>
          <Link
            href="/auth/signin"
            className="text-sm font-medium text-nurse-teal hover:text-teal-400 transition-colors"
          >
            Sign In
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative px-6 pt-12 pb-16 overflow-hidden">
          {/* Background glow */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-teal-500/10 rounded-full blur-[100px] pointer-events-none" />
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-serif font-bold leading-tight text-white mb-6">
              NurseSphere: The Enterprise Standard for Clinical Staffing &amp; Compliance
            </h1>
            <p className="text-lg text-slate-400 leading-relaxed mb-10 max-w-2xl mx-auto">
              A unified, HIPAA-compliant ecosystem for hospital staffing, credentialing, and litigation defense. Built for scale.
            </p>
            <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:space-x-4 justify-center">
              <Link
                href="/auth/register"
                className="px-8 py-4 bg-nurse-teal hover:bg-teal-400 text-nurse-dark font-bold rounded-lg transition-all transform active:scale-95 shadow-lg shadow-teal-500/20 text-center"
              >
                Register Your Hospital
              </Link>
              <a
                href="mailto:francis@nursesphere.io?subject=BAA%20%26%20Demo%20Request&body=Hi%2C%20I%27d%20like%20to%20learn%20more%20about%20NurseSphere%20and%20request%20a%20BAA%20and%20demo."
                className="px-8 py-4 border border-white/20 hover:border-nurse-teal text-white font-semibold rounded-lg transition-all text-center"
              >
                Request BAA &amp; Demo
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="px-6 py-12">
          <div className="grid grid-cols-1 gap-6 max-w-5xl mx-auto">

            {/* Feature 1: Compliance Engine */}
            <div
              className="rounded-2xl border-l-4 border-l-nurse-teal p-6"
              style={{ background: 'rgba(15, 39, 46, 0.6)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', borderLeft: '4px solid #14b8a6' }}
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 p-3 bg-teal-500/10 rounded-xl">
                  <svg className="w-8 h-8 text-nurse-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Automated Compliance Engine</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Real-time credential tracking with daily OIG/NURSYS/SAM sweeps. Auto-suspension state machine and primary source verification — never miss a license expiration.
                  </p>
                </div>
              </div>
            </div>

            {/* Feature 2: Zero-Trust Security */}
            <div
              className="rounded-2xl p-6"
              style={{ background: 'rgba(15, 39, 46, 0.6)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', borderLeft: '4px solid rgba(20,184,166,0.5)' }}
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 p-3 bg-teal-500/10 rounded-xl">
                  <svg className="w-8 h-8 text-nurse-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Zero-Trust Security Architecture</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    PHI guard middleware blocks 11 sensitive fields at the wire. SHA-256 credential hashing, multi-tenant isolation, and granular RBAC for every interaction.
                  </p>
                </div>
              </div>
            </div>

            {/* Feature 3: Litigation Defense */}
            <div
              className="rounded-2xl p-6"
              style={{ background: 'rgba(15, 39, 46, 0.6)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', borderLeft: '4px solid rgba(20,184,166,0.3)' }}
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 p-3 bg-teal-500/10 rounded-xl">
                  <svg className="w-8 h-8 text-nurse-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 01-6.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Litigation &amp; Audit Defense</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Immutable SHA-256 signed shift risk certificates. Competency scoring guards high-acuity shifts. Verifiable compliance trail that reduces legal liability exposure.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Credibility Bar */}
        <section className="px-6 py-12 border-y border-white/5" style={{ background: 'rgba(15, 39, 46, 0.3)' }}>
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-xs font-bold uppercase tracking-widest text-slate-500 mb-8">
              Trust &amp; Compliance Standards
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-center justify-center opacity-70">
              {[
                { label: '[ HIPAA ]', sub: 'Compliant' },
                { label: '[ SOC2 ]', sub: 'Ready' },
                { label: '[ BAA ]', sub: 'Available' },
                { label: '[ 256-bit ]', sub: 'Encryption' },
              ].map(({ label, sub }) => (
                <div key={label} className="flex flex-col items-center p-4 border border-white/10 rounded-xl">
                  <div className="text-[10px] text-nurse-teal mb-1 font-mono">{label}</div>
                  <span className="text-xs font-medium text-slate-300">{sub}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="px-6 py-10 text-center border-t border-white/5">
        <div className="flex flex-col items-center space-y-4">
          <div className="flex space-x-6 text-xs text-slate-500">
            <Link href="/privacy" className="hover:text-nurse-teal transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-nurse-teal transition-colors">Terms of Service</Link>
            <Link href="/auth/signin" className="hover:text-nurse-teal transition-colors">Sign In</Link>
          </div>
          <p className="text-[10px] text-slate-600">© 2026 NurseSphere IO. All rights reserved.</p>
        </div>
      </footer>

    </div>
  )
}
