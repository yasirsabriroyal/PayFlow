'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  ChevronLeft, DollarSign, Building2, FolderKanban,
  FileText, CreditCard, Loader2, CheckCircle2, AlertTriangle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createDirectPayment, getActiveContractors, getActiveProjects } from '../../actions'

interface Contractor {
  id: string
  company_name: string
  contact_name: string
  email: string
  status: string
}

interface Project {
  id: string
  name: string
  project_number: string
}

// Must match database payment_method enum: 'eft', 'cheque', 'wire', 'e-transfer'
type PaymentMethod = 'eft' | 'cheque' | 'wire' | 'e-transfer'

const paymentMethods: { value: PaymentMethod; label: string; description: string }[] = [
  { value: 'eft', label: 'EFT (Electronic Funds Transfer)', description: 'Direct bank transfer' },
  { value: 'cheque', label: 'Cheque', description: 'Physical cheque payment' },
  { value: 'wire', label: 'Wire Transfer', description: 'Bank wire transfer' },
  { value: 'e-transfer', label: 'E-Transfer', description: 'Interac e-Transfer' },
]

export default function DirectPaymentPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  
  // Form state
  const [contractorId, setContractorId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('eft')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  
  // Data state
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Confirmation dialog
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successData, setSuccessData] = useState<{ requestNumber: string; amount: number } | null>(null)
  
  useEffect(() => {
    setMounted(true)
    
    async function loadData() {
      const [contractorsResult, projectsResult] = await Promise.all([
        getActiveContractors(),
        getActiveProjects(),
      ])
      
      if (contractorsResult.success) {
        setContractors(contractorsResult.contractors)
      }
      
      if (projectsResult.success) {
        setProjects(projectsResult.projects)
      }
      
      setLoading(false)
    }
    
    loadData()
  }, [])
  
  const selectedContractor = contractors.find(c => c.id === contractorId)
  const selectedProject = projects.find(p => p.id === projectId)
  const amountCents = Math.round(parseFloat(amount || '0') * 100)
  
  const isValid = contractorId && amount && parseFloat(amount) > 0 && description.trim().length >= 5
  
  const handleSubmit = () => {
    if (!isValid) return
    setError(null)
    setShowConfirmation(true)
  }
  
  const handleConfirm = async () => {
    setShowConfirmation(false)
    setSubmitting(true)
    setError(null)
    
    try {
      const result = await createDirectPayment({
        contractor_id: contractorId,
        project_id: projectId || undefined,
        amount_cents: amountCents,
        payment_method: paymentMethod,
        description: description.trim(),
        notes: notes.trim() || undefined,
      })
      
      if (result.success) {
        setSuccessData({
          requestNumber: result.data?.requestNumber || 'N/A',
          amount: amountCents / 100,
        })
        setShowSuccess(true)
        
        // Reset form
        setContractorId('')
        setProjectId('')
        setAmount('')
        setDescription('')
        setNotes('')
      } else {
        setError(result.error || 'Failed to create payment')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setSubmitting(false)
    }
  }
  
  if (!mounted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin/accounting">
              <Button variant="ghost" size="sm">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold">Create Direct Payment</h1>
              <p className="text-sm text-muted-foreground">Issue a payment without an invoice</p>
            </div>
          </div>
        </div>
      </header>
      
      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    Recipient
                  </CardTitle>
                  <CardDescription>Select the contractor to pay</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="contractor">Contractor *</Label>
                    <Select value={contractorId || '_placeholder'} onValueChange={(val) => setContractorId(val === '_placeholder' ? '' : val)}>
                      <SelectTrigger id="contractor">
                        <SelectValue placeholder="Select a contractor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_placeholder" disabled className="hidden">
                          Select a contractor
                        </SelectItem>
                        {contractors.length === 0 ? (
                          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                            No active contractors found
                          </div>
                        ) : (
                          contractors.filter(c => c.id && c.id.trim() !== '').map((contractor) => (
                            <SelectItem key={contractor.id} value={contractor.id}>
                              {contractor.company_name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {selectedContractor && (
                      <p className="text-xs text-muted-foreground">
                        Contact: {selectedContractor.contact_name} ({selectedContractor.email})
                      </p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="project">Project (Optional)</Label>
                    <Select value={projectId || 'none'} onValueChange={(val) => setProjectId(val === 'none' ? '' : val)}>
                      <SelectTrigger id="project">
                        <SelectValue placeholder="Select a project (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No project</SelectItem>
                        {projects.filter(p => p.id && p.id.trim() !== '').map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.project_number} - {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Payment Details
                  </CardTitle>
                  <CardDescription>Enter payment amount and method</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (CAD) *</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="1000000"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="pl-7"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="method">Payment Method *</Label>
                      <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                        <SelectTrigger id="method">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {method.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="description">Description *</Label>
                    <Input
                      id="description"
                      placeholder="Brief description of payment purpose"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={200}
                    />
                    <p className="text-xs text-muted-foreground">Minimum 5 characters</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="notes">Internal Notes (Optional)</Label>
                    <Textarea
                      id="notes"
                      placeholder="Additional notes for internal reference..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
              
              {error && (
                <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
              
              <div className="flex items-center gap-3 justify-end">
                <Link href="/admin/accounting">
                  <Button variant="outline">Cancel</Button>
                </Link>
                <Button 
                  onClick={handleSubmit}
                  disabled={!isValid || submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" />
                      Create Payment
                    </>
                  )}
                </Button>
              </div>
            </div>
            
            {/* Summary Sidebar */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Payment Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contractor</span>
                    <span className="font-medium text-right max-w-[150px] truncate">
                      {selectedContractor?.company_name || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Project</span>
                    <span className="font-medium">
                      {selectedProject?.project_number || 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Method</span>
                    <span className="font-medium">
                      {paymentMethods.find(m => m.value === paymentMethod)?.label.split(' ')[0] || '-'}
                    </span>
                  </div>
                  <div className="border-t border-border pt-3 flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold text-lg" suppressHydrationWarning>
                      {mounted && amount ? `$${parseFloat(amount).toLocaleString('en-CA', { minimumFractionDigits: 2 })}` : '$0.00'}
                    </span>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-warning/5 border-warning/20">
                <CardContent className="pt-4">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Direct Payment Notice</p>
                      <p className="text-xs text-muted-foreground">
                        This payment bypasses the standard invoice approval workflow. 
                        All direct payments are logged in the audit trail.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
      
      {/* Confirmation Dialog */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Direct Payment</DialogTitle>
            <DialogDescription>
              You are about to create a direct payment. This action will be logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Contractor</span>
              <span className="font-medium">{selectedContractor?.company_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold text-lg">
                ${parseFloat(amount || '0').toLocaleString('en-CA', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Method</span>
              <span className="font-medium">
                {paymentMethods.find(m => m.value === paymentMethod)?.label}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Description</span>
              <span className="font-medium max-w-[200px] text-right">{description}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmation(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Success Dialog */}
      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-success" />
              </div>
              <div>
                <DialogTitle>Payment Created</DialogTitle>
                <DialogDescription>
                  The direct payment has been successfully created.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Reference Number</span>
              <span className="font-mono font-medium">{successData?.requestNumber}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">
                ${successData?.amount.toLocaleString('en-CA', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSuccess(false)}>
              Create Another
            </Button>
            <Button onClick={() => router.push('/admin/accounting')}>
              Back to Accounting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
