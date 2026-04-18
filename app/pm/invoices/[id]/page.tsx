'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Calendar, Building2, DollarSign, Clock, CheckCircle, XCircle, AlertCircle, Send, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { createClient } from '@/lib/supabase/client'
import { AppHeader } from '@/components/app-header'
import {
  submitCertificate,
  resubmitCertificate,
  approvePaymentCertificate,
  rejectPaymentCertificate,
} from '../../actions'

type Invoice = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  total_cents: number
  holdback_cents: number
  net_payable_cents: number
  status: string
  contractor: {
    id: string
    company_name: string
    contact_name: string | null
  } | null
  project: {
    id: string
    name: string
    project_number: string
  } | null
}

type PaymentCertificate = {
  id: string
  certificate_number: string
  certified_amount_cents: number
  net_payable_cents: number
  status: string
  created_at: string
  submitted_at: string | null
  approved_at: string | null
  rejection_reason: string | null
  work_period_start: string | null
  work_period_end: string | null
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  draft: { label: 'Draft', variant: 'secondary', icon: <FileText className="w-4 h-4" /> },
  submitted: { label: 'Submitted', variant: 'outline', icon: <Clock className="w-4 h-4" /> },
  pending_approval: { label: 'Pending Approval', variant: 'outline', icon: <AlertCircle className="w-4 h-4" /> },
  approved: { label: 'Approved', variant: 'default', icon: <CheckCircle className="w-4 h-4" /> },
  rejected: { label: 'Rejected', variant: 'destructive', icon: <XCircle className="w-4 h-4" /> },
  paid: { label: 'Paid', variant: 'default', icon: <CheckCircle className="w-4 h-4" /> },
  partially_paid: { label: 'Partially Paid', variant: 'outline', icon: <DollarSign className="w-4 h-4" /> },
  disputed: { label: 'Disputed', variant: 'destructive', icon: <AlertCircle className="w-4 h-4" /> },
}

const certStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  pending: { label: 'Pending Approval', variant: 'outline' },
  approved: { label: 'Approved', variant: 'default' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  paid: { label: 'Paid', variant: 'default' },
  partially_paid: { label: 'Partially Paid', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
}

export default function PMInvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string
  const { toast } = useToast()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [notes, setNotes] = useState('')

  // Certificate state
  const [certificates, setCertificates] = useState<PaymentCertificate[]>([])
  const [certsLoading, setCertsLoading] = useState(true)
  const [certActionLoading, setCertActionLoading] = useState<string | null>(null)
  const [rejectCertDialogOpen, setRejectCertDialogOpen] = useState(false)
  const [rejectCertReason, setRejectCertReason] = useState('')
  const [rejectingCertId, setRejectingCertId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)

  useEffect(() => {
    async function fetchInvoice() {
      const supabase = createClient()

      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          invoice_date,
          due_date,
          total_cents,
          holdback_cents,
          net_payable_cents,
          status,
          contractor:contractors(id, company_name, contact_name),
          project:projects(id, name, project_number)
        `)
        .eq('id', invoiceId)
        .single()

      if (error) {
        console.error('Error fetching invoice:', error)
        setError('Invoice not found')
      } else {
        setInvoice(data as unknown as Invoice)
      }
      setLoading(false)
    }

    if (invoiceId) {
      fetchInvoice()
    }
  }, [invoiceId])

  useEffect(() => {
    async function fetchCertificates() {
      const supabase = createClient()
      const { data } = await supabase
        .from('payment_certificates')
        .select('id, certificate_number, certified_amount_cents, net_payable_cents, status, created_at, submitted_at, approved_at, rejection_reason, work_period_start, work_period_end')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: true })
      setCertificates((data as PaymentCertificate[]) || [])
      setCertsLoading(false)
    }

    async function fetchUserRole() {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: userData } = await supabase
            .from('users')
            .select('role')
            .eq('auth_user_id', user.id)
            .single()
          if (userData?.role) setUserRole(userData.role)
        }
      } catch (err) {
        console.error('Error fetching user role:', err)
      } finally {
        setRoleLoading(false)
      }
    }

    if (invoiceId) {
      fetchCertificates()
      fetchUserRole()
    }
  }, [invoiceId])

  const refreshCertificates = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, certified_amount_cents, net_payable_cents, status, created_at, submitted_at, approved_at, rejection_reason, work_period_start, work_period_end')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })
    setCertificates((data as PaymentCertificate[]) || [])
  }

  const handleApprove = async () => {
    setActionLoading(true)
    const supabase = createClient()

    const { error } = await supabase
      .from('invoices')
      .update({ status: 'approved' })
      .eq('id', invoiceId)

    if (error) {
      console.error('Error approving invoice:', error)
      alert('Failed to approve invoice')
    } else {
      setInvoice(prev => prev ? { ...prev, status: 'approved' } : null)
    }
    setActionLoading(false)
  }

  const handleReject = async () => {
    if (!notes.trim()) {
      alert('Please provide a reason for rejection')
      return
    }

    setActionLoading(true)
    const supabase = createClient()

    const { error } = await supabase
      .from('invoices')
      .update({ status: 'rejected' })
      .eq('id', invoiceId)

    if (error) {
      console.error('Error rejecting invoice:', error)
      alert('Failed to reject invoice')
    } else {
      setInvoice(prev => prev ? { ...prev, status: 'rejected' } : null)
    }
    setActionLoading(false)
  }

  const handleSubmitCertificate = async (certId: string) => {
    setCertActionLoading(certId)
    const result = await submitCertificate({ certificate_id: certId })
    if (result.success) {
      toast({ title: 'Certificate Submitted', description: 'Certificate sent for approval.' })
      await refreshCertificates()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to submit certificate', variant: 'destructive' })
    }
    setCertActionLoading(null)
  }

  const handleResubmitCertificate = async (certId: string) => {
    setCertActionLoading(certId)
    const result = await resubmitCertificate({ certificate_id: certId })
    if (result.success) {
      toast({ title: 'Certificate Reset', description: 'Certificate reset to draft for revision.' })
      await refreshCertificates()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to reset certificate', variant: 'destructive' })
    }
    setCertActionLoading(null)
  }

  const handleApproveCertificate = async (certId: string) => {
    setCertActionLoading(certId)
    const result = await approvePaymentCertificate({ certificate_id: certId })
    if (result.success) {
      toast({ title: 'Certificate Approved', description: 'Certificate approved for payment.' })
      await refreshCertificates()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to approve certificate', variant: 'destructive' })
    }
    setCertActionLoading(null)
  }

  const handleRejectCertificate = async () => {
    if (!rejectingCertId || !rejectCertReason.trim()) return
    setCertActionLoading(rejectingCertId)
    const result = await rejectPaymentCertificate({ certificate_id: rejectingCertId, reason: rejectCertReason })
    if (result.success) {
      toast({ title: 'Certificate Rejected', description: 'Certificate has been rejected.' })
      setRejectCertDialogOpen(false)
      setRejectCertReason('')
      setRejectingCertId(null)
      await refreshCertificates()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to reject certificate', variant: 'destructive' })
    }
    setCertActionLoading(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/pm/dashboard">
            <Button variant="ghost" className="mb-4 gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Button>
          </Link>
          <Card>
            <CardContent className="p-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">Invoice Not Found</h2>
              <p className="text-muted-foreground">The invoice you&apos;re looking for doesn&apos;t exist or you don&apos;t have permission to view it.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const status = statusConfig[invoice.status] || statusConfig.submitted
  const canTakeAction = ['submitted', 'pending_approval'].includes(invoice.status)
  const canApproveRole = ['admin', 'project_manager'].includes(userRole)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle={invoice.invoice_number}
        pageDescription="Invoice Details"
      />

      <div className="max-w-4xl mx-auto p-6">
        {/* Status Badge */}
        <div className="flex justify-end mb-4">
          <Badge variant={status.variant} className="gap-1 text-sm px-3 py-1">
            {status.icon}
            {status.label}
          </Badge>
        </div>

        <div className="grid gap-6">
          {/* Invoice Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Invoice Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Number</p>
                  <p className="font-medium">{invoice.invoice_number}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Date</p>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {new Date(invoice.invoice_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {new Date(invoice.due_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Contractor</p>
                  <p className="font-medium flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    {invoice.contractor?.company_name || 'Unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Project</p>
                  <p className="font-medium">
                    {invoice.project ? `${invoice.project.project_number} - ${invoice.project.name}` : 'No project'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Financial Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Financial Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-2xl font-bold">
                    ${(invoice.total_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Holdback</p>
                  <p className="text-2xl font-bold text-orange-600">
                    ${(invoice.holdback_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Net Payable</p>
                  <p className="text-2xl font-bold text-green-600">
                    ${(invoice.net_payable_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Certificates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Payment Certificates
              </CardTitle>
            </CardHeader>
            <CardContent>
              {certsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : certificates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No payment certificates issued for this invoice.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {certificates.map((cert) => {
                    const certStatus = certStatusConfig[cert.status] || { label: cert.status, variant: 'outline' as const }
                    const isActioning = certActionLoading === cert.id

                    return (
                      <div key={cert.id} className="border border-border rounded-lg p-4 space-y-3">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{cert.certificate_number}</p>
                            <p className="text-sm text-muted-foreground">
                              ${(cert.certified_amount_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} certified
                              {cert.work_period_start && cert.work_period_end && (
                                <> &bull; {new Date(cert.work_period_start).toLocaleDateString()} – {new Date(cert.work_period_end).toLocaleDateString()}</>
                              )}
                            </p>
                          </div>
                          <Badge variant={certStatus.variant as 'default' | 'secondary' | 'destructive' | 'outline'}>
                            {certStatus.label}
                          </Badge>
                        </div>

                        {/* Rejection reason */}
                        {cert.status === 'rejected' && cert.rejection_reason && (
                          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                            <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-1">Rejection Reason</p>
                            <p className="text-sm">{cert.rejection_reason}</p>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-2">
                          {cert.status === 'draft' && (
                            <Button
                              size="sm"
                              onClick={() => handleSubmitCertificate(cert.id)}
                              disabled={isActioning}
                              className="gap-2"
                            >
                              <Send className="w-3 h-3" />
                              {isActioning ? 'Submitting…' : 'Submit for Approval'}
                            </Button>
                          )}

                          {cert.status === 'rejected' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResubmitCertificate(cert.id)}
                              disabled={isActioning}
                              className="gap-2"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {isActioning ? 'Resetting…' : 'Reset to Draft'}
                            </Button>
                          )}

                          {cert.status === 'pending' && (
                            roleLoading ? (
                              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary" />
                                Loading…
                              </div>
                            ) : canApproveRole ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleApproveCertificate(cert.id)}
                                  disabled={isActioning}
                                  className="gap-2"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  {isActioning ? 'Approving…' : 'Approve'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    setRejectingCertId(cert.id)
                                    setRejectCertDialogOpen(true)
                                  }}
                                  disabled={isActioning}
                                  className="gap-2"
                                >
                                  <XCircle className="w-3 h-3" />
                                  Reject
                                </Button>
                              </>
                            ) : (
                              <Badge variant="outline" className="gap-1">
                                <Clock className="w-3 h-3" />
                                Awaiting Approval
                              </Badge>
                            )
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoice Review Actions */}
          {canTakeAction && (
            <Card>
              <CardHeader>
                <CardTitle>Review Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Notes (required for rejection)</label>
                  <Textarea
                    placeholder="Add notes or reason for rejection..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve Invoice
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject Invoice
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Reject Certificate Dialog */}
      <Dialog open={rejectCertDialogOpen} onOpenChange={setRejectCertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Certificate</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this payment certificate. The PM will be able to revise and resubmit it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter rejection reason..."
            value={rejectCertReason}
            onChange={(e) => setRejectCertReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectCertDialogOpen(false)
                setRejectCertReason('')
                setRejectingCertId(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectCertificate}
              disabled={!rejectCertReason.trim() || certActionLoading !== null}
            >
              {certActionLoading ? 'Rejecting…' : 'Reject Certificate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
