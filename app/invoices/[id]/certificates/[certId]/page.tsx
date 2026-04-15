'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
  Home
} from 'lucide-react'
import { getPaymentCertificateById, approvePaymentCertificate, rejectPaymentCertificate } from '@/lib/actions/payment-certificates'

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
  invoice?: {
    id: string
    invoice_number: string
    total_cents: number
    holdback_percent: number
    contractor?: { company_name: string }
    project?: { name: string; project_number: string }
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

function formatDate(date: string | null) {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-CA', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  })
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Draft</Badge>
    case 'pending_approval':
      return <Badge variant="outline" className="border-amber-500 text-amber-600"><Clock className="w-3 h-3 mr-1" />Pending Approval</Badge>
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

export default function CertificateDetailPage() {
  const params = useParams()
  const router = useRouter()
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
        setCertificate(result.certificate as Certificate)
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to load certificate',
          variant: 'destructive',
        })
      }
    } catch (error) {
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
        toast({
          title: 'Certificate Approved',
          description: 'The payment certificate has been approved.',
        })
        fetchCertificate()
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to approve certificate',
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
        toast({
          title: 'Certificate Rejected',
          description: 'The payment certificate has been rejected.',
        })
        fetchCertificate()
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to reject certificate',
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle={certificate.certificate_number}
        pageDescription={`Payment Certificate for ${invoice?.invoice_number || 'Invoice'}`}
      />
      
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Page Header Card */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild title="Back to Invoice">
                <Link href={`/invoices/${invoiceId}`}>
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold">{certificate.certificate_number}</h1>
                  {getStatusBadge(certificate.status)}
                </div>
                <p className="text-sm text-muted-foreground">
                  Payment Certificate for {invoice?.invoice_number || 'Invoice'}
                </p>
              </div>
            </div>
            
            {/* Action Buttons */}
            {certificate.status === 'pending_approval' && (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={handleReject}
                  disabled={actionLoading}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button 
                  onClick={handleApprove}
                  disabled={actionLoading}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Certificate Details Card */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
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
                <p className="text-sm text-muted-foreground">Holdback Deduction</p>
                <p className="text-lg font-semibold text-destructive">-{formatCurrency(certificate.holdback_amount_cents / 100)}</p>
              </div>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Net Payable</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(certificate.net_payable_cents / 100)}</p>
              </div>
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
                      {formatDate(certificate.work_period_start)} - {formatDate(certificate.work_period_end)}
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
