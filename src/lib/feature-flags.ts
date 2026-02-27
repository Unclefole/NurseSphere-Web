// Feature flags for NurseSphere
// Set via environment variables. Default: false (safe off)
//
// Safe-off flags (default false, must explicitly enable):
//   FEATURE_COMPLIANCE_AUTO_SWEEP
//   FEATURE_SHIFT_PREDICTOR_AUTO_NOTIFY
//   FEATURE_SHIFT_RATE_AUTO_ADJUST  ← NEVER auto-enable; requires explicit opt-in
//
// Safe-on flags (default true, must explicitly disable by setting to "false"):
//   FEATURE_FRAUD_DETECTION
//   FEATURE_CREDENTIAL_AUTO_RENEWAL

export const featureFlags = {
  // Compliance Guardian
  COMPLIANCE_AUTO_SWEEP: process.env.FEATURE_COMPLIANCE_AUTO_SWEEP === 'true',
  // Shift Predictor
  SHIFT_PREDICTOR_AUTO_NOTIFY: process.env.FEATURE_SHIFT_PREDICTOR_AUTO_NOTIFY === 'true',
  // Rate automation — NEVER auto-enable, requires explicit flag
  SHIFT_RATE_AUTO_ADJUST: process.env.FEATURE_SHIFT_RATE_AUTO_ADJUST === 'true',
  // Fraud detection
  FRAUD_DETECTION_ENABLED: process.env.FEATURE_FRAUD_DETECTION !== 'false', // default ON
  // Credential renewal auto-task creation
  CREDENTIAL_AUTO_RENEWAL_TASKS: process.env.FEATURE_CREDENTIAL_AUTO_RENEWAL !== 'false', // default ON
  // Continuous Compliance Engine (TIER 1) — safe-off defaults
  continuous_compliance: process.env.FEATURE_CONTINUOUS_COMPLIANCE === 'true',
  auto_suspension: process.env.FEATURE_AUTO_SUSPENSION === 'true',
  // ── TIER 2: Zero Trust + Blast Radius Minimization ─────────────────────────
  // zero_trust_mode: safe-off (default false) — must explicitly enable
  zero_trust_mode: process.env.FEATURE_ZERO_TRUST_MODE === 'true',
  // phi_guard_enabled: default ON — MUST always be on in production
  phi_guard_enabled: process.env.FEATURE_PHI_GUARD !== 'false',
  // credential_hashing: default ON — SHA-256 hash computed at credential upload
  credential_hashing: process.env.FEATURE_CREDENTIAL_HASHING !== 'false',
  // ── TIER 3: Acuity + Litigation Defense Engine ─────────────────────────────
  // Safe-off: competency guardrails block high/critical shifts for under-qualified nurses
  // Enable per facility when ready
  competency_guardrails: process.env.FEATURE_COMPETENCY_GUARDRAILS === 'true',
  // Safe-on: collects acuity classification data on shifts — no blocking
  acuity_classification: process.env.FEATURE_ACUITY_CLASSIFICATION !== 'false',
  // Safe-on: generate immutable risk certificates on every shift acceptance
  risk_certificates: process.env.FEATURE_RISK_CERTIFICATES !== 'false',
  // Safe-on: litigation defense export available to hospital_admin + super_admin
  litigation_defense_export: process.env.FEATURE_LITIGATION_DEFENSE_EXPORT !== 'false',
} as const;

export type FeatureFlag = keyof typeof featureFlags;
