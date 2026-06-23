'use client'

/**
 * PaymentReadinessBadge
 *
 * Compact readiness indicator shown on every invoice row in the AP Queue
 * and Payments pages. Shows status, score, and a tooltip with the top issue.
 *
 * Sizes:
 *  - "sm": just the icon + label, for tight table rows
 *  - "md" (default): icon + label + score ring, for card-style rows
 *
 * Loading state: shows a subtle animated placeholder.
 */

import { cn } from '@/lib/utils'
import { ShieldCheck, ShieldAlert, ShieldX, Loader2 } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ReadinessStatus } from '@/lib/payments/readiness-engine'
import type { QueueReadinessSummary } from '@/app/accountant/readiness/actions'

// ============================================
// BADGE PROPS
// ============================================

interface PaymentReadinessBadgeProps {
  /** The summary object from getQueueReadinessSummaries() */
  summary: QueueReadinessSummary | null | undefined
  /** Show loading skeleton while data is fetching */
  loading?: boolean
  /** 'sm' = icon + label only. 'md' = icon + label + score. Default: 'md'. */
  size?: 'sm' | 'md'
  className?: string
  /** Optional: a short description of the top issue, shown in tooltip */
  tooltipMessage?: string
}

// ============================================
// STATUS DISPLAY CONFIG
// ============================================

const statusConfig: Record<
  ReadinessStatus,
  {
    icon: React.ElementType
    badgeClass: string
    iconClass: string
    label: string
  }
> = {
  READY: {
    icon: ShieldCheck,
    badgeClass: 'bg-success/10 text-success border-success/20',
    iconClass: 'text-success',
    label: 'Ready',
  },
  WARNING: {
    icon: ShieldAlert,
    badgeClass: 'bg-warning/10 text-warning border-warning/20',
    iconClass: 'text-warning',
    label: 'Warning',
  },
  NOT_READY: {
    icon: ShieldX,
    badgeClass: 'bg-destructive/10 text-destructive border-destructive/20',
    iconClass: 'text-destructive',
    label: 'Blocked',
  },
}

// ============================================
// SCORE RING — small circular score indicator
// ============================================

function ScoreRing({ score, status }: { score: number; status: ReadinessStatus }) {
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  const strokeColor =
    status === 'READY'
      ? 'stroke-success'
      : status === 'WARNING'
        ? 'stroke-warning'
        : 'stroke-destructive'

  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      className="-rotate-90"
      aria-hidden="true"
    >
      <circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        strokeWidth={2.5}
        className="stroke-muted"
      />
      <circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        strokeWidth={2.5}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeLinecap="round"
        className={strokeColor}
      />
    </svg>
  )
}

// ============================================
// LOADING SKELETON
// ============================================

function BadgeLoadingSkeleton({ size }: { size: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5',
        'bg-muted/50 text-muted-foreground animate-pulse',
        size === 'sm' ? 'text-xs' : 'text-xs'
      )}
      aria-busy="true"
      aria-label="Loading readiness status"
    >
      <Loader2 className="w-3 h-3 animate-spin opacity-50" />
      <span className="text-xs opacity-50">Checking...</span>
    </span>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export function PaymentReadinessBadge({
  summary,
  loading = false,
  size = 'md',
  className,
  tooltipMessage,
}: PaymentReadinessBadgeProps) {
  if (loading || !summary) {
    return <BadgeLoadingSkeleton size={size} />
  }

  const config = statusConfig[summary.status]
  const Icon = config.icon

  const tooltipContent =
    tooltipMessage ??
    (summary.status === 'READY'
      ? 'All checks passed. This invoice is ready for payment.'
      : `${summary.summaryLabel}${
          summary.blockerCount > 0 || summary.warningCount > 0
            ? ` — ${summary.blockerCount} block${summary.blockerCount !== 1 ? 's' : ''}, ${summary.warningCount} warning${summary.warningCount !== 1 ? 's' : ''}`
            : ''
        }. Click to view full report.`)

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5',
              'text-xs font-medium cursor-default select-none',
              'transition-colors duration-150',
              config.badgeClass,
              className
            )}
            aria-label={`Payment readiness: ${summary.status}. ${summary.summaryLabel}`}
          >
            <Icon className={cn('shrink-0', size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
            <span className="truncate max-w-[140px]">{summary.summaryLabel}</span>
            {size === 'md' && (
              <span className="ml-0.5 shrink-0" aria-hidden="true">
                <ScoreRing score={summary.score} status={summary.status} />
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ============================================
// READINESS COUNT BADGE
// Compact count for the "X blocked" summary cards at the top of the page.
// ============================================

interface ReadinessCountBadgeProps {
  count: number
  status: ReadinessStatus
  label: string
  className?: string
}

export function ReadinessCountBadge({
  count,
  status,
  label,
  className,
}: ReadinessCountBadgeProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5',
        'text-sm font-medium',
        config.badgeClass,
        className
      )}
    >
      <Icon className={cn('w-4 h-4 shrink-0', config.iconClass)} />
      <span className="font-semibold tabular-nums">{count}</span>
      <span className="text-xs opacity-80">{label}</span>
    </span>
  )
}
