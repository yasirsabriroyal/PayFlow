# PayFlow AP

Enterprise-grade Accounts Payable management system built for Canadian construction companies. Features automated holdback calculation (10% statutory compliance), multi-role workflows, real-time notifications, and CPA-005 EFT batch generation.

## Architecture Overview

```
payflow-ap/
├── app/                          # Next.js 16 App Router
│   ├── admin/                    # Admin dashboard, team management, settings
│   ├── accountant/               # AP queue, payments, holdback ledger
│   ├── pm/                       # Project manager approvals
│   ├── vendor/                   # Contractor invoice submission portal
│   ├── auth/                     # Authentication flows
│   └── api/                      # API routes (CSV export, webhooks)
├── components/
│   ├── layout/                   # Navigation, headers, mobile nav
│   ├── pwa/                      # PWA install prompts, service worker
│   └── ui/                       # shadcn/ui component library
├── lib/
│   ├── supabase/                 # Database client (server, client, middleware)
│   └── notifications.ts          # Email/SMS notification handlers
├── scripts/                      # SQL migrations and seed data
├── tests/                        # Playwright E2E test suite
└── public/
    ├── icons/                    # PWA icons (all sizes)
    ├── sw.js                     # Service worker for offline support
    └── manifest.json             # PWA manifest
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack, React Compiler) |
| Database | Supabase (PostgreSQL with RLS) |
| Auth | Supabase Auth |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Notifications | Resend (Email) + Twilio (SMS/WhatsApp) |
| Testing | Playwright |
| Deployment | Vercel |

## User Roles

| Role | Access | Key Features |
|------|--------|--------------|
| **Contractor** | `/vendor/*` | Submit invoices, view payment status, upload documents |
| **Project Manager** | `/pm/*` | Review and approve invoices, manage project budgets |
| **Accountant** | `/accountant/*` | Process payments, generate EFT batches, manage holdbacks |
| **Admin** | `/admin/*` | User management, system settings, compliance guardrails |

## Key Features

- **Automated 10% Holdback**: Calculates and tracks statutory holdbacks per Canadian construction lien law
- **Compliance Guardrails**: Block payments for expired WCB, missing lien waivers, or statutory declarations
- **CPA-005 EFT Generation**: Canadian Payments Association compliant batch file generation
- **Real-time Notifications**: Email and SMS alerts for invoice status changes
- **PWA Support**: Installable mobile app with offline capabilities
- **Custom Report Builder**: Export invoices, payments, and holdbacks to CSV

## Environment Setup

### 1. Clone and Install

```bash
git clone https://github.com/your-org/payflow-ap.git
cd payflow-ap
pnpm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```env
# Required - Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Required for Production
NEXT_PUBLIC_SITE_URL=https://your-domain.com

# Optional - Notifications
RESEND_API_KEY=re_xxx
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
```

### 3. Database Setup

Run migrations in order via Supabase SQL Editor or CLI:

```bash
# 1. Core schema (users, projects, invoices, payments)
scripts/001_enterprise_ap_schema.sql

# 2. Notification system
scripts/002_notification_system.sql

# 3. Admin control center (system settings, report templates)
scripts/003_admin_control_center.sql
```

### 4. Run Development Server

```bash
pnpm dev
```

Visit `http://localhost:3000`

## Production Deployment

### Pre-Deployment Checklist

```bash
# Validate TypeScript and ESLint
pnpm run validate

# Run full build locally
pnpm run prepare:deploy

# Run E2E tests
pnpm run test
```

### Deploy to Vercel

#### Option 1: Vercel CLI

```bash
# Install Vercel CLI
pnpm add -g vercel

# Login and deploy
vercel login
vercel --prod
```

#### Option 2: Git Integration

1. Push to GitHub/GitLab/Bitbucket
2. Connect repository in [Vercel Dashboard](https://vercel.com/new)
3. Configure environment variables in Vercel Settings
4. Deploy automatically on push to `main`

### Environment Variables in Vercel

Navigate to **Project Settings > Environment Variables** and add:

| Variable | Environment | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | All | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Yes |
| `NEXT_PUBLIC_SITE_URL` | Production | Yes |
| `RESEND_API_KEY` | Production | No |
| `TWILIO_ACCOUNT_SID` | Production | No |
| `TWILIO_AUTH_TOKEN` | Production | No |

### Post-Deployment

1. **Verify Auth Callbacks**: Ensure `NEXT_PUBLIC_SITE_URL` matches your Vercel deployment URL
2. **Configure Supabase Auth**: Add your production URL to Supabase Auth > URL Configuration
3. **Test PWA Installation**: Verify service worker registration and manifest
4. **Run Smoke Tests**: Execute critical path tests against production

## Testing

```bash
# Run all tests
pnpm test

# Interactive UI mode
pnpm test:ui

# Watch browser execution
pnpm test:headed

# CI mode (headless, with retries)
pnpm test:ci
```

### Test Coverage

The E2E suite (`tests/ap-workflow.spec.ts`) covers:

- Contractor invoice submission with holdback calculation
- Project Manager approval workflow
- Accountant payment processing with compliance checks
- Holdback ledger verification
- Compliance guardrail enforcement

## Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | TypeScript validation |
| `pnpm validate` | Type-check + lint |
| `pnpm prepare:deploy` | Full pre-deployment validation |
| `pnpm test` | Run Playwright tests |

## Security Considerations

- **Row Level Security (RLS)**: All database tables enforce role-based access
- **Service Role Key**: Server-side only, never exposed to client
- **HTTP-Only Cookies**: Secure session management via Supabase Auth
- **Security Headers**: HSTS, CSP, X-Frame-Options configured in `next.config.mjs`
- **Input Validation**: Zod schemas for all form inputs

## License

Proprietary - All rights reserved.

---

Built with Next.js 16, Supabase, and Tailwind CSS.
