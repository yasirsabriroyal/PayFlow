'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  TrendingDown,
  TrendingUp,
  FileText,
  ArrowLeft,
  Clock,
  DollarSign,
  Building2,
  Plus,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/app-header'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { 
  createPaymentCertificate, 
  getPMProjects, 
  getContractors,
  getPendingApprovals,
  getPMApprovedInvoices,
  approveInvoice,
  rejectInvoice,
  type CreatePaymentCertificateInput 
} from '../actions'

// Type for pending approval items (invoices/payment certificates)
interface PendingApproval {
  id: string
  type: 'invoice'
  projectId: string
  projectName: string
  projectNumber: string
  projectBudget: number
  contractor: string
  contractorId: string
  invoiceNumber: string
  amount: number
  holdback: number
  netPayable: number
  description: string
  submittedDate: string
  dueDate: string
  status: string
}

// Role-based dashboard routes
const roleDashboardRoutes: Record<string, string> = {
  admin: '/admin/dashboard',
  project_manager: '/pm/dashboard',
  accountant: '/accountant/queue',
  contractor: '/vendor/portal',
}

interface Project {
  id: string
  name: string
  project_number: string
  current_budget_cents: number
  spent_cents: number
}

interface Contractor {
  id: string
  company_name: string
  contact_name: string
  status: string
}

// Type for approved invoice items
interface ApprovedInvoice extends PendingApproval {
  amountPaid?: number
  approvedDate?: string
}

