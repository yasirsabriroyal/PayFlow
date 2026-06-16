-- =============================================================================
-- PayFlow Production Reset Script
-- =============================================================================
-- PURPOSE: Remove all test/demo operational data while preserving system
--          accounts, roles, permissions, and all application configuration.
--
-- STATUS:  PREPARED FOR REVIEW. Do NOT run until backups are confirmed.
--
-- SAFETY:
--   * Runs inside a single transaction. Any error aborts the WHOLE reset
--     with zero partial deletion (automatic ROLLBACK).
--   * Uses scoped DELETEs only -- NO TRUNCATE, NO DROP, NO schema changes.
--   * Deletion order respects every RESTRICT / NO ACTION foreign key.
--   * Ends with COMMIT. To do a dry run, change the final COMMIT to ROLLBACK.
--
-- DECISIONS (approved):
--   * audit_logs        -> RESET (cleared)
--   * team_invitations  -> CLEARED
--   * contractor users  -> REMOVED (public.users rows; auth.users handled separately)
--
-- PRESERVED (never touched by this script):
--   users (admin/accountant/PM), role_permissions, project_roles,
--   project_role_permissions, system_settings, company_settings,
--   organizations, email_templates, canadian_tax_rates, report_templates
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Pre-flight snapshot (informational; appears in query output)
-- -----------------------------------------------------------------------------
SELECT 'BEFORE' AS phase,
  (SELECT count(*) FROM invoices)   AS invoices,
  (SELECT count(*) FROM payments)   AS payments,
  (SELECT count(*) FROM projects)   AS projects,
  (SELECT count(*) FROM contractors) AS contractors,
  (SELECT count(*) FROM users)      AS users_total,
  (SELECT count(*) FROM users WHERE role <> 'contractor') AS users_to_keep;

-- =============================================================================
-- PHASE 1 — Invoice children, flags, alerts, notifications
-- (all reference invoices / payments / contractors / projects / payment_requests)
-- =============================================================================
DELETE FROM invoice_message_attachments;   -- CASCADE child of invoice_messages/invoices
DELETE FROM invoice_messages;               -- communication history
DELETE FROM invoice_status_history;         -- CASCADE child of invoices
DELETE FROM invoice_attachments;            -- CASCADE child of invoices
DELETE FROM invoice_documents;              -- CASCADE child of invoices/payments/payment_certificates
DELETE FROM anomaly_flags;                  -- NO ACTION refs to invoices/contractors/payment_requests
DELETE FROM disputes;                       -- NO ACTION refs to approvals/contractors/payment_requests
DELETE FROM approvals;                      -- CASCADE child of payment_requests
DELETE FROM holdback_ledgers;               -- NO ACTION refs to invoices/contractors/projects/payment_requests
DELETE FROM lien_waivers;                   -- NO ACTION refs to contractors/projects/payment_requests
DELETE FROM compliance_expiry_alerts;       -- CASCADE child of contractors/vendor_kyc_documents
DELETE FROM banking_change_requests;        -- CASCADE child of contractors
DELETE FROM budget_thresholds;              -- CASCADE child of projects
DELETE FROM notifications;                  -- references invoices/payments/projects/users
DELETE FROM notification_logs;              -- SET NULL refs; cleared as test telemetry

-- =============================================================================
-- PHASE 2 — Payments chain
-- payments -> payment_certificates (RESTRICT) -> payment_requests -> payment_batches
-- =============================================================================
DELETE FROM payments;                       -- NO ACTION refs to payment_certificates/payment_requests/contractors
DELETE FROM payment_certificates;           -- RESTRICT refs to invoices/projects/contractors (must precede them)
DELETE FROM payment_requests;               -- NO ACTION refs to invoices/projects/contractors
DELETE FROM payment_batches;                -- independent (only refs users)

-- =============================================================================
-- PHASE 3 — Invoices, then change orders
-- invoices.change_order_id -> change_orders [NO ACTION] => invoices first
-- =============================================================================
DELETE FROM invoices;                       -- NO ACTION refs to contractors/projects/change_orders
DELETE FROM change_orders;                  -- CASCADE child of projects; NO ACTION ref to contractors

