'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, FileText, Building2, Calendar, DollarSign, 
  CheckCircle2, Clock, AlertTriangle, XCircle, Download,
  Send, CreditCard, Banknote, History, Paperclip, User,
  MapPin, Phone, Mail, Hash, RefreshCw, Printer, MoreHorizontal,
  ChevronRight, ExternalLink, Shield, Receipt, Plus, Eye,
  FileCheck, Upload, Trash2, ChevronDown, ChevronUp, Award, Home
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { AppHeader } from '@/components/app-header'
import { WorkflowLink } from '@/components/workflow-link'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { getInvoiceHub, type InvoiceHubData } from './actions'
import { SETTLED_OR_SENT_STATUSES } from '@/lib/payments/status'

// Helper function to format currency
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)
}

// Helper function to format date
function formatDate(dateString: string | null | undefined) {
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
    partially_paid: { label: 'Partially Paid', color: 'text-blue-500', bgColor: 'bg-blue-500/10', icon: DollarSign },
    disputed: { label: 'Disputed', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: AlertTriangle },
    rejected: { label: 'Rejected', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: XCircle },
    cancelled: { label: 'Cancelled', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: XCircle },
  }
  return statusMap[status] || { label: status, color: 'text-muted-foreground', bgColor: 'bg-muted', icon: FileText }
}

// Certificate status badge
function getCertificateStatusInfo(status: string) {
  const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    draft: { label: 'Draft', variant: 'secondary' },
    submitted: { label: 'Submitted', variant: 'outline' },
    approved: { label: 'Approved', variant: 'default' },
    paid: { label: 'Paid', variant: 'default' },
    rejected: { label: 'Rejected', variant: 'destructive' },
  }
  return statusMap[status] || { label: status, variant: 'secondary' }
}

