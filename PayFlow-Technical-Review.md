# PayFlow AP — Technical Code Review

**Reviewer:** Claude (Cowork)
**Date:** May 21, 2026
**Scope:** Static code review of the `RoyalPayFlow` codebase — architecture, authentication & RBAC, payment/business logic, API routes, data layer, and security. No code was changed; this is read-only analysis.

---

## 1. Executive Summary

PayFlow AP is a genuinely well-structured Next.js 16 / Supabase accounts-payable platform for Canadian construction. The engineering fundamentals are strong: money is stored in integer cents, the database has comprehensive Row Level Security, security headers and a CSP are configured, roles are resolved server-side from a trusted table, and there is a thoughtful permission catalog and policy engine.

However, several of the controls that *look* present are not actually wired into the code paths that matter, and there are a few concrete security holes. The most important issues:

- **A document-download endpoint that lets any logged-in user fetch any other party's files (IDOR).**
- **The "$50,000 EFT requires admin approval" limit can be bypassed** because the amount used for the check comes from the client.
- **The dynamic permission-management UI has no effect on the sensitive server actions** — they enforce static defaults, not the database matrix.
- **The headline compliance features (CPA-005 bank file, WCB/lien payment blocking, automated statutory 10% holdback) are not actually enforced** in the payment execution path.
- **Live secrets are present in `.env.local`** in the working tree and should be rotated.

None of these are catastrophic to fix — most are small, localized changes — but for a system that moves money they should be addressed before the platform is trusted with real payments.

---

## 2. What the App Is and How It Works

### Architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Data / Auth | Supabase (PostgreSQL + Supabase Auth, SSR cookies) |
| File storage | Vercel Blob (private access) |
| UI | Tailwind CSS v4, Radix UI / shadcn |
| Forms / validation | react-hook-form + Zod |
| Testing | Vitest (unit), Playwright (E2E) |
| Hosting | Vercel |

### Roles and routing

Four roles — `admin`, `accountant`, `project_manager`, `contractor` — each with a home area (`/admin`, `/accountant`, `/pm`, `/vendor`). `middleware.ts` → `lib/supabase/middleware.ts` runs on every non-static request, validates the session with `supabase.auth.getUser()`, and looks the role up from the `users` table (correctly *not* from client-writable `user_metadata`). It redirects unauthenticated users to login and bounces users away from areas their role can't see.

### Core workflow

The system models a construction AP pipeline:

1. **Invoice** is created (by a contractor in the vendor portal, or manually by a PM) with a 10% statutory holdback withheld.
2. **Payment certificates** are issued by a PM to certify portions of the invoice for payment; they flow `draft → submitted → approved → paid` (or `rejected`).
3. **Approval** of invoices/certificates is done by PM or admin.
4. **Payment** is executed by an accountant — either an EFT "batch," a per-certificate payment, or a direct invoice payment.
5. **Holdback ledger** tracks the withheld 10% for later release.
6. Every mutation writes to `audit_logs`, and authorization events are meant to write to `security_events`.

### Security model (intended)

Defense in depth was clearly the design intent: middleware (coarse route gating) + database RLS + an application permission layer (`secureAction` / `withPermission` wrappers) + a policy engine for financial thresholds and project scoping. The problem, detailed below, is that these layers are not consistently connected — and the most sensitive operations run through the Supabase **service-role** client, which bypasses RLS entirely, leaving the application-layer checks as the only real gate.

---

## 3. Strengths (Keep Doing This)

- **Money is integer cents end to end** in storage and server-side math (e.g., `Math.round(total_cents * rate)` in `app/pm/actions.ts`). This avoids floating-point money bugs.
- **Comprehensive RLS** in `scripts/001_enterprise_ap_schema.sql`: every table has RLS enabled, and contractors are scoped to their own `contractor_id` for invoices, payments, holdbacks, lien waivers, etc. This is the single biggest thing protecting the data.
- **Server-trusted roles.** `getCurrentUser()` (`lib/permissions/auth.ts`) reads the role from the `users` table after validating the JWT — the correct pattern.
- **Security headers + CSP** are properly set in `next.config.mjs` (X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy, Permissions-Policy, and a real Content-Security-Policy).
- **A clean permission catalog** (`lib/permissions/constants.ts`) and a fail-closed **policy engine** (`lib/security/policyEngine.ts`) with sensible separation-of-duties policies (self-role-modification block, admin-assignment restriction).
- **Idempotency guards** on state transitions (e.g., payments only process invoices with `status = 'approved'`, certificates check status before transition).
- **Audit logging** on business actions via the admin client (reliable writes).

---

## 4. Findings by Severity

### CRITICAL

**C-1. Document download is an IDOR — any authenticated user can read any file.**
`app/api/documents/[id]/route.ts` authenticates the user, then fetches the document by `id` using `getSupabaseAdmin()` (service role, **bypasses RLS**) and streams it back. There is no check that the requesting user is connected to that invoice/contractor. Any logged-in contractor can enumerate document IDs and download other contractors' invoices, contracts, lien waivers, and banking documents.
*Fix:* After loading the document, resolve the related invoice/contractor and verify the caller is an internal user or the owning contractor (mirror the RLS predicate), or query through the session-scoped client so RLS applies.

