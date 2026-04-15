'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Shield, Building2, AlertTriangle, Check, Loader2, Save,
  DollarSign, Clock, FileText, Lock, Settings, ChevronRight,
  Info, ToggleLeft, ToggleRight
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { MobileNav } from '@/components/layout/mobile-nav'

interface PaymentSettings {
  wcbBlockEnabled: boolean
  lienWaiverRequired: boolean
  statDecEnabled: boolean
  statDecThreshold: number
  tier1Threshold: number
  tier2Threshold: number
  defaultHoldbackPercent: number
  holdbackReleaseDays: number
}

const defaultSettings: PaymentSettings = {
  wcbBlockEnabled: true,
  lienWaiverRequired: true,
  statDecEnabled: true,
  statDecThreshold: 50000, // $50,000
  tier1Threshold: 25000, // $25,000
  tier2Threshold: 100000, // $100,000
  defaultHoldbackPercent: 10,
  holdbackReleaseDays: 45,
}

export default function PaymentSettingsPage() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<PaymentSettings>(defaultSettings)
  const [originalSettings, setOriginalSettings] = useState<PaymentSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Load settings from database
  useEffect(() => {
    const loadSettings = async () => {
      setIsLoading(true)
      const supabase = createClient()

      try {
        // Fetch all payment-related settings
        const { data: settingsData, error } = await supabase
          .from('system_settings')
          .select('*')
          .in('setting_key', [
            'payment_wcb_block',
            'payment_lien_waiver_required',
            'payment_stat_dec_threshold',
            'payment_approval_thresholds',
            'holdback_default_percentage',
            'holdback_release_days',
          ])

        if (!error && settingsData && settingsData.length > 0) {
          const loaded: Partial<PaymentSettings> = {}
          
          settingsData.forEach((setting) => {
            const value = setting.setting_value as Record<string, unknown>
            switch (setting.setting_key) {
              case 'payment_wcb_block':
                loaded.wcbBlockEnabled = value.enabled as boolean
                break
              case 'payment_lien_waiver_required':
                loaded.lienWaiverRequired = value.enabled as boolean
                break
              case 'payment_stat_dec_threshold':
                loaded.statDecEnabled = value.enabled as boolean
                loaded.statDecThreshold = (value.threshold_cents as number) / 100
                break
              case 'payment_approval_thresholds':
                loaded.tier1Threshold = (value.tier1_cents as number) / 100
                loaded.tier2Threshold = (value.tier2_cents as number) / 100
                break
              case 'holdback_default_percentage':
                loaded.defaultHoldbackPercent = value.percentage as number
                break
              case 'holdback_release_days':
                loaded.holdbackReleaseDays = value.days as number
                break
            }
          })

          const merged = { ...defaultSettings, ...loaded }
          setSettings(merged)
          setOriginalSettings(merged)
        }
      } catch (err) {
        console.log('[v0] Error loading settings:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadSettings()
  }, [])

  // Track changes
  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(originalSettings)
    setHasChanges(changed)
  }, [settings, originalSettings])

  const handleSaveSettings = async () => {
    setIsSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    try {
      // Get user's internal ID
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', user?.id)
        .single()

      const userId = userData?.id

      // Update all settings
      const updates = [
        {
          setting_key: 'payment_wcb_block',
          setting_value: { enabled: settings.wcbBlockEnabled, description: 'Block EFT generation if contractor WCB clearance is expired' },
        },
        {
          setting_key: 'payment_lien_waiver_required',
          setting_value: { enabled: settings.lienWaiverRequired, description: 'Require signed lien waiver before holdback release' },
        },
        {
          setting_key: 'payment_stat_dec_threshold',
          setting_value: { 
            enabled: settings.statDecEnabled, 
            threshold_cents: Math.round(settings.statDecThreshold * 100),
            description: 'Require statutory declaration for invoices exceeding threshold'
          },
        },
        {
          setting_key: 'payment_approval_thresholds',
          setting_value: {
            tier1_cents: Math.round(settings.tier1Threshold * 100),
            tier2_cents: Math.round(settings.tier2Threshold * 100),
            description: 'Payment approval tier thresholds'
          },
        },
        {
          setting_key: 'holdback_default_percentage',
          setting_value: { percentage: settings.defaultHoldbackPercent, description: 'Default statutory holdback percentage' },
        },
        {
          setting_key: 'holdback_release_days',
          setting_value: { days: settings.holdbackReleaseDays, description: 'Standard holdback release period in days' },
        },
      ]

      // Upsert each setting
      for (const update of updates) {
        const { error } = await supabase
          .from('system_settings')
          .upsert({
            setting_key: update.setting_key,
            setting_value: update.setting_value,
            setting_type: 'compliance',
            updated_by: userId,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'setting_key',
          })

        if (error) {
          console.log('[v0] Error saving setting:', update.setting_key, error)
        }
      }

      setOriginalSettings(settings)
      toast({
        title: 'Settings Saved',
        description: 'Payment configuration has been updated successfully.',
      })
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setSettings(originalSettings)
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-semibold text-sm">Payment Settings</span>
          </div>
          <Button 
            size="sm" 
            onClick={handleSaveSettings} 
            disabled={!hasChanges || isSaving}
          >
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
              <span className="text-muted-foreground">Payment Settings</span>
            </div>
            <div className="flex items-center gap-3">
              {hasChanges && (
                <Button variant="ghost" onClick={handleReset}>
                  Reset Changes
                </Button>
              )}
              <Button onClick={handleSaveSettings} disabled={!hasChanges || isSaving}>
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
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-20 md:pb-8">
        <div className="space-y-4 md:space-y-6">
          {/* Page Header - Desktop */}
          <div className="hidden md:block">
            <h1 className="text-3xl font-semibold tracking-tight">Payment Requirements</h1>
            <p className="text-muted-foreground mt-1">
              Configure global payment guardrails and compliance rules.
            </p>
          </div>

          {/* Unsaved Changes Banner */}
          {hasChanges && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">You have unsaved changes</p>
                <p className="text-xs text-muted-foreground">Save to apply your new payment configuration.</p>
              </div>
              <Button size="sm" onClick={handleSaveSettings} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Now'}
              </Button>
            </div>
          )}

          {/* Compliance Rules */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 md:px-6 py-4 border-b border-border">
              <h2 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Compliance Rules
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Enable or disable payment compliance requirements
              </p>
            </div>

            <div className="divide-y divide-border">
              {/* WCB Block */}
              <div className="p-4 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-destructive" />
                      <Label htmlFor="wcb-block" className="font-medium">
                        Block EFT if WCB Expired
                      </Label>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Prevent EFT batch generation for contractors with expired WCB clearance certificates.
                    </p>
                    {settings.wcbBlockEnabled && (
                      <Badge variant="outline" className="mt-2 bg-destructive/10 text-destructive border-destructive/30">
                        Active - Payments will be blocked
                      </Badge>
                    )}
                  </div>
                  <Switch
                    id="wcb-block"
                    checked={settings.wcbBlockEnabled}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, wcbBlockEnabled: checked }))}
                  />
                </div>
              </div>

              {/* Lien Waiver Requirement */}
              <div className="p-4 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-accent" />
                      <Label htmlFor="lien-waiver" className="font-medium">
                        Require Lien Waiver for Release
                      </Label>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Require a signed lien waiver before releasing statutory holdback funds.
                    </p>
                    {settings.lienWaiverRequired && (
                      <Badge variant="outline" className="mt-2 bg-accent/10 text-accent border-accent/30">
                        Active - Lien waiver required
                      </Badge>
                    )}
                  </div>
                  <Switch
                    id="lien-waiver"
                    checked={settings.lienWaiverRequired}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, lienWaiverRequired: checked }))}
                  />
                </div>
              </div>

              {/* Statutory Declaration Threshold */}
              <div className="p-4 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-warning" />
                      <Label htmlFor="stat-dec" className="font-medium">
                        Statutory Declaration Threshold
                      </Label>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Require statutory declaration for invoices exceeding a specified amount.
                    </p>
                    
                    {settings.statDecEnabled && (
                      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground whitespace-nowrap">Require for invoices exceeding:</span>
                          <div className="relative w-32">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              type="number"
                              value={settings.statDecThreshold}
                              onChange={(e) => setSettings(prev => ({ 
                                ...prev, 
                                statDecThreshold: Math.max(0, Number(e.target.value))
                              }))}
                              className="pl-7 h-9"
                              min={0}
                              step={1000}
                            />
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 w-fit">
                          Currently: {formatCurrency(settings.statDecThreshold)}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <Switch
                    id="stat-dec"
                    checked={settings.statDecEnabled}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, statDecEnabled: checked }))}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Approval Thresholds */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 md:px-6 py-4 border-b border-border">
              <h2 className="font-semibold flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                Approval Thresholds
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure multi-tier approval thresholds
              </p>
            </div>

            <div className="p-4 md:p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Tier 1 */}
                <div className="space-y-2">
                  <Label htmlFor="tier1">Tier 1: Accountant Only (up to)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="tier1"
                      type="number"
                      value={settings.tier1Threshold}
                      onChange={(e) => setSettings(prev => ({ 
                        ...prev, 
                        tier1Threshold: Math.max(0, Number(e.target.value))
                      }))}
                      className="pl-7 h-11"
                      min={0}
                      step={1000}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Invoices up to {formatCurrency(settings.tier1Threshold)} can be approved by accountants
                  </p>
                </div>

                {/* Tier 2 */}
                <div className="space-y-2">
                  <Label htmlFor="tier2">Tier 2: PM Approval Required (up to)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="tier2"
                      type="number"
                      value={settings.tier2Threshold}
                      onChange={(e) => setSettings(prev => ({ 
                        ...prev, 
                        tier2Threshold: Math.max(0, Number(e.target.value))
                      }))}
                      className="pl-7 h-11"
                      min={0}
                      step={1000}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Invoices up to {formatCurrency(settings.tier2Threshold)} require PM approval
                  </p>
                </div>
              </div>

              {/* Visual threshold diagram */}
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm font-medium mb-3">Approval Flow</p>
                <div className="flex items-center gap-2 text-sm overflow-x-auto pb-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-success/10 border border-success/30 rounded-lg whitespace-nowrap">
                    <Check className="w-4 h-4 text-success" />
                    <span>&lt; {formatCurrency(settings.tier1Threshold)}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg whitespace-nowrap">
                    <Clock className="w-4 h-4 text-warning" />
                    <span>&lt; {formatCurrency(settings.tier2Threshold)}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg whitespace-nowrap">
                    <Shield className="w-4 h-4 text-destructive" />
                    <span>&gt; {formatCurrency(settings.tier2Threshold)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 overflow-x-auto">
                  <span className="whitespace-nowrap">Accountant</span>
                  <span className="w-16" />
                  <span className="whitespace-nowrap">+ PM Approval</span>
                  <span className="w-12" />
                  <span className="whitespace-nowrap">+ Admin Approval</span>
                </div>
              </div>
            </div>
          </div>

          {/* Holdback Configuration */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 md:px-6 py-4 border-b border-border">
              <h2 className="font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Holdback Configuration
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure statutory holdback defaults
              </p>
            </div>

            <div className="p-4 md:p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Default Percentage */}
                <div className="space-y-2">
                  <Label htmlFor="holdback-percent">Default Holdback Percentage</Label>
                  <div className="relative">
                    <Input
                      id="holdback-percent"
                      type="number"
                      value={settings.defaultHoldbackPercent}
                      onChange={(e) => setSettings(prev => ({ 
                        ...prev, 
                        defaultHoldbackPercent: Math.min(100, Math.max(0, Number(e.target.value)))
                      }))}
                      className="pr-8 h-11"
                      min={0}
                      max={100}
                      step={1}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Standard statutory holdback applied to invoices
                  </p>
                </div>

                {/* Release Days */}
                <div className="space-y-2">
                  <Label htmlFor="release-days">Holdback Release Period</Label>
                  <div className="relative">
                    <Input
                      id="release-days"
                      type="number"
                      value={settings.holdbackReleaseDays}
                      onChange={(e) => setSettings(prev => ({ 
                        ...prev, 
                        holdbackReleaseDays: Math.max(1, Number(e.target.value))
                      }))}
                      className="pr-12 h-11"
                      min={1}
                      step={1}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">days</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Days after payment before holdback is eligible for release
                  </p>
                </div>
              </div>

              {/* Info banner */}
              <div className="mt-6 flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-primary">Builder&apos;s Lien Act Compliance</p>
                  <p className="text-muted-foreground mt-1">
                    The default 10% holdback and 45-day release period are based on standard provincial 
                    Builder&apos;s Lien Act requirements. Adjust these settings based on your jurisdiction.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Save Button */}
          <div className="md:hidden">
            {hasChanges && (
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1 h-12"
                  onClick={handleReset}
                >
                  Reset
                </Button>
                <Button 
                  className="flex-1 h-12"
                  onClick={handleSaveSettings}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
