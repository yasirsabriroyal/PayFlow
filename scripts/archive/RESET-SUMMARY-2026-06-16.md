# Production Reset — 2026-06-16

This document records the one-time production data reset performed on **2026-06-16**
to prepare PayFlow for real production use. The executed SQL is archived at
[`scripts/archive/production-reset-2026-06-16.sql`](./production-reset-2026-06-16.sql)
for documentation only and is guarded so it cannot be run again accidentally.

## What was deleted

All operational / test data and its FK-dependent records:

- Projects
- Contractors (vendors)
- Invoices
- Payments, payment certificates, payment requests, payment batches (payment runs)
- Invoice documents, attachments, status history, messages, message attachments
- Anomaly flags, approvals, disputes, holdback ledgers, lien waivers
- Compliance expiry alerts, banking change requests, budget thresholds
- Change orders
- Project–contractor links, project assignments, contractor invitations
- Vendor KYC documents
- The 2 contractor-role user accounts **and** their `auth.users` logins

## What was preserved

All system accounts and application configuration:

- Staff users: admin, accountants, project manager (4 total) and their logins
- User roles & permissions (`role_permissions`, `project_roles`, `project_role_permissions`)
- Company / tenant settings (`company_settings`, `organizations`)
- System settings, branding, email templates
- Communication & notification settings
- Canadian tax rates, report templates
- **Audit logs** — retained (not reset)
- **Security events** — retained

## Schema side effect (intended)

`notifications.invoice_id` is defined as `ON DELETE CASCADE`. As a result,
deleting invoices automatically deleted the notifications tied to those
invoices. Notifications linked only to projects or payments had their
references set to `NULL` and were retained. No application or migration change
was made — this is the database's existing foreign-key behavior.

## Confirmation

- Executed as a single atomic transaction (all-or-nothing).
- Scoped `DELETE`s only — no `TRUNCATE`, no `DROP`, no schema changes.
- Post-run verification confirmed all cleared tables returned `0` rows.
- Staff accounts (1 admin, 2 accountants, 1 PM) and all system configuration
  remained intact and verified after completion.

## Re-running

Do **not** re-run the archived script. It begins with a `DO $$ ... RAISE
EXCEPTION ... $$;` guard block that aborts execution immediately. Removing that
guard requires explicit, deliberate approval.