**C-2. The $50,000 EFT approval limit is bypassable (client-controlled amount).**
In `app/accountant/actions.ts`, `executeEFTPayment` passes the policy amount from `input.total_amount_cents` — supplied by the client — into the `EFT_LIMIT_POLICY` check, while the *actual* payment total is recomputed server-side from the invoices and never compared. A caller can send `total_amount_cents: 1` to skip the admin-approval requirement and still pay the full (much larger) amount. Note that `releaseHoldback` *does* validate the client amount against the record — `executeEFTPayment` should do the same.
*Fix:* Compute the policy amount server-side from the selected invoices (or assert `input.total_amount_cents === serverComputedTotal` before authorizing).

### HIGH

**H-1. Dynamic RBAC is not enforced on sensitive actions.**
There are three different permission-resolution paths:
- `secureAction` (used by approve/reject/process/EFT/holdback) → `requirePermissionSimple` → `hasPermissionSync` → **static `DEFAULT_ROLE_PERMISSIONS` only**.
- `protectRoute` (page gating) → `hasPermission` → **DB matrix merged with defaults**.
- `getMyPermissions` (client UI) → **DB `role_permissions` only**.

Because the money-moving server actions check only the static defaults, the admin "Manage Permissions" screen (which writes to `role_permissions`) cannot actually grant or **revoke** any sensitive permission. An admin who removes `execute_eft_payments` from accountants in the UI will find accountants can still execute EFTs. The UI is effectively cosmetic for the operations that matter, and the three paths can disagree.
*Fix:* Standardize on one DB-backed check (`hasPermission`) across middleware, routes, and `secureAction`.

**H-2. Compliance guardrails are not wired into the payment path.**
The README advertises blocking payments for expired WCB clearance and missing lien waivers. A SQL function `check_payment_compliance()` exists (`scripts/003_admin_control_center.sql`), and an admin setting `payment_lien_waiver_required` is stored, but **no application code ever calls them** (there are no `.rpc()` calls in the codebase). WCB expiry is shown as a UI badge only. None of `executeEFTPayment`, `processPayments`, `recordDirectInvoicePayment`, or `executeCertificateEFTBatch` checks WCB or lien status before paying.
*Fix:* Call the compliance check server-side inside the payment actions and block on failure.

**H-3. No database transactions around multi-step payment writes.**
EFT execution loops over invoices/certificates issuing separate `insert`/`update` calls with a hand-rolled "compensating rollback" that only `console.error`s if the rollback itself fails. A crash or partial failure mid-loop can leave payments, certificate statuses, and invoice balances inconsistent — a serious integrity risk for money movement.
*Fix:* Wrap each batch in a Postgres transaction (e.g., a `SECURITY DEFINER` RPC / stored procedure) so it is atomic.

**H-4. Live secrets present in `.env.local`.**
The working-tree `.env.local` contains a live Supabase **service-role key**, **`SUPABASE_JWT_SECRET`** (with which anyone can mint valid tokens for any user/role), the Postgres password, the Supabase secret key, and a Vercel Blob read/write token. `.gitignore` does exclude `.env*.local`, which is good, but the values are real and sitting on disk.
*Fix:* Rotate all of these credentials, confirm the file was never committed (`git log --all -- .env.local`), and keep production secrets only in Vercel's environment settings. (I have not reproduced any of the values in this report.)

### MEDIUM

**M-1. Separation of duties is weak on payment certificates.** A project manager holds both `CREATE_PAYMENT_CERTIFICATE` and `APPROVE_INVOICES`, so a single PM can create, submit, *and* approve the same certificate (`lib/actions/payment-certificates.ts`) — no maker/checker control. The same PM can also create invoices. Consider requiring a different approver, or an admin co-sign, for certificate approval.

**M-2. PM project-scope policy trusts client input.** `isAssignedToProject()` checks `context.assignedProjectIds`, which is populated from the client-supplied `assigned_project_ids` on the approve/reject inputs. A PM can pass the target project in that array to approve invoices for projects they aren't assigned to. Resolve the PM's assigned projects server-side instead.

**M-3. Report export and document upload lack app-layer authorization.** `app/api/reports/export/route.ts` (POST and GET) and `app/api/documents/upload/route.ts` check only that the user is authenticated — not `EXPORT_REPORTS` / `UPLOAD_INVOICE_ATTACHMENT`. Export is largely saved by RLS (it uses the session client), but the upload route uses the service-role client and doesn't verify the caller is connected to `invoice_id`, so a contractor can attach files to arbitrary invoices. Add permission + ownership checks.

**M-4. Statutory 10% holdback is optional, not automated.** In the vendor portal (`app/vendor/invoices/new/page.tsx`) the holdback is computed client-side in floating point (`totalAmountNum * 0.10`) behind a checkbox the submitter can untick; the PM path (`createPMInvoice`) recomputes server-side in cents but reads `holdback_percentage` from the client and defaults to `0`. For a *statutory* holdback this should be enforced server-side and not be skippable.

