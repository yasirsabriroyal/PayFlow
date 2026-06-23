'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'
import {
  ArrowLeft,
  FileText,
  Calendar,
  DollarSign,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  User,
  Banknote,
  Lock,
  AlertTriangle,
  Loader2,
  CreditCard,
} from 'lucide-react'
import {
  getPaymentCertificateById,
  approvePaymentCertificate,
  rejectPaymentCertificate,
} from '@/lib/actions/payment-certificates'
import { recordCertificatePayment } from '@/app/accountant/actions'

type Certificate = {
  id: string
  certificate_number: string
  invoice_id: string
  certified_amount_cents: number
  holdback_amount_cents: number
  net_payable_cents: number
  status: string
  description: string | null
  notes: string | null
  work_period_start: string | null
  work_period_end: string | null
  created_at: string
  approved_at: string | null
  approved_by: string | null
  paid_at?: string | null
  paid_by?: string | null
  invoice?: {
    id: string
    invoice_number: string
    total_cents: number
    holdback_percent: number
    contractor?: {
      company_name: string
      preferred_payment_method?: string | null
      etransfer_email?: string | null
    }
    project?: { name: string; project_number: string }
  }
  payment?: {
    id: string
    payment_method: string
    amount_cents: number
    payment_date: string
    cheque_number?: string | null
    etransfer_reference?: string | null
    wire_reference?: string | null
    eft_file_id?: string | null
    status: string
    created_at: string
  } | null
}

type PaymentMethod = 'eft' | 'etransfer' | 'cheque' | 'wire'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  eft: 'EFT / Direct Deposit',
  etransfer: 'eTransfer',
  cheque: 'Cheque',
  wire: 'Wire Transfer',
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

