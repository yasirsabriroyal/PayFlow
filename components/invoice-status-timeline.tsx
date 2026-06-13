'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { getInvoiceStatusHistory, type InvoiceHistoryEntry } from '@/app/actions/invoice-history'

interface InvoiceStatusTimelineProps {
  invoiceId: string
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  revision_requested: 'Revision Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  disputed: 'Disputed',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
}

const STATUS_DOT: Record<string, string> = {
  approved: 'bg-emerald-500',
  paid: 'bg-emerald-500',
  partially_paid: 'bg-emerald-500',
  rejected: 'bg-destructive',
  disputed: 'bg-amber-500',
  revision_requested: 'bg-amber-500',
  submitted: 'bg-primary',
  pending_approval: 'bg-primary',
  draft: 'bg-muted-foreground',
}

function label(status: string | null): string {
  if (!status) return 'Created'
  return STATUS_LABELS[status] ?? status
}

function roleLabel(role: string | null): string | null {
  if (!role) return null
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function InvoiceStatusTimeline({ invoiceId }: InvoiceStatusTimelineProps) {
  const [history, setHistory] = useState<InvoiceHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getInvoiceStatusHistory(invoiceId)
      .then((res) => {
        if (active && res.success) setHistory(res.history)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [invoiceId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading history…</p>
  }

  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No status changes recorded yet.</p>
  }

  return (
    <ol className="relative space-y-5 pl-1">
      {history.map((entry, idx) => {
        const isLast = idx === history.length - 1
        return (
          <li key={entry.id} className="relative flex gap-3">
            {/* connector line */}
            {!isLast && (
              <span
                className="absolute left-[5px] top-4 h-full w-px bg-border"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                'mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background',
                STATUS_DOT[entry.newStatus] ?? 'bg-primary',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 -mt-0.5">
              <p className="text-sm font-medium text-foreground">
                {label(entry.oldStatus)} <span className="text-muted-foreground">→</span>{' '}
                {label(entry.newStatus)}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.changedByName || 'System'}
                {roleLabel(entry.changedByRole) ? ` · ${roleLabel(entry.changedByRole)}` : ''}
                {' · '}
                {format(new Date(entry.createdAt), 'MMM d, yyyy h:mm a')}
              </p>
              {entry.reason && (
                <p className="mt-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-foreground/80">
                  {entry.reason}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
