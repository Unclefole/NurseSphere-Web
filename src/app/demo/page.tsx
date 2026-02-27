'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import {
  Shield, CheckCircle, Lock, FileText, Users, Activity,
  ChevronRight, ArrowRight, AlertTriangle, Check
} from 'lucide-react'

const ACCESS_CODE = 'NS2026'

const STEPS = [
  {
    id: 'compliance',
    icon: Shield,
    title: 'Automated Compliance Engine',
    badge: 'TIER 1',
    headline: 'Daily OIG, NURSYS & SAM sweeps — fully automated',
    description:
      'NurseSphere runs automated exclusion checks against federal and state databases every 24 hours. Any nurse flagged as excluded is automatically suspended from shifts before they clock in. No manual checks. No compliance gaps.',
    bullets: [
      'OIG LEIE exclusion list — daily sweep',
      'NURSYS license verification — real-time',
      'SAM.gov debarment check — daily sweep',
      'Auto-suspension state machine with admin override log',
      'CSV export for Joint Commission audits',
    ],
    stat: { value: '100%', label: 'Automated credential monitoring' },
    color: 'teal',
  },
  {
    id: 'security',
    icon: Lock,
    title: 'Zero-Trust Security',
    badge: 'TIER 2',
    headline: 'PHI never leaves the wire unprotected',
    description:
      'All API responses pass through a PHI guard middleware that strips 11 sensitive fields before they reach the client. Every credential is SHA-256 hashed with tamper detection. Multi-tenant isolation enforced at the database row level.',
    bullets: [
      'PHI guard middleware — 11 fields blocked at wire',
      'SHA-256 credential hashing + tamper detection',
      'Row-level security — facilities cannot see each other\'s data',
      'Immutable audit log — every action recorded by UUID + timestamp',
      'Session expiration + MFA enforcement',
    ],
    stat: { value: 'SOC2', label: 'Ready architecture (BAA available)' },
    color: 'blue',
  },
  {
    id: 'litigation',
    icon: FileText,
    title: 'Litigation Defense',
    badge: 'TIER 3',
    headline: 'Every shift assignment generates a signed risk certificate',
    description:
      'NurseSphere scores each nurse\'s competency (hours, recency, verified credentials) and classifies shift acuity. High and critical shifts require competency guardrails. Each assignment produces an immutable SHA-256 signed certificate — your legal proof of due diligence.',
    bullets: [
      'Competency score: hours × recency × verification',
      'Acuity classification: low / moderate / high / critical',
      'Guardrail: high/critical shifts blocked without verified competency',
      'SHA-256 signed shift risk certificates — immutable',
      'One-click litigation export from /dashboard/risk-reports',
    ],
    stat: { value: '100%', label: 'Shift assignments documented & signed' },
    color: 'amber',
  },
  {
    id: 'staffing',
    icon: Users,
    title: 'Shift Marketplace & Staffing',
    badge: 'PLATFORM',
    headline: 'Post a shift. Qualified nurses apply. You approve.',
    description:
      'Facilities post shifts with acuity requirements. Nurses with matching competency scores receive notifications. Cross-facility marketplace lets nurses pick up shifts across your entire health system. Full timecard, clock-in/out, and approval-to-payout workflow.',
    bullets: [
      'Shift posting with acuity and credential requirements',
      'Cross-facility marketplace for health systems',
      'Mobile clock-in/out with live timer',
      'Admin timecard approval → automatic Stripe payout',
      'Real-time fill rate and cost analytics dashboard',
    ],
    stat: { value: '6%', label: 'Platform fee — no hidden costs' },
    color: 'teal',
  },
]

const colorMap: Record<string, string> = {
  teal: 'text-teal-400 border-teal-500/30 bg-teal-500/10',
  blue: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  amber: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
}

const badgeMap: Record<string, string> = {
  teal: 'bg-teal-500/20 text-teal-300',
  blue: 'bg-blue-500/20 text-blue-300',
  amber: 'bg-amber-500/20 text-amber-300',
}

