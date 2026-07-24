'use client'

import React, { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Calendar, Building2, DollarSign, Clock, CheckCircle, XCircle, AlertCircle, Send, RotateCcw, Pencil, Mail, Phone, MapPin, FolderOpen, Shield, Plus, History, Upload, Trash2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { RoleTabBar } from '@/components/role-tab-bar'
import { PaymentReceiptModal } from '@/components/payment-receipt-modal'
import { InvoiceStatusTimeline } from '@/components/invoice-status-timeline'
import { InvoiceClarificationThread } from '@/components/invoice-clarification-thread'
import {
  getCertificatesForInvoice,
  submitCertificate,
  resubmitCertificate,
  approvePaymentCertificate,
  rejectPaymentCertificate,
  updatePaymentCertificate,
  pmApproveInvoice,
  pmRejectInvoice,
  pmDisputeInvoice,
  getPMInvoiceById,
  getPMInvoiceDocuments,
} from '../../actions'
import { deleteInvoiceDocument } from '@/lib/actions/invoice-documents'

type Invoice = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  total_cents: number
  holdback_cents: number
  net_payable_cents: number
  status: string
  description?: string | null
  notes?: string | null
  contractor: {
    id: string
    company_name: string
    contact_name: string | null
    email: string | null
    phone: string | null
    address_line1: string | null
    city: string | null
    province: string | null
    wcb_clearance_expiry: string | null
    status: string | null
  } | null
  project: {
    id: string
    name: string
    project_number: string
    address_line1: string | null
    city: string | null
    province: string | null
    start_date: string | null
    estimated_completion_date: string | null
    current_budget_cents: number | null
    spent_cents: number | null
    is_active: boolean | null
  } | null
}

