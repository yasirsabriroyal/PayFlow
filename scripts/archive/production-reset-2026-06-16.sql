-- =============================================================================
-- PayFlow PRODUCTION RESET SCRIPT  ***  ALREADY EXECUTED — DO NOT RUN AGAIN  ***
-- =============================================================================
-- Executed: 2026-06-16
-- Status:   COMPLETED. This file is retained for DOCUMENTATION ONLY.
--
-- !! DO NOT RUN AGAIN WITHOUT EXPLICIT APPROVAL !!
--   Re-running would delete current operational data. A hard guard at the top
--   of this file (the DO $$ ... RAISE EXCEPTION block below) intentionally
--   aborts execution so it cannot be run accidentally. Removing that guard
--   requires deliberate, approved action.
--
-- WHAT THIS SCRIPT DOES (when the guard is removed):
--   Deletes projects, contractors, invoices, payments, payment runs, and all
--   related operational data (assignments, attachments, documents, comments,
--   communication history, flags, alerts, invitations, KYC docs) plus the
--   contractor user accounts.
--
-- WHAT IT PRESERVES:
--   Staff users (admin / accountant / project_manager) and their logins,
--   roles & permissions, project roles, company/tenant settings, system
--   settings, branding, email templates, communication/notification settings,
--   tax rates, report templates, AUDIT LOGS, and SECURITY EVENTS.
--
-- SCHEMA SIDE EFFECT (intended):
--   notifications.invoice_id is ON DELETE CASCADE, so deleting invoices also
--   removed the notifications tied to those invoices. Notifications linked only
--   to projects/payments were SET NULL and retained.
--
-- SAFETY NOTES (as executed):
--   * Ran inside a single transaction (atomic — all or nothing).
--   * Scoped DELETEs only. NO TRUNCATE, NO DROP, NO schema changes.
--   * Deletion order respects every RESTRICT / NO ACTION foreign key.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RUN GUARD — aborts immediately if this file is executed.
-- This is why the script "cannot be accidentally run". Do not remove unless a
-- repeat reset has been explicitly approved.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE EXCEPTION
    'production-reset is already executed (2026-06-16) and is archived for documentation only. Remove this guard block ONLY with explicit approval before re-running.';
END $$;

-- =============================================================================
-- BELOW: the exact statements that were executed on 2026-06-16.
-- (Unreachable while the guard above is in place.)
-- =============================================================================

BEGIN;

-- PHASE 1 — invoice children & invoice-related flags
DELETE FROM invoice_message_attachments;
DELETE FROM invoice_messages;
DELETE FROM invoice_status_history;
DELETE FROM invoice_attachments;
DELETE FROM invoice_documents;
DELETE FROM anomaly_flags;
DELETE FROM approvals;
DELETE FROM disputes;
DELETE FROM holdback_ledgers;
DELETE FROM lien_waivers;
DELETE FROM compliance_expiry_alerts;
DELETE FROM banking_change_requests;
DELETE FROM budget_thresholds;

-- PHASE 2 — payments chain (children before parents; payment_certificates is RESTRICT)
DELETE FROM payments;
DELETE FROM payment_certificates;
DELETE FROM payment_requests;
DELETE FROM payment_batches;

-- PHASE 3 — invoices then change orders (invoices.change_order_id -> change_orders NO ACTION)
DELETE FROM invoices;
DELETE FROM change_orders;

-- PHASE 4 — join tables, invitations, KYC docs
DELETE FROM project_contractors;
DELETE FROM project_assignments;
DELETE FROM contractor_invitations;
DELETE FROM vendor_kyc_documents;

-- PHASE 5 — core operational entities
DELETE FROM projects;
DELETE FROM contractors;

-- PHASE 6 — contractor user accounts (app rows + auth logins)
DELETE FROM auth.users WHERE id IN (
  SELECT auth_user_id FROM users WHERE role = 'contractor' AND auth_user_id IS NOT NULL
);
DELETE FROM users WHERE role = 'contractor';

-- NOTE: audit_logs and security_events were PRESERVED (not deleted) per approval.
-- NOTE: invoice-linked notifications were removed automatically via ON DELETE CASCADE.

COMMIT;
