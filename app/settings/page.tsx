'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { 
  Settings, 
  Bell, 
  Mail, 
  MessageSquare, 
  Smartphone,
  Save, 
  Loader2, 
  Check,
  ArrowLeft,
  User,
  Shield
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'

interface UserSettings {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  role: string
  email_notifications_enabled: boolean
  sms_notifications_enabled: boolean
  whatsapp_notifications_enabled: boolean
  notification_email: string | null
  notification_phone: string | null
}

// Role-based dashboard routes
const roleDashboardRoutes: Record<string, string> = {
  admin: '/admin/dashboard',
  project_manager: '/pm/dashboard',
  accountant: '/accountant/queue',
  contractor: '/vendor/portal',
}

export default function SettingsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  
  // Form state
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [smsNotifications, setSmsNotifications] = useState(true)
  const [whatsappNotifications, setWhatsappNotifications] = useState(false)
  const [notificationEmail, setNotificationEmail] = useState('')
  const [notificationPhone, setNotificationPhone] = useState('')

  const handleBackNavigation = () => {
    // Navigate to the user's role-specific dashboard
    const destination = roleDashboardRoutes[settings?.role || 'admin'] || '/admin/dashboard'
    router.push(destination)
  }

  useEffect(() => {
    async function loadSettings() {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/auth/login')
        return
      }

      // Fetch user settings
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', user.id)
        .single()

      if (error || !data) {
        // Use mock data if user record doesn't exist
        setSettings({
          id: user.id,
          first_name: 'Demo',
          last_name: 'User',
          email: user.email || '',
          phone: null,
          role: 'admin',
          email_notifications_enabled: true,
          sms_notifications_enabled: true,
          whatsapp_notifications_enabled: false,
          notification_email: null,
          notification_phone: null,
        })
        setEmailNotifications(true)
        setSmsNotifications(true)
        setWhatsappNotifications(false)
        setNotificationEmail(user.email || '')
      } else {
        setSettings(data)
        setEmailNotifications(data.email_notifications_enabled ?? true)
        setSmsNotifications(data.sms_notifications_enabled ?? true)
        setWhatsappNotifications(data.whatsapp_notifications_enabled ?? false)
        setNotificationEmail(data.notification_email || data.email || '')
        setNotificationPhone(data.notification_phone || data.phone || '')
      }
      
      setLoading(false)
    }

    loadSettings()
  }, [supabase, router])

  const handleSave = async () => {
    if (!settings) return
    
    setSaving(true)
    
    const { error } = await supabase
      .from('users')
      .update({
        email_notifications_enabled: emailNotifications,
        sms_notifications_enabled: smsNotifications,
        whatsapp_notifications_enabled: whatsappNotifications,
        notification_email: notificationEmail || null,
        notification_phone: notificationPhone || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id)

    setSaving(false)

    if (error) {
      toast({
        title: 'Error saving settings',
        description: error.message,
        variant: 'destructive',
      })
    } else {
      toast({
        title: 'Settings saved',
        description: (
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span>Your notification preferences have been updated.</span>
          </div>
        ),
      })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="Settings"
        pageDescription="Manage your preferences"
      />

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="space-y-8">
          {/* Profile Section */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <User className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">Profile</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-sm">Name</Label>
                  <p className="font-medium">{settings?.first_name} {settings?.last_name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-sm">Role</Label>
                  <p className="font-medium capitalize">{settings?.role?.replace('_', ' ')}</p>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Email</Label>
                <p className="font-medium">{settings?.email}</p>
              </div>
            </div>
          </div>

          {/* Notification Preferences */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">Notification Preferences</h2>
            </div>
            <div className="p-6 space-y-6">
              {/* Email Toggle */}
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Email Notifications</p>
                    <p className="text-sm text-muted-foreground">
                      Receive updates about invoices, approvals, and payments via email
                    </p>
                  </div>
                </div>
                <Switch
                  checked={emailNotifications}
                  onCheckedChange={setEmailNotifications}
                />
              </div>

              {/* Email address override */}
              {emailNotifications && (
                <div className="pl-14 space-y-2">
                  <Label htmlFor="notification-email" className="text-sm">
                    Notification Email Address
                  </Label>
                  <Input
                    id="notification-email"
                    type="email"
                    placeholder="Use a different email for notifications"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    className="max-w-md"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use your account email ({settings?.email})
                  </p>
                </div>
              )}

              {/* SMS Toggle (default text channel) */}
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      SMS Notifications
                      <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        Default
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Receive text-message alerts for invoice approvals, payments, and status changes
                    </p>
                  </div>
                </div>
                <Switch
                  checked={smsNotifications}
                  onCheckedChange={setSmsNotifications}
                />
              </div>

              {/* WhatsApp Toggle (opt-in) */}
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium">WhatsApp Notifications</p>
                    <p className="text-sm text-muted-foreground">
                      Optionally receive the same alerts via WhatsApp instead of, or in addition to, SMS
                    </p>
                  </div>
                </div>
                <Switch
                  checked={whatsappNotifications}
                  onCheckedChange={setWhatsappNotifications}
                />
              </div>

              {/* Shared phone number for SMS / WhatsApp */}
              {(smsNotifications || whatsappNotifications) && (
                <div className="pl-14 space-y-2">
                  <Label htmlFor="notification-phone" className="text-sm">
                    Mobile Phone Number
                  </Label>
                  <Input
                    id="notification-phone"
                    type="tel"
                    placeholder="+1 (416) 555-0123"
                    value={notificationPhone}
                    onChange={(e) => setNotificationPhone(e.target.value)}
                    className="max-w-md"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used for both SMS and WhatsApp. Enter your number with country code (e.g., +14165550123).
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Notification Types Info */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <Shield className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">What You&apos;ll Receive</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="font-medium text-sm mb-2">Invoice Updates</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• New invoice submissions</li>
                    <li>• Approval requests</li>
                    <li>• Status changes</li>
                  </ul>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="font-medium text-sm mb-2">Payment Alerts</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Payment registered</li>
                    <li>• EFT batch processed</li>
                    <li>• Payment confirmations</li>
                  </ul>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="font-medium text-sm mb-2">Compliance Reminders</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• WCB expiry warnings</li>
                    <li>• KYC verification updates</li>
                    <li>• Document requests</li>
                  </ul>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="font-medium text-sm mb-2">System Notifications</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Budget threshold alerts</li>
                    <li>• Holdback releases</li>
                    <li>• Audit confirmations</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Preferences
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