type InvoiceDocument = {
  id: string
  file_name: string
  file_type: string | null
  file_size_bytes: number | null
  document_type: string | null
  description: string | null
  created_at: string
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
  payments: { id: string }[] | null
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

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDocType(type: string | null): string {
  if (!type) return 'Document'
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
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

  // Invoice attachments
  const [documents, setDocuments] = useState<InvoiceDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [previewDoc, setPreviewDoc] = useState<InvoiceDocument | null>(null)

  // Certificate state
  const [certificates, setCertificates] = useState<PaymentCertificate[]>([])
  const [certsLoading, setCertsLoading] = useState(true)
  const [certActionLoading, setCertActionLoading] = useState<string | null>(null)
  const [rejectCertDialogOpen, setRejectCertDialogOpen] = useState(false)
  const [rejectCertReason, setRejectCertReason] = useState('')
  const [rejectingCertId, setRejectingCertId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)

  // Edit draft cert state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCert, setEditingCert] = useState<PaymentCertificate | null>(null)
  const [editForm, setEditForm] = useState({
    certified_amount: '',
    description: '',
    work_period_start: '',
    work_period_end: '',
  })
  const [editLoading, setEditLoading] = useState(false)

  useEffect(() => {
    async function fetchInvoice() {
      // Scoped server action enforces PM assignment access; an out-of-scope
      // invoice returns "not found" rather than leaking data.
      const result = await getPMInvoiceById(invoiceId)

      if (!result.success || !result.invoice) {
        setError('Invoice not found')
      } else {
        setInvoice(result.invoice as unknown as Invoice)
      }
      setLoading(false)
    }

    if (invoiceId) {
      fetchInvoice()
    }
  }, [invoiceId])

  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDocuments = async () => {
    setDocsLoading(true)
    const result = await getPMInvoiceDocuments(invoiceId)
    if (result.success) {
      setDocuments(result.documents as InvoiceDocument[])
    }
    setDocsLoading(false)
  }

  useEffect(() => {
    if (invoiceId) {
      fetchDocuments()
    }
  }, [invoiceId])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('invoice_id', invoiceId)
      const documentType = documents.length === 0 ? 'original_invoice' : 'supporting_doc'
      formData.append('document_type', documentType)

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (result.success) {
        toast({
          title: 'Document uploaded',
          description: `${file.name} has been uploaded successfully.`,
        })
        fetchDocuments()
      } else {
        toast({
          title: 'Upload failed',
          description: result.error || 'Failed to upload document.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Upload error',
        description: 'An error occurred while uploading the document.',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return

    try {
      const result = await deleteInvoiceDocument(docId)
      if (result.success) {
        toast({
          title: 'Document deleted',
          description: 'The document has been removed successfully.',
        })
        fetchDocuments()
      } else {
        toast({
          title: 'Delete failed',
          description: result.error || 'Failed to delete document.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Delete error',
        description: 'An error occurred while deleting the document.',
        variant: 'destructive',
      })
    }
  }

  useEffect(() => {
    async function fetchCertificates() {
      const result = await getCertificatesForInvoice(invoiceId)
      if (result.success) {
        console.log('[PMInvoicePage] certificates fetched:', result.certificates)
        setCertificates(result.certificates as PaymentCertificate[])
      } else {
        console.error('[PMInvoicePage] failed to fetch certificates:', result.error)
      }
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
          console.log('[PMInvoicePage] user role fetched:', userData?.role)
          if (userData?.role) setUserRole(userData.role)
        }
      } catch (err) {
        console.error('[PMInvoicePage] error fetching user role:', err)
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
    const result = await getCertificatesForInvoice(invoiceId)
    if (result.success) {
      setCertificates(result.certificates as PaymentCertificate[])
    }
  }

  const handleApprove = async () => {
    setActionLoading(true)
    const result = await pmApproveInvoice(invoiceId)
    if (result.success) {
      setInvoice(prev => prev ? { ...prev, status: 'approved' } : null)
      toast({ title: 'Invoice Approved', description: 'The contractor and finance team have been notified.' })
    } else {
      toast({ title: 'Unable to approve', description: result.error || 'Failed to approve invoice', variant: 'destructive' })
    }
    setActionLoading(false)
  }

  const handleReject = async () => {
    if (!notes.trim()) {
      toast({ title: 'Reason required', description: 'Please provide a reason for rejection.', variant: 'destructive' })
      return
    }

    setActionLoading(true)
    const result = await pmRejectInvoice(invoiceId, notes.trim())
    if (result.success) {
      setInvoice(prev => prev ? { ...prev, status: 'rejected' } : null)
      toast({ title: 'Invoice Rejected', description: 'The contractor has been notified with your reason.' })
    } else {
      toast({ title: 'Unable to reject', description: result.error || 'Failed to reject invoice', variant: 'destructive' })
    }
    setActionLoading(false)
  }

  const handleDispute = async () => {
    if (!notes.trim()) {
      toast({ title: 'Reason required', description: 'Please describe the dispute before flagging.', variant: 'destructive' })
      return
    }

    setActionLoading(true)
    const result = await pmDisputeInvoice(invoiceId, notes.trim())
    if (result.success) {
      setInvoice(prev => prev ? { ...prev, status: 'disputed' } : null)
      toast({ title: 'Invoice Disputed', description: 'The finance team has been notified to review this dispute.' })
    } else {
      toast({ title: 'Unable to dispute', description: result.error || 'Failed to flag dispute', variant: 'destructive' })
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

  const openEditDialog = (cert: PaymentCertificate) => {
    setEditingCert(cert)
    setEditForm({
      certified_amount: (cert.certified_amount_cents / 100).toFixed(2),
      description: '',
      work_period_start: cert.work_period_start || '',
      work_period_end: cert.work_period_end || '',
    })
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingCert) return
    const amountCents = Math.round(parseFloat(editForm.certified_amount || '0') * 100)
    if (amountCents <= 0) {
      toast({ title: 'Error', description: 'Amount must be greater than 0', variant: 'destructive' })
      return
    }
    setEditLoading(true)
    const result = await updatePaymentCertificate({
      certificate_id: editingCert.id,
      certified_amount_cents: amountCents,
      description: editForm.description || undefined,
      work_period_start: editForm.work_period_start || undefined,
      work_period_end: editForm.work_period_end || undefined,
    })
    if (result.success) {
      toast({ title: 'Certificate Updated', description: 'Draft certificate has been updated.' })
      setEditDialogOpen(false)
      setEditingCert(null)
      await refreshCertificates()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to update certificate', variant: 'destructive' })
    }
    setEditLoading(false)
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
      <RoleTabBar role="project_manager" />

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

          {/* Notes & Description */}
          {(invoice.description || invoice.notes) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="w-5 h-5 text-primary" />
                  Notes & Description
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {invoice.description && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{invoice.description}</p>
                  </div>
                )}
                {invoice.description && invoice.notes && <hr className="border-t border-border" />}
                {invoice.notes && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Internal Notes</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{invoice.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Invoice Documents */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Invoice Documents
              </CardTitle>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUpload}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                />
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading ? 'Uploading...' : 'Upload Document'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {docsLoading ? (
                <p className="text-sm text-muted-foreground">Loading documents...</p>
              ) : documents.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  No document attached to this invoice. Review the line items and project scope before approving, or request a revision to ask the contractor to attach the original invoice.
                </div>
              ) : (
                <ul className="space-y-2">
                  {documents.map((doc) => {
                    const isImage = (doc.file_type || '').startsWith('image/')
                    const isPdf =
                      (doc.file_type || '').includes('pdf') ||
                      doc.file_name.toLowerCase().endsWith('.pdf')
                    const canPreview = isImage || isPdf
                    return (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{doc.file_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDocType(doc.document_type)}
                              {doc.file_size_bytes ? ` · ${formatFileSize(doc.file_size_bytes)}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {canPreview && (
                            <Button variant="outline" size="sm" onClick={() => setPreviewDoc(doc)}>
                              View
                            </Button>
                          )}
                          <a
                            href={`/api/documents/${doc.id}`}
                            className="inline-flex items-center text-sm text-primary hover:underline mr-1"
                          >
                            Download
                          </a>
                          {!['approved', 'partially_paid', 'paid'].includes(invoice.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteDocument(doc.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Contractor & Project Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            {/* Contractor Card */}
            {invoice.contractor && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="w-4 h-4" />
                    Contractor
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="font-semibold text-lg leading-tight">{invoice.contractor.company_name}</p>

                  {invoice.contractor.email && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <a href={`mailto:${invoice.contractor.email}`} className="hover:text-primary truncate">
                        {invoice.contractor.email}
                      </a>
                    </div>
                  )}

                  {invoice.contractor.phone && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <a href={`tel:${invoice.contractor.phone}`} className="hover:text-primary">
                        {invoice.contractor.phone}
                      </a>
                    </div>
                  )}

                  {(invoice.contractor.address_line1 || invoice.contractor.city) && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        {[invoice.contractor.address_line1, invoice.contractor.city, invoice.contractor.province]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </div>
                  )}

                  {invoice.contractor.wcb_clearance_expiry && (
                    <div className="flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">WCB</span>
                      {new Date(invoice.contractor.wcb_clearance_expiry) > new Date() ? (
                        <Badge className="bg-emerald-50 text-emerald-700 border-0 text-xs">Valid</Badge>
                      ) : (
                        <Badge className="bg-red-50 text-red-700 border-0 text-xs">Expired</Badge>
                      )}
                    </div>
                  )}

                  <Link href={`/pm/contractors/${invoice.contractor.id}`}>
                    <Button variant="outline" size="sm" className="w-full mt-1">
                      View Full Profile
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Project Card */}
            {invoice.project && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FolderOpen className="w-4 h-4" />
                    Project
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="font-semibold text-lg leading-tight">{invoice.project.name}</p>
                    <p className="text-sm text-muted-foreground">{invoice.project.project_number}</p>
                  </div>

                  {(invoice.project.address_line1 || invoice.project.city) && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        {[invoice.project.address_line1, invoice.project.city, invoice.project.province]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </div>
                  )}

                  {(invoice.project.start_date || invoice.project.estimated_completion_date) && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        {invoice.project.start_date
                          ? new Date(invoice.project.start_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
                          : 'TBD'}
                        {' – '}
                        {invoice.project.estimated_completion_date
                          ? new Date(invoice.project.estimated_completion_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
                          : 'TBD'}
                      </span>
                    </div>
                  )}

                  {invoice.project.current_budget_cents != null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <DollarSign className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Budget: </span>
                      <span className="font-medium text-foreground">
                        {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(invoice.project.current_budget_cents / 100)}
                      </span>
                    </div>
                  )}

                  <div>
                    {invoice.project.is_active ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-0 text-xs">Active</Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-700 border-0 text-xs">Inactive</Badge>
                    )}
                  </div>

                  <Link href={`/pm/projects/${invoice.project.id}`}>
                    <Button variant="outline" size="sm" className="w-full mt-1">
                      View Full Details
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>

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
                  <p className={`text-2xl font-bold ${invoice.holdback_cents > 0 ? 'text-amber-600' : 'text-foreground'}`}>
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
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Payment Certificates
                </CardTitle>
                <Link href={`/invoices/${invoiceId}/certificates/new`}>
                  <Button size="sm" className="gap-2">
                    <Plus className="w-4 h-4" />
                    Create Certificate
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {certsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : certificates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground px-6">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No payment certificates issued for this invoice.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Certificate #</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Certified Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...certificates].sort((a, b) => {
                        const dateA = a.work_period_start ? new Date(a.work_period_start).getTime() : new Date(a.created_at).getTime()
                        const dateB = b.work_period_start ? new Date(b.work_period_start).getTime() : new Date(b.created_at).getTime()
                        return dateA - dateB
                      }).map((cert) => {
                        const certStatus = certStatusConfig[cert.status] || { label: cert.status, variant: 'outline' as const }
                        const isActioning = certActionLoading === cert.id

                        return (
                          <React.Fragment key={cert.id}>
                            <tr className="hover:bg-muted/20 transition-colors">
                              {/* Certificate # */}
                              <td className="px-4 py-3">
                                <p className="font-medium text-sm">{cert.certificate_number}</p>
                                {cert.work_period_start && cert.work_period_end && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {new Date(cert.work_period_start).toLocaleDateString()} – {new Date(cert.work_period_end).toLocaleDateString()}
                                  </p>
                                )}
                              </td>

                              {/* Certified Amount — no holdback deduction; certs are paid in full */}
                              <td className="px-4 py-3 text-right">
                                <p className="font-medium text-sm">
                                  ${(cert.certified_amount_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </p>
                              </td>

                              {/* Status badge */}
                              <td className="px-4 py-3">
                                <Badge variant={certStatus.variant as 'default' | 'secondary' | 'destructive' | 'outline'}>
                                  {certStatus.label}
                                </Badge>
                              </td>

                              {/* Date */}
                              <td className="px-4 py-3">
                                <p className="text-sm text-muted-foreground">
                                  {new Date(cert.created_at).toLocaleDateString()}
                                </p>
                              </td>

                              {/* Actions */}
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  {cert.status === 'draft' && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => openEditDialog(cert)}
                                        disabled={isActioning}
                                        className="gap-1.5"
                                      >
                                        <Pencil className="w-3 h-3" />
                                        Edit
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => handleSubmitCertificate(cert.id)}
                                        disabled={isActioning}
                                        className="gap-1.5"
                                      >
                                        <Send className="w-3 h-3" />
                                        {isActioning ? 'Submitting…' : 'Submit'}
                                      </Button>
                                    </>
                                  )}

                                  {cert.status === 'rejected' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleResubmitCertificate(cert.id)}
                                      disabled={isActioning}
                                      className="gap-1.5"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      {isActioning ? 'Resetting…' : 'Resubmit'}
                                    </Button>
                                  )}

                                  {cert.status === 'pending' && (
                                    roleLoading ? (
                                      <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary" />
                                        Loading…
                                      </div>
                                    ) : canApproveRole ? (
                                      <>
                                        <Button
                                          size="sm"
                                          onClick={() => handleApproveCertificate(cert.id)}
                                          disabled={isActioning}
                                          className="gap-1.5"
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
                                          className="gap-1.5"
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

                                  {cert.status === 'approved' && (
                                    <Badge variant="default" className="gap-1">
                                      <CheckCircle className="w-3 h-3" />
                                      Approved
                                    </Badge>
                                  )}

                                  {cert.status === 'paid' && (
                                    cert.payments?.[0]?.id ? (
                                      <PaymentReceiptModal
                                        paymentId={cert.payments[0].id}
                                        invoiceNumber={invoice.invoice_number}
                                        trigger={
                                          <Button size="sm" variant="outline" className="gap-1.5">
                                            <FileText className="w-3 h-3" />
                                            View Receipt
                                          </Button>
                                        }
                                      />
                                    ) : (
                                      <Badge variant="default" className="gap-1">
                                        <CheckCircle className="w-3 h-3" />
                                        Paid
                                      </Badge>
                                    )
                                  )}

                                  {/* View is always visible regardless of status */}
                                  <Link href={`/invoices/${invoiceId}/certificates/${cert.id}`}>
                                    <Button size="sm" variant="ghost" className="gap-1.5">
                                      <FileText className="w-3 h-3" />
                                      View
                                    </Button>
                                  </Link>
                                </div>
                              </td>
                            </tr>

                            {/* Rejection reason sub-row */}
                            {cert.status === 'rejected' && cert.rejection_reason && (
                              <tr key={`${cert.id}-reason`} className="bg-destructive/5">
                                <td colSpan={5} className="px-4 py-2">
                                  <p className="text-xs text-destructive">
                                    <span className="font-semibold">Rejection reason: </span>
                                    {cert.rejection_reason}
                                  </p>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5" />
                Status History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InvoiceStatusTimeline invoiceId={invoiceId} currentStatus={invoice.status} />
            </CardContent>
          </Card>

          {/* Clarification Thread */}
          <InvoiceClarificationThread invoiceId={invoiceId} />

          {/* Invoice Review Actions */}
          {canTakeAction && (
            <Card>
              <CardHeader>
                <CardTitle>Review Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Notes (required for rejection or dispute)</label>
                  <Textarea
                    placeholder="Add notes, a reason for rejection, or details of a dispute..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
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
                  <Button
                    variant="outline"
                    onClick={handleDispute}
                    disabled={actionLoading}
                    className="gap-2"
                  >
                    <AlertCircle className="w-4 h-4" />
                    Flag Dispute
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

      {/* Edit Draft Certificate Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Certificate</DialogTitle>
            <DialogDescription>
              Update the details of draft certificate {editingCert?.certificate_number}. Only draft certificates can be edited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-amount">Certified Amount ($)</Label>
              <Input
                id="edit-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={editForm.certified_amount}
                onChange={(e) => setEditForm(prev => ({ ...prev, certified_amount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Input
                id="edit-description"
                placeholder="Description of work covered..."
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-period-start">Period From</Label>
                <Input
                  id="edit-period-start"
                  type="date"
                  value={editForm.work_period_start}
                  onChange={(e) => setEditForm(prev => ({ ...prev, work_period_start: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-period-end">Period To</Label>
                <Input
                  id="edit-period-end"
                  type="date"
                  value={editForm.work_period_end}
                  onChange={(e) => setEditForm(prev => ({ ...prev, work_period_end: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false)
                setEditingCert(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={editLoading || !editForm.certified_amount || parseFloat(editForm.certified_amount) <= 0}
            >
              {editLoading ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document preview */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => !open && setPreviewDoc(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{previewDoc?.file_name}</DialogTitle>
            <DialogDescription>{formatDocType(previewDoc?.document_type ?? null)}</DialogDescription>
          </DialogHeader>
          {previewDoc && (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted">
              {(previewDoc.file_type || '').startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/documents/${previewDoc.id}?inline=1`}
                  alt={previewDoc.file_name}
                  className="mx-auto block max-w-full"
                />
              ) : (
                <iframe
                  src={`/api/documents/${previewDoc.id}?inline=1`}
                  title={previewDoc.file_name}
                  className="h-[70vh] w-full"
                />
              )}
            </div>
          )}
          <DialogFooter>
            {previewDoc && (
              <a
                href={`/api/documents/${previewDoc.id}`}
                className="inline-flex items-center text-sm text-primary hover:underline"
              >
                Download original
              </a>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
