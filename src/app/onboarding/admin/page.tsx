'use client'
import { Logo } from '@/components/Logo'

/**
 * Admin (Facility) Onboarding Wizard — 4-step guided setup.
 * Step 1: Facility details (required)
 * Step 2: Cost baselines
 * Step 3: Payment method
 * Step 4: Post first shift
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

// ─── Types ────────────────────────────────────────────────────────────────────

type StepId = 'facility' | 'baselines' | 'payment' | 'shift'

interface StepMeta {
  id: StepId
  label: string
  index: number
  required: boolean
}

const STEPS: StepMeta[] = [
  { id: 'facility',  label: 'Facility',   index: 0, required: true },
  { id: 'baselines', label: 'Baselines',  index: 1, required: false },
  { id: 'payment',   label: 'Payment',    index: 2, required: false },
  { id: 'shift',     label: 'First Shift', index: 3, required: false },
]

const FACILITY_TYPES = [
  { value: 'hospital',  label: 'Hospital' },
  { value: 'clinic',    label: 'Clinic / Outpatient' },
  { value: 'ltc',       label: 'Long-Term Care (LTC)' },
  { value: 'snf',       label: 'Skilled Nursing Facility' },
  { value: 'home',      label: 'Home Health' },
  { value: 'other',     label: 'Other' },
]

const UNIT_TYPE_OPTIONS = [
  'ICU', 'CCU', 'Emergency', 'Med-Surg', 'Pediatrics', 'Oncology',
  'Labor & Delivery', 'Telemetry', 'PACU', 'Operating Room', 'Geriatrics',
  'Psychiatric', 'Step-Down', 'NICU', 'Burn Unit',
]

const NURSE_ROLES = ['RN', 'LPN', 'CNA', 'NP', 'CRNA', 'PA']

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAudit(
  actorId: string,
  action: string,
  targetType: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await fetch('/api/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id: actorId, action, target_type: targetType, metadata }),
    })
  } catch {
    console.warn('[AdminOnboarding] Audit log failed')
  }
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ currentIndex }: { currentIndex: number }) {
  const percent = Math.round(((currentIndex + 1) / STEPS.length) * 100)
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {STEPS.map((step) => (
          <div key={step.id} className="flex flex-col items-center flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all ${
                step.index < currentIndex
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : step.index === currentIndex
                  ? 'bg-white border-teal-600 text-teal-600'
                  : 'bg-white border-gray-300 text-gray-400'
              }`}
            >
              {step.index < currentIndex ? '✓' : step.index + 1}
            </div>
            <span
              className={`text-xs mt-1 hidden sm:block ${
                step.index === currentIndex ? 'text-teal-700 font-semibold' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-2 bg-teal-600 rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 text-right mt-1">{percent}% complete</p>
    </div>
  )
}

// ─── Step 1: Facility Details ─────────────────────────────────────────────────

interface FacilityFormData {
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  phone: string
  type: string
  bed_count: string
  unit_types: string[]
}

function FacilityStep({
  userId,
  facilityId,
  onNext,
}: {
  userId: string
  facilityId: string | null
  onNext: (newFacilityId: string) => void
}) {
  const [form, setForm] = useState<FacilityFormData>({
    name: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    phone: '',
    type: '',
    bed_count: '',
    unit_types: [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserSupabaseClient()

  // Pre-fill if facility already exists
  useEffect(() => {
    if (!facilityId) return
    async function load() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('facilities')
        .select('name, address, city, state, zip_code, phone, type, bed_count, unit_types')
        .eq('id', facilityId!)
        .single()
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any
        setForm({
          name: d.name ?? '',
          address: d.address ?? '',
          city: d.city ?? '',
          state: d.state ?? '',
          zip_code: d.zip_code ?? '',
          phone: d.phone ?? '',
          type: d.type ?? '',
          bed_count: String(d.bed_count ?? ''),
          unit_types: Array.isArray(d.unit_types) ? d.unit_types : [],
        })
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId])

  function toggleUnit(unit: string) {
    setForm((f) => ({
      ...f,
      unit_types: f.unit_types.includes(unit)
        ? f.unit_types.filter((u) => u !== unit)
        : [...f.unit_types, unit],
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError('Facility name is required.')
      return
    }
    if (!form.address.trim()) {
      setError('Address is required.')
      return
    }
    if (!form.type) {
      setError('Please select a facility type.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      zip_code: form.zip_code.trim() || null,
      phone: form.phone.trim() || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: form.type as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bed_count: form.bed_count ? parseInt(form.bed_count) : null as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unit_types: form.unit_types as any,
      updated_at: new Date().toISOString(),
    }

    let savedId = facilityId

    // Cast to any: payload contains extended columns (type, bed_count, unit_types)
    // not yet reflected in the generated Database TypeScript types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    if (facilityId) {
      const { error: updateError } = await sb
        .from('facilities')
        .update(payload)
        .eq('id', facilityId)
      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
    } else {
      const { data: insertData, error: insertError } = await sb
        .from('facilities')
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select('id')
        .single()
      if (insertError || !insertData) {
        setError(insertError?.message ?? 'Failed to create facility')
        setSaving(false)
        return
      }
      savedId = insertData.id
      // Link the facility to the admin's profile (facility_id not in TS schema yet)
      await sb
        .from('profiles')
        .update({ facility_id: savedId })
        .eq('id', userId)
    }

    await logAudit(userId, 'onboarding.facility.saved', 'facility', {
      facility_id: savedId,
      step: 1,
    })
    setSaving(false)
    onNext(savedId!)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Set up your facility</h2>
      <p className="text-gray-500 mb-6">
        This information appears to nurses when they view your shifts.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Facility name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Memorial General Hospital"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Address <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="123 Medical Center Blvd"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="San Francisco"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input
              type="text"
              maxLength={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
              placeholder="CA"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP code</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.zip_code}
              onChange={(e) => setForm((f) => ({ ...f, zip_code: e.target.value }))}
              placeholder="94102"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Facility type <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="">Select type…</option>
              {FACILITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bed count</label>
            <input
              type="number"
              min="1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.bed_count}
              onChange={(e) => setForm((f) => ({ ...f, bed_count: e.target.value }))}
              placeholder="250"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Unit types offered</label>
          <div className="flex flex-wrap gap-2">
            {UNIT_TYPE_OPTIONS.map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => toggleUnit(unit)}
                className={`px-3 py-1 rounded-full text-xs border transition ${
                  form.unit_types.includes(unit)
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'
                }`}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: Cost Baselines ───────────────────────────────────────────────────

function BaselinesStep({
  userId,
  facilityId,
  onNext,
  onSkip,
}: {
  userId: string
  facilityId: string
  onNext: () => void
  onSkip: () => void
}) {
  const [agencyRate, setAgencyRate] = useState('')
  const [mspFee, setMspFee] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserSupabaseClient()

  // Pre-fill
  useEffect(() => {
    async function load() {
      // cost_baselines not in TS schema yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('cost_baselines')
        .select('agency_avg_rate, msp_fee_pct')
        .eq('facility_id', facilityId)
        .single()
      if (data) {
        setAgencyRate(String(data.agency_avg_rate ?? ''))
        setMspFee(String(data.msp_fee_pct ?? ''))
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId])

  async function handleSave() {
    const rate = parseFloat(agencyRate)
    if (!agencyRate || isNaN(rate) || rate <= 0) {
      setError('Please enter a valid agency average rate (e.g. 75).')
      return
    }
    setSaving(true)
    setError(null)

    // cost_baselines not in TS schema yet — cast to any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (supabase as any)
      .from('cost_baselines')
      .upsert(
        {
          facility_id: facilityId,
          agency_avg_rate: rate,
          msp_fee_pct: mspFee ? parseFloat(mspFee) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'facility_id' },
      )

    if (upsertError) {
      setError(upsertError.message)
      setSaving(false)
      return
    }
    await logAudit(userId, 'onboarding.baselines.saved', 'cost_baselines', {
      facility_id: facilityId,
      agency_avg_rate: rate,
      step: 2,
    })
    setSaving(false)
    onNext()
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Set cost baselines</h2>
      <p className="text-gray-500 mb-6">
        These benchmarks help NurseSphere show you real savings versus your current agency spend.
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-800">
        <strong>Why this matters:</strong> By entering your current agency average rate, NurseSphere
        can calculate how much you save on every shift. You can update these any time in Settings.
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Agency average rate ($/hr) <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="10"
              max="999"
              step="0.01"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={agencyRate}
              onChange={(e) => setAgencyRate(e.target.value)}
              placeholder="85.00"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Average all-in hourly rate you currently pay to staffing agencies
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            MSP fee percentage (%)
          </label>
          <div className="relative">
            <input
              type="number"
              min="0"
              max="50"
              step="0.1"
              className="w-full border border-gray-300 rounded-lg px-3 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={mspFee}
              onChange={(e) => setMspFee(e.target.value)}
              placeholder="5.0"
            />
            <span className="absolute right-3 top-2 text-gray-400 text-sm">%</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            MSP (Managed Service Provider) administrative fee if applicable
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Payment Method ───────────────────────────────────────────────────

function PaymentStep({
  onNext,
  onSkip,
}: {
  userId: string
  facilityId: string
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Add a payment method</h2>
      <p className="text-gray-500 mb-6">
        Connect a payment method so you can pay nurses directly through NurseSphere.
      </p>

      <div className="bg-teal-50 border border-teal-200 rounded-xl p-6 text-center mb-6">
        <div className="text-4xl mb-3">💳</div>
        <h3 className="font-semibold text-gray-900 mb-1">Secure billing via Stripe</h3>
        <p className="text-sm text-gray-600">
          Invoices are generated automatically after shifts complete. You control when to pay.
        </p>
      </div>

      <div className="space-y-3 mb-8 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <span className="text-green-500">✓</span> ACH bank transfer or credit card
        </div>
        <div className="flex items-center gap-2">
          <span className="text-green-500">✓</span> Automatic monthly statements
        </div>
        <div className="flex items-center gap-2">
          <span className="text-green-500">✓</span> Dispute protection on every payment
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          Skip for now
        </button>
        <a
          href="/dashboard/billing"
          className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold text-sm hover:bg-teal-700 transition inline-block"
          onClick={onNext}
        >
          Go to Billing Setup
        </a>
      </div>
    </div>
  )
}

// ─── Step 4: Post First Shift ─────────────────────────────────────────────────

interface ShiftFormData {
  unit: string
  role: string
  shift_date: string
  start_time: string
  hours: string
  hourly_rate: string
}

function FirstShiftStep({
  userId,
  facilityId,
  onDone,
  onSkip,
}: {
  userId: string
  facilityId: string
  onDone: () => void
  onSkip: () => void
}) {
  const today = new Date()
  today.setDate(today.getDate() + 1)
  const defaultDate = today.toISOString().split('T')[0]

  const [form, setForm] = useState<ShiftFormData>({
    unit: '',
    role: 'RN',
    shift_date: defaultDate,
    start_time: '07:00',
    hours: '12',
    hourly_rate: '65',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const supabase = createBrowserSupabaseClient()

  async function handleSave() {
    if (!form.unit.trim()) {
      setError('Please enter a unit name.')
      return
    }
    setSaving(true)
    setError(null)

    const startDt = new Date(`${form.shift_date}T${form.start_time}:00`)
    const endDt = new Date(startDt.getTime() + parseFloat(form.hours) * 3600 * 1000)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any).from('shifts').insert({
      facility_id: facilityId,
      title: `${form.role} — ${form.unit.trim()}`,
      description: `${form.hours}h shift on ${form.shift_date}`,
      department: form.unit.trim(),
      specialty_required: form.role,
      start_time: startDt.toISOString(),
      end_time: endDt.toISOString(),
      hourly_rate: parseFloat(form.hourly_rate),
      status: 'open' as const,
    })

    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }
    await logAudit(userId, 'onboarding.shift.posted', 'shift', {
      facility_id: facilityId,
      unit: form.unit,
      step: 4,
    })
    setSuccess(true)
    setSaving(false)
    setTimeout(onDone, 1000)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Post your first shift</h2>
      <p className="text-gray-500 mb-6">
        Let qualified nurses in your area know you&apos;re hiring. You can edit details anytime.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          ✓ Shift posted! Taking you to the dashboard…
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Unit <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              placeholder="ICU"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {NURSE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.shift_date}
              onChange={(e) => setForm((f) => ({ ...f, shift_date: e.target.value }))}
              min={defaultDate}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
            <input
              type="time"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (hours)</label>
            <input
              type="number"
              min="4"
              max="24"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={form.hours}
              onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate ($/hr)</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                min="10"
                step="0.5"
                className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={form.hourly_rate}
                onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
          <strong>Estimated total: </strong>
          ${(parseFloat(form.hourly_rate || '0') * parseFloat(form.hours || '0')).toFixed(2)} for this shift
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving || success}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {saving ? 'Posting…' : 'Post Shift & Finish'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function AdminOnboardingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [facilityId, setFacilityId] = useState<string | null>(null)

  const currentStep = STEPS[currentIndex]

  const goNext = useCallback(() => {
    if (currentIndex < STEPS.length - 1) {
      setCurrentIndex((i) => i + 1)
    } else {
      router.push('/dashboard')
    }
  }, [currentIndex, router])

  const goSkip = useCallback(() => {
    if (currentIndex < STEPS.length - 1) {
      setCurrentIndex((i) => i + 1)
    } else {
      router.push('/dashboard')
    }
  }, [currentIndex, router])

  // Pre-populate facilityId from user profile
  useEffect(() => {
    if (user?.facilityId) setFacilityId(user.facilityId)
  }, [user])

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
  }, [user, loading, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <Logo height={40} variant="light" className="mx-auto" />
          <p className="text-gray-500 text-sm">Set up your facility to start posting shifts</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <ProgressBar currentIndex={currentIndex} />

          {currentStep.id === 'facility' && (
            <FacilityStep
              userId={user.id}
              facilityId={facilityId}
              onNext={(id) => {
                setFacilityId(id)
                goNext()
              }}
            />
          )}

          {currentStep.id === 'baselines' && facilityId && (
            <BaselinesStep
              userId={user.id}
              facilityId={facilityId}
              onNext={goNext}
              onSkip={goSkip}
            />
          )}

          {currentStep.id === 'payment' && facilityId && (
            <PaymentStep
              userId={user.id}
              facilityId={facilityId}
              onNext={goNext}
              onSkip={goSkip}
            />
          )}

          {currentStep.id === 'shift' && facilityId && (
            <FirstShiftStep
              userId={user.id}
              facilityId={facilityId}
              onDone={() => router.push('/dashboard')}
              onSkip={() => router.push('/dashboard')}
            />
          )}

          {/* Safety: if facilityId not yet set and we're past step 0 */}
          {currentIndex > 0 && !facilityId && (
            <div className="text-center text-gray-500 py-8">
              <p>Please complete the facility step first.</p>
              <button
                onClick={() => setCurrentIndex(0)}
                className="mt-3 text-teal-600 underline text-sm"
              >
                Go back
              </button>
            </div>
          )}
        </div>

        <div className="text-center mt-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Exit setup and go to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
