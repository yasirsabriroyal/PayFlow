'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, FileText, Building2, Calendar, DollarSign, 
  CheckCircle2, Clock, AlertTriangle, XCircle, Download,
  Send, CreditCard, Banknote, History, Paperclip, User,
  MapPin, Phone, Mail, Hash, RefreshCw, Printer, MoreHorizontal,
  ChevronRight, ExternalLink, Shield, Receipt
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { RoleTabBar } from '@/components/role-tab-bar'
import { 
  getInvoiceById, 
  approveInvoice, 
  rejectInvoice,
  getInvoicePaymentInfo,
  recordDirectInvoicePayment,
  recordCertificatePayment
} from '../../actions'

// Helper function to format currency
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)
}

// Helper function to format date
function formatDate(dateString: string | null) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Helper to get status info
function getStatusInfo(status: string) {
  const statusMap: Record<string, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
    draft: { label: 'Draft', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: FileText },
    submitted: { label: 'Submitted', color: 'text-warning', bgColor: 'bg-warning/10', icon: Clock },
    pending_approval: { label: 'Pending Approval', color: 'text-primary', bgColor: 'bg-primary/10', icon: Send },
    approved: { label: 'Approved', color: 'text-success', bgColor: 'bg-success/10', icon: CheckCircle2 },
    payment_processing: { label: 'Processing', color: 'text-blue-500', bgColor: 'bg-blue-500/10', icon: RefreshCw },
    paid: { label: 'Paid', color: 'text-success', bgColor: 'bg-success/10', icon: Banknote },
    disputed: { label: 'Disputed', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: AlertTriangle },
    rejected: { label: 'Rejected', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: XCircle },
    cancelled: { label: 'Cancelled', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: XCircle },
  }
  return statusMap[status] || { label: status, color: 'text-muted-foreground', bgColor: 'bg-muted', icon: FileText }
}

// Type definitions
interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  subtotal_cents: number
  gst_hst_cents: number
  gst_hst_rate: number
  pst_cents: number
  pst_rate: number
  qst_cents: number
  qst_rate: number
  total_cents: number
  holdback_cents: number
  holdback_percent: number
  net_payable_cents: number
  amount_paid_cents: number
  amount_remaining_cents: number
  status: string
  source: string
  document_url: string
  created_at: string
  updated_at: string
  contractor: {
    id: string
    company_name: string
    contact_name: string
    email: string
    phone: string
    address_line1: string
    city: string
    province: string
    postal_code: string
    bank_name: string
    bank_institution_number: string
    bank_transit_number: string
    bank_account_number: string
    wcb_clearance_expiry: string
    status: string
  }
  project: {
    id: string
    name: string
    project_number: string
    city: string
    province: string
    start_date: string
    estimated_completion_date: string
    current_budget_cents: number
    spent_cents: number
  }
  change_order: {
    id: string
    co_number: string
    description: string
    amount_cents: number
    status: string
  } | null
}

interface Payment {
  id: string
  amount_cents: number
  payment_method: string
  payment_date: string
  status: string
  batch_reference: string
  cheque_number: string
  etransfer_reference: string
  wire_reference: string
  notes: string
  created_at: string
  processed_by: string
}

interface Holdback {
  id: string
  holdback_amount_cents: number
  holdback_percent: number
  status: string
  release_due_date: string
  countdown_start_date: string
  released_at: string
  released_amount_cents: number
  notes: string
}

interface Attachment {
  id: string
  file_name: string
  file_type: string
  file_url: string
  file_size_bytes: number
  created_at: string
}

interface AuditEntry {
  id: string
  action: string
  description: string
  user_id: string
  created_at: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
}

interface PaymentCertificate {
  id: string
  certificate_number: string
  certified_amount_cents: number
  net_payable_cents: number
  holdback_amount_cents: number
  status: string
  created_at: string
  approved_at: string
  work_period_start: string
  work_period_end: string
  payments: Array<{
    id: string
    amount_cents: number
    payment_date: string
    status: string
    payment_method: string
  }>
  total_paid_cents: number
  remaining_cents: number
  is_fully_paid: boolean
}

