'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Building2, Upload, FileText, Calculator, ArrowLeft, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'
import { getVendorProjects, submitVendorInvoice, getProjectTaxRate, type ProjectTaxRate } from '@/lib/actions/vendor-invoices'

// Removed mockProjects

export default function SubmitInvoicePage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  
  // Form state
  const [projectId, setProjectId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [subtotal, setSubtotal] = useState('')
  const [applyHoldback, setApplyHoldback] = useState(true)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [taxRate, setTaxRate] = useState<ProjectTaxRate | null>(null)
  const [taxLoading, setTaxLoading] = useState(false)

  // Calculate amounts from the subtotal + province tax rates
  const subtotalNum = parseFloat(subtotal) || 0
  const gstHstAmount = taxRate ? subtotalNum * taxRate.gstHstRate : 0
  const pstAmount = taxRate ? subtotalNum * taxRate.pstRate : 0
  const qstAmount = taxRate ? subtotalNum * taxRate.qstRate : 0
  const totalAmountNum = subtotalNum + gstHstAmount + pstAmount + qstAmount
  const holdbackAmount = applyHoldback ? totalAmountNum * 0.10 : 0
  const netPayable = totalAmountNum - holdbackAmount

  const gstHstLabel = taxRate?.usesHst
    ? `HST (${(taxRate.gstHstRate * 100).toFixed(0)}%)`
    : `GST (${((taxRate?.gstHstRate ?? 0) * 100).toFixed(0)}%)`

  // File upload handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (file.type === 'application/pdf') {
        setUploadedFile(file)
      }
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0])
    }
  }

  const [projects, setProjects] = useState<{ id: string, name: string, project_number: string }[]>([])
  
  // Load projects
  useEffect(() => {
    async function load() {
      const { success, projects } = await getVendorProjects()
      if (success) {
        setProjects(projects || [])
      }
    }
    load()
  }, [])

  // Load the province tax rate whenever the selected project changes
  useEffect(() => {
    if (!projectId) {
      setTaxRate(null)
      return
    }
    let cancelled = false
    setTaxLoading(true)
    getProjectTaxRate(projectId)
      .then((res) => {
        if (cancelled) return
        setTaxRate(res.success && res.rate ? res.rate : null)
      })
      .finally(() => {
        if (!cancelled) setTaxLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('projectId', projectId)
      formData.append('invoiceNumber', invoiceNumber)
      formData.append('invoiceDate', invoiceDate)
      formData.append('dueDate', new Date(new Date(invoiceDate).getTime() + 30*24*60*60*1000).toISOString().split('T')[0]) // 30 days
      formData.append('totalAmount', totalAmountNum.toString())
      formData.append('subtotal', subtotalNum.toString())
      formData.append('gstHst', gstHstAmount.toString())
      formData.append('pst', pstAmount.toString())
      formData.append('qst', qstAmount.toString())
      formData.append('gstHstRate', (taxRate?.gstHstRate ?? 0).toString())
      formData.append('pstRate', (taxRate?.pstRate ?? 0).toString())
      formData.append('qstRate', (taxRate?.qstRate ?? 0).toString())
      formData.append('holdbackAmount', holdbackAmount.toString())
      if (uploadedFile) {
        formData.append('file', uploadedFile)
      }

      const result = await submitVendorInvoice(formData)
      if (result.success) {
        // Notifications (in-app + email/WhatsApp to accountants, admins, and the
        // assigned PM) are dispatched server-side by submitVendorInvoice via the
        // centralized status engine — no client-side notification call needed.
        toast({
          title: 'Invoice Submitted Successfully',
          description: (
            <span className="text-sm">Your invoice has been submitted and the review team has been notified.</span>
          ),
        })
        setIsSuccess(true)
      } else {
        toast({ title: 'Submission Failed', description: result.error, variant: 'destructive' })
      }
    } catch (e) {
      console.error(e)
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-success" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Invoice Submitted</h1>
            <p className="text-muted-foreground mt-2">
              Your invoice <span className="font-medium text-foreground">{invoiceNumber}</span> has been submitted for review.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-left space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatCurrency(subtotalNum)}</span>
            </div>
            {gstHstAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{gstHstLabel}</span>
                <span className="font-medium">{formatCurrency(gstHstAmount)}</span>
              </div>
            )}
            {pstAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">PST ({((taxRate?.pstRate ?? 0) * 100).toFixed(0)}%)</span>
                <span className="font-medium">{formatCurrency(pstAmount)}</span>
              </div>
            )}
            {qstAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">QST ({((taxRate?.qstRate ?? 0) * 100).toFixed(2)}%)</span>
                <span className="font-medium">{formatCurrency(qstAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Invoice Total</span>
              <span className="font-medium">{formatCurrency(totalAmountNum)}</span>
            </div>
            {applyHoldback && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">10% Statutory Holdback</span>
                <span className="font-medium text-warning">-{formatCurrency(holdbackAmount)}</span>
              </div>
            )}
            <div className="pt-3 border-t border-border flex justify-between">
              <span className="font-medium">Net Payable</span>
              <span className="font-semibold text-lg">{formatCurrency(netPayable)}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            You will be notified once your invoice has been reviewed and approved for payment.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" asChild>
              <Link href="/vendor/portal">Back to Portal</Link>
            </Button>
            <Button className="flex-1" onClick={() => {
              setIsSuccess(false)
              setProjectId('')
              setInvoiceNumber('')
              setInvoiceDate('')
              setSubtotal('')
              setApplyHoldback(true)
              setUploadedFile(null)
            }}>
              Submit Another
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link 
                href="/vendor/portal" 
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back to Portal</span>
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold">PayFlow AP</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Page Header */}
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Submit Invoice</h1>
            <p className="text-muted-foreground mt-1">
              Submit a new invoice for payment processing. Required fields are marked with *.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column - Form */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-card border border-border rounded-xl p-6 space-y-6">
                  <h2 className="font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    Invoice Details
                  </h2>

                  {/* Project Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="project">Project *</Label>
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger id="project">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            <span className="font-medium">{project.name}</span>
                            <span className="text-muted-foreground ml-2">({project.project_number})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Invoice Number */}
                    <div className="space-y-2">
                      <Label htmlFor="invoiceNumber">Invoice Number *</Label>
                      <Input
                        id="invoiceNumber"
                        placeholder="e.g., INV-2024-0042"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        required
                      />
                    </div>

                    {/* Invoice Date */}
                    <div className="space-y-2">
                      <Label htmlFor="invoiceDate">Invoice Date *</Label>
                      <Input
                        id="invoiceDate"
                        type="date"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Subtotal Amount */}
                  <div className="space-y-2">
                    <Label htmlFor="subtotal">Subtotal Before Tax (CAD) *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="subtotal"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="pl-7"
                        value={subtotal}
                        onChange={(e) => setSubtotal(e.target.value)}
                        required
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {!projectId
                        ? 'Select a project first to apply the correct provincial tax.'
                        : taxLoading
                          ? 'Loading provincial tax rate…'
                          : taxRate
                            ? `Taxes for ${taxRate.province} are calculated automatically below.`
                            : 'Tax rate unavailable for this project — enter subtotal only.'}
                    </p>
                  </div>

                  {/* Holdback Checkbox */}
                  <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg border border-border">
                    <Checkbox
                      id="holdback"
                      checked={applyHoldback}
                      onCheckedChange={(checked) => setApplyHoldback(checked as boolean)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="holdback" className="cursor-pointer font-medium">
                        Apply 10% Statutory Holdback
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        As per the Canadian Builder&apos;s Lien Act, 10% of the invoice amount will be held for 45 days after substantial completion.
                      </p>
                    </div>
                  </div>
                </div>

                {/* File Upload */}
                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    Attach Invoice PDF *
                  </h2>

                  <div
                    className={`
                      relative border-2 border-dashed rounded-xl p-8 text-center transition-colors
                      ${dragActive ? 'border-primary bg-primary/5' : 'border-border'}
                      ${uploadedFile ? 'border-success bg-success/5' : ''}
                    `}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    
                    {uploadedFile ? (
                      <div className="space-y-3">
                        <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                          <Check className="w-6 h-6 text-success" />
                        </div>
                        <div>
                          <p className="font-medium">{uploadedFile.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setUploadedFile(null)
                          }}
                        >
                          <X className="w-4 h-4 mr-2" />
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">Drop your invoice PDF here</p>
                          <p className="text-sm text-muted-foreground">
                            or click to browse (PDF only, max 10MB)
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column - Summary */}
              <div className="space-y-6">
                <div className="bg-card border border-border rounded-xl p-6 space-y-4 sticky top-8">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-muted-foreground" />
                    Payment Summary
                  </h2>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium">{formatCurrency(subtotalNum)}</span>
                    </div>

                    {gstHstAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{gstHstLabel}</span>
                        <span className="font-medium">{formatCurrency(gstHstAmount)}</span>
                      </div>
                    )}

                    {pstAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">PST ({((taxRate?.pstRate ?? 0) * 100).toFixed(0)}%)</span>
                        <span className="font-medium">{formatCurrency(pstAmount)}</span>
                      </div>
                    )}

                    {qstAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">QST ({((taxRate?.qstRate ?? 0) * 100).toFixed(2)}%)</span>
                        <span className="font-medium">{formatCurrency(qstAmount)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-sm pt-2 border-t border-border">
                      <span className="text-muted-foreground">Invoice Total</span>
                      <span className="font-medium">{formatCurrency(totalAmountNum)}</span>
                    </div>

                    {applyHoldback && totalAmountNum > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">10% Statutory Holdback</span>
                        <span className="font-medium text-warning">-{formatCurrency(holdbackAmount)}</span>
                      </div>
                    )}

                    <div className="pt-3 border-t border-border">
                      <div className="flex justify-between">
                        <span className="font-medium">Net Payable</span>
                        <span className="font-semibold text-xl">{formatCurrency(netPayable)}</span>
                      </div>
                      {applyHoldback && totalAmountNum > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Holdback released 45 days after substantial completion
                        </p>
                      )}
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full" 
                    size="lg"
                    disabled={!projectId || !invoiceNumber || !invoiceDate || !subtotal || !uploadedFile || isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Submit Invoice'
                    )}
                  </Button>

                  {/* Validation Messages */}
                  {(!projectId || !invoiceNumber || !invoiceDate || !subtotal || !uploadedFile) && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">Required to submit:</p>
                      <ul className="space-y-0.5">
                        {!projectId && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Select a project</li>}
                        {!invoiceNumber && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Enter invoice number</li>}
                        {!invoiceDate && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Enter invoice date</li>}
                        {!subtotal && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Enter subtotal amount</li>}
                        {!uploadedFile && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Upload invoice PDF</li>}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Info Box */}
                <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-2">
                  <h3 className="font-medium text-sm">What happens next?</h3>
                  <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>Your invoice will be processed by our OCR system</li>
                    <li>An accountant will review and verify the details</li>
                    <li>You&apos;ll receive a notification once approved</li>
                    <li>Payment will be processed within 30 days</li>
                  </ol>
                </div>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
