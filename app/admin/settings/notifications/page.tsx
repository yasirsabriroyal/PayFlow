'use client'

import { useState, useEffect, useMemo } from 'react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { createClient } from '@/lib/supabase/client'
import {
  Bell, Building2, AlertTriangle, Loader2, Save, Info,
  Mail, Users, UserCog, Briefcase, ShieldCheck, X, Plus,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { MobileNav } from '@/components/layout/mobile-nav'

// Mirrors lib/notifications/distribution.ts (kept local to avoid importing a server-only module)
type RecipientRule =
  | { kind: 'vendor' }
  | { kind: 'role'; role: string }
  | { kind: 'project_role'; role: string }
  | { kind: 'user'; userId: string }

interface EventPolicy { rules: RecipientRule[] }
interface DistributionPolicy {
  version: number
  description?: string
  events: Record<string, EventPolicy>
}

interface DirectoryUser {
  id: string
  name: string
  role: string
}

const SETTING_KEY = 'notification_distribution'

// All notification events, with the payment confirmation event surfaced first.
const EVENTS: Array<{ key: string; label: string; description: string; highlight?: boolean }> = [
  { key: 'paid', label: 'Payment Confirmed', description: 'A payment was fully processed for an invoice.', highlight: true },
  { key: 'partially_paid', label: 'Partial Payment', description: 'A partial payment was recorded against an invoice.' },
  { key: 'submitted', label: 'Invoice Submitted', description: 'A vendor submitted a new invoice.' },
  { key: 'pending_approval', label: 'Pending Approval', description: 'An invoice is awaiting approval.' },
  { key: 'approved', label: 'Invoice Approved', description: 'An invoice was approved for payment.' },
  { key: 'rejected', label: 'Invoice Rejected', description: 'An invoice was rejected.' },
  { key: 'revision_requested', label: 'Revision Requested', description: 'Changes were requested on an invoice.' },
  { key: 'disputed', label: 'Invoice Disputed', description: 'An invoice was flagged as disputed.' },
]

// Fixed role recipients available as simple toggles.
const ROLE_OPTIONS: Array<{ role: string; label: string; icon: typeof Users }> = [
  { role: 'accountant', label: 'Accountant', icon: UserCog },
  { role: 'admin', label: 'Administrator', icon: ShieldCheck },
]

const DEFAULT_POLICY: DistributionPolicy = {
  version: 1,
  description: 'Recipient distribution rules per invoice status.',
  events: {
    paid: { rules: [{ kind: 'vendor' }, { kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    partially_paid: { rules: [{ kind: 'vendor' }, { kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    submitted: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    pending_approval: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    approved: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'project_role', role: 'project_manager' }, { kind: 'vendor' }] },
    rejected: { rules: [{ kind: 'project_role', role: 'project_manager' }, { kind: 'vendor' }] },
    revision_requested: { rules: [{ kind: 'vendor' }] },
    disputed: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
  },
}

// ---- Rule helpers (pure) ----
function hasVendor(rules: RecipientRule[]) {
  return rules.some((r) => r.kind === 'vendor')
}
function hasRole(rules: RecipientRule[], role: string) {
  return rules.some((r) => r.kind === 'role' && r.role === role)
}
function hasProjectPM(rules: RecipientRule[]) {
  return rules.some((r) => r.kind === 'project_role' && r.role === 'project_manager')
}
function userIds(rules: RecipientRule[]) {
  return rules.filter((r): r is { kind: 'user'; userId: string } => r.kind === 'user').map((r) => r.userId)
}

export default function NotificationDistributionPage() {
  const { toast } = useToast()
  const [policy, setPolicy] = useState<DistributionPolicy>(DEFAULT_POLICY)
  const [original, setOriginal] = useState<DistributionPolicy>(DEFAULT_POLICY)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const hasChanges = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(original),
    [policy, original]
  )

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      const supabase = createClient()
      try {
        const [{ data: settingRow }, { data: userRows }] = await Promise.all([
          supabase.from('system_settings').select('setting_value').eq('setting_key', SETTING_KEY).maybeSingle(),
          supabase.from('users').select('id, first_name, last_name, role').eq('is_active', true).order('first_name'),
        ])

        if (settingRow?.setting_value) {
          const value = settingRow.setting_value as DistributionPolicy
          if (value.events) {
            // Ensure every known event has an entry so the UI renders all of them.
            const merged: DistributionPolicy = { ...DEFAULT_POLICY, ...value, events: { ...DEFAULT_POLICY.events, ...value.events } }
            setPolicy(merged)
            setOriginal(merged)
          }
        }

        setUsers(
          (userRows ?? []).map((u) => ({
            id: u.id as string,
            name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'User',
            role: (u.role as string) ?? 'user',
          }))
        )
      } catch (err) {
        console.log('[v0] Error loading distribution policy:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const updateRules = (eventKey: string, next: RecipientRule[]) => {
    setPolicy((prev) => ({
      ...prev,
      events: { ...prev.events, [eventKey]: { rules: next } },
    }))
  }

  const toggleVendor = (eventKey: string, on: boolean) => {
    const rules = policy.events[eventKey]?.rules ?? []
    updateRules(eventKey, on ? [...rules, { kind: 'vendor' }] : rules.filter((r) => r.kind !== 'vendor'))
  }
  const toggleRole = (eventKey: string, role: string, on: boolean) => {
    const rules = policy.events[eventKey]?.rules ?? []
    updateRules(eventKey, on ? [...rules, { kind: 'role', role }] : rules.filter((r) => !(r.kind === 'role' && r.role === role)))
  }
  const togglePM = (eventKey: string, on: boolean) => {
    const rules = policy.events[eventKey]?.rules ?? []
    updateRules(eventKey, on
      ? [...rules, { kind: 'project_role', role: 'project_manager' }]
      : rules.filter((r) => !(r.kind === 'project_role' && r.role === 'project_manager')))
  }
  const addUser = (eventKey: string, userId: string) => {
    const rules = policy.events[eventKey]?.rules ?? []
    if (userIds(rules).includes(userId)) return
    updateRules(eventKey, [...rules, { kind: 'user', userId }])
  }
  const removeUser = (eventKey: string, userId: string) => {
    const rules = policy.events[eventKey]?.rules ?? []
    updateRules(eventKey, rules.filter((r) => !(r.kind === 'user' && r.userId === userId)))
  }

  const handleSave = async () => {
    setIsSaving(true)
    const supabase = createClient()
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: userData } = await supabase.from('users').select('id').eq('auth_user_id', user?.id).single()

      const { error } = await supabase.from('system_settings').upsert({
        setting_key: SETTING_KEY,
        setting_value: policy,
        setting_type: 'notification',
        is_active: true,
        description: 'Tenant-ready recipient distribution rules for invoice/payment notifications.',
        updated_by: userData?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'setting_key' })

      if (error) throw error
      setOriginal(policy)
      toast({ title: 'Distribution Rules Saved', description: 'Notification recipients have been updated.' })
    } catch (err) {
      console.log('[v0] Error saving distribution policy:', err)
      toast({ title: 'Error', description: 'Failed to save distribution rules. Please try again.', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown user'

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Notification Rules" />
      <RoleTabBar role="admin" />

      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-semibold text-sm">Notification Rules</span>
          </div>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden md:block border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/admin/dashboard">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary-foreground" />
                </div>
              </Link>
              <span className="font-semibold">PayFlow AP</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">Notification Rules</span>
            </div>
            <div className="flex items-center gap-3">
              {hasChanges && (
                <Button variant="ghost" onClick={() => setPolicy(original)}>Reset Changes</Button>
              )}
              <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-20 md:pb-8">
        <div className="space-y-4 md:space-y-6">
          <div className="hidden md:block">
            <h1 className="text-3xl font-semibold tracking-tight">Notification Distribution</h1>
            <p className="text-muted-foreground mt-1">
              Configure who receives a copy of each notification. Rules apply company-wide and require no code changes.
            </p>
          </div>

          {/* Info banner */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Tenant-ready:</span> recipients are resolved from these rules at send time.
              The actor who triggers an event is automatically excluded, and per-user channel preferences (email/SMS) are always respected.
              To add a role like <span className="font-medium text-foreground">Controller</span>, add that person under <span className="font-medium text-foreground">Specific People</span>.
            </div>
          </div>

          {/* Unsaved changes banner */}
          {hasChanges && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">You have unsaved changes</p>
                <p className="text-xs text-muted-foreground">Save to apply your new distribution rules.</p>
              </div>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Now'}
              </Button>
            </div>
          )}

          {EVENTS.map((event) => {
            const rules = policy.events[event.key]?.rules ?? []
            const selectedUserIds = userIds(rules)
            const availableUsers = users.filter((u) => !selectedUserIds.includes(u.id))
            return (
              <div
                key={event.key}
                className={`bg-card border rounded-xl overflow-hidden ${event.highlight ? 'border-primary/40' : 'border-border'}`}
              >
                <div className="px-4 md:px-6 py-4 border-b border-border flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold flex items-center gap-2">
                      <Bell className={`w-4 h-4 ${event.highlight ? 'text-primary' : 'text-muted-foreground'}`} />
                      {event.label}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{event.description}</p>
                  </div>
                  {event.highlight && (
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 whitespace-nowrap">
                      Payment confirmation
                    </Badge>
                  )}
                </div>

                <div className="p-4 md:p-6 space-y-4">
                  {/* Vendor */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <Label className="font-medium">Vendor / Contractor</Label>
                    </div>
                    <Switch checked={hasVendor(rules)} onCheckedChange={(c) => toggleVendor(event.key, c)} />
                  </div>

                  {/* Roles */}
                  {ROLE_OPTIONS.map(({ role, label, icon: Icon }) => (
                    <div key={role} className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-medium">{label}</Label>
                      </div>
                      <Switch checked={hasRole(rules, role)} onCheckedChange={(c) => toggleRole(event.key, role, c)} />
                    </div>
                  ))}

                  {/* Assigned PM */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <Label className="font-medium">Assigned Project Manager</Label>
                        <p className="text-xs text-muted-foreground">Resolved from the invoice&apos;s project assignment.</p>
                      </div>
                    </div>
                    <Switch checked={hasProjectPM(rules)} onCheckedChange={(c) => togglePM(event.key, c)} />
                  </div>

                  {/* Specific people */}
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <Label className="font-medium">Specific People</Label>
                    </div>
                    {selectedUserIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {selectedUserIds.map((id) => (
                          <Badge key={id} variant="secondary" className="gap-1 pr-1">
                            {userName(id)}
                            <button
                              type="button"
                              onClick={() => removeUser(event.key, id)}
                              className="ml-1 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                              aria-label={`Remove ${userName(id)}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Select value="" onValueChange={(id) => addUser(event.key, id)}>
                      <SelectTrigger className="w-full sm:w-72">
                        <div className="flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          <SelectValue placeholder="Add a specific person…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {availableUsers.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">No more users</div>
                        ) : (
                          availableUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} <span className="text-muted-foreground capitalize">· {u.role.replace('_', ' ')}</span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {rules.length === 0 && (
                    <p className="text-xs text-warning flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      No recipients selected — no notifications will be sent for this event.
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
