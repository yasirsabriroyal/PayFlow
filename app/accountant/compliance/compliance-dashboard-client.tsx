'use client'

import { useState } from 'react'
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  ChevronDown,
  ChevronUp,
  Ban,
  FileWarning,
  Building2,
  Search,
  Filter,
  RefreshCw,
  PlusCircle,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { createComplianceOverride, expireComplianceOverride } from '@/lib/compliance/override-actions'
import { COMPLIANCE_DOC_LABELS } from '@/lib/compliance/constants'
import type {
  ComplianceDashboardSummary,
  ContractorComplianceRow,
  BlockedPayment,
} from './actions'
import type { ComplianceOverride } from '@/lib/compliance/override-actions'

// ============================================
// ISSUE CODE LABELS
// ============================================

const ISSUE_CODE_LABELS: Record<string, string> = {
  WCB_EXPIRED: 'WCB Clearance Expired',
  WCB_NOT_ON_FILE: 'WCB Clearance Missing',
  INSURANCE_EXPIRED: 'Insurance Certificate Expired',
  INSURANCE_NOT_ON_FILE: 'Insurance Certificate Missing',
  BUSINESS_LICENSE_EXPIRED: 'Business License Expired',
  BUSINESS_LICENSE_NOT_ON_FILE: 'Business License Missing',
  SAFETY_CERT_EXPIRED: 'Safety Certification Expired',
  SAFETY_CERT_NOT_ON_FILE: 'Safety Certification Missing',
  LIEN_WAIVER_MISSING: 'Lien Waiver Missing',
  LIEN_WAIVER_UNSIGNED: 'Lien Waiver Unsigned',
  LIEN_WAIVER_EXPIRED: 'Lien Waiver Expired',
}

// ============================================
// STATUS BADGE COMPONENT
// ============================================

function ComplianceStatusBadge({ status }: { status: 'compliant' | 'expiring' | 'blocked' }) {
  if (status === 'compliant') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/20">
        <ShieldCheck className="w-3.5 h-3.5" />
        Compliant
      </span>
    )
  }
  if (status === 'expiring') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-warning/10 text-warning border border-warning/20">
        <Clock className="w-3.5 h-3.5" />
        Expiring Soon
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">
      <ShieldX className="w-3.5 h-3.5" />
      Blocked
    </span>
  )
}

function DocStatusBadge({ status, daysUntil }: { status: ComplianceDashboardDoc['status']; daysUntil: number | null }) {
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-success/10 text-success">
        <CheckCircle className="w-3 h-3" />
        Valid
      </span>
    )
  }
  if (status === 'expiring') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/10 text-warning">
        <Clock className="w-3 h-3" />
        {daysUntil !== null ? `${daysUntil}d` : 'Soon'}
      </span>
    )
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-destructive/10 text-destructive">
        <XCircle className="w-3 h-3" />
        Expired
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">
      <FileWarning className="w-3 h-3" />
      Missing
    </span>
  )
}

type ComplianceDashboardDoc = ContractorComplianceRow['documents'][0]

// ============================================
// CONTRACTOR ROW COMPONENT
// ============================================

