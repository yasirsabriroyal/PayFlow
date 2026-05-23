# PayFlow AP — Project Reference (CLAUDE.md)

> Feed this file to any AI coder at the start of a session so it has full context on the project, rules, and current state.

---

## 1. What the App Is

**PayFlow AP** is an enterprise Accounts Payable platform built for **Canadian construction companies**. It manages the full AP workflow: invoices, payment certificates, EFT payments, lien waivers, compliance, and team management — across multiple user roles.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16, React 19, Turbopack |
| Database | Supabase (PostgreSQL) |
| UI Components | Radix UI, shadcn/ui |
| Styling | Tailwind CSS v4 |
| Deployment | Vercel |
| Language | TypeScript |

---

## 3. Project Locations

| Resource | Value |
|---|---|
| GitHub Repo | github.com/yasirsabriroyal/PayFlow (private) |
| Local Path | `C:\Users\yasir\OneDrive\Apps\RoyalPayFlow` |
| Live URL | https://v0-finance-web-app-woad.vercel.app |
| Vercel Team ID | `team_4OHeyCWhrrubThww9728V0ln` |
| Vercel Project ID | `prj_3ecmxMmT1BovCkLJ2ittqFwMIkQu` |

---

## 4. Roles & Routes

| Role | Landing Route |
|---|---|
| `admin` | `/admin/dashboard` |
| `accountant` | `/accountant/queue` |
| `project_manager` | `/pm/dashboard` |
| `contractor` | `/vendor/portal` |

---

## 5. Database Schema (Key Tables)

- **`users`** — app users. Auth lookup uses `.from('users').eq('auth_user_id', user.id)`. NOT `.from('profiles')` — that table is stale and must never be used.
- **`invoices`** — AP invoices submitted by contractors
- **`payment_certificates`** — certificates issued against invoices by project managers. Status values: `draft`, `approved`, `paid`
- **`payment_requests`** — legacy table, no longer used for payment flow

---

## 6. Critical Business Rules

### Payment Certificate Logic
1. A PM creates a certificate — starts in `draft` status
2. An accountant can only pay an invoice **after all certificates are in `paid` status**
3. The blocking check uses `status !== 'paid'` — NOT `!is_fully_paid` (that field is unreliable for zero-amount certs)
4. This check must exist in BOTH:
   - `recordDirectInvoicePayment()` — blocks direct payment
   - `executeEFTPayment()` — blocks EFT batch payment
5. `getInvoicePaymentInfo()` must use `status !== 'paid'` to set `paymentMode` — if any cert is unpaid, mode is `'certificate'`, not `'direct'`

---

## 7. Architecture Rules

### Supabase Admin Client
- **Always** use the shared utility: `import { getSupabaseAdmin } from '@/lib/supabase/admin'`
- **Never** create a local `createClient(url, serviceRoleKey)` directly in any action file
- `getSupabaseAdmin()` must be called **inside each function body** — never at module level
- Files that must follow this rule: `app/admin/team/actions.ts`, `app/accountant/actions.ts`, and any new server action files

### Permissions & Auth
- Role lookup: `.from('users').select('role').eq('auth_user_id', user.id)`
- Files using this: `lib/permissions/core.ts`, `lib/permissions/auth.ts`, `lib/permissions/get-permissions.ts`, `lib/supabase/middleware.ts`
- **Never** use `.from('profiles')` anywhere — it is a stale table that no longer exists

### Navigation
- All route paths must use constants from `lib/navigation.ts` (to be created — see Next Task below)
- The `AppHeader` component handles navigation for all roles via `roleConfig` in `components/app-header.tsx`
- The `RoleTabBar` component (to be built) will sit below `AppHeader` for role-specific tab navigation

---

## 8. Completed Fixes (All Live in Production)

| Commit | Description |
|---|---|
| `3f359f3` | Fix admin redirect, contractor nav, vendor compliance navigation |
| `ee6b843` | Fix stale `profiles` table — use `users` table for role lookups across 4 files |
| `d47a8c8` | Stage 1: Fix accountant redirect and block EFT payment bypass |
| `dddb26b` | Fix unvalidated service role key — use shared `getSupabaseAdmin()` |
| `6048703` | Fix `getInvoicePaymentInfo` to use status-based unpaid cert count |

---

## 9. Known Patterns & Conventions

- **Server Actions** live in `actions.ts` files co-located with their route folder (e.g. `app/accountant/actions.ts`)
- **Shared utilities** live in `lib/` (e.g. `lib/supabase/admin.ts`, `lib/permissions/`)
- **Components** are in `components/` — shared UI components used across roles
- **Page protection** goes through `lib/permissions/core.ts` → `protectRoute()` and `withPermission()`
- TypeScript must be clean — always run `npx tsc --noEmit` before committing

---

## 10. Next Task — Navigation Redesign

**Goal:** Consistent, role-aware navigation across the entire app.

**Plan:**

**Step 1 — Create `lib/navigation.ts`**
A single constants file with all route paths for every role. No hardcoded strings anywhere else.

**Step 2 — Build `RoleTabBar` component**
A reusable, config-driven tab bar component rendered below `AppHeader` on all main list/dashboard pages (~8–10 pages). Shows role-specific tabs so users can move between their key sections without hunting for links.

**Step 3 — Add `RoleTabBar` to main pages**
Apply to dashboard/list pages only — not detail or modal pages.

---

## 11. Working Rules (STRICT SCOPE RULE)

1. **One change at a time.** Never make unrequested additions or refactors alongside a requested fix.
2. **Report before fixing.** For any audit or investigation task, report findings first. Do not apply fixes unless explicitly told to.
3. **Always run `npx tsc --noEmit` before committing.** Zero TypeScript errors required.
4. **Commit messages must be descriptive.** Format: `[Area]: Short description of what changed and why`
5. **Push to `main` after every commit** unless instructed otherwise.
6. **No auto-translation.** All content is authored manually.
7. **Ask before creating new files or tables** not already described in this document.

---

## 12. How to Open the Project in Terminal

```cmd
cd C:\Users\yasir\OneDrive\Apps\RoyalPayFlow
```

Or: open File Explorer → navigate to the folder → click the address bar → type `cmd` → press Enter.

---

## 13. Session Start Checklist

Before starting any new task, always run this audit first:

```cmd
git status
git log --oneline -10
git fetch origin
git diff main origin/main --stat
npx tsc --noEmit
```

Confirm:
- [ ] Local branch is in sync with `origin/main`
- [ ] All 5 commits from Section 8 are present
- [ ] Zero TypeScript errors
- [ ] No uncommitted local changes

If anything fails, report it before proceeding.

---

*Last updated: May 2026 | Maintained by: Yasir*
