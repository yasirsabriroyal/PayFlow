# Contractor / Vendor Portal — Audit & Remediation Report

**Project:** PayFlow AP (`RoyalPayFlow`)
**Audit date:** May 21, 2026
**Audience:** AI coding agent / engineer continuing this codebase
**Method:** Read-only static review of the contractor/vendor surface and the backend behind it. Every claim below was verified by reading the referenced file; line numbers are approximate to the version reviewed.

---

## 0. How to use this report

This document is self-contained — you do not need any prior conversation context. It describes which parts of the Contractor/Vendor Portal actually work, which are UI-only shells, and which backend capabilities already exist but aren't wired to the UI. Section 5 is a prioritized, task-by-task remediation plan with concrete files to touch and acceptance criteria.

**One-line summary:** The vendor portal is a high-fidelity prototype. Only authentication and route-gating are functional. Every data-bearing screen renders mock/hardcoded data and persists nothing. A contractor cannot currently onboard, submit an invoice, or sign a lien waiver. The database schema, RLS, and a document-management backend already exist to support these flows — they are simply not connected, and the sign-up path omits a key foreign key the rest of the model depends on.

---

## 1. Context primer (architecture relevant to this portal)

- **Framework:** Next.js 16 (App Router, server components + server actions), React 19.
- **Data/Auth:** Supabase (Postgres + Supabase Auth via SSR cookies). File storage: Vercel Blob (private).
- **Roles:** `admin`, `accountant`, `project_manager`, `contractor`. The contractor is the vendor-portal user.
- **Role resolution:** server-side from the `users` table (`lib/permissions/auth.ts` → `getCurrentUser()`), keyed by `auth_user_id = auth.uid()`. Never from client metadata.
- **Route gating:** `middleware.ts` → `lib/supabase/middleware.ts`. `PROTECTED_ROUTES.contractor = ['/vendor']` — contractors are confined to `/vendor/*`.
- **Contractor default permissions** (`lib/permissions/constants.ts`, `DEFAULT_ROLE_PERMISSIONS.contractor`): `view_vendors`, `view_contracts`, `upload_invoice_attachment`. (Note: server actions enforce these *static defaults*, not the DB `role_permissions` table — a separate known issue, out of scope here.)
- **Contractor-relevant tables** (`scripts/001_enterprise_ap_schema.sql`): `contractors`, `vendor_kyc_documents`, `invoices`, `payment_requests`, `payments`, `holdback_ledgers`, `lien_waivers`, `invoice_documents` (added in `scripts/030-create-payment-certificates.sql`).
- **RLS helper functions** used by contractor policies: `is_internal_user(auth.uid())`, `get_contractor_id(auth.uid())`. Contractor read access to invoices/payments/holdbacks/lien_waivers is gated by `contractor_id = get_contractor_id(auth.uid())`.

### Contractor/Vendor route & file map

