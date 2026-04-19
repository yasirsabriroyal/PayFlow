# PayFlow AP — Claude Reference File

> This file is the single source of truth for any Claude session working on this project.
> At the start of every new chat, say: "Read CLAUDE.md in the project root before doing anything."

---

## 1. Project Overview

**PayFlow AP** is an Enterprise Accounts Payable platform built for Canadian construction companies. It manages invoices, payment certificates, holdbacks, EFT batch payments, contractor compliance, and project budgets.

**Owner:** Yasir Sabri — info@royaldevelopment.ca
**Company:** Royal Development

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16, React 19 |
| Build | Turbopack |
| Database | Supabase (PostgreSQL) |
| UI Components | Radix UI, shadcn/ui |
| Styling | Tailwind CSS 4 |
| Deployment | Vercel |
| Package Manager | pnpm |

---

## 3. Infrastructure

| Item | Value |
|---|---|
| Repo | github.com/yasirsabriroyal/PayFlow (private) |
| Live URL | v0-finance-web-app-woad.vercel.app |
| Vercel Team ID | team_4OHeyCWhrrubThww9728V0ln |
| Vercel Project ID | prj_3ecmxMmT1BovCkLJ2ittqFwMIkQu |
| Local Path | C:\Users\yasir\OneDrive\Apps\RoyalPayFlow |

---

## 4. Roles & Entry Points

| Role | Entry Route | Purpose |
|---|---|---|
| `admin` | `/admin/dashboard` | Full system access, team management |
| `accountant` | `/accountant/queue` | Invoice approval queue, payment runs |
| `project_manager` | `/pm/dashboard` | Certificate workflow, project oversight |
| `contractor` | `/vendor/portal` | View invoices, upload compliance docs |

---

## 5. Full Page Map

### Admin
- `/admin/dashboard` — Overview and stats
- `/admin/invoices` — All invoices across projects
- `/admin/projects/[id]` — Project detail
- `/admin/contractors/[id]` — Contractor detail
- `/admin/team` — Team member management
- `/admin/accounting` — Audit logs and accounting
- `/admin/payments/direct` — Direct payment processing

### Accountant
- `/accountant/queue` — Invoice approval queue
- `/accountant/invoices/[id]` — Invoice detail + certificate payments
- `/accountant/payments` — EFT payment run + approved cert payments
- `/accountant/holdbacks` — Holdback management

### Project Manager
- `/pm/dashboard` — Overview
- `/pm/invoices/[id]` — Invoice detail + certificate workflow
- `/pm/certificates` — All certificates across projects
- `/pm/approvals` — Pending certificate approvals
- `/pm/projects/[id]` — Project detail
- `/pm/contractors/[id]` — Contractor detail

### Shared (Admin + Accountant)
- `/invoices/[id]` — Generic invoice view (read-only, no cert creation)
- `/invoices/[id]/certificates/[certId]` — Certificate detail (all roles)

### Contractor
- `/vendor/portal` — Invoice list
- `/vendor/compliance` — WCB/insurance document uploads
- `/vendor/onboarding` — Contractor onboarding form

---

## 6. Architecture & Key Patterns

### Database Access
- Always use `getSupabaseAdmin()` from `lib/supabase/admin` — bypasses RLS
- Never use raw `createClient()` with service role key directly
- Role lookup: query `users` table using `auth_user_id` (NOT the old `profiles` table)

### Server Actions
- All server actions wrapped in `secureAction()` for error handling
- All role-gated actions use `withPermission()` at the top
- Actions live in `app/[role]/actions.ts` per role

### Permissions
- `lib/permissions/core.ts` — `getCurrentUser()`
- `lib/permissions/auth.ts` — `getCurrentUser()` (auth variant)
- `lib/permissions/get-permissions.ts` — `getMyPermissions()`

### Key Shared Components
- `components/app-header.tsx` — Main header used across all roles
- `components/ui/` — shadcn/ui components

---

## 7. Payment Certificate Business Rules

These rules are FIXED and must never be violated by any code change:

1. **Holdback (10%) is at INVOICE level only** — never deducted per certificate
2. **Certificates are paid at full certified amount** — no holdback deduction per cert
3. **Cannot issue a cert** if invoice remaining balance ≤ holdback amount
4. **EFT batch is blocked** if any selected invoice has unpaid certificates
5. **Certificate status flow:** `draft → pending → approved → paid` (or `rejected → draft`)
6. **Who can approve/reject:** Admin OR Project Manager
7. **Who can create certs:** Project Manager only (not accountant, not admin)
8. **PM can resubmit** a rejected certificate after editing

### Certificate Workflow
```
PM creates cert (draft)
→ PM edits cert (amount, description, period)
→ PM submits → status: pending
→ Admin or PM approves → status: approved
  OR Admin or PM rejects (with reason) → status: rejected
→ If rejected: PM resubmits → back to draft → edit → submit again
→ If approved: cert appears in accountant payments page
→ Accountant clicks "Review & Pay" → review modal → confirms
→ Cert status: paid
→ Once ALL certs on invoice are paid → invoice balance unlocks for direct payment
```

---

## 8. Database Key Tables

| Table | Purpose |
|---|---|
| `invoices` | Core invoice records |
| `payment_certificates` | Payment certificates per invoice |
| `payments` | All payment records |
| `contractors` | Contractor/vendor records |
| `projects` | Project records |
| `users` | Internal user records (linked to Supabase auth via `auth_user_id`) |
| `audit_logs` | All actions logged here |
| `payment_batches` | EFT batch records |
| `holdback_ledgers` | Holdback tracking |

---

## 9. Navigation (Current State & Plan)

### Current Problems
1. No centralized route constants — hardcoded strings everywhere causing broken links
2. No role-specific tab bar — users navigate without clear orientation
3. Inconsistent breadcrumbs across pages
4. No reliable back navigation on detail pages