interface PaymentInfo {
  paymentMode: 'direct' | 'certificate'
  invoice: {
    id: string
    invoice_number: string
    net_payable_cents: number
    total_paid_cents: number
    remaining_cents: number
    status: string
  }
  certificates: PaymentCertificate[]
  directPayments: Array<{
    id: string
    amount_cents: number
    payment_date: string
    status: string
    payment_method: string
    notes: string
  }>
  summary: {
    certificate_count: number
    total_certified_cents: number
    total_paid_cents: number
    total_remaining_cents: number
    has_certificates: boolean
    unpaid_certificate_count: number
  }
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const invoiceId = params.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [paymentRequests, setPaymentRequests] = useState<Array<{
    id: string
    request_number: string
    requested_amount_cents: number
    approved_amount_cents: number
    status: string
    payment_method: string
    payment_reference: string
    created_at: string
    processed_at: string
  }>>([])
  const [holdbacks, setHoldbacks] = useState<Holdback[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  
  // Payment state
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [selectedCertificates, setSelectedCertificates] = useState<string[]>([])
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_method: 'eft' as 'eft' | 'cheque' | 'wire' | 'etransfer',
    payment_date: new Date().toISOString().split('T')[0],
    payment_reference: '',
    cheque_number: '',
    notes: '',
  })

  // Fetch invoice data
  useEffect(() => {
    const fetchInvoice = async () => {
      const result = await getInvoiceById(invoiceId)
      if (result.success && result.invoice) {
        setInvoice(result.invoice as unknown as Invoice)
        setPayments(result.payments as unknown as Payment[])
        setPaymentRequests(result.paymentRequests as typeof paymentRequests)
        setHoldbacks(result.holdbacks as Holdback[])
        setAttachments(result.attachments as Attachment[])
        setAuditLog(result.auditLog as AuditEntry[])
        
        // Fetch payment info for conditional payment UI
        const paymentInfoResult = await getInvoicePaymentInfo(invoiceId)
        if (paymentInfoResult.success) {
          setPaymentInfo(paymentInfoResult as PaymentInfo)
        }
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to load invoice',
          variant: 'destructive',
        })
      }
      setLoading(false)
    }
    fetchInvoice()
  }, [invoiceId, toast])

  // Action handlers
  const handleApprove = async () => {
    setActionLoading(true)
    const result = await approveInvoice({ invoice_id: invoiceId })
    if (result.success) {
      setInvoice(prev => prev ? { ...prev, status: 'approved' } : null)
      toast({ title: 'Invoice Approved', description: 'Invoice has been approved for payment.' })
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to approve invoice', variant: 'destructive' })
    }
    setActionLoading(false)
  }

  // Open payment dialog
  const openPaymentDialog = () => {
    setPaymentForm({
      amount: '',
      payment_method: 'eft',
      payment_date: new Date().toISOString().split('T')[0],
      payment_reference: '',
      cheque_number: '',
      notes: '',
    })
    setSelectedCertificates([])
    setPaymentDialogOpen(true)
  }

  // Handle payment submission
  const handleProcessPayment = async () => {
    if (!paymentInfo) return
    
    const amountCents = Math.round(parseFloat(paymentForm.amount || '0') * 100)

    if (paymentInfo.paymentMode === 'direct' && amountCents <= 0) {
      toast({ title: 'Error', description: 'Please enter a valid payment amount', variant: 'destructive' })
      return
    }
    
    setPaymentLoading(true)
    
    try {
      if (paymentInfo.paymentMode === 'direct') {
        // Direct invoice payment
        const result = await recordDirectInvoicePayment({
          invoice_id: invoiceId,
          amount_cents: amountCents,
          payment_method: paymentForm.payment_method,
          payment_date: paymentForm.payment_date,
          payment_reference: paymentForm.payment_reference || undefined,
          cheque_number: paymentForm.cheque_number || undefined,
          notes: paymentForm.notes || undefined,
        })
        
        if (result.success) {
          toast({ title: 'Payment Recorded', description: result.message })
          setPaymentDialogOpen(false)
          // Refresh data
          const refreshResult = await getInvoiceById(invoiceId)
          if (refreshResult.success && refreshResult.invoice) {
            setInvoice(refreshResult.invoice as unknown as Invoice)
            setPayments(refreshResult.payments as unknown as Payment[])
          }
          const paymentInfoResult = await getInvoicePaymentInfo(invoiceId)
          if (paymentInfoResult.success) {
            setPaymentInfo(paymentInfoResult as PaymentInfo)
          }
        } else {
          toast({ title: 'Error', description: result.error || 'Failed to process payment', variant: 'destructive' })
        }
      } else {
        // Certificate-based payment - process selected certificates
        if (selectedCertificates.length === 0) {
          toast({ title: 'Error', description: 'Please select at least one certificate to pay', variant: 'destructive' })
          setPaymentLoading(false)
          return
        }
        
        // Process each selected certificate
        let successCount = 0
        for (const certId of selectedCertificates) {
          const cert = paymentInfo.certificates.find(c => c.id === certId)
          if (!cert || cert.is_fully_paid) continue
          
          const certPaymentAmount = Math.max(0, cert.certified_amount_cents - cert.total_paid_cents)
          
          const result = await recordCertificatePayment({
            certificate_id: certId,
            amount_cents: certPaymentAmount,
            payment_method: paymentForm.payment_method,
            payment_date: paymentForm.payment_date,
            cheque_number: paymentForm.cheque_number || undefined,
            notes: paymentForm.notes || undefined,
          })
          
          if (result.success) {
            successCount++
          }
        }
        
        if (successCount > 0) {
          toast({ 
            title: 'Payments Recorded', 
            description: `Successfully processed ${successCount} certificate payment(s)` 
          })
          setPaymentDialogOpen(false)
          // Refresh data
          const refreshResult = await getInvoiceById(invoiceId)
          if (refreshResult.success && refreshResult.invoice) {
            setInvoice(refreshResult.invoice as unknown as Invoice)
            setPayments(refreshResult.payments as unknown as Payment[])
          }
          const paymentInfoResult = await getInvoicePaymentInfo(invoiceId)
          if (paymentInfoResult.success) {
            setPaymentInfo(paymentInfoResult as PaymentInfo)
          }
        } else {
          toast({ title: 'Error', description: 'Failed to process certificate payments', variant: 'destructive' })
        }
      }
    } catch {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally {
      setPaymentLoading(false)
    }
  }

  // Toggle certificate selection
  const toggleCertificateSelection = (certId: string) => {
    setSelectedCertificates(prev => 
      prev.includes(certId) 
        ? prev.filter(id => id !== certId)
        : [...prev, certId]
    )
  }

  // Calculate selected certificates total
  const getSelectedCertificatesTotal = () => {
    if (!paymentInfo) return 0
    return paymentInfo.certificates
      .filter(c => selectedCertificates.includes(c.id) && !c.is_fully_paid)
      .reduce((sum, c) => sum + Math.max(0, c.certified_amount_cents - c.total_paid_cents), 0)
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast({ title: 'Error', description: 'Please provide a rejection reason', variant: 'destructive' })
      return
    }
    setActionLoading(true)
    const result = await rejectInvoice({ invoice_id: invoiceId, reason: rejectReason })
    if (result.success) {
      setInvoice(prev => prev ? { ...prev, status: 'rejected' } : null)
      setRejectDialogOpen(false)
      setRejectReason('')
      toast({ title: 'Invoice Rejected', description: 'Invoice has been rejected.' })
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to reject invoice', variant: 'destructive' })
    }
    setActionLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span className="text-muted-foreground">Loading invoice...</span>
        </div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="w-12 h-12 text-destructive" />
        <h1 className="text-xl font-semibold">Invoice Not Found</h1>
        <p className="text-muted-foreground">The invoice you are looking for does not exist.</p>
        <Button onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Go Back
        </Button>
      </div>
    )
  }

  const statusInfo = getStatusInfo(invoice.status)
  const StatusIcon = statusInfo.icon
  const canApprove = ['submitted', 'pending_approval'].includes(invoice.status)
  const canPay = invoice.status === 'approved'
  const isPaid = invoice.status === 'paid'

  return (
    <div className="min-h-screen bg-background">
      <RoleTabBar role="accountant" />
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.back()}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-semibold">{invoice.invoice_number}</h1>
                  <Badge className={`${statusInfo.bgColor} ${statusInfo.color} border-0`}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {statusInfo.label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {invoice.contractor?.company_name} • {invoice.project?.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Primary Actions based on status */}
              {canApprove && (
                <>
                  <Button 
                    onClick={handleApprove} 
                    disabled={actionLoading}
                    className="bg-success hover:bg-success/90 text-success-foreground"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Approve
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={actionLoading}
                    className="border-destructive/30 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                </>
              )}
              {canPay && paymentInfo && paymentInfo.summary.total_remaining_cents > 0 && (
                <Button 
                  onClick={openPaymentDialog}
                  className="bg-primary hover:bg-primary/90"
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Process Payment
                </Button>
              )}
              {/* More Actions Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {invoice.document_url && (
                    <DropdownMenuItem asChild>
                      <a href={invoice.document_url} target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4 mr-2" />
                        Download Invoice
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => window.print()}>
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/contractors/${invoice.contractor?.id}`}>
                      <Building2 className="w-4 h-4 mr-2" />
                      View Contractor
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/projects/${invoice.project?.id}`}>
                      <FileText className="w-4 h-4 mr-2" />
                      View Project
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Invoice Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Invoice Summary Card */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-primary" />
                  Invoice Summary
                </h2>
                {invoice.document_url && (
                  <a 
                    href={invoice.document_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Original Invoice
                  </a>
                )}
              </div>
              
              {/* Original Invoice Document Preview */}
              {invoice.document_url && (
                <div className="mb-6 p-4 bg-muted/30 border border-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">Original Invoice Document</p>
                        <p className="text-xs text-muted-foreground">
                          Submitted by {invoice.source === 'contractor' ? 'Contractor' : 'Project Manager'} on {formatDate(invoice.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={invoice.document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                      </a>
                      <a
                        href={invoice.document_url}
                        download
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                        title="Download"
                      >
                        <Download className="w-4 h-4 text-muted-foreground" />
                      </a>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Invoice Date</p>
                  <p className="font-medium mt-1">{formatDate(invoice.invoice_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Due Date</p>
                  <p className="font-medium mt-1">{formatDate(invoice.due_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Submitted</p>
                  <p className="font-medium mt-1">{formatDate(invoice.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Source</p>
                  <p className="font-medium mt-1 capitalize">{invoice.source || 'Manual'}</p>
                </div>
              </div>
              
              <Separator className="my-4" />
              
              {/* Financial Breakdown */}
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(invoice.subtotal_cents / 100)}</span>
                </div>
                {invoice.gst_hst_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">GST/HST ({invoice.gst_hst_rate}%)</span>
                    <span>{formatCurrency(invoice.gst_hst_cents / 100)}</span>
                  </div>
                )}
                {invoice.pst_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">PST ({invoice.pst_rate}%)</span>
                    <span>{formatCurrency(invoice.pst_cents / 100)}</span>
                  </div>
                )}
                {invoice.qst_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">QST ({invoice.qst_rate}%)</span>
                    <span>{formatCurrency(invoice.qst_cents / 100)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(invoice.total_cents / 100)}</span>
                </div>
                {invoice.holdback_cents > 0 && (
                  <div className="flex justify-between text-sm text-warning">
                    <span>Holdback ({invoice.holdback_percent}%)</span>
                    <span>-{formatCurrency(invoice.holdback_cents / 100)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-lg font-bold text-primary">
                  <span>Net Payable</span>
                  <span>{formatCurrency(invoice.net_payable_cents / 100)}</span>
                </div>
              </div>
              
              {/* Payment Status Section */}
              <Separator className="my-4" />
              {(() => {
                // Use paymentInfo totals (computed from actual payment records) when available;
                // fall back to invoice fields only when paymentInfo hasn't loaded yet.
                const totalCertified = paymentInfo?.summary.total_certified_cents ?? invoice.net_payable_cents
                const calculatedPaidAmount = paymentInfo
                  ? paymentInfo.summary.total_paid_cents
                  : (invoice.amount_paid_cents || 0)
                const calculatedRemainingAmount = paymentInfo
                  ? paymentInfo.summary.total_remaining_cents
                  : Math.max(0, invoice.net_payable_cents - calculatedPaidAmount)
                const paymentProgress = totalCertified > 0
                  ? Math.min(100, Math.round((calculatedPaidAmount / totalCertified) * 100))
                  : 0
                const totalPaymentRecords = payments.length + paymentRequests.filter(pr => pr.status === 'paid').length
                
                return (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Payment Status</h3>
                    
                    {/* Payment Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Payment Progress</span>
                        <span className="font-medium">{paymentProgress}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-success transition-all duration-500"
                          style={{ width: `${Math.min(100, paymentProgress)}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="bg-success/10 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">Amount Paid</p>
                        <p className="text-lg font-semibold text-success">
                          {formatCurrency(calculatedPaidAmount / 100)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {totalPaymentRecords > 0 
                            ? `${totalPaymentRecords} payment${totalPaymentRecords !== 1 ? 's' : ''} recorded`
                            : invoice.status === 'paid' ? 'Paid via EFT' : 'No payments yet'}
                        </p>
                      </div>
                      <div className={`rounded-lg p-3 ${calculatedRemainingAmount > 0 ? 'bg-warning/10' : 'bg-success/10'}`}>
                        <p className="text-xs text-muted-foreground">Amount Remaining</p>
                        <p className={`text-lg font-semibold ${calculatedRemainingAmount > 0 ? 'text-warning' : 'text-success'}`}>
                          {formatCurrency(calculatedRemainingAmount / 100)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {calculatedRemainingAmount > 0 ? 'Outstanding balance' : 'Fully paid'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Last Payment Info */}
                    {(payments.length > 0 || paymentRequests.some(pr => pr.status === 'paid')) && (
                      <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                        <span className="text-muted-foreground">Last Payment</span>
                        <span className="font-medium">
                          {payments.length > 0 
                            ? `${formatCurrency((payments[0] as Payment).amount_cents / 100)} on ${formatDate((payments[0] as Payment).created_at)}`
                            : paymentRequests.filter(pr => pr.status === 'paid')[0]
                              ? `${formatCurrency(paymentRequests.filter(pr => pr.status === 'paid')[0].approved_amount_cents / 100)} via ${paymentRequests.filter(pr => pr.status === 'paid')[0].payment_method?.toUpperCase() || 'EFT'}`
                              : 'N/A'
                          }
                        </span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Payment Mode Section */}
            {paymentInfo && (
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Payment Mode
                  </h2>
                  <Badge variant={paymentInfo.paymentMode === 'direct' ? 'secondary' : 'default'}>
                    {paymentInfo.paymentMode === 'direct' ? 'Direct Invoice Payment' : 'Certificate-Based Payment'}
                  </Badge>
                </div>
                
                {paymentInfo.paymentMode === 'direct' ? (
                  // Direct Invoice Payment Mode
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <div className="flex items-start gap-3">
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                        <div>
                          <p className="font-medium text-blue-900 dark:text-blue-100">Direct Invoice Payment</p>
                          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                            {paymentInfo.summary.has_certificates
                              ? `All ${paymentInfo.summary.certificate_count} payment certificate${paymentInfo.summary.certificate_count !== 1 ? 's' : ''} have been fully paid. You may now pay the remaining invoice balance.`
                              : 'This invoice has no payment certificates. Payments will be applied directly against the invoice balance.'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Invoice Total</p>
                        <p className="text-lg font-semibold mt-1">{formatCurrency(paymentInfo.invoice.net_payable_cents / 100)}</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Remaining Balance</p>
                        <p className={`text-lg font-semibold mt-1 ${paymentInfo.invoice.remaining_cents > 0 ? 'text-warning' : 'text-success'}`}>
                          {formatCurrency(paymentInfo.invoice.remaining_cents / 100)}
                        </p>
                      </div>
                    </div>
                    
                    {canPay && paymentInfo.invoice.remaining_cents > 0 && (
                      <Button onClick={openPaymentDialog} className="w-full">
                        <Banknote className="w-4 h-4 mr-2" />
                        Pay Invoice ({formatCurrency(paymentInfo.invoice.remaining_cents / 100)})
                      </Button>
                    )}
                  </div>
                ) : (
                  // Certificate-Based Payment Mode
                  <div className="space-y-4">
                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                      <div className="flex items-start gap-3">
                        <Receipt className="w-5 h-5 text-primary mt-0.5" />
                        <div>
                          <p className="font-medium">Certificate-Based Payment</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            This invoice has {paymentInfo.summary.certificate_count} payment certificate(s). 
                            Payments must be made against individual certificates, not the invoice directly.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Certificates List */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        Payment Certificates ({paymentInfo.certificates.length})
                      </h3>
                      
                      {paymentInfo.certificates.map((cert) => (
                        <div 
                          key={cert.id}
                          className={`p-4 rounded-lg border ${
                            cert.is_fully_paid 
                              ? 'bg-success/5 border-success/20' 
                              : cert.status === 'approved'
                                ? 'bg-card border-border hover:border-primary/50'
                                : 'bg-muted/30 border-border'
                          } transition-colors`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{cert.certificate_number}</span>
                              <Badge variant={
                                cert.is_fully_paid ? 'default' :
                                cert.status === 'approved' ? 'secondary' :
                                cert.status === 'rejected' ? 'destructive' : 'outline'
                              }>
                                {cert.is_fully_paid ? 'Paid' :
                                 cert.status === 'pending' ? 'Pending Approval' :
                                 cert.status === 'approved' ? 'Approved' :
                                 cert.status === 'rejected' ? 'Rejected' :
                                 cert.status === 'draft' ? 'Draft' :
                                 cert.status}
                              </Badge>
                            </div>
                            {cert.approved_at && (
                              <span className="text-xs text-muted-foreground">
                                Approved: {formatDate(cert.approved_at)}
                              </span>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Certified Amount</p>
                              <p className="font-medium">{formatCurrency(cert.certified_amount_cents / 100)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Paid</p>
                              <p className="font-medium text-success">{formatCurrency(cert.total_paid_cents / 100)}</p>
                            </div>
                          </div>
                          
                          {cert.work_period_start && cert.work_period_end && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Work Period: {formatDate(cert.work_period_start)} - {formatDate(cert.work_period_end)}
                            </p>
                          )}
                          
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            {/* Pay button — unpaid approved certs only */}
                            {!cert.is_fully_paid && cert.status === 'approved' && canPay && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const unpaidAmount = Math.max(0, cert.certified_amount_cents - cert.total_paid_cents)
                                  setSelectedCertificates([cert.id])
                                  setPaymentForm(prev => ({
                                    ...prev,
                                    amount: (unpaidAmount / 100).toFixed(2),
                                  }))
                                  setPaymentDialogOpen(true)
                                }}
                              >
                                <CreditCard className="w-3 h-3 mr-1" />
                                Pay Certificate ({formatCurrency(Math.max(0, cert.certified_amount_cents - cert.total_paid_cents) / 100)})
                              </Button>
                            )}
                            {/* View is always visible */}
                            <Link href={`/invoices/${invoiceId}/certificates/${cert.id}`}>
                              <Button size="sm" variant="ghost">
                                <ExternalLink className="w-3 h-3 mr-1" />
                                View
                              </Button>
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Summary */}
                    <Separator />
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Certified</p>
                        <p className="text-lg font-semibold mt-1">{formatCurrency(paymentInfo.summary.total_certified_cents / 100)}</p>
                      </div>
                      <div className="p-3 bg-success/10 rounded-lg">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Paid</p>
                        <p className="text-lg font-semibold text-success mt-1">{formatCurrency(paymentInfo.summary.total_paid_cents / 100)}</p>
                      </div>
                      <div className={`p-3 rounded-lg ${paymentInfo.summary.total_remaining_cents > 0 ? 'bg-warning/10' : 'bg-success/10'}`}>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Remaining</p>
                        <p className={`text-lg font-semibold mt-1 ${paymentInfo.summary.total_remaining_cents > 0 ? 'text-warning' : 'text-success'}`}>
                          {formatCurrency(paymentInfo.summary.total_remaining_cents / 100)}
                        </p>
                      </div>
                    </div>
                    
                    {/* Warning: unpaid certs block invoice balance payment */}
                    {paymentInfo.summary.unpaid_certificate_count > 0 && (
                      <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                        <p className="text-sm">
                          <strong>{paymentInfo.summary.unpaid_certificate_count} payment certificate{paymentInfo.summary.unpaid_certificate_count !== 1 ? 's' : ''} must be fully paid</strong> before paying the remaining invoice balance.
                        </p>
                      </div>
                    )}

                    {/* Pay All Certificates button */}
                    {canPay && paymentInfo.certificates.some(c => !c.is_fully_paid && c.status === 'approved') && (
                      <Button onClick={openPaymentDialog} className="w-full">
                        <Banknote className="w-4 h-4 mr-2" />
                        Pay Selected Certificates
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Payment History */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                Payment History
              </h2>
              {payments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Banknote className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>No payments recorded yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {payments.map((payment) => {
                    const isCleared = ['completed', 'cleared'].includes(payment.status)
                    return (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          isCleared ? 'bg-success/10' : 'bg-warning/10'
                        }`}>
                          {payment.payment_method === 'eft' ? (
                            <Banknote className={`w-5 h-5 ${isCleared ? 'text-success' : 'text-warning'}`} />
                          ) : (
                            <CreditCard className={`w-5 h-5 ${isCleared ? 'text-success' : 'text-warning'}`} />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{formatCurrency(payment.amount_cents / 100)}</p>
                          <p className="text-xs text-muted-foreground">
                            {payment.payment_method?.toUpperCase()} 
                            {payment.batch_reference && ` • ${payment.batch_reference}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant={isCleared ? 'default' : 'secondary'} className="mb-1">
                          {payment.status}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{formatDate(payment.created_at)}</p>
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </div>

            {/* Holdback Records */}
            {holdbacks.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-warning" />
                  Holdback Records
                </h2>
                <div className="space-y-3">
                  {holdbacks.map((holdback) => (
                    <div key={holdback.id} className="flex items-center justify-between p-3 bg-warning/5 border border-warning/20 rounded-lg">
                      <div>
                        <p className="font-medium">{formatCurrency(holdback.holdback_amount_cents / 100)}</p>
                        <p className="text-xs text-muted-foreground">
                          {holdback.holdback_percent}% holdback • Release due: {formatDate(holdback.release_due_date)}
                        </p>
                      </div>
                      <Badge variant={holdback.status === 'released' ? 'default' : 'secondary'}>
                        {holdback.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Paperclip className="w-5 h-5 text-primary" />
                  Attachments
                </h2>
                <div className="space-y-2">
                  {attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{attachment.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(attachment.file_size_bytes / 1024).toFixed(1)} KB • {formatDate(attachment.created_at)}
                          </p>
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6">
            {/* Contractor Info */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Contractor
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">{invoice.contractor?.company_name}</p>
                  {invoice.contractor?.contact_name && (
                    <p className="text-sm text-muted-foreground">{invoice.contractor.contact_name}</p>
                  )}
                </div>
                <Separator />
                {invoice.contractor?.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <a href={`mailto:${invoice.contractor.email}`} className="text-primary hover:underline">
                      {invoice.contractor.email}
                    </a>
                  </div>
                )}
                {invoice.contractor?.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{invoice.contractor.phone}</span>
                  </div>
                )}
                {invoice.contractor?.address_line1 && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p>{invoice.contractor.address_line1}</p>
                      <p>{invoice.contractor.city}, {invoice.contractor.province} {invoice.contractor.postal_code}</p>
                    </div>
                  </div>
                )}
                <Separator />
                {invoice.contractor?.bank_name && (
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Banking Info</p>
                    <p className="font-medium">{invoice.contractor.bank_name}</p>
                    <p className="text-muted-foreground">
                      ****{invoice.contractor.bank_account_number?.slice(-4) || '****'}
                    </p>
                  </div>
                )}
                <Link href={`/accountant/contractors/${invoice.contractor?.id}`}>
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    View Full Profile
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Project Info */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Project
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">{invoice.project?.name}</p>
                  <p className="text-sm text-muted-foreground">{invoice.project?.project_number}</p>
                </div>
                <Separator />
                {invoice.project?.city && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span>{invoice.project.city}, {invoice.project.province}</span>
                  </div>
                )}
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Budget</p>
                  <p className="font-medium">{formatCurrency((invoice.project?.current_budget_cents || 0) / 100)}</p>
                  <p className="text-muted-foreground">
                    Spent: {formatCurrency((invoice.project?.spent_cents || 0) / 100)}
                  </p>
                </div>
                {invoice.change_order && (
                  <>
                    <Separator />
                    <div className="text-sm">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Change Order</p>
                      <p className="font-medium">{invoice.change_order.co_number}</p>
                      <p className="text-muted-foreground">{formatCurrency(invoice.change_order.amount_cents / 100)}</p>
                    </div>
                  </>
                )}
                <Link href={`/projects/${invoice.project?.id}`}>
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    View Project
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Activity Log */}
            {auditLog.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  Activity Log
                </h2>
                <div className="space-y-3">
                  {auditLog.slice(0, 5).map((entry) => (
                    <div key={entry.id} className="flex gap-3 text-sm">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-primary flex-shrink-0" />
                      <div>
                        <p className="font-medium capitalize">{entry.action.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Invoice</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting invoice {invoice.invoice_number}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={actionLoading || !rejectReason.trim()}
            >
              {actionLoading ? 'Rejecting...' : 'Reject Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              {paymentInfo?.paymentMode === 'direct' ? 'Direct Invoice Payment' : 'Certificate Payment'}
            </DialogTitle>
            <DialogDescription>
              {paymentInfo?.paymentMode === 'direct' 
                ? `Process payment for invoice ${invoice.invoice_number}`
                : `Process payment for selected certificate(s)`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Payment Mode Indicator */}
            <div className={`p-3 rounded-lg border ${
              paymentInfo?.paymentMode === 'direct' 
                ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' 
                : 'bg-primary/5 border-primary/20'
            }`}>
              <div className="flex items-center gap-2">
                {paymentInfo?.paymentMode === 'direct' ? (
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                ) : (
                  <Receipt className="w-4 h-4 text-primary" />
                )}
                <span className="font-medium text-sm">
                  {paymentInfo?.paymentMode === 'direct' 
                    ? 'Direct Invoice Payment' 
                    : 'Certificate-Based Payment'
                  }
                </span>
              </div>
            </div>
            
            {/* Certificate Selection (for certificate mode) */}
            {paymentInfo?.paymentMode === 'certificate' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select Certificates to Pay</Label>
                <div className="max-h-48 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                  {paymentInfo.certificates
                    .filter(c => !c.is_fully_paid && c.status === 'approved')
                    .map((cert) => (
                      <div 
                        key={cert.id}
                        className={`flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer ${
                          selectedCertificates.includes(cert.id) 
                            ? 'bg-primary/10 border border-primary/30' 
                            : 'bg-muted/30 hover:bg-muted/50'
                        }`}
                        onClick={() => toggleCertificateSelection(cert.id)}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox 
                            checked={selectedCertificates.includes(cert.id)}
                            onCheckedChange={() => toggleCertificateSelection(cert.id)}
                          />
                          <div>
                            <p className="font-medium text-sm">{cert.certificate_number}</p>
                            <p className="text-xs text-muted-foreground">
                              Remaining: {formatCurrency(Math.max(0, cert.certified_amount_cents - cert.total_paid_cents) / 100)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  }
                </div>
                {selectedCertificates.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Selected: {selectedCertificates.length} certificate(s) - Total: {formatCurrency(getSelectedCertificatesTotal() / 100)}
                  </p>
                )}
              </div>
            )}
            
            {/* Payment Amount (only for direct mode) */}
            {paymentInfo?.paymentMode === 'direct' && (
              <div className="space-y-2">
                <Label htmlFor="amount">Payment Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    max={(paymentInfo.invoice.remaining_cents / 100).toFixed(2)}
                    placeholder="0.00"
                    className="pl-7"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Maximum: {formatCurrency(paymentInfo.invoice.remaining_cents / 100)}
                </p>
                {/* Quick amount buttons */}
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={() => setPaymentForm(prev => ({ 
                      ...prev, 
                      amount: (paymentInfo.invoice.remaining_cents / 100).toFixed(2) 
                    }))}
                  >
                    Pay Full Balance
                  </Button>
                </div>
              </div>
            )}
            
            {/* Payment Method */}
            <div className="space-y-2">
              <Label htmlFor="payment_method">Payment Method</Label>
              <Select 
                value={paymentForm.payment_method} 
                onValueChange={(value: 'eft' | 'cheque' | 'wire' | 'etransfer') => 
                  setPaymentForm(prev => ({ ...prev, payment_method: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eft">EFT (Electronic Funds Transfer)</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="wire">Wire Transfer</SelectItem>
                  <SelectItem value="etransfer">E-Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Cheque Number (conditional) */}
            {paymentForm.payment_method === 'cheque' && (
              <div className="space-y-2">
                <Label htmlFor="cheque_number">Cheque Number</Label>
                <Input
                  id="cheque_number"
                  placeholder="Enter cheque number"
                  value={paymentForm.cheque_number}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, cheque_number: e.target.value }))}
                />
              </div>
            )}
            
            {/* Payment Date */}
            <div className="space-y-2">
              <Label htmlFor="payment_date">Payment Date</Label>
              <Input
                id="payment_date"
                type="date"
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, payment_date: e.target.value }))}
              />
            </div>
            
            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any payment notes..."
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
            
            {/* Warning if overpayment attempted */}
            {paymentInfo?.paymentMode === 'direct' && 
              parseFloat(paymentForm.amount || '0') * 100 > paymentInfo.invoice.remaining_cents && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <p className="text-sm text-destructive">
                  Payment amount exceeds remaining balance
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleProcessPayment}
              disabled={
                paymentLoading || 
                (paymentInfo?.paymentMode === 'direct' && (
                  !paymentForm.amount || 
                  parseFloat(paymentForm.amount) <= 0 ||
                  parseFloat(paymentForm.amount) * 100 > (paymentInfo?.invoice.remaining_cents || 0)
                )) ||
                (paymentInfo?.paymentMode === 'certificate' && selectedCertificates.length === 0)
              }
            >
              {paymentLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {paymentInfo?.paymentMode === 'direct' 
                    ? `Pay ${paymentForm.amount ? formatCurrency(parseFloat(paymentForm.amount)) : '$0.00'}`
                    : `Pay ${selectedCertificates.length} Certificate(s)`
                  }
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
