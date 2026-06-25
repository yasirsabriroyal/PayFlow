'use client'

/**
 * PM Contractor Profile Page
 * Enhanced view with financial information, projects, invoices, and documents
 */

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { 
  ArrowLeft,
  Building2,
  HardHat,
  Mail,
  Phone,
  MapPin,
  FileText,
  DollarSign,
  TrendingUp,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  FolderOpen,
  Receipt,
  Award,
  Shield,
  Briefcase,
  ChevronRight,
  ExternalLink,
  Banknote,
  ClipboardList,
  FileCheck,
  History,
  Pencil,
  Save,
  Loader2
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { getPMContractorById } from '@/app/pm/actions'
import { updateVendor } from '@/app/admin/contractors/actions'
import { verifyKycDocument, rejectKycDocument } from '@/lib/actions/vendor-kyc'
import { usePermissions } from '@/hooks/use-permissions'
import { SETTLED_OR_SENT_STATUSES } from '@/lib/payments/status'
import { InviteToPortalButton } from './invite-to-portal-button'

type Contractor = {
  id: string
  company_name: string
  contact_name?: string
  email?: string
  phone?: string
  status: string
  address_line1?: string
  address_line2?: string
  city?: string
  province?: string
  postal_code?: string
  business_number?: string
  is_corporation?: boolean
  wcb_clearance_expiry?: string
  notes?: string
  created_at: string
}

type Invoice = {
  id: string
  invoice_number: string
  total_cents: number
  holdback_cents: number
  net_payable_cents: number
  total_certified_cents: number
  total_paid_cents: number
  status: string
  invoice_date?: string
  created_at: string
  project?: { id: string; name: string; project_number: string }
}

type Project = {
  id: string
  name: string
  project_number: string
  is_active: boolean
  start_date?: string
  estimated_completion_date?: string
  current_budget_cents?: number
  spent_cents?: number
}

type Payment = {
  id: string
  amount_cents: number
  payment_method: string
  payment_date?: string
  status: string
  created_at: string
}

type Certificate = {
  id: string
  certificate_number: string
  certified_amount_cents: number
  holdback_amount_cents: number
  net_payable_cents: number
  status: string
  created_at: string
  invoice?: { invoice_number: string }
}

type KYCDocument = {
  id: string
  document_type: string
  file_name: string
  status: string
  expiry_date?: string
  uploaded_at?: string
  verified_at?: string
}

type FinancialSummary = {
  totalInvoiced: number
  totalCertified: number
  totalPaid: number
  totalHoldback: number
  pendingPayment: number
  invoiceCount: number
  projectCount: number
}

const PROVINCES = [
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'ON', label: 'Ontario' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
]

export default function PMContractorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canEditVendor = hasPermission('edit_vendors')
  
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [documents, setDocuments] = useState<KYCDocument[]>([])
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  
  // KYC document action state
  const [kycActionLoading, setKycActionLoading] = useState<string | null>(null)
  const [rejectDocId, setRejectDocId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectSubmitting, setRejectSubmitting] = useState(false)

  // Edit modal state
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    address_line1: '',
    city: '',
    province: '',
    postal_code: '',
    business_number: '',
    status: '' as 'active' | 'pending_kyc' | 'suspended' | 'inactive' | '',
    wcb_clearance_expiry: '',
  })

  useEffect(() => {
    const loadData = async () => {
      const result = await getPMContractorById(resolvedParams.id)
      
      if (result.success) {
        setContractor(result.contractor as Contractor)
        setInvoices((result.invoices || []) as unknown as Invoice[])
        setProjects((result.projects || []) as unknown as Project[])
        setPayments((result.payments || []) as unknown as Payment[])
        setCertificates((result.certificates || []) as unknown as Certificate[])
        setDocuments((result.documents || []) as KYCDocument[])
        setFinancialSummary(result.financialSummary as FinancialSummary)
      }
      
      setIsLoading(false)
    }
    loadData()
  }, [resolvedParams.id])

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
    }).format(cents / 100)
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  // Open edit modal and populate form
  const openEditModal = () => {
    if (contractor) {
      setEditForm({
        company_name: contractor.company_name || '',
        contact_name: contractor.contact_name || '',
        email: contractor.email || '',
        phone: contractor.phone || '',
        address_line1: contractor.address_line1 || '',
        city: contractor.city || '',
        province: contractor.province || '',
        postal_code: contractor.postal_code || '',
        business_number: contractor.business_number || '',
        status: (contractor.status as 'active' | 'pending_kyc' | 'suspended' | 'inactive') || '',
        wcb_clearance_expiry: contractor.wcb_clearance_expiry || '',
      })
      setIsEditOpen(true)
    }
  }

  // Save contractor changes
  const handleSaveContractor = async () => {
    if (!contractor) return
    
    setIsSaving(true)
    try {
      const result = await updateVendor({
        vendor_id: contractor.id,
        company_name: editForm.company_name,
        contact_name: editForm.contact_name,
        email: editForm.email,
        phone: editForm.phone || undefined,
        address_line1: editForm.address_line1 || undefined,
        city: editForm.city || undefined,
        province: editForm.province || undefined,
        postal_code: editForm.postal_code || undefined,
        business_number: editForm.business_number || undefined,
        status: editForm.status || undefined,
        wcb_clearance_expiry: editForm.wcb_clearance_expiry || undefined,
      })
      
      // Handle result - vendor is in result.data when success is true
      const updatedVendor = result.success ? (result.data as { vendor?: Contractor } | undefined)?.vendor : undefined
      
      if (updatedVendor) {
        setContractor(updatedVendor as Contractor)
        setIsEditOpen(false)
      }
    } catch (error) {
      console.error('Failed to update contractor:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; bgColor: string; label: string }> = {
      active: { color: 'text-emerald-700', bgColor: 'bg-emerald-50', label: 'Active' },
      inactive: { color: 'text-gray-700', bgColor: 'bg-gray-100', label: 'Inactive' },
      pending_kyc: { color: 'text-amber-700', bgColor: 'bg-amber-50', label: 'Pending KYC' },
      suspended: { color: 'text-red-700', bgColor: 'bg-red-50', label: 'Suspended' },
    }
    return configs[status] || { color: 'text-gray-700', bgColor: 'bg-gray-100', label: status }
  }

  const getInvoiceStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; bgColor: string; label: string }> = {
      draft: { color: 'text-gray-700', bgColor: 'bg-gray-100', label: 'Draft' },
      submitted: { color: 'text-blue-700', bgColor: 'bg-blue-50', label: 'Submitted' },
      pending_approval: { color: 'text-amber-700', bgColor: 'bg-amber-50', label: 'Pending' },
      approved: { color: 'text-emerald-700', bgColor: 'bg-emerald-50', label: 'Approved' },
      partially_paid: { color: 'text-cyan-700', bgColor: 'bg-cyan-50', label: 'Partial' },
      paid: { color: 'text-emerald-700', bgColor: 'bg-emerald-50', label: 'Paid' },
      rejected: { color: 'text-red-700', bgColor: 'bg-red-50', label: 'Rejected' },
    }
    return configs[status] || { color: 'text-gray-700', bgColor: 'bg-gray-100', label: status }
  }

  const getCertificateStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; bgColor: string; label: string }> = {
      draft: { color: 'text-gray-700', bgColor: 'bg-gray-100', label: 'Draft' },
      pending_approval: { color: 'text-amber-700', bgColor: 'bg-amber-50', label: 'Pending' },
      approved: { color: 'text-emerald-700', bgColor: 'bg-emerald-50', label: 'Approved' },
      rejected: { color: 'text-red-700', bgColor: 'bg-red-50', label: 'Rejected' },
      paid: { color: 'text-emerald-700', bgColor: 'bg-emerald-50', label: 'Paid' },
    }
    return configs[status] || { color: 'text-gray-700', bgColor: 'bg-gray-100', label: status }
  }

  const getDocumentStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; bgColor: string; label: string }> = {
      pending_review: { color: 'text-amber-700', bgColor: 'bg-amber-50', label: 'Pending Review' },
      verified: { color: 'text-emerald-700', bgColor: 'bg-emerald-50', label: 'Verified' },
      rejected: { color: 'text-red-700', bgColor: 'bg-red-50', label: 'Rejected' },
      expired: { color: 'text-red-700', bgColor: 'bg-red-50', label: 'Expired' },
    }
    return configs[status] || { color: 'text-gray-700', bgColor: 'bg-gray-100', label: status }
  }

  const handleVerifyDocument = async (docId: string) => {
    setKycActionLoading(docId)
    try {
      await verifyKycDocument(docId)
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, status: 'verified', verified_at: new Date().toISOString() } : d))
      )
    } finally {
      setKycActionLoading(null)
    }
  }

  const handleRejectDocument = async () => {
    if (!rejectDocId || !rejectReason.trim()) return
    setRejectSubmitting(true)
    try {
      await rejectKycDocument(rejectDocId, rejectReason.trim())
      setDocuments((prev) =>
        prev.map((d) => (d.id === rejectDocId ? { ...d, status: 'rejected' } : d))
      )
      setRejectDocId(null)
      setRejectReason('')
    } finally {
      setRejectSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Loading..." />
        <RoleTabBar role="admin" />
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading contractor profile...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!contractor) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Contractor Not Found" />
        <RoleTabBar role="admin" />
        <div className="max-w-7xl mx-auto px-4 py-12 text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Contractor Not Found</h1>
          <p className="text-muted-foreground mb-4">This contractor does not exist or you don&apos;t have access.</p>
          <Button variant="outline" onClick={() => router.back()}>Go Back</Button>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(contractor.status)
  const paidPercentage = financialSummary && financialSummary.totalInvoiced > 0 
    ? Math.round((financialSummary.totalPaid / financialSummary.totalInvoiced) * 100) 
    : 0

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle={contractor.company_name}
        pageDescription="Contractor Profile"
      />
      <RoleTabBar role="admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Contractor Header Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex items-center gap-4 flex-1">
                <Button variant="ghost" size="icon" onClick={() => router.back()} title="Go back">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <HardHat className="w-7 h-7 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold">{contractor.company_name}</h1>
                    <Badge className={`${statusConfig.bgColor} ${statusConfig.color} border-0`}>
                      {statusConfig.label}
                    </Badge>
                  </div>
                  {contractor.contact_name && (
                    <p className="text-muted-foreground mt-1">{contractor.contact_name}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    {contractor.email && (
                      <a href={`mailto:${contractor.email}`} className="flex items-center gap-1 hover:text-primary">
                        <Mail className="w-3.5 h-3.5" />
                        {contractor.email}
                      </a>
                    )}
                    {contractor.phone && (
                      <a href={`tel:${contractor.phone}`} className="flex items-center gap-1 hover:text-primary">
                        <Phone className="w-3.5 h-3.5" />
                        {contractor.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 sm:flex-col">
                {canEditVendor && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={openEditModal}>
                    <Pencil className="w-4 h-4" />
                    Edit Profile
                  </Button>
                )}
                {canEditVendor && (
                  <InviteToPortalButton contractorId={contractor.id} defaultEmail={contractor.email} />
                )}
                <Link href={`/pm/invoices/new?contractor=${contractor.id}`}>
                  <Button size="sm" className="gap-2">
                    <FileText className="w-4 h-4" />
                    New Invoice
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary Cards */}
        {financialSummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <Receipt className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Invoiced</p>
                    <p className="text-lg font-bold">{formatCurrency(financialSummary.totalInvoiced)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Paid</p>
                    <p className="text-lg font-bold">{formatCurrency(financialSummary.totalPaid)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pending Payment</p>
                    <p className="text-lg font-bold">{formatCurrency(financialSummary.pendingPayment)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                    <Shield className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Holdback Retained</p>
                    <p className="text-lg font-bold">{formatCurrency(financialSummary.totalHoldback)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs for different sections */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="flex w-max md:grid md:w-full md:grid-cols-5">
              <TabsTrigger value="overview" className="flex-none shrink-0 gap-1.5 px-4 py-1.5 text-sm whitespace-nowrap">
                <Building2 className="w-4 h-4 hidden sm:block" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="projects" className="flex-none shrink-0 gap-1.5 px-4 py-1.5 text-sm whitespace-nowrap">
                <FolderOpen className="w-4 h-4 hidden sm:block" />
                Projects
                {projects.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5">{projects.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="invoices" className="flex-none shrink-0 gap-1.5 px-4 py-1.5 text-sm whitespace-nowrap">
                <FileText className="w-4 h-4 hidden sm:block" />
                Invoices
                {invoices.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5">{invoices.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="payments" className="flex-none shrink-0 gap-1.5 px-4 py-1.5 text-sm whitespace-nowrap">
                <Banknote className="w-4 h-4 hidden sm:block" />
                Payments
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex-none shrink-0 gap-1.5 px-4 py-1.5 text-sm whitespace-nowrap">
                <FileCheck className="w-4 h-4 hidden sm:block" />
                Documents
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Contact & Business Info */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-base">Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {contractor.email && (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
                        <Mail className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Email</p>
                        <a href={`mailto:${contractor.email}`} className="text-sm text-primary hover:underline">
                          {contractor.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {contractor.phone && (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center">
                        <Phone className="w-4 h-4 text-green-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        <a href={`tel:${contractor.phone}`} className="text-sm hover:underline">
                          {contractor.phone}
                        </a>
                      </div>
                    </div>
                  )}

                  {(contractor.address_line1 || contractor.city) && (
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-orange-500/10 rounded-lg flex items-center justify-center">
                        <MapPin className="w-4 h-4 text-orange-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Address</p>
                        <p className="text-sm">
                          {[contractor.address_line1, contractor.address_line2, contractor.city, contractor.province, contractor.postal_code]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      </div>
                    </div>
                  )}

                  <Separator />

                  {contractor.business_number && (
                    <div>
                      <p className="text-xs text-muted-foreground">Business Number</p>
                      <p className="text-sm font-mono">{contractor.business_number}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-muted-foreground">Business Type</p>
                    <p className="text-sm">{contractor.is_corporation ? 'Corporation' : 'Sole Proprietor'}</p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Member Since</p>
                    <p className="text-sm">{formatDate(contractor.created_at)}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Financial Overview */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Financial Overview</CardTitle>
                  <CardDescription>Payment progress and statistics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Payment Progress */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Payment Progress</span>
                      <span className="text-sm font-medium">{paidPercentage}% paid</span>
                    </div>
                    <Progress value={paidPercentage} className="h-2" />
                    <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                      <span>{formatCurrency(financialSummary?.totalPaid || 0)} paid</span>
                      <span>{formatCurrency(financialSummary?.totalInvoiced || 0)} total</span>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Invoices</span>
                      </div>
                      <p className="text-2xl font-bold">{financialSummary?.invoiceCount || 0}</p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <FolderOpen className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Projects</span>
                      </div>
                      <p className="text-2xl font-bold">{financialSummary?.projectCount || 0}</p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <Award className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Certified</span>
                      </div>
                      <p className="text-xl font-bold">{formatCurrency(financialSummary?.totalCertified || 0)}</p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Avg Invoice</span>
                      </div>
                      <p className="text-xl font-bold">
                        {financialSummary && financialSummary.invoiceCount > 0 
                          ? formatCurrency(financialSummary.totalInvoiced / financialSummary.invoiceCount)
                          : '$0.00'}
                      </p>
                    </div>
                  </div>

                  {/* Compliance Status */}
                  {contractor.wcb_clearance_expiry && (
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Shield className="w-5 h-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">WCB Clearance</p>
                            <p className="text-xs text-muted-foreground">Expires {formatDate(contractor.wcb_clearance_expiry)}</p>
                          </div>
                        </div>
                        {new Date(contractor.wcb_clearance_expiry) > new Date() ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-0">Valid</Badge>
                        ) : (
                          <Badge className="bg-red-50 text-red-700 border-0">Expired</Badge>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {invoices.slice(0, 5).map((invoice) => {
                    const statusCfg = getInvoiceStatusConfig(invoice.status)
                    return (
                      <Link 
                        key={invoice.id}
                        href={`/pm/invoices/${invoice.id}`}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                            <FileText className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{invoice.invoice_number}</p>
                            <p className="text-xs text-muted-foreground">
                              {invoice.project?.name || 'No project'} - {formatDate(invoice.created_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-medium text-sm">{formatCurrency(invoice.total_cents)}</p>
                          <Badge className={`${statusCfg.bgColor} ${statusCfg.color} border-0`}>
                            {statusCfg.label}
                          </Badge>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </Link>
                    )
                  })}
                  {invoices.length === 0 && (
                    <div className="text-center py-8">
                      <History className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No recent activity</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Projects Tab */}
          <TabsContent value="projects" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Associated Projects</CardTitle>
                <CardDescription>Projects where this contractor has submitted invoices</CardDescription>
              </CardHeader>
              <CardContent>
                {projects.length === 0 ? (
                  <div className="text-center py-12">
                    <FolderOpen className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground">No projects associated with this contractor</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {projects.map((project) => (
                      <Link 
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="block p-4 border rounded-xl hover:border-primary/50 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-semibold">{project.name}</p>
                            <p className="text-sm text-muted-foreground">{project.project_number}</p>
                          </div>
                          <Badge variant={project.is_active ? 'default' : 'secondary'}>
                            {project.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground">Budget</p>
                            <p className="font-medium">{formatCurrency(project.current_budget_cents || 0)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Spent</p>
                            <p className="font-medium">{formatCurrency(project.spent_cents || 0)}</p>
                          </div>
                        </div>
                        {project.estimated_completion_date && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            Est. completion: {formatDate(project.estimated_completion_date)}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invoices Tab */}
          <TabsContent value="invoices" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Invoices</CardTitle>
                  <CardDescription>All invoices from this contractor</CardDescription>
                </div>
                <Link href={`/pm/invoices/new?contractor=${contractor.id}`}>
                  <Button size="sm">New Invoice</Button>
                </Link>
              </CardHeader>
              <CardContent>
                {invoices.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground mb-4">No invoices from this contractor</p>
                    <Link href={`/pm/invoices/new?contractor=${contractor.id}`}>
                      <Button variant="outline">Create First Invoice</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {invoices.map((invoice) => {
                      const statusCfg = getInvoiceStatusConfig(invoice.status)
                      return (
                        <Link 
                          key={invoice.id}
                          href={`/pm/invoices/${invoice.id}`}
                          className="flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <FileText className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{invoice.invoice_number}</p>
                              <p className="text-sm text-muted-foreground">
                                {invoice.project?.name || 'No project'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(invoice.invoice_date || invoice.created_at)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(invoice.total_cents)}</p>
                            <Badge className={`${statusCfg.bgColor} ${statusCfg.color} border-0 mt-1`}>
                              {statusCfg.label}
                            </Badge>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payments List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payment History</CardTitle>
                  <CardDescription>Payments made to this contractor</CardDescription>
                </CardHeader>
                <CardContent>
                  {payments.length === 0 ? (
                    <div className="text-center py-12">
                      <Banknote className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="text-muted-foreground">No payments to this contractor yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {payments.map((payment) => (
                        <div 
                          key={payment.id}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                              <Banknote className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{formatCurrency(payment.amount_cents)}</p>
                              <p className="text-xs text-muted-foreground">
                                {payment.payment_method?.toUpperCase() || 'N/A'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">{formatDate(payment.payment_date || payment.created_at)}</p>
                            <Badge variant={SETTLED_OR_SENT_STATUSES.includes(payment.status as typeof SETTLED_OR_SENT_STATUSES[number]) ? 'default' : 'outline'} className="mt-1">
                              {payment.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Payment Certificates */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payment Certificates</CardTitle>
                  <CardDescription>Certified payment documents</CardDescription>
                </CardHeader>
                <CardContent>
                  {certificates.length === 0 ? (
                    <div className="text-center py-12">
                      <Award className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="text-muted-foreground">No payment certificates yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {certificates.map((cert) => {
                        const statusCfg = getCertificateStatusConfig(cert.status)
                        return (
                          <div 
                            key={cert.id}
                            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center">
                                <Award className="w-4 h-4 text-purple-600" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{cert.certificate_number}</p>
                                <p className="text-xs text-muted-foreground">
                                  {cert.invoice?.invoice_number || 'N/A'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-sm">{formatCurrency(cert.certified_amount_cents)}</p>
                              <Badge className={`${statusCfg.bgColor} ${statusCfg.color} border-0 mt-1`}>
                                {statusCfg.label}
                              </Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compliance Documents</CardTitle>
                <CardDescription>KYC and compliance documentation</CardDescription>
              </CardHeader>
              <CardContent>
                {documents.length === 0 ? (
                  <div className="text-center py-12">
                    <FileCheck className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground">No compliance documents on file</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {documents.map((doc) => {
                      const statusCfg = getDocumentStatusConfig(doc.status)
                      return (
                        <div 
                          key={doc.id}
                          className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <FileCheck className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{doc.file_name}</p>
                              <p className="text-sm text-muted-foreground capitalize">
                                {doc.document_type?.replace(/_/g, ' ')}
                              </p>
                              {doc.expiry_date && (
                                <p className="text-xs text-muted-foreground">
                                  Expires: {formatDate(doc.expiry_date)}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {(doc.status === 'pending_review' || doc.status === 'pending') && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                                  disabled={kycActionLoading === doc.id}
                                  onClick={() => { setRejectDocId(doc.id); setRejectReason('') }}
                                >
                                  Reject
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={kycActionLoading === doc.id}
                                  onClick={() => handleVerifyDocument(doc.id)}
                                >
                                  {kycActionLoading === doc.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    'Verify'
                                  )}
                                </Button>
                              </>
                            )}
                            <div className="text-right">
                              <Badge className={`${statusCfg.bgColor} ${statusCfg.color} border-0`}>
                                {statusCfg.label}
                              </Badge>
                              {doc.verified_at && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Verified {formatDate(doc.verified_at)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Notes Section */}
        {contractor.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{contractor.notes}</p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* KYC Document Reject Dialog */}
      <Dialog open={!!rejectDocId} onOpenChange={(open) => { if (!open) { setRejectDocId(null); setRejectReason('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Document</DialogTitle>
            <DialogDescription>
              Provide a reason for rejection. The contractor will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reject-reason">Reason <span className="text-destructive">*</span></Label>
            <textarea
              id="reject-reason"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              placeholder="e.g. Document is expired, illegible, or incorrect type."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDocId(null); setRejectReason('') }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectSubmitting}
              onClick={handleRejectDocument}
            >
              {rejectSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Reject Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contractor Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contractor Profile</DialogTitle>
            <DialogDescription>
              Update contractor information. Changes will be saved immediately.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            {/* Company Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name *</Label>
                <Input
                  id="company_name"
                  value={editForm.company_name}
                  onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                  placeholder="Company name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact_name">Contact Name *</Label>
                <Input
                  id="contact_name"
                  value={editForm.contact_name}
                  onChange={(e) => setEditForm({ ...editForm, contact_name: e.target.value })}
                  placeholder="Contact name"
                />
              </div>
            </div>

            {/* Contact Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="email@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="(123) 456-7890"
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="address_line1">Address</Label>
              <Input
                id="address_line1"
                value={editForm.address_line1}
                onChange={(e) => setEditForm({ ...editForm, address_line1: e.target.value })}
                placeholder="Street address"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={editForm.city}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                  placeholder="City"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">Province</Label>
                <Select
                  value={editForm.province}
                  onValueChange={(value) => setEditForm({ ...editForm, province: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select province" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVINCES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal_code">Postal Code</Label>
                <Input
                  id="postal_code"
                  value={editForm.postal_code}
                  onChange={(e) => setEditForm({ ...editForm, postal_code: e.target.value })}
                  placeholder="A1A 1A1"
                />
              </div>
            </div>

            {/* Business Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="business_number">Business Number</Label>
                <Input
                  id="business_number"
                  value={editForm.business_number}
                  onChange={(e) => setEditForm({ ...editForm, business_number: e.target.value })}
                  placeholder="123456789"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wcb_clearance_expiry">WCB Clearance Expiry</Label>
                <Input
                  id="wcb_clearance_expiry"
                  type="date"
                  value={editForm.wcb_clearance_expiry}
                  onChange={(e) => setEditForm({ ...editForm, wcb_clearance_expiry: e.target.value })}
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(value: 'active' | 'pending_kyc' | 'suspended' | 'inactive') => 
                  setEditForm({ ...editForm, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending_kyc">Pending KYC</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveContractor} disabled={isSaving} className="gap-2">
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