export default function InvoiceHubPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const invoiceId = params.id as string

  const [data, setData] = useState<InvoiceHubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [auditLogOpen, setAuditLogOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Handle document upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('invoice_id', invoiceId)
      formData.append('document_type', 'attachment')

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (result.success) {
        toast({
          title: 'Document uploaded',
          description: `${file.name} has been uploaded successfully.`,
        })
        fetchData() // Refresh data
      } else {
        toast({
          title: 'Upload failed',
          description: result.error || 'Failed to upload document.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Upload error',
        description: 'An error occurred while uploading the document.',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Fetch invoice hub data
  const fetchData = useCallback(async () => {
    const result = await getInvoiceHub(invoiceId)
    if (result.success && result.data) {
      setData(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load invoice',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }, [invoiceId, toast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (!data || !data.invoice) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <h1 className="text-xl font-semibold mb-2">Invoice Not Found</h1>
          <p className="text-muted-foreground mb-4">The invoice you are looking for does not exist.</p>
          <Button onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    )
  }

  const { invoice, certificates, payments, documents, auditLog, summary } = data
  const statusInfo = getStatusInfo(invoice.status)
  const StatusIcon = statusInfo.icon

  // Calculate progress percentages
  const certifiedPercent = invoice.total_cents > 0 
    ? Math.round((summary.total_certified_cents / invoice.total_cents) * 100) 
    : 0
  const paidPercent = invoice.total_cents > 0 
    ? Math.round((summary.total_paid_cents / invoice.total_cents) * 100) 
    : 0

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle={`Invoice ${invoice.invoice_number}`}
        pageDescription={`${invoice.contractor?.company_name} • ${invoice.project?.name}`}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Invoice Header Card */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.back()} title="Go back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold">{invoice.invoice_number}</h1>
                  <Badge className={`${statusInfo.bgColor} ${statusInfo.color} border-0`}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {statusInfo.label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {invoice.contractor?.company_name} • {invoice.project?.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {invoice.document_url && (
                <Button variant="outline" size="sm" asChild>
                  <a href={invoice.document_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Original
                  </a>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Download className="w-4 h-4 mr-2" />
                    Export PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <History className="w-4 h-4 mr-2" />
                    View History
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {/* Progress Overview Card */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Invoice Total */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Invoice Total</p>
              <p className="text-2xl font-bold">{formatCurrency(invoice.total_cents / 100)}</p>
              <p className="text-xs text-muted-foreground">
                Holdback: {formatCurrency(invoice.holdback_cents / 100)} ({invoice.holdback_percent}%)
              </p>
            </div>

            {/* Total Certified */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Total Certified</p>
              <p className="text-2xl font-bold text-primary">{formatCurrency(summary.total_certified_cents / 100)}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{certifiedPercent}% of total</span>
                  <span>{certificates.length} certificate{certificates.length !== 1 ? 's' : ''}</span>
                </div>
                <Progress value={certifiedPercent} className="h-2" />
              </div>
            </div>

            {/* Total Paid */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Total Paid</p>
              <p className="text-2xl font-bold text-success">{formatCurrency(summary.total_paid_cents / 100)}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{paidPercent}% of total</span>
                  <span>{payments.length} payment{payments.length !== 1 ? 's' : ''}</span>
                </div>
                <Progress value={paidPercent} className="h-2 [&>div]:bg-success" />
              </div>
            </div>

            {/* Remaining Balance */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Remaining Balance</p>
              <p className={`text-2xl font-bold ${summary.remaining_balance_cents > 0 ? 'text-warning' : 'text-success'}`}>
                {formatCurrency(summary.remaining_balance_cents / 100)}
              </p>
              <p className="text-xs text-muted-foreground">
                {invoice.status === 'paid' 
                  ? 'Fully paid' 
                  : summary.remaining_balance_cents > 0 
                    ? 'Available for certification' 
                    : 'Fully certified'}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="certificates" className="flex items-center gap-2">
              <FileCheck className="w-4 h-4" />
              Certificates
              {certificates.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{certificates.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-2">
              <Banknote className="w-4 h-4" />
              Payments
              {payments.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{payments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <Paperclip className="w-4 h-4" />
              Documents
              {documents.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{documents.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Invoice Details */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-card border border-border rounded-xl p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-primary" />
                    Invoice Details
                  </h2>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice Date</p>
                      <p className="font-medium mt-1">{formatDate(invoice.invoice_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Due Date</p>
                      <p className="font-medium mt-1">{formatDate(invoice.due_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source</p>
                      <p className="font-medium mt-1 capitalize">{invoice.source || 'Manual'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created</p>
                      <p className="font-medium mt-1">{formatDate(invoice.created_at)}</p>
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
                    <div className="flex justify-between text-sm text-warning">
                      <span>Holdback ({invoice.holdback_percent}%)</span>
                      <span>-{formatCurrency(invoice.holdback_cents / 100)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold text-primary">
                      <span>Net Payable</span>
                      <span>{formatCurrency(invoice.net_payable_cents / 100)}</span>
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <Collapsible open={auditLogOpen} onOpenChange={setAuditLogOpen}>
                  <div className="bg-card border border-border rounded-xl">
                    <CollapsibleTrigger asChild>
                      <button className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors rounded-xl">
                        <div className="flex items-center gap-2">
                          <History className="w-5 h-5 text-primary" />
                          <span className="font-semibold">Activity Log</span>
                          <Badge variant="secondary">{auditLog.length}</Badge>
                        </div>
                        {auditLogOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Separator />
                      <div className="p-4 max-h-80 overflow-y-auto">
                        {auditLog.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">No activity recorded</p>
                        ) : (
                          <div className="space-y-4">
                            {auditLog.map((entry) => (
                              <div key={entry.id} className="flex gap-3 text-sm">
                                <div className="w-2 h-2 mt-2 rounded-full bg-primary flex-shrink-0" />
                                <div className="flex-1">
                                  <p className="font-medium">{entry.description || entry.action}</p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {formatDate(entry.created_at)}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>

              {/* Sidebar - Contractor & Project Info */}
              <div className="space-y-6">
                {/* Contractor Card */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-primary" />
                    Contractor
                  </h3>
                  <div className="space-y-3">
                    <p className="font-medium">{invoice.contractor?.company_name}</p>
                    <p className="text-sm text-muted-foreground">{invoice.contractor?.contact_name}</p>
                    
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

                    {invoice.contractor?.bank_name && (
                      <>
                        <Separator className="my-3" />
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Banking Info</p>
                        <p className="text-sm">{invoice.contractor.bank_name}</p>
                        <p className="text-sm text-muted-foreground">
                          ****{invoice.contractor.bank_account_number?.slice(-4)}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* Project Card */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Award className="w-5 h-5 text-primary" />
                    Project
                  </h3>
                  <div className="space-y-3">
                    <p className="font-medium">{invoice.project?.name}</p>
                    <p className="text-sm text-muted-foreground font-mono">{invoice.project?.project_number}</p>
                    
                    {invoice.project?.city && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span>{invoice.project.city}, {invoice.project.province}</span>
                      </div>
                    )}

                    {invoice.project?.current_budget_cents && (
                      <>
                        <Separator className="my-3" />
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Budget</p>
                        <p className="text-sm font-medium">{formatCurrency(invoice.project.current_budget_cents / 100)}</p>
                        {invoice.project?.spent_cents !== undefined && (
                          <p className="text-xs text-muted-foreground">
                            Spent: {formatCurrency(invoice.project.spent_cents / 100)}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Certificates Tab */}
          <TabsContent value="certificates" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Payment Certificates</h2>
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href={`/pm/invoices/${invoiceId}`}>
                    PM Actions
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`/invoices/${invoiceId}/certificates/new`}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Certificate
                  </Link>
                </Button>
              </div>
            </div>

            {certificates.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <FileCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="font-semibold mb-2">No Payment Certificates</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create a payment certificate to certify work for payment.
                </p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Certificate #
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Certified Amount
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {certificates.map((cert) => {
                        const certStatus = getCertificateStatusInfo(cert.status)
                        return (
                          <tr key={cert.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4">
                              <p className="font-mono text-sm font-medium">{cert.certificate_number}</p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm">{cert.description || '-'}</p>
                              {cert.work_period_start && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Period: {formatDate(cert.work_period_start)} - {formatDate(cert.work_period_end)}
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <p className="font-semibold">{formatCurrency(cert.certified_amount_cents / 100)}</p>
                            </td>
                            <td className="px-6 py-4">
                              <Badge variant={certStatus.variant}>
                                {certStatus.label}
                              </Badge>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm">{formatDate(cert.created_at)}</p>
                              {cert.approved_at && (
                                <p className="text-xs text-muted-foreground">
                                  Approved: {formatDate(cert.approved_at)}
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <Button variant="ghost" size="sm" asChild>
                                <WorkflowLink href={`/invoices/${invoiceId}/certificates/${cert.id}`} contextTitle={`Certificate ${cert.certificate_number}`}>
                                  <Eye className="w-4 h-4 mr-1" />
                                  View
                                </WorkflowLink>
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Payment History</h2>
              <Button asChild>
                <Link href={`/accountant/invoices/${invoiceId}`}>
                  <CreditCard className="w-4 h-4 mr-2" />
                  Process Payment
                </Link>
              </Button>
            </div>

            {payments.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Banknote className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="font-semibold mb-2">No Payments Recorded</h3>
                <p className="text-sm text-muted-foreground">
                  Payments will appear here once certificates are paid.
                </p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Method
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Reference
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm">{formatDate(payment.payment_date)}</p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <p className="font-semibold text-success">{formatCurrency(payment.amount_cents / 100)}</p>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className="uppercase text-xs">
                              {payment.payment_method}
                            </Badge>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-mono">
                              {payment.cheque_number || payment.etransfer_reference || payment.wire_reference || '-'}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant={SETTLED_OR_SENT_STATUSES.includes(payment.status as typeof SETTLED_OR_SENT_STATUSES[number]) ? 'default' : 'secondary'}>
                              {payment.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Documents & Attachments</h2>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUpload}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                />
                <Button 
                  variant="outline" 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading ? 'Uploading...' : 'Upload Document'}
                </Button>
              </div>
            </div>

            {documents.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Paperclip className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="font-semibold mb-2">No Documents</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload invoices, contracts, receipts, or supporting documents.
                </p>
                <Button 
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading ? 'Uploading...' : 'Upload First Document'}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {documents.map((doc) => (
                  <div key={doc.id} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{doc.file_name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{doc.document_type?.replace('_', ' ')}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(doc.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" asChild>
                          <a href={`/api/documents/${doc.id}`} download>
                            <Download className="w-4 h-4" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
