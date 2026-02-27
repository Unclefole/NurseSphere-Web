# NurseSphere Web Platform

> **Healthcare Workforce Infrastructure Platform** — connecting facilities with qualified nurses, managing compliance, billing, and workforce intelligence at scale.

---

## Overview

NurseSphere is a full-stack B2B healthcare workforce platform. Facilities post shifts, nurses apply and are matched, and the platform handles the complete lifecycle: credentialing, billing, compliance tracking, fraud prevention, and cost analytics. The platform is built with HIPAA posture in mind, with row-level security enforced at the database layer for every tenant.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19 + Tailwind CSS |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| Payments | Stripe (Connect, Invoices, Webhooks) |
| Monitoring | Sentry (error tracking + performance) |
| Validation | Zod |
| Deployment | Vercel |

---

## Environment Variables

Copy `.env.local.example` to `.env.local` and populate with your values. **Never commit actual secrets.**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Sentry
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=

# Feature Flags (see Feature Flags section below)
FEATURE_COMPLIANCE_AUTO_SWEEP=
FEATURE_SHIFT_PREDICTOR_AUTO_NOTIFY=
FEATURE_SHIFT_RATE_AUTO_ADJUST=
FEATURE_FRAUD_DETECTION=
FEATURE_CREDENTIAL_AUTO_RENEWAL=
```

---

## Development Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd nursesphere-web

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your Supabase + Stripe + Sentry credentials

# 4. Apply database migrations (in order — see Migrations section)
# Via Supabase Dashboard → SQL Editor, paste each file in order
# Or via supabase CLI:
supabase db push

# 5. Start the dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## Database Migrations

Migrations live in `/Users/combinedsun/.openclaw/workspace/migrations/`. Apply them **in order, do not skip**.

| # | Filename | Date | Description |
|---|---|---|---|
| 001 | `001_facility_admins.sql` | 2026-02-19 | Creates `facility_admins` junction table for multi-tenant facility-admin association. Includes composite unique constraint. |
| 002 | `002_facility_rls_policies.sql` | 2026-02-19 | Full RLS policy suite for all core tables (`profiles`, `facilities`, `shifts`, `contracts`, `credentials`, `files`, `messages`, `audit_logs`). Facility-scoped isolation via `facility_admins`. Includes `SECURITY DEFINER` helper functions. |
| 003 | `003_verification_checklist.sql` | 2026-02-19 | Verification test suite for cross-facility isolation. Run after 001+002 to confirm tenant isolation is working. Contains test data setup + assertion queries. |
| 004 | *(Phase 4 — Stripe schema)* | 2026-02-20 | Stripe Connect metadata, payout tracking columns on `facilities` and `profiles`. Part of Phase 1 billing implementation. |
| 005 | *(Phase 5 — Sentry + audit)* | 2026-02-21 | Audit log schema enhancements, `audit_logs` index additions for performance. Part of Phase 2+3 audit viewer. |
| 006 | *(Phase 6 — Credential expiration)* | 2026-02-22 | Credential expiration tracking columns: `expires_at`, `expiration_notified_at`, `expiration_status` on `credentials` table. Part of Phase 2+3 automation. |
| 007 | `007_new_table_rls.sql` | 2026-02-24 | Phase 7 RLS coverage audit. Confirms no net-new tables outside existing RLS scope. Provides template for future table additions. |
| 008 | `008_compliance_guardian.sql` | 2026-02-24 | Module 1 — Compliance Guardian. Creates `compliance_scores` and `compliance_alerts` tables with full RLS. Adds indexes and `SECURITY DEFINER` score helper. |
| 009 | `009_shift_predictor.sql` | 2026-02-24 | Module 2 — Shift Fill Predictor. Creates `shift_candidates` table with heuristic scoring columns, risk level, escalation status. |
| 010 | `010_cost_dashboard.sql` | 2026-02-24 | Module 3 — Labor Cost Dashboard. Creates `cost_baselines` table (agency avg rate, overtime avg, MSP fee %), `cost_savings_events`, `cost_kpi_snapshots`. |
| 011 | `011_fraud_shield.sql` | 2026-02-24 | Module 4 — Fraud + Identity Shield. Creates `suspicious_events` table with event types: `duplicate_account`, `ip_anomaly`, `rapid_cancellations`, `payment_anomaly`, `credential_mismatch`, `login_burst`. |
| 012 | `012_credential_renewal.sql` | 2026-02-24 | Module 5 — Credential Expiration Auto-Recovery. Creates `renewal_tasks` table with multi-step workflow statuses: `pending → in_progress → submitted → under_review → verified / expired_without_renewal`. |

---

## Feature Modules

### Module 1 — Compliance Guardian

**What it does:**
Continuously monitors nurse credential compliance across facilities. Calculates per-nurse and per-facility compliance scores (0–100), generates alerts for expiring or expired credentials, and runs a nightly sweep to update all scores.

**Tables:** `compliance_scores`, `compliance_alerts`

**How to trigger a sweep:**
- **Manual:** `POST /api/compliance/sweep` (admin-authenticated)
- **Automated (cron):** Set up a Vercel Cron job hitting `/api/compliance/sweep` nightly (see Deployment section)
- **Feature flag:** `FEATURE_COMPLIANCE_AUTO_SWEEP=true` enables automatic sweep on cron invocation

**Endpoints:**
- `GET /api/compliance/scores` — fetch compliance scores for facility
- `GET /api/compliance/alerts` — list active alerts
- `POST /api/compliance/sweep` — run nightly compliance sweep

---

### Module 2 — Shift Fill Predictor

**What it does:**
Scores how likely a given shift is to be filled based on heuristic signals: nurse proximity, historical fill rate, urgency, specialty match, and shift desirability. Flags high-risk unfilled shifts for escalation.

**Scoring factors:**
- Nurse distance from facility
- Past acceptance rate for similar shifts
- Time-to-shift-start (urgency)
- Specialty/license match strength
- Shift hour desirability (days > nights)

**Tables:** `shift_candidates`

**Cron setup needed:** A cron job should call the risk endpoint periodically to refresh scores for upcoming shifts:
```
GET /api/shifts/[id]/risk
POST /api/shifts/[id]/notify-candidates
```

**Feature flag:** `FEATURE_SHIFT_PREDICTOR_AUTO_NOTIFY=true` enables automatic candidate notification when risk level crosses threshold.

> ⚠️ `FEATURE_SHIFT_RATE_AUTO_ADJUST` — rate automation. **Never auto-enable.** Requires explicit opt-in flag. Default: `false`.

---

### Module 3 — Labor Cost Dashboard

**What it does:**
Tracks labor cost savings versus agency/overtime baselines. Facility admins configure baseline rates; the system calculates savings per filled shift and aggregates KPIs by period.

**Tables:** `cost_baselines`, `cost_savings_events`, `cost_kpi_snapshots`

**Baseline configuration:**
Configure via `POST /api/finance/baselines` with:
- `agency_avg_rate` — average agency bill rate ($/hr)
- `overtime_avg` — internal overtime cost ($/hr)
- `msp_fee_pct` — MSP fee percentage (e.g., `0.06` for 6%)

**KPI periods:** Daily, weekly, monthly snapshots. Retrieve via `GET /api/finance/kpis?period=monthly`.

**Dashboard route:** `/dashboard/finance`

---

### Module 4 — Fraud + Identity Shield

**What it does:**
Detects fraud and identity anomalies across nurse accounts and activity. Flags suspicious events for admin review.

**Detectors:**
| Type | Description |
|---|---|
| `duplicate_account` | Detects multiple accounts sharing PII (SSN fragment, phone, bank) |
| `ip_anomaly` | Logins from anomalous geolocations or rapid IP switching |
| `rapid_cancellations` | Nurse cancels multiple accepted shifts in a short window |
| `payment_anomaly` | Unusual payout patterns or mismatched bank details |
| `credential_mismatch` | Credential document doesn't match profile data |
| `login_burst` | Excessive login attempts, potential credential stuffing |

**Tables:** `suspicious_events`

**How to resolve events:**
1. Admin navigates to `/dashboard/security/fraud`
2. Reviews event details (type, severity, nurse/facility, metadata)
3. Marks event `resolved` or `escalated` via `PATCH /api/fraud/events/[id]`
4. System logs resolution action to `audit_logs`

**Endpoints:**
- `POST /api/fraud/check` — run fraud check on a subject
- `GET /api/fraud/events` — list suspicious events for facility

---

### Module 5 — Credential Expiration Auto-Recovery

**What it does:**
When a nurse credential is approaching expiration (or expired), the system automatically creates a `renewal_task` and walks the nurse through a structured renewal workflow.

**Workflow steps:**
1. **`pending`** — Task created automatically when credential nears expiration
2. **`in_progress`** — Nurse begins renewal (uploads new document)
3. **`submitted`** — Nurse submits renewal for admin review
4. **`under_review`** — Admin is reviewing the new credential document
5. **`verified`** — Admin approves; credential updated with new expiry
6. **`expired_without_renewal`** — Terminal: nurse did not renew in time

**Admin verification process:**
1. Admin sees renewal queue at `/dashboard/credentials/renewals`
2. Reviews uploaded document against credential type requirements
3. Calls `POST /api/credentials/renewal/[id]/verify` with approval or rejection + notes
4. On approval: credential `expires_at` is updated; compliance score refreshes

**Auto-task creation:** Controlled by `FEATURE_CREDENTIAL_AUTO_RENEWAL` flag (default: ON).

**Tables:** `renewal_tasks`

---

## Dashboard Routes

| Route | Description |
|---|---|
| `/dashboard` | Main dashboard overview — facility summary, key metrics |
| `/dashboard/billing` | Stripe billing — payment methods, invoice management |
| `/dashboard/invoices` | Invoice list — past and pending invoices, pay action |
| `/dashboard/compliance` | Compliance overview — facility-wide compliance score, nurse list |
| `/dashboard/compliance/nurse/[id]` | Individual nurse compliance detail — credentials, scores, alerts |
| `/dashboard/credentials` | Credential management — list, upload, expiry status |
| `/dashboard/credentials/renewals` | Renewal task queue — admin review of in-progress renewals |
| `/dashboard/finance` | Labor Cost Dashboard — savings KPIs, baseline config |
| `/dashboard/shifts/[id]/fill` | Shift Fill Predictor — candidate scoring, notify candidates |
| `/dashboard/security` | Security dashboard — audit summary, active alerts |
| `/dashboard/security/fraud` | Fraud Shield — suspicious events list and resolution |
| `/dashboard/audit-log` | Audit log viewer — filterable event log export |

---

## API Routes Overview

### Billing
| Route | Method | Description |
|---|---|---|
| `/api/billing/setup-intent` | POST | Create Stripe Setup Intent for payment method |
| `/api/billing/attach-payment-method` | POST | Attach confirmed payment method to customer |
| `/api/billing/invoices` | GET | List Stripe invoices for facility |
| `/api/billing/pay-invoice` | POST | Pay an open invoice |
| `/api/billing/payout` | POST | Trigger nurse payout (6% platform fee deducted) |
| `/api/webhooks/stripe` | POST | Stripe webhook receiver (invoice, payment events) |

### Compliance
| Route | Method | Description |
|---|---|---|
| `/api/compliance/scores` | GET | Compliance scores for facility |
| `/api/compliance/alerts` | GET | Active compliance alerts |
| `/api/compliance/sweep` | POST | Trigger nightly compliance sweep |

### Credentials
| Route | Method | Description |
|---|---|---|
| `/api/credentials` | GET/POST | List or create credentials |
| `/api/credentials/verify` | POST | Admin credential verification |
| `/api/credentials/check-expiration` | POST | Check and flag expiring credentials |
| `/api/credentials/renewal` | GET/POST | List or create renewal tasks |
| `/api/credentials/renewal/[id]/submit` | POST | Nurse submits renewal documents |
| `/api/credentials/renewal/[id]/verify` | POST | Admin approves or rejects renewal |

### Finance
| Route | Method | Description |
|---|---|---|
| `/api/finance/baselines` | GET/POST | Manage cost baselines |
| `/api/finance/kpis` | GET | Labor cost KPIs by period |

### Fraud
| Route | Method | Description |
|---|---|---|
| `/api/fraud/check` | POST | Run fraud checks on a subject |
| `/api/fraud/events` | GET | List suspicious events |

### Shifts
| Route | Method | Description |
|---|---|---|
| `/api/shifts/[id]/risk` | GET | Get fill risk score for shift |
| `/api/shifts/[id]/notify-candidates` | POST | Notify scored candidates about shift |

### Profiles & Audit
| Route | Method | Description |
|---|---|---|
| `/api/profiles/[id]` | GET/PATCH | Get or update user profile |
| `/api/audit/export` | GET | Export audit log (CSV/JSON) |

---

## Security Notes

### Row-Level Security (RLS)
Every table has RLS enabled and forced. Policies are scoped to `facility_id` via the `facility_admins` junction table. Users can only read/write data belonging to their facility. Service-role bypasses RLS for server-side operations only.

### Rate Limiting
All API routes include rate limiting middleware (Phase 7). Limits are enforced per IP and per authenticated user. Exceeding limits returns `429 Too Many Requests`.

### HIPAA Posture
- All PHI is stored in Supabase (PostgreSQL) with encryption at rest
- TLS enforced in transit
- Audit logs capture all data access and modification events
- `SECURITY DEFINER` functions used for privileged DB operations to prevent privilege escalation
- No PHI is sent to Sentry (scrubbed before capture)
- Stripe handles all payment card data (PCI DSS delegated)

### Role Guards
API routes enforce role checks (`admin`, `nurse`, `super_admin`) via middleware. Zod validation on all request bodies prevents injection.

### CSP
Content Security Policy headers are set via `next.config.js`. Inline scripts are disallowed.

---

## Feature Flags

Feature flags are controlled via environment variables. See `src/lib/feature-flags.ts`.

| Flag Env Var | Default | Description |
|---|---|---|
| `FEATURE_COMPLIANCE_AUTO_SWEEP` | `false` | Enable automatic nightly compliance sweep on cron invocation |
| `FEATURE_SHIFT_PREDICTOR_AUTO_NOTIFY` | `false` | Auto-notify candidates when shift risk crosses threshold |
| `FEATURE_SHIFT_RATE_AUTO_ADJUST` | `false` | ⚠️ Rate automation — NEVER auto-enable; requires explicit opt-in |
| `FEATURE_FRAUD_DETECTION` | `true` | Enable fraud detection subsystem (set to `false` to disable) |
| `FEATURE_CREDENTIAL_AUTO_RENEWAL` | `true` | Auto-create renewal tasks when credentials approach expiry (set to `false` to disable) |

> Flags defaulting `true` are opt-**out** (set env var to `"false"` to disable). Flags defaulting `false` are opt-**in**.

---

## Deployment

### Vercel

1. Connect the GitHub repo to Vercel
2. Set all environment variables in Vercel project settings (see Environment Variables section above)
3. Set `NEXT_PUBLIC_*` vars for both Preview and Production environments

### Cron Jobs (Vercel)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/compliance/sweep",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/credentials/check-expiration",
      "schedule": "0 3 * * *"
    }
  ]
}
```

