'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  ArrowLeft, 
  Search, 
  FileText, 
  Plus,
  Building2,
  Calendar,
  ChevronRight,
  CheckCircle,
  Clock
} from 'lucide-react'
import { getPMInvoices } from '../actions'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'

type Invoice = {
  id: string
  invoice_number: string
  project_id: string
  total_cents: number
  status: string
  invoice_date?: string
  created_at: string
  contractor?: { company_name: string }
  project?: { id: string; name: string; project_number: string }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)
}

const invoiceStatusLabels: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
  partially_paid: 'Partially Paid',
  disputed: 'Disputed',
  revision_requested: 'Revision Requested',
  payment_initiated: 'Payment Initiated',
}

function formatInvoiceStatus(status: string): string {
  return invoiceStatusLabels[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function PMCertificatesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/pm/certificates')
  const [searchTerm, setSearchTerm] = useState(initialState?.search || '')
  const [activeTab, setActiveTab] = useState(initialState?.activeTab || 'available')
  
  // Save state when search or tab changes
  useEffect(() => {
    save({ search: searchTerm, activeTab })
  }, [searchTerm, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadData() {
      const result = await getPMInvoices()
      if (result.success) {
        setInvoices(result.invoices as unknown as Invoice[])
      }
      setLoading(false)
    }
    loadData()
  }, [])

  // Filter invoices based on tab and search
  const availableForCertification = invoices.filter(inv => 
    ['submitted', 'pending_approval', 'approved'].includes(inv.status) &&
    inv.status !== 'paid'
  )
  
  const fullyCertified = invoices.filter(inv => inv.status === 'paid')

  const filteredInvoices = (activeTab === 'available' ? availableForCertification : fullyCertified)
    .filter(inv => 
      inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.contractor?.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.project?.name?.toLowerCase().includes(searchTerm.toLowerCase())
    )

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="Payment Certificates"
        pageDescription="Create and manage payment certificates for invoices"
      />
      <RoleTabBar role="project_manager" />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <TabsList>
                <TabsTrigger value="available" className="gap-2">
                  <Clock className="w-4 h-4" />
                  Available for Certification
                  <Badge variant="secondary" className="ml-1">{availableForCertification.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="completed" className="gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Fully Paid
                  <Badge variant="secondary" className="ml-1">{fullyCertified.length}</Badge>
                </TabsTrigger>
              </TabsList>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search invoices..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
            </div>

            <TabsContent value="available" className="mt-6">
              {filteredInvoices.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                  <h3 className="text-lg font-medium mb-2">No invoices available</h3>
                  <p className="text-muted-foreground">
                    There are no invoices available for certification at this time.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {filteredInvoices.map((invoice) => (
                    <WorkflowLink 
                      key={invoice.id} 
                      href={`/pm/invoices/${invoice.id}`}
                      contextTitle={invoice.invoice_number}
                      className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-lg">{invoice.invoice_number}</h3>
                            <Badge variant={
                              invoice.status === 'approved' ? 'default' :
                              invoice.status === 'submitted' ? 'secondary' :
                              'outline'
                            }>
                              {formatInvoiceStatus(invoice.status)}
                            </Badge>
                          </div>
                          
                          <div className="flex items-center gap-6 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Building2 className="w-4 h-4" />
                              {invoice.contractor?.company_name || 'Unknown Contractor'}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <FileText className="w-4 h-4" />
                              {invoice.project?.name || 'Unknown Project'}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Calendar className="w-4 h-4" />
                              {formatDate(invoice.invoice_date || invoice.created_at)}
                            </span>
                          </div>
                        </div>

                        <div className="text-right flex items-center gap-4">
                          <div>
                            <p className="text-xl font-bold">{formatCurrency(invoice.total_cents / 100)}</p>
                            <p className="text-xs text-muted-foreground">Invoice Total</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    </WorkflowLink>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="completed" className="mt-6">
              {filteredInvoices.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <CheckCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                  <h3 className="text-lg font-medium mb-2">No completed invoices</h3>
                  <p className="text-muted-foreground">
                    Invoices that have been fully paid will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {filteredInvoices.map((invoice) => (
                    <WorkflowLink 
                      key={invoice.id} 
                      href={`/pm/invoices/${invoice.id}`}
                      contextTitle={invoice.invoice_number}
                      className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-lg">{invoice.invoice_number}</h3>
                            <Badge className="bg-success text-success-foreground">Paid</Badge>
                          </div>
                          
                          <div className="flex items-center gap-6 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Building2 className="w-4 h-4" />
                              {invoice.contractor?.company_name || 'Unknown Contractor'}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <FileText className="w-4 h-4" />
                              {invoice.project?.name || 'Unknown Project'}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Calendar className="w-4 h-4" />
                              {formatDate(invoice.invoice_date || invoice.created_at)}
                            </span>
                          </div>
                        </div>

                        <div className="text-right flex items-center gap-4">
                          <div>
                            <p className="text-xl font-bold text-success">{formatCurrency(invoice.total_cents / 100)}</p>
                            <p className="text-xs text-muted-foreground">Fully Paid</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    </WorkflowLink>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