export default function PMApprovalsPage() {
  const router = useRouter()
  const { toast } = useToast()
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/pm/approvals')
  const [activeTab, setActiveTab] = useState(initialState?.activeTab || 'pending')
  
  // Save list state when tab changes
  useEffect(() => {
    save({ activeTab })
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps
  
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [approvedInvoices, setApprovedInvoices] = useState<ApprovedInvoice[]>([])
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<PendingApproval | null>(null)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('project_manager')
  
  // Certificate modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [selectedContractor, setSelectedContractor] = useState<string>('')
  const [grossAmount, setGrossAmount] = useState<string>('')
  const [applyHoldback, setApplyHoldback] = useState(true)
  const [holdbackPercent, setHoldbackPercent] = useState<number>(10)
  const [description, setDescription] = useState<string>('')

  // Fetch user role and load data for deterministic navigation
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('auth_user_id', user.id)
          .single()
        if (data?.role) {
          setUserRole(data.role)
        }
      }
      
      // Load projects, contractors, pending approvals, and approved invoices
      const [projectsResult, contractorsResult, approvalsResult, approvedResult] = await Promise.all([
        getPMProjects(),
        getContractors(),
        getPendingApprovals(),
        getPMApprovedInvoices(),
      ])
      
      if (projectsResult.success) {
        setProjects(projectsResult.projects)
      }
      if (contractorsResult.success) {
        setContractors(contractorsResult.contractors)
      }
      if (approvalsResult.success) {
        setApprovals(approvalsResult.approvals)
      }
      if (approvedResult.success) {
        setApprovedInvoices(approvedResult.invoices as ApprovedInvoice[])
      }
      setApprovalsLoading(false)
    }
    fetchData()
  }, [])

  const handleBackNavigation = () => {
    // Navigate to the user's role-specific dashboard
    const destination = roleDashboardRoutes[userRole] || '/admin/dashboard'
    router.push(destination)
  }
  
  // Certificate creation
  const grossAmountCents = Math.round(parseFloat(grossAmount || '0') * 100)
  const holdbackAmount = applyHoldback ? grossAmountCents * (holdbackPercent / 100) : 0
  const netAmount = grossAmountCents - holdbackAmount
  
  const resetCertificateForm = () => {
    setSelectedProject('')
    setSelectedContractor('')
    setGrossAmount('')
    setApplyHoldback(true)
    setHoldbackPercent(10)
    setDescription('')
  }
  
  const handleCreateCertificate = async () => {
    if (!selectedProject || !selectedContractor || grossAmountCents <= 0) {
      toast({
        title: 'Missing Information',
        description: 'Please select a project, contractor, and enter a valid amount.',
        variant: 'destructive',
      })
      return
    }
    
    setIsSubmitting(true)
    
    const input: CreatePaymentCertificateInput = {
      project_id: selectedProject,
      contractor_id: selectedContractor,
      gross_amount_cents: grossAmountCents,
      apply_holdback: applyHoldback,
      holdback_percent: holdbackPercent,
      description: description || undefined,
    }
    
    const result = await createPaymentCertificate(input)
    
    if (result.success) {
      toast({
        title: 'Payment Certificate Created',
        description: `Certificate ${result.invoice?.invoice_number} has been created and sent to accounting.`,
      })
      setIsCreateModalOpen(false)
      resetCertificateForm()
      setSuccessMessage(`Payment certificate ${result.invoice?.invoice_number} created successfully`)
      setTimeout(() => setSuccessMessage(null), 5000)
    } else {
      toast({
        title: 'Creation Failed',
        description: result.error || 'Failed to create payment certificate.',
        variant: 'destructive',
      })
    }
    
    setIsSubmitting(false)
  }

  const filteredApprovals = approvals.filter(inv => 
    inv.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.contractor.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getBudgetImpact = (invoice: PendingApproval) => {
    // Calculate percentage of budget this invoice represents
    const percentOfBudget = invoice.projectBudget > 0 
      ? (invoice.amount / invoice.projectBudget) * 100 
      : 0
    const remaining = invoice.projectBudget - invoice.amount

    if (percentOfBudget > 50) {
      return {
        status: 'warning',
        label: 'Large invoice',
        amount: invoice.amount,
        percentUsed: percentOfBudget,
        color: 'text-warning',
        bgColor: 'bg-warning/10',
        borderColor: 'border-warning/20',
        icon: AlertTriangle,
      }
    } else if (percentOfBudget > 25) {
      return {
        status: 'caution',
        label: 'Significant amount',
        amount: invoice.amount,
        percentUsed: percentOfBudget,
        color: 'text-orange-600',
        bgColor: 'bg-orange-500/10',
        borderColor: 'border-orange-500/20',
        icon: TrendingUp,
      }
    } else {
      return {
        status: 'ok',
        label: 'Within budget',
        amount: remaining,
        percentUsed: percentOfBudget,
        color: 'text-success',
        bgColor: 'bg-success/10',
        borderColor: 'border-success/20',
        icon: TrendingDown,
      }
    }
  }

  const handleApprove = async (invoice: PendingApproval) => {
    const result = await approveInvoice(invoice.id)
    if (result.success) {
      setApprovals(prev => prev.filter(inv => inv.id !== invoice.id))
      setSuccessMessage(`Invoice ${invoice.invoiceNumber} approved and sent for payment.`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } else {
      setSuccessMessage(`Error: ${result.error}`)
      setTimeout(() => setSuccessMessage(null), 5000)
    }
  }

  const handleReject = async () => {
    if (!selectedInvoice) return
    const result = await rejectInvoice(selectedInvoice.id, rejectReason)
    if (result.success) {
      setApprovals(prev => prev.filter(inv => inv.id !== selectedInvoice.id))
      setRejectDialogOpen(false)
      setRejectReason('')
      setSelectedInvoice(null)
      setSuccessMessage(`Invoice ${selectedInvoice.invoiceNumber} has been rejected.`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } else {
      setSuccessMessage(`Error: ${result.error}`)
      setTimeout(() => setSuccessMessage(null), 5000)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  const totalPendingAmount = approvals.reduce((sum, inv) => sum + inv.amount, 0)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="PM Approvals"
        pageDescription="Review and approve invoices for your projects"
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Action Button */}
        <div className="flex justify-end">
          <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Certificate</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
        {/* Success Message */}
        {successMessage && (
          <div className="bg-success/10 border border-success/20 text-success rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5" />
            <p className="font-medium">{successMessage}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{approvals.length}</p>
                <p className="text-sm text-muted-foreground">Pending Approval</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(totalPendingAmount)}</p>
                <p className="text-sm text-muted-foreground">Total Value</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-destructive/10 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {approvals.filter(inv => getBudgetImpact(inv).status === 'over').length}
                </p>
                <p className="text-sm text-muted-foreground">Over Budget</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs for Pending and Approved */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              Pending
              {approvals.length > 0 && (
                <Badge variant="secondary" className="ml-1">{approvals.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved" className="flex items-center gap-2">
              Approved
              {approvedInvoices.length > 0 && (
                <Badge variant="secondary" className="ml-1">{approvedInvoices.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Search */}
          <div className="bg-card border border-border rounded-xl p-4">
            <Input
              placeholder="Search by project, contractor, or invoice number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
          </div>

          {/* Pending Approvals Tab */}
          <TabsContent value="pending" className="space-y-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Contractor
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Invoice #
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Budget Impact
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredApprovals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p>No invoices awaiting your approval</p>
                    </td>
                  </tr>
                ) : (
                  filteredApprovals.map((invoice) => {
                    const impact = getBudgetImpact(invoice)
                    const ImpactIcon = impact.icon

                    return (
                      <tr 
                        key={invoice.id} 
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => window.location.href = `/invoices/${invoice.id}`}
                      >
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium">{invoice.projectName}</p>
                            <p className="text-sm text-muted-foreground">{invoice.projectNumber}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-medium">{invoice.contractor}</p>
                          <p className="text-sm text-muted-foreground">{invoice.description}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-mono text-sm">{invoice.invoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">Due: {invoice.dueDate}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="font-semibold">{formatCurrency(invoice.amount)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${impact.bgColor} border ${impact.borderColor}`}>
                            <ImpactIcon className={`w-4 h-4 ${impact.color}`} />
                            <span className={`text-sm font-medium ${impact.color}`}>
                              {impact.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {impact.status === 'over' 
                              ? `${formatCurrency(impact.amount)} over` 
                              : `${formatCurrency(impact.amount)} remaining`
                            }
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleApprove(invoice)
                              }}
                              className="bg-success hover:bg-success/90 text-success-foreground"
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedInvoice(invoice)
                                setRejectDialogOpen(true)
                              }}
                              className="border-destructive/30 text-destructive hover:bg-destructive/10"
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
            </div>
          </TabsContent>

          {/* Approved Invoices Tab */}
          <TabsContent value="approved" className="space-y-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Project
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Contractor
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Invoice #
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {approvedInvoices.filter(inv => 
                      inv.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      inv.contractor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())
                    ).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                          <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                          <p>No approved invoices found</p>
                        </td>
                      </tr>
                    ) : (
                      approvedInvoices.filter(inv => 
                        inv.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        inv.contractor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())
                      ).map((invoice) => (
                        <tr 
                          key={invoice.id} 
                          className="hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => window.location.href = `/invoices/${invoice.id}`}
                        >
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium">{invoice.projectName}</p>
                              <p className="text-sm text-muted-foreground">{invoice.projectNumber}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-medium">{invoice.contractor}</p>
                            <p className="text-sm text-muted-foreground">{invoice.description}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-mono text-sm">{invoice.invoiceNumber}</p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <p className="font-semibold">{formatCurrency(invoice.amount)}</p>
                            {invoice.amountPaid && invoice.amountPaid > 0 && (
                              <p className="text-xs text-success">Paid: {formatCurrency(invoice.amountPaid)}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <Badge 
                              variant={invoice.status === 'paid' ? 'default' : 'secondary'}
                              className={invoice.status === 'paid' ? 'bg-success text-success-foreground' : ''}
                            >
                              {invoice.status === 'paid' ? 'Paid' : invoice.status === 'approved' ? 'Approved' : 'Processing'}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => window.location.href = `/invoices/${invoice.id}`}
                            >
                              View Details
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Invoice</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting invoice {selectedInvoice?.invoiceNumber}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason</Label>
              <Textarea
                id="reason"
                placeholder="Enter the reason for rejection..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={!rejectReason.trim()}
            >
              Reject Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Create Payment Certificate Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Create Payment Certificate
            </DialogTitle>
            <DialogDescription>
              Issue a payment certificate directly to accounting for processing
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Project Selector */}
            <div className="space-y-2">
              <Label htmlFor="project">Project *</Label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <div className="flex flex-col">
                        <span>{project.name}</span>
                        <span className="text-xs text-muted-foreground">{project.project_number}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Contractor Selector */}
            <div className="space-y-2">
              <Label htmlFor="contractor">Contractor *</Label>
              <Select value={selectedContractor} onValueChange={setSelectedContractor}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a contractor" />
                </SelectTrigger>
                <SelectContent>
                  {contractors.map((contractor) => (
                    <SelectItem key={contractor.id} value={contractor.id}>
                      <div className="flex flex-col">
                        <span>{contractor.company_name}</span>
                        <span className="text-xs text-muted-foreground">{contractor.contact_name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Gross Amount */}
            <div className="space-y-2">
              <Label htmlFor="amount">Gross Amount (CAD) *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            
            {/* Holdback Toggle */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <div className="space-y-1">
                <Label htmlFor="holdback" className="font-medium">Apply Holdback</Label>
                <p className="text-sm text-muted-foreground">
                  Deduct {holdbackPercent}% for statutory holdback
                </p>
              </div>
              <Switch
                id="holdback"
                checked={applyHoldback}
                onCheckedChange={setApplyHoldback}
              />
            </div>
            
            {/* Holdback Percent (if enabled) */}
            {applyHoldback && (
              <div className="space-y-2">
                <Label htmlFor="holdbackPercent">Holdback Percentage</Label>
                <Select 
                  value={holdbackPercent.toString()} 
                  onValueChange={(v) => setHoldbackPercent(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5%</SelectItem>
                    <SelectItem value="10">10% (Standard)</SelectItem>
                    <SelectItem value="15">15%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* Amount Summary */}
            {grossAmountCents > 0 && (
              <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Gross Amount</span>
                  <span>{formatCurrency(grossAmountCents / 100)}</span>
                </div>
                {applyHoldback && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Holdback ({holdbackPercent}%)</span>
                    <span>-{formatCurrency(holdbackAmount / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold pt-2 border-t">
                  <span>Net Payable</span>
                  <span className="text-primary">{formatCurrency(netAmount / 100)}</span>
                </div>
              </div>
            )}
            
            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Notes / Description (Optional)</Label>
              <Textarea
                id="description"
                placeholder="Work completed, milestone details, etc."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsCreateModalOpen(false)
                resetCertificateForm()
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateCertificate} 
              disabled={isSubmitting || !selectedProject || !selectedContractor || grossAmountCents <= 0}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Create Certificate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
