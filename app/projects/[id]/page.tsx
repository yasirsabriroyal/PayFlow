'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, Briefcase, Building2, Calendar, DollarSign, 
  CheckCircle2, Clock, AlertTriangle, XCircle, FileText,
  Users, TrendingUp, TrendingDown, MapPin, RefreshCw, 
  MoreHorizontal, Pencil, Save, X, Loader2, ChevronRight,
  Plus, Receipt, History, Award, UserPlus, Trash2, HardHat, Mail, Phone
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppHeader } from '@/components/app-header'
import { WorkflowLink } from '@/components/workflow-link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { usePermissions } from '@/hooks/use-permissions'
import { 
  getProjectHub, 
  updateProjectSection, 
  toggleProjectStatus, 
  getProjectContractors,
  getAvailableContractors,
  assignContractorToProject,
  updateProjectContractor,
  removeContractorFromProject,
  type ProjectHubData,
  type ProjectContractor 
} from './actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDate(dateString: string | null | undefined) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getInvoiceStatusInfo(status: string) {
  const statusMap: Record<string, { label: string; color: string; bgColor: string }> = {
    draft: { label: 'Draft', color: 'text-muted-foreground', bgColor: 'bg-muted' },
    submitted: { label: 'Submitted', color: 'text-warning', bgColor: 'bg-warning/10' },
    pending_approval: { label: 'Pending', color: 'text-primary', bgColor: 'bg-primary/10' },
    approved: { label: 'Approved', color: 'text-success', bgColor: 'bg-success/10' },
    paid: { label: 'Paid', color: 'text-success', bgColor: 'bg-success/10' },
    rejected: { label: 'Rejected', color: 'text-destructive', bgColor: 'bg-destructive/10' },
  }
  return statusMap[status] || { label: status, color: 'text-muted-foreground', bgColor: 'bg-muted' }
}

function getCOStatusInfo(status: string) {
  const statusMap: Record<string, { label: string; color: string; bgColor: string }> = {
    pending: { label: 'Pending', color: 'text-warning', bgColor: 'bg-warning/10' },
    approved: { label: 'Approved', color: 'text-success', bgColor: 'bg-success/10' },
    rejected: { label: 'Rejected', color: 'text-destructive', bgColor: 'bg-destructive/10' },
  }
  return statusMap[status] || { label: status, color: 'text-muted-foreground', bgColor: 'bg-muted' }
}

