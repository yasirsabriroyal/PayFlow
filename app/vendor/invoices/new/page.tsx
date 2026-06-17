'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { upload } from '@vercel/blob/client'
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
import { getVendorProjects, submitVendorInvoice, getProjectTaxRate, getContractorAccountStatus, type ProjectTaxRate } from '@/lib/actions/vendor-invoices'

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
  const [files, setFiles] = useState<File[]>([])
  // Per-file upload progress (0-100), aligned to `files` by index.
  const [uploadProgress, setUploadProgress] = useState<number[]>([])
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

  // Allowed file types — kept in sync with the upload-token route and server.
  const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15 MB
  const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.heif']
  const ALLOWED_MIME = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
  ]

  // Validate a single file by MIME type (with an extension fallback, since some
  // browsers report an empty type for HEIC) and size. Returns an error or null.
  const validateFile = (file: File): string | null => {
    const lowerName = file.name.toLowerCase()
    const extOk = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
    const mimeOk = file.type ? ALLOWED_MIME.includes(file.type) : false
    if (!extOk && !mimeOk) {
      return 'Unsupported file type. Use PDF, JPG, PNG, or HEIC.'
    }
    if (file.size === 0) {
      return 'File is empty.'
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File exceeds the 15 MB limit.'
    }
    return null
  }

  // Add files from a picker or drop, validating each and de-duplicating by
  // name + size. Invalid files are reported via toast and skipped.
  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const accepted: File[] = []
      const rejected: string[] = []

      Array.from(incoming).forEach((file) => {
        const error = validateFile(file)
        if (error) {
          rejected.push(`${file.name}: ${error}`)
        } else {
          accepted.push(file)
        }
      })

      if (accepted.length > 0) {
        setFiles((prev) => {
          const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
          const deduped = accepted.filter((f) => !seen.has(`${f.name}:${f.size}`))
          return [...prev, ...deduped]
        })
      }

      if (rejected.length > 0) {
        toast({
          title: 'Some files were not added',
          description: rejected.join(' '),
          variant: 'destructive',
        })
      }
    },
    [toast],
  )

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

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

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files)
    }
    // Reset the input so re-selecting the same file fires onChange again.
    e.target.value = ''
  }

  const [projects, setProjects] = useState<{ id: string, name: string, project_number: string }[]>([])

  // Account status gate: only `active` contractors may submit invoices. We load
  // this up front so a pending/suspended contractor sees a clear explanation
  // instead of filling out the form and hitting a generic upload error.
  const [accountStatus, setAccountStatus] = useState<'active' | 'pending_kyc' | 'suspended' | 'inactive' | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getContractorAccountStatus()
      .then((res) => {
        if (!cancelled) setAccountStatus(res.success ? res.status : null)
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

    if (files.length === 0) {
      toast({
        title: 'Invoice document required',
        description: 'Please attach at least one invoice file before submitting.',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)
    setUploadProgress(new Array(files.length).fill(0))

    try {
      // 1. Upload each file directly to Vercel Blob (bypasses the 1 MB Server
      //    Action limit). Collect the resulting metadata to link server-side.
      const uploadedDocs: {
        pathname: string
        fileName: string
        fileSize: number
        fileType: string
      }[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
        const blob = await upload(`invoices/incoming/${Date.now()}-${cleanName}`, file, {
          access: 'private',
          handleUploadUrl: '/api/documents/upload-token',
          onUploadProgress: ({ percentage }) => {
            setUploadProgress((prev) => {
              const next = [...prev]
              next[i] = percentage
              return next
            })
          },
        })
        uploadedDocs.push({
          pathname: blob.pathname,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        })
      }

      // 2. Submit the invoice with the uploaded document metadata only.
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
      formData.append('documents', JSON.stringify(uploadedDocs))

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
      console.error('[v0] Invoice submission error:', e)
      toast({
        title: 'Upload failed',
        description:
          'We could not upload your documents or submit the invoice. Please check your files and try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
      setUploadProgress([])
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
              setFiles([])
              setUploadProgress([])
            }}>
              Submit Another
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // While we confirm the contractor's account status, show a spinner so we
  // never flash the form to someone who isn't allowed to submit invoices.
  if (statusLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  // Gate: only `active` contractors may submit invoices. Anyone else gets a
  // clear explanation and a path forward instead of a misleading upload error.
  if (accountStatus !== 'active') {
    const isPending = accountStatus === 'pending_kyc'
    const isSuspended = accountStatus === 'suspended'
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto">
            <FileText className="w-8 h-8 text-warning" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-balance">
              {isSuspended ? 'Your account is on hold' : 'Verification required'}
            </h1>
            <p className="text-muted-foreground mt-2 text-pretty">
              {isSuspended
                ? 'Your contractor account is currently suspended, so invoices cannot be submitted. Please contact the accounts payable team to resolve this.'
                : isPending
                  ? 'Your account is still being verified. Once your compliance documents have been reviewed and approved, you\u2019ll be able to submit invoices.'
                  : 'Your account is not active yet, so invoices cannot be submitted. Please complete verification to continue.'}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {!isSuspended && (
              <Button className="w-full" asChild>
                <Link href="/vendor/compliance">Complete verification</Link>
              </Button>
            )}
            <Button variant="outline" className="w-full" asChild>
              <Link href="/vendor/portal">Back to Portal</Link>
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
                    Attach Invoice Documents *
                  </h2>

                  <div
                    className={`
                      relative border-2 border-dashed rounded-xl p-8 text-center transition-colors
                      ${dragActive ? 'border-primary bg-primary/5' : 'border-border'}
                      ${files.length > 0 ? 'border-success bg-success/5' : ''}
                    `}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
                      onChange={handleFileChange}
                      disabled={isSubmitting}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />

                    <div className="space-y-3">
                      <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto">
                        <Upload className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">
                          Drop your invoice files here
                        </p>
                        <p className="text-sm text-muted-foreground">
                          or click to browse — PDF, JPG, PNG, or HEIC. Multiple files allowed (max 15MB each).
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Selected files list */}
                  {files.length > 0 && (
                    <ul className="space-y-2">
                      {files.map((file, index) => {
                        const progress = uploadProgress[index] ?? 0
                        const uploading = isSubmitting && progress < 100
                        const done = isSubmitting && progress >= 100
                        return (
                          <li
                            key={`${file.name}-${file.size}-${index}`}
                            className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                          >
                            <div className="w-9 h-9 shrink-0 bg-muted rounded-lg flex items-center justify-center">
                              {done ? (
                                <Check className="w-4 h-4 text-success" />
                              ) : uploading ? (
                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                              ) : (
                                <FileText className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(file.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                              {isSubmitting && (
                                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              )}
                            </div>
                            {!isSubmitting && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeFile(index)}
                                aria-label={`Remove ${file.name}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
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
                    disabled={!projectId || !invoiceNumber || !invoiceDate || !subtotal || files.length === 0 || isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading &amp; submitting...
                      </>
                    ) : (
                      'Submit Invoice'
                    )}
                  </Button>

                  {/* Validation Messages */}
                  {(!projectId || !invoiceNumber || !invoiceDate || !subtotal || files.length === 0) && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">Required to submit:</p>
                      <ul className="space-y-0.5">
                        {!projectId && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Select a project</li>}
                        {!invoiceNumber && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Enter invoice number</li>}
                        {!invoiceDate && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Enter invoice date</li>}
                        {!subtotal && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Enter subtotal amount</li>}
                        {files.length === 0 && <li className="flex items-center gap-1"><X className="w-3 h-3 text-destructive" /> Attach at least one invoice document</li>}
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