function formatDate(date: string | null | undefined) {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return '-'
  return new Date(date).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Draft</Badge>
    case 'pending_approval':
      return <Badge variant="outline" className="border-amber-500 text-amber-600"><Clock className="w-3 h-3 mr-1" />Pending Approval</Badge>
    case 'submitted':
      return <Badge variant="outline" className="border-blue-500 text-blue-600"><Clock className="w-3 h-3 mr-1" />Submitted</Badge>
    case 'approved':
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>
    case 'rejected':
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>
    case 'paid':
      return <Badge variant="default" className="bg-blue-600"><Banknote className="w-3 h-3 mr-1" />Paid</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

// ─── Pay Certificate Panel ────────────────────────────────────────────────────

function PayCertificatePanel({
  certificate,
  onPaid,
}: {
  certificate: Certificate
  onPaid: () => void
}) {
  const { toast } = useToast()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    (certificate.invoice?.contractor?.preferred_payment_method as PaymentMethod) || 'eft'
  )
  const [chequeNumber, setChequeNumber] = useState('')
  const [etransferRef, setEtransferRef] = useState('')
  const [wireRef, setWireRef] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const preferredMethod = certificate.invoice?.contractor?.preferred_payment_method as PaymentMethod | null
  const etransferEmail = certificate.invoice?.contractor?.etransfer_email

  const handlePay = async () => {
    setSubmitting(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const result = await recordCertificatePayment({
        certificate_id: certificate.id,
        amount_cents: certificate.net_payable_cents,
        payment_method: paymentMethod,
        payment_date: today,
        cheque_number: chequeNumber || undefined,
        etransfer_reference: etransferRef || undefined,
        wire_reference: wireRef || undefined,
      })
      if (result?.success) {
        toast({
          title: 'Payment recorded',
          description: (result as { message?: string }).message || `Certificate ${certificate.certificate_number} has been paid and locked.`,
        })
        onPaid()
      } else {
        toast({
          title: 'Payment failed',
          description: (result as { error?: string }).error || 'An error occurred. Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Payment failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-primary" />
        Pay Certificate
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        Select a payment method. The amount is fixed at the certified net payable and cannot be changed.
      </p>

      {/* Amount — read-only */}
      <div className="bg-muted/50 rounded-lg p-4 mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Payment Amount</p>
          <p className="text-2xl font-bold mt-0.5">
            {formatCurrency(certificate.net_payable_cents / 100)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5" />
          Fixed — full certificate amount
        </div>
      </div>

      {/* Preferred method notice */}
      {preferredMethod && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 bg-muted/30 rounded-lg px-3 py-2">
          <Banknote className="w-3.5 h-3.5 shrink-0" />
          Contractor&apos;s preferred method:{' '}
          <span className="font-medium text-foreground">{PAYMENT_METHOD_LABELS[preferredMethod]}</span>
          {preferredMethod === 'etransfer' && etransferEmail && (
            <span className="ml-1">— {etransferEmail}</span>
          )}
        </div>
      )}

      <div className="space-y-4">
        {/* Payment method selector */}
        <div className="space-y-2">
          <Label htmlFor="paymentMethod">Payment Method</Label>
          <Select
            value={paymentMethod}
            onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
          >
            <SelectTrigger id="paymentMethod">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Method-specific reference fields */}
        {paymentMethod === 'cheque' && (
          <div className="space-y-2">
            <Label htmlFor="chequeNumber">Cheque Number</Label>
            <Input
              id="chequeNumber"
              value={chequeNumber}
              onChange={(e) => setChequeNumber(e.target.value)}
              placeholder="e.g. 001234"
            />
          </div>
        )}
        {paymentMethod === 'etransfer' && (
          <div className="space-y-2">
            <Label htmlFor="etransferRef">eTransfer Reference</Label>
            <Input
              id="etransferRef"
              value={etransferRef}
              onChange={(e) => setEtransferRef(e.target.value)}
              placeholder="Confirmation / transaction ID"
            />
            {!etransferEmail && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                No eTransfer email on file for this contractor. Add it in their payment preferences before processing.
              </p>
            )}
          </div>
        )}
        {paymentMethod === 'wire' && (
          <div className="space-y-2">
            <Label htmlFor="wireRef">Wire Reference</Label>
            <Input
              id="wireRef"
              value={wireRef}
              onChange={(e) => setWireRef(e.target.value)}
              placeholder="Wire transfer reference number"
            />
          </div>
        )}
      </div>

      <Separator className="my-5" />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Once paid, this certificate will be permanently locked. This action cannot be undone.
        </p>
        <Button
          onClick={handlePay}
          disabled={submitting || (paymentMethod === 'etransfer' && !etransferEmail)}
          className="shrink-0 gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Processing...' : 'Confirm Payment'}
        </Button>
      </div>
    </div>
  )
}

// ─── Paid / Locked Panel ──────────────────────────────────────────────────────

function PaidLockedPanel({ certificate }: { certificate: Certificate }) {
  const payment = certificate.payment

  const paymentRef =
    payment?.cheque_number ||
    payment?.etransfer_reference ||
    payment?.wire_reference ||
    payment?.eft_file_id ||
    (payment?.id ? payment.id.slice(0, 8).toUpperCase() : 'N/A')

  const methodLabel = payment?.payment_method
    ? (PAYMENT_METHOD_LABELS[payment.payment_method as PaymentMethod] ?? payment.payment_method.toUpperCase())
    : 'N/A'

  return (
    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <Lock className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-blue-900 dark:text-blue-100">
            This certificate has been fully paid and is locked
          </h2>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-0.5">
            No further payment actions are permitted. Only an admin-level reversal workflow can modify this record.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <div>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wide">Amount Paid</p>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-0.5">
                {payment ? formatCurrency(payment.amount_cents / 100) : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wide">Method</p>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-0.5">{methodLabel}</p>
            </div>
            <div>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wide">Reference</p>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-0.5 font-mono">{paymentRef}</p>
            </div>
            <div>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wide">Payment Date</p>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-0.5">
                {payment?.payment_date ? formatDate(payment.payment_date) : formatDateTime(certificate.paid_at)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CertificateDetailPage() {
  const params = useParams()
  const { toast } = useToast()
  const certId = params.certId as string
  const invoiceId = params.id as string

  const [certificate, setCertificate] = useState<Certificate | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchCertificate = useCallback(async () => {
    try {
      const result = await getPaymentCertificateById(certId)
      if (result.success && result.certificate) {
        setCertificate(result.certificate as unknown as Certificate)
      } else {
        toast({
          title: 'Error',
          description: (result as { error?: string }).error || 'Failed to load certificate',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Error',
        description: 'An error occurred while loading the certificate',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [certId, toast])

  useEffect(() => {
    fetchCertificate()
  }, [fetchCertificate])

  const handleApprove = async () => {
    setActionLoading(true)
    try {
      const result = await approvePaymentCertificate(certId)
      if (result.success) {
        toast({ title: 'Certificate Approved', description: 'The payment certificate has been approved.' })
        fetchCertificate()
      } else {
        toast({
          title: 'Error',
          description: (result as { error?: string }).error || 'Failed to approve certificate',
          variant: 'destructive',
        })
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    setActionLoading(true)
    try {
      const result = await rejectPaymentCertificate(certId, 'Rejected by reviewer')
      if (result.success) {
        toast({ title: 'Certificate Rejected', description: 'The payment certificate has been rejected.' })
        fetchCertificate()
      } else {
        toast({
          title: 'Error',
          description: (result as { error?: string }).error || 'Failed to reject certificate',
          variant: 'destructive',
        })
      }
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!certificate) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Certificate Not Found</h2>
          <p className="text-muted-foreground mb-4">The requested certificate could not be found.</p>
          <Button asChild>
            <Link href={`/invoices/${invoiceId}`}>Back to Invoice</Link>
          </Button>
        </div>
      </div>
    )
  }

  const invoice = certificate.invoice
  const isPaid = certificate.status === 'paid'

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle={certificate.certificate_number}
        pageDescription={`Payment Certificate for ${invoice?.invoice_number || 'Invoice'}`}
      />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Page Header Card */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild title="Back to Invoice">
                <Link href={`/invoices/${invoiceId}`}>
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold">{certificate.certificate_number}</h1>
                  {getStatusBadge(certificate.status)}
                  {isPaid && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Payment Certificate for {invoice?.invoice_number || 'Invoice'}
                </p>
              </div>
            </div>

            {/* Approve / Reject — only for pending_approval or submitted */}
            {(certificate.status === 'pending_approval' || certificate.status === 'submitted') && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleReject} disabled={actionLoading}>
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button onClick={handleApprove} disabled={actionLoading}>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Paid / Locked notice — shown prominently before other content */}
        {isPaid && <PaidLockedPanel certificate={certificate} />}

        {/* Certificate Details Card */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Certificate Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Certified Amount</p>
                <p className="text-2xl font-bold">{formatCurrency(certificate.certified_amount_cents / 100)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Payable</p>
                <p className="text-xl font-semibold text-primary">
                  {formatCurrency(certificate.net_payable_cents / 100)}
                </p>
              </div>
              {certificate.holdback_amount_cents > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground">Holdback Withheld</p>
                  <p className="font-medium text-amber-600">
                    {formatCurrency(certificate.holdback_amount_cents / 100)}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{formatDate(certificate.created_at)}</p>
                </div>
              </div>

              {certificate.work_period_start && (
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Work Period</p>
                    <p className="font-medium">
                      {formatDate(certificate.work_period_start)} — {formatDate(certificate.work_period_end)}
                    </p>
                  </div>
                </div>
              )}

              {certificate.approved_at && (
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Approved</p>
                    <p className="font-medium">{formatDate(certificate.approved_at)}</p>
                  </div>
                </div>
              )}

              {certificate.paid_at && (
                <div className="flex items-center gap-3">
                  <Lock className="w-4 h-4 text-blue-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Paid &amp; Locked</p>
                    <p className="font-medium">{formatDateTime(certificate.paid_at)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {certificate.description && (
            <div className="mt-6">
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="bg-muted/50 rounded-lg p-3">{certificate.description}</p>
            </div>
          )}

          {certificate.notes && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-1">Notes</p>
              <p className="bg-muted/50 rounded-lg p-3">{certificate.notes}</p>
            </div>
          )}
        </div>

        {/* Invoice Reference Card */}
        {invoice && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Invoice Reference
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Number</p>
                  <Link href={`/invoices/${invoiceId}`} className="font-medium text-primary hover:underline">
                    {invoice.invoice_number}
                  </Link>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Total</p>
                  <p className="font-medium">{formatCurrency(invoice.total_cents / 100)}</p>
                </div>
              </div>

              {invoice.contractor && (
                <div className="flex items-center gap-3">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Contractor</p>
                    <p className="font-medium">{invoice.contractor.company_name}</p>
                  </div>
                </div>
              )}

              {invoice.project && (
                <div className="flex items-center gap-3">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Project</p>
                    <p className="font-medium">{invoice.project.name}</p>
                  </div>
                </div>
              )}

              {/* Payment preference from contractor profile */}
              {invoice.contractor?.preferred_payment_method && (
                <div className="flex items-center gap-3">
                  <Banknote className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Payment Preference</p>
                    <p className="font-medium">
                      {PAYMENT_METHOD_LABELS[invoice.contractor.preferred_payment_method as PaymentMethod] ??
                        invoice.contractor.preferred_payment_method}
                    </p>
                    {invoice.contractor.preferred_payment_method === 'etransfer' &&
                      invoice.contractor.etransfer_email && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {invoice.contractor.etransfer_email}
                        </p>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pay Certificate Panel — only for approved status */}
        {certificate.status === 'approved' && (
          <PayCertificatePanel
            certificate={certificate}
            onPaid={() => {
              setLoading(true)
              fetchCertificate()
            }}
          />
        )}
      </div>
    </div>
  )
}
