'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  RefreshCw, Calendar, FileText, Archive, Pause, Play,
  Building2, Tag, DollarSign, Clock, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { GenerationLog } from '../../_components/generation-log'
import {
  updateTemplateStatus,
  pauseSchedule,
  resumeSchedule,
  triggerManualGeneration,
} from '@/lib/recurring-expenses/actions'
import type { ExpenseTemplateWithRelations } from '@/lib/recurring-expenses/types'
import { FREQUENCY_LABELS, TAX_TREATMENT_LABELS } from '@/lib/recurring-expenses/types'

interface TemplateDetailClientProps {
  template: ExpenseTemplateWithRelations
  suppliers: { id: string; company_name: string; trade_category: string | null; vendor_type: string }[]
  categories: { id: string; name: string }[]
  projects: { id: string; name: string; project_number: string | null }[]
  canEdit: boolean
}

const STATUS_CONFIG = {
  active:   { label: 'Active',   className: 'bg-success/10 text-success border-success/20' },
  inactive: { label: 'Inactive', className: 'bg-muted text-muted-foreground border-border' },
  archived: { label: 'Archived', className: 'bg-muted text-muted-foreground border-border' },
} as const

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide min-w-[140px]">
        {label}
      </span>
      <span className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  )
}

function formatAmount(cents: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100)
}

