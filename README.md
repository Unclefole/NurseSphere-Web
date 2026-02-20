# NurseSphere Web Application

A production-grade web client for the NurseSphere healthcare staffing platform. This web application is fully aligned with the existing NurseSphere mobile app, sharing the same Supabase backend, business rules, and data.

## 🏥 Overview

NurseSphere Web provides hospital administrators with a comprehensive dashboard for managing:
- Shift creation and management
- Nurse applicant review and approval
- Contract generation and e-signatures
- Spheri analytics and insights
- Compliance monitoring
- Staff coordination

## 🔗 Backend Sync

**IMPORTANT**: This web application connects to the **same Supabase project** as the mobile app.

- ✅ Same database tables
- ✅ Same RLS (Row Level Security) policies
- ✅ Same auth system (Supabase Auth)
- ✅ Same business logic and rules
- ✅ Same contract immutability rules
- ✅ Same role-based access (HOSPITAL/NURSE)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Access to the NurseSphere Supabase project

### Installation

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env.local

# Add your Supabase credentials to .env.local
# NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Start development server
npm run dev
```

### Environment Variables

Create a `.env.local` file with:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

These MUST match the credentials used by the mobile app.

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Authentication pages
│   ├── dashboard/         # Main hospital dashboard
│   ├── applicants/        # Applicant management
│   ├── contracts/         # Contract management
│   ├── analytics/         # Spheri analytics
│   ├── compliance/        # Compliance monitoring
│   ├── shifts/            # Shift management
│   ├── nurses/            # Nurse directory
│   ├── messages/          # Messaging
│   ├── nurse/             # Nurse read-only portal
│   └── ...
├── components/            # Reusable components
│   ├── layout/           # Layout components
│   ├── dashboard/        # Dashboard components
│   └── landing/          # Landing page components
├── contexts/             # React contexts
│   └── AuthContext.tsx   # Authentication context
├── lib/                  # Utilities
│   └── supabase.ts      # Supabase client
└── types/               # TypeScript types
    └── database.ts      # Database types
```

## 🔐 Authentication & Roles

### Roles

| Role | Access |
|------|--------|
| HOSPITAL | Full dashboard access, can manage shifts, review applicants, sign contracts |
| NURSE | Read-only web access (full features in mobile app) |

### Protected Routes

All dashboard routes are protected by middleware and require authentication:
- `/dashboard/*`
- `/applicants/*`
- `/contracts/*`
- `/analytics/*`
- `/compliance/*`
- `/shifts/*`
- `/nurses/*`
- `/messages/*`

## 📋 Features

### ✅ Implemented

- [x] Authentication (sign in, sign up, sign out)
- [x] Hospital dashboard with all tiles
- [x] Applicant management with real Supabase data
- [x] Contract management with status badges
- [x] Contract immutability (signed contracts locked)
- [x] Spheri analytics dashboard
- [x] Compliance monitoring (read-only)
- [x] Shift management (create, view, manage)
- [x] Nurse directory
- [x] Messages
- [x] Incidents tracking
- [x] Nurse read-only portal
- [x] Settings page

### 🔄 Placeholder (To be expanded)

- [ ] Billing module
- [ ] Forecasting module
- [ ] Live Map
- [ ] CRM
- [ ] Education module

## 🎨 Design

The UI follows the provided design mockup with:
- Dark theme (ns-dark color palette)
- Teal/cyan accent colors
- Card-based dashboard layout
- Responsive design
- Smooth animations

## 🚀 Deployment to Vercel

### Deployment Checklist

1. **Connect Repository**
   ```bash
   # Push to GitHub
   git add .
   git commit -m "Initial NurseSphere Web Application"
   git push origin main
   ```

2. **Import to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Import your repository
   - Framework: Next.js (auto-detected)

3. **Set Environment Variables**
   In Vercel dashboard, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. **Deploy**
   - Vercel will automatically build and deploy

5. **Configure Domain** (optional)
   - Add custom domain in Vercel settings
   - Update Supabase URL allowlist if using custom domain

### Build Command

```bash
npm run build
```

### Output Directory

Next.js handles this automatically with Vercel.

## 🔄 Sync Verification

### Data Sync Confirmation

| Item | Web | Mobile | Status |
|------|-----|--------|--------|
| Supabase Project | ✅ Same | ✅ Same | ✅ Synced |
| Auth System | ✅ Supabase Auth | ✅ Supabase Auth | ✅ Synced |
| Users/Profiles | ✅ profiles table | ✅ profiles table | ✅ Synced |
| Hospitals | ✅ hospitals table | ✅ hospitals table | ✅ Synced |
| Nurses | ✅ nurses table | ✅ nurses table | ✅ Synced |
| Shifts | ✅ shifts table | ✅ shifts table | ✅ Synced |
| Applications | ✅ applications table | ✅ applications table | ✅ Synced |
| Contracts | ✅ contracts table | ✅ contracts table | ✅ Synced |
| Analytics | ✅ analytics table | ✅ analytics table | ✅ Synced |
| Compliance | ✅ compliance_records | ✅ compliance_records | ✅ Synced |
| Messages | ✅ messages table | ✅ messages table | ✅ Synced |
| Incidents | ✅ incidents table | ✅ incidents table | ✅ Synced |

### Business Logic Alignment

| Rule | Web Implementation | Mobile Alignment |
|------|-------------------|------------------|
| Signed contracts immutable | ✅ Cannot edit when status='signed' | ✅ Matches |
| Hospital role = full access | ✅ All dashboard features | ✅ Matches |
| Nurse role = read-only | ✅ Redirect to nurse portal | ✅ Matches |
| E-signatures | ✅ Hospital can sign | ✅ Nurse signs in mobile |
| Spheri generation flag | ✅ spheri_generated column | ✅ Matches |
| RLS policies | ✅ Respected via Supabase client | ✅ Matches |

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Icons**: Lucide React
- **Date Handling**: date-fns

## 📝 License

Proprietary - NurseSphere.io

---

Built with ❤️ for healthcare professionals

