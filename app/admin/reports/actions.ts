'use server'

import { createClient } from '@supabase/supabase-js'
import { 
  PERMISSIONS,
  withPermission,
} from '@/lib/permissions'
import {
  secureAction,
  RATE_LIMITS,
} from '@/lib/security/secureAction'

// Create admin client for server actions
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// =====================================================
// VIEW FINANCIAL REPORTS
// =====================================================

export interface ReportFilters {
  start_date?: string
  end_date?: string
  project_id?: string
  contractor_id?: string
}

/**
 * Get financial summary report
 * Requires: view_financial_reports permission
 */
export async function getFinancialSummary(filters?: ReportFilters) {
  return withPermission(PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS, async () => {
    const supabase = getSupabaseAdmin()
    
    // Get total invoices by status
    const { data: invoiceStats } = await supabase
      .from('invoices')
      .select('status, total_cents')
    
    // Get project budget summaries
    const { data: projectStats } = await supabase
      .from('projects')
      .select('id, name, original_budget_cents, current_budget_cents, spent_cents, committed_cents')
      .eq('is_active', true)
    
    // Get payment totals
    const { data: paymentStats } = await supabase
      .from('payment_batches')
      .select('total_amount_cents, executed_at')
      .eq('status', 'completed')
    
    // Calculate summaries
    const totalInvoiced = invoiceStats?.reduce((sum, inv) => sum + (inv.total_cents || 0), 0) || 0
    const totalPaid = paymentStats?.reduce((sum, batch) => sum + (batch.total_amount_cents || 0), 0) || 0
    const totalBudget = projectStats?.reduce((sum, proj) => sum + (proj.current_budget_cents || 0), 0) || 0
    const totalSpent = projectStats?.reduce((sum, proj) => sum + (proj.spent_cents || 0), 0) || 0
    
    const statusBreakdown = invoiceStats?.reduce((acc, inv) => {
      acc[inv.status] = (acc[inv.status] || 0) + (inv.total_cents || 0)
      return acc
    }, {} as Record<string, number>) || {}
    
    return { 
      success: true, 
      summary: {
        total_invoiced_cents: totalInvoiced,
        total_paid_cents: totalPaid,
        total_budget_cents: totalBudget,
        total_spent_cents: totalSpent,
        status_breakdown: statusBreakdown,
        project_count: projectStats?.length || 0,
      }
    }
  })
}

/**
 * Get payment history report
 * Requires: view_financial_reports permission
 */
export async function getPaymentReport(filters?: ReportFilters) {
  return withPermission(PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS, async () => {
    const supabase = getSupabaseAdmin()
    
    let query = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        amount_cents,
        net_amount_cents,
        holdback_amount_cents,
        status,
        paid_at,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number)
      `)
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
    
    if (filters?.start_date) {
      query = query.gte('paid_at', filters.start_date)
    }
    if (filters?.end_date) {
      query = query.lte('paid_at', filters.end_date)
    }
    if (filters?.project_id) {
      query = query.eq('project_id', filters.project_id)
    }
    if (filters?.contractor_id) {
      query = query.eq('contractor_id', filters.contractor_id)
    }
    
    const { data, error } = await query.limit(500)
    
    if (error) {
      console.error('Get payment report error:', error)
      return { success: false, error: error.message, payments: [] }
    }
    
    return { success: true, payments: data || [] }
  })
}

/**
 * Get holdbacks report
 * Requires: view_financial_reports permission
 */
export async function getHoldbacksReport(filters?: ReportFilters) {
  return withPermission(PERMISSIONS.REPORTING.VIEW_FINANCIAL_REPORTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('holdback_ledgers')
      .select(`
        *,
        invoice:invoices(invoice_number),
        contractor:contractors(company_name),
        project:projects(name, project_number)
      `)
      .order('created_at', { ascending: false })
      .limit(500)
    
    if (error) {
      console.error('Get holdbacks report error:', error)
      return { success: false, error: error.message, holdbacks: [] }
    }
    
    return { success: true, holdbacks: data || [] }
  })
}

// =====================================================
// EXPORT REPORTS
// =====================================================

export interface ExportOptions {
  format: 'csv' | 'xlsx' | 'pdf'
  report_type: 'financial_summary' | 'payments' | 'holdbacks' | 'invoices'
  filters?: ReportFilters
}

/**
 * Export report data
 * Requires: export_reports permission
 * Rate limited: 10 exports per minute
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting (prevent bulk data extraction)
 * - Security telemetry logging
 */
export const exportReport = secureAction(
  PERMISSIONS.REPORTING.EXPORT_REPORTS,
  async (user, options: ExportOptions) => {
    const supabase = getSupabaseAdmin()
    
    // Get user record for audit
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    // Generate report data based on type
    let reportData: unknown[] = []
    
    switch (options.report_type) {
      case 'payments': {
        const result = await getPaymentReport(options.filters)
        if (result.success) {
          reportData = result.payments || []
        }
        break
      }
      case 'holdbacks': {
        const result = await getHoldbacksReport(options.filters)
        if (result.success) {
          reportData = result.holdbacks || []
        }
        break
      }
      case 'invoices': {
        const { data } = await supabase
          .from('invoices')
          .select(`
            *,
            contractor:contractors(company_name),
            project:projects(name, project_number)
          `)
          .order('created_at', { ascending: false })
          .limit(1000)
        reportData = data || []
        break
      }
      case 'financial_summary':
      default: {
        const result = await getFinancialSummary(options.filters)
        if (result.success) {
          reportData = [result.summary]
        }
        break
      }
    }
    
    // Log the export action
    if (userData) {
      await supabase.from('audit_logs').insert({
        action: 'report_exported',
        entity_type: 'report',
        entity_id: `export-${Date.now()}`,
        user_id: userData.id,
        details: { 
          report_type: options.report_type,
          format: options.format,
          record_count: reportData.length,
          filters: options.filters,
        },
      })
    }
    
    // In a real implementation, this would generate the actual file
    // For now, return the data that would be exported
    return { 
      data: reportData,
      record_count: reportData.length,
      export_type: options.format,
    }
  },
  {
    actionName: 'exportReport',
    module: 'admin/reports',
    rateLimit: RATE_LIMITS.EXECUTE_EFT, // Limit exports to prevent data extraction
    isCritical: true,
  }
)

// =====================================================
// VIEW PAYMENT HISTORY
// =====================================================

/**
 * Get payment history for viewing
 * Requires: view_payment_history permission
 */
export async function getPaymentHistoryView(options?: { limit?: number; offset?: number }) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        amount_cents,
        net_amount_cents,
        holdback_amount_cents,
        status,
        paid_at,
        created_at,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number)
      `)
      .in('status', ['paid', 'payment_processing'])
      .order('paid_at', { ascending: false, nullsFirst: false })
      .limit(options?.limit || 100)
    
    if (error) {
      console.error('Get payment history error:', error)
      return { success: false, error: error.message, payments: [] }
    }
    
    return { success: true, payments: data || [] }
  })
}
