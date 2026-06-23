'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CheckCircle2, XCircle, SkipForward, ExternalLink, Bot, UserCircle } from 'lucide-react'
import Link from 'next/link'
import type { GenerationLog } from '@/lib/recurring-expenses/types'

interface GenerationLogProps {
  entries: GenerationLog[]
}

const STATUS_CONFIG = {
  generated: { label: 'Generated', icon: CheckCircle2, className: 'bg-success/10 text-success border-success/20' },
  skipped:   { label: 'Skipped',   icon: SkipForward,  className: 'bg-warning/10 text-warning border-warning/20' },
  failed:    { label: 'Failed',    icon: XCircle,      className: 'bg-destructive/10 text-destructive border-destructive/20' },
} as const

function formatPeriodKey(key: string): string {
  // e.g. "2026-06" → "June 2026", "2026-Q2" → "Q2 2026", "2026-W24" → "Week 24, 2026"
  const monthly = key.match(/^(\d{4})-(\d{2})$/)
  if (monthly) {
    const d = new Date(Number(monthly[1]), Number(monthly[2]) - 1, 1)
    return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  }
  const quarterly = key.match(/^(\d{4})-(Q\d)$/)
  if (quarterly) return `${quarterly[2]} ${quarterly[1]}`
  const weekly = key.match(/^(\d{4})-W(\d+)$/)
  if (weekly) return `Week ${weekly[2]}, ${weekly[1]}`
  return key
}

export function GenerationLog({ entries }: GenerationLogProps) {
  if (!entries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
        <Bot className="w-8 h-8 opacity-40" />
        <p className="text-sm">No invoices generated yet.</p>
        <p className="text-xs">The engine will create entries here on each scheduled run.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Triggered</TableHead>
            <TableHead>Generated</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const config = STATUS_CONFIG[entry.status]
            const Icon = config.icon
            return (
              <TableRow key={entry.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  {formatPeriodKey(entry.period_key)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`gap-1 ${config.className}`}>
                    <Icon className="w-3 h-3" />
                    {config.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {entry.invoice_id && entry.invoice ? (
                    <Button variant="ghost" size="sm" asChild className="h-auto p-0 text-primary font-medium gap-1">
                      <Link href={`/admin/invoices/${entry.invoice_id}`}>
                        {entry.invoice.invoice_number ?? 'View'}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {entry.triggered_by === 'cron' ? (
                      <><Bot className="w-3 h-3" /> Cron</>
                    ) : (
                      <><UserCircle className="w-3 h-3" /> Manual</>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(entry.generated_at).toLocaleDateString('en-CA', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                  {entry.skip_reason ?? entry.error_message ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
