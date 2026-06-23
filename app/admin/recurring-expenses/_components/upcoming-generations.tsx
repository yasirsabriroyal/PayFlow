'use client'

import Link from 'next/link'
import { CalendarDays, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FREQUENCY_LABELS } from '@/lib/recurring-expenses/types'
import type { UpcomingGeneration } from '@/lib/recurring-expenses/types'

interface Props {
  items: UpcomingGeneration[]
}

function formatCurrency(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function DueBadge({ days }: { days: number }) {
  if (days <= 0) return <Badge variant="destructive" className="text-xs">Overdue</Badge>
  if (days <= 2) return <Badge className="text-xs bg-destructive/10 text-destructive border-destructive/20">Today / Tomorrow</Badge>
  if (days <= 7) return <Badge className="text-xs bg-warning/10 text-warning border-warning/20">{days} days</Badge>
  return <Badge variant="secondary" className="text-xs">{days} days</Badge>
}

export function UpcomingGenerationsList({ items }: Props) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
          <CalendarDays className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">Upcoming (30 days)</h3>
          <p className="text-xs text-muted-foreground">{items.length} scheduled generation{items.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">No upcoming generations in the next 30 days.</p>
          <Link
            href="/admin/recurring-expenses/templates/new"
            className="text-sm text-primary hover:underline mt-2 inline-block"
          >
            Create a template to get started
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const days = daysUntil(item.next_generation_date)
            return (
              <li key={`${item.template_id}-${item.next_generation_date}`}>
                <Link
                  href={`/admin/recurring-expenses/templates/${item.template_id}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50 transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.template_name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.vendor_name ?? 'No vendor'} &middot; {FREQUENCY_LABELS[item.frequency]}
                    </p>
                  </div>
                  <div className="shrink-0 text-right flex flex-col items-end gap-1">
                    <DueBadge days={days} />
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.default_amount_cents, item.currency)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
