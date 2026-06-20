'use client'

// Invoice Queue - No mock data fallback, shows empty state when no invoices exist

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { 
  Calculator, Building2, Search, Filter, FileText, Eye, 
  CheckCircle2, Clock, AlertTriangle, XCircle, ChevronDown,
  Send, Check, X, Loader2, Banknote, ChevronRight, Timer,
  DollarSign, MapPin, LogOut
} from 'lucide-react'
import { MobileNav } from '@/components/layout/mobile-nav'
import { DataCard, DataCardHeader, DataCardRow } from '@/components/ui/responsive-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { Checkbox } from '@/components/ui/checkbox'
import Link from 'next/link'
import { approveInvoice, approveInvoicesBatch, rejectInvoice, getInvoiceQueue } from '../actions'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useListStatePreservation, useWorkflowNavigation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'

// Shape of an invoice row as rendered in the queue (mapped from the server action)
type QueueInvoice = {
  id: string
  dateSubmitted: string
  contractor: string
  contractorId: string
  project: string
  projectId: string
  invoiceNumber: string
  amount: number
  holdback: number
  netPayable: number
  status: string
  documentUrl: string
  invoiceDate: string
  dueDate: string
}

// Database invoice_status enum: 'draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'paid', 'partially_paid', 'disputed', 'revision_requested'
type InvoiceStatus = 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected' | 'paid' | 'partially_paid' | 'disputed' | 'revision_requested'