export default function DemoPage() {
  const [code, setCode] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState(false)
  const [activeStep, setActiveStep] = useState(0)

  function handleUnlock() {
    if (code.toUpperCase().trim() === ACCESS_CODE) {
      setUnlocked(true)
      setError(false)
    } else {
      setError(true)
    }
  }

  const step = STEPS[activeStep]
  const Icon = step.icon

  return (
    <div className="min-h-screen bg-nurse-dark text-slate-200 font-sans">
      {/* Nav */}
      <header className="sticky top-0 z-50 w-full px-6 py-4 bg-nurse-dark/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <Link href="/"><Logo height={32} variant="dark" /></Link>
          <Link
            href="/auth/register"
            className="text-sm font-semibold px-4 py-2 bg-nurse-teal text-nurse-dark rounded-lg hover:bg-teal-400 transition-colors"
          >
            Register Your Hospital
          </Link>
        </div>
      </header>

      {!unlocked ? (
        /* ── ACCESS GATE ── */
        <div className="flex items-center justify-center min-h-[80vh] px-6">
          <div className="w-full max-w-md text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 mb-6">
              <Shield className="w-7 h-7 text-nurse-teal" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-white mb-2">Enterprise Demo</h1>
            <p className="text-slate-400 mb-8">Enter your demo access code to continue.</p>
            <div className="space-y-3">
              <input
                type="text"
                value={code}
                onChange={e => { setCode(e.target.value); setError(false) }}
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                placeholder="Access code"
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border text-white placeholder-slate-500 text-center tracking-widest uppercase text-lg focus:outline-none focus:border-nurse-teal transition-colors ${error ? 'border-red-500/50' : 'border-white/10'}`}
              />
              {error && (
                <p className="text-red-400 text-sm flex items-center justify-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> Invalid access code
                </p>
              )}
              <button
                onClick={handleUnlock}
                className="w-full px-6 py-3 bg-nurse-teal hover:bg-teal-400 text-nurse-dark font-bold rounded-lg transition-all"
              >
                Enter Demo
              </button>
            </div>
            <p className="mt-6 text-xs text-slate-500">
              No code?{' '}
              <a href="mailto:francis@nursesphere.io?subject=Demo%20Access%20Request" className="text-nurse-teal hover:underline">
                Request access →
              </a>
            </p>
          </div>
        </div>
      ) : (
        /* ── DEMO CONTENT ── */
        <main className="max-w-5xl mx-auto px-6 py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <span className="inline-block px-3 py-1 text-xs font-mono text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-full mb-4">
              ENTERPRISE DEMO — CONFIDENTIAL
            </span>
            <h1 className="text-4xl font-serif font-bold text-white mb-3">
              NurseSphere Platform Overview
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto">
              A unified HIPAA-compliant infrastructure for clinical staffing, compliance automation, and litigation defense.
            </p>
          </div>

          {/* Step nav */}
          <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
            {STEPS.map((s, i) => {
              const SIcon = s.icon
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveStep(i)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all border ${
                    activeStep === i
                      ? 'bg-nurse-teal text-nurse-dark border-transparent'
                      : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <SIcon className="w-4 h-4" />
                  {s.title.split(' ')[0]} {s.title.split(' ')[1]}
                </button>
              )
            })}
          </div>

          {/* Active step card */}
          <div
            key={step.id}
            className="rounded-2xl border border-white/10 p-8"
            style={{ background: 'rgba(15, 39, 46, 0.6)', backdropFilter: 'blur(8px)' }}
          >
            <div className="flex items-start gap-6">
              {/* Icon */}
              <div className={`flex-shrink-0 p-4 rounded-2xl border ${colorMap[step.color]}`}>
                <Icon className="w-8 h-8" />
              </div>

              <div className="flex-1 min-w-0">
                {/* Badge + title */}
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${badgeMap[step.color]}`}>
                    {step.badge}
                  </span>
                  <h2 className="text-2xl font-bold text-white">{step.title}</h2>
                </div>

                <p className="text-nurse-teal font-semibold mb-3">{step.headline}</p>
                <p className="text-slate-400 leading-relaxed mb-6">{step.description}</p>

                {/* Bullets */}
                <ul className="space-y-2 mb-8">
                  {step.bullets.map(b => (
                    <li key={b} className="flex items-start gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-nurse-teal flex-shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>

                {/* Stat */}
                <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-3xl font-bold text-nurse-teal">{step.stat.value}</div>
                  <div className="text-sm text-slate-400">{step.stat.label}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Step progress + navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={() => setActiveStep(s => Math.max(0, s - 1))}
              disabled={activeStep === 0}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              ← Previous
            </button>
            <div className="flex gap-2">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveStep(i)}
                  className={`w-2 h-2 rounded-full transition-all ${i === activeStep ? 'bg-nurse-teal w-6' : 'bg-white/20'}`}
                />
              ))}
            </div>
            {activeStep < STEPS.length - 1 ? (
              <button
                onClick={() => setActiveStep(s => s + 1)}
                className="flex items-center gap-1 px-4 py-2 text-sm text-nurse-teal hover:text-teal-400 transition-colors"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <span className="text-xs text-slate-500">End of demo</span>
            )}
          </div>

          {/* Trust bar */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3">
            {['HIPAA Compliant', 'SOC2 Ready', 'BAA Available', '256-bit Encryption'].map(label => (
              <div key={label} className="flex items-center gap-2 p-3 rounded-lg border border-white/10 bg-white/5">
                <CheckCircle className="w-4 h-4 text-nurse-teal flex-shrink-0" />
                <span className="text-xs font-medium text-slate-300">{label}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div
            className="mt-8 rounded-2xl p-8 text-center border border-nurse-teal/20"
            style={{ background: 'rgba(20, 184, 166, 0.05)' }}
          >
            <h3 className="text-2xl font-serif font-bold text-white mb-2">Ready to move forward?</h3>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              Register your facility today or request a BAA to begin your compliance review.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/auth/register"
                className="flex items-center justify-center gap-2 px-8 py-4 bg-nurse-teal hover:bg-teal-400 text-nurse-dark font-bold rounded-lg transition-all"
              >
                Register Your Hospital <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="mailto:francis@nursesphere.io?subject=BAA%20Request%20%E2%80%94%20NurseSphere%20Demo&body=Hi%2C%20I%20completed%20the%20NurseSphere%20demo%20and%20would%20like%20to%20request%20a%20BAA%20and%20full%20walkthrough."
                className="flex items-center justify-center gap-2 px-8 py-4 border border-white/20 hover:border-nurse-teal text-white font-semibold rounded-lg transition-all"
              >
                <FileText className="w-4 h-4" /> Request BAA
              </a>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Questions? <a href="mailto:francis@nursesphere.io" className="text-nurse-teal hover:underline">francis@nursesphere.io</a>
            </p>
          </div>

          {/* Activity indicator */}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-600">
            <Activity className="w-3 h-3" />
            Demo session active — all data is illustrative
          </div>
        </main>
      )}
    </div>
  )
}
