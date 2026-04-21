'use client'

import { useState, useEffect, useMemo } from 'react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Search,
  Save,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Shield,
  Loader2,
  AlertTriangle,
  Check,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { 
  PERMISSION_GROUPS,
  ROLES,
  Permission,
  UserRole,
  PermissionsMatrix,
  PERMISSIONS,
  PROTECTED_ADMIN_PERMISSIONS,
} from '@/lib/permissions/constants'
import {
  fetchPermissionsMatrix,
  savePermissionsMatrix,
  resetPermissions,
} from './actions'

// Role display names
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  accountant: 'Accountant',
  contractor: 'Contractor',
}

// PROTECTED_ADMIN_PERMISSIONS imported from constants

export default function PermissionsMatrixPage() {
  const router = useRouter()
  const { toast } = useToast()
  
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(Object.keys(PERMISSION_GROUPS)))
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  
  // Original matrix from DB
  const [originalMatrix, setOriginalMatrix] = useState<PermissionsMatrix>({
    admin: [],
    project_manager: [],
    accountant: [],
    contractor: [],
  })
  
  // Current working matrix
  const [matrix, setMatrix] = useState<PermissionsMatrix>({
    admin: [],
    project_manager: [],
    accountant: [],
    contractor: [],
  })
  
  // Load permissions on mount
  useEffect(() => {
    const loadPermissions = async () => {
      setIsLoading(true)
      try {
        const data = await fetchPermissionsMatrix()
        setOriginalMatrix(data)
        setMatrix(data)
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Failed to load permissions',
          variant: 'destructive',
        })
      } finally {
        setIsLoading(false)
      }
    }
    
    loadPermissions()
  }, [toast])
  
  // Track unsaved changes - compare sorted arrays to handle different orderings
  useEffect(() => {
    const matrixesAreEqual = (a: PermissionsMatrix, b: PermissionsMatrix): boolean => {
      for (const role of Object.keys(a) as (keyof PermissionsMatrix)[]) {
        const sortedA = [...a[role]].sort()
        const sortedB = [...b[role]].sort()
        if (sortedA.length !== sortedB.length) return false
        if (sortedA.some((perm, i) => perm !== sortedB[i])) return false
      }
      return true
    }
    const changed = !matrixesAreEqual(matrix, originalMatrix)
    setHasUnsavedChanges(changed)
  }, [matrix, originalMatrix])
  
  // Filter permissions based on search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return PERMISSION_GROUPS
    }
    
    const query = searchQuery.toLowerCase()
    const filtered: typeof PERMISSION_GROUPS = {}
    
    for (const [groupKey, group] of Object.entries(PERMISSION_GROUPS)) {
      const matchingPermissions = group.permissions.filter(
        p => p.key.toLowerCase().includes(query) || 
             p.label.toLowerCase().includes(query) ||
             p.description.toLowerCase().includes(query)
      )
      
      if (matchingPermissions.length > 0 || group.label.toLowerCase().includes(query)) {
        filtered[groupKey] = {
          ...group,
          permissions: matchingPermissions.length > 0 ? matchingPermissions : group.permissions,
        }
      }
    }
    
    return filtered
  }, [searchQuery])
  
  // Toggle a permission for a role
  const togglePermission = (role: UserRole, permission: Permission) => {
    // Prevent removing protected permissions from admin
    if (role === 'admin' && PROTECTED_ADMIN_PERMISSIONS.includes(permission)) {
      toast({
        title: 'Protected Permission',
        description: 'This permission cannot be removed from Admin to prevent system lockout.',
        variant: 'destructive',
      })
      return
    }
    
    setMatrix(prev => {
      const rolePermissions = [...prev[role]]
      const index = rolePermissions.indexOf(permission)
      
      if (index >= 0) {
        rolePermissions.splice(index, 1)
      } else {
        rolePermissions.push(permission)
      }
      
      return {
        ...prev,
        [role]: rolePermissions,
      }
    })
  }
  
  // Toggle all permissions in a group for a role
  const toggleGroupForRole = (role: UserRole, groupKey: string, enable: boolean) => {
    const group = PERMISSION_GROUPS[groupKey]
    if (!group) return
    
    setMatrix(prev => {
      const rolePermissions = new Set(prev[role])
      
      for (const perm of group.permissions) {
        // Skip protected admin permissions
        if (role === 'admin' && PROTECTED_ADMIN_PERMISSIONS.includes(perm.key as Permission)) {
          continue
        }
        
        if (enable) {
          rolePermissions.add(perm.key as Permission)
        } else {
          rolePermissions.delete(perm.key as Permission)
        }
      }
      
      return {
        ...prev,
        [role]: Array.from(rolePermissions),
      }
    })
  }
  
  // Check if all permissions in a group are enabled for a role
  const isGroupFullyEnabled = (role: UserRole, groupKey: string): boolean => {
    const group = PERMISSION_GROUPS[groupKey]
    if (!group) return false
    return group.permissions.every(p => matrix[role].includes(p.key as Permission))
  }
  
  // Check if some permissions in a group are enabled for a role
  const isGroupPartiallyEnabled = (role: UserRole, groupKey: string): boolean => {
    const group = PERMISSION_GROUPS[groupKey]
    if (!group) return false
    const enabled = group.permissions.filter(p => matrix[role].includes(p.key as Permission))
    return enabled.length > 0 && enabled.length < group.permissions.length
  }
  
  // Save changes
  const handleSave = async () => {
    setIsSaving(true)
    try {
      const result = await savePermissionsMatrix(matrix)
      
      if (result.success) {
        setOriginalMatrix(matrix)
        setHasUnsavedChanges(false)
        toast({
          title: 'Permissions Saved',
          description: 'Role permissions have been updated successfully.',
        })
      } else {
        toast({
          title: 'Save Failed',
          description: result.error || 'Failed to save permissions',
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
  
  // Reset to defaults
  const handleReset = async () => {
    setIsResetting(true)
    try {
      const result = await resetPermissions()
      
      if (result.success) {
        // Reload the matrix
        const data = await fetchPermissionsMatrix()
        setOriginalMatrix(data)
        setMatrix(data)
        setHasUnsavedChanges(false)
        toast({
          title: 'Permissions Reset',
          description: 'All permissions have been reset to defaults.',
        })
      } else {
        toast({
          title: 'Reset Failed',
          description: result.error || 'Failed to reset permissions',
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
      setIsResetting(false)
    }
  }
  
  // Toggle group expansion
  const toggleGroupExpansion = (groupKey: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey)
      } else {
        newSet.add(groupKey)
      }
      return newSet
    })
  }
  
  // Expand/collapse all groups
  const expandAll = () => setExpandedGroups(new Set(Object.keys(PERMISSION_GROUPS)))
  const collapseAll = () => setExpandedGroups(new Set())
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading permissions...</p>
        </div>
      </div>
    )
  }
  
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Permissions" />
        <RoleTabBar role="admin" />
        {/* Header */}
        <div className="sticky top-0 z-40 bg-primary text-primary-foreground">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link 
                  href="/admin/dashboard" 
                  className="p-2 hover:bg-primary-foreground/10 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                  <h1 className="text-xl font-bold flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Permissions Matrix
                  </h1>
                  <p className="text-sm text-primary-foreground/80">
                    Configure role-based access control
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {hasUnsavedChanges && (
                  <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-100 border-yellow-500/50">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Unsaved Changes
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Content */}
        <div className="container mx-auto px-4 py-6 pb-32">
          {/* Search and Actions */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search permissions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={expandAll}>
                Expand All
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                Collapse All
              </Button>
            </div>
          </div>
          
          {/* Role Headers (sticky on desktop) */}
          <div className="hidden lg:block sticky top-[76px] z-30 bg-background pb-2">
            <div className="grid grid-cols-[300px_repeat(4,1fr)] gap-4 px-4 py-3 bg-muted rounded-lg">
              <div className="font-medium text-sm text-muted-foreground">Permission</div>
              {ROLES.map(role => (
                <div key={role} className="text-center font-medium text-sm">
                  {ROLE_LABELS[role]}
                </div>
              ))}
            </div>
          </div>
          
          {/* Permission Groups */}
          <div className="space-y-4 mt-4">
            {Object.entries(filteredGroups).map(([groupKey, group]) => (
              <Card key={groupKey} className="overflow-hidden">
                <Collapsible
                  open={expandedGroups.has(groupKey)}
                  onOpenChange={() => toggleGroupExpansion(groupKey)}
                >
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {expandedGroups.has(groupKey) ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                          <div>
                            <CardTitle className="text-base">{group.label}</CardTitle>
                            <CardDescription className="text-xs">
                              {group.permissions.length} permission{group.permissions.length !== 1 ? 's' : ''}
                            </CardDescription>
                          </div>
                        </div>
                        
                        {/* Group-level toggles (desktop) */}
                        <div className="hidden lg:flex items-center gap-8 pr-4">
                          {ROLES.map(role => {
                            const fullyEnabled = isGroupFullyEnabled(role, groupKey)
                            const partiallyEnabled = isGroupPartiallyEnabled(role, groupKey)
                            
                            return (
                              <div key={role} className="w-16 flex justify-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleGroupForRole(role, groupKey, !fullyEnabled)
                                  }}
                                  className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                                    fullyEnabled 
                                      ? 'bg-primary border-primary text-primary-foreground' 
                                      : partiallyEnabled
                                        ? 'bg-primary/30 border-primary/50'
                                        : 'border-muted-foreground/30 hover:border-primary/50'
                                  }`}
                                >
                                  {fullyEnabled && <Check className="w-4 h-4" />}
                                  {partiallyEnabled && !fullyEnabled && (
                                    <div className="w-2 h-2 bg-primary rounded-sm" />
                                  )}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {group.permissions.map(perm => (
                          <div 
                            key={perm.key}
                            className="grid grid-cols-1 lg:grid-cols-[300px_repeat(4,1fr)] gap-4 py-3 px-4 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            {/* Permission info */}
                            <div className="flex items-start gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{perm.label}</span>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs">{perm.description}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <code className="text-xs text-muted-foreground">{perm.key}</code>
                              </div>
                            </div>
                            
                            {/* Role toggles */}
                            {ROLES.map(role => {
                              const isEnabled = matrix[role].includes(perm.key as Permission)
                              const isProtected = role === 'admin' && 
                                PROTECTED_ADMIN_PERMISSIONS.includes(perm.key as Permission)
                              
                              return (
                                <div key={role} className="flex items-center justify-between lg:justify-center">
                                  <span className="lg:hidden text-sm text-muted-foreground">
                                    {ROLE_LABELS[role]}
                                  </span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div>
                                        <Switch
                                          checked={isEnabled}
                                          onCheckedChange={() => togglePermission(role, perm.key as Permission)}
                                          disabled={isProtected}
                                          className={isProtected ? 'opacity-50 cursor-not-allowed' : ''}
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    {isProtected && (
                                      <TooltipContent>
                                        <p>Protected: Cannot be removed from Admin</p>
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            ))}
          </div>
          
          {Object.keys(filteredGroups).length === 0 && (
            <div className="text-center py-12">
              <Search className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No permissions match your search.</p>
            </div>
          )}
        </div>
        
        {/* Fixed Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 z-50">
          <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              {hasUnsavedChanges ? (
                <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  You have unsaved changes
                </span>
              ) : (
                <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  All changes saved
                </span>
              )}
            </div>
            
            <div className="flex gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={isResetting}>
                    {isResetting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4 mr-2" />
                    )}
                    Reset to Defaults
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset Permissions?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will reset all role permissions to their default values. 
                      Any custom permission configurations will be lost. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset}>
                      Reset Permissions
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              
              <Button 
                onClick={handleSave} 
                disabled={!hasUnsavedChanges || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
        
        {/* Bottom spacer for fixed action bar */}
        <div className="h-24" />
      </div>
    </TooltipProvider>
  )
}