function ContractorComplianceRowComponent({
  row,
  onOverride,
}: {
  row: ContractorComplianceRow
  onOverride: (contractorId: string, issueType: string, contractorName: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            row.status === 'compliant' ? 'bg-success/10' :
            row.status === 'expiring' ? 'bg-warning/10' :
            'bg-destructive/10'
          }`}>
            {row.status === 'compliant' ? (
              <ShieldCheck className="w-5 h-5 text-success" />
            ) : row.status === 'expiring' ? (
              <ShieldAlert className="w-5 h-5 text-warning" />
            ) : (
              <ShieldX className="w-5 h-5 text-destructive" />
            )}
          </div>
          <div>
            <p className="font-semibold">{row.contractor_name}</p>
            <p className="text-sm text-muted-foreground">{row.email ?? 'No email on file'}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {row.status === 'blocked' && row.blockingIssues.length > 0 && (
            <span className="hidden md:block text-sm text-destructive font-medium">
              {row.blockingIssues.length} issue{row.blockingIssues.length > 1 ? 's' : ''}
            </span>
          )}
          <ComplianceStatusBadge status={row.status} />
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4 bg-muted/20">
          {/* Document Status Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {row.documents.map(doc => (
              <div
                key={doc.document_type}
                className={`p-3 rounded-lg border ${
                  doc.status === 'expired' || doc.status === 'missing'
                    ? 'border-destructive/20 bg-destructive/5'
                    : doc.status === 'expiring'
                    ? 'border-warning/20 bg-warning/5'
                    : 'border-border bg-card'
                }`}
              >
                <p className="text-xs font-medium text-muted-foreground mb-1.5">{doc.label}</p>
                <div className="flex items-center justify-between">
                  <DocStatusBadge status={doc.status} daysUntil={doc.days_until_expiry} />
                  {doc.expiry_date && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(doc.expiry_date).toLocaleDateString('en-CA')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Blocking Issues + Override Buttons */}
          {row.status === 'blocked' && row.blockingIssues.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">Blocking Issues:</p>
              {row.blockingIssues.map((issue, i) => {
                // Extract issue code from label (reverse-lookup)
                const issueCode = Object.entries(COMPLIANCE_DOC_LABELS).find(
                  ([, label]) => issue.startsWith(label)
                )?.[0]
                const overrideCode = issueCode
                  ? (issue.includes('Expired')
                    ? `${issueCode.toUpperCase()}_EXPIRED`
                    : `${issueCode.toUpperCase()}_NOT_ON_FILE`)
                  : issue
                return (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-destructive/5 rounded-lg border border-destructive/10">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-destructive shrink-0" />
                      <span className="text-sm font-medium">{issue}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOverride(row.contractor_id, overrideCode, row.contractor_name)}
                      className="text-xs"
                    >
                      <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
                      Override
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Action Links */}
          <div className="flex items-center gap-3 pt-1">
            <Link
              href={`/accountant/contractors/${row.contractor_id}`}
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Contractor
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// OVERRIDE DIALOG COMPONENT
// ============================================

function CreateOverrideDialog({
  open,
  onClose,
  contractorId,
  issueType,
  contractorName,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  contractorId: string
  issueType: string
  contractorName: string
  onCreated: () => void
}) {
  const [reason, setReason] = useState('')
  const [expiryDays, setExpiryDays] = useState('30')
  const [invoiceId, setInvoiceId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const issueLabel = ISSUE_CODE_LABELS[issueType] ?? issueType

  const handleSubmit = async () => {
    if (reason.trim().length < 25) {
      toast({
        title: 'Reason too short',
        description: 'Override reason must be at least 25 characters.',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)
    const expiresAt = expiryDays === 'single'
      ? null
      : new Date(Date.now() + parseInt(expiryDays) * 24 * 60 * 60 * 1000).toISOString()

    const result = await createComplianceOverride({
      contractor_id: contractorId,
      invoice_id: invoiceId.trim() || null,
      issue_type: issueType,
      override_reason: reason.trim(),
      expires_at: expiresAt,
    })

    setIsSubmitting(false)

    if (result.success) {
      toast({
        title: 'Override created',
        description: `Compliance override for ${issueLabel} has been recorded and audited.`,
      })
      setReason('')
      setInvoiceId('')
      onCreated()
      onClose()
    } else {
      toast({
        title: 'Failed to create override',
        description: result.error,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mx-auto w-14 h-14 bg-warning/10 rounded-full flex items-center justify-center mb-3">
            <ShieldAlert className="w-7 h-7 text-warning" />
          </div>
          <DialogTitle className="text-center">Create Compliance Override</DialogTitle>
          <DialogDescription className="text-center">
            This override will allow payment to proceed for <strong>{contractorName}</strong> despite the compliance issue.
            All overrides are fully audited.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Issue type */}
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">Compliance Issue Being Overridden</p>
            <p className="text-sm font-semibold text-destructive">{issueLabel}</p>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="override-reason">
              Override Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="override-reason"
              placeholder="Provide a detailed business justification for this override (minimum 25 characters)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <p className={`text-xs ${reason.trim().length < 25 ? 'text-muted-foreground' : 'text-success'}`}>
              {reason.trim().length} / 25 minimum characters
            </p>
          </div>

          {/* Expiry */}
          <div className="space-y-1.5">
            <Label htmlFor="override-expiry">Override Duration</Label>
            <Select value={expiryDays} onValueChange={setExpiryDays}>
              <SelectTrigger id="override-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days (recommended)</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Optional invoice scope */}
          <div className="space-y-1.5">
            <Label htmlFor="override-invoice">Invoice ID (Optional — scope to specific invoice)</Label>
            <Input
              id="override-invoice"
              placeholder="Leave blank to apply to all invoices for this contractor"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            disabled={reason.trim().length < 25 || isSubmitting}
          >
            {isSubmitting ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4 mr-2" />
            )}
            {isSubmitting ? 'Creating...' : 'Create Override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// MAIN DASHBOARD CLIENT COMPONENT
// ============================================

interface ComplianceDashboardClientProps {
  summary: ComplianceDashboardSummary
  contractors: ContractorComplianceRow[]
  overrides: ComplianceOverride[]
  blockedPayments: BlockedPayment[]
}

type TabValue = 'overview' | 'expiring' | 'blocked' | 'overrides' | 'payments_blocked'
type StatusFilter = 'all' | 'compliant' | 'expiring' | 'blocked'

export function ComplianceDashboardClient({
  summary,
  contractors,
  overrides: initialOverrides,
  blockedPayments,
}: ComplianceDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [overrides, setOverrides] = useState(initialOverrides)

  // Override dialog state
  const [overrideDialog, setOverrideDialog] = useState<{
    open: boolean
    contractorId: string
    issueType: string
    contractorName: string
  }>({ open: false, contractorId: '', issueType: '', contractorName: '' })

  const { toast } = useToast()

  const openOverrideDialog = (contractorId: string, issueType: string, contractorName: string) => {
    setOverrideDialog({ open: true, contractorId, issueType, contractorName })
  }

  const handleOverrideCreated = async () => {
    // Refresh overrides list client-side (simple approach; full refresh via router.refresh() is alternative)
    setOverrideDialog(d => ({ ...d, open: false }))
  }

  const handleExpireOverride = async (overrideId: string) => {
    const result = await expireComplianceOverride(overrideId)
    if (result.success) {
      setOverrides(prev => prev.map(o => o.id === overrideId ? { ...o, is_active: false } : o))
      toast({ title: 'Override revoked', description: 'The compliance override has been removed and audited.' })
    } else {
      toast({ title: 'Failed', description: result.error, variant: 'destructive' })
    }
  }

  // Filter contractors
  const filteredContractors = contractors.filter(c => {
    const matchesSearch = !searchQuery ||
      c.contractor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.email ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const tabs: { value: TabValue; label: string; count?: number }[] = [
    { value: 'overview', label: 'All Contractors' },
    { value: 'blocked', label: 'Blocked', count: summary.blockedCount },
    { value: 'expiring', label: 'Expiring', count: summary.expiringCount },
    { value: 'overrides', label: 'Overrides', count: overrides.filter(o => o.is_active).length },
    { value: 'payments_blocked', label: 'Blocked Payments', count: summary.blockedPaymentsCount },
  ]

  const displayContractors = activeTab === 'blocked'
    ? filteredContractors.filter(c => c.status === 'blocked')
    : activeTab === 'expiring'
    ? filteredContractors.filter(c => c.status === 'expiring')
    : filteredContractors

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Compliance Center" />
      <RoleTabBar role="accountant" />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={<ShieldCheck className="w-5 h-5 text-success" />}
            iconBg="bg-success/10"
            label="Compliant"
            value={summary.compliantCount}
            total={summary.totalContractors}
          />
          <SummaryCard
            icon={<Clock className="w-5 h-5 text-warning" />}
            iconBg="bg-warning/10"
            label="Expiring Soon"
            value={summary.expiringCount}
            highlight={summary.expiringCount > 0 ? 'warning' : undefined}
          />
          <SummaryCard
            icon={<ShieldX className="w-5 h-5 text-destructive" />}
            iconBg="bg-destructive/10"
            label="Blocked"
            value={summary.blockedCount}
            highlight={summary.blockedCount > 0 ? 'destructive' : undefined}
          />
          <SummaryCard
            icon={<Ban className="w-5 h-5 text-destructive" />}
            iconBg="bg-destructive/10"
            label="Payments Blocked"
            value={summary.blockedPaymentsCount}
            highlight={summary.blockedPaymentsCount > 0 ? 'destructive' : undefined}
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MiniStat label="Missing Documents" value={summary.missingDocCount} icon={<FileWarning className="w-4 h-4" />} variant="destructive" />
          <MiniStat label="Expiring Documents" value={summary.expiringDocCount} icon={<Clock className="w-4 h-4" />} variant="warning" />
          <MiniStat label="Active Overrides" value={summary.activeOverridesCount} icon={<ShieldAlert className="w-4 h-4" />} variant="warning" />
          <MiniStat label="Total Contractors" value={summary.totalContractors} icon={<Building2 className="w-4 h-4" />} variant="default" />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border">
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                  tab.value === 'blocked' || tab.value === 'payments_blocked'
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-warning/20 text-warning'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Overrides Tab */}
        {activeTab === 'overrides' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Active Compliance Overrides</h2>
                <p className="text-sm text-muted-foreground">
                  Authorized exceptions to compliance requirements. All overrides are audited.
                </p>
              </div>
            </div>

            {overrides.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="w-8 h-8 text-muted-foreground" />}
                title="No overrides on record"
                description="No compliance overrides have been issued."
              />
            ) : (
              <div className="space-y-3">
                {overrides.map(override => (
                  <div
                    key={override.id}
                    className={`bg-card border rounded-xl p-4 ${override.is_active ? 'border-warning/30' : 'border-border opacity-60'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          override.is_active ? 'bg-warning/10' : 'bg-muted'
                        }`}>
                          <ShieldAlert className={`w-4.5 h-4.5 ${override.is_active ? 'text-warning' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">
                            {ISSUE_CODE_LABELS[override.issue_type] ?? override.issue_type}
                          </p>
                          <p className="text-sm text-muted-foreground">{override.contractor_name ?? override.contractor_id}</p>
                          <p className="text-xs text-muted-foreground mt-1">{override.override_reason}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span>Approved by {override.approver_name ?? 'Unknown'}</span>
                            <span>{new Date(override.approved_at).toLocaleDateString('en-CA')}</span>
                            {override.expires_at && (
                              <span className={new Date(override.expires_at) < new Date() ? 'text-destructive' : ''}>
                                Expires {new Date(override.expires_at).toLocaleDateString('en-CA')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {override.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={() => handleExpireOverride(override.id)}
                        >
                          <Trash2 className="w-4 h-4 mr-1.5" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Blocked Payments Tab */}
        {activeTab === 'payments_blocked' && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold">Blocked Payment Attempts</h2>
              <p className="text-sm text-muted-foreground">
                Recent payment attempts that were blocked due to compliance failures.
              </p>
            </div>

            {blockedPayments.length === 0 ? (
              <EmptyState
                icon={<CheckCircle className="w-8 h-8 text-muted-foreground" />}
                title="No blocked payments"
                description="No payment attempts have been blocked by compliance rules recently."
              />
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Invoice</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Contractor</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Reason</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {blockedPayments.map((p, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium">{p.invoice_number}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm">{p.contractor_name}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-destructive line-clamp-2">{p.blocked_reason}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-muted-foreground">
                            {new Date(p.blocked_at).toLocaleDateString('en-CA')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openOverrideDialog(p.contractor_id, 'PAYMENT_BLOCKED', p.contractor_name)}
                          >
                            Override
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Contractor List (overview / blocked / expiring tabs) */}
        {(activeTab === 'overview' || activeTab === 'blocked' || activeTab === 'expiring') && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search contractors..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {activeTab === 'overview' && (
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-44">
                    <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="compliant">Compliant</SelectItem>
                    <SelectItem value="expiring">Expiring</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <p className="text-sm text-muted-foreground ml-auto">
                {displayContractors.length} contractor{displayContractors.length !== 1 ? 's' : ''}
              </p>
            </div>

            {displayContractors.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="w-8 h-8 text-muted-foreground" />}
                title={
                  activeTab === 'blocked' ? 'No blocked contractors' :
                  activeTab === 'expiring' ? 'No expiring documents' :
                  'No contractors found'
                }
                description={
                  activeTab === 'blocked' ? 'All contractors are currently payment-ready.' :
                  activeTab === 'expiring' ? 'No compliance documents are expiring within 30 days.' :
                  'Try adjusting your search or filters.'
                }
              />
            ) : (
              <div className="space-y-2">
                {displayContractors.map(row => (
                  <ContractorComplianceRowComponent
                    key={row.contractor_id}
                    row={row}
                    onOverride={openOverrideDialog}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Override Dialog */}
      <CreateOverrideDialog
        open={overrideDialog.open}
        onClose={() => setOverrideDialog(d => ({ ...d, open: false }))}
        contractorId={overrideDialog.contractorId}
        issueType={overrideDialog.issueType}
        contractorName={overrideDialog.contractorName}
        onCreated={handleOverrideCreated}
      />
    </div>
  )
}

// ============================================
// SUB-COMPONENTS
// ============================================

function SummaryCard({
  icon,
  iconBg,
  label,
  value,
  total,
  highlight,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: number
  total?: number
  highlight?: 'warning' | 'destructive'
}) {
  return (
    <div className={`bg-card border rounded-xl p-5 ${
      highlight === 'destructive' && value > 0 ? 'border-destructive/20' :
      highlight === 'warning' && value > 0 ? 'border-warning/20' :
      'border-border'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <div>
          <p className={`text-2xl font-bold ${
            highlight === 'destructive' && value > 0 ? 'text-destructive' :
            highlight === 'warning' && value > 0 ? 'text-warning' :
            ''
          }`}>{value}</p>
          <p className="text-sm text-muted-foreground">
            {label}{total !== undefined ? ` / ${total}` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

function MiniStat({
  label,
  value,
  icon,
  variant,
}: {
  label: string
  value: number
  icon: React.ReactNode
  variant: 'default' | 'warning' | 'destructive'
}) {
  const colorClass =
    variant === 'destructive' && value > 0 ? 'text-destructive' :
    variant === 'warning' && value > 0 ? 'text-warning' :
    'text-muted-foreground'

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={colorClass}>{icon}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${colorClass}`}>{value}</span>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="bg-card border border-border rounded-xl px-6 py-16 flex flex-col items-center justify-center text-center">
      <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
    </div>
  )
}
