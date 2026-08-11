'use client'

/**
 * PM Project Detail Page - View project details and invoices
 */

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  Users,
  ChevronRight,
  Plus,
  Loader2
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { getPMProjects, getPMInvoices } from '../../actions'
import { getProjectContractors, getAvailableContractors, assignContractorToProject } from '@/app/projects/[id]/actions'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { WorkflowLink } from '@/components/workflow-link'

type Project = {
  id: string
  name: string
  project_number: string
  address_line1?: string
  city?: string
  province?: string
  description?: string
  start_date?: string
  estimated_completion_date?: string
  original_budget_cents: number
  current_budget_cents?: number
  spent_cents?: number
  is_active: boolean
}

type Invoice = {
  id: string
  invoice_number: string
  project_id: string
  total_cents: number
  status: string
  invoice_date?: string
  contractor?: { company_name: string }
}

type Contractor = {
  id: string
  company_name: string
  contact_name?: string
  status: string
}

export default function PMProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const [project, setProject] = useState<Project | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Assign Contractor dialog state
  const [isAssignOpen, setIsAssignOpen] = useState(false)
  const [availableContractors, setAvailableContractors] = useState<Array<{ id: string; company_name: string; contact_name: string; email: string; status: string }> | null>(null)
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false)
  const [selectedContractorId, setSelectedContractorId] = useState('')
  const [isAssigning, setIsAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')

  useEffect(() => {
    const loadData = async () => {
      const [projectsResult, invoicesResult, contractorsResult] = await Promise.all([
        getPMProjects(),
        getPMInvoices(),
        getProjectContractors(resolvedParams.id)
      ])
      
      if (projectsResult.success) {
        const found = (projectsResult.projects as Project[]).find(p => p.id === resolvedParams.id)
        setProject(found || null)
      }
      
      if (invoicesResult.success) {
        // Filter invoices for this project by project_id
        const projectInvoices = (invoicesResult.invoices as unknown as Invoice[]).filter(
          inv => inv.project_id === resolvedParams.id
        )
        setInvoices(projectInvoices)
      }
      
      if (contractorsResult.success && contractorsResult.data) {
        // Map the project_contractors join rows into the Contractor shape.
        const mapped: Contractor[] = contractorsResult.data
          .filter(row => row.contractor)
          .map(row => ({
            id: row.contractor.id,
            company_name: row.contractor.company_name,
            contact_name: row.contractor.contact_name,
            status: row.contractor.status,
          }))
        setContractors(mapped)
      }
      
      setIsLoading(false)
    }
    loadData()
  }, [resolvedParams.id])

  const openAssignDialog = async () => {
    setIsAssignOpen(true)
    setSelectedContractorId('')
    setAssignError('')
    setIsLoadingAvailable(true)
    const result = await getAvailableContractors(resolvedParams.id)
    setAvailableContractors(result.success && result.data ? result.data : [])
    setIsLoadingAvailable(false)
  }

  const handleAssign = async () => {
    if (!selectedContractorId) return
    setIsAssigning(true)
    setAssignError('')
    const result = await assignContractorToProject(resolvedParams.id, selectedContractorId, null, null, null)
    if (result.success && result.data) {
      const newContractor = result.data.contractor
      if (newContractor) {
        setContractors(prev => [...prev, {
          id: newContractor.id,
          company_name: newContractor.company_name,
          contact_name: newContractor.contact_name,
          status: newContractor.status,
        }])
      }
      setIsAssignOpen(false)
      setSelectedContractorId('')
      const refresh = await getAvailableContractors(resolvedParams.id)
      setAvailableContractors(refresh.success && refresh.data ? refresh.data : [])
    } else {
      setAssignError(result.error || 'Failed to assign contractor')
    }
    setIsAssigning(false)
  }

  const formatCurrency = (cents?: number) => {
    if (!cents) return '$0'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100)
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not set'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Project Not Found" />
        <RoleTabBar role="project_manager" />
        <main className="max-w-7xl mx-auto px-4 py-12 text-center">
          <Briefcase className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-muted-foreground">Project not found or you don&apos;t have access</p>
          <Link href="/pm/projects">
            <Button variant="outline" className="mt-4">Back to Projects</Button>
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle={project.name}
        pageDescription={project.project_number}
      />
      <RoleTabBar role="project_manager" />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Project Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Original Budget</p>
                  <p className="text-lg font-semibold">{formatCurrency(project.original_budget_cents)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current Budget</p>
                  <p className="text-lg font-semibold">{formatCurrency(project.current_budget_cents || project.original_budget_cents)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Spent</p>
                  <p className="text-lg font-semibold">{formatCurrency(project.spent_cents)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Est. Completion</p>
                  <p className="text-lg font-semibold">{formatDate(project.estimated_completion_date)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="details" className="space-y-4">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
            <TabsTrigger value="contractors">Contractors ({contractors.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {project.description && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Description</p>
                    <p className="mt-1">{project.description}</p>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Location</p>
                    <div className="flex items-start gap-2 mt-1">
                      <Building2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <span>
                        {[project.address_line1, project.city, project.province]
                          .filter(Boolean)
                          .join(', ') || 'Not specified'}
                      </span>
                    </div>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Timeline</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span>{formatDate(project.start_date)} - {formatDate(project.estimated_completion_date)}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Project Invoices</CardTitle>
                <Link href="/pm/approvals">
                  <Button variant="outline" size="sm" className="gap-1">
                    View All Invoices
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {invoices.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground">No invoices yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {invoices.map((invoice) => (
                      <WorkflowLink 
                        key={invoice.id}
                        href={`/pm/invoices/${invoice.id}`}
                        contextTitle={invoice.invoice_number}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                      >
                        <div>
                          <p className="font-medium">{invoice.invoice_number}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatCurrency(invoice.total_cents)}
                          </p>
                        </div>
                        <Badge variant="outline">{invoice.status}</Badge>
                      </WorkflowLink>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contractors">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Assigned Contractors</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="gap-1" onClick={openAssignDialog}>
                    <Plus className="w-4 h-4" />
                    Assign Contractor
                  </Button>
                  <Link href="/pm/contractors">
                    <Button variant="outline" size="sm" className="gap-1">
                      View All
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {contractors.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground">No contractors assigned</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {contractors.map((contractor) => (
                      <WorkflowLink 
                        key={contractor.id}
                        href={`/pm/contractors/${contractor.id}`}
                        contextTitle={contractor.company_name}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                      >
                        <div>
                          <p className="font-medium">{contractor.company_name}</p>
                          {contractor.contact_name && (
                            <p className="text-sm text-muted-foreground">{contractor.contact_name}</p>
                          )}
                        </div>
                        <Badge variant={contractor.status === 'active' ? 'default' : 'secondary'}>
                          {contractor.status}
                        </Badge>
                      </WorkflowLink>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Assign Contractor Dialog */}
      <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Contractor to Project</DialogTitle>
            <DialogDescription>
              Select a contractor to assign to <strong>{project?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {isLoadingAvailable ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : availableContractors !== null && availableContractors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All registered contractors are already assigned to this project.
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="contractor-select">Contractor</Label>
                <Select
                  value={selectedContractorId}
                  onValueChange={setSelectedContractorId}
                >
                  <SelectTrigger id="contractor-select">
                    <SelectValue placeholder="Select a contractor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(availableContractors || []).map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="font-medium">{c.company_name}</span>
                        {c.contact_name && (
                          <span className="text-muted-foreground ml-2 text-xs">— {c.contact_name}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {assignError && (
              <p className="text-sm text-destructive">{assignError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedContractorId || isAssigning || isLoadingAvailable}
            >
              {isAssigning ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Assigning...</>
              ) : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
