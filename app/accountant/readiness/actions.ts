'use server'

/**
 * Payment Readiness Server Actions
 *
 * Public API consumed by UI components. Combines:
 *  1. Data fetching via readiness-checks.ts
 *  2. Pure evaluation via readiness-engine.ts (evaluateReadiness)
 *
 * Returns fully-structured ReadinessReport objects, ready to render.
 */

import { buildReadinessInput } from '@/lib/payments/readiness-checks'
import { evaluateReadiness, type ReadinessReport } from '@/lib/payments/readiness-engine'
import { createClient } from '@/lib/supabase/server'

// ============================================
// SINGLE INVOICE READINESS
// ============================================

export type GetInvoiceReadinessResult =
  | { success: true; report: ReadinessReport }
  | { success: false; error: string }

/**
 * Get the full readiness report for a single invoice.
 * Used by the invoice detail page panel and direct invoice row expansions.
 */
export async function getInvoiceReadinessReport(
  invoiceId: string
): Promise<GetInvoiceReadinessResult> {
  try {
    const inputOrError = await buildReadinessInput(invoiceId)

    if ('error' in inputOrError) {
      return { success: false, error: inputOrError.error }
    }

    const report = evaluateReadiness(inputOrError)
    return { success: true, report }
  } catch (err) {
    console.error('[ReadinessEngine] getInvoiceReadinessReport error:', err)
    return {
      success: false,
      error: 'An unexpected error occurred while evaluating payment readiness.',
    }
  }
}

// ============================================
// BATCH READINESS — for the payments list page
// ============================================

export type BatchReadinessResult =
  | {
      success: true
      reports: Record<string, ReadinessReport>
      summary: { total: number; ready: number; warnings: number; blocked: number }
    }
  | { success: false; error: string }

/**
 * Get readiness reports for multiple invoices at once.
 * Used by the Payments page to display readiness badges for all rows
 * without requiring separate fetches per invoice.
 *
 * Runs all invoice evaluations in parallel for performance.
 * Individual invoice failures do not abort the batch.
 */
export async function getBatchInvoiceReadiness(
  invoiceIds: string[]
): Promise<BatchReadinessResult> {
  if (invoiceIds.length === 0) {
    return {
      success: true,
      reports: {},
      summary: { total: 0, ready: 0, warnings: 0, blocked: 0 },
    }
  }

  try {
    const results = await Promise.allSettled(
      invoiceIds.map(id => buildReadinessInput(id))
    )

    const reports: Record<string, ReadinessReport> = {}
    let ready = 0
    let warnings = 0
    let blocked = 0

    for (let i = 0; i < invoiceIds.length; i++) {
      const id = invoiceIds[i]
      const result = results[i]

      if (result.status === 'rejected' || 'error' in result.value) {
        // If a single invoice fails, generate a minimal fallback report
        // so the UI doesn't break. Log the error for debugging.
        console.error(`[ReadinessEngine] Failed to evaluate invoice ${id}:`, result)
        continue
      }

      const report = evaluateReadiness(result.value)
      reports[id] = report

      if (report.status === 'READY') ready++
      else if (report.status === 'WARNING') warnings++
      else blocked++
    }

    return {
      success: true,
      reports,
      summary: {
        total: Object.keys(reports).length,
        ready,
        warnings,
        blocked,
      },
    }
  } catch (err) {
    console.error('[ReadinessEngine] getBatchInvoiceReadiness error:', err)
    return {
      success: false,
      error: 'An unexpected error occurred while evaluating payment readiness.',
    }
  }
}

// ============================================
// QUEUE READINESS SUMMARY
// Returns lightweight readiness data for the AP Queue page row badges.
// Only pulls status, score, summaryLabel, and blocker count — no full report.
// ============================================

export interface QueueReadinessSummary {
  invoiceId: string
  status: ReadinessReport['status']
  score: number
  summaryLabel: string
  blockerCount: number
  warningCount: number
}

export type GetQueueReadinessResult =
  | { success: true; summaries: Record<string, QueueReadinessSummary> }
  | { success: false; error: string }

/**
 * Lightweight batch readiness for the AP Queue page.
 * Returns only the fields needed for row-level badges.
 * Used in the queue instead of the full batch report to keep payload small.
 */
export async function getQueueReadinessSummaries(
  invoiceIds: string[]
): Promise<GetQueueReadinessResult> {
  const batchResult = await getBatchInvoiceReadiness(invoiceIds)

  if (!batchResult.success) {
    return { success: false, error: batchResult.error }
  }

  const summaries: Record<string, QueueReadinessSummary> = {}
  for (const [id, report] of Object.entries(batchResult.reports)) {
    summaries[id] = {
      invoiceId: id,
      status: report.status,
      score: report.score,
      summaryLabel: report.summaryLabel,
      blockerCount: report.blockers.length,
      warningCount: report.warnings.length,
    }
  }

  return { success: true, summaries }
}

// ============================================
// READINESS STATS — for the Accountant dashboard summary cards
// Returns aggregate readiness counts across all approved invoices
// ============================================

export type ReadinessStatsResult =
  | {
      success: true
      stats: {
        totalApproved: number
        fullyReady: number
        hasWarnings: number
        hardBlocked: number
        bankingBlockedCount: number
        complianceBlockedCount: number
      }
    }
  | { success: false; error: string }

/**
 * Aggregate readiness stats for the Accountant portal dashboard.
 * Used to power the "X invoices blocked" summary cards.
 */
export async function getReadinessStats(): Promise<ReadinessStatsResult> {
  try {
    const supabase = await createClient()

    // Get IDs of all currently-approved invoices
    const { data: approvedInvoices, error } = await supabase
      .from('invoices')
      .select('id')
      .in('status', ['approved', 'payment_initiated', 'partially_paid'])

    if (error || !approvedInvoices) {
      return { success: false, error: 'Failed to load approved invoices.' }
    }

    if (approvedInvoices.length === 0) {
      return {
        success: true,
        stats: {
          totalApproved: 0,
          fullyReady: 0,
          hasWarnings: 0,
          hardBlocked: 0,
          bankingBlockedCount: 0,
          complianceBlockedCount: 0,
        },
      }
    }

    const ids = approvedInvoices.map(i => i.id)
    const batchResult = await getBatchInvoiceReadiness(ids)

    if (!batchResult.success) {
      return { success: false, error: batchResult.error }
    }

    let bankingBlockedCount = 0
    let complianceBlockedCount = 0

    for (const report of Object.values(batchResult.reports)) {
      const hasBankingBlocker = report.blockers.some(b => b.domain === 'banking')
      const hasComplianceBlocker = report.blockers.some(b => b.domain === 'compliance')
      if (hasBankingBlocker) bankingBlockedCount++
      if (hasComplianceBlocker) complianceBlockedCount++
    }

    return {
      success: true,
      stats: {
        totalApproved: ids.length,
        fullyReady: batchResult.summary.ready,
        hasWarnings: batchResult.summary.warnings,
        hardBlocked: batchResult.summary.blocked,
        bankingBlockedCount,
        complianceBlockedCount,
      },
    }
  } catch (err) {
    console.error('[ReadinessEngine] getReadinessStats error:', err)
    return { success: false, error: 'Failed to compute readiness stats.' }
  }
}
