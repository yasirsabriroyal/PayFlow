'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  MoreHorizontal,
  Pencil,
  Play,
  Pause,
  Archive,
  Zap,
  ExternalLink,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import {
  archiveExpenseTemplate,
  pauseSchedule,
  resumeSchedule,
  triggerManualGeneration,
} from '@/lib/recurring-expenses/actions'
import {
  FREQUENCY_LABELS,
  TEMPLATE_STATUS_LABELS,
  type ExpenseTemplateWithDetails,
  type TemplateStatus,
} from '@/lib/recurring-expenses/types'

interface Props {
  templates: ExpenseTemplateWithDetails[]
}

function formatCurrency(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function StatusBadge({ status }: { status: TemplateStatus }) {
  const styles: Record<TemplateStatus, string> = {
    active: 'bg-success/10 text-success border-success/20',
    inactive: 'bg-warning/10 text-warning border-warning/20',
    archived: 'bg-muted text-muted-foreground border-border',
  }
  return (
    <Badge variant="outline" className={`text-xs ${styles[status]}`}>
      {TEMPLATE_STATUS_LABELS[status]}
    </Badge>
  )
}

function TemplateRow({
  template,
  onRefresh,
}: {
  template: ExpenseTemplateWithDetails
  onRefresh: () => void
}) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const handlePause = () => {
    startTransition(async () => {
      const result = await pauseSchedule(template.id)
      if (result.success) {
        toast({ title: 'Schedule paused' })
        onRefresh()
      } else {
        toast({ title: 'Error', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleResume = () => {
    startTransition(async () => {
      const result = await resumeSchedule(template.id)
      if (result.success) {
        toast({ title: 'Schedule resumed' })
        onRefresh()
      } else {
        toast({ title: 'Error', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleArchive = () => {
    if (!confirm(`Archive "${template.name}"? This will stop all future generations.`)) return
    startTransition(async () => {
      const result = await archiveExpenseTemplate(template.id)
      if (result.success) {
        toast({ title: 'Template archived' })
        onRefresh()
      } else {
        toast({ title: 'Error', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleManualGenerate = () => {
    startTransition(async () => {
      const result = await triggerManualGeneration(template.id, 'manual-user')
      if (result.success && result.data) {
        toast({
          title: 'Invoice generated',
          description: `${result.data.invoice_number} created and is awaiting approval.`,
        })
        onRefresh()
      } else {
        toast({ title: 'Error', description: result.error, variant: 'destructive' })
      }
    })
  }

  const schedule = template.schedule
  const nextDate = schedule?.next_generation_date
    ? new Date(schedule.next_generation_date).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—'

  return (
    <TableRow className={isPending ? 'opacity-60' : ''}>
      <TableCell>
        <Link
          href={`/admin/recurring-expenses/templates/${template.id}`}
          className="font-medium hover:text-primary transition-colors"
        >
          {template.name}
        </Link>
        {template.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
            {template.description}
          </p>
        )}
      </TableCell>

      <TableCell className="text-sm text-muted-foreground">
        {template.vendor_name ?? <span className="italic text-muted-foreground/60">No vendor</span>}
      </TableCell>

      <TableCell className="text-sm text-muted-foreground">
        {template.category_name ?? '—'}
      </TableCell>

      <TableCell className="text-sm">
        {schedule ? FREQUENCY_LABELS[schedule.frequency] : <span className="text-muted-foreground">No schedule</span>}
      </TableCell>

      <TableCell className="text-sm text-muted-foreground font-mono">{nextDate}</TableCell>

      <TableCell className="text-sm font-medium">
        {formatCurrency(template.default_amount_cents, template.currency)}
      </TableCell>

      <TableCell>
        <StatusBadge status={template.status} />
      </TableCell>

      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isPending}>
              <MoreHorizontal className="w-4 h-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link href={`/admin/recurring-expenses/templates/${template.id}`}>
                <ExternalLink className="w-4 h-4 mr-2" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/recurring-expenses/templates/${template.id}?edit=true`}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Template
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {template.status !== 'archived' && schedule && (
              <>
                {schedule.is_active ? (
                  <DropdownMenuItem onClick={handlePause}>
                    <Pause className="w-4 h-4 mr-2" />
                    Pause Schedule
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleResume}>
                    <Play className="w-4 h-4 mr-2" />
                    Resume Schedule
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleManualGenerate}>
                  <Zap className="w-4 h-4 mr-2" />
                  Generate Now
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {template.status !== 'archived' && (
              <DropdownMenuItem
                onClick={handleArchive}
                className="text-destructive focus:text-destructive"
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

export function RecurringTemplateTable({ templates: initialTemplates }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const filtered = initialTemplates.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.vendor_name ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const handleRefresh = () => router.refresh()

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm">Expense Templates</h3>
          <p className="text-xs text-muted-foreground">{initialTemplates.length} total</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48 text-sm"
          />
          <Button size="sm" asChild>
            <Link href="/admin/recurring-expenses/templates/new">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New
            </Link>
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? 'No templates match your search.' : 'No expense templates yet.'}
          </p>
          {!search && (
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link href="/admin/recurring-expenses/templates/new">
                <Plus className="w-4 h-4 mr-2" />
                Create your first template
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead>Template</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Next Due</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((template) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  onRefresh={handleRefresh}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
