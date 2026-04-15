"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import {
  Building2,
  Shield,
  Search,
  Filter,
  Copy,
  Check,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  MoreHorizontal,
  Eye,
  FileText,
  Phone,
  Mail,
  MapPin,
  ChevronRight,
  Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { MobileNav } from "@/components/layout/mobile-nav"
import { DataCard, DataCardHeader, DataCardRow } from "@/components/ui/responsive-table"
import { getVendors } from "./actions"
import { usePermissions } from "@/hooks/use-permissions"
import { useListStatePreservation, useWorkflowNavigation } from "@/lib/workflow-navigation"

type ContractorStatus = "active" | "pending_kyc" | "suspended" | "inactive"

interface Contractor {
  id: string
  company_name: string
  contact_name: string
  email: string
  phone: string
  city: string
  province: string
  status: ContractorStatus
  wcb_clearance_expiry: string | null
  kyc_completed_at: string | null
  created_at: string
}

// Mock data for when database is empty
const mockContractors: Contractor[] = [
  {
    id: "1",
    company_name: "Northern Electrical Ltd.",
    contact_name: "Mike Johnson",
    email: "mike@northernelectric.ca",
    phone: "(403) 555-0101",
    city: "Calgary",
    province: "AB",
    status: "active",
    wcb_clearance_expiry: "2027-06-15",
    kyc_completed_at: "2025-01-15T10:00:00Z",
    created_at: "2025-01-10T08:00:00Z",
  },
  {
    id: "2",
    company_name: "Prairie Plumbing Co.",
    contact_name: "Sarah Williams",
    email: "sarah@prairieplumbing.ca",
    phone: "(780) 555-0202",
    city: "Edmonton",
    province: "AB",
    status: "pending_kyc",
    wcb_clearance_expiry: null,
    kyc_completed_at: null,
    created_at: "2026-02-28T14:30:00Z",
  },
  {
    id: "3",
    company_name: "Mountain HVAC Services",
    contact_name: "David Chen",
    email: "david@mountainhvac.ca",
    phone: "(403) 555-0303",
    city: "Red Deer",
    province: "AB",
    status: "active",
    wcb_clearance_expiry: "2025-12-01",
    kyc_completed_at: "2024-11-20T09:15:00Z",
    created_at: "2024-11-15T11:00:00Z",
  },
  {
    id: "4",
    company_name: "Foothills Concrete Inc.",
    contact_name: "Jennifer Brown",
    email: "jennifer@foothillsconcrete.ca",
    phone: "(403) 555-0404",
    city: "Lethbridge",
    province: "AB",
    status: "suspended",
    wcb_clearance_expiry: "2025-01-15",
    kyc_completed_at: "2024-06-10T16:45:00Z",
    created_at: "2024-06-01T10:00:00Z",
  },
  {
    id: "5",
    company_name: "Valley Framing Solutions",
    contact_name: "Robert Taylor",
    email: "robert@valleyframing.ca",
    phone: "(587) 555-0505",
    city: "Medicine Hat",
    province: "AB",
    status: "active",
    wcb_clearance_expiry: "2027-03-20",
    kyc_completed_at: "2025-02-01T13:20:00Z",
    created_at: "2025-01-25T09:00:00Z",
  },
]

const tradeCategories = [
  "All Trades",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Concrete",
  "Framing",
  "Roofing",
  "Drywall",
  "Painting",
]

function ContractorDirectoryContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()
  
  // List state preservation (for scroll position)
  const { initialState } = useListStatePreservation('/admin/contractors')
  
  // Workflow navigation for tracking context
  const { navigateTo } = useWorkflowNavigation()
  
  // Navigate to contractor detail with context (uses PM detail page)
  const goToContractor = useCallback((contractor: Contractor) => {
    navigateTo(`/pm/contractors/${contractor.id}`, contractor.company_name)
  }, [navigateTo])
  
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || "")
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || "all")
  const [tradeFilter, setTradeFilter] = useState<string>(searchParams.get('trade') || "All Trades")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  
  // Permission-aware UI state
  const canCreateVendor = hasPermission('create_vendors')

  // Sync state to URL params - debounced to prevent rapid updates
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
      if (tradeFilter && tradeFilter !== 'All Trades') params.set('trade', tradeFilter)
      if (searchQuery) params.set('q', searchQuery)
      const queryString = params.toString()
      const newUrl = `${pathname}${queryString ? `?${queryString}` : ''}`
      
      // Only update if URL actually changed
      const currentUrl = `${pathname}${window.location.search}`
      if (newUrl !== currentUrl) {
        router.replace(newUrl, { scroll: false })
      }
    }, 300)
    
    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, tradeFilter, searchQuery])

  // Fetch contractors via protected server action
  useEffect(() => {
    const fetchContractors = async () => {
      const result = await getVendors()
      
      if (result.success && result.vendors.length > 0) {
        // Map server action response to local Contractor type
        setContractors(result.vendors.map((v: Record<string, unknown>) => ({
          id: v.id as string,
          company_name: v.company_name as string,
          contact_name: v.contact_name as string || '',
          email: v.email as string || '',
          phone: v.phone as string || '',
          city: v.city as string || '',
          province: v.province as string || '',
          status: (v.status as ContractorStatus) || 'pending_kyc',
          wcb_clearance_expiry: v.wcb_expiry as string | null,
          kyc_completed_at: v.kyc_completed_at as string | null,
          created_at: v.created_at as string,
        })))
      } else if (process.env.NODE_ENV === 'development') {
        // DEV ONLY: Fall back to mock data when database is empty
        console.warn('[DEV] No contractors in database - using mock data')
        setContractors(mockContractors)
      } else {
        // Production: Show empty state
        setContractors([])
      }
      setLoading(false)
    }

    fetchContractors()
  }, [])

  const getComplianceStatus = (contractor: Contractor) => {
    if (contractor.status === "pending_kyc" || !contractor.kyc_completed_at) {
      return { label: "Pending KYC", color: "bg-warning/10 text-warning border-warning/20", icon: Clock }
    }
    
    if (contractor.wcb_clearance_expiry) {
      const expiryDate = new Date(contractor.wcb_clearance_expiry)
      const today = new Date()
      if (expiryDate < today) {
        return { label: "WCB Expired", color: "bg-destructive/10 text-destructive border-destructive/20", icon: AlertTriangle }
      }
    }
    
    if (contractor.status === "active") {
      return { label: "Active", color: "bg-success/10 text-success border-success/20", icon: CheckCircle2 }
    }
    
    return { label: "Inactive", color: "bg-muted text-muted-foreground border-border", icon: Clock }
  }

  const handleGenerateKYCLink = (contractorId: string) => {
    const kycLink = `${window.location.origin}/vendor/onboarding?token=${contractorId}-${Date.now()}`
    navigator.clipboard.writeText(kycLink)
    setCopiedId(contractorId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filteredContractors = contractors.filter((contractor) => {
    const matchesSearch =
      contractor.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contractor.contact_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contractor.email.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus =
      statusFilter === "all" || contractor.status === statusFilter

    return matchesSearch && matchesStatus
  })

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-semibold text-sm">Contractors</span>
          </div>
          {canCreateVendor && (
            <Button size="sm" onClick={() => router.push("/admin/contractors/new")}>
              <Plus className="w-4 h-4 mr-1" />
              Add New
            </Button>
          )}
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden md:block border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push("/admin/dashboard")}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold">PayFlow AP</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">Admin</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-20 md:pb-8">
        <div className="space-y-4 md:space-y-6">
          {/* Page Header - Desktop */}
          <div className="hidden md:flex md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
                <Users className="w-8 h-8 text-primary" />
                Contractor Directory
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage contractors, verify KYC documents, and track compliance status.
              </p>
            </div>
            {canCreateVendor && (
              <Button onClick={() => router.push("/admin/contractors/new")}>
                <Plus className="w-4 h-4 mr-2" />
                Add Contractor
              </Button>
            )}
          </div>

          {/* Stats Cards - uses getComplianceStatus for accurate counts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="p-3 md:p-4 bg-card border border-border rounded-xl">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">{contractors.length}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Total</p>
                </div>
              </div>
            </div>
            <div className="p-3 md:p-4 bg-card border border-border rounded-xl">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-success/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 text-success" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">
                    {contractors.filter((c) => getComplianceStatus(c).label === "Active").length}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Active</p>
                </div>
              </div>
            </div>
            <div className="p-3 md:p-4 bg-card border border-border rounded-xl">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-warning/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 md:w-5 md:h-5 text-warning" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">
                    {contractors.filter((c) => getComplianceStatus(c).label === "Pending KYC").length}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Pending KYC</p>
                </div>
              </div>
            </div>
            <div className="p-3 md:p-4 bg-card border border-border rounded-xl">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-destructive/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">
                    {contractors.filter((c) => getComplianceStatus(c).label === "WCB Expired").length}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">WCB Expired</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search contractors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 touch-manipulation"
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="flex-1 h-11 touch-manipulation">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending_kyc">Pending KYC</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tradeFilter} onValueChange={setTradeFilter}>
                <SelectTrigger className="flex-1 h-11 touch-manipulation">
                  <SelectValue placeholder="Trade" />
                </SelectTrigger>
                <SelectContent>
                  {tradeCategories.map((trade) => (
                    <SelectItem key={trade} value={trade}>
                      {trade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : filteredContractors.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">No contractors found</p>
              </div>
            ) : (
              filteredContractors.map((contractor) => {
                const compliance = getComplianceStatus(contractor)
                const ComplianceIcon = compliance.icon
                return (
                  <DataCard key={contractor.id} className="touch-manipulation">
                    <DataCardHeader
                      title={contractor.company_name}
                      subtitle={contractor.contact_name}
                      badge={
                        <Badge variant="outline" className={`${compliance.color} gap-1 text-xs`}>
                          <ComplianceIcon className="w-3 h-3" />
                          {compliance.label}
                        </Badge>
                      }
                    />
                    
                    <div className="space-y-2 pt-2 border-t border-border">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        <span>{contractor.city}, {contractor.province}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{contractor.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-4 h-4" />
                        <span>{contractor.phone}</span>
                      </div>
                    </div>

                    {contractor.wcb_clearance_expiry && (
                      <DataCardRow
                        label="WCB Expiry"
                        value={
                          <span className={new Date(contractor.wcb_clearance_expiry) < new Date() ? "text-destructive font-medium" : ""}>
                            {new Date(contractor.wcb_clearance_expiry).toLocaleDateString("en-CA")}
                          </span>
                        }
                      />
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-10 touch-manipulation"
                        onClick={() => handleGenerateKYCLink(contractor.id)}
                      >
                        {copiedId === contractor.id ? (
                          <>
                            <Check className="w-4 h-4 mr-1.5" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-1.5" />
                            KYC Link
                          </>
                        )}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-10 touch-manipulation">
                        <Eye className="w-4 h-4 mr-1.5" />
                        View
                      </Button>
                    </div>
                  </DataCard>
                )
              })
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block border border-border rounded-xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Company</TableHead>
                    <TableHead className="font-semibold">Contact</TableHead>
                    <TableHead className="font-semibold">Location</TableHead>
                    <TableHead className="font-semibold">Compliance</TableHead>
                    <TableHead className="font-semibold">WCB Expiry</TableHead>
                    <TableHead className="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                          Loading contractors...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredContractors.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <div className="text-muted-foreground">
                          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>No contractors found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredContractors.map((contractor) => {
                      const compliance = getComplianceStatus(contractor)
                      const ComplianceIcon = compliance.icon
                      return (
                        <TableRow 
                          key={contractor.id} 
                          className="hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => goToContractor(contractor)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-medium">{contractor.company_name}</p>
                              <p className="text-sm text-muted-foreground">
                                {contractor.email}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p>{contractor.contact_name}</p>
                              <p className="text-sm text-muted-foreground">
                                {contractor.phone}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p>
                              {contractor.city}, {contractor.province}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`${compliance.color} gap-1.5`}
                            >
                              <ComplianceIcon className="w-3 h-3" />
                              {compliance.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {contractor.wcb_clearance_expiry ? (
                              <span
                                className={
                                  new Date(contractor.wcb_clearance_expiry) < new Date()
                                    ? "text-destructive font-medium"
                                    : ""
                                }
                              >
                                {new Date(contractor.wcb_clearance_expiry).toLocaleDateString(
                                  "en-CA"
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Not provided</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleGenerateKYCLink(contractor.id)
                                }}
                                className="gap-1.5"
                              >
                                {copiedId === contractor.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    KYC Link
                                  </>
                                )}
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => goToContractor(contractor)}>
                                    <Eye className="w-4 h-4 mr-2" />
                                    View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => goToContractor(contractor)}>
                                    <FileText className="w-4 h-4 mr-2" />
                                    View Documents
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Spacer */}
      <div className="h-16 md:hidden" />
    </div>
  )
}

// Wrap in Suspense boundary for useSearchParams
export default function ContractorDirectoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <ContractorDirectoryContent />
    </Suspense>
  )
}
