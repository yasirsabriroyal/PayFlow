'use client'

import { LayoutGrid, TrendingUp, PauseCircle, Clock, AlertTriangle } from 'lucide-react'
import type { TemplateDashboardStats } from '@/lib/recurring-expenses/types'

interface Props {
  stats: TemplateDashboardStats
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

interface StatCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  variant?: 'default' | 'success' | 'warning' | 'destructive'
}

function StatCard({ icon: Icon, label, value, sub, variant = 'default' }: StatCardProps) {
  const iconBg: Record<string, string> = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg[variant]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground leading-none mb-1.5">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  )
}

export function RecurringDashboardStats({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard
        icon={LayoutGrid}
        label="Active Templates"
        value={stats.active_templates}
        variant="default"
      />
      <StatCard
        icon={TrendingUp}
        label="Generated This Month"
        value={stats.generated_this_month}
        sub={formatCurrency(stats.generated_this_month_cents)}
        variant="success"
      />
      <StatCard
        icon={PauseCircle}
        label="Paused Schedules"
        value={stats.paused_templates}
        variant="warning"
      />
      <StatCard
        icon={Clock}
        label="Awaiting Approval"
        value={stats.awaiting_approval}
        sub="Recurring invoices"
        variant={stats.awaiting_approval > 0 ? 'warning' : 'default'}
      />
      <StatCard
        icon={AlertTriangle}
        label="Failed This Month"
        value={stats.failed_this_month}
        variant={stats.failed_this_month > 0 ? 'destructive' : 'default'}
      />
    </div>
  )
}
