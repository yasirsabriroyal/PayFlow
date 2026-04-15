'use client'

import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Shield, Plus, Minus, Lock } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import type { Permission, UserRole } from '@/lib/permissions/constants'

// ============================================
// TYPES
// ============================================

export interface PermissionChange {
  role: UserRole
  permission: Permission
  action: 'added' | 'removed'
}

export interface PermissionChangeConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: PermissionChange[]
  requirePassword?: boolean
  onConfirm: () => Promise<void>
  onCancel: () => void
}

// ============================================
// HELPERS
// ============================================

function getPermissionLabel(permission: Permission): string {
  return permission
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
}

function getRoleLabel(role: UserRole): string {
  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
}

// Critical permissions that show extra warnings
const CRITICAL_PERMISSIONS: Permission[] = [
  'execute_eft_payments',
  'manage_role_permissions',
  'create_users',
  'delete_users',
  'view_financial_reports',
]

// ============================================
// COMPONENT
// ============================================

export function PermissionChangeConfirmation({
  open,
  onOpenChange,
  changes,
  requirePassword = false,
  onConfirm,
  onCancel,
}: PermissionChangeConfirmationProps) {
  const [password, setPassword] = useState('')
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Group changes by action
  const { added, removed } = useMemo(() => {
    const added = changes.filter(c => c.action === 'added')
    const removed = changes.filter(c => c.action === 'removed')
    return { added, removed }
  }, [changes])

  // Check for critical changes
  const hasCriticalChanges = useMemo(() => {
    return changes.some(c => CRITICAL_PERMISSIONS.includes(c.permission))
  }, [changes])

  // Get affected roles
  const affectedRoles = useMemo(() => {
    const roles = new Set(changes.map(c => c.role))
    return Array.from(roles)
  }, [changes])

  const handleConfirm = async () => {
    if (requirePassword && !password) {
      setError('Password is required to confirm permission changes')
      return
    }

    setIsConfirming(true)
    setError(null)

    try {
      await onConfirm()
      onOpenChange(false)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setIsConfirming(false)
    }
  }

  const handleCancel = () => {
    setPassword('')
    setError(null)
    onCancel()
    onOpenChange(false)
  }

  if (changes.length === 0) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Confirm Permission Changes
          </DialogTitle>
          <DialogDescription>
            Review the following changes before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Critical warning */}
          {hasCriticalChanges && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">
                  Critical Permission Changes
                </p>
                <p className="text-muted-foreground mt-1">
                  These changes affect sensitive permissions. Please review carefully.
                </p>
              </div>
            </div>
          )}

          {/* Affected roles */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
              Affected Roles
            </Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {affectedRoles.map(role => (
                <Badge key={role} variant="secondary">
                  {getRoleLabel(role)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Permissions added */}
          {added.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Plus className="w-3 h-3" />
                Permissions Added ({added.length})
              </Label>
              <div className="mt-2 space-y-1">
                {added.map((change, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md bg-green-500/10 px-3 py-2 text-sm"
                  >
                    <span className="text-green-700 dark:text-green-400">
                      {getPermissionLabel(change.permission)}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {getRoleLabel(change.role)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Permissions removed */}
          {removed.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Minus className="w-3 h-3" />
                Permissions Removed ({removed.length})
              </Label>
              <div className="mt-2 space-y-1">
                {removed.map((change, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md bg-red-500/10 px-3 py-2 text-sm"
                  >
                    <span className="text-red-700 dark:text-red-400">
                      {getPermissionLabel(change.permission)}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {getRoleLabel(change.role)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Password confirmation */}
          {requirePassword && (
            <div className="pt-2 border-t">
              <Label htmlFor="confirm-password" className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Enter your password to confirm
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                className="mt-2"
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel} disabled={isConfirming}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isConfirming || (requirePassword && !password)}
            className={hasCriticalChanges ? 'bg-destructive hover:bg-destructive/90' : ''}
          >
            {isConfirming ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Saving...
              </>
            ) : (
              `Confirm ${changes.length} Change${changes.length > 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// HOOK FOR TRACKING CHANGES
// ============================================

export function usePermissionChanges(
  original: Record<UserRole, Permission[]>,
  current: Record<UserRole, Permission[]>
): PermissionChange[] {
  return useMemo(() => {
    const changes: PermissionChange[] = []
    
    const roles = new Set([
      ...Object.keys(original),
      ...Object.keys(current),
    ]) as Set<UserRole>
    
    for (const role of roles) {
      const originalPerms = new Set(original[role] || [])
      const currentPerms = new Set(current[role] || [])
      
      // Find added permissions
      for (const perm of currentPerms) {
        if (!originalPerms.has(perm)) {
          changes.push({ role, permission: perm, action: 'added' })
        }
      }
      
      // Find removed permissions
      for (const perm of originalPerms) {
        if (!currentPerms.has(perm)) {
          changes.push({ role, permission: perm, action: 'removed' })
        }
      }
    }
    
    return changes
  }, [original, current])
}