| Route | File | Purpose |
|---|---|---|
| `/vendor/portal` | `app/vendor/portal/page.tsx` | Dashboard (stats, quick actions, compliance status) |
| `/vendor/invoices/new` | `app/vendor/invoices/new/page.tsx` | Submit an invoice |
| `/vendor/compliance` | `app/vendor/compliance/page.tsx` | Paid invoices + lien-waiver e-signing |
| `/vendor/onboarding` | `app/vendor/onboarding/page.tsx` | 3-step KYC onboarding wizard |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` + `app/auth/sign-up/actions.ts` | Contractor self-registration |
| Tabs | `components/role-tab-bar.tsx` (`VENDOR_TABS`) | Portal \| Compliance |
| Routes constants | `lib/navigation.ts` (`ROUTES.vendor`) | portal, compliance, onboarding |

There is **no contractor invoice-list route** (only `/vendor/invoices/new`).

### Backend that already exists for this portal

| Capability | File | Notes |
|---|---|---|
| Document CRUD | `lib/actions/invoice-documents.ts` | create/list/delete/update, with uploader-ownership checks |
| Document upload | `app/api/documents/upload/route.ts` | POST multipart → Vercel Blob (private) + `invoice_documents` row |
| Document download | `app/api/documents/[id]/route.ts` | GET stream from Blob — **IDOR, see §4** |
| KYC docs table | `vendor_kyc_documents` (schema + RLS) | contractor may select/insert own rows |
| Lien waivers table | `lien_waivers` (schema + RLS) | contractor may select own; update own *unsigned* |
| Manual invoice create (reference impl) | `app/pm/actions.ts` → `createPMInvoice` | real server-side insert w/ integer-cents holdback; use as a template |
| Contractor notifications | `lib/notifications.ts` → `notifyPaymentPaid`, `notifyPaymentRegistered` | defined, never called; delivery stubbed |

---

## 2. Category 1 — Active & Functional

Backend + UI + working as intended.

### 1.1 Contractor sign-up / account creation — WORKING (with one defect)
- **Files:** `app/auth/sign-up/page.tsx`, `app/auth/sign-up/actions.ts` (`completeContractorRegistration`).
- **Behavior:** Client calls `supabase.auth.signUp()`, then the server action verifies the returned `userId` against Supabase Auth via `auth.admin.getUserById()` (prevents userId spoofing), and inserts a `contractors` row (`kyc_status: 'pending'`, `is_active: true`) and a `users` row with `role` **hardcoded** to `'contractor'`. Good security posture.
- **DEFECT (high impact):** the `contractors` insert (actions.ts ~lines 37–43) does **not** set `auth_user_id`. Contractor RLS (`get_contractor_id(auth.uid())`) therefore cannot link the logged-in user to their contractor row — so contractor-scoped reads of invoices/payments/holdbacks return nothing even when data exists. Also, insert failures are only `console.log`'d (lines 44–46, 58–60), so the action returns `success` even if a row didn't persist.

### 1.2 Authentication (login / logout / password reset) — WORKING
- `app/auth/login`, `app/auth/forgot-password`, `app/auth/update-password`, `components/auth/logout-button.tsx`, `app/auth/callback/route.ts`. All real Supabase Auth.

### 1.3 Role-based route protection — WORKING
- `lib/supabase/middleware.ts`: validates session with `getUser()`, looks role up from `users`, confines `contractor` to `/vendor/*`, redirects others to their dashboard.

### 1.4 Portal navigation shell — WORKING (chrome only)
- `components/role-tab-bar.tsx` renders `VENDOR_TABS` (Portal | Compliance). Quick-action links in the portal navigate to `/vendor/invoices/new`, `/vendor/compliance`, `/vendor/onboarding`. The navigation works; the destinations are non-functional (see §3).

> That is the complete set of genuinely working contractor features. Everything data-bearing below is mock.

---

## 3. Category 2 — Exposed but Broken / Incomplete

Visible in the UI, but missing the backend logic / API / DB integration.

### 2.1 Submit New Invoice — NON-FUNCTIONAL (highest priority)
- **File:** `app/vendor/invoices/new/page.tsx`.
- **What's there:** complete form, client-side 10% holdback calculator (`totalAmountNum * 0.10`, ~line 47), PDF file picker.
- **What's broken:** `handleSubmit` (lines 80–125) is `await new Promise(r => setTimeout(r, 1500))` followed by a comment listing what it "would" do (upload PDF, create invoice + payment_request, trigger OCR). **No database write occurs.** The project dropdown is `mockProjects` (lines 22–28). The success toast and the notification call are cosmetic.
- **Impact:** This is the contractor's primary action. Today, invoices only enter the system when a PM manually keys them in (`createPMInvoice`). Contractor-submitted invoices are silently dropped.

### 2.2 Vendor Portal dashboard — STATIC / NON-FUNCTIONAL
- **File:** `app/vendor/portal/page.tsx`.
- **What's broken:** authenticates the user (real) but every metric is hardcoded JSX — "3" Pending, "12" Approved, "$45,280" Paid, "$12,750" Holdback (lines 41–76) — and the Compliance Status card shows hardcoded "Valid until Dec 2024 / On file / Verified" (lines 128–153). No query runs. ("Valid until Dec 2024" is already in the past, confirming it is static.)

### 2.3 Compliance & Lien Waivers — MOCK / NON-PERSISTING
- **File:** `app/vendor/compliance/page.tsx`.
- **What's broken:** the paid-invoice list is `mockPaidInvoices` (lines 30–78), rendered directly. The e-signature dialog is fully built, but `handleSign` (lines 95–108) only mutates local React state — it never writes to the `lien_waivers` table or calls any server action. The "View" button (lines 259–262) has no `onClick`. All stat cards derive from the mock array.

### 2.4 Contractor KYC Onboarding wizard — NON-PERSISTING
- **File:** `app/vendor/onboarding/page.tsx`.
- **What's there:** complete 3-step wizard — company profile + WCB info (step 1), banking + T5018 consent (step 2), WCB clearance upload (step 3).
- **What's broken:** `handleSubmit` (lines 148–160) instantiates a Supabase client and **never uses it** — `setTimeout(2000)` then a fake "Onboarding Complete" screen that promises a verification email which is never sent. The void-cheque file input (lines 570–596) and WCB-clearance file input (lines 638–664) are held in component state and **discarded** on submit. All profile, banking, WCB, and tax data is lost.

---

## 4. Category 3 — Backend Implemented but UI Hidden / Not Wired

Already built server-side (some with contractor permission), but no vendor page invokes them.

### 3.1 Full document-management backend — BUILT, UNUSED BY VENDOR UI
- **Files:** `lib/actions/invoice-documents.ts` (`createInvoiceDocument`, `getInvoiceDocuments`, `getCertificateDocuments`, `getPaymentDocuments`, `deleteInvoiceDocument`, `updateDocumentDescription` — all with uploader-ownership checks), `app/api/documents/upload/route.ts` (Blob upload + `invoice_documents` insert), `app/api/documents/[id]/route.ts` (download).
- **Status:** the contractor role holds `upload_invoice_attachment`, but none of the vendor file pickers (onboarding void cheque/WCB, invoice PDF) call the upload route or `createInvoiceDocument`. The capability exists and is reachable by permission; the UI never calls it.

### 3.2 `vendor_kyc_documents` table — BUILT, WRITE-PATH HIDDEN
- **File:** `scripts/001_enterprise_ap_schema.sql` (table + RLS allowing contractors to select/insert their own rows).
- **Status:** the onboarding wizard never writes here. It is only *read* on the internal side (`app/pm/actions.ts` → `getPMContractorById`), and the admin-facing KYC queue that surfaces it (`components/admin/kyc-verification-queue.tsx`) is itself mock data with non-persisting Verify/Reject buttons.

### 3.3 `lien_waivers` table — BUILT, UNUSED
- **File:** `scripts/001_enterprise_ap_schema.sql` (~lines 1066–1080). RLS: contractor may `select` own rows and `update` own rows while `NOT is_signed`.
- **Status:** no application code references this table; the compliance page's sign flow does not touch it.

### 3.4 Contractor data scoping (RLS) — BUILT, NOT QUERIED + HALF-WIRED
- **File:** `scripts/001_enterprise_ap_schema.sql` (~lines 1010–1100). Policies let a contractor read their own `invoices`, `payments`, and `holdback_ledgers` via `contractor_id = get_contractor_id(auth.uid())`.
- **Status:** no vendor page issues these queries, and because sign-up never sets `contractors.auth_user_id` (§1.1 defect), the predicate would not resolve even if the queries existed. Hidden *and* broken at the data layer.

### 3.5 Contractor payment notifications — BUILT, NEVER CALLED + DELIVERY STUBBED
- **File:** `lib/notifications.ts` (`notifyPaymentPaid` ~line 611, `notifyPaymentRegistered` ~line 587).
- **Status:** never invoked by any action. Delivery primitives `sendEmail` (lines 270–317) and `sendWhatsApp` (lines 323–371) do not call Resend/Twilio (the real API code is commented out and they return simulated success). No `RESEND_*`/`TWILIO_*` keys are configured.

### 3.6 Missing route: contractor invoice list
- There is no `/vendor/invoices` (list) route — only `/vendor/invoices/new`. The `invoices` data exists server-side; there is no UI surface for a contractor to see their own submitted/approved/paid invoices (the portal "stats" are static).

---

## 5. Cross-cutting defects affecting this portal

1. **Document download IDOR (security — fix before wiring uploads).** `app/api/documents/[id]/route.ts` authenticates the user, then loads the document by `id` using the **service-role client (`getSupabaseAdmin()`), bypassing RLS**, and streams it back with no ownership/permission check. Any authenticated user can enumerate IDs and download any other party's files. Must be fixed before contractor uploads are exposed.
2. **`contractors.auth_user_id` not set at sign-up.** Breaks all contractor-scoped RLS (§1.1, §3.4). This is the linchpin; nearly every contractor read feature depends on it.
3. **Notification delivery is a stub** (§3.5); any "notified" toast is cosmetic and no provider keys are set.
4. **Holdback computed client-side in floating point** on the vendor invoice form (`* 0.10`); server should recompute in integer cents (follow the `createPMInvoice` pattern, which uses `Math.round(total_cents * rate)`).

---

## 6. Prioritized remediation plan (task-by-task)

Each task is independently shippable. Reuse existing patterns: `app/pm/actions.ts:createPMInvoice` for invoice inserts, `lib/actions/invoice-documents.ts` + `app/api/documents/upload/route.ts` for files, `lib/supabase/admin.ts` for the canonical admin client.

### Task 1 — Fix the contractor↔auth link (unblocks everything)
- **File:** `app/auth/sign-up/actions.ts`.
- **Change:** set `auth_user_id: userId` on the `contractors` insert; capture the inserted contractor id; return a real error (don't swallow) if either insert fails. Backfill existing contractor rows that are missing the link.
- **Acceptance:** a newly signed-up contractor, once logged in, satisfies `get_contractor_id(auth.uid())`; a contractor-scoped `select` on `invoices` returns their rows under RLS.

### Task 2 — Make invoice submission real
- **File:** `app/vendor/invoices/new/page.tsx` + a new server action (e.g. `app/vendor/actions.ts` → `submitVendorInvoice`).
- **Change:** replace the `setTimeout` in `handleSubmit` with a server action that (a) resolves the caller's `contractor_id` server-side, (b) loads real projects (replace `mockProjects`), (c) inserts an `invoices` row with status `submitted` and **server-side integer-cents holdback** (mirror `createPMInvoice`), (d) uploads the PDF via the existing upload route / `createInvoiceDocument`, (e) writes an `audit_logs` entry.
- **Acceptance:** submitting creates an `invoices` row visible in the accountant queue and a linked `invoice_documents` record; no client-trusted money values are persisted without server recompute.

### Task 3 — Persist onboarding (profile + banking + KYC files)
- **File:** `app/vendor/onboarding/page.tsx` + server action.
- **Change:** on submit, update the caller's `contractors` row (company/contact/address/WCB/banking/T5018) and insert `vendor_kyc_documents` rows for the void cheque and WCB clearance (upload files first). Set `kyc_status` appropriately. Remove the fake success screen until the write succeeds.
- **Acceptance:** submitted data appears on the admin/PM contractor detail view; files are retrievable; nothing is discarded.

### Task 4 — Wire the portal & compliance pages to live data
- **Files:** `app/vendor/portal/page.tsx`, `app/vendor/compliance/page.tsx`.
- **Change:** replace hardcoded stats and `mockPaidInvoices` with real contractor-scoped queries (counts, paid total, holdback balance, compliance status from `contractors`/`vendor_kyc_documents`). Implement lien-waiver signing against the `lien_waivers` table (insert/update own row; respect the `NOT is_signed` RLS update rule). Add a contractor invoice-list route (`/vendor/invoices`) or section.
- **Acceptance:** numbers reflect the logged-in contractor's real records; signing a waiver persists and survives refresh.

### Task 5 — Fix the document-download IDOR (do before/with Task 2 & 3)
- **File:** `app/api/documents/[id]/route.ts`.
- **Change:** after loading the document, resolve its related invoice/contractor and verify the caller is an internal user or the owning contractor (mirror the RLS predicate), or perform the read through the session-scoped client so RLS applies. Add MIME/size validation on `app/api/documents/upload/route.ts`.
- **Acceptance:** a contractor can download only documents tied to their own records; cross-account access returns 403/404.

### Task 6 — Wire contractor notifications (optional, after delivery is configured)
- **Files:** payment actions in `app/accountant/actions.ts`; `lib/notifications.ts`.
- **Change:** call `notifyPaymentRegistered` / `notifyPaymentPaid` from the relevant payment actions; configure `RESEND_*` / `TWILIO_*` and un-stub `sendEmail`/`sendWhatsApp`.
- **Acceptance:** a real email/SMS is sent on payment events (verify in provider dashboard), not just a toast.

---

## 7. Quick reference — file inventory

```
app/vendor/portal/page.tsx              # dashboard — STATIC mock stats
app/vendor/invoices/new/page.tsx        # submit invoice — FAKE handleSubmit (setTimeout)
app/vendor/compliance/page.tsx          # lien waivers — mockPaidInvoices, no persistence
app/vendor/onboarding/page.tsx          # KYC wizard — FAKE handleSubmit, files discarded
app/auth/sign-up/actions.ts             # REAL signup; missing contractors.auth_user_id
lib/actions/invoice-documents.ts        # REAL doc CRUD — unused by vendor UI
app/api/documents/upload/route.ts       # REAL upload — unused by vendor UI; no MIME/size check
app/api/documents/[id]/route.ts         # download — IDOR (service-role, no ownership check)
app/pm/actions.ts (createPMInvoice)     # REAL invoice insert — use as the template for Task 2
lib/notifications.ts                    # notify* defined but uncalled; delivery stubbed
lib/supabase/middleware.ts              # role gating (contractor → /vendor/*)
components/role-tab-bar.tsx             # VENDOR_TABS: Portal | Compliance
scripts/001_enterprise_ap_schema.sql    # contractors / vendor_kyc_documents / lien_waivers + RLS
```

---

*No secret values are reproduced in this report. Line numbers reflect the reviewed version and may shift as the code changes; treat them as anchors, not absolutes.*
