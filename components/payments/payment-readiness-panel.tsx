'use client'

/**
 * PaymentReadinessPanel
 *
 * Full-detail readiness display for invoice detail pages.
 *
 * Sections:
 *  1. Header — status verdict, score, overall recommended action
 *  2. Domain blocks — grouped by banking / compliance / holdback / approval / invoice_state
 *  3. BLOCKER items — prominent, red, clear action
 *  4. WARNING items — amber, with "override available" indicator
 *  5. Score breakdown — visual progress bar with score label
 *
 * Self-fetches the readiness report using getInvoiceReadinessReport() on mount.
 * Exposes a refresh() callback for use after banking updates, etc.
 */

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  AlertTriangle,
  XCircle,
  Info,
  Banknote,
  FileCheck,
  LayersIcon,
  UserCheck,
  FileText,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getInvoiceReadinessReport } from '@/app/accountant/readiness/actions'
import type {
  ReadinessReport,
  ReadinessIssue,
  ReadinessDomain,
  ReadinessIssueLevel,
  ReadinessStatus,
} from '@/lib/payments/readiness-engine'

// ============================================
// STATUS CONFIG
// ============================================

const statusConfig: Record<
  ReadinessStatus,
  { icon: React.ElementType; headline: string; subtext: string; headerClass: string; iconClass: string }
> = {
  READY: {
    icon: ShieldCheck,
    headline: 'Ready to Pay',
    subtext: 'All checks passed. This invoice can be processed for payment.',
    headerClass: 'bg-success/8 border-success/20',
    iconClass: 'text-success',
  },
  WARNING: {
    icon: ShieldAlert,
    headline: 'Ready with Warnings',
    subtext: 'No hard blocks found, but advisory issues should be reviewed before payment.',
    headerClass: 'bg-warning/8 border-warning/20',
    iconClass: 'text-warning',
  },
  NOT_READY: {
    icon: ShieldX,
    headline: 'Payment Blocked',
    subtext: 'One or more critical issues must be resolved before this invoice can be paid.',
    headerClass: 'bg-destructive/8 border-destructive/20',
    iconClass: 'text-destructive',
  },
}

// ============================================
// DOMAIN CONFIG
// ============================================

const domainConfig: Record<ReadinessDomain, { icon: React.ElementType; label: string }> = {
  banking: { icon: Banknote, label: 'Banking' },
  compliance: { icon: FileCheck, label: 'Compliance' },
  holdback: { icon: LayersIcon, label: 'Holdback' },
  approval: { icon: UserCheck, label: 'Approvals' },
  invoice_state: { icon: FileText, label: 'Invoice State' },
}

// ============================================
// ISSUE LEVEL CONFIG
// ============================================

const issueLevelConfig: Record<
  ReadinessIssueLevel,
  { icon: React.ElementType; rowClass: string; iconClass: string; badgeClass: string; badgeLabel: string }
> = {
  BLOCKER: {
    icon: XCircle,
    rowClass: 'border-l-2 border-l-destructive bg-destructive/4 rounded-r-lg',
    iconClass: 'text-destructive mt-0.5 shrink-0',
    badgeClass: 'bg-destructive/10 text-destructive border-destructive/20',
    badgeLabel: 'Blocked',
  },
  WARNING: {
    icon: AlertTriangle,
    rowClass: 'border-l-2 border-l-warning bg-warning/4 rounded-r-lg',
    iconClass: 'text-warning mt-0.5 shrink-0',
    badgeClass: 'bg-warning/10 text-warning border-warning/20',
    badgeLabel: 'Warning',
  },
  INFO: {
    icon: Info,
    rowClass: 'border-l-2 border-l-muted-foreground/30 bg-muted/30 rounded-r-lg',
    iconClass: 'text-muted-foreground mt-0.5 shrink-0',
    badgeClass: 'bg-muted text-muted-foreground border-muted-foreground/20',
    badgeLabel: 'Info',
  },
}

// ============================================
// SCORE BAR
// ============================================

