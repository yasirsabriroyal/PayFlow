'use client'

// Team Management Page - Admin Control Center
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Users,
  UserPlus,
  Plus,
  Shield,
  ClipboardCheck,
  Calculator,
  Mail,
  MoreHorizontal,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  UserX,
  RefreshCw,
  ArrowLeft,
  Loader2,
  Filter,
  Eye,
  EyeOff,
  Copy,
  KeyRound,
  Building2,
  X,
  UserCog,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { createTeamMember, updateTeamMemberRole, deactivateTeamMember, resetTeamMemberPassword, updateTeamMember } from './actions'
import { Pencil } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { MobileNav } from '@/components/layout/mobile-nav'
import { DataCard, DataCardHeader } from '@/components/ui/responsive-table'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { RoleTabBar } from '@/components/role-tab-bar'
import { AppHeader } from '@/components/app-header'

type UserRole = 'admin' | 'project_manager' | 'accountant'

interface TeamMember {
  id: string
  auth_user_id: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  is_active: boolean
  last_login_at: string | null
  created_at: string
  phone?: string
  notification_email?: string
  notification_phone?: string
  approval_limit_cents?: number
  email_notifications_enabled?: boolean
  whatsapp_notifications_enabled?: boolean
}

interface TeamInvitation {
  id: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  status: 'pending' | 'accepted' | 'expired' | 'cancelled'
  expires_at: string
  created_at: string
}

const roleConfig: Record<UserRole, { label: string; icon: typeof Shield; color: string }> = {
  admin: { label: 'Administrator', icon: Shield, color: 'bg-primary/10 text-primary' },
  project_manager: { label: 'Project Manager', icon: ClipboardCheck, color: 'bg-accent/10 text-accent' },
  accountant: { label: 'Accountant', icon: Calculator, color: 'bg-success/10 text-success' },
}

