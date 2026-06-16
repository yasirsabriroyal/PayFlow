'use client'

import { useEffect, useState, useTransition } from 'react'
import { UserPlus, Users, Trash2, Loader2, Lock } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { useToast } from '@/hooks/use-toast'
import {
  getProjectTeam,
  getAssignableUsers,
  getProjectRolesCatalog,
  assignProjectMember,
  updateProjectMemberRole,
  removeProjectAssignment,
} from '../project-actions'

interface TeamMember {
  id: string
  user_id: string
  role: string
  project_role_id: string | null
  users: { id: string; first_name: string; last_name: string; email: string; role: string } | null
  project_roles: { id: string; key: string; label: string; is_system: boolean } | null
}

interface AssignableUser {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
}

interface RoleOption {
  id: string
  key: string
  label: string
  description: string | null
  is_system: boolean
  permissions: string[]
}

export function ProjectTeamSection({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  const [assignOpen, setAssignOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedRole, setSelectedRole] = useState('')

  const load = async () => {
    const [teamRes, usersRes, rolesRes] = await Promise.all([
      getProjectTeam(projectId),
      getAssignableUsers(),
      getProjectRolesCatalog(),
    ])
    if (teamRes.success) setTeam(teamRes.team as unknown as TeamMember[])
    if (usersRes.success) setUsers(usersRes.users as AssignableUser[])
    if (rolesRes.success) setRoles(rolesRes.roles as RoleOption[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleAssign = () => {
    if (!selectedUser || !selectedRole) return
    startTransition(async () => {
      const result = await assignProjectMember(projectId, selectedUser, selectedRole)
      if (result.success) {
        toast({ title: 'Member assigned' })
        setSelectedUser('')
        setSelectedRole('')
        setAssignOpen(false)
        await load()
      } else {
        toast({ title: 'Could not assign', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleChangeRole = (member: TeamMember, roleId: string) => {
    startTransition(async () => {
      const result = await updateProjectMemberRole(member.id, roleId)
      if (result.success) {
        toast({ title: 'Role updated' })
        await load()
      } else {
        toast({ title: 'Update failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  const handleRemove = (member: TeamMember) => {
    startTransition(async () => {
      const result = await removeProjectAssignment(member.id)
      if (result.success) {
        toast({ title: 'Member removed' })
        await load()
      } else {
        toast({ title: 'Remove failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  const roleLabel = (m: TeamMember) =>
    m.project_roles?.label ?? m.role ?? 'Unknown role'

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Project Team
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{team.length} members</span>
          <Button size="sm" className="gap-2" onClick={() => setAssignOpen(true)}>
            <UserPlus className="w-4 h-4" />
            Add Member
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : team.length === 0 ? (
        <div className="p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-muted-foreground">No team members assigned yet</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {team.map((member) => (
            <div key={member.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {member.users?.first_name} {member.users?.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">{member.users?.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Select
                  value={member.project_role_id ?? undefined}
                  onValueChange={(v) => handleChangeRole(member, v)}
                  disabled={isPending}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder={roleLabel(member)} />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {member.project_roles?.is_system && (
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="w-3 h-3" />
                    System
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(member)}
                  disabled={isPending}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="sr-only">Remove member</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-6 py-3 border-t border-border text-xs text-muted-foreground">
        Roles and their permissions are managed in{' '}
        <Link href="/admin/settings/project-roles" className="underline hover:text-foreground">
          Project Roles
        </Link>
        .
      </div>

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add team member</DialogTitle>
            <DialogDescription>
              Assign a staff member to this project under a specific role.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Team member</label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a person" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.first_name} {u.last_name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Project role</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={isPending || !selectedUser || !selectedRole}>
              {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