**M-5. Certificate EFT batch and direct payments skip the policy engine.** `executeCertificateEFTBatch` and `recordDirectInvoicePayment` use `withPermission` (no `getPolicyContext`), so the $50K EFT limit and $25K holdback-release limit policies never run on those paths — even though they move money.

**M-6. No file validation on upload.** `documents/upload` stores any MIME type and any size with no allowlist or size cap (DoS / malicious-file risk). Blob is correctly private, which helps.

**M-7. Security telemetry can silently fail.** `logSecurityEvent` (`lib/security/telemetry.ts`) writes `security_events` via the **session** client, so events for unauthenticated callers (auth failures, pre-login denials) — exactly the ones you most want — may be rejected by RLS and only land in ephemeral `console` output. Use the admin client for telemetry.

### LOW

- **L-1. Rate limiting is inert.** `lib/security/rateLimit.ts` is in-memory per-instance (won't work across Vercel lambdas) and is commented out (`// temporarily disabled`) on every financial action. Use a shared store (e.g., Upstash/Redis) and re-enable.
- **L-2. Duplicated, divergent logic.** Two `createPaymentCertificate` implementations (`lib/actions/payment-certificates.ts` vs `app/pm/actions.ts`) compute available balance differently (one reserves holdback, the other doesn't); `payment-certificates.ts` re-defines its own `getSupabaseAdmin()` instead of importing the canonical one.
- **L-3. Additive-only permission matrix.** `getPermissionsMatrix()` starts from defaults and only *adds* DB rows, so a default permission can never be removed through data — compounding H-1.
- **L-4. Missing role gating on shared routes.** Middleware only role-gates `/admin`, `/accountant`, `/pm`, `/vendor`; `/invoices/*` and `/projects/*` are reachable by any authenticated role (data is still RLS-protected, but the UI is not scoped).
- **L-5. Auth-callback `next` param not allowlisted.** `app/auth/callback/route.ts` redirects to `${origin}${next}`; origin-prefixing limits the risk, but validating `next` against an allowlist is safer.
- **L-6. Migration churn.** ~40 SQL scripts including many `diagnose`/`fix`/duplicate-numbered files (three different `037-*`, two `030-*`) suggest schema drift; consider consolidating into clean, ordered migrations.
- **L-7. Doc/feature mismatches.** README claims React Compiler (config has `reactCompiler: false`) and "CPA-005 EFT batch file generation" (no such generation exists — `executeEFTPayment` only updates statuses and writes a `payment_batches` row).

---

## 5. Feature-vs-Reality Gaps

A recurring theme: the README and UI present controls that the executing code does not actually apply.

| Advertised feature | Reality in code |
|---|---|
| CPA-005 EFT batch file generation | No file is generated; only DB status updates + a batch record |
| Block payments for expired WCB / missing lien waiver | `check_payment_compliance()` exists in SQL but is never called; WCB is a UI badge only |
| Automated 10% statutory holdback | Optional client-side checkbox (vendor) / client-supplied percent defaulting to 0 (PM) |
| Dynamic RBAC ("manage permissions") | Sensitive server actions enforce static defaults; UI changes don't apply |
| Rate limiting on financial actions | Implemented but commented out, and in-memory only |

These aren't necessarily dishonest — they look like features that were scaffolded and not finished wiring — but they should either be completed or the claims softened.

---

## 6. Testing Assessment

- `__tests__/rbac/security.test.ts` validates the **shape** of the permission catalog (valid keys, counts, defaults) but does **not** test enforcement. Notably it tests a locally re-declared `enforceProtectedPermissions()` helper that was removed from the real code, and its "Authorization Flow" tests just `throw new PermissionError()` and assert it throws. None of the real vulnerabilities above would be caught.
- There is a Playwright E2E spec (`tests/ap-workflow.spec.ts`) and a policy spec (`tests/security/policy.spec.ts`), which is good, but coverage of the money-movement edge cases (amount tampering, IDOR, partial-failure rollback) is missing.
*Recommendation:* Add integration tests that call the actual server actions/route handlers with hostile inputs (wrong role, mismatched amounts, foreign document IDs).

---

## 7. Prioritized Recommendations

1. **Fix the document IDOR (C-1)** — add an ownership/permission check; this is a data-confidentiality breach today.
2. **Recompute the EFT policy amount server-side (C-2).**
3. **Rotate the secrets in `.env.local` (H-4)** and confirm they were never committed.
4. **Unify permission enforcement on the DB-backed check (H-1)** so the admin UI is real and consistent.
5. **Wire `check_payment_compliance()` (WCB/lien) into the payment actions, and enforce the statutory holdback server-side (H-2, M-4).**
6. **Make batch payments atomic with a DB transaction/RPC (H-3).**
7. Add app-layer authz to the export/upload routes and route the certificate-EFT/direct-payment paths through the policy engine (M-3, M-5).
8. Re-enable rate limiting with a shared store, fix telemetry to use the admin client, and add adversarial integration tests (L-1, M-7, testing).

---

*Prepared from a read-only review of the source. Line/function references point to the files as they exist in the working tree on the review date. Secret values were intentionally not reproduced.*
