'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Shield,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Lock,
  Users,
} from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { PERMISSION_GROUPS } from '@/lib/permissions/constants'
import {
  createProjectRole,
  updateProjectRole,
  deleteProjectRole,
  setProjectRolePermissions,
} from './role-actions'

interface ManagedRole {
  id: string
  key: string
  label: string
  description: string | null
  is_system: boolean
  is_active: boolean
  permissions: string[]
  assignmentCount: number
}

export function ProjectRolesClient({ initialRoles }: { initialRoles: ManagedRole[] }) {
  const { toast } = useToast()
  const [roles, setRoles] = useState<ManagedRole[]>(initialRoles)
  const [expandedRole, setExpandedRole] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Working copy of the permission set being edited per role.
  const [draftPermissions, setDraftPermissions] = useState<Record<string, Set<string>>>({})

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newDescription, setNewDescription] = useState('')

  // Edit dialog state
  const [editRole, setEditRole] = useState<ManagedRole | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ManagedRole | null>(null)

  const refreshRole = (id: string, patch: Partial<ManagedRole>) => {
    setRoles((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const toggleExpand = (role: ManagedRole) => {
    if (expandedRole === role.id) {
      setExpandedRole(null)
      return
    }
    setExpandedRole(role.id)
    setDraftPermissions((prev) => ({ ...prev, [role.id]: new Set(role.permissions) }))
  }

  const togglePermission = (roleId: string, permission: string) => {
    setDraftPermissions((prev) => {
      const next = new Set(prev[roleId] ?? [])
      if (next.has(permission)) next.delete(permission)
      else next.add(permission)
      return { ...prev, [roleId]: next }
    })
  }

  const handleCreate = () => {
    if (!newLabel.trim()) return
    startTransition(async () => {
      const result = await createProjectRole({
        label: newLabel,
        description: newDescription,
      })
      if (result.success) {
        toast({ title: 'Role created', description: `"${newLabel}" was added.` })
        setRoles((prev) => [
          ...prev,
          {
            id: result.id as string,
            key: newLabel
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, ''),
            label: newLabel.trim(),
            description: newDescription.trim() || null,
            is_system: false,
            is_active: true,
            permissions: [],
            assignmentCount: 0,
          },
        ])
        setNewLabel('')
        setNewDescription('')
        setCreateOpen(false)
      } else {
        toast({ title: 'Could not create role', description: result.error, variant: 'destructive' })
      }
    })
  }

  const openEdit = (role: ManagedRole) => {
    setEditRole(role)
    setEditLabel(role.label)
    setEditDescription(role.description ?? '')
  }

  const handleEditSave = () => {
    if (!editRole) return
    startTransition(async () => {
      const result = await updateProjectRole(editRole.id, {
        label: editLabel,
        description: editDescription,
      })
      if (result.success) {
        refreshRole(editRole.id, {
          label: editLabel.trim(),
          description: editDescription.trim() || null,
        })
        toast({ title: 'Role updated' })
        setEditRole(null)
      } else {
        toast({ title: 'Update failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleToggleActive = (role: ManagedRole, value: boolean) => {
    startTransition(async () => {
      const result = await updateProjectRole(role.id, { is_active: value })
      if (result.success) {
        refreshRole(role.id, { is_active: value })
      } else {
        toast({ title: 'Update failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleSavePermissions = (role: ManagedRole) => {
    const perms = Array.from(draftPermissions[role.id] ?? [])
    startTransition(async () => {
      const result = await setProjectRolePermissions(role.id, perms)
      if (result.success) {
        refreshRole(role.id, { permissions: perms })
        toast({ title: 'Permissions saved', description: `Updated "${role.label}".` })
        setExpandedRole(null)
      } else {
        toast({ title: 'Save failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    const target = deleteTarget
    startTransition(async () => {
      const result = await deleteProjectRole(target.id)
      if (result.success) {
        setRoles((prev) => prev.filter((r) => r.id !== target.id))
        toast({ title: 'Role deleted' })
      } else {
        toast({ title: 'Delete failed', description: result.error, variant: 'destructive' })
      }
      setDeleteTarget(null)
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Project Roles" />
      <RoleTabBar role="admin" />

      {/* Header */}
      <div className="sticky top-0 z-40 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                href="/admin/dashboard"
                className="p-2 hover:bg-primary-foreground/10 rounded-lg transition-colors"
                aria-label="Back to dashboard"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Project Roles
                </h1>
                <p className="text-sm text-primary-foreground/80">
                  Define team roles and the permissions they grant on a project
                </p>
              </div>
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  New Role
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create project role</DialogTitle>
                  <DialogDescription>
                    Add a custom role that can be assigned to project team members.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="new-role-label">Role name</Label>
                    <Input
                      id="new-role-label"
                      placeholder="e.g. Quantity Surveyor"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="new-role-desc">Description (optional)</Label>
                    <Textarea
                      id="new-role-desc"
                      placeholder="What this role does on a project"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={isPending || !newLabel.trim()}>
                    {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col gap-4">
          {roles.map((role) => {
            const isExpanded = expandedRole === role.id
            const draft = draftPermissions[role.id] ?? new Set(role.permissions)
            return (
              <Card key={role.id} className={role.is_active ? '' : 'opacity-60'}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        {role.label}
                        {role.is_system && (
                          <Badge variant="secondary" className="gap-1">
                            <Lock className="w-3 h-3" />
                            System
                          </Badge>
                        )}
                        {!role.is_active && <Badge variant="outline">Inactive</Badge>}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {role.description || 'No description'}
                      </CardDescription>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5">{role.key}</code>
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {role.assignmentCount} assigned
                        </span>
                        <span>{role.permissions.length} permissions</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 mr-2">
                        <Switch
                          checked={role.is_active}
                          onCheckedChange={(v) => handleToggleActive(role, v)}
                          disabled={isPending || role.is_system}
                          aria-label="Active"
                        />
                        <span className="text-xs text-muted-foreground hidden sm:inline">Active</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openEdit(role)}>
                        <Pencil className="w-4 h-4" />
                        <span className="sr-only">Edit role</span>
                      </Button>
                      {!role.is_system && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(role)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="sr-only">Delete role</span>
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => toggleExpand(role)}>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <span className="ml-1">Permissions</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="border-t pt-4">
                    <div className="grid gap-6 sm:grid-cols-2">
                      {Object.entries(PERMISSION_GROUPS).map(([groupKey, group]) => (
                        <div key={groupKey} className="flex flex-col gap-3">
                          <h3 className="text-sm font-medium">{group.label}</h3>
                          <div className="flex flex-col gap-3">
                            {group.permissions.map((perm) => (
                              <label
                                key={perm.key}
                                htmlFor={`${role.id}-${perm.key}`}
                                className="flex items-start justify-between gap-3 cursor-pointer"
                              >
                                <span className="flex flex-col">
                                  <span className="text-sm">{perm.label}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {perm.description}
                                  </span>
                                </span>
                                <Switch
                                  id={`${role.id}-${perm.key}`}
                                  checked={draft.has(perm.key)}
                                  onCheckedChange={() => togglePermission(role.id, perm.key)}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                      <Button variant="outline" onClick={() => setExpandedRole(null)}>
                        Cancel
                      </Button>
                      <Button onClick={() => handleSavePermissions(role)} disabled={isPending}>
                        {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        Save permissions
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}

          {roles.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No project roles yet. Create one to get started.
            </div>
          )}
        </div>
      </div>

      {/* Edit role dialog */}
      <Dialog open={!!editRole} onOpenChange={(open) => !open && setEditRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit role</DialogTitle>
            <DialogDescription>Update the role name and description.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-role-label">Role name</Label>
              <Input
                id="edit-role-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-role-desc">Description</Label>
              <Textarea
                id="edit-role-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRole(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={isPending || !editLabel.trim()}>
              {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.label}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the role and its permission grants. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
