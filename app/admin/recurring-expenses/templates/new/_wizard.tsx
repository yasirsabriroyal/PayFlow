'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2,
  DollarSign,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { createExpenseTemplate, upsertSchedule } from '@/lib/recurring-expenses/actions'
import { previewNextDates } from '@/lib/recurring-expenses/schedule-utils'
import {
  EXPENSE_TYPE_LABELS,
  TAX_TREATMENT_LABELS,
  APPROVAL_ROUTE_LABELS,
  FREQUENCY_LABELS,
  type ExpenseType,
  type TaxTreatment,
  type ApprovalRoute,
  type ScheduleFrequency,
} from '@/lib/recurring-expenses/types'

interface Props {
  vendors: { id: string; company_name: string; vendor_type: string; email: string | null }[]
  categories: { id: string; name: string }[]
  projects: { id: string; name: string; project_number: string }[]
}

const STEPS = [
  { id: 1, label: 'Template Details', icon: Building2 },
  { id: 2, label: 'Financials', icon: DollarSign },
  { id: 3, label: 'Schedule', icon: CalendarDays },
]

type FormData = {
  // Step 1
  name: string
  description: string
  notes: string
  contractor_id: string
  vendor_name_override: string
  category_id: string
  expense_type: ExpenseType
  project_id: string
  // Step 2
  default_amount: string
  tax_treatment: TaxTreatment
  cost_code: string
  approval_route: ApprovalRoute
  // Step 3
  enable_schedule: boolean
  frequency: ScheduleFrequency
  start_date: string
  end_date: string
  no_end_date: boolean
  day_of_month: string
  day_of_week: string
}

const defaultForm: FormData = {
  name: '',
  description: '',
  notes: '',
  contractor_id: '',
  vendor_name_override: '',
  category_id: '',
  expense_type: 'operational',
  project_id: '',
  default_amount: '',
  tax_treatment: 'gst',
  cost_code: '',
  approval_route: 'standard',
  enable_schedule: true,
  frequency: 'monthly',
  start_date: new Date().toISOString().split('T')[0],
  end_date: '',
  no_end_date: true,
  day_of_month: '1',
  day_of_week: '1',
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, idx) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              step.id === current
                ? 'bg-primary text-primary-foreground'
                : step.id < current
                ? 'bg-success text-success-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {step.id < current ? <CheckCircle2 className="w-4 h-4" /> : step.id}
          </div>
          <span
            className={`text-sm hidden sm:block ${
              step.id === current ? 'font-medium' : 'text-muted-foreground'
            }`}
          >
            {step.label}
          </span>
          {idx < STEPS.length - 1 && (
            <ChevronRight className="w-4 h-4 text-muted-foreground mx-1 hidden sm:block" />
          )}
        </div>
      ))}
    </div>
  )
}

