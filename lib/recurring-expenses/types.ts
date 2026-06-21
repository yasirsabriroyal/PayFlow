/**
 * Recurring Expenses & Expense Templates — Shared Types
 *
 * These types mirror the database schema exactly. No 'use server' — safe to
 * import from both server actions and client components.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type ExpenseType = 'operational' | 'project'
export type TaxTreatment = 'gst' | 'pst' | 'both' | 'exempt'
export type ApprovalRoute = 'standard' | 'admin_only' | 'accountant_only'
export type TemplateStatus = 'active' | 'inactive' | 'archived'
export type ScheduleFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annual'
  | 'annual'
export type GenerationStatus = 'generated' | 'skipped' | 'failed'
export type GenerationTrigger = 'cron' | 'manual'
export type VendorType = 'contractor' | 'supplier' | 'both'

// ─── Display helpers ─────────────────────────────────────────────────────────

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  operational: 'Operational',
  project: 'Project',
}

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  gst: 'GST (5%)',
  pst: 'PST',
  both: 'GST + PST',
  exempt: 'Tax Exempt',
}

export const APPROVAL_ROUTE_LABELS: Record<ApprovalRoute, string> = {
  standard: 'Standard (PM → Accountant)',
  admin_only: 'Admin Only',
  accountant_only: 'Accountant Only',
}

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
}

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-Annual',
  annual: 'Annual',
}

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  contractor: 'Contractor',
  supplier: 'Supplier',
  both: 'Contractor & Supplier',
}

// ─── Core database rows ───────────────────────────────────────────────────────

export interface ExpenseTemplate {
  id: string
  organization_id: string
  name: string
  description: string | null
  notes: string | null
  contractor_id: string | null
  vendor_name_override: string | null
  category_id: string | null
  subcategory_id: string | null
  expense_type: ExpenseType
  project_id: string | null
  default_amount_cents: number
  tax_treatment: TaxTreatment
  currency: string
  cost_code: string | null
  qb_account_id: string | null
  qb_class_id: string | null
  qb_item_id: string | null
  qb_memo_template: string | null
  approval_route: ApprovalRoute
  status: TemplateStatus
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface ExpenseTemplateSchedule {
  id: string
  organization_id: string
  template_id: string
  frequency: ScheduleFrequency
  day_of_month: number | null
  day_of_week: number | null
  start_date: string
  end_date: string | null
  is_active: boolean
  paused_at: string | null
  paused_reason: string | null
  resumed_at: string | null
  next_generation_date: string | null
  last_generated_at: string | null
  last_invoice_id: string | null
  total_generated: number
  created_at: string
  updated_at: string
}

export interface RecurringGenerationLog {
  id: string
  organization_id: string
  template_id: string
  schedule_id: string
  period_key: string
  status: GenerationStatus
  invoice_id: string | null
  skip_reason: string | null
  error_message: string | null
  error_detail: Record<string, unknown> | null
  triggered_by: GenerationTrigger
  triggered_user_id: string | null
  generated_at: string
}

// ─── Enriched join types (used by UI) ────────────────────────────────────────

export interface ExpenseTemplateWithDetails extends ExpenseTemplate {
  vendor_name: string | null      // company_name from contractors join
  vendor_email: string | null
  vendor_type: VendorType | null
  category_name: string | null
  subcategory_name: string | null
  project_name: string | null
  schedule: ExpenseTemplateSchedule | null
  generated_this_month: number
  total_generated: number
  last_invoice_number: string | null
}

export interface TemplateDashboardStats {
  active_templates: number
  generated_this_month: number
  generated_this_month_cents: number
  paused_templates: number
  awaiting_approval: number
  failed_this_month: number
}

export interface UpcomingGeneration {
  template_id: string
  template_name: string
  vendor_name: string | null
  frequency: ScheduleFrequency
  next_generation_date: string
  default_amount_cents: number
  currency: string
}

// ─── Input types for server actions ──────────────────────────────────────────

export interface CreateExpenseTemplateInput {
  name: string
  description?: string | null
  notes?: string | null
  contractor_id?: string | null
  vendor_name_override?: string | null
  category_id?: string | null
  subcategory_id?: string | null
  expense_type: ExpenseType
  project_id?: string | null
  default_amount_cents: number
  tax_treatment: TaxTreatment
  cost_code?: string | null
  approval_route: ApprovalRoute
}

export interface UpdateExpenseTemplateInput extends Partial<CreateExpenseTemplateInput> {
  status?: TemplateStatus
}

export interface CreateScheduleInput {
  template_id: string
  frequency: ScheduleFrequency
  start_date: string
  end_date?: string | null
  day_of_month?: number | null
  day_of_week?: number | null
}

export interface UpdateScheduleInput {
  frequency?: ScheduleFrequency
  start_date?: string
  end_date?: string | null
  day_of_month?: number | null
  day_of_week?: number | null
  is_active?: boolean
  paused_reason?: string | null
}

export interface ActionResult<T = void> {
  success: boolean
  data?: T
  error?: string
}
