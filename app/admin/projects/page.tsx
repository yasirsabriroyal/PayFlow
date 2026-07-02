'use client'

/**
 * Admin Projects Page - RBAC Hardened
 * 
 * Features:
 * - Create projects
 * - Edit all project fields
 * - Assign project managers
 * - View and manage project status
 */

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Building2, Plus, Search, AlertCircle, RefreshCw, Pencil, UserPlus, X, Users, Eye, Power, PowerOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  getProjects, 
  createProject, 
  updateProject, 
  getProjectManagers,
  assignProjectManager,
  removeProjectAssignment,
  archiveProject,
  restoreProject,
  getNextProjectNumber
} from './project-actions'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { usePermissions } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { isValidProjectNumber } from '@/lib/projects/project-number'

// Type definitions
type ProjectAssignment = {
  id: string
  user_id: string
  role: string
  users: {
    id: string
    first_name: string
    last_name: string
    email: string
    role: string
  }
}

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
  actual_completion_date?: string
  substantial_performance_date?: string
  original_budget_cents: number
  current_budget_cents?: number
  spent_cents?: number
  committed_cents?: number
  is_active: boolean
  created_at: string
  project_assignments?: ProjectAssignment[]
}

type Manager = {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
}

// Safe helpers
function safeCount(arr: unknown): number {
  if (!arr || !Array.isArray(arr)) return 0
  return arr.length
}

function safeArray<T>(arr: T[] | null | undefined): T[] {
  if (!arr || !Array.isArray(arr)) return []
  return arr
}