export default function ProjectHubPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const { hasPermission } = usePermissions()
  const projectId = params.id as string
  const canEdit = hasPermission('edit_projects')

  const [data, setData] = useState<ProjectHubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  
  // Edit states - single comprehensive form
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    project_number: '',
    description: '',
    original_budget_cents: 0,
    current_budget_cents: 0,
    start_date: '',
    estimated_completion_date: '',
    actual_completion_date: '',
    substantial_performance_date: '',
    address_line1: '',
    city: '',
    province: '',
  })

  // Contractor assignment states
  const [projectContractors, setProjectContractors] = useState<ProjectContractor[]>([])
  const [availableContractors, setAvailableContractors] = useState<Array<{
    id: string
    company_name: string
    contact_name: string
    email: string
    status: string
  }>>([])
  const [isAssignOpen, setIsAssignOpen] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [assignForm, setAssignForm] = useState({
    contractor_id: '',
    trade: '',
    notes: '',
    contract_amount: '',
  })

  // Fetch project hub data
  const fetchData = useCallback(async () => {
    const result = await getProjectHub(projectId)
    if (result.success && result.data) {
      setData(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load project',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }, [projectId, toast])

  // Fetch project contractors
  const fetchContractors = useCallback(async () => {
    const result = await getProjectContractors(projectId)
    if (result.success && result.data) {
      setProjectContractors(result.data)
    }
  }, [projectId])

  // Fetch available contractors when opening assign modal
  const openAssignModal = async () => {
    const result = await getAvailableContractors(projectId)
    if (result.success && result.data) {
      setAvailableContractors(result.data)
    }
    setAssignForm({
      contractor_id: '',
      trade: '',
      notes: '',
      contract_amount: '',
    })
    setIsAssignOpen(true)
  }

  // Assign contractor to project
  const handleAssignContractor = async () => {
    if (!assignForm.contractor_id) {
      toast({
        title: 'Error',
        description: 'Please select a contractor',
        variant: 'destructive',
      })
      return
    }

    setIsAssigning(true)
    try {
      const contractAmountCents = assignForm.contract_amount 
        ? Math.round(parseFloat(assignForm.contract_amount) * 100) 
        : null

      const result = await assignContractorToProject(
        projectId,
        assignForm.contractor_id,
        assignForm.trade || null,
        assignForm.notes || null,
        contractAmountCents
      )

      if (result.success) {
        toast({
          title: 'Contractor assigned',
          description: 'Contractor has been added to this project.',
        })
        setIsAssignOpen(false)
        fetchContractors()
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to assign contractor',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      })
    } finally {
      setIsAssigning(false)
    }
  }

  // Remove contractor from project
  const handleRemoveContractor = async (assignmentId: string, companyName: string) => {
    if (!confirm(`Remove ${companyName} from this project?`)) return

    const result = await removeContractorFromProject(assignmentId)
    if (result.success) {
      toast({
        title: 'Contractor removed',
        description: `${companyName} has been removed from this project.`,
      })
      fetchContractors()
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to remove contractor',
        variant: 'destructive',
      })
    }
  }

  useEffect(() => {
    fetchData()
    fetchContractors()
  }, [fetchData, fetchContractors])

  // Open edit modal with all project data
  const openEditModal = () => {
    if (!data || !canEdit) return
    
    const { project } = data
    
    setEditForm({
      name: project.name || '',
      project_number: project.project_number || '',
      description: project.description || '',
      original_budget_cents: project.original_budget_cents || 0,
      current_budget_cents: project.current_budget_cents || 0,
      start_date: project.start_date || '',
      estimated_completion_date: project.estimated_completion_date || '',
      actual_completion_date: project.actual_completion_date || '',
      substantial_performance_date: project.substantial_performance_date || '',
      address_line1: project.address_line1 || '',
      city: project.city || '',
      province: project.province || '',
    })
    setIsEditOpen(true)
  }

  // Save all project changes
  const saveProject = async () => {
    if (!data) return
    
    setIsSaving(true)
    try {
      // Update all sections at once
      const result = await updateProjectSection(projectId, 'all', editForm)
      
      if (result.success) {
        toast({
          title: 'Project updated',
          description: 'Project information has been saved.',
        })
        setIsEditOpen(false)
        fetchData() // Refresh data
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to save changes',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  // Toggle project status
  const handleToggleStatus = async () => {
    if (!data) return
    
    const result = await toggleProjectStatus(projectId)
    if (result.success) {
      toast({
        title: data.project.is_active ? 'Project archived' : 'Project restored',
        description: data.project.is_active ? 'Project has been marked as inactive.' : 'Project has been reactivated.',
      })
      fetchData()
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to update project status',
        variant: 'destructive',
      })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    )
  }

  if (!data || !data.project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <h1 className="text-xl font-semibold mb-2">Project Not Found</h1>
          <p className="text-muted-foreground mb-4">The project you are looking for does not exist.</p>
          <Button onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    )
  }

  const { project, invoices, changeOrders, contractors, assignments, summary } = data

  // Calculate budget metrics
  const budgetUsedPercent = project.current_budget_cents > 0 
    ? Math.round((project.spent_cents / project.current_budget_cents) * 100) 
    : 0
  const remainingBudget = project.current_budget_cents - project.spent_cents
  const approvedCOsTotal = changeOrders
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + co.amount_cents, 0)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle={project.name}
        pageDescription={`${project.project_number} • ${project.city || ''}, ${project.province || ''}`}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Project Header Card */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.back()} title="Go back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold">{project.name}</h1>
                  <Badge variant={project.is_active ? 'default' : 'secondary'}>
                    {project.is_active ? 'Active' : 'Archived'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {project.project_number} • {project.city}, {project.province}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={openEditModal}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleToggleStatus}>
                      {project.is_active ? (
                        <>
                          <XCircle className="w-4 h-4 mr-2" />
                          Archive Project
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Restore Project
                        </>
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        {/* Budget Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">Original Budget</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(project.original_budget_cents)}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                approvedCOsTotal >= 0 ? 'bg-success/10' : 'bg-destructive/10'
              }`}>
                {approvedCOsTotal >= 0 
                  ? <TrendingUp className="w-5 h-5 text-success" />
                  : <TrendingDown className="w-5 h-5 text-destructive" />
                }
              </div>
              <span className="text-sm text-muted-foreground">Change Orders</span>
            </div>
            <p className={`text-2xl font-bold ${approvedCOsTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
              {approvedCOsTotal >= 0 ? '+' : ''}{formatCurrency(approvedCOsTotal)}
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Current Budget</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(project.current_budget_cents)}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                budgetUsedPercent >= 100 ? 'bg-destructive/10' : 
                budgetUsedPercent >= 85 ? 'bg-warning/10' : 'bg-success/10'
              }`}>
                {budgetUsedPercent >= 100 
                  ? <AlertTriangle className="w-5 h-5 text-destructive" />
                  : <Receipt className="w-5 h-5 text-success" />
                }
              </div>
              <span className="text-sm text-muted-foreground">Spent</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(project.spent_cents)}</p>
            <p className="text-xs text-muted-foreground">{budgetUsedPercent}% of budget</p>
          </div>
        </div>

        {/* Budget Progress Bar */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Budget Utilization</span>
            <span className={`text-sm font-medium ${remainingBudget < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {formatCurrency(remainingBudget)} remaining
            </span>
          </div>
          <Progress 
            value={Math.min(budgetUsedPercent, 100)} 
            className={`h-3 ${
              budgetUsedPercent >= 100 ? '[&>div]:bg-destructive' :
              budgetUsedPercent >= 85 ? '[&>div]:bg-warning' : ''
            }`}
          />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>$0</span>
            <span>{formatCurrency(project.current_budget_cents)}</span>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          {/* Mobile: horizontally scrollable strip. md+: grid layout. */}
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="flex w-max min-w-full md:grid md:w-full md:grid-cols-5 md:max-w-3xl">
              <TabsTrigger value="overview" className="flex items-center gap-1.5 whitespace-nowrap px-4 min-w-[5rem]">
                <Briefcase className="w-4 h-4 shrink-0 hidden sm:block" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="invoices" className="flex items-center gap-1.5 whitespace-nowrap px-4 min-w-[5rem]">
                <FileText className="w-4 h-4 shrink-0 hidden sm:block" />
                Invoices
                {invoices.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 shrink-0">{invoices.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="change-orders" className="flex items-center gap-1.5 whitespace-nowrap px-4 min-w-[5rem]">
                <TrendingUp className="w-4 h-4 shrink-0 hidden sm:block" />
                COs
                {changeOrders.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 shrink-0">{changeOrders.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="contractors" className="flex items-center gap-1.5 whitespace-nowrap px-4 min-w-[5rem]">
                <HardHat className="w-4 h-4 shrink-0 hidden sm:block" />
                Contractors
                {projectContractors.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 shrink-0">{projectContractors.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="team" className="flex items-center gap-1.5 whitespace-nowrap px-4 min-w-[5rem]">
                <Users className="w-4 h-4 shrink-0 hidden sm:block" />
                Team
                {assignments.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 shrink-0">{assignments.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Project Details Card */}
              <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary" />
                    Project Details
                  </h2>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={openEditModal}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project Name</p>
                    <p className="font-medium mt-1">{project.name}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project Number</p>
                    <p className="font-medium mt-1">{project.project_number}</p>
                  </div>
                  {project.description && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
                      <p className="text-sm mt-1 text-muted-foreground">{project.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Location Card */}
              <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    Location
                  </h2>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={openEditModal}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Address</p>
                    <p className="font-medium mt-1">{project.address_line1 || '-'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</p>
                      <p className="font-medium mt-1">{project.city || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Province</p>
                      <p className="font-medium mt-1">{project.province || '-'}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dates Card */}
              <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-primary" />
                    Key Dates
                  </h2>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={openEditModal}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Start Date</p>
                      <p className="font-medium mt-1">{formatDate(project.start_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Est. Completion</p>
                      <p className="font-medium mt-1">{formatDate(project.estimated_completion_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actual Completion</p>
                      <p className="font-medium mt-1">{formatDate(project.actual_completion_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Substantial Performance</p>
                      <p className="font-medium mt-1">{formatDate(project.substantial_performance_date)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Budget Card */}
              <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    Budget Summary
                  </h2>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={openEditModal}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Original</p>
                      <p className="font-medium mt-1">{formatCurrency(project.original_budget_cents)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current</p>
                      <p className="font-medium mt-1">{formatCurrency(project.current_budget_cents)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Spent</p>
                      <p className="font-medium mt-1">{formatCurrency(project.spent_cents)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Committed</p>
                      <p className="font-medium mt-1">{formatCurrency(project.committed_cents)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Invoices Tab */}
          <TabsContent value="invoices" className="space-y-4">
            <div className="bg-card border border-border rounded-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Project Invoices
                </h2>
                <span className="text-sm text-muted-foreground">
                  {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} • Total: {formatCurrency(summary.total_invoiced_cents)}
                </span>
              </div>
              {invoices.length === 0 ? (
                <div className="p-12 text-center">
                  <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No invoices for this project</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {invoices.map((invoice) => {
                    const statusInfo = getInvoiceStatusInfo(invoice.status)
                    return (
                      <WorkflowLink
                        key={invoice.id}
                        href={`/invoices/${invoice.id}`}
                        contextTitle={invoice.invoice_number}
                        className="block p-4 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <FileText className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{invoice.invoice_number}</p>
                              <p className="text-sm text-muted-foreground">
                                {invoice.contractor?.company_name || 'Unknown'} • {formatDate(invoice.invoice_date)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="font-semibold">{formatCurrency(invoice.total_cents)}</p>
                              <Badge className={`${statusInfo.bgColor} ${statusInfo.color} border-0`}>
                                {statusInfo.label}
                              </Badge>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      </WorkflowLink>
                    )
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Change Orders Tab */}
          <TabsContent value="change-orders" className="space-y-4">
            <div className="bg-card border border-border rounded-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Change Orders
                </h2>
                <span className="text-sm text-muted-foreground">
                  {changeOrders.length} CO{changeOrders.length !== 1 ? 's' : ''} • Approved: {formatCurrency(approvedCOsTotal)}
                </span>
              </div>
              {changeOrders.length === 0 ? (
                <div className="p-12 text-center">
                  <TrendingUp className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No change orders for this project</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {changeOrders.map((co) => {
                    const statusInfo = getCOStatusInfo(co.status)
                    const isCredit = co.amount_cents < 0
                    return (
                      <div key={co.id} className="p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isCredit ? 'bg-destructive/10' : 'bg-success/10'
                            }`}>
                              {isCredit 
                                ? <TrendingDown className="w-5 h-5 text-destructive" />
                                : <TrendingUp className="w-5 h-5 text-success" />
                              }
                            </div>
                            <div>
                              <p className="font-medium">{co.co_number}</p>
                              <p className="text-sm text-muted-foreground line-clamp-1">
                                {co.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className={`font-semibold ${isCredit ? 'text-destructive' : 'text-success'}`}>
                                {isCredit ? '' : '+'}{formatCurrency(co.amount_cents)}
                              </p>
                              <Badge className={`${statusInfo.bgColor} ${statusInfo.color} border-0`}>
                                {statusInfo.label}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Contractors Tab */}
          <TabsContent value="contractors" className="space-y-4">
            <div className="bg-card border border-border rounded-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <HardHat className="w-4 h-4 text-primary" />
                  Project Contractors
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {projectContractors.length} contractor{projectContractors.length !== 1 ? 's' : ''} assigned
                  </span>
                  {canEdit && (
                    <Button size="sm" onClick={openAssignModal} className="gap-2">
                      <UserPlus className="w-4 h-4" />
                      Assign Contractor
                    </Button>
                  )}
                </div>
              </div>
              
              {projectContractors.length === 0 ? (
                <div className="p-8 text-center">
                  <HardHat className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No contractors assigned to this project</p>
                  {canEdit && (
                    <Button variant="outline" onClick={openAssignModal} className="mt-4 gap-2">
                      <UserPlus className="w-4 h-4" />
                      Assign First Contractor
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {projectContractors.map((pc) => (
                    <div 
                      key={pc.id} 
                      className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/pm/contractors/${pc.contractor_id}`)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                              <Building2 className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <span className="font-medium hover:text-primary transition-colors">
                                {pc.contractor?.company_name || 'Unknown Contractor'}
                              </span>
                              {pc.trade && (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {pc.trade}
                                </Badge>
                              )}
                              <div className="text-sm text-muted-foreground">
                                {pc.contractor?.contact_name}
                              </div>
                            </div>
                          </div>
                          
                          <div className="ml-13 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                            {pc.contractor?.email && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Mail className="w-3.5 h-3.5" />
                                <span>{pc.contractor.email}</span>
                              </div>
                            )}
                            {pc.contractor?.phone && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Phone className="w-3.5 h-3.5" />
                                <span>{pc.contractor.phone}</span>
                              </div>
                            )}
                            {pc.contract_amount_cents && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <DollarSign className="w-3.5 h-3.5" />
                                Contract: {formatCurrency(pc.contract_amount_cents)}
                              </div>
                            )}
                          </div>
                          
                          {pc.notes && (
                            <p className="ml-13 mt-2 text-sm text-muted-foreground">
                              {pc.notes}
                            </p>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Badge 
                            variant={pc.status === 'active' ? 'default' : pc.status === 'completed' ? 'secondary' : 'destructive'}
                            className="capitalize"
                          >
                            {pc.status}
                          </Badge>
                          {canEdit && (
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => handleRemoveContractor(pc.id, pc.contractor?.company_name || 'Contractor')}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          
          {/* Team Tab */}
          <TabsContent value="team" className="space-y-4">
            <div className="bg-card border border-border rounded-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Project Team
                </h2>
                <span className="text-sm text-muted-foreground">
                  {assignments.length} member{assignments.length !== 1 ? 's' : ''}
                </span>
              </div>
              {assignments.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No team members assigned</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {assignments.map((assignment) => (
                    <div key={assignment.id} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">
                            {assignment.user?.first_name?.[0]}{assignment.user?.last_name?.[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium">
                            {assignment.user?.first_name} {assignment.user?.last_name}
                          </p>
                          <p className="text-sm text-muted-foreground">{assignment.user?.email}</p>
                        </div>
                      </div>
                      <Badge variant="secondary">{assignment.role}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Comprehensive Edit Project Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update project information. All changes will be saved when you click Save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Project Details Section */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-primary border-b pb-2">
                <Briefcase className="w-4 h-4" />
                Project Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name *</Label>
                  <Input
                    id="name"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="Enter project name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project_number">Project Number *</Label>
                  <Input
                    id="project_number"
                    value={editForm.project_number}
                    onChange={(e) => setEditForm({ ...editForm, project_number: e.target.value })}
                    placeholder="PRJ-001"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Project description..."
                  rows={2}
                />
              </div>
            </div>

            {/* Budget Section */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-primary border-b pb-2">
                <DollarSign className="w-4 h-4" />
                Budget
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="original_budget">Original Budget ($)</Label>
                  <Input
                    id="original_budget"
                    type="number"
                    value={(editForm.original_budget_cents || 0) / 100}
                    onChange={(e) => setEditForm({ ...editForm, original_budget_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_budget">Current Budget ($)</Label>
                  <Input
                    id="current_budget"
                    type="number"
                    value={(editForm.current_budget_cents || 0) / 100}
                    onChange={(e) => setEditForm({ ...editForm, current_budget_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Key Dates Section */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-primary border-b pb-2">
                <Calendar className="w-4 h-4" />
                Key Dates
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={editForm.start_date}
                    onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estimated_completion_date">Estimated Completion</Label>
                  <Input
                    id="estimated_completion_date"
                    type="date"
                    value={editForm.estimated_completion_date}
                    onChange={(e) => setEditForm({ ...editForm, estimated_completion_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="actual_completion_date">Actual Completion</Label>
                  <Input
                    id="actual_completion_date"
                    type="date"
                    value={editForm.actual_completion_date}
                    onChange={(e) => setEditForm({ ...editForm, actual_completion_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="substantial_performance_date">Substantial Performance</Label>
                  <Input
                    id="substantial_performance_date"
                    type="date"
                    value={editForm.substantial_performance_date}
                    onChange={(e) => setEditForm({ ...editForm, substantial_performance_date: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Location Section */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-primary border-b pb-2">
                <MapPin className="w-4 h-4" />
                Location
              </h3>
              <div className="space-y-2">
                <Label htmlFor="address_line1">Address</Label>
                <Input
                  id="address_line1"
                  value={editForm.address_line1}
                  onChange={(e) => setEditForm({ ...editForm, address_line1: e.target.value })}
                  placeholder="Street address"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
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
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={saveProject} disabled={isSaving} className="gap-2">
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

      {/* Assign Contractor Dialog */}
      <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign Contractor to Project</DialogTitle>
            <DialogDescription>
              Select a contractor and specify their trade and scope of work for this project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="contractor">Contractor *</Label>
              <Select
                value={assignForm.contractor_id}
                onValueChange={(value) => setAssignForm({ ...assignForm, contractor_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a contractor" />
                </SelectTrigger>
                <SelectContent>
                  {availableContractors.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No available contractors
                    </div>
                  ) : (
                    availableContractors.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <span>{c.company_name}</span>
                          <span className="text-muted-foreground text-xs">({c.contact_name})</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="trade">Trade / Discipline</Label>
              <Select
                value={assignForm.trade}
                onValueChange={(value) => setAssignForm({ ...assignForm, trade: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select trade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="General Contractor">General Contractor</SelectItem>
                  <SelectItem value="Electrical">Electrical</SelectItem>
                  <SelectItem value="Plumbing">Plumbing</SelectItem>
                  <SelectItem value="HVAC">HVAC</SelectItem>
                  <SelectItem value="Framing">Framing</SelectItem>
                  <SelectItem value="Drywall">Drywall</SelectItem>
                  <SelectItem value="Painting">Painting</SelectItem>
                  <SelectItem value="Flooring">Flooring</SelectItem>
                  <SelectItem value="Roofing">Roofing</SelectItem>
                  <SelectItem value="Concrete">Concrete</SelectItem>
                  <SelectItem value="Masonry">Masonry</SelectItem>
                  <SelectItem value="Landscaping">Landscaping</SelectItem>
                  <SelectItem value="Excavation">Excavation</SelectItem>
                  <SelectItem value="Demolition">Demolition</SelectItem>
                  <SelectItem value="Insulation">Insulation</SelectItem>
                  <SelectItem value="Windows & Doors">Windows & Doors</SelectItem>
                  <SelectItem value="Cabinetry">Cabinetry</SelectItem>
                  <SelectItem value="Tile">Tile</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contract_amount">Contract Amount ($)</Label>
              <Input
                id="contract_amount"
                type="number"
                value={assignForm.contract_amount}
                onChange={(e) => setAssignForm({ ...assignForm, contract_amount: e.target.value })}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes / Scope of Work</Label>
              <Textarea
                id="notes"
                value={assignForm.notes}
                onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                placeholder="Describe the scope of work for this contractor..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignOpen(false)} disabled={isAssigning}>
              Cancel
            </Button>
            <Button onClick={handleAssignContractor} disabled={isAssigning || !assignForm.contractor_id} className="gap-2">
              {isAssigning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Assign Contractor
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
