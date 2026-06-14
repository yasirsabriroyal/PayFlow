'use client'

import { useState, useEffect, useRef } from 'react'
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
  ExternalLink,
  Clock,
  History,
  ChevronDown,
  X
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
import { executeEFTPayment, processPayments, getApprovedInvoices, getApprovedCertificatesForPayment, recordCertificatePayment, getRecentPayments, getRecentPaymentTotals } from '../actions'
import { usePermissions } from '@/hooks/use-permissions'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { DataCard } from '@/components/ui/responsive-table'
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

  // Quick-filter driven by the summary cards. Lets the accountant jump straight
  // to the most urgent payable invoices in one click (no search/scroll).
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'overdue' | 'due_week'>('all')

  // Completed-work context: recent payments + paid-today/this-week totals.
  type RecentPayment = {
    id: string
    amount_cents: number
    payment_method: string
    payment_date: string | null
    status: string | null
    contractor: { company_name?: string } | null
    payment_request: { request_number?: string; invoice?: { invoice_number?: string } | null } | null
    certificate: { certificate_number?: string } | null
  }
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([])
  const [paidTotals, setPaidTotals] = useState({ paidToday: 0, paidTodayCount: 0, paidWeek: 0, paidWeekCount: 0 })
  const [recentOpen, setRecentOpen] = useState(false)

  // Load recent-payment context (totals + last 10). Re-runs after a payment via refreshKey.
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    const loadRecent = async () => {
      const [totals, recent] = await Promise.all([getRecentPaymentTotals(), getRecentPayments({ limit: 10 })])
      if (totals.success) {
        setPaidTotals({
          paidToday: totals.paidToday ?? 0,
          paidTodayCount: totals.paidTodayCount ?? 0,
          paidWeek: totals.paidWeek ?? 0,
          paidWeekCount: totals.paidWeekCount ?? 0,
        })
      }
      if (recent.success && Array.isArray(recent.payments)) {
        setRecentPayments(recent.payments as unknown as RecentPayment[])
      }
    }
    loadRecent()
  }, [refreshKey])

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
      setRefreshKey(k => k + 1) // refresh Paid totals + Recently Paid
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

  // --- Urgency framing (drives the summary band, quick-filters, and sorting) ---
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
  // Rank for action-first ordering: overdue → due this week → later (dated) → no due date.
  const urgencyRank = (inv: ApprovedInvoice) => {
    if (isOverdueToPay(inv)) return 0
    if (isDueThisWeek(inv)) return 1
    return parseDue(inv) ? 2 : 3
  }

  // Search + quick-filter, then sort so the most urgent payable invoices are
  // always at the top — the accountant sees "pay these now" without scrolling.
  const filteredInvoices = invoices
    .filter(inv =>
      inv.contractor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter(inv => {
      if (urgencyFilter === 'overdue') return isOverdueToPay(inv)
      if (urgencyFilter === 'due_week') return isDueThisWeek(inv)
      return true
    })
    .sort((a, b) => {
      const ra = urgencyRank(a)
      const rb = urgencyRank(b)
      if (ra !== rb) return ra - rb
      const da = parseDue(a)
      const db = parseDue(b)
      if (da && db) return da.getTime() - db.getTime() // soonest due first within a group
      return 0
    })

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

  // Inline single-invoice pay: scope the selection to just this invoice and
  // open the same review dialog used by the batch flow. This keeps every
  // guardrail intact (blocked invoices can't be paid, method must be chosen,
  // and the confirm step still runs) while removing the need to manually
  // check the box for a one-off payment.
  const payOne = (invoice: ApprovedInvoice) => {
    if (invoiceCompliance[invoice.id]?.isBlocked) {
      toast({
        title: 'Cannot Pay Invoice',
        description: 'This invoice has compliance issues that must be resolved first.',
        variant: 'destructive',
      })
      return
    }
    setSelectedIds(new Set([invoice.id]))
    setEftReviewOpen(true)
  }

  // Deep link from the Review Queue: /accountant/payments?pay=<invoiceId>
  // Once invoices have loaded, pre-select the requested invoice and open the
  // review dialog (unless it is blocked, in which case we just highlight it).
  const payParamHandled = useRef(false)
  useEffect(() => {
    if (invoicesLoading || payParamHandled.current) return
    const payId = new URLSearchParams(window.location.search).get('pay')
    if (!payId) return
    payParamHandled.current = true
    const target = invoices.find((inv) => inv.id === payId)
    if (!target) return
    if (invoiceCompliance[target.id]?.isBlocked) {
      setSelectedIds(new Set([target.id]))
      toast({
        title: 'Cannot Pay Invoice',
        description: 'This invoice has compliance issues that must be resolved first.',
        variant: 'destructive',
      })
      return
    }
    setSelectedIds(new Set([target.id]))
    setEftReviewOpen(true)
  }, [invoicesLoading, invoices, invoiceCompliance, toast])

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
    setRefreshKey(k => k + 1) // refresh Paid totals + Recently Paid
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
        {/* Money-first summary band - answers "what must go out now" at a glance.
            The first three cards are quick-filters: one click narrows the list. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Overdue to Pay (quick-filter) */}
          <button
            type="button"
            onClick={() => setUrgencyFilter(f => (f === 'overdue' ? 'all' : 'overdue'))}
            aria-pressed={urgencyFilter === 'overdue'}
            className={`text-left bg-card border rounded-xl p-5 transition-colors hover:border-destructive/50 ${urgencyFilter === 'overdue' ? 'border-destructive ring-2 ring-destructive/30' : overdueInvoices.length > 0 ? 'border-destructive/40' : 'border-border'}`}
          >
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
          </button>
          {/* Due This Week (quick-filter) */}
          <button
            type="button"
            onClick={() => setUrgencyFilter(f => (f === 'due_week' ? 'all' : 'due_week'))}
            aria-pressed={urgencyFilter === 'due_week'}
            className={`text-left bg-card border rounded-xl p-5 transition-colors hover:border-warning/50 ${urgencyFilter === 'due_week' ? 'border-warning ring-2 ring-warning/30' : 'border-border'}`}
          >
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
          </button>
          {/* Ready to Pay (resets the quick-filter) */}
          <button
            type="button"
            onClick={() => setUrgencyFilter('all')}
            aria-pressed={urgencyFilter === 'all'}
            className={`text-left bg-card border rounded-xl p-5 transition-colors hover:border-success/50 ${urgencyFilter === 'all' ? 'border-success ring-2 ring-success/30' : 'border-border'}`}
          >
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
          </button>
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

        {/* Completed-work reference: paid today / this week */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight truncate">{formatCurrency(paidTotals.paidToday / 100)}</p>
              <p className="text-xs text-muted-foreground truncate">Paid Today · {paidTotals.paidTodayCount} payment{paidTotals.paidTodayCount === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
              <History className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight truncate">{formatCurrency(paidTotals.paidWeek / 100)}</p>
              <p className="text-xs text-muted-foreground truncate">Paid This Week · {paidTotals.paidWeekCount} payment{paidTotals.paidWeekCount === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>

        {/* Active quick-filter indicator */}
        {urgencyFilter !== 'all' && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Showing</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 font-medium">
              {urgencyFilter === 'overdue' ? 'Overdue invoices' : 'Due this week'}
              <button
                type="button"
                onClick={() => setUrgencyFilter('all')}
                aria-label="Clear filter"
                className="hover:text-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>
        )}

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

          {/* Mobile card view */}
          <div className="md:hidden p-4 space-y-3">
            {filteredInvoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-muted-foreground">
                  {urgencyFilter === 'overdue' ? 'No overdue invoices' : urgencyFilter === 'due_week' ? 'No invoices due this week' : 'No invoices ready for payment'}
                </p>
              </div>
            ) : (
              filteredInvoices.map((invoice) => {
                const compliance = invoiceCompliance[invoice.id]
                const isBlocked = compliance?.isBlocked
                const isSelected = selectedIds.has(invoice.id)
                return (
                  <DataCard
                    key={invoice.id}
                    className={
                      isBlocked
                        ? 'border-destructive/30 bg-destructive/5'
                        : isSelected
                          ? 'border-primary/40 bg-primary/5'
                          : ''
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {!isBlocked && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(invoice.id)}
                            aria-label={`Select invoice ${invoice.invoiceNumber}`}
                            className="mt-1"
                          />
                        )}
                        <div className="min-w-0">
                          <h3 className="font-medium truncate">{invoice.contractor}</h3>
                          <p className="text-sm text-muted-foreground truncate">{invoice.project}</p>
                        </div>
                      </div>
                      <code className="font-mono bg-muted px-2 py-0.5 rounded text-xs whitespace-nowrap">
                        {invoice.invoiceNumber}
                      </code>
                    </div>

                    <div className="flex items-center justify-between text-sm pt-1">
                      <span className="text-muted-foreground">Due</span>
                      <span className={invoice.dueDate && isOverdueToPay(invoice) ? 'font-medium text-destructive' : ''}>
                        {formatDate(invoice.dueDate)}
                        {invoice.dueDate && isOverdueToPay(invoice) && <span className="ml-1 text-xs">(overdue)</span>}
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

                    {invoice.hasUnpaidCerts && (
                      <p className="text-xs font-medium text-destructive">Pay certificate first</p>
                    )}

                    <div className="pt-3 border-t border-border">
                      {isBlocked ? (
                        <div className="space-y-2">
                          <Button size="sm" variant="outline" disabled className="w-full gap-1 h-10">
                            <Ban className="w-4 h-4" />
                            Blocked
                          </Button>
                          <ul className="text-xs text-destructive space-y-1">
                            {compliance.issues.map((issue, i) => (
                              <li key={i}>• {issue.message}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => payOne(invoice)}
                          disabled={!canExecuteEFT}
                          title={!canExecuteEFT ? 'You do not have permission to execute payments' : undefined}
                          className="w-full gap-1 h-10 touch-manipulation"
                        >
                          <Banknote className="w-4 h-4" />
                          Pay {formatCurrency(invoice.netPayable)}
                        </Button>
                      )}
                    </div>
                  </DataCard>
                )
              })
            )}
          </div>

          <div className="overflow-x-auto hidden md:block">
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
                  <th className="sticky right-0 z-10 bg-muted/30 px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p>{urgencyFilter === 'overdue' ? 'No overdue invoices' : urgencyFilter === 'due_week' ? 'No invoices due this week' : 'No invoices ready for payment'}</p>
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
                        <td
                          className="sticky right-0 z-10 bg-card px-6 py-4 text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.1)]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isBlocked ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-block">
                                    <Button size="sm" variant="outline" disabled className="gap-1">
                                      <Ban className="w-3 h-3" />
                                      Blocked
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="font-medium mb-1">Resolve before paying:</p>
                                  <ul className="text-xs space-y-1">
                                    {compliance.issues.map((issue, i) => (
                                      <li key={i}>• {issue.message}</li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => payOne(invoice)}
                              disabled={!canExecuteEFT}
                              title={!canExecuteEFT ? 'You do not have permission to execute payments' : undefined}
                              className="gap-1"
                            >
                              <Banknote className="w-3 h-3" />
                              Pay
                            </Button>
                          )}
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

        {/* Mobile card view */}
        <div className="md:hidden p-4 space-y-3">
          {certsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : approvedCerts.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-20" />
              <p className="text-muted-foreground">No approved certificates awaiting payment</p>
            </div>
          ) : (
            approvedCerts.map((cert) => (
              <DataCard key={cert.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium truncate">{cert.contractor?.company_name || 'Unknown'}</h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {cert.project ? `${cert.project.project_number} – ${cert.project.name}` : '—'}
                    </p>
                  </div>
                  <p className="font-semibold text-success whitespace-nowrap">
                    {formatCurrency(cert.certified_amount_cents / 100)}
                  </p>
                </div>

                <div className="flex items-center justify-between text-sm pt-1">
                  <span className="text-muted-foreground">Invoice #</span>
                  {cert.invoice?.id ? (
                    <a
                      href={`/accountant/invoices/${cert.invoice.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {cert.invoice.invoice_number || '—'}
                      <ExternalLink className="w-3 h-3 opacity-70" />
                    </a>
                  ) : (
                    <span className="font-mono text-muted-foreground">—</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Certificate #</span>
                  {cert.invoice?.id ? (
                    <a
                      href={`/invoices/${cert.invoice.id}/certificates/${cert.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {cert.certificate_number}
                      <ExternalLink className="w-3 h-3 opacity-70" />
                    </a>
                  ) : (
                    <span className="font-mono">{cert.certificate_number}</span>
                  )}
                </div>

                <div className="pt-3 border-t border-border">
                  <Button
                    size="sm"
                    onClick={() => { setCertToReview(cert); setCertReviewDialogOpen(true) }}
                    disabled={certPaymentLoading === cert.id || !canProcessPayments}
                    className="w-full gap-1 h-10 touch-manipulation"
                  >
                    <Banknote className="w-4 h-4" />
                    {certPaymentLoading === cert.id ? 'Paying…' : 'Review & Pay'}
                  </Button>
                </div>
              </DataCard>
            ))
          )}
        </div>

        <div className="overflow-x-auto hidden md:block">
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

      {/* Recently Paid — collapsed by default so it never competes with action items */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setRecentOpen(o => !o)}
          aria-expanded={recentOpen}
          className="w-full px-6 py-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
              <History className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Recently Paid</h2>
              <p className="text-sm text-muted-foreground">Last {recentPayments.length} payment{recentPayments.length === 1 ? '' : 's'} for verification and reference</p>
            </div>
          </div>
          <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${recentOpen ? 'rotate-180' : ''}`} />
        </button>

        {recentOpen && (
          <div className="border-t border-border divide-y divide-border">
            {recentPayments.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">No payments recorded yet.</div>
            ) : (
              recentPayments.map(p => {
                const ref = p.payment_request?.invoice?.invoice_number || p.certificate?.certificate_number || p.payment_request?.request_number || '—'
                const method = methodLabels[p.payment_method as keyof typeof methodLabels] || p.payment_method
                return (
                  <div key={p.id} className="px-6 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.contractor?.company_name || 'Unknown vendor'}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        <code className="font-mono">{ref}</code> · {method} · {formatDate(p.payment_date || undefined)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold">{formatCurrency((p.amount_cents || 0) / 100)}</p>
                      {p.status && <p className="text-xs text-success capitalize">{p.status}</p>}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
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