function formatDate(d: string | null | undefined) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function TemplateDetailClient({
  template,
  canEdit,
}: TemplateDetailClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const schedule = template.schedule
  const statusConfig = STATUS_CONFIG[template.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.inactive
  const generationLog = (template as any).generation_log ?? []

  function handleStatusChange(newStatus: 'active' | 'inactive' | 'archived') {
    startTransition(async () => {
      const res = await updateTemplateStatus(template.id, newStatus)
      if (res.success) {
        toast.success(`Template ${newStatus === 'archived' ? 'archived' : newStatus === 'active' ? 'activated' : 'deactivated'}.`)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Failed to update status.')
      }
    })
  }

  function handlePauseResume() {
    startTransition(async () => {
      if (!schedule) return
      const res = schedule.is_active
        ? await pauseSchedule(template.id, 'Manually paused by admin')
        : await resumeSchedule(template.id)
      if (res.success) {
        toast.success(schedule.is_active ? 'Schedule paused.' : 'Schedule resumed.')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Failed to update schedule.')
      }
    })
  }

  function handleManualTrigger() {
    startTransition(async () => {
      const res = await triggerManualGeneration(template.id)
      if (res.success) {
        toast.success('Invoice generated and sent to approval queue.')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Failed to generate invoice.')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">{template.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={statusConfig.className}>
                {statusConfig.label}
              </Badge>
              <Badge variant="outline" className="capitalize text-xs">
                {template.expense_type}
              </Badge>
              {schedule && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Clock className="w-3 h-3" />
                  {FREQUENCY_LABELS[schedule.frequency as keyof typeof FREQUENCY_LABELS]}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            {schedule && template.status === 'active' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePauseResume}
                disabled={isPending}
                className="gap-1.5"
              >
                {schedule.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {schedule.is_active ? 'Pause' : 'Resume'}
              </Button>
            )}

            {template.status === 'active' && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isPending} className="gap-1.5">
                    <RefreshCw className="w-4 h-4" />
                    Generate Now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Generate Invoice Now?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will create a new draft invoice for <strong>{template.name}</strong> and send it to the PM approval queue. This is independent of the regular schedule.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleManualTrigger}>Generate</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {template.status !== 'archived' && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isPending} className="gap-1.5 text-destructive hover:text-destructive">
                    <Archive className="w-4 h-4" />
                    Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-warning" />
                      Archive Template?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Archiving <strong>{template.name}</strong> will stop all future invoice generation. Existing invoices are unaffected. This action can be reversed by an admin.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleStatusChange('archived')}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Archive
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {template.status === 'archived' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange('active')}
                disabled={isPending}
                className="gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                Restore
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="flex w-max min-w-full md:grid md:w-full md:grid-cols-3">
            <TabsTrigger value="overview" className="whitespace-nowrap px-4 gap-1.5 min-w-[5rem]">
              <Building2 className="w-4 h-4 hidden sm:block shrink-0" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="schedule" className="whitespace-nowrap px-4 gap-1.5 min-w-[5rem]">
              <Calendar className="w-4 h-4 hidden sm:block shrink-0" />
              Schedule
            </TabsTrigger>
            <TabsTrigger value="log" className="whitespace-nowrap px-4 gap-1.5 min-w-[5rem]">
              <FileText className="w-4 h-4 hidden sm:block shrink-0" />
              Generation Log
              {generationLog.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 shrink-0 text-xs">{generationLog.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

      {/* Overview tab */}
      <TabsContent value="overview">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="w-4 h-4 text-primary" />
                Template Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Template Name" value={template.name} />
              <Separator />
              <DetailRow label="Expense Type" value={<span className="capitalize">{template.expense_type}</span>} />
              <DetailRow label="Vendor" value={
                template.contractor
                  ? template.contractor.company_name
                  : template.vendor_name_override ?? null
              } />
              <DetailRow label="Category" value={template.category?.name} />
              <DetailRow label="Subcategory" value={template.subcategory?.name} />
              {template.expense_type === 'project' && (
                <DetailRow label="Project" value={
                  template.project
                    ? `${template.project.name}${template.project.project_number ? ` (${template.project.project_number})` : ''}`
                    : null
                } />
              )}
              <DetailRow label="Cost Code" value={template.cost_code} />
              {template.description && (
                <>
                  <Separator />
                  <DetailRow label="Description" value={template.description} />
                </>
              )}
              {template.notes && (
                <DetailRow label="Notes" value={template.notes} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />
                Financial Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Default Amount" value={
                <span className="font-semibold text-base">
                  {formatAmount(template.default_amount_cents, template.currency)}
                </span>
              } />
              <DetailRow label="Currency" value={template.currency} />
              <DetailRow label="Tax Treatment" value={
                  TAX_TREATMENT_LABELS[template.tax_treatment as keyof typeof TAX_TREATMENT_LABELS] ?? template.tax_treatment
              } />
              <DetailRow label="Approval Route" value={
                template.approval_route === 'standard'
                  ? 'Standard (PM → Accountant)'
                  : template.approval_route === 'admin_only'
                    ? 'Admin Only'
                    : 'Accountant Only'
              } />
              <Separator />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">QuickBooks Mapping (Future)</p>
              <DetailRow label="QB Account ID" value={template.qb_account_id ?? <span className="text-muted-foreground italic text-xs">Not mapped</span>} />
              <DetailRow label="QB Class ID" value={template.qb_class_id ?? <span className="text-muted-foreground italic text-xs">Not mapped</span>} />
              <DetailRow label="QB Item ID" value={template.qb_item_id ?? <span className="text-muted-foreground italic text-xs">Not mapped</span>} />
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* Schedule tab */}
      <TabsContent value="schedule">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {schedule ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    Schedule Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <DetailRow label="Frequency" value={FREQUENCY_LABELS[schedule.frequency as keyof typeof FREQUENCY_LABELS]} />
                  {schedule.day_of_month && (
                    <DetailRow label="Day of Month" value={`Day ${schedule.day_of_month}`} />
                  )}
                  <DetailRow label="Start Date" value={formatDate(schedule.start_date)} />
                  <DetailRow label="End Date" value={schedule.end_date ? formatDate(schedule.end_date) : 'No end date'} />
                  <Separator />
                  <DetailRow label="Schedule Status" value={
                    <Badge variant="outline" className={schedule.is_active ? 'bg-success/10 text-success border-success/20' : 'bg-warning/10 text-warning border-warning/20'}>
                      {schedule.is_active ? 'Running' : 'Paused'}
                    </Badge>
                  } />
                  {schedule.paused_at && !schedule.is_active && (
                    <DetailRow label="Paused On" value={formatDate(schedule.paused_at)} />
                  )}
                  {schedule.paused_reason && !schedule.is_active && (
                    <DetailRow label="Pause Reason" value={schedule.paused_reason} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-primary" />
                    Engine Status
                  </CardTitle>
                  <CardDescription>Last run and upcoming generation details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <DetailRow label="Next Generation" value={
                    schedule.next_generation_date
                      ? <span className="font-medium">{formatDate(schedule.next_generation_date)}</span>
                      : <span className="text-muted-foreground italic text-xs">Not scheduled</span>
                  } />
                  <DetailRow label="Last Generated" value={
                    schedule.last_generated_at
                      ? formatDate(schedule.last_generated_at)
                      : <span className="text-muted-foreground italic text-xs">Never</span>
                  } />
                  <DetailRow label="Total Generated" value={`${schedule.total_generated} invoice${schedule.total_generated !== 1 ? 's' : ''}`} />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="lg:col-span-2">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
                <Calendar className="w-10 h-10 opacity-30" />
                <p className="font-medium">No Schedule Configured</p>
                <p className="text-sm max-w-sm">
                  This template does not have a recurring schedule set up. Add a schedule to enable automatic invoice generation.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </TabsContent>

      {/* Generation Log tab */}
      <TabsContent value="log">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Generation History
            </CardTitle>
            <CardDescription>
              Every invoice generated, skipped, or failed by the recurring engine for this template.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <GenerationLog entries={generationLog} />
          </CardContent>
        </Card>
      </TabsContent>

      </Tabs>
    </div>
  )
}