const PROVINCES = ['ON', 'BC', 'AB', 'SK', 'MB', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU']

export default function AdminProjectsPage() {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  // Admins / users with edit_projects may override the auto-generated number.
  const canOverrideNumber = hasPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS)
  const [projects, setProjects] = useState<Project[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/admin/projects')
  const [searchQuery, setSearchQuery] = useState(initialState?.search || '')
  const [statusFilter, setStatusFilter] = useState(initialState?.filters?.status as string || 'all')
  
  // Save state when search or filter changes
  useEffect(() => {
    save({ search: searchQuery, filters: { status: statusFilter } })
  }, [searchQuery, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  
  // Create modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isGeneratingNumber, setIsGeneratingNumber] = useState(false)
  const [numberManuallyEdited, setNumberManuallyEdited] = useState(false)
  
  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  // Project-number change protection state.
  const [originalNumber, setOriginalNumber] = useState('')
  const [numberChangeConfirm, setNumberChangeConfirm] = useState<{ usageCount: number } | null>(null)
  const [numberChangeReason, setNumberChangeReason] = useState('')
  
  // Assign PM modal state
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [assigningProject, setAssigningProject] = useState<Project | null>(null)
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [isAssigning, setIsAssigning] = useState(false)
  
  const [newProject, setNewProject] = useState({
    name: '',
    project_number: '',
    address_line1: '',
    city: '',
    province: 'ON',
    description: '',
    start_date: '',
    estimated_completion_date: '',
    original_budget_cents: 0,
  })

  // Fetch projects and managers
  const fetchData = async () => {
    setIsLoading(true)
    setFetchError(null)
    
    try {
      const [projectsResult, managersResult] = await Promise.all([
        getProjects(),
        getProjectManagers()
      ])
      
      if (projectsResult?.success && Array.isArray(projectsResult.projects)) {
        setProjects(projectsResult.projects as unknown as Project[])
      } else {
        setFetchError(projectsResult?.error || 'Unable to load projects.')
        setProjects([])
      }
      
      if (managersResult?.success && Array.isArray(managersResult.managers)) {
        setManagers(managersResult.managers)
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load data')
      setProjects([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return safeArray(projects).filter((project) => {
      const name = project?.name?.toLowerCase() || ''
      const projectNumber = project?.project_number?.toLowerCase() || ''
      const city = project?.city?.toLowerCase() || ''
      const query = searchQuery.toLowerCase()
      
      const matchesSearch = !searchQuery || 
        name.includes(query) || projectNumber.includes(query) || city.includes(query)
      
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'active' && project?.is_active) ||
        (statusFilter === 'inactive' && !project?.is_active)
      
      return matchesSearch && matchesStatus
    })
  }, [projects, searchQuery, statusFilter])

  // Open the create modal and auto-generate the next project number.
  const openCreateModal = async () => {
    setCreateError(null)
    setNumberManuallyEdited(false)
    setNewProject({
      name: '', project_number: '', address_line1: '', city: '', province: 'ON',
      description: '', start_date: '', estimated_completion_date: '', original_budget_cents: 0,
    })
    setIsCreateModalOpen(true)
    setIsGeneratingNumber(true)
    try {
      const result = await getNextProjectNumber()
      if (result?.success && result.projectNumber) {
        setNewProject((prev) => ({ ...prev, project_number: result.projectNumber }))
      }
    } catch (err) {
      console.error('Failed to generate project number:', err)
    } finally {
      setIsGeneratingNumber(false)
    }
  }

  // Regenerate the suggested number (e.g. after an admin edited it).
  const handleRegenerateNumber = async () => {
    setIsGeneratingNumber(true)
    try {
      const result = await getNextProjectNumber()
      if (result?.success && result.projectNumber) {
        setNewProject((prev) => ({ ...prev, project_number: result.projectNumber }))
        setNumberManuallyEdited(false)
      }
    } catch (err) {
      console.error('Failed to regenerate project number:', err)
    } finally {
      setIsGeneratingNumber(false)
    }
  }

  // Create project
  const handleCreateProject = async () => {
    setIsCreating(true)
    setCreateError(null)

    // Client-side format guard (server re-validates authoritatively).
    if (newProject.project_number && !isValidProjectNumber(newProject.project_number)) {
      setCreateError('Project number must use the format PRJ-YYYY-### (e.g. PRJ-2026-001).')
      setIsCreating(false)
      return
    }
    try {
      const result = await createProject({
        name: newProject.name,
        project_number: newProject.project_number,
        address_line1: newProject.address_line1 || undefined,
        city: newProject.city || undefined,
        province: newProject.province || undefined,
        description: newProject.description || undefined,
        start_date: newProject.start_date || undefined,
        estimated_completion_date: newProject.estimated_completion_date || undefined,
        original_budget_cents: newProject.original_budget_cents,
      })

      if (result?.success) {
        setIsCreateModalOpen(false)
        setNewProject({
          name: '', project_number: '', address_line1: '', city: '', province: 'ON',
          description: '', start_date: '', estimated_completion_date: '', original_budget_cents: 0,
        })
        fetchData()
      } else {
        setCreateError(result?.error || 'Failed to create project.')
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setIsCreating(false)
    }
  }

  // Update project
  const handleUpdateProject = async () => {
    if (!editingProject) return
    setIsUpdating(true)
    setUpdateError(null)

    const numberChanged = editingProject.project_number !== originalNumber

    // Client-side format guard when the number changed.
    if (numberChanged && !isValidProjectNumber(editingProject.project_number)) {
      setUpdateError('Project number must use the format PRJ-YYYY-### (e.g. PRJ-2026-001).')
      setIsUpdating(false)
      return
    }

    try {
      const result = await updateProject(
        editingProject.id,
        {
          name: editingProject.name,
          project_number: editingProject.project_number,
          address_line1: editingProject.address_line1,
          city: editingProject.city,
          province: editingProject.province,
          description: editingProject.description,
          start_date: editingProject.start_date || null,
          estimated_completion_date: editingProject.estimated_completion_date || null,
          actual_completion_date: editingProject.actual_completion_date || null,
          substantial_performance_date: editingProject.substantial_performance_date || null,
          original_budget_cents: editingProject.original_budget_cents,
          current_budget_cents: editingProject.current_budget_cents,
          is_active: editingProject.is_active,
        },
        numberChanged
          ? { confirmNumberChange: Boolean(numberChangeConfirm), reason: numberChangeReason || undefined }
          : undefined
      )

      if (result?.success) {
        setIsEditModalOpen(false)
        setEditingProject(null)
        setNumberChangeConfirm(null)
        setNumberChangeReason('')
        fetchData()
      } else if ((result as { requiresConfirmation?: boolean })?.requiresConfirmation) {
        // Surface the confirmation prompt instead of an error.
        setNumberChangeConfirm({ usageCount: (result as { usageCount?: number }).usageCount || 0 })
        setUpdateError(null)
      } else {
        setUpdateError(result?.error || 'Failed to update project.')
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to update project')
    } finally {
      setIsUpdating(false)
    }
  }

  // Assign PM
  const handleAssignPM = async () => {
    if (!assigningProject || !selectedManagerId) return
    setIsAssigning(true)
    
    try {
      const result = await assignProjectManager(assigningProject.id, selectedManagerId)
      if (result?.success) {
        setSelectedManagerId('')
        fetchData()
      }
    } catch (err) {
      console.error('Failed to assign PM:', err)
    } finally {
      setIsAssigning(false)
    }
  }

  // Remove PM assignment
  const handleRemoveAssignment = async (assignmentId: string) => {
    try {
      await removeProjectAssignment(assignmentId)
      fetchData()
    } catch (err) {
      console.error('Failed to remove assignment:', err)
    }
  }

  // Toggle project active status (one-click activate / deactivate)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const handleToggleActive = async (project: Project) => {
    setTogglingId(project.id)
    try {
      const result = project.is_active
        ? await archiveProject(project.id)
        : await restoreProject(project.id)
      if (result?.success) {
        fetchData()
      }
    } catch (err) {
      console.error('Failed to toggle project status:', err)
    } finally {
      setTogglingId(null)
    }
  }

  // Open edit modal
  const openEditModal = (project: Project) => {
    setEditingProject({ ...project })
    setOriginalNumber(project.project_number)
    setNumberChangeConfirm(null)
    setNumberChangeReason('')
    setUpdateError(null)
    setIsEditModalOpen(true)
  }

  // Open assign modal
  const openAssignModal = (project: Project) => {
    setAssigningProject(project)
    setSelectedManagerId('')
    setIsAssignModalOpen(true)
  }

  const totalCount = safeCount(projects)
  const filteredCount = safeCount(filteredProjects)
  const activeCount = safeArray(projects).filter(p => p?.is_active).length

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Projects" />
      <RoleTabBar role="admin" />
      <div className="p-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage construction projects and assignments</p>
        </div>
        <Button onClick={openCreateModal} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Button>
      </div>

      {fetchError && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertCircle className="h-5 w-5" />
              <span>{fetchError}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Showing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-0" style={{ minWidth: '180px' }}>
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 shrink-0">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Projects table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredCount === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {totalCount === 0 ? 'No projects found' : 'No projects match your filters'}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Assigned PMs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.map((project) => (
                  <TableRow 
                    key={project.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/admin/projects/${project.id}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">{project.project_number}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {project.city ? `${project.city}, ${project.province || ''}` : '-'}
                    </TableCell>
                    <TableCell>
                      ${((project.original_budget_cents || 0) / 100).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {safeArray(project.project_assignments).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {safeArray(project.project_assignments).map((a) => (
                            <Badge key={a.id} variant="outline" className="text-xs">
                              {a.users?.first_name} {a.users?.last_name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={project.is_active ? 'default' : 'secondary'}>
                        {project.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/projects/${project.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={(e) => {
                            e.stopPropagation()
                            openAssignModal(project)
                          }}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          disabled={togglingId === project.id}
                          title={project.is_active ? 'Deactivate project' : 'Activate project'}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleActive(project)
                          }}
                        >
                          {project.is_active
                            ? <PowerOff className="h-4 w-4 text-muted-foreground" />
                            : <Power className="h-4 w-4 text-primary" />}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditModal(project)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>Add a new construction project. Required fields are marked with *.</DialogDescription>
          </DialogHeader>
          
          {createError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">{createError}</div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Project Name *</Label>
              <Input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Project Number *</Label>
                {canOverrideNumber && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleRegenerateNumber}
                    disabled={isGeneratingNumber}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${isGeneratingNumber ? 'animate-spin' : ''}`} />
                    Regenerate
                  </Button>
                )}
              </div>
              <Input
                value={isGeneratingNumber && !newProject.project_number ? 'Generating…' : newProject.project_number}
                onChange={(e) => {
                  setNumberManuallyEdited(true)
                  setNewProject({ ...newProject, project_number: e.target.value })
                }}
                placeholder="PRJ-2026-001"
                readOnly={!canOverrideNumber || isGeneratingNumber}
                className={!canOverrideNumber ? 'bg-muted' : undefined}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {canOverrideNumber
                  ? numberManuallyEdited
                    ? 'Manual override. Must be unique and use the format PRJ-YYYY-###.'
                    : 'Auto-generated. Admins may edit if required.'
                  : 'Auto-generated by the system.'}
              </p>
            </div>
            <div>
              <Label>City</Label>
              <Input value={newProject.city} onChange={(e) => setNewProject({ ...newProject, city: e.target.value })} />
            </div>
            <div>
              <Label>Province</Label>
              <Select value={newProject.province} onValueChange={(v) => setNewProject({ ...newProject, province: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVINCES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={newProject.start_date} onChange={(e) => setNewProject({ ...newProject, start_date: e.target.value })} />
            </div>
            <div>
              <Label>Est. Completion</Label>
              <Input type="date" value={newProject.estimated_completion_date} onChange={(e) => setNewProject({ ...newProject, estimated_completion_date: e.target.value })} />
            </div>
            <div>
              <Label>Budget ($)</Label>
              <Input type="number" value={newProject.original_budget_cents / 100 || ''} onChange={(e) => setNewProject({ ...newProject, original_budget_cents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={newProject.address_line1} onChange={(e) => setNewProject({ ...newProject, address_line1: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} rows={3} />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateProject} disabled={isCreating || !newProject.name || !newProject.project_number}>
              {isCreating ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update project details, dates, and budget information.</DialogDescription>
          </DialogHeader>
          
          {updateError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">{updateError}</div>
          )}
          
          {editingProject && (
            <Tabs defaultValue="details">
              <TabsList className="mb-4">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="dates">Dates</TabsTrigger>
                <TabsTrigger value="budget">Budget</TabsTrigger>
              </TabsList>
              
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Project Name *</Label>
                    <Input value={editingProject.name} onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Project Number *</Label>
                    <Input
                      value={editingProject.project_number}
                      onChange={(e) => {
                        setEditingProject({ ...editingProject, project_number: e.target.value })
                        // Re-arm confirmation whenever the value changes.
                        setNumberChangeConfirm(null)
                      }}
                      readOnly={!canOverrideNumber}
                      className={!canOverrideNumber ? 'bg-muted' : undefined}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {canOverrideNumber
                        ? 'Locked after creation. Changing it on an in-use project requires confirmation and is audit-logged.'
                        : 'Project number is read-only.'}
                    </p>
                    {numberChangeConfirm && (
                      <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
                        <div className="flex items-start gap-2 text-amber-800 text-sm">
                          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            {`This project has ${numberChangeConfirm.usageCount} related record(s). Confirm the change and provide a reason for the audit log.`}
                          </span>
                        </div>
                        <Input
                          value={numberChangeReason}
                          onChange={(e) => setNumberChangeReason(e.target.value)}
                          placeholder="Reason for changing the project number"
                          className="bg-background"
                        />
                        <p className="text-xs text-amber-700">
                          {`Click "Save Changes" again to confirm. Old number "${originalNumber}" will be preserved in the audit log.`}
                        </p>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Address</Label>
                    <Input value={editingProject.address_line1 || ''} onChange={(e) => setEditingProject({ ...editingProject, address_line1: e.target.value })} />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input value={editingProject.city || ''} onChange={(e) => setEditingProject({ ...editingProject, city: e.target.value })} />
                  </div>
                  <div>
                    <Label>Province</Label>
                    <Select value={editingProject.province || 'ON'} onValueChange={(v) => setEditingProject({ ...editingProject, province: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROVINCES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={editingProject.is_active ? 'active' : 'inactive'} onValueChange={(v) => setEditingProject({ ...editingProject, is_active: v === 'active' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Description</Label>
                    <Textarea value={editingProject.description || ''} onChange={(e) => setEditingProject({ ...editingProject, description: e.target.value })} rows={3} />
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="dates" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start Date</Label>
                    <Input type="date" value={editingProject.start_date || ''} onChange={(e) => setEditingProject({ ...editingProject, start_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Estimated Completion</Label>
                    <Input type="date" value={editingProject.estimated_completion_date || ''} onChange={(e) => setEditingProject({ ...editingProject, estimated_completion_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Actual Completion</Label>
                    <Input type="date" value={editingProject.actual_completion_date || ''} onChange={(e) => setEditingProject({ ...editingProject, actual_completion_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Substantial Performance Date</Label>
                    <Input type="date" value={editingProject.substantial_performance_date || ''} onChange={(e) => setEditingProject({ ...editingProject, substantial_performance_date: e.target.value })} />
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="budget" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Original Budget ($)</Label>
                    <Input type="number" value={(editingProject.original_budget_cents || 0) / 100} onChange={(e) => setEditingProject({ ...editingProject, original_budget_cents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
                  </div>
                  <div>
                    <Label>Current Budget ($)</Label>
                    <Input type="number" value={(editingProject.current_budget_cents || 0) / 100} onChange={(e) => setEditingProject({ ...editingProject, current_budget_cents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
                  </div>
                  <div>
                    <Label>Spent ($)</Label>
                    <Input type="number" value={(editingProject.spent_cents || 0) / 100} disabled className="bg-muted" />
                  </div>
                  <div>
                    <Label>Committed ($)</Label>
                    <Input type="number" value={(editingProject.committed_cents || 0) / 100} disabled className="bg-muted" />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateProject} disabled={isUpdating}>
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign PM Modal */}
      <Dialog open={isAssignModalOpen} onOpenChange={setIsAssignModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Project Manager</DialogTitle>
            <DialogDescription>
              Assign project managers to {assigningProject?.name}
            </DialogDescription>
          </DialogHeader>
          
          {assigningProject && (
            <div className="space-y-4">
              {/* Current assignments */}
              {safeArray(assigningProject.project_assignments).length > 0 && (
                <div>
                  <Label className="mb-2 block">Current Assignments</Label>
                  <div className="space-y-2">
                    {safeArray(assigningProject.project_assignments).map((a) => (
                      <div key={a.id} className="flex items-center justify-between p-2 bg-muted rounded">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span>{a.users?.first_name} {a.users?.last_name}</span>
                          <Badge variant="outline" className="text-xs">{a.users?.role}</Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveAssignment(a.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Add new assignment */}
              <div>
                <Label className="mb-2 block">Add Project Manager</Label>
                <div className="flex gap-2">
                  <Select value={selectedManagerId} onValueChange={setSelectedManagerId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {managers.filter(m => 
                        !safeArray(assigningProject.project_assignments).some(a => a.user_id === m.id)
                      ).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.first_name} {m.last_name} ({m.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAssignPM} disabled={!selectedManagerId || isAssigning}>
                    {isAssigning ? 'Assigning...' : 'Assign'}
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}
