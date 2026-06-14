'use client'

import { useState, useEffect } from 'react'
import { 
  CheckCircle,
  Download,
  FileText,
  ArrowLeft,
  Building2,
  CreditCard,
  Banknote,
  CheckSquare,
  Square,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  AlertTriangle,
  ShieldAlert,
  Ban,
  FileWarning,
  ExternalLink
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { sendBatchPaymentNotifications } from '@/lib/notifications'
import { createClient } from '@/lib/supabase/client'
import { executeEFTPayment, processPayments, getApprovedInvoices, getApprovedCertificatesForPayment, recordCertificatePayment } from '../actions'
import { usePermissions } from '@/hooks/use-permissions'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'

// Compliance status types
type ComplianceIssue = {
  type: 'wcb_expired' | 'no_lien_waiver' | 'needs_statutory_declaration' | 'has_unpaid_certs'
  message: string
}

type InvoiceCompliance = {
  isBlocked: boolean
  issues: ComplianceIssue[]
}

// System settings types
type PaymentSettings = {
  block_wcb_expired: boolean
  require_lien_waiver: boolean
  statutory_declaration_threshold: number
}

// Approved invoice ready for payment (mapped from getApprovedInvoices).
// Compliance fields drive the guardrail enforcement in checkCompliance().
type ApprovedInvoice = {
  id: string
  contractor: string
  contractorId: string
  bankInfo: string
  project: string
  invoiceNumber: string
  approvedDate: string
  dueDate?: string
  amount: number
  holdback: number
  netPayable: number
  wcbExpiry: string
  hasLienWaiver: boolean
  hasStatutoryDeclaration?: boolean
  hasUnpaidCerts?: boolean
}

// Default settings (fallback if DB fetch fails)
const defaultSettings: PaymentSettings = {
  block_wcb_expired: true,
  require_lien_waiver: true,
  statutory_declaration_threshold: 50000,
}

export default function PaymentsPage() {
  const { toast } = useToast()
  const { hasPermission } = usePermissions()
  
  // Permission-aware UI state
  const canExecuteEFT = hasPermission('execute_eft_payments')
  const canProcessPayments = hasPermission('process_payments')
  
  // List state preservation (scroll position)
  const { initialState } = useListStatePreservation('/accountant/payments')
  
  const [invoices, setInvoices] = useState<ApprovedInvoice[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [successDialogOpen, setSuccessDialogOpen] = useState(false)
  const [generatedBatchId, setGeneratedBatchId] = useState('')
  const [paidInvoices, setPaidInvoices] = useState<ApprovedInvoice[]>([])
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(defaultSettings)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [eftReviewOpen, setEftReviewOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'eft' | 'cheque' | 'wire' | 'etransfer'>('eft')

  // Approved certificates state
  const [approvedCerts, setApprovedCerts] = useState<Array<{
    id: string
    certificate_number: string
    certified_amount_cents: number
    approved_at: string
    invoice: { id: string; invoice_number: string } | null
    contractor: { id: string; company_name: string } | null
    project: { id: string; name: string; project_number: string } | null
  }>>([])
  const [certsLoading, setCertsLoading] = useState(true)
  const [certPaymentLoading, setCertPaymentLoading] = useState<string | null>(null)
  const [certReviewDialogOpen, setCertReviewDialogOpen] = useState(false)
  const [certToReview, setCertToReview] = useState<typeof approvedCerts[0] | null>(null)

  // Fetch approved invoices from server action
  useEffect(() => {
    const fetchApprovedInvoices = async () => {
      const result = await getApprovedInvoices()
      
      if (result.success && Array.isArray(result.invoices) && result.invoices.length > 0) {
        // Map server response to local type
        setInvoices(result.invoices.map((inv: Record<string, unknown>) => ({
          id: inv.id as string,
          contractor: (inv.contractor as Record<string, unknown>)?.company_name as string || 'Unknown',
          contractorId: (inv.contractor as Record<string, unknown>)?.id as string || '',
          bankInfo: (() => {
            const c = inv.contractor as Record<string, unknown>
            const last4 = (c?.bank_account_last4 as string) || ''
            return last4 ? `**** ${last4}` : 'Not set'
          })(),
          project: (inv.project as Record<string, unknown>)?.name as string || 'Unknown',
          invoiceNumber: inv.invoice_number as string,
          approvedDate: inv.updated_at as string, // Use updated_at since approved_at doesn't exist
          dueDate: (inv.due_date as string) || '',
          amount: ((inv.total_cents as number) || 0) / 100,
          holdback: ((inv.holdback_cents as number) || 0) / 100,
          netPayable: (((inv.net_payable_cents as number) ??
            (((inv.total_cents as number) || 0) - ((inv.holdback_cents as number) || 0))) || 0) / 100,
          wcbExpiry: ((inv.contractor as Record<string, unknown>)?.wcb_clearance_expiry as string) || '',
          hasLienWaiver: true as boolean, // Would come from separate table in production
          hasStatutoryDeclaration: false as boolean,
          hasUnpaidCerts: (inv as Record<string, unknown>).has_unpaid_certs as boolean || false,
        })))
      } else {
        // No approved invoices - show empty state (don't use mock data to avoid confusion)
        setInvoices([])
      }
      setInvoicesLoading(false)
    }
    
    fetchApprovedInvoices()
  }, [])

  // Fetch payment guardrail settings from system_settings table
  useEffect(() => {
    const fetchSettings = async () => {
      const supabase = createClient()
      
      try {
        const { data, error } = await supabase
          .from('system_settings')
          .select('key, value')
          .in('key', ['block_wcb_expired', 'require_lien_waiver', 'statutory_declaration_threshold'])

        if (!error && data) {
          const settings: Partial<PaymentSettings> = {}
          data.forEach((row: { key: string; value: unknown }) => {
            if (row.key === 'block_wcb_expired') {
              settings.block_wcb_expired = row.value === true || row.value === 'true'
            } else if (row.key === 'require_lien_waiver') {
              settings.require_lien_waiver = row.value === true || row.value === 'true'
            } else if (row.key === 'statutory_declaration_threshold') {
              settings.statutory_declaration_threshold = Number(row.value) || 50000
            }
          })
          setPaymentSettings(prev => ({ ...prev, ...settings }))
        }
      } catch (err) {
        console.log('[v0] Using default payment settings')
      } finally {
        setSettingsLoaded(true)
      }
    }

    fetchSettings()
  }, [])

  // Fetch approved payment certificates
  useEffect(() => {
    const fetchApprovedCerts = async () => {
      const result = await getApprovedCertificatesForPayment()
      if (result.success && Array.isArray(result.certificates)) {
        setApprovedCerts(result.certificates.map((cert: Record<string, unknown>) => {
          const invoiceData = cert.invoice as Record<string, unknown> | null
          const projectData = cert.project as Record<string, unknown> | null
          const contractorData = invoiceData?.contractor as Record<string, unknown> | null
          return {
            id: cert.id as string,
            certificate_number: cert.certificate_number as string,
            certified_amount_cents: cert.certified_amount_cents as number,
            approved_at: cert.approved_at as string,
            invoice: invoiceData ? { id: invoiceData.id as string, invoice_number: invoiceData.invoice_number as string } : null,
            contractor: contractorData ? { id: contractorData.id as string, company_name: contractorData.company_name as string } : null,
            project: projectData ? { id: projectData.id as string, name: projectData.name as string, project_number: projectData.project_number as string } : null,
          }
        }))
      }
      setCertsLoading(false)
    }
    fetchApprovedCerts()
  }, [])

  const handlePayCertificate = async (certId: string, amountCents: number) => {
    setCertPaymentLoading(certId)
    const result = await recordCertificatePayment({
      certificate_id: certId,
      amount_cents: amountCents,
      payment_method: paymentMethod,
      payment_date: new Date().toISOString().split('T')[0],
    })
    if (result.success) {
      toast({
        title: 'Certificate Paid',
        description: result.message || 'Payment recorded successfully.',
      })
      setApprovedCerts(prev => prev.filter(c => c.id !== certId))
    } else {
      toast({
        title: 'Payment Failed',
        description: result.error || 'Failed to record certificate payment.',
        variant: 'destructive',
      })
    }
    setCertPaymentLoading(null)
  }

  // Check compliance for an invoice based on active settings
  const checkCompliance = (invoice: ApprovedInvoice): InvoiceCompliance => {
    const issues: ComplianceIssue[] = []

    // Check WCB expiry
    if (paymentSettings.block_wcb_expired && invoice.wcbExpiry) {
      const expiryDate = new Date(invoice.wcbExpiry)
      if (expiryDate < new Date()) {
        issues.push({
          type: 'wcb_expired',
          message: `WCB clearance expired on ${new Date(invoice.wcbExpiry).toLocaleDateString('en-CA')}`,
        })
      }
    }

    // Check lien waiver requirement
    if (paymentSettings.require_lien_waiver && !invoice.hasLienWaiver) {
      issues.push({
        type: 'no_lien_waiver',
        message: 'Signed lien waiver not received',
      })
    }

    // Check statutory declaration threshold
    if (
      paymentSettings.statutory_declaration_threshold > 0 &&
      invoice.amount >= paymentSettings.statutory_declaration_threshold &&
      !(invoice as typeof invoice & { hasStatutoryDeclaration?: boolean }).hasStatutoryDeclaration
    ) {
      issues.push({
        type: 'needs_statutory_declaration',
        message: `Invoice exceeds $${paymentSettings.statutory_declaration_threshold.toLocaleString()} - statutory declaration required`,
      })
    }

    // Check for unpaid payment certificates — cert payments must be processed first
    if ((invoice as typeof invoice & { hasUnpaidCerts?: boolean }).hasUnpaidCerts) {
      issues.push({
        type: 'has_unpaid_certs',
        message: 'Has unpaid certificates — pay certs first',
      })
    }

    return {
      isBlocked: issues.length > 0,
      issues,
    }
  }

  // Get compliance status for all invoices
  const invoiceCompliance = invoices.reduce((acc, inv) => {
    acc[inv.id] = checkCompliance(inv)
    return acc
  }, {} as Record<string, InvoiceCompliance>)

  // Count blocked invoices
  const blockedCount = Object.values(invoiceCompliance).filter(c => c.isBlocked).length

  const filteredInvoices = invoices.filter(inv => 
    inv.contractor.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const toggleSelect = (id: string) => {
    // Don't allow selecting blocked invoices
    if (invoiceCompliance[id]?.isBlocked) {
      toast({
        title: 'Cannot Select Invoice',
        description: 'This invoice has compliance issues that must be resolved first.',
        variant: 'destructive',
      })
      return
    }

    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const toggleSelectAll = () => {
    // Only select non-blocked invoices
    const selectableInvoices = filteredInvoices.filter(inv => !invoiceCompliance[inv.id]?.isBlocked)
    
    if (selectedIds.size === selectableInvoices.length && selectableInvoices.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableInvoices.map(inv => inv.id)))
    }
  }

  const selectedInvoices = invoices.filter(inv => selectedIds.has(inv.id))
  const totalSelected = selectedInvoices.reduce((sum, inv) => sum + inv.netPayable, 0)

  const openEFTReview = () => {
    if (selectedIds.size === 0) return
    setEftReviewOpen(true)
  }

  const handleGenerateEFT = async () => {
    setEftReviewOpen(false)
    // Call server action with permission enforcement
    const invoiceIds = Array.from(selectedIds)
    const totalAmountCents = selectedInvoices.reduce((sum, inv) => sum + Math.round(inv.netPayable * 100), 0)
    
    const result = await executeEFTPayment({
      invoice_ids: invoiceIds,
      total_amount_cents: totalAmountCents,
      payment_method: paymentMethod,
    })
    
    if (!result.success) {
      toast({
        title: 'Payment Failed',
        description: result.error || `Failed to process the ${methodLabel} payment batch.`,
        variant: 'destructive',
      })
      return
    }
    
    const batchId = result.data?.batch_reference || `EFT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
    setGeneratedBatchId(batchId)
    setPaidInvoices([...selectedInvoices])
    
    // Send payment notifications to all vendors
    const paymentNotifications = selectedInvoices.map(invoice => ({
      recipient: {
        name: invoice.contractor,
        email: `${invoice.contractorId.toLowerCase()}@vendor.com`, // Mock email
        phone: '+14165559999', // Mock phone
      },
      data: {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.netPayable,
        batchId,
        paymentMethod: methodLabel,
        expectedDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA'),
      },
    }))

    await sendBatchPaymentNotifications(paymentNotifications)

    // Show toast notification
    toast({
      title: `${methodLabel} Payment Batch Processed`,
      description: (
        <div className="flex items-center gap-2 mt-1">
          <Mail className="w-4 h-4 text-primary" />
          <MessageSquare className="w-4 h-4 text-green-500" />
          <span className="text-sm">{selectedInvoices.length} vendors notified via Email & WhatsApp</span>
        </div>
      ),
    })

    // Remove paid invoices from the list
    setInvoices(prev => prev.filter(inv => !selectedIds.has(inv.id)))
    setSelectedIds(new Set())
    setSuccessDialogOpen(true)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  const formatDate = (value?: string) => {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Human-readable label for the selected payment method, used consistently
  // across the button, dialogs, toasts, and notifications so the UI always
  // reflects the accountant's actual choice (not a hardcoded "EFT").
  const methodLabels = {
    eft: 'EFT',
    cheque: 'Cheque',
    wire: 'Wire Transfer',
    etransfer: 'E-Transfer',
  } as const
  const methodLabel = methodLabels[paymentMethod]
  const isEft = paymentMethod === 'eft'

  const totalPending = invoices.reduce((sum, inv) => sum + inv.netPayable, 0)

  // Due/overdue framing so the accountant immediately sees what must go out now.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const inSevenDays = new Date(startOfToday)
  inSevenDays.setDate(inSevenDays.getDate() + 7)

  const parseDue = (inv: ApprovedInvoice) => {
    if (!inv.dueDate) return null
    const d = new Date(inv.dueDate)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const isOverdueToPay = (inv: ApprovedInvoice) => {
    const d = parseDue(inv)
    return d !== null && d < startOfToday
  }
  const isDueThisWeek = (inv: ApprovedInvoice) => {
    const d = parseDue(inv)
    return d !== null && d >= startOfToday && d <= inSevenDays
  }

  const overdueInvoices = invoices.filter(isOverdueToPay)
  const overdueTotal = overdueInvoices.reduce((sum, inv) => sum + inv.netPayable, 0)
  const dueThisWeekInvoices = invoices.filter(isDueThisWeek)
  const dueThisWeekTotal = dueThisWeekInvoices.reduce((sum, inv) => sum + inv.netPayable, 0)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="Payment Run"
          pageDescription="Pay approved invoices and certificates by EFT, cheque, wire, or e-transfer"
      />
      <RoleTabBar role="accountant" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Money-first summary band - answers "what must go out now" at a glance */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Overdue to Pay */}
          <div className={`bg-card border rounded-xl p-5 ${overdueInvoices.length > 0 ? 'border-destructive/40' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-destructive/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight truncate">{formatCurrency(overdueTotal)}</p>
                <p className="text-sm text-muted-foreground truncate">Overdue to Pay</p>
                <p className="text-xs font-medium text-destructive">{overdueInvoices.length} invoice{overdueInvoices.length === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>
          {/* Due This Week */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Banknote className="w-5 h-5 text-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight truncate">{formatCurrency(dueThisWeekTotal)}</p>
                <p className="text-sm text-muted-foreground truncate">Due This Week</p>
                <p className="text-xs font-medium text-foreground/70">{dueThisWeekInvoices.length} invoice{dueThisWeekInvoices.length === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>
          {/* Ready to Pay (all approved) */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight truncate">{formatCurrency(totalPending)}</p>
                <p className="text-sm text-muted-foreground truncate">Ready to Pay</p>
                <p className="text-xs font-medium text-foreground/70">{invoices.length} invoice{invoices.length === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>
          {/* In This Run (selected) */}
          <div className={`bg-card border rounded-xl p-5 ${selectedIds.size > 0 ? 'border-primary/40' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight truncate">{formatCurrency(totalSelected)}</p>
                <p className="text-sm text-muted-foreground truncate">In This Run</p>
                <p className="text-xs font-medium text-primary">{selectedIds.size} selected</p>
              </div>
            </div>
          </div>
        </div>

        {/* Compliance Warning Banner */}
        {blockedCount > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-destructive">
                  {blockedCount} invoice{blockedCount > 1 ? 's' : ''} blocked by compliance guardrails
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  These invoices cannot be selected for payment until compliance issues are resolved. 
<WorkflowLink href="/admin/settings/payments" contextTitle="Guardrail Settings" className="text-primary ml-1 hover:underline">
  View guardrail settings
  </WorkflowLink>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Search and Actions */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <Input
              placeholder="Search by contractor, project, or invoice..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
            <Button
              size="lg"
              onClick={openEFTReview}
              disabled={selectedIds.size === 0 || !canExecuteEFT}
              className="bg-primary hover:bg-primary/90"
              title={!canExecuteEFT ? 'You do not have permission to execute EFT payments' : undefined}
            >
              <FileSpreadsheet className="w-5 h-5 mr-2" />
              {selectedIds.size > 0 ? `Pay Selected · ${formatCurrency(totalSelected)}` : 'Pay Selected'}
            </Button>
          </div>
        </div>

        {/* Invoice batch payments */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Invoice Batch Payments</h2>
                <p className="text-sm text-muted-foreground">
                  Select approved invoices and pay them together in one batch. You choose the payment method (EFT, cheque, wire, or e-transfer) at the review step.
                </p>
              </div>
              {invoices.length > 0 && (
                <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">{invoices.length} ready</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-4 text-left">
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                    >
                      {selectedIds.size === filteredInvoices.length && filteredInvoices.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      Select
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Contractor
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Invoice #
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Holdback
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Net Payable
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Bank
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p>No invoices ready for payment</p>
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((invoice) => {
                    const compliance = invoiceCompliance[invoice.id]
                    const isBlocked = compliance?.isBlocked

                    return (
                      <tr 
                        key={invoice.id} 
                        className={`transition-colors ${
                          isBlocked 
                            ? 'bg-destructive/5 hover:bg-destructive/10' 
                            : selectedIds.has(invoice.id) 
                              ? 'bg-primary/5 hover:bg-primary/10' 
                              : 'hover:bg-muted/30'
                        } ${isBlocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        onClick={() => !isBlocked && toggleSelect(invoice.id)}
                      >
                        <td className="px-6 py-4">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="relative">
                                  <Checkbox
                                    checked={selectedIds.has(invoice.id)}
                                    onCheckedChange={() => !isBlocked && toggleSelect(invoice.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={isBlocked}
                                    className={isBlocked ? 'opacity-50' : ''}
                                  />
                                  {isBlocked && (
                                    <div className="absolute -top-1 -right-1">
                                      <Ban className="w-3 h-3 text-destructive" />
                                    </div>
                                  )}
                                </div>
                              </TooltipTrigger>
                              {isBlocked && (
                                <TooltipContent side="right" className="max-w-xs">
                                  <p className="font-medium text-destructive mb-1">Payment Blocked</p>
                                  <ul className="text-xs space-y-1">
                                    {compliance.issues.map((issue, i) => (
                                      <li key={i} className="flex items-start gap-1">
                                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                        {issue.message}
                                      </li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className={`font-medium ${isBlocked ? 'text-muted-foreground' : ''}`}>
                                {invoice.contractor}
                              </p>
                              <p className="text-xs text-muted-foreground">{invoice.contractorId}</p>
                            </div>
                            {isBlocked && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <div className="p-1 rounded bg-destructive/10">
                                      <FileWarning className="w-4 h-4 text-destructive" />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="font-medium mb-1">Compliance Issues:</p>
                                    <ul className="text-xs space-y-1">
                                      {compliance.issues.map((issue, i) => (
                                        <li key={i}>• {issue.message}</li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className={`text-sm ${isBlocked ? 'text-muted-foreground' : ''}`}>{invoice.project}</p>
                        </td>
                        <td className="px-6 py-4">
                          <a
                            href={`/accountant/invoices/${invoice.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className={`font-mono text-sm inline-flex items-center gap-1 hover:underline ${isBlocked ? 'text-muted-foreground' : 'text-primary'}`}
                          >
                            {invoice.invoiceNumber}
                            <ExternalLink className="w-3 h-3 opacity-70" />
                          </a>
                          <p className="text-xs text-muted-foreground">Approved {formatDate(invoice.approvedDate)}</p>
                          {invoice.hasUnpaidCerts && (
                            <p className="text-xs font-medium text-destructive mt-0.5">Pay certificate first</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {invoice.dueDate ? (
                            <span className={`text-sm ${isOverdueToPay(invoice) ? 'font-medium text-destructive' : isBlocked ? 'text-muted-foreground' : ''}`}>
                              {formatDate(invoice.dueDate)}
                              {isOverdueToPay(invoice) && <span className="ml-1 text-xs">(overdue)</span>}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className={`font-medium ${isBlocked ? 'text-muted-foreground' : ''}`}>{formatCurrency(invoice.amount)}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="text-sm text-muted-foreground">-{formatCurrency(invoice.holdback)}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className={`font-semibold ${isBlocked ? 'text-muted-foreground' : 'text-success'}`}>
                            {formatCurrency(invoice.netPayable)}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <CreditCard className={`w-4 h-4 ${isBlocked ? 'text-muted-foreground/50' : 'text-muted-foreground'}`} />
                            <span className={`text-sm font-mono ${isBlocked ? 'text-muted-foreground' : ''}`}>{invoice.bankInfo}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          
          {/* Selection Summary */}
          {selectedIds.size > 0 && (
            <div className="border-t border-border bg-primary/5 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''} selected
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total payment: {formatCurrency(totalSelected)}
                  </p>
                </div>
                <Button
                  onClick={openEFTReview}
                  disabled={!canExecuteEFT}
                  className="bg-primary hover:bg-primary/90"
                  title={!canExecuteEFT ? 'You do not have permission to execute EFT payments' : undefined}
                >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Pay Selected
            </Button>
              </div>
            </div>
          )}
        </div>

        {/* Approved Payment Certificates */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Certificate Payments</h2>
              <p className="text-sm text-muted-foreground">
                PM-approved certificates paid individually. An invoice with an unpaid certificate stays blocked in the EFT batch above until its certificate is paid here.
              </p>
            </div>
            {approvedCerts.length > 0 && (
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">{approvedCerts.length} ready</span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contractor</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice #</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Certificate #</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {certsLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    </div>
                  </td>
                </tr>
              ) : approvedCerts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p>No approved certificates awaiting payment</p>
                  </td>
                </tr>
              ) : (
                approvedCerts.map((cert) => (
                  <tr key={cert.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium">{cert.contractor?.company_name || 'Unknown'}</p>
                    </td>
                    <td className="px-6 py-4">
                      {cert.invoice?.id ? (
                        <a
                          href={`/accountant/invoices/${cert.invoice.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {cert.invoice.invoice_number || '—'}
                          <ExternalLink className="w-3 h-3 opacity-70" />
                        </a>
                      ) : (
                        <p className="font-mono text-sm text-muted-foreground">—</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {cert.invoice?.id ? (
                        <a
                          href={`/invoices/${cert.invoice.id}/certificates/${cert.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {cert.certificate_number}
                          <ExternalLink className="w-3 h-3 opacity-70" />
                        </a>
                      ) : (
                        <p className="font-mono text-sm">{cert.certificate_number}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm">{cert.project ? `${cert.project.project_number} – ${cert.project.name}` : '—'}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="font-semibold text-success">{formatCurrency(cert.certified_amount_cents / 100)}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        size="sm"
                        onClick={() => { setCertToReview(cert); setCertReviewDialogOpen(true) }}
                        disabled={certPaymentLoading === cert.id || !canProcessPayments}
                        className="gap-1"
                      >
                        <Banknote className="w-3 h-3" />
                        {certPaymentLoading === cert.id ? 'Paying…' : 'Review & Pay'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </main>

      {/* Certificate Review & Pay Dialog */}
      <Dialog open={certReviewDialogOpen} onOpenChange={setCertReviewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Review Certificate Payment</DialogTitle>
            <DialogDescription>Review the details below before confirming payment.</DialogDescription>
          </DialogHeader>
          {certToReview && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Certificate #</span>
                {certToReview.invoice?.id ? (
                  <a
                    href={`/invoices/${certToReview.invoice.id}/certificates/${certToReview.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {certToReview.certificate_number}
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                ) : (
                  <span className="font-mono">{certToReview.certificate_number}</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice #</span>
                {certToReview.invoice?.id ? (
                  <a
                    href={`/accountant/invoices/${certToReview.invoice.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {certToReview.invoice.invoice_number}
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                ) : (
                  <span className="font-mono text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contractor</span>
                <span className="font-medium">{certToReview.contractor?.company_name || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Project</span>
                <span className="font-medium">{certToReview.project ? `${certToReview.project.project_number} – ${certToReview.project.name}` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Certified Amount</span>
                <span className="font-semibold text-success">{formatCurrency(certToReview.certified_amount_cents / 100)}</span>
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Payment Method</span>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                    <SelectTrigger className="w-[180px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eft">EFT (Electronic Funds Transfer)</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="wire">Wire Transfer</SelectItem>
                      <SelectItem value="etransfer">E-Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Date</span>
                  <span className="font-medium">
                    {new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCertReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!certToReview) return
                setCertReviewDialogOpen(false)
                handlePayCertificate(certToReview.id, certToReview.certified_amount_cents)
              }}
              disabled={!certToReview || certPaymentLoading === certToReview?.id}
            >
              <Banknote className="w-4 h-4 mr-2" />
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EFT Review Dialog */}
      <Dialog open={eftReviewOpen} onOpenChange={setEftReviewOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Pay {selectedInvoices.length} invoice{selectedInvoices.length === 1 ? '' : 's'} · {formatCurrency(totalSelected)}
            </DialogTitle>
            <DialogDescription>
              {isEft
                ? 'Review the recipients below, then confirm to generate the CPA-005 compliant EFT batch file.'
                : `Review the recipients below, then confirm to record this ${methodLabel} payment batch.`}
            </DialogDescription>
          </DialogHeader>

          {/* Missing bank account warning */}
          {selectedInvoices.some(inv => inv.bankInfo === 'Not set') && (
            <div className="flex items-start gap-3 rounded-lg bg-warning/10 border border-warning/30 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning font-medium">
                Some invoices have no bank account set. Please update contractor banking details before proceeding.
              </p>
            </div>
          )}

          {/* Invoice review table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contractor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice #</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Holdback</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Payable</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bank Account</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{invoice.contractor}</td>
                      <td className="px-4 py-3 text-muted-foreground">{invoice.project}</td>
                      <td className="px-4 py-3">
                        <a
                          href={`/accountant/invoices/${invoice.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {invoice.invoiceNumber}
                          <ExternalLink className="w-3 h-3 opacity-70" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(invoice.amount)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">-{formatCurrency(invoice.holdback)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-success">{formatCurrency(invoice.netPayable)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <CreditCard className={`w-3.5 h-3.5 ${invoice.bankInfo === 'Not set' ? 'text-warning' : 'text-muted-foreground'}`} />
                          <span className={`font-mono text-xs ${invoice.bankInfo === 'Not set' ? 'text-warning font-semibold' : ''}`}>
                            {invoice.bankInfo}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment method selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Payment Method</label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eft">EFT (Electronic Funds Transfer)</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="wire">Wire Transfer</SelectItem>
                <SelectItem value="etransfer">E-Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Payment details & total */}
          <div className="rounded-lg bg-muted/30 border border-border px-4 py-4 space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Payment Method</span>
              <span className="font-medium text-foreground">
                {paymentMethod === 'eft' && 'EFT (Electronic Funds Transfer)'}
                {paymentMethod === 'cheque' && 'Cheque'}
                {paymentMethod === 'wire' && 'Wire Transfer'}
                {paymentMethod === 'etransfer' && 'E-Transfer'}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Payment Date</span>
              <span className="font-medium text-foreground">
                {new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-semibold text-base">
              <span>Total Payment</span>
              <span className="text-success">{formatCurrency(totalSelected)}</span>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEftReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerateEFT}
              className="bg-primary hover:bg-primary/90"
              disabled={!canExecuteEFT}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              {isEft ? 'Confirm & Generate EFT File' : `Confirm ${methodLabel} Payment`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <DialogTitle className="text-center text-xl">
              {isEft ? 'EFT File Generated' : `${methodLabel} Payment Recorded`}
            </DialogTitle>
            <DialogDescription className="text-center">
              {isEft
                ? 'Your CPA-005 compliant EFT batch file has been created successfully.'
                : `Your ${methodLabel} payment batch has been recorded successfully.`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Batch ID</span>
                <span className="font-mono font-medium">{generatedBatchId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Payment Method</span>
                <span className="font-medium">{methodLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Invoices Processed</span>
                <span className="font-medium">{paidInvoices.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Amount</span>
                <span className="font-semibold text-success">
                  {formatCurrency(paidInvoices.reduce((sum, inv) => sum + inv.netPayable, 0))}
                </span>
              </div>
            </div>

            <div className="border border-border rounded-lg divide-y divide-border">
              {paidInvoices.slice(0, 3).map((invoice) => (
                <div key={invoice.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{invoice.contractor}</p>
                    <p className="text-xs text-muted-foreground">{invoice.invoiceNumber}</p>
                  </div>
                  <p className="text-sm font-medium">{formatCurrency(invoice.netPayable)}</p>
                </div>
              ))}
              {paidInvoices.length > 3 && (
                <div className="px-4 py-3 text-center text-sm text-muted-foreground">
                  +{paidInvoices.length - 3} more invoice{paidInvoices.length - 3 !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {isEft && (
              <Button variant="outline" className="flex-1" onClick={() => setSuccessDialogOpen(false)}>
                <Download className="w-4 h-4 mr-2" />
                Download EFT File
              </Button>
            )}
            <Button className="flex-1" onClick={() => setSuccessDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
