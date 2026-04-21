'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  FileText, 
  Calculator, 
  AlertCircle,
  CheckCircle,
  Percent,
  DollarSign,
  Calendar,
  Info,
  Home
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'
import { getInvoiceForCertificate, createPaymentCertificate } from '@/lib/actions/payment-certificates'
import { createClient } from '@/lib/supabase/client'

// Format currency
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)
}

// Format date
function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

type Invoice = {
  id: string
  invoice_number: string
  total_cents: number
  holdback_percent: number
  holdback_cents: number
  net_payable_cents: number
  total_certified_cents: number
  calculated_remaining_balance: number
  status: string
  invoice_date: string
  contractor: {
    id: string
    company_name: string
  }
  project: {
    id: string
    name: string
    project_number: string
  }
}

type Certificate = {
  id: string
  certificate_number: string
  certified_amount_cents: number
  holdback_amount_cents: number
  net_payable_cents: number
  status: string
  created_at: string
}

export default function NewCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const invoiceId = resolvedParams.id
  const router = useRouter()
  const { toast } = useToast()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [existingCertificates, setExistingCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [certifiedAmount, setCertifiedAmount] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [workPeriodStart, setWorkPeriodStart] = useState<string>('')
  const [workPeriodEnd, setWorkPeriodEnd] = useState<string>('')
  const [notes, setNotes] = useState<string>('')

  // Role guard — only project_manager may access this page
  useEffect(() => {
    const checkRole = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/unauthorized'); return }
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('auth_user_id', user.id)
        .single()
      if (userData?.role !== 'project_manager') {
        router.replace('/unauthorized')
      }
    }
    checkRole()
  }, [router])

  // Fetch invoice data
  useEffect(() => {
    const fetchData = async () => {
      const result = await getInvoiceForCertificate(invoiceId)
      if (result.success && result.invoice) {
        setInvoice(result.invoice as unknown as Invoice)
        setExistingCertificates(result.certificates as Certificate[])
      } else {
        setError(result.error || 'Failed to load invoice')
      }
      setLoading(false)
    }
    fetchData()
  }, [invoiceId])

  // Calculate dynamic values
  const certifiedAmountCents = Math.round(parseFloat(certifiedAmount || '0') * 100)
  const invoiceTotal = invoice?.total_cents || 0
  const holdbackPercent = invoice?.holdback_percent || 0
  const previouslyCertified = invoice?.total_certified_cents || 0
  const remainingBalance = invoice?.calculated_remaining_balance || 0

  // This certificate calculations
  const holdbackAmountCents = Math.round(certifiedAmountCents * (holdbackPercent / 100))
  const netPayableCents = certifiedAmountCents - holdbackAmountCents

  // After this certificate
  const newTotalCertified = previouslyCertified + certifiedAmountCents
  const newRemainingBalance = invoiceTotal - newTotalCertified

  // Progress percentages
  const currentProgress = invoiceTotal > 0 ? (previouslyCertified / invoiceTotal) * 100 : 0
  const newProgress = invoiceTotal > 0 ? (newTotalCertified / invoiceTotal) * 100 : 0

  // Validation
  const isValidAmount = certifiedAmountCents > 0 && certifiedAmountCents <= remainingBalance
  const canSubmit = isValidAmount && description.trim().length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !invoice) return

    setSubmitting(true)
    setError(null)

    const result = await createPaymentCertificate({
      invoice_id: invoiceId,
      certified_amount_cents: certifiedAmountCents,
      description: description.trim(),
      work_period_start: workPeriodStart || undefined,
      work_period_end: workPeriodEnd || undefined,
      notes: notes.trim() || undefined,
    })

    if (result.success) {
      toast({
        title: 'Certificate Created',
        description: `Payment certificate for ${formatCurrency(certifiedAmountCents / 100)} has been created.`,
      })
      router.push(`/invoices/${invoiceId}?tab=certificates`)
    } else {
      setError(result.error || 'Failed to create certificate')
      setSubmitting(false)
    }
  }

  const handleCertifyAll = () => {
    setCertifiedAmount((remainingBalance / 100).toFixed(2))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <h1 className="text-xl font-semibold">Invoice Not Found</h1>
        <p className="text-muted-foreground">{error || 'The invoice could not be loaded.'}</p>
        <Button asChild variant="outline">
          <Link href="/pm/approvals">Go Back</Link>
        </Button>
      </div>
    )
  }

  if (remainingBalance <= 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <CheckCircle className="w-12 h-12 text-success" />
        <h1 className="text-xl font-semibold">Invoice Fully Certified</h1>
        <p className="text-muted-foreground">This invoice has been fully certified. No more certificates can be created.</p>
        <Button asChild variant="outline">
          <Link href={`/invoices/${invoiceId}`}>Back to Invoice</Link>
        </Button>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="New Payment Certificate"
        pageDescription={`${invoice.invoice_number} - ${invoice.contractor.company_name}`}
      />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Page Header Card */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild title="Back to Invoice">
              <Link href={`/invoices/${invoiceId}`}>
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">New Payment Certificate</h1>
              <p className="text-sm text-muted-foreground">
                {invoice.invoice_number} - {invoice.contractor.company_name}
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Invoice Summary Card */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Invoice Summary
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Invoice Total</p>
                  <p className="text-lg font-semibold">{formatCurrency(invoiceTotal / 100)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Previously Certified</p>
                  <p className="text-lg font-semibold text-muted-foreground">{formatCurrency(previouslyCertified / 100)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Remaining Balance</p>
                  <p className="text-lg font-semibold text-warning">{formatCurrency(remainingBalance / 100)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Holdback Rate</p>
                  <p className="text-lg font-semibold">{holdbackPercent}%</p>
                </div>
              </div>
              
              {/* Progress bar */}
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Certification Progress</span>
                  <span className="font-medium">{Math.round(currentProgress)}%</span>
                </div>
                <Progress value={currentProgress} className="h-2" />
              </div>

              {/* Existing certificates */}
              {existingCertificates.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-sm font-medium text-muted-foreground mb-2">
                    {existingCertificates.length} Existing Certificate{existingCertificates.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-1">
                    {existingCertificates.map(cert => (
                      <div key={cert.id} className="flex justify-between text-sm">
                        <span className="font-mono">{cert.certificate_number}</span>
                        <span>{formatCurrency(cert.certified_amount_cents / 100)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Certificate Form */}
            <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Calculator className="w-5 h-5 text-primary" />
                Certificate Details
              </h2>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Certified Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount" className="flex items-center justify-between">
                  <span>Certified Amount *</span>
                  <Button 
                    type="button" 
                    variant="link" 
                    size="sm" 
                    className="h-auto p-0 text-primary"
                    onClick={handleCertifyAll}
                  >
                    Certify Full Remaining Balance
                  </Button>
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={(remainingBalance / 100).toFixed(2)}
                    placeholder="0.00"
                    value={certifiedAmount}
                    onChange={(e) => setCertifiedAmount(e.target.value)}
                    className="pl-8 text-lg font-semibold"
                    required
                  />
                </div>
                {certifiedAmountCents > remainingBalance && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Amount exceeds remaining balance of {formatCurrency(remainingBalance / 100)}
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  placeholder="Describe the work being certified for payment..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  required
                />
              </div>

              {/* Work Period */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="workStart" className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Work Period Start
                  </Label>
                  <Input
                    id="workStart"
                    type="date"
                    value={workPeriodStart}
                    onChange={(e) => setWorkPeriodStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workEnd" className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Work Period End
                  </Label>
                  <Input
                    id="workEnd"
                    type="date"
                    value={workPeriodEnd}
                    onChange={(e) => setWorkPeriodEnd(e.target.value)}
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Any additional notes or comments..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>

              <Separator />

              {/* Submit */}
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" asChild>
                  <Link href={`/invoices/${invoiceId}`}>Cancel</Link>
                </Button>
                <Button 
                  type="submit" 
                  disabled={!canSubmit || submitting}
                >
                  {submitting ? 'Creating...' : 'Create Certificate'}
                </Button>
              </div>
            </form>
          </div>

          {/* Live Calculations Sidebar */}
          <div className="space-y-6">
            {/* This Certificate Breakdown */}
            <div className="bg-card border border-border rounded-xl p-6 sticky top-24">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                This Certificate
              </h3>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Certified Amount</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(certifiedAmountCents / 100)}
                  </span>
                </div>
                
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Percent className="w-3 h-3" />
                    Holdback ({holdbackPercent}%)
                  </span>
                  <span className="text-warning">
                    -{formatCurrency(holdbackAmountCents / 100)}
                  </span>
                </div>
                
                <Separator />
                
                <div className="flex justify-between items-center">
                  <span className="font-medium">Net Payable</span>
                  <span className="font-bold text-xl text-primary">
                    {formatCurrency(netPayableCents / 100)}
                  </span>
                </div>
              </div>

              {/* After This Certificate */}
              {certifiedAmountCents > 0 && (
                <>
                  <Separator className="my-6" />
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                    After This Certificate
                  </h3>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Certified</span>
                      <span className="font-medium">{formatCurrency(newTotalCertified / 100)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Remaining Balance</span>
                      <span className={`font-medium ${newRemainingBalance <= 0 ? 'text-success' : 'text-warning'}`}>
                        {formatCurrency(newRemainingBalance / 100)}
                      </span>
                    </div>
                    
                    {/* New progress visualization */}
                    <div className="mt-4 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">New Progress</span>
                        <span className="font-medium">{Math.round(newProgress)}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.min(100, newProgress)}%` }}
                        />
                      </div>
                    </div>

                    {newRemainingBalance <= 0 && (
                      <Alert className="mt-4 bg-success/10 border-success/20">
                        <CheckCircle className="w-4 h-4 text-success" />
                        <AlertDescription className="text-success">
                          This will fully certify the invoice!
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </>
              )}

              {/* Help text */}
              <div className="mt-6 p-3 bg-muted/30 rounded-lg">
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    The holdback amount will be retained until final project completion. 
                    Net payable is the amount that will be sent for payment processing.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
