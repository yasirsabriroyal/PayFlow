'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  FolderKanban, 
  ArrowLeft,
  DollarSign,
  FileText,
  Users,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  TrendingUp,
  TrendingDown,
  AlertTriangle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import Link from 'next/link'
import { RoleTabBar } from '@/components/role-tab-bar'
import { AppHeader } from '@/components/app-header'
import { ProjectTeamSection } from './project-team-section'

interface Project {
  id: string
  project_number: string
  name: string
  address_line1: string | null
  city: string | null
  province: string | null
  original_budget_cents: number
  current_budget_cents: number
  spent_cents: number
  committed_cents: number
  is_active: boolean
  start_date: string | null
  estimated_completion_date: string | null
  description: string | null
}

interface ChangeOrder {
  id: string
  co_number: string
  description: string
  amount_cents: number
  status: string
  contractor_id: string | null
  contractor?: {
    company_name: string
  }
  created_at: string
  approved_at: string | null
  approved_by: string | null
}

interface ProjectContractor {
  id: string
  company_name: string
  contact_name: string
  email: string
  status: string
  total_billed_cents: number
  total_paid_cents: number
}


function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function ProjectDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const [project, setProject] = useState<Project | null>(null)
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  const [contractors, setContractors] = useState<ProjectContractor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isChangeOrderModalOpen, setIsChangeOrderModalOpen] = useState(false)
  const [isCreatingCO, setIsCreatingCO] = useState(false)
  const [activeTab, setActiveTab] = useState('contractors')

  // New change order form state
  const [newChangeOrder, setNewChangeOrder] = useState({
    description: '',
    amount_cents: 0,
    contractor_id: '',
    status: 'pending',
    is_credit: false,
  })

  const fetchProjectData = async () => {
    const supabase = createClient()
    
    // Fetch project
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .eq('id', resolvedParams.id)
      .single()

    // Fetch change orders
    const { data: coData } = await supabase
      .from('change_orders')
      .select('*, contractor:contractors(company_name)')
      .eq('project_id', resolvedParams.id)
      .order('created_at', { ascending: false })

    // For contractors, we'd normally join through invoices/payments
    // Using mock data for now

    if (!projectData) {
      // Reflect the real database (not-found / empty state)
      setProject(null)
      setChangeOrders([])
      setContractors([])
    } else {
      setProject(projectData)
      setChangeOrders(coData && coData.length > 0 ? coData : [])
      // Contractors are derived from invoice/payment joins
      setContractors([])
    }
    
    setIsLoading(false)
  }

  useEffect(() => {
    fetchProjectData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.id])

  const handleCreateChangeOrder = async () => {
    if (!project) return
    setIsCreatingCO(true)
    
    const supabase = createClient()
    const coNumber = `CO-${String(changeOrders.length + 1).padStart(3, '0')}`
    const amount = newChangeOrder.is_credit ? -Math.abs(newChangeOrder.amount_cents) : newChangeOrder.amount_cents

    const { error } = await supabase
      .from('change_orders')
      .insert({
        project_id: project.id,
        co_number: coNumber,
        description: newChangeOrder.description,
        amount_cents: amount,
        contractor_id: newChangeOrder.contractor_id || null,
        status: newChangeOrder.status,
      })

    if (!error) {
      // Update project budget if approved
      if (newChangeOrder.status === 'approved') {
        await supabase
          .from('projects')
          .update({
            current_budget_cents: project.current_budget_cents + amount,
          })
          .eq('id', project.id)
      }

      setIsChangeOrderModalOpen(false)
      setNewChangeOrder({
        description: '',
        amount_cents: 0,
        contractor_id: '',
        status: 'pending',
        is_credit: false,
      })
      fetchProjectData()
    }
    
    setIsCreatingCO(false)
  }

  if (isLoading || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-muted-foreground">Loading project...</span>
        </div>
      </div>
    )
  }

  // Calculate stats
  const approvedCOTotal = changeOrders
    .filter(co => co.status === 'approved')
    .reduce((acc, co) => acc + co.amount_cents, 0)
  
  const revisedBudget = project.original_budget_cents + approvedCOTotal
  const remaining = project.current_budget_cents - project.spent_cents
  const budgetUsedPercent = project.current_budget_cents > 0 
    ? Math.round((project.spent_cents / project.current_budget_cents) * 100)
    : 0

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Project Details" />
      <RoleTabBar role="admin" />
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin/projects">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold">{project.name}</h1>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  project.is_active 
                    ? 'bg-success/10 text-success' 
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {project.is_active ? 'Active' : 'Completed'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {project.project_number} • {project.city}, {project.province}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        {/* Budget Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-card border border-border rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">Original Budget</span>
            </div>
            <p className="text-2xl font-semibold">{formatCurrency(project.original_budget_cents)}</p>
          </div>

          <div className="p-5 bg-card border border-border rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                approvedCOTotal >= 0 ? 'bg-success/10' : 'bg-destructive/10'
              }`}>
                {approvedCOTotal >= 0 
                  ? <TrendingUp className="w-5 h-5 text-success" />
                  : <TrendingDown className="w-5 h-5 text-destructive" />
                }
              </div>
              <span className="text-sm text-muted-foreground">Approved Change Orders</span>
            </div>
            <p className={`text-2xl font-semibold ${
              approvedCOTotal >= 0 ? 'text-success' : 'text-destructive'
            }`}>
              {approvedCOTotal >= 0 ? '+' : ''}{formatCurrency(approvedCOTotal)}
            </p>
          </div>

          <div className="p-5 bg-card border border-border rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Revised Budget</span>
            </div>
            <p className="text-2xl font-semibold">{formatCurrency(revisedBudget)}</p>
          </div>

          <div className="p-5 bg-card border border-border rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                budgetUsedPercent >= 100 ? 'bg-destructive/10' : 
                budgetUsedPercent >= 85 ? 'bg-warning/10' : 'bg-accent/10'
              }`}>
                {budgetUsedPercent >= 100 
                  ? <AlertTriangle className="w-5 h-5 text-destructive" />
                  : <FileText className="w-5 h-5 text-accent" />
                }
              </div>
              <span className="text-sm text-muted-foreground">Amount Billed</span>
            </div>
            <p className="text-2xl font-semibold">{formatCurrency(project.spent_cents)}</p>
            <p className="text-xs text-muted-foreground mt-1">{budgetUsedPercent}% of budget</p>
          </div>
        </div>

        {/* Budget Progress */}
        <div className="p-5 bg-card border border-border rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Budget Utilization</span>
            <span className={`text-sm font-medium ${
              remaining < 0 ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {formatCurrency(remaining)} remaining
            </span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all ${
                budgetUsedPercent >= 100 ? 'bg-destructive' :
                budgetUsedPercent >= 85 ? 'bg-warning' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>$0</span>
            <span>{formatCurrency(project.current_budget_cents)}</span>
          </div>
        </div>

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="contractors" className="gap-2">
              <Users className="w-4 h-4" />
              Contractors
            </TabsTrigger>
            <TabsTrigger value="change-orders" className="gap-2">
              <FileText className="w-4 h-4" />
              Change Orders
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-2">
              <Users className="w-4 h-4" />
              Team
            </TabsTrigger>
          </TabsList>

          {/* Contractors Tab */}
          <TabsContent value="contractors" className="mt-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Assigned Contractors
                </h3>
                <span className="text-sm text-muted-foreground">{contractors.length} contractors</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Contractor</th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Contact</th>
                      <th className="text-center px-6 py-3 text-sm font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-muted-foreground">Total Billed</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-muted-foreground">Total Paid</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-muted-foreground">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractors.map((contractor) => (
                      <tr key={contractor.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
                              <Building2 className="w-4 h-4 text-primary" />
                            </div>
                            <span className="font-medium">{contractor.company_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          <p>{contractor.contact_name}</p>
                          <p>{contractor.email}</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                            contractor.status === 'active'
                              ? 'bg-success/10 text-success'
                              : 'bg-warning/10 text-warning'
                          }`}>
                            {contractor.status === 'active' ? 'Active' : 'Pending KYC'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-medium">
                          {formatCurrency(contractor.total_billed_cents)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {formatCurrency(contractor.total_paid_cents)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-warning">
                          {formatCurrency(contractor.total_billed_cents - contractor.total_paid_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {contractors.length === 0 && (
                <div className="p-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No contractors assigned</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Change Orders Tab */}
          <TabsContent value="change-orders" className="mt-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Change Orders
                </h3>
                <Button size="sm" className="gap-2" onClick={() => setIsChangeOrderModalOpen(true)}>
                  <Plus className="w-4 h-4" />
                  Log Change Order
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">CO #</th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Description</th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Contractor</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-muted-foreground">Amount</th>
                      <th className="text-center px-6 py-3 text-sm font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeOrders.map((co) => (
                      <tr key={co.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-6 py-4 font-medium">{co.co_number}</td>
                        <td className="px-6 py-4">
                          <p className="text-sm max-w-md truncate">{co.description}</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {co.contractor?.company_name || '-'}
                        </td>
                        <td className={`px-6 py-4 text-right font-medium ${
                          co.amount_cents < 0 ? 'text-destructive' : 'text-success'
                        }`}>
                          {co.amount_cents >= 0 ? '+' : ''}{formatCurrency(co.amount_cents)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                            co.status === 'approved'
                              ? 'bg-success/10 text-success'
                              : co.status === 'rejected'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-warning/10 text-warning'
                          }`}>
                            {co.status === 'approved' && <CheckCircle className="w-3 h-3" />}
                            {co.status === 'rejected' && <XCircle className="w-3 h-3" />}
                            {co.status === 'pending' && <Clock className="w-3 h-3" />}
                            {co.status.charAt(0).toUpperCase() + co.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {formatDate(co.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {changeOrders.length === 0 && (
                <div className="p-12 text-center">
                  <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No change orders recorded</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="mt-4">
            <ProjectTeamSection projectId={project.id} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Create Change Order Modal */}
      <Dialog open={isChangeOrderModalOpen} onOpenChange={setIsChangeOrderModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Log Change Order
            </DialogTitle>
            <DialogDescription>
              Record a budget modification for this project.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="co_contractor">Contractor (Optional)</Label>
              <Select 
                value={newChangeOrder.contractor_id} 
                onValueChange={(value) => setNewChangeOrder({ ...newChangeOrder, contractor_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select contractor" />
                </SelectTrigger>
                <SelectContent>
                  {contractors.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="co_description">Description *</Label>
              <Textarea
                id="co_description"
                placeholder="Describe the change order..."
                value={newChangeOrder.description}
                onChange={(e) => setNewChangeOrder({ ...newChangeOrder, description: e.target.value })}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="co_amount">Amount (CAD) *</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="co_amount"
                    type="number"
                    placeholder="0.00"
                    className="pl-10"
                    value={Math.abs(newChangeOrder.amount_cents) / 100 || ''}
                    onChange={(e) => setNewChangeOrder({ 
                      ...newChangeOrder, 
                      amount_cents: Math.round(parseFloat(e.target.value || '0') * 100)
                    })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Type</Label>
                <Select 
                  value={newChangeOrder.is_credit ? 'credit' : 'addition'} 
                  onValueChange={(value) => setNewChangeOrder({ 
                    ...newChangeOrder, 
                    is_credit: value === 'credit' 
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="addition">
                      <span className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-success" />
                        Addition (+)
                      </span>
                    </SelectItem>
                    <SelectItem value="credit">
                      <span className="flex items-center gap-2">
                        <TrendingDown className="w-4 h-4 text-destructive" />
                        Credit (-)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="co_status">Status *</Label>
              <Select 
                value={newChangeOrder.status} 
                onValueChange={(value) => setNewChangeOrder({ ...newChangeOrder, status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-warning" />
                      Pending
                    </span>
                  </SelectItem>
                  <SelectItem value="approved">
                    <span className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-success" />
                      Approved
                    </span>
                  </SelectItem>
                  <SelectItem value="rejected">
                    <span className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-destructive" />
                      Rejected
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newChangeOrder.status === 'approved' && (
              <div className="p-3 bg-success/10 border border-success/20 rounded-lg text-sm text-success">
                Approving this change order will adjust the project budget by{' '}
                <strong>
                  {newChangeOrder.is_credit ? '-' : '+'}
                  {formatCurrency(newChangeOrder.amount_cents)}
                </strong>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsChangeOrderModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateChangeOrder} 
              disabled={!newChangeOrder.description || newChangeOrder.amount_cents <= 0 || isCreatingCO}
            >
              {isCreatingCO ? 'Saving...' : 'Save Change Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