-- =============================================================================
-- PHASE 4 — Join tables, invitations, KYC docs
-- =============================================================================
DELETE FROM project_contractors;            -- CASCADE children of projects/contractors
DELETE FROM project_assignments;            -- CASCADE child of projects/users (project-team grants)
DELETE FROM contractor_invitations;         -- CASCADE child of contractors
DELETE FROM vendor_kyc_documents;           -- CASCADE child of contractors

-- =============================================================================
-- PHASE 5 — Core operational entities
-- =============================================================================
DELETE FROM projects;                       -- now free of all referencing rows
DELETE FROM contractors;                    -- now free of all referencing rows

-- =============================================================================
-- PHASE 6 — Contractor user accounts (public side)
-- auth.users for these is removed via the Admin API in the same maintenance window
-- =============================================================================
DELETE FROM users WHERE role = 'contractor';

-- =============================================================================
-- PHASE 7 — Logs / invitations reset (approved decisions)
-- =============================================================================
DELETE FROM audit_logs;                     -- decision: RESET
DELETE FROM security_events;                -- test RBAC/login telemetry
DELETE FROM team_invitations;               -- decision: CLEAR
DELETE FROM quickbooks_sync_logs;           -- empty, but cleared for completeness

-- =============================================================================
-- POST-CHECK — every cleared table must be 0; preserved tables unchanged
-- =============================================================================
SELECT 'AFTER_cleared' AS phase, json_build_object(
  'invoices',            (SELECT count(*) FROM invoices),
  'payments',            (SELECT count(*) FROM payments),
  'payment_certificates',(SELECT count(*) FROM payment_certificates),
  'payment_requests',    (SELECT count(*) FROM payment_requests),
  'payment_batches',     (SELECT count(*) FROM payment_batches),
  'projects',            (SELECT count(*) FROM projects),
  'contractors',         (SELECT count(*) FROM contractors),
  'project_contractors', (SELECT count(*) FROM project_contractors),
  'project_assignments', (SELECT count(*) FROM project_assignments),
  'contractor_invitations',(SELECT count(*) FROM contractor_invitations),
  'invoice_documents',   (SELECT count(*) FROM invoice_documents),
  'invoice_messages',    (SELECT count(*) FROM invoice_messages),
  'notifications',       (SELECT count(*) FROM notifications),
  'notification_logs',   (SELECT count(*) FROM notification_logs),
  'audit_logs',          (SELECT count(*) FROM audit_logs),
  'security_events',     (SELECT count(*) FROM security_events),
  'team_invitations',    (SELECT count(*) FROM team_invitations),
  'lien_waivers',        (SELECT count(*) FROM lien_waivers),
  'vendor_kyc_documents',(SELECT count(*) FROM vendor_kyc_documents)
) AS cleared_counts_should_all_be_zero;

SELECT 'AFTER_preserved' AS phase, json_build_object(
  'users_remaining',          (SELECT count(*) FROM users),
  'admins',                   (SELECT count(*) FROM users WHERE role='admin'),
  'accountants',              (SELECT count(*) FROM users WHERE role='accountant'),
  'project_managers',         (SELECT count(*) FROM users WHERE role='project_manager'),
  'contractors_remaining',    (SELECT count(*) FROM users WHERE role='contractor'),
  'role_permissions',         (SELECT count(*) FROM role_permissions),
  'project_roles',            (SELECT count(*) FROM project_roles),
  'project_role_permissions', (SELECT count(*) FROM project_role_permissions),
  'system_settings',          (SELECT count(*) FROM system_settings),
  'company_settings',         (SELECT count(*) FROM company_settings),
  'organizations',            (SELECT count(*) FROM organizations),
  'email_templates',          (SELECT count(*) FROM email_templates),
  'canadian_tax_rates',       (SELECT count(*) FROM canadian_tax_rates),
  'report_templates',         (SELECT count(*) FROM report_templates)
) AS preserved_counts;

-- =============================================================================
-- COMMIT to apply. Change to ROLLBACK to perform a safe DRY RUN first.
-- =============================================================================
COMMIT;
-- ROLLBACK;
