'use client'

// Invoice Queue - No mock data fallback, shows empty state when no invoices exist

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { 
  Calculator, Building2, Search, Filter, FileText, Eye, 
  CheckCircle2, Clock, AlertTriangle, XCircle, ChevronDown,
  Download, Send, Ban, Check, X, Loader2, Banknote, ChevronRight, Timer,
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
import Link from 'next/link'
import { approveInvoice, rejectInvoice, getInvoiceQueue } from '../actions'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'
import { useListStatePreservation, useWorkflowNavigation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'

// Mock invoice data
const mockInvoices = [
  {
    id: 'inv-1',
    dateSubmitted: '2024-03-05',
    contractor: 'ABC Electric Ltd.',
    contractorId: 'cont-1',
    project: 'Downtown Office Tower',
    projectId: 'proj-1',
    invoiceNumber: 'INV-2024-0142',
    amount: 45750.00,
    holdback: 4575.00,
    netPayable: 41175.00,
    status: 'pending_review',
    documentUrl: '/mock-invoice.pdf',
    invoiceDate: '2024-03-01',
    dueDate: '2024-03-31',
  },
  {
    id: 'inv-2',
    dateSubmitted: '2024-03-04',
    contractor: 'ProPlumb Solutions',
    contractorId: 'cont-2',
    project: 'Harbourfront Condo Development',
    projectId: 'proj-2',
    invoiceNumber: 'PP-2024-089',
    amount: 28500.00,
    holdback: 2850.00,
    netPayable: 25650.00,
    status: 'pm_approval',
    documentUrl: '/mock-invoice.pdf',
    invoiceDate: '2024-03-02',
    dueDate: '2024-04-01',
  },
  {
    id: 'inv-3',
    dateSubmitted: '2024-03-03',
    contractor: 'Steel Masters Inc.',
    contractorId: 'cont-3',
    project: 'Industrial Park Expansion',
    projectId: 'proj-4',
    invoiceNumber: 'SM-INV-2024-033',
    amount: 125000.00,
    holdback: 12500.00,
    netPayable: 112500.00,
    status: 'approved',
    documentUrl: '/mock-invoice.pdf',
    invoiceDate: '2024-02-28',
    dueDate: '2024-03-29',
  },
  {
    id: 'inv-4',
    dateSubmitted: '2024-03-02',
    contractor: 'GlassWorks Pro',
    contractorId: 'cont-4',
    project: 'Downtown Office Tower',
    projectId: 'proj-1',
    invoiceNumber: 'GWP-2024-0067',
    amount: 67800.00,
    holdback: 6780.00,
    netPayable: 61020.00,
    status: 'disputed',
    documentUrl: '/mock-invoice.pdf',
    invoiceDate: '2024-02-25',
    dueDate: '2024-03-26',
  },
  {
    id: 'inv-5',
    dateSubmitted: '2024-03-01',
    contractor: 'HVAC Solutions Corp.',
    contractorId: 'cont-5',
    project: 'Westside Shopping Centre',
    projectId: 'proj-3',
    invoiceNumber: 'HVAC-2024-155',
    amount: 89250.00,
    holdback: 8925.00,
    netPayable: 80325.00,
    status: 'pending_review',
    documentUrl: '/mock-invoice.pdf',
    invoiceDate: '2024-02-27',
    dueDate: '2024-03-28',
  },
]

// Database invoice_status enum: 'draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'paid', 'partially_paid', 'disputed'
type InvoiceStatus = 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected' | 'paid' | 'partially_paid' | 'disputed'

const statusConfig: Record<InvoiceStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: 'bg-muted/50 text-muted-foreground border-muted', icon: FileText },
  submitted: { label: 'Submitted', color: 'bg-warning/10 text-warning border-warning/20', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-primary/10 text-primary border-primary/20', icon: Send },
  approved: { label: 'Approved', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: XCircle },
  paid: { label: 'Paid', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  partially_paid: { label: 'Partially Paid', color: 'bg-primary/10 text-primary border-primary/20', icon: Clock },
  disputed: { label: 'Disputed', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle },
}

function AccountantQueueContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()
  const { toast } = useToast()
  
  // Permission-aware UI state
  const canApprove = hasPermission('approve_invoices')
  const canReject = hasPermission('reject_invoices')
  
  // Logout handler
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }
  
  // Invoice state - fetched from server action
  const [invoices, setInvoices] = useState<typeof mockInvoices>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  
  // List state preservation (scroll position restored automatically)
  const { initialState } = useListStatePreservation('/accountant/queue')
  
  // Workflow navigation for tracking context
  const { navigateTo } = useWorkflowNavigation()
  
  // Navigate to invoice with context
  const goToInvoice = useCallback((invoice: typeof mockInvoices[0]) => {
    navigateTo(`/invoices/${invoice.id}`, invoice.invoiceNumber)
  }, [navigateTo])
  
  // Initialize state from URL params
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all')
  const [selectedInvoice, setSelectedInvoice] = useState<typeof mockInvoices[0] | null>(null)
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isDisputeOpen, setIsDisputeOpen] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [shortPayAmount, setShortPayAmount] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Set mounted after hydration to prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Fetch ALL invoices on mount for stats calculation
  const [allInvoices, setAllInvoices] = useState<typeof invoices>([])
  
  useEffect(() => {
    const fetchAllInvoices = async () => {
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
          netPayable: (((inv.total_cents as number) || 0) - ((inv.holdback_cents as number) || 0)) / 100,
          status: inv.status as string,
          documentUrl: inv.document_url as string || '',
          invoiceDate: inv.invoice_date as string,
          dueDate: inv.due_date as string,
        }))
        setAllInvoices(mapped)
        // Also set filtered invoices initially
        setInvoices(mapped)
      } else {
        setAllInvoices([])
        setInvoices([])
      }
      setLoading(false)
    }
    
    fetchAllInvoices()
  }, [])
  
  // Filter invoices when status filter changes (client-side filtering)
  useEffect(() => {
    if (statusFilter === 'all' || !statusFilter) {
      setInvoices(allInvoices)
    } else {
      setInvoices(allInvoices.filter(inv => inv.status === statusFilter))
    }
  }, [statusFilter, allInvoices])

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

  // Filter invoices
  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.contractor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  // Stats - using database enum values (from ALL invoices, not filtered)
  const stats = {
    submitted: allInvoices.filter(i => i.status === 'submitted').length,
    pendingApproval: allInvoices.filter(i => i.status === 'pending_approval').length,
    approved: allInvoices.filter(i => i.status === 'approved').length,
    disputed: allInvoices.filter(i => i.status === 'disputed').length,
    paid: allInvoices.filter(i => i.status === 'paid').length,
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const handleReview = (invoice: typeof mockInvoices[0]) => {
    setSelectedInvoice(invoice)
    setIsReviewOpen(true)
  }

  const handleApprove = async () => {
    if (!selectedInvoice) return
    
    setIsProcessing(true)
    const result = await approveInvoice(selectedInvoice.id)
    
    if (result.success) {
      toast({
        title: 'Invoice Approved',
        description: `Invoice ${selectedInvoice.invoiceNumber} has been approved for payment.`,
      })
      setIsReviewOpen(false)
    } else {
      toast({
        title: 'Approval Failed',
        description: result.error || 'Failed to approve invoice.',
        variant: 'destructive',
      })
    }
    setIsProcessing(false)
  }

  const handleRouteToPM = async () => {
    setIsProcessing(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsProcessing(false)
    setIsReviewOpen(false)
    // In production, this would update the invoice status and notify PM
  }

  const handleDispute = async () => {
    if (!selectedInvoice) return
    
    setIsProcessing(true)
    const result = await rejectInvoice(selectedInvoice.id, disputeReason)
    
    if (result.success) {
      toast({
        title: 'Invoice Rejected',
        description: `Invoice ${selectedInvoice.invoiceNumber} has been rejected.`,
      })
      setIsDisputeOpen(false)
      setIsReviewOpen(false)
      setDisputeReason('')
      setShortPayAmount('')
    } else {
      toast({
        title: 'Rejection Failed',
        description: result.error || 'Failed to reject invoice.',
        variant: 'destructive',
      })
    }
    setIsProcessing(false)
  }

return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="AP Inbox"
        pageDescription="Review, verify, and process incoming invoices and payment requests."
      />

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

          {/* Stats Overview Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4" suppressHydrationWarning>
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
                  <p className="text-xl md:text-2xl font-semibold" suppressHydrationWarning>{mounted ? stats.submitted : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Submitted</p>
                </div>
              </div>
            </button>
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
                  <p className="text-xl md:text-2xl font-semibold" suppressHydrationWarning>{mounted ? stats.pendingApproval : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Pending Approval</p>
                </div>
              </div>
            </button>
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
                  <p className="text-xl md:text-2xl font-semibold" suppressHydrationWarning>{mounted ? stats.approved : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Approved</p>
                </div>
              </div>
            </button>
            <button 
              onClick={() => setStatusFilter('disputed')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-destructive/50 ${mounted && statusFilter === 'disputed' ? 'border-destructive ring-2 ring-destructive/20' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-destructive/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold" suppressHydrationWarning>{mounted ? stats.disputed : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Disputed</p>
                </div>
              </div>
            </button>
            <button 
              onClick={() => setStatusFilter('paid')}
              className={`bg-card border rounded-xl p-3 md:p-5 text-left transition-all hover:shadow-md hover:border-blue-500/50 ${mounted && statusFilter === 'paid' ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-border'}`}
              suppressHydrationWarning
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Banknote className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold" suppressHydrationWarning>{mounted ? stats.paid : '-'}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Paid</p>
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
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">No invoices found</p>
              </div>
            ) : (
              filteredInvoices.map((invoice) => {
                const status = statusConfig[invoice.status as InvoiceStatus]
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
                    const status = statusConfig[invoice.status as InvoiceStatus]
                    const StatusIcon = status.icon
                    return (
                      <tr 
                        key={invoice.id} 
                        className="hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => goToInvoice(invoice)}
                      >
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => goToInvoice(invoice)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            View
                          </Button>
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

      {/* Invoice Review Modal */}
      <Dialog open={isReviewOpen} onOpenChange={setIsReviewOpen}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-hidden p-0 md:p-6">
          <div className="p-4 md:p-0">
            <DialogHeader>
              <DialogTitle>Invoice Review</DialogTitle>
              <DialogDescription>
                Review invoice details and take action
              </DialogDescription>
            </DialogHeader>
          </div>

          {selectedInvoice && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 max-h-[calc(90vh-140px)] overflow-y-auto px-4 pb-4 md:px-0 md:pb-0">
              {/* Left Side - Document Preview (Hidden on mobile, shown as button) */}
              <div className="hidden lg:block space-y-4">
                <h3 className="font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Invoice Document
                </h3>
                <div className="bg-muted/50 border border-border rounded-xl aspect-[8.5/11] flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto">
                      <FileText className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">Invoice PDF Preview</p>
                      <p className="text-sm text-muted-foreground">
                        OCR data extracted automatically
                      </p>
                    </div>
                    <Button variant="outline" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      Download PDF
                    </Button>
                  </div>
                </div>
              </div>

              {/* Mobile PDF Download Button */}
              <div className="lg:hidden">
                <Button variant="outline" className="w-full h-12 touch-manipulation">
                  <FileText className="w-4 h-4 mr-2" />
                  View Invoice PDF
                  <Download className="w-4 h-4 ml-auto" />
                </Button>
              </div>

              {/* Right Side - Invoice Details */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium">Invoice Details</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs uppercase">Invoice Number</Label>
                      <p className="font-mono font-medium">{selectedInvoice.invoiceNumber}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs uppercase">Invoice Date</Label>
                      <p className="font-medium">{formatDate(selectedInvoice.invoiceDate)}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs uppercase">Due Date</Label>
                      <p className="font-medium">{formatDate(selectedInvoice.dueDate)}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs uppercase">Status</Label>
                      <Badge variant="outline" className={statusConfig[selectedInvoice.status as InvoiceStatus].color}>
                        {statusConfig[selectedInvoice.status as InvoiceStatus].label}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-medium">Contractor & Project</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs uppercase">Contractor</Label>
                      <p className="font-medium">{selectedInvoice.contractor}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs uppercase">Project</Label>
                      <p className="font-medium">{selectedInvoice.project}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-medium">Payment Summary</h3>
                  
                  <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Invoice Amount</span>
                      <span className="font-medium">{formatCurrency(selectedInvoice.amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">10% Statutory Holdback</span>
                      <span className="font-medium text-warning">-{formatCurrency(selectedInvoice.holdback)}</span>
                    </div>
                    <div className="pt-3 border-t border-border flex justify-between">
                      <span className="font-medium">Net Payable</span>
                      <span className="font-semibold text-lg">{formatCurrency(selectedInvoice.netPayable)}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <Button 
                    className="w-full h-12 touch-manipulation" 
                    onClick={handleApprove}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    Approve for Payment
                  </Button>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button 
                      variant="secondary" 
                      className="h-12 touch-manipulation"
                      onClick={handleRouteToPM}
                      disabled={isProcessing}
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Route to PM
                    </Button>
                    <Button 
                      variant="outline" 
                      className="h-12 text-destructive hover:text-destructive touch-manipulation"
                      onClick={() => setIsDisputeOpen(true)}
                      disabled={isProcessing}
                    >
                      <Ban className="w-4 h-4 mr-2" />
                      Dispute
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dispute Modal */}
      <Dialog open={isDisputeOpen} onOpenChange={setIsDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Dispute / Short-Pay Invoice
            </DialogTitle>
            <DialogDescription>
              Document the reason for disputing or short-paying this invoice.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shortPayAmount">Short-Pay Amount (Optional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="shortPayAmount"
                  type="number"
                  step="0.01"
                  placeholder="Leave blank to reject entirely"
                  className="pl-7"
                  value={shortPayAmount}
                  onChange={(e) => setShortPayAmount(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Enter the amount you will pay, or leave blank to reject the entire invoice.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="disputeReason">Reason for Dispute *</Label>
              <Textarea
                id="disputeReason"
                placeholder="Describe the issue with this invoice..."
                rows={4}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDisputeOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDispute}
              disabled={!disputeReason || isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4 mr-2" />
              )}
              Submit Dispute
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
