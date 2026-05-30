'use client'

/**
 * Accountant Contractor Detail Page - View contractor details and payment history
 */

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  FileText,
  DollarSign,
  Shield,
  Calendar,
  Banknote,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react'
import { getContractorById } from '../../actions'
import { AppHeader } from '@/components/app-header'
import { PAID_PAYMENT_STATUSES, SETTLED_OR_SENT_STATUSES } from '@/lib/payments/status'

type Contractor = {
  id: string
  company_name: string
  contact_name?: string
  email?: string
  phone?: string
  status: string
  trade?: string
  address_line1?: string
  city?: string
  province?: string
  postal_code?: string
  bank_name?: string
  bank_institution_number?: string
  bank_transit_number?: string
  bank_account_number?: string
  wcb_clearance_expiry?: string
  gst_hst_number?: string
}

type Invoice = {
  id: string
  invoice_number: string
  total_cents: number
  net_payable_cents: number
  status: string
  created_at: string
}

type Payment = {
  id: string
  amount_cents: number
  payment_method: string
  status: string
  created_at: string
  batch_reference?: string
}

export default function AccountantContractorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const contractorId = params.id as string
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      const result = await getContractorById(contractorId)
      
      if (result.success) {
        setContractor(result.contractor as Contractor)
        setInvoices((result.invoices || []) as Invoice[])
        setPayments((result.payments || []) as Payment[])
      }
      
      setIsLoading(false)
    }
    loadData()
  }, [contractorId])

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
    }).format(cents / 100)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline', label: string }> = {
      active: { variant: 'default', label: 'Active' },
      inactive: { variant: 'secondary', label: 'Inactive' },
      pending: { variant: 'outline', label: 'Pending' },
      suspended: { variant: 'destructive', label: 'Suspended' },
    }
    const config = statusConfig[status] || { variant: 'secondary', label: status }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const getInvoiceStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline', label: string }> = {
      submitted: { variant: 'outline', label: 'Submitted' },
      pending_approval: { variant: 'outline', label: 'Pending' },
      approved: { variant: 'default', label: 'Approved' },
      paid: { variant: 'default', label: 'Paid' },
      rejected: { variant: 'destructive', label: 'Rejected' },
      disputed: { variant: 'destructive', label: 'Disputed' },
    }
    const config = statusConfig[status] || { variant: 'secondary', label: status }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  // Calculate totals
  const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0)
  const totalPaid = payments.filter(p => PAID_PAYMENT_STATUSES.includes(p.status as typeof PAID_PAYMENT_STATUSES[number])).reduce((sum, p) => sum + (p.amount_cents || 0), 0)
  const totalPending = invoices.filter(inv => ['submitted', 'pending_approval', 'approved'].includes(inv.status))
    .reduce((sum, inv) => sum + (inv.net_payable_cents || 0), 0)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading contractor...</p>
      </div>
    )
  }

  if (!contractor) {
    return (
      <div className="min-h-screen bg-background">
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-12 text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Contractor Not Found</h1>
          <p className="text-muted-foreground mb-4">The contractor you are looking for does not exist or you don&apos;t have access.</p>
          <Button variant="outline" onClick={() => router.back()}>Go Back</Button>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Contractor" />
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{contractor.company_name}</h1>
                {contractor.contact_name && (
                  <p className="text-sm text-muted-foreground">{contractor.contact_name}</p>
                )}
              </div>
            </div>
            {getStatusBadge(contractor.status)}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Invoiced</p>
                  <p className="text-xl font-semibold">{formatCurrency(totalInvoiced)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Paid</p>
                  <p className="text-xl font-semibold">{formatCurrency(totalPaid)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Payment</p>
                  <p className="text-xl font-semibold">{formatCurrency(totalPending)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact & Banking Information */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {contractor.email && (
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <a href={`mailto:${contractor.email}`} className="text-sm text-primary hover:underline">
                      {contractor.email}
                    </a>
                  </div>
                )}
                {contractor.phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <a href={`tel:${contractor.phone}`} className="text-sm hover:underline">
                      {contractor.phone}
                    </a>
                  </div>
                )}
                {(contractor.address_line1 || contractor.city) && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <p className="text-sm">
                      {[contractor.address_line1, contractor.city, contractor.province, contractor.postal_code]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                )}
                {contractor.trade && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">Trade</p>
                    <p className="text-sm font-medium">{contractor.trade}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Banking Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {contractor.bank_name ? (
                  <>
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Bank</p>
                        <p className="text-sm font-medium">{contractor.bank_name}</p>
                      </div>
                    </div>
                    {contractor.bank_institution_number && (
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Institution</p>
                          <p className="font-mono">{contractor.bank_institution_number}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Transit</p>
                          <p className="font-mono">{contractor.bank_transit_number}</p>
                        </div>
                      </div>
                    )}
                    {contractor.bank_account_number && (
                      <div>
                        <p className="text-xs text-muted-foreground">Account</p>
                        <p className="text-sm font-mono">****{contractor.bank_account_number.slice(-4)}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No banking information on file</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compliance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {contractor.wcb_clearance_expiry && (
                  <div className="flex items-center gap-3">
                    <Shield className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">WCB Clearance Expiry</p>
                      <p className="text-sm">{formatDate(contractor.wcb_clearance_expiry)}</p>
                    </div>
                  </div>
                )}
                {contractor.gst_hst_number && (
                  <div>
                    <p className="text-xs text-muted-foreground">GST/HST Number</p>
                    <p className="text-sm font-mono">{contractor.gst_hst_number}</p>
                  </div>
                )}
                {!contractor.wcb_clearance_expiry && !contractor.gst_hst_number && (
                  <p className="text-sm text-muted-foreground">No compliance information on file</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Invoices & Payments */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                {invoices.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No invoices from this contractor</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {invoices.slice(0, 10).map((invoice) => (
                      <Link 
                        key={invoice.id}
                        href={`/accountant/invoices/${invoice.id}`}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{invoice.invoice_number}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(invoice.created_at)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-medium text-sm">{formatCurrency(invoice.total_cents)}</p>
                          {getInvoiceStatusBadge(invoice.status)}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment History</CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <div className="text-center py-8">
                    <Banknote className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No payments made to this contractor</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {payments.slice(0, 10).map((payment) => (
                      <div 
                        key={payment.id}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Banknote className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{formatCurrency(payment.amount_cents)}</p>
                            <p className="text-xs text-muted-foreground">
                              {payment.payment_method?.toUpperCase()} {payment.batch_reference && `- ${payment.batch_reference}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-xs text-muted-foreground">{formatDate(payment.created_at)}</p>
                          <Badge variant={SETTLED_OR_SENT_STATUSES.includes(payment.status as typeof SETTLED_OR_SENT_STATUSES[number]) ? 'default' : 'outline'}>
                            {payment.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