function ScoreBar({ score, status }: { score: number; status: ReadinessStatus }) {
  const barClass =
    status === 'READY'
      ? 'bg-success'
      : status === 'WARNING'
        ? 'bg-warning'
        : 'bg-destructive'

  const labelClass =
    status === 'READY'
      ? 'text-success'
      : status === 'WARNING'
        ? 'text-warning'
        : 'text-destructive'

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barClass)}
          style={{ width: `${score}%` }}
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Readiness score: ${score} out of 100`}
        />
      </div>
      <span className={cn('text-sm font-semibold tabular-nums w-12 text-right', labelClass)}>
        {score}<span className="text-muted-foreground font-normal">/100</span>
      </span>
    </div>
  )
}

// ============================================
// INDIVIDUAL ISSUE ROW
// ============================================

function IssueRow({ issue }: { issue: ReadinessIssue }) {
  const [expanded, setExpanded] = useState(false)
  const levelCfg = issueLevelConfig[issue.level]
  const LevelIcon = levelCfg.icon

  return (
    <div className={cn('px-3 py-2.5', levelCfg.rowClass)}>
      <div className="flex items-start gap-2.5">
        <LevelIcon className={cn('w-4 h-4', levelCfg.iconClass)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{issue.title}</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded border font-medium',
                levelCfg.badgeClass
              )}
            >
              {levelCfg.badgeLabel}
            </span>
            {issue.overridable && (
              <span className="text-xs text-muted-foreground border border-muted-foreground/20 px-1.5 py-0.5 rounded">
                Override available
              </span>
            )}
          </div>
          {expanded && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {issue.description}
            </p>
          )}
          {expanded && (
            <div className="flex items-start gap-1.5 mt-2 bg-background/60 rounded px-2 py-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-foreground leading-relaxed">{issue.recommendedAction}</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse issue details' : 'Expand issue details'}
        >
          {expanded
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />
          }
        </button>
      </div>
    </div>
  )
}

// ============================================
// DOMAIN GROUP
// ============================================

function DomainGroup({
  domain,
  issues,
}: {
  domain: ReadinessDomain
  issues: ReadinessIssue[]
}) {
  const cfg = domainConfig[domain]
  const DomainIcon = cfg.icon

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <DomainIcon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {cfg.label}
        </span>
      </div>
      <div className="space-y-1.5">
        {issues.map(issue => (
          <IssueRow key={issue.code} issue={issue} />
        ))}
      </div>
    </div>
  )
}

// ============================================
// PANEL LOADING SKELETON
// ============================================

function PanelSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
      <div className="h-5 bg-muted rounded w-1/3" />
      <div className="h-3 bg-muted rounded w-2/3" />
      <div className="h-2 bg-muted rounded w-full" />
      <div className="space-y-2">
        <div className="h-10 bg-muted rounded" />
        <div className="h-10 bg-muted rounded" />
      </div>
    </div>
  )
}

// ============================================
// MAIN PANEL COMPONENT
// ============================================

interface PaymentReadinessPanelProps {
  invoiceId: string
  /** If true, show a compact version without score breakdown header */
  compact?: boolean
  className?: string
}

export function PaymentReadinessPanel({
  invoiceId,
  compact = false,
  className,
}: PaymentReadinessPanelProps) {
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setRefreshing(silent)
    setError(null)

    try {
      const result = await getInvoiceReadinessReport(invoiceId)
      if (result.success) {
        setReport(result.report)
      } else {
        setError(result.error)
      }
    } catch {
      setError('Failed to load payment readiness report.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [invoiceId])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  if (loading) return <PanelSkeleton />

  if (error) {
    return (
      <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <span className="text-sm">Could not load readiness report: {error}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => loadReport()}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (!report) return null

  const statusCfg = statusConfig[report.status]
  const StatusIcon = statusCfg.icon

  // Group issues by domain
  const byDomain: Partial<Record<ReadinessDomain, ReadinessIssue[]>> = {}
  for (const issue of report.issues) {
    if (!byDomain[issue.domain]) byDomain[issue.domain] = []
    byDomain[issue.domain]!.push(issue)
  }

  // Domain display order
  const domainOrder: ReadinessDomain[] = [
    'banking',
    'invoice_state',
    'compliance',
    'holdback',
    'approval',
  ]
  const presentDomains = domainOrder.filter(d => byDomain[d]?.length)

  const hasIssues = report.issues.length > 0

  return (
    <div className={cn('rounded-xl border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div className={cn('px-5 py-4 border-b', statusCfg.headerClass)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <StatusIcon
              className={cn('w-5 h-5 shrink-0 mt-0.5', statusCfg.iconClass)}
              aria-hidden="true"
            />
            <div>
              <h3 className="text-sm font-semibold">{statusCfg.headline}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {statusCfg.subtext}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadReport(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label="Refresh readiness report"
            disabled={refreshing}
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
        </div>

        {/* Score bar */}
        {!compact && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground font-medium">Readiness score</span>
              <span className="text-xs text-muted-foreground">
                {report.blockers.length > 0
                  ? `${report.blockers.length} block${report.blockers.length > 1 ? 's' : ''}`
                  : report.warnings.length > 0
                    ? `${report.warnings.length} warning${report.warnings.length > 1 ? 's' : ''}`
                    : 'No issues'}
              </span>
            </div>
            <ScoreBar score={report.score} status={report.status} />
          </div>
        )}
      </div>

      {/* Recommended Next Action */}
      {report.recommendedNextAction && (
        <div className="px-5 py-3 bg-muted/30 border-b border-border">
          <div className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                Recommended action
              </span>
              <p className="text-sm text-foreground mt-0.5 leading-relaxed">
                {report.recommendedNextAction}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Issues */}
      {hasIssues ? (
        <div className="px-5 py-4 space-y-4">
          {presentDomains.map(domain => (
            <DomainGroup
              key={domain}
              domain={domain}
              issues={byDomain[domain]!}
            />
          ))}
        </div>
      ) : (
        <div className="px-5 py-5 flex items-center gap-2.5 text-success">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">
            All payment readiness checks passed.
          </span>
        </div>
      )}

      {/* Footer: evaluated timestamp */}
      <div className="px-5 py-2.5 border-t border-border bg-muted/20">
        <span className="text-xs text-muted-foreground">
          Evaluated{' '}
          {new Date(report.evaluatedAt).toLocaleString('en-CA', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          . Stage 1 — Evaluation only. Payment blocking enforced in Stage 2.
        </span>
      </div>
    </div>
  )
}