const statusConfig: Record<InvoiceStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: 'bg-muted/50 text-muted-foreground border-muted', icon: FileText },
  submitted: { label: 'Submitted', color: 'bg-warning/10 text-warning border-warning/20', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-primary/10 text-primary border-primary/20', icon: Send },
  approved: { label: 'Approved', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: XCircle },
  paid: { label: 'Paid', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  partially_paid: { label: 'Partially Paid', color: 'bg-primary/10 text-primary border-primary/20', icon: Clock },
  disputed: { label: 'Disputed', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle },
  revision_requested: { label: 'Revision Requested', color: 'bg-warning/10 text-warning border-warning/20', icon: AlertTriangle },
}

// Fallback for any status not present in statusConfig (e.g. a new enum value added in the
// database) so an unknown status can never crash a row render with "reading 'icon' of undefined".
const fallbackStatus = { label: 'Unknown', color: 'bg-muted/50 text-muted-foreground border-muted', icon: AlertTriangle }
const getStatusConfig = (status: string) => statusConfig[status as InvoiceStatus] ?? fallbackStatus

function AccountantQueueContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()
  const { toast } = useToast()
  
  // Permission-aware UI state
  const canApprove = hasPermission('approve_invoices')
  const canReject = hasPermission('reject_invoices')
  const canPay = hasPermission('process_payments')
  
  // Logout handler
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }
  
  // Invoice state - fetched from server action
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  
  // List state preservation (scroll position restored automatically)
  const { initialState } = useListStatePreservation('/accountant/queue')
  
  // Workflow navigation for tracking context
  const { navigateTo } = useWorkflowNavigation()
  
  // Navigate to invoice with context
  const goToInvoice = useCallback((invoice: QueueInvoice) => {
    navigateTo(`/accountant/invoices/${invoice.id}`, { title: invoice.invoiceNumber })
  }, [navigateTo])

  // Approved invoices move to the payment stage. Jump to the Payments page
  // with this invoice pre-selected so the accountant can pay it immediately.
  const goToPay = useCallback((invoice: QueueInvoice) => {
    navigateTo(`/accountant/payments?pay=${invoice.id}`, { title: invoice.invoiceNumber })
  }, [navigateTo])
  
  // Initialize state from URL params
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all')
  const [selectedInvoice, setSelectedInvoice] = useState<QueueInvoice | null>(null)
  const [isRejectOpen, setIsRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  // Multi-select batch approval
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBatchConfirmOpen, setIsBatchConfirmOpen] = useState(false)
  const [isBatchProcessing, setIsBatchProcessing] = useState(false)
  
  // Set mounted after hydration to prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Fetch ALL invoices on mount for stats calculation
  const [allInvoices, setAllInvoices] = useState<QueueInvoice[]>([])

  // Reusable loader so inline/batch actions can refresh the list after a mutation
  const loadInvoices = useCallback(async () => {
    try {
    // Always fetch all invoices for accurate stats
    const result = await getInvoiceQueue({ status: 'all' })

    if (result.success && Array.isArray(result.invoices) && result.invoices.length > 0) {
      const mapped = result.invoices.map((inv: Record<string, unknown>) => ({
        id: inv.id as string,
        dateSubmitted: inv.created_at as string,
        contractor: (inv.contractor as Record<string, unknown>)?.company_name as string || 'Unknown',
        contractorId: (inv.contractor as Record<string, unknown>)?.id as string || '',
        project: (inv.project as Record<string, unknown>)?.name as string || 'Unknown',
        projectId: (inv.project as Record<string, unknown>)?.id as string || '',
        invoiceNumber: inv.invoice_number as string,
        amount: ((inv.total_cents as number) || 0) / 100,
        holdback: ((inv.holdback_cents as number) || 0) / 100,
        netPayable: (((inv.net_payable_cents as number) ??
          (((inv.total_cents as number) || 0) - ((inv.holdback_cents as number) || 0))) || 0) / 100,
        status: inv.status as string,
        documentUrl: inv.document_url as string || '',
        invoiceDate: inv.invoice_date as string,
        dueDate: inv.due_date as string,
      }))
      setAllInvoices(mapped)
    } else {
      setAllInvoices([])
    }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])
  
  // Sync state to URL params - debounced to prevent rapid updates
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
      if (searchQuery) params.set('q', searchQuery)
      const queryString = params.toString()
      const newUrl = `${pathname}${queryString ? `?${queryString}` : ''}`
      
      // Only update if URL actually changed
      const currentUrl = `${pathname}${window.location.search}`
      if (newUrl !== currentUrl) {
        router.replace(newUrl, { scroll: false })
      }
    }, 300)
    
    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchQuery])

  // An invoice is overdue if it is still owing (not paid/rejected/draft) and past its due date.
  // Declared BEFORE filteredInvoices below — it is referenced in that filter, and a const/
  // useCallback is in the temporal dead zone until its declaration runs, so defining it first
  // prevents "Cannot access 'isOverdue' before initialization" when the overdue filter is active.
  const isOverdue = useCallback((inv: QueueInvoice) => {
    if (['paid', 'rejected', 'draft'].includes(inv.status)) return false
    if (!inv.dueDate) return false
    const due = new Date(inv.dueDate)
    if (Number.isNaN(due.getTime())) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return due < today
  }, [])

  // Filter invoices (search + status, with an "overdue" pseudo-status)
  const filteredInvoices = allInvoices.filter(invoice => {
    const matchesSearch = 
      invoice.contractor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'overdue'
          ? isOverdue(invoice)
          : invoice.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  // Dashboard metrics (computed from ALL invoices, not the filtered view).
  // Each card surfaces both a count and the dollars behind it so the accountant
  // immediately sees what needs review, what's payable, what's overdue, and what's blocked.
  const sumNet = (list: QueueInvoice[]) => list.reduce((s, i) => s + i.netPayable, 0)
  const submittedList = allInvoices.filter(i => i.status === 'submitted')
  const pendingList = allInvoices.filter(i => i.status === 'pending_approval')
  const approvedList = allInvoices.filter(i => i.status === 'approved')
  const overdueList = allInvoices.filter(isOverdue)
  const outstandingList = allInvoices.filter(i => !['paid', 'rejected', 'draft'].includes(i.status))

  const stats = {
    submitted: submittedList.length,
    submittedAmount: sumNet(submittedList),
    pendingApproval: pendingList.length,
    pendingAmount: sumNet(pendingList),
    approved: approvedList.length,
    approvedAmount: sumNet(approvedList),
    overdue: overdueList.length,
    overdueAmount: sumNet(overdueList),
    outstandingAmount: sumNet(outstandingList),
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  // Compact currency for dashboard cards (e.g. $1.2M, $45.7K) to avoid overflow
  const formatCompact = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // An invoice can be approved/rejected from the queue when the user has the
  // permission and the invoice is in a reviewable state.
  const isActionable = (inv: QueueInvoice) =>
    inv.status === 'submitted' || inv.status === 'pending_approval'

  // Inline single approve (no extra navigation)
  const approveOne = async (invoice: QueueInvoice) => {
    setIsProcessing(true)
    const result = await approveInvoice({ invoice_id: invoice.id })

    if (result.success) {
      toast({
        title: 'Invoice Approved',
        description: `Invoice ${invoice.invoiceNumber} has been approved for payment.`,
      })
      await loadInvoices()
    } else {
      toast({
        title: 'Approval Failed',
        description: result.error || 'Failed to approve invoice.',
        variant: 'destructive',
      })
    }
    setIsProcessing(false)
  }

  // Open the reject dialog for a specific invoice
  const openReject = (invoice: QueueInvoice) => {
    setSelectedInvoice(invoice)
    setRejectReason('')
    setIsRejectOpen(true)
  }

  const handleReject = async () => {
    if (!selectedInvoice) return

    if (!rejectReason.trim()) {
      toast({
        title: 'Reason required',
        description: 'Please provide a reason before rejecting this invoice.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)
    const result = await rejectInvoice({ invoice_id: selectedInvoice.id, reason: rejectReason })

    if (result.success) {
      toast({
        title: 'Invoice Rejected',
        description: `Invoice ${selectedInvoice.invoiceNumber} has been rejected. The contractor has been notified.`,
      })
      setIsRejectOpen(false)
      setRejectReason('')
      await loadInvoices()
    } else {
      toast({
        title: 'Rejection Failed',
        description: result.error || 'Failed to reject invoice.',
        variant: 'destructive',
      })
    }
    setIsProcessing(false)
  }

  // ---- Multi-select batch approval ----
  // Only approvable invoices in the current filtered view are selectable.
  const selectableInvoices = canApprove ? filteredInvoices.filter(isActionable) : []
  const selectedInvoices = allInvoices.filter(inv => selectedIds.has(inv.id))
  const selectedTotal = selectedInvoices.reduce((s, i) => s + i.netPayable, 0)
  const allSelectableSelected =
    selectableInvoices.length > 0 && selectableInvoices.every(inv => selectedIds.has(inv.id))

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableInvoices.map(inv => inv.id)))
    }
  }

  const handleBatchApprove = async () => {
    if (selectedIds.size === 0) return

    setIsBatchProcessing(true)
    const result = await approveInvoicesBatch({ invoice_ids: Array.from(selectedIds) })
    setIsBatchProcessing(false)
    setIsBatchConfirmOpen(false)

    if (result.success) {
      const approvedCount = result.data?.approvedCount ?? 0
      const failedCount = result.data?.failedCount ?? 0
      toast({
        title: failedCount > 0 ? 'Approved with some errors' : 'Invoices Approved',
        description:
          failedCount > 0
            ? `${approvedCount} approved, ${failedCount} could not be approved.`
            : `${approvedCount} invoice(s) approved for payment.`,
        variant: failedCount > 0 ? 'destructive' : undefined,
      })
      setSelectedIds(new Set())
      await loadInvoices()
    } else {
      toast({
        title: 'Batch Approval Failed',
        description: result.error || 'Failed to approve the selected invoices.',
        variant: 'destructive',
      })
    }
  }

return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="AP Inbox"
        pageDescription="Review, verify, and process incoming invoices and payment requests."
      />
      <RoleTabBar role="accountant" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-20 md:pb-8">
        <div className="space-y-4 md:space-y-6">
          {/* Page Header Actions */}
          <div className="flex items-center justify-end gap-3">
            <div className="flex items-center gap-3">
              <WorkflowLink href="/accountant/holdbacks" contextTitle="Holdback Ledger">
                <Button variant="outline" className="gap-2">
                  <Timer className="w-4 h-4" />
                  Holdback Ledger
                </Button>
              </WorkflowLink>
              <WorkflowLink href="/accountant/payments" contextTitle="Payment Run">
                <Button className="gap-2">
                  <Banknote className="w-4 h-4" />
                  Payment Run
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </WorkflowLink>
            </div>
          </div>

          {/* Dashboard band - answers "what needs review / payment / is overdue / is waiting"
              with both a count and the dollars behind it. Each card filters the list below. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4" suppressHydrationWarning>
            {/* Needs Review (submitted) */}
            <button
              onClick={() => setStatusFilter('submitted')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-warning/50 ${mounted && statusFilter === 'submitted' ? 'border-warning ring-2 ring-warning/20' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-warning/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 md:w-5 md:h-5 text-warning" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold leading-tight" suppressHydrationWarning>{mounted ? stats.submitted : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Needs Review</p>
                  <p className="text-xs font-medium text-foreground/80 truncate" suppressHydrationWarning>{mounted ? formatCompact(stats.submittedAmount) : ''}</p>
                </div>
              </div>
            </button>
            {/* Waiting on PM (pending_approval) */}
            <button
              onClick={() => setStatusFilter('pending_approval')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-primary/50 ${mounted && statusFilter === 'pending_approval' ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Send className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold leading-tight" suppressHydrationWarning>{mounted ? stats.pendingApproval : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Waiting on PM</p>
                  <p className="text-xs font-medium text-foreground/80 truncate" suppressHydrationWarning>{mounted ? formatCompact(stats.pendingAmount) : ''}</p>
                </div>
              </div>
            </button>
            {/* Ready to Pay (approved) */}
            <button
              onClick={() => setStatusFilter('approved')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-success/50 ${mounted && statusFilter === 'approved' ? 'border-success ring-2 ring-success/20' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-success/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 text-success" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold leading-tight" suppressHydrationWarning>{mounted ? stats.approved : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Ready to Pay</p>
                  <p className="text-xs font-medium text-success truncate" suppressHydrationWarning>{mounted ? formatCompact(stats.approvedAmount) : ''}</p>
                </div>
              </div>
            </button>
            {/* Overdue (owing + past due date) */}
            <button
              onClick={() => setStatusFilter('overdue')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-destructive/50 ${mounted && statusFilter === 'overdue' ? 'border-destructive ring-2 ring-destructive/20' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-destructive/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold leading-tight" suppressHydrationWarning>{mounted ? stats.overdue : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Overdue</p>
                  <p className="text-xs font-medium text-destructive truncate" suppressHydrationWarning>{mounted ? formatCompact(stats.overdueAmount) : ''}</p>
                </div>
              </div>
            </button>
            {/* Total Outstanding (all unpaid) */}
            <button
              onClick={() => setStatusFilter('all')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-foreground/30 ${mounted && statusFilter === 'all' ? 'border-foreground/40 ring-2 ring-foreground/10' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold leading-tight truncate" suppressHydrationWarning>{mounted ? formatCompact(stats.outstandingAmount) : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Outstanding</p>
                  <p className="text-xs font-medium text-foreground/80 truncate">All open invoices</p>
                </div>
              </div>
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search invoices..."
                className="pl-9 h-11 touch-manipulation"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 touch-manipulation">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="submitted">Needs Review</SelectItem>
                <SelectItem value="pending_approval">Waiting on PM</SelectItem>
                <SelectItem value="approved">Ready to Pay</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Batch select toolbar - appears when there are approvable invoices in view */}
          {canApprove && selectableInvoices.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <Checkbox
                  checked={allSelectableSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all approvable invoices"
                />
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `Select all ${selectableInvoices.length} approvable`}
                </span>
              </label>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-sm font-medium">
                    {formatCurrency(selectedTotal)}
                  </span>
                  <Button size="sm" className="gap-2" onClick={() => setIsBatchConfirmOpen(true)}>
                    <Check className="w-4 h-4" />
                    Approve {selectedIds.size}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">No invoices found</p>
              </div>
            ) : (
              filteredInvoices.map((invoice) => {
                const status = getStatusConfig(invoice.status)
                const StatusIcon = status.icon
                return (
                  <DataCard 
                    key={invoice.id} 
                    className="touch-manipulation"
                    onClick={() => goToInvoice(invoice)}
                  >
                    <DataCardHeader
                      title={invoice.contractor}
                      subtitle={invoice.project}
                      badge={
                        <Badge variant="outline" className={`${status.color} text-xs`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {status.label}
                        </Badge>
                      }
                      actions={<ChevronRight className="w-5 h-5 text-muted-foreground" />}
                    />
                    
                    <div className="flex items-center gap-2 text-sm">
                      <code className="font-mono bg-muted px-2 py-0.5 rounded text-xs">
                        {invoice.invoiceNumber}
                      </code>
                      <span className="text-muted-foreground">
                        {formatDate(invoice.dateSubmitted)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Amount</p>
                        <p className="text-sm font-medium">{formatCurrency(invoice.amount)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Holdback</p>
                        <p className="text-sm font-medium text-warning">-{formatCurrency(invoice.holdback)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Net</p>
                        <p className="text-sm font-semibold">{formatCurrency(invoice.netPayable)}</p>
                      </div>
                    </div>

                    {/* Inline actions for reviewable invoices */}
                    {isActionable(invoice) && (canApprove || canReject) && (
                      <div
                        className="flex items-center gap-2 pt-3 border-t border-border"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canApprove && (
                          <>
                            <Checkbox
                              checked={selectedIds.has(invoice.id)}
                              onCheckedChange={() => toggleSelect(invoice.id)}
                              aria-label={`Select invoice ${invoice.invoiceNumber}`}
                            />
                            <Button
                              size="sm"
                              className="flex-1 h-10 touch-manipulation"
                              onClick={() => approveOne(invoice)}
                              disabled={isProcessing}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                          </>
                        )}
                        {canReject && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-10 text-destructive hover:text-destructive touch-manipulation"
                            onClick={() => openReject(invoice)}
                            disabled={isProcessing}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Approved invoices: shortcut to pay */}
                    {invoice.status === 'approved' && canPay && (
                      <div
                        className="pt-3 border-t border-border"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          className="w-full h-10 touch-manipulation"
                          onClick={() => goToPay(invoice)}
                        >
                          <Banknote className="w-4 h-4 mr-1" />
                          Pay {formatCurrency(invoice.netPayable)}
                        </Button>
                      </div>
                    )}
                  </DataCard>
                )
              })
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {canApprove && (
                      <th className="px-6 py-4 w-10">
                        <Checkbox
                          checked={allSelectableSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all approvable invoices"
                          disabled={selectableInvoices.length === 0}
                        />
                      </th>
                    )}
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Date</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Contractor</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Project</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Invoice #</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Amount</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Holdback</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Net Payable</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
              {filteredInvoices.map((invoice) => {
                const status = getStatusConfig(invoice.status)
                const StatusIcon = status.icon
                return (
                  <tr
                        key={invoice.id} 
                        className={`hover:bg-muted/20 transition-colors cursor-pointer ${selectedIds.has(invoice.id) ? 'bg-primary/5' : ''}`}
                        onClick={() => goToInvoice(invoice)}
                      >
                        {canApprove && (
                          <td className="px-6 py-4 w-10" onClick={(e) => e.stopPropagation()}>
                            {isActionable(invoice) && (
                              <Checkbox
                                checked={selectedIds.has(invoice.id)}
                                onCheckedChange={() => toggleSelect(invoice.id)}
                                aria-label={`Select invoice ${invoice.invoiceNumber}`}
                              />
                            )}
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {formatDate(invoice.dateSubmitted)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm font-medium">{invoice.contractor}</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm text-muted-foreground">{invoice.project}</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                            {invoice.invoiceNumber}
                          </code>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {formatCurrency(invoice.amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-warning">
                          -{formatCurrency(invoice.holdback)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold">
                          {formatCurrency(invoice.netPayable)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge variant="outline" className={status.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {isActionable(invoice) && canApprove && (
                              <Button
                                size="sm"
                                className="h-8 gap-1"
                                onClick={() => approveOne(invoice)}
                                disabled={isProcessing}
                              >
                                <Check className="w-4 h-4" />
                                Approve
                              </Button>
                            )}
                            {isActionable(invoice) && canReject && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 text-destructive hover:text-destructive"
                                onClick={() => openReject(invoice)}
                                disabled={isProcessing}
                              >
                                <XCircle className="w-4 h-4" />
                                Reject
                              </Button>
                            )}
                            {invoice.status === 'approved' && canPay && (
                              <Button
                                size="sm"
                                className="h-8 gap-1"
                                onClick={() => goToPay(invoice)}
                              >
                                <Banknote className="w-4 h-4" />
                                Pay
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={() => goToInvoice(invoice)}
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {filteredInvoices.length === 0 && (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">No invoices found matching your criteria</p>
              </div>
            )}
          </div>

          {/* Mobile Bottom Spacer */}
          <div className="h-16 md:hidden" />
        </div>
      </main>

      {/* Reject Modal */}
      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Reject Invoice
            </DialogTitle>
            <DialogDescription>
              Rejecting returns this invoice to the contractor. Provide a clear reason — they will be notified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="rejectReason">Reason for Rejection *</Label>
            <Textarea
              id="rejectReason"
              placeholder="Explain why this invoice is being rejected..."
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={!rejectReason.trim() || isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4 mr-2" />
              )}
              Reject Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Approval Confirmation */}
      <Dialog open={isBatchConfirmOpen} onOpenChange={setIsBatchConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
              Approve {selectedIds.size} {selectedIds.size === 1 ? 'Invoice' : 'Invoices'}
            </DialogTitle>
            <DialogDescription>
              You are about to approve {selectedIds.size}{' '}
              {selectedIds.size === 1 ? 'invoice' : 'invoices'} totaling{' '}
              <span className="font-semibold text-foreground">{formatCurrency(selectedTotal)}</span>{' '}
              (net payable) for payment. This action is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsBatchConfirmOpen(false)}
              disabled={isBatchProcessing}
            >
              Cancel
            </Button>
            <Button onClick={handleBatchApprove} disabled={isBatchProcessing}>
              {isBatchProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Approve {selectedIds.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Wrap in Suspense boundary for useSearchParams
export default function AccountantQueuePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <AccountantQueueContent />
    </Suspense>
  )
}