export default function TeamManagementPage() {
  const { toast } = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<TeamInvitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/admin/team')
  const [searchQuery, setSearchQuery] = useState(initialState?.search || '')
  const [roleFilter, setRoleFilter] = useState<string>(initialState?.filters?.role as string || 'all')
  
  // Save state when search or filter changes
  useEffect(() => {
    save({ search: searchQuery, filters: { role: roleFilter } })
  }, [searchQuery, roleFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Form state
  const [newMember, setNewMember] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'project_manager' as UserRole,
    temporaryPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)
  
  // Edit member state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<UserRole>('project_manager')
  
  // Reset password state
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false)
  const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null)
  const [newPassword, setNewPassword] = useState('')
  
  // Edit user info state
  const [isEditInfoModalOpen, setIsEditInfoModalOpen] = useState(false)
  const [editInfoMember, setEditInfoMember] = useState<TeamMember | null>(null)
  const [editInfo, setEditInfo] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    notification_email: '',
    notification_phone: '',
    approval_limit_cents: 0,
    email_notifications_enabled: true,
    whatsapp_notifications_enabled: false,
  })

  // Load team members from database
  useEffect(() => {
    const loadTeamMembers = async () => {
      const supabase = createClient()
      
      // Fetch internal users (exclude vendors)
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .in('role', ['admin', 'project_manager', 'accountant'])
        .order('created_at', { ascending: false })
      
      if (!error && users && users.length > 0) {
        setTeamMembers(users as TeamMember[])
      }

      // Fetch pending invitations
      const { data: invites } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      
if (invites && invites.length > 0) {
        setInvitations(invites as TeamInvitation[])
      }
      
      setIsLoading(false)
      }
  
    loadTeamMembers()
  }, [])

  const filteredMembers = teamMembers.filter(member => {
    const matchesSearch = 
      `${member.first_name} ${member.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = roleFilter === 'all' || member.role === roleFilter
    return matchesSearch && matchesRole
  })

  const handleAddMember = async () => {
    if (!newMember.email || !newMember.firstName || !newMember.lastName || !newMember.temporaryPassword) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields including the temporary password.',
        variant: 'destructive',
      })
      return
    }

    if (newMember.temporaryPassword.length < 8) {
      toast({
        title: 'Password Too Short',
        description: 'Temporary password must be at least 8 characters.',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Use Supabase Admin API via server action to create user with password
      const result = await createTeamMember({
        email: newMember.email,
        firstName: newMember.firstName,
        lastName: newMember.lastName,
        role: newMember.role,
        temporaryPassword: newMember.temporaryPassword,
      })

      if (!result.success) {
        toast({
          title: 'User Creation Failed',
          description: result.error || 'Failed to create team member.',
          variant: 'destructive',
        })
        return
      }

      // Add to local team members list
      const newTeamMember: TeamMember = {
        id: result.data?.user?.id || crypto.randomUUID(),
        auth_user_id: result.data?.user?.id || '',
        email: newMember.email,
        first_name: newMember.firstName,
        last_name: newMember.lastName,
        role: newMember.role,
        is_active: true,
        last_login_at: null,
        created_at: new Date().toISOString(),
      }
      setTeamMembers(prev => [newTeamMember, ...prev])

      // Store credentials for display
      setCreatedCredentials({
        email: newMember.email,
        password: newMember.temporaryPassword,
      })

      toast({
        title: 'Team Member Created',
        description: `Account created for ${newMember.firstName} ${newMember.lastName}. Share the credentials securely.`,
      })

      // Reset form but keep modal open to show credentials
      setNewMember({ firstName: '', lastName: '', email: '', role: 'project_manager', temporaryPassword: '' })
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to send invitation. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeactivateMember = async (member: TeamMember) => {
    setIsSubmitting(true)
    try {
      const result = await deactivateTeamMember({ userId: member.auth_user_id })
      if (result.success) {
        setTeamMembers(prev => 
          prev.map(m => m.id === member.id ? { ...m, is_active: false } : m)
        )
        toast({
          title: 'Member Deactivated',
          description: 'The team member has been deactivated.',
        })
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to deactivate member.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to deactivate member.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditRole = (member: TeamMember) => {
    setEditingMember(member)
    setEditRole(member.role)
    setIsEditModalOpen(true)
  }

  const handleUpdateRole = async () => {
    if (!editingMember) return
    
    setIsSubmitting(true)
    try {
      const result = await updateTeamMemberRole({ userId: editingMember.auth_user_id, newRole: editRole })
      if (result.success) {
        setTeamMembers(prev => 
          prev.map(m => m.id === editingMember.id ? { ...m, role: editRole } : m)
        )
        toast({
          title: 'Role Updated',
          description: `${editingMember.first_name}'s role has been updated to ${roleConfig[editRole].label}.`,
        })
        setIsEditModalOpen(false)
        setEditingMember(null)
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to update role.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to update role.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResetPassword = (member: TeamMember) => {
    setResetPasswordMember(member)
    setNewPassword('')
    setIsResetPasswordModalOpen(true)
  }

  const handleSubmitResetPassword = async () => {
    if (!resetPasswordMember || !newPassword) return
    
    if (newPassword.length < 8) {
      toast({
        title: 'Password Too Short',
        description: 'Password must be at least 8 characters.',
        variant: 'destructive',
      })
      return
    }
    
    setIsSubmitting(true)
    try {
      const result = await resetTeamMemberPassword({ userId: resetPasswordMember.auth_user_id, newPassword })
      if (result.success) {
        toast({
          title: 'Password Reset',
          description: `Password has been reset for ${resetPasswordMember.first_name}. Share the new password securely.`,
        })
        setIsResetPasswordModalOpen(false)
        setResetPasswordMember(null)
        setNewPassword('')
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to reset password.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to reset password.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditInfo = (member: TeamMember) => {
    setEditInfoMember(member)
    setEditInfo({
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      email: member.email || '',
      phone: member.phone || '',
      notification_email: member.notification_email || '',
      notification_phone: member.notification_phone || '',
      approval_limit_cents: member.approval_limit_cents || 0,
      email_notifications_enabled: member.email_notifications_enabled ?? true,
      whatsapp_notifications_enabled: member.whatsapp_notifications_enabled ?? false,
    })
    setIsEditInfoModalOpen(true)
  }

  const handleUpdateInfo = async () => {
    if (!editInfoMember) return
    
    setIsSubmitting(true)
    try {
      const result = await updateTeamMember({
        userId: editInfoMember.auth_user_id,
        first_name: editInfo.first_name,
        last_name: editInfo.last_name,
        email: editInfo.email,
        phone: editInfo.phone || undefined,
        notification_email: editInfo.notification_email || undefined,
        notification_phone: editInfo.notification_phone || undefined,
        approval_limit_cents: editInfo.approval_limit_cents || undefined,
        email_notifications_enabled: editInfo.email_notifications_enabled,
        whatsapp_notifications_enabled: editInfo.whatsapp_notifications_enabled,
      })
      
      if (result.success) {
        setTeamMembers(prev => 
          prev.map(m => m.id === editInfoMember.id ? { 
            ...m, 
            ...editInfo,
          } : m)
        )
        toast({
          title: 'User Updated',
          description: `${editInfo.first_name} ${editInfo.last_name}'s information has been updated.`,
        })
        setIsEditInfoModalOpen(false)
        setEditInfoMember(null)
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to update user.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to update user information.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelInvitation = async (invitationId: string) => {
    const supabase = createClient()
    
    await supabase
      .from('team_invitations')
      .update({ status: 'cancelled' })
      .eq('id', invitationId)

    setInvitations(prev => prev.filter(i => i.id !== invitationId))
    toast({
      title: 'Invitation Cancelled',
      description: 'The invitation has been cancelled.',
    })
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatLastLogin = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const diff = Date.now() - new Date(dateString).getTime()
    const hours = Math.floor(diff / 3600000)
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return formatDate(dateString)
  }

  const stats = {
    total: teamMembers.length,
    active: teamMembers.filter(m => m.is_active).length,
    admins: teamMembers.filter(m => m.role === 'admin').length,
    pending: invitations.filter(i => i.status === 'pending').length,
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Team" />
      <RoleTabBar role="admin" />
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-semibold text-sm">Team</span>
          </div>
          <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden md:block border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/admin/dashboard">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary-foreground" />
                </div>
              </Link>
              <span className="font-semibold">PayFlow AP</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">Team Management</span>
            </div>
            <Button onClick={() => setIsAddModalOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Add Team Member
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-20 md:pb-8">
        <div className="space-y-4 md:space-y-6">
          {/* Page Header - Desktop */}
          <div className="hidden md:block">
            <h1 className="text-3xl font-semibold tracking-tight">Team Management</h1>
            <p className="text-muted-foreground mt-1">
              Manage internal users, roles, and access permissions.
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-card border border-border rounded-xl p-3 md:p-5">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">{stats.total}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Total Members</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 md:p-5">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-success/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-success" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">{stats.active}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Active</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 md:p-5">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 md:w-5 md:h-5 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">{stats.admins}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Admins</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 md:p-5">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-warning/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 md:w-5 md:h-5 text-warning" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-semibold">{stats.pending}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Pending</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Invitations */}
          {invitations.length > 0 && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4 text-warning" />
                Pending Invitations ({invitations.length})
              </h3>
              <div className="space-y-2">
                {invitations.map((invite) => {
                  const RoleIcon = roleConfig[invite.role].icon
                  return (
                    <div 
                      key={invite.id}
                      className="flex items-center justify-between p-3 bg-card border border-border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{invite.first_name} {invite.last_name}</p>
                          <p className="text-xs text-muted-foreground">{invite.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={roleConfig[invite.role].color}>
                          <RoleIcon className="w-3 h-3 mr-1" />
                          {roleConfig[invite.role].label}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelInvitation(invite.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search team members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 touch-manipulation"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-11 touch-manipulation md:w-[180px]">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Administrators</SelectItem>
                <SelectItem value="project_manager">Project Managers</SelectItem>
                <SelectItem value="accountant">Accountants</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {filteredMembers.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">No team members found</p>
              </div>
            ) : (
              filteredMembers.map((member) => {
                const RoleIcon = roleConfig[member.role].icon
                return (
                  <DataCard key={member.id} className="touch-manipulation">
                    <DataCardHeader
                      title={`${member.first_name} ${member.last_name}`}
                      subtitle={member.email}
                      badge={
                        <Badge variant="outline" className={`${roleConfig[member.role].color} text-xs`}>
                          <RoleIcon className="w-3 h-3 mr-1" />
                          {roleConfig[member.role].label}
                        </Badge>
                      }
                      actions={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditInfo(member)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              Edit Info
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEditRole(member)}>
                              <UserCog className="w-4 h-4 mr-2" />
                              Edit Role
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResetPassword(member)}>
                              <KeyRound className="w-4 h-4 mr-2" />
                              Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => handleDeactivateMember(member)}
                              disabled={!member.is_active}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Deactivate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${member.is_active ? 'bg-success' : 'bg-muted-foreground'}`} />
                        <span className="text-muted-foreground">
                          {member.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        Last login: {formatLastLogin(member.last_login_at)}
                      </span>
                    </div>
                  </DataCard>
                )
              })
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Member</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Role</th>
                    <th className="text-center px-6 py-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Last Login</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Joined</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredMembers.map((member) => {
                    const RoleIcon = roleConfig[member.role].icon
                    return (
                      <tr key={member.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                              <span className="font-medium text-primary">
                                {member.first_name[0]}{member.last_name[0]}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium">{member.first_name} {member.last_name}</p>
                              <p className="text-sm text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className={roleConfig[member.role].color}>
                            <RoleIcon className="w-3 h-3 mr-1" />
                            {roleConfig[member.role].label}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                            member.is_active 
                              ? 'bg-success/10 text-success' 
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${member.is_active ? 'bg-success' : 'bg-muted-foreground'}`} />
                            {member.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {formatLastLogin(member.last_login_at)}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {formatDate(member.created_at)}
                        </td>
                        <td className="px-6 py-4">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditInfo(member)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                Edit Info
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEditRole(member)}>
                                <UserCog className="w-4 h-4 mr-2" />
                                Edit Role
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleResetPassword(member)}>
                                <KeyRound className="w-4 h-4 mr-2" />
                                Reset Password
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => handleDeactivateMember(member)}
                                disabled={!member.is_active}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Deactivate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {filteredMembers.length === 0 && (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">No team members found</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Add Team Member Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={(open) => {
        setIsAddModalOpen(open)
        if (!open) {
          setCreatedCredentials(null)
          setShowPassword(false)
        }
      }}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Create a new internal user account with a temporary password
            </DialogDescription>
          </DialogHeader>

          {createdCredentials ? (
            // Show created credentials for admin to share
            <div className="space-y-4 py-4">
              <div className="p-4 bg-success/10 border border-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-success mb-3">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Account Created Successfully</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Share these credentials securely with the new team member. They should change their password after first login.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-background rounded-md border">
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="font-mono text-sm">{createdCredentials.email}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(createdCredentials.email)
                        toast({ title: 'Email copied to clipboard' })
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-background rounded-md border">
                    <div>
                      <p className="text-xs text-muted-foreground">Temporary Password</p>
                      <p className="font-mono text-sm">
                        {showPassword ? createdCredentials.password : '••••••••••'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(createdCredentials.password)
                          toast({ title: 'Password copied to clipboard' })
                        }}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => {
                  setCreatedCredentials(null)
                  setIsAddModalOpen(false)
                }}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            // Show creation form
            <>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={newMember.firstName}
                      onChange={(e) => setNewMember(prev => ({ ...prev, firstName: e.target.value }))}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={newMember.lastName}
                      onChange={(e) => setNewMember(prev => ({ ...prev, lastName: e.target.value }))}
                      className="h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newMember.email}
                    onChange={(e) => setNewMember(prev => ({ ...prev, email: e.target.value }))}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select 
                    value={newMember.role} 
                    onValueChange={(value) => setNewMember(prev => ({ ...prev, role: value as UserRole }))}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-primary" />
                          Administrator
                        </div>
                      </SelectItem>
                      <SelectItem value="project_manager">
                        <div className="flex items-center gap-2">
                          <ClipboardCheck className="w-4 h-4 text-accent" />
                          Project Manager
                        </div>
                      </SelectItem>
                      <SelectItem value="accountant">
                        <div className="flex items-center gap-2">
                          <Calculator className="w-4 h-4 text-success" />
                          Accountant
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="temporaryPassword">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4" />
                      Temporary Password
                    </div>
                  </Label>
                  <div className="relative">
                    <Input
                      id="temporaryPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={newMember.temporaryPassword}
                      onChange={(e) => setNewMember(prev => ({ ...prev, temporaryPassword: e.target.value }))}
                      placeholder="Min 8 characters"
                      className="h-11 pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The employee will use this password for their first login
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddMember} disabled={isSubmitting} className="gap-2">
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  Create Account
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Role Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Team Member Role</DialogTitle>
            <DialogDescription>
              Change the role for {editingMember?.first_name} {editingMember?.last_name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Label htmlFor="editRole">New Role</Label>
            <Select value={editRole} onValueChange={(value) => setEditRole(value as UserRole)}>
              <SelectTrigger className="h-11 mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Administrator
                  </div>
                </SelectItem>
                <SelectItem value="project_manager">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-accent" />
                    Project Manager
                  </div>
                </SelectItem>
                <SelectItem value="accountant">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-success" />
                    Accountant
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRole} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Update Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog open={isResetPasswordModalOpen} onOpenChange={setIsResetPasswordModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new temporary password for {resetPasswordMember?.first_name} {resetPasswordMember?.last_name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Temporary Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="h-11 pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The employee should change this password after their next login
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetPasswordModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitResetPassword} disabled={isSubmitting || newPassword.length < 8}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Info Modal */}
      <Dialog open={isEditInfoModalOpen} onOpenChange={setIsEditInfoModalOpen}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User Information</DialogTitle>
            <DialogDescription>
              Update profile and notification settings for {editInfoMember?.first_name} {editInfoMember?.last_name}
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="contact">Contact</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            
            <TabsContent value="profile" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_first_name">First Name</Label>
                  <Input
                    id="edit_first_name"
                    value={editInfo.first_name}
                    onChange={(e) => setEditInfo({ ...editInfo, first_name: e.target.value })}
                    placeholder="First name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_last_name">Last Name</Label>
                  <Input
                    id="edit_last_name"
                    value={editInfo.last_name}
                    onChange={(e) => setEditInfo({ ...editInfo, last_name: e.target.value })}
                    placeholder="Last name"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_email">Email Address</Label>
                <Input
                  id="edit_email"
                  type="email"
                  value={editInfo.email}
                  onChange={(e) => setEditInfo({ ...editInfo, email: e.target.value })}
                  placeholder="email@company.com"
                />
                <p className="text-xs text-muted-foreground">
                  This is the login email. Changing it will update the authentication email.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_phone">Phone Number</Label>
                <Input
                  id="edit_phone"
                  type="tel"
                  value={editInfo.phone}
                  onChange={(e) => setEditInfo({ ...editInfo, phone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </TabsContent>
            
            <TabsContent value="contact" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="edit_notification_email">Notification Email</Label>
                <Input
                  id="edit_notification_email"
                  type="email"
                  value={editInfo.notification_email}
                  onChange={(e) => setEditInfo({ ...editInfo, notification_email: e.target.value })}
                  placeholder="Same as login email if empty"
                />
                <p className="text-xs text-muted-foreground">
                  Where to send system notifications. Leave empty to use login email.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_notification_phone">Notification Phone (WhatsApp)</Label>
                <Input
                  id="edit_notification_phone"
                  type="tel"
                  value={editInfo.notification_phone}
                  onChange={(e) => setEditInfo({ ...editInfo, notification_phone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                />
                <p className="text-xs text-muted-foreground">
                  Phone number for WhatsApp notifications if enabled.
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="settings" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="edit_approval_limit">Approval Limit ($)</Label>
                <Input
                  id="edit_approval_limit"
                  type="number"
                  value={editInfo.approval_limit_cents / 100}
                  onChange={(e) => setEditInfo({ ...editInfo, approval_limit_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum amount this user can approve. Set to 0 for no limit.
                </p>
              </div>
              <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div>
                  <p className="font-medium text-sm">Email Notifications</p>
                  <p className="text-xs text-muted-foreground">Receive notifications via email</p>
                </div>
                <Switch
                  checked={editInfo.email_notifications_enabled}
                  onCheckedChange={(checked) => setEditInfo({ ...editInfo, email_notifications_enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div>
                  <p className="font-medium text-sm">WhatsApp Notifications</p>
                  <p className="text-xs text-muted-foreground">Receive notifications via WhatsApp</p>
                </div>
                <Switch
                  checked={editInfo.whatsapp_notifications_enabled}
                  onCheckedChange={(checked) => setEditInfo({ ...editInfo, whatsapp_notifications_enabled: checked })}
                />
              </div>
            </TabsContent>
          </Tabs>
          
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setIsEditInfoModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateInfo} disabled={isSubmitting || !editInfo.first_name || !editInfo.last_name || !editInfo.email}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
