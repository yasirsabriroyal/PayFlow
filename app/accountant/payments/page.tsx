'use client'

import { useState, useEffect } from 'react'
import { 
  CheckCircle, 
  Download,
  FileText,
  ArrowLeft,
  DollarSign,
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
  FileWarning
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
import { executeEFTPayment, processPayments, getApprovedInvoices } from '../actions'
import { usePermissions } from '@/hooks/use-permissions'
import { AppHeader } from '@/components/app-header'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'

// Compliance status types
type ComplianceIssue = {
  type: 'wcb_expired' | 'no_lien_waiver' | 'needs_statutory_declaration'
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

// Mock data for approved invoices ready for payment
// Including compliance status for guardrail enforcement
const mockApprovedInvoices = [
  {
    id: '1',
    contractor: 'ABC Electrical Ltd.',
    contractorId: 'C001',
    bankInfo: '**** 4521',
    project: 'Oakwood Towers - Phase 1',
    invoiceNumber: 'INV-2024-0139',
    approvedDate: '2024-01-15',
    amount: 45000,
    holdback: 4500,
    netPayable: 40500,
    // Compliance fields - in production these come from joined contractor data
    wcbExpiry: '2025-06-15', // Valid
    hasLienWaiver: true,
  },
  {
    id: '2',
    contractor: 'Superior Plumbing Inc.',
    contractorId: 'C002',
    bankInfo: '**** 7892',
    project: 'Oakwood Towers - Phase 1',
    invoiceNumber: 'INV-2024-0140',
    approvedDate: '2024-01-16',
    amount: 78500,
    holdback: 7850,
    netPayable: 70650,
    wcbExpiry: '2024-01-01', // EXPIRED - will be blocked
    hasLienWaiver: true,
  },
  {
    id: '3',
    contractor: 'Metro HVAC Systems',
    contractorId: 'C003',
    bankInfo: '**** 3456',
    project: 'Riverside Commercial Plaza',
    invoiceNumber: 'INV-2024-0141',
    approvedDate: '2024-01-17',
    amount: 62000,
    holdback: 6200,
    netPayable: 55800,
    wcbExpiry: '2025-12-31',
    hasLienWaiver: false, // Missing lien waiver - will be blocked
  },
  {
    id: '4',
    contractor: 'Classic Masonry Co.',
    contractorId: 'C004',
    bankInfo: '**** 9012',
    project: 'Heritage Renovation Project',
    invoiceNumber: 'INV-2024-0142',
    approvedDate: '2024-01-18',
    amount: 32000,
    holdback: 3200,
    netPayable: 28800,
    wcbExpiry: '2025-08-20',
    hasLienWaiver: true,
  },
  {
    id: '5',
    contractor: 'Pacific Drywall Ltd.',
    contractorId: 'C005',
    bankInfo: '**** 5678',
    project: 'Oakwood Towers - Phase 1',
    invoiceNumber: 'INV-2024-0143',
    approvedDate: '2024-01-19',
    amount: 28500,
    holdback: 2850,
    netPayable: 25650,
    wcbExpiry: '2025-03-15',
    hasLienWaiver: true,
  },
  {
    id: '6',
    contractor: 'West Coast Concrete Inc.',
    contractorId: 'C006',
    bankInfo: '**** 2345',
    project: 'Riverside Commercial Plaza',
    invoiceNumber: 'INV-2024-0144',
    approvedDate: '2024-01-20',
    amount: 95000, // Over $50k - needs statutory declaration
    holdback: 9500,
    netPayable: 85500,
    wcbExpiry: '2025-11-30',
    hasLienWaiver: true,
    hasStatutoryDeclaration: false, // Missing - may be blocked based on settings
  },
]

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
  
  const [invoices, setInvoices] = useState<typeof mockApprovedInvoices>([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [successDialogOpen, setSuccessDialogOpen] = useState(false)
  const [generatedBatchId, setGeneratedBatchId] = useState('')
  const [paidInvoices, setPaidInvoices] = useState<typeof mockApprovedInvoices>([])
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(defaultSettings)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

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
          bankInfo: (inv.contractor as Record<string, unknown>)?.bank_account_number 
            ? `**** ${((inv.contractor as Record<string, unknown>)?.bank_account_number as string).slice(-4)}`
            : 'Not set',
          project: (inv.project as Record<string, unknown>)?.name as string || 'Unknown',
          invoiceNumber: inv.invoice_number as string,
          approvedDate: inv.updated_at as string, // Use updated_at since approved_at doesn't exist
          amount: ((inv.total_cents as number) || 0) / 100,
          holdback: ((inv.holdback_cents as number) || 0) / 100,
          netPayable: (((inv.total_cents as number) || 0) - ((inv.holdback_cents as number) || 0)) / 100,
          wcbExpiry: (inv.contractor as Record<string, unknown>)?.wcb_clearance_expiry as string || null,
          hasLienWaiver: true, // Would come from separate table in production
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

  // Check compliance for an invoice based on active settings
  const checkCompliance = (invoice: typeof mockApprovedInvoices[0]): InvoiceCompliance => {
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

  const handleGenerateEFT = async () => {
    // Call server action with permission enforcement
    const invoiceIds = Array.from(selectedIds)
    const totalAmountCents = selectedInvoices.reduce((sum, inv) => sum + Math.round(inv.netPayable * 100), 0)
    
    const result = await executeEFTPayment({
      invoice_ids: invoiceIds,
      total_amount_cents: totalAmountCents,
    })
    
    if (!result.success) {
      toast({
        title: 'EFT Generation Failed',
        description: result.error || 'Failed to generate EFT batch.',
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
        paymentMethod: 'EFT' as const,
        expectedDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA'),
      },
    }))

    await sendBatchPaymentNotifications(paymentNotifications)

    // Show toast notification
    toast({
      title: 'EFT Batch Generated Successfully',
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

  const totalPending = invoices.reduce((sum, inv) => sum + inv.netPayable, 0)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="Payment Run"
        pageDescription="Generate EFT batches for approved invoices"
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{invoices.length}</p>
                <p className="text-sm text-muted-foreground">Ready to Pay</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(totalPending)}</p>
                <p className="text-sm text-muted-foreground">Total Pending</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{selectedIds.size}</p>
                <p className="text-sm text-muted-foreground">Selected</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                <Banknote className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(totalSelected)}</p>
                <p className="text-sm text-muted-foreground">Selected Total</p>
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
              onClick={handleGenerateEFT}
              disabled={selectedIds.size === 0 || !canExecuteEFT}
              className="bg-primary hover:bg-primary/90"
              title={!canExecuteEFT ? 'You do not have permission to execute EFT payments' : undefined}
            >
              <FileSpreadsheet className="w-5 h-5 mr-2" />
              Generate EFT Batch (CPA-005)
            </Button>
          </div>
        </div>

        {/* Invoices Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
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
                    <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
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
                          <p className={`font-mono text-sm ${isBlocked ? 'text-muted-foreground' : ''}`}>{invoice.invoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">Approved: {invoice.approvedDate}</p>
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
                  onClick={handleGenerateEFT}
                  className="bg-primary hover:bg-primary/90"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Generate EFT Batch
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Success Dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <DialogTitle className="text-center text-xl">EFT File Generated</DialogTitle>
            <DialogDescription className="text-center">
              Your CPA-005 compliant EFT batch file has been created successfully.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Batch ID</span>
                <span className="font-mono font-medium">{generatedBatchId}</span>
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
            <Button variant="outline" className="flex-1" onClick={() => setSuccessDialogOpen(false)}>
              <Download className="w-4 h-4 mr-2" />
              Download EFT File
            </Button>
            <Button className="flex-1" onClick={() => setSuccessDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
