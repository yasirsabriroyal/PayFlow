'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Calendar, Building2, DollarSign, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { AppHeader } from '@/components/app-header'

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

export default function PMInvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string
  
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [notes, setNotes] = useState('')

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
        setInvoice(data as Invoice)
      }
      setLoading(false)
    }

    if (invoiceId) {
      fetchInvoice()
    }
  }, [invoiceId])

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
              <p className="text-muted-foreground">The invoice you're looking for doesn't exist or you don't have permission to view it.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const status = statusConfig[invoice.status] || statusConfig.submitted
  const canTakeAction = ['submitted', 'pending_approval'].includes(invoice.status)

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

          {/* Actions */}
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
    </div>
  )
}