- Compliance sweep runs at 02:00 UTC nightly
- Credential expiration check runs at 03:00 UTC nightly
- Both require `FEATURE_COMPLIANCE_AUTO_SWEEP=true` and `FEATURE_CREDENTIAL_AUTO_RENEWAL=true` respectively

### Build Command
```bash
npm run build
```

### Required Vercel Environment Variables (production)
All vars from the Environment Variables section, plus:
- Ensure `STRIPE_WEBHOOK_SECRET` matches the webhook endpoint registered in Stripe Dashboard
- Ensure `SENTRY_AUTH_TOKEN` has `project:releases` scope for source map upload

---

## Contributing

1. Run `npm run lint` before committing
2. All new API routes must include Zod validation and rate limiting middleware
3. All new database tables must have RLS enabled (see migration 007 template)
4. PHI must never be logged to Sentry

---

*NurseSphere — built for reliability, compliance, and scale.*

## Zero Trust Architecture
- PHI Guard: middleware blocks storage of patient names, MRNs, diagnoses on all API routes
- Tenant isolation: facility_id scoped on all queries, cross-facility reads blocked at RLS layer
- Credential integrity: SHA-256 hash computed at upload, tamper detection on verification
- No select('*'): all queries use explicit column lists (minimum necessary data)
- Security posture dashboard: /dashboard/security-posture (super_admin only)
- Allowed data schema: nurse credentials, facility info, shift metadata, compliance scores — no patient data


## Continuous Compliance Architecture
- Daily sweep: complianceSweep() hits OIG, NURSYS, SAM (stub) for all active nurses
- Shift-time revalidation: validateBeforeShift() runs before every shift start
- Auto-suspension: critical failures auto-suspend nurse, block shift pickup, notify admins
- Transparency: /dashboard/compliance-center shows live sweep status + export
- All actions: audit logged with actor_id, no PHI stored

## Litigation Defense Engine
- Competency tagging: nurses tagged by unit type (ICU/ER/MedSurg/etc.) with hours + recency
- Shift acuity: Low/Moderate/High/Critical — required competencies set at shift creation
- Competency guardrail: high/critical shifts block nurses below threshold. Override requires admin justification + audit log.
- Risk certificates: every shift confirmation generates an immutable, SHA-256 signed record of credential state, competency, compliance score, and decision basis
- Litigation export: /dashboard/risk-reports — staffing decisions, certificates, compliance history — all timestamped and tamper-evident