### Agreed Navigation Plan
- **Step 1:** Create `lib/navigation.ts` — single source of truth for all route constants
- **Step 2:** Build `RoleTabBar` component — role-specific tabs below existing AppHeader
- **Step 3:** Add `RoleTabBar` to all main list/dashboard pages (NOT detail pages)

### Tab Structure Per Role
| Role | Tabs |
|---|---|
| Accountant | Queue \| Payments \| Holdbacks \| Reports |
| Project Manager | Dashboard \| Invoices \| Certificates \| Approvals \| Projects \| Contractors |
| Admin | Dashboard \| Invoices \| Team \| Projects \| Contractors \| Accounting |
| Contractor | Portal \| Compliance |

### Target Layout
```
┌─────────────────────────────────────────────┐
│  PayFlow AP    Home >    [Role Badge] [User] │  ← existing AppHeader (unchanged)
├─────────────────────────────────────────────┤
│  Tab 1   Tab 2   Tab 3   Tab 4              │  ← NEW: RoleTabBar component
├─────────────────────────────────────────────┤
│                                             │
│  Page content                               │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 10. Pending Work Items

### High Priority
- [ ] Step 1: Create `lib/navigation.ts` route constants
- [ ] Step 2: Build `RoleTabBar` component
- [ ] Step 3: Add `RoleTabBar` to all main pages

### Medium Priority
- [ ] Part 3: Batch cert select + pay multiple certs at once on payments page

### Low Priority / Non-blocking
- [ ] ESLint warnings cleanup (199 warnings, all `no-unused-vars` / `exhaustive-deps`)
- [ ] Zod form validation migration (14 forms)

---

## 11. How Claude and Yasir Work Together

### The Three Players
| Player | Role |
|---|---|
| **Yasir** | Product owner — decides what to build, tests results, reports back |
| **Claude (chat)** | Architect & coordinator — plans work, writes prompts, verifies deployments, diagnoses issues |
| **Claude Code** | Developer — reads files, writes code, commits and pushes to GitHub |

### The Workflow Loop
```
1. Claude writes a prompt in chat (inside a code block)
2. Yasir copies the prompt
3. Yasir pastes it into Claude Code terminal (NOT cmd.exe)
4. Claude Code does the work, commits, pushes to GitHub
5. Vercel auto-deploys from GitHub (~1-2 minutes)
6. Claude checks Vercel deployment status
7. Yasir tests on the live site
8. Yasir reports result back in chat
9. Repeat
```

### How to Open Claude Code
```bash
cd C:\Users\yasir\OneDrive\Apps\RoyalPayFlow
claude
```
⚠️ Paste prompts INSIDE the Claude Code terminal — NOT in Windows cmd.exe

### Claude Code Auto-Approve Config
File: `.claude/settings.json`
```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Write(*)",
      "Edit(*)",
      "MultiEdit(*)",
      "Glob(*)",
      "Grep(*)"
    ]
  }
}
```
This prevents Claude Code from asking for approvals on every step.

---

## 12. Rules & Discipline

### The Golden Rules (never break these)

**Rule 1 — One task at a time**
Every prompt does exactly one thing. Never combine multiple features into one prompt.

**Rule 2 — STRICT SCOPE RULE**
Claude Code must ONLY make the exact changes described. It must NOT add, remove, or change anything not explicitly requested. If it notices other issues while working, it must report them in the summary but NOT fix them.

**Rule 3 — Test before next task**
Always verify the change on the live site before moving to the next task. Never stack unverified changes.

**Rule 4 — Report back**
After Claude Code finishes, Yasir pastes the summary back into chat. Claude verifies the deployment on Vercel, then writes the next prompt.

**Rule 5 — Deployment verification**
Claude always checks Vercel deployment status after every push to confirm `state: READY` before asking Yasir to test.

---

## 13. Standard Prompt Template

Every prompt to Claude Code must start with this header:

```
STRICT SCOPE RULE: Only make the exact changes described below.
Do NOT add, remove, or change anything else. If you notice other
issues while working, report them in your summary but do NOT fix them.

[actual task description here]

Run tsc --noEmit, fix any TypeScript errors, commit as "[commit message]", push to main.
```

---

## 14. How Claude Responds in Chat

- **One prompt at a time** — Claude writes one focused prompt, waits for result, then writes the next
- **No assumptions** — Claude does not assume something worked. It checks Vercel after every push
- **Diagnosis first** — When something breaks, Claude checks runtime logs before writing a fix
- **Ask before building** — Claude proposes a plan and gets agreement before writing code prompts
- **Short summaries** — After each deployment, Claude gives a brief status table, not paragraphs
- **Escalate scope creep** — If Claude Code touched something it shouldn't have, Claude flags it immediately and fixes it before moving on

---

## 15. Known Issues & History

### Fixed Issues (do not re-introduce)
- `profiles` table does not exist — always use `users` table with `auth_user_id`
- `payment_request_id` in payments table is nullable (migration 041 applied)
- `approved_by` / `rejected_by` / `processed_by` columns use internal `users.id` not Supabase auth UUID
- `amountCents <= 0` validation in cert payment dialog must be gated on `paymentMode === 'direct'`
- Generic `/invoices/[id]` page must NOT have a "New Certificate" button (PM only)
- Per-cert holdback display removed from all pages and cert detail page

### Demo Data Notes
- WCB clearance expiry updated to 2027-04-19 for all contractors
- Payment certificates reset to `approved` status after demo data cleanup
- Payments made before cert workflow fix were deleted and need to be re-created through proper flow

---

*Last updated: April 19, 2026*
*Reference maintained by: Yasir Sabri & Claude*