export function NewTemplateWizard({ vendors, categories, projects }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(defaultForm)
  const [isPending, startTransition] = useTransition()

  const set = (field: keyof FormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const isMonthly = ['monthly', 'quarterly', 'semi_annual', 'annual'].includes(form.frequency)
  const isWeekly = ['weekly', 'biweekly'].includes(form.frequency)

  const previewDates =
    form.enable_schedule && form.start_date
      ? previewNextDates(
          form.frequency,
          new Date(form.start_date),
          3,
          parseInt(form.day_of_month) || 1,
          parseInt(form.day_of_week) || 1,
        )
      : []

  const handleSubmit = () => {
    startTransition(async () => {
      const amountCents = Math.round(parseFloat(form.default_amount) * 100)
      if (isNaN(amountCents) || amountCents <= 0) {
        toast({ title: 'Invalid amount', description: 'Enter a valid positive amount.', variant: 'destructive' })
        return
      }

      const templateResult = await createExpenseTemplate({
        name: form.name.trim(),
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        contractor_id: form.contractor_id || null,
        vendor_name_override: form.vendor_name_override.trim() || null,
        category_id: form.category_id || null,
        expense_type: form.expense_type,
        project_id: form.project_id || null,
        default_amount_cents: amountCents,
        tax_treatment: form.tax_treatment,
        cost_code: form.cost_code.trim() || null,
        approval_route: form.approval_route,
      })

      if (!templateResult.success || !templateResult.data) {
        toast({ title: 'Error', description: templateResult.error, variant: 'destructive' })
        return
      }

      const templateId = templateResult.data.id

      if (form.enable_schedule) {
        const scheduleResult = await upsertSchedule({
          template_id: templateId,
          frequency: form.frequency,
          start_date: form.start_date,
          end_date: form.no_end_date ? null : form.end_date || null,
          day_of_month: isMonthly ? parseInt(form.day_of_month) || 1 : null,
          day_of_week: isWeekly ? parseInt(form.day_of_week) || 1 : null,
        })

        if (!scheduleResult.success) {
          toast({
            title: 'Template saved, schedule error',
            description: scheduleResult.error,
            variant: 'destructive',
          })
          router.push(`/admin/recurring-expenses/templates/${templateId}`)
          return
        }
      }

      toast({
        title: 'Template created',
        description: form.enable_schedule
          ? 'Template and schedule are active.'
          : 'Template saved. Add a schedule later.',
      })
      router.push(`/admin/recurring-expenses/templates/${templateId}`)
    })
  }

  const canProceedStep1 = form.name.trim().length > 0
  const canProceedStep2 = parseFloat(form.default_amount) > 0
  const canProceedStep3 = !form.enable_schedule || (form.start_date.length > 0)

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="bg-card border border-border rounded-xl px-6 py-4">
        <StepIndicator current={step} total={3} />
      </div>

      {/* Step 1: Template Details */}
      {step === 1 && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-semibold">Template Details</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Name the template and assign a vendor and category
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Template Name <span className="text-destructive">*</span></Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Office Rent – 100 Queen St"
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional notes visible on generated invoices"
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Expense Type</Label>
              <Select value={form.expense_type} onValueChange={(v) => set('expense_type', v)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(EXPENSE_TYPE_LABELS) as [ExpenseType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={(v) => set('category_id', v)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.expense_type === 'project' && (
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={form.project_id} onValueChange={(v) => set('project_id', v)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((proj) => (
                    <SelectItem key={proj.id} value={proj.id}>
                      {proj.project_number} — {proj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Vendor</Label>
            <Select value={form.contractor_id} onValueChange={(v) => set('contractor_id', v)}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select vendor (optional)" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.company_name}
                    {v.vendor_type === 'supplier' && ' (Supplier)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!form.contractor_id && (
            <div className="space-y-2">
              <Label htmlFor="vendor_name_override">Vendor Name Override</Label>
              <Input
                id="vendor_name_override"
                value={form.vendor_name_override}
                onChange={(e) => set('vendor_name_override', e.target.value)}
                placeholder="Enter vendor name if not in directory"
                className="h-11"
              />
            </div>
          )}
        </div>
      )}

      {/* Step 2: Financials */}
      {step === 2 && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-semibold">Financials</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Set the recurring amount, tax treatment, and approval routing
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Default Amount (CAD) <span className="text-destructive">*</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.default_amount}
                  onChange={(e) => set('default_amount', e.target.value)}
                  placeholder="0.00"
                  className="h-11 pl-7"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tax Treatment</Label>
              <Select value={form.tax_treatment} onValueChange={(v) => set('tax_treatment', v as TaxTreatment)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TAX_TREATMENT_LABELS) as [TaxTreatment, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cost_code">Cost Code</Label>
              <Input
                id="cost_code"
                value={form.cost_code}
                onChange={(e) => set('cost_code', e.target.value)}
                placeholder="e.g. OPS-RENT-001"
                className="h-11 font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label>Approval Route</Label>
              <Select value={form.approval_route} onValueChange={(v) => set('approval_route', v as ApprovalRoute)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(APPROVAL_ROUTE_LABELS) as [ApprovalRoute, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Internal Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Internal notes for this template (not shown on invoice)"
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Amount preview */}
          {form.default_amount && parseFloat(form.default_amount) > 0 && (
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1.5">
              <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-2">Invoice Preview</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${parseFloat(form.default_amount).toFixed(2)}</span>
              </div>
              {(form.tax_treatment === 'gst' || form.tax_treatment === 'both') && (
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>GST (5%)</span>
                  <span>+${(parseFloat(form.default_amount) * 0.05).toFixed(2)}</span>
                </div>
              )}
              {(form.tax_treatment === 'pst' || form.tax_treatment === 'both') && (
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>PST (7%)</span>
                  <span>+${(parseFloat(form.default_amount) * 0.07).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold pt-1 border-t border-border">
                <span>Total per Invoice</span>
                <span>
                  ${(
                    parseFloat(form.default_amount) *
                    (1 +
                      (form.tax_treatment === 'gst' || form.tax_treatment === 'both' ? 0.05 : 0) +
                      (form.tax_treatment === 'pst' || form.tax_treatment === 'both' ? 0.07 : 0))
                  ).toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Schedule */}
      {step === 3 && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-semibold">Schedule</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure when invoices are automatically generated
            </p>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium text-sm">Enable Recurring Schedule</p>
              <p className="text-xs text-muted-foreground">Turn this on to automatically generate invoices</p>
            </div>
            <Switch
              checked={form.enable_schedule}
              onCheckedChange={(v) => set('enable_schedule', v)}
            />
          </div>

          {form.enable_schedule && (
            <div className="space-y-5 pt-2 border-t border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select value={form.frequency} onValueChange={(v) => set('frequency', v as ScheduleFrequency)}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(FREQUENCY_LABELS) as [ScheduleFrequency, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => set('start_date', e.target.value)}
                    className="h-11"
                  />
                </div>

                {isMonthly && (
                  <div className="space-y-2">
                    <Label htmlFor="day_of_month">Day of Month (1–28)</Label>
                    <Input
                      id="day_of_month"
                      type="number"
                      min="1"
                      max="28"
                      value={form.day_of_month}
                      onChange={(e) => set('day_of_month', e.target.value)}
                      className="h-11"
                    />
                  </div>
                )}

                {isWeekly && (
                  <div className="space-y-2">
                    <Label>Day of Week</Label>
                    <Select value={form.day_of_week} onValueChange={(v) => set('day_of_week', v)}>
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                          <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>End Date</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.no_end_date}
                      onCheckedChange={(v) => set('no_end_date', v)}
                    />
                    <span className="text-sm text-muted-foreground">No end date</span>
                  </div>
                </div>
                {!form.no_end_date && (
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => set('end_date', e.target.value)}
                    min={form.start_date}
                    className="h-11"
                  />
                )}
              </div>

              {/* Preview dates */}
              {previewDates.length > 0 && (
                <div className="bg-primary/5 border border-primary/10 rounded-lg p-4">
                  <p className="text-xs font-medium text-primary uppercase tracking-wide mb-3">
                    Next 3 generation dates
                  </p>
                  <div className="space-y-2">
                    {previewDates.map((d, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-xs text-primary font-medium">{i + 1}</span>
                        </div>
                        <span className="text-sm">
                          {d.toLocaleDateString('en-CA', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!form.enable_schedule && (
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
              The template will be saved without a schedule. You can add a schedule later from the template detail page.
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => (step === 1 ? router.push('/admin/recurring-expenses') : setStep(step - 1))}
          disabled={isPending}
        >
          <ChevronLeft className="w-4 h-4 mr-1.5" />
          {step === 1 ? 'Cancel' : 'Back'}
        </Button>

        {step < 3 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)}
          >
            Continue
            <ChevronRight className="w-4 h-4 ml-1.5" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isPending || !canProceedStep3}>
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Template'
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
