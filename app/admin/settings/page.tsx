'use client'

import { useState, useEffect } from 'react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCompanySettings, updateCompanySettings } from '@/app/admin/actions'
import { Building2, CheckCircle, Upload, X, Loader2, Tag, ChevronRight, MessageSquarePlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface SettingsForm {
  company_name: string
  email: string
  phone: string
  website: string
  address: string
  city: string
  province: string
  postal_code: string
  hst_number: string
  logo_url: string
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']

const EMPTY_FORM: SettingsForm = {
  company_name: '',
  email: '',
  phone: '',
  website: '',
  address: '',
  city: '',
  province: '',
  postal_code: '',
  hst_number: '',
  logo_url: '',
}

export default function CompanySettingsPage() {
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const result = await getCompanySettings()
      if (result && 'settings' in result && result.settings) {
        const s = result.settings as Record<string, string>
        setForm({
          company_name: s.company_name ?? '',
          email: s.email ?? '',
          phone: s.phone ?? '',
          website: s.website ?? '',
          address: s.address ?? '',
          city: s.city ?? '',
          province: s.province ?? '',
          postal_code: s.postal_code ?? '',
          hst_number: s.hst_number ?? '',
          logo_url: s.logo_url ?? '',
        })
        if (s.logo_url) {
          setLogoPreview(s.logo_url)
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  function handleChange(field: keyof SettingsForm, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
    setError(null)
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError('Logo file size must be less than 2MB.')
      return
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only PNG, JPG, and SVG files are allowed.')
      return
    }

    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setSaved(false)
    setError(null)
  }

  function handleRemoveLogo() {
    setLogoFile(null)
    setLogoPreview(null)
    setForm(prev => ({ ...prev, logo_url: '' }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      let finalLogoUrl = form.logo_url
      const supabase = createClient()

      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop()
        const fileName = `logo-${Date.now()}.${fileExt}`
        
        const { error: uploadError, data } = await supabase.storage
          .from('brand-assets')
          .upload(fileName, logoFile, { upsert: true })

        if (uploadError) throw new Error(uploadError.message)
        
        const { data: { publicUrl } } = supabase.storage
          .from('brand-assets')
          .getPublicUrl(fileName)
          
        finalLogoUrl = publicUrl

        // Cleanup old logo if it exists
        if (form.logo_url) {
          const oldPathMatch = form.logo_url.match(/\/brand-assets\/(logo-.*)$/)
          if (oldPathMatch && oldPathMatch[1]) {
            await supabase.storage.from('brand-assets').remove([oldPathMatch[1]])
          }
        }
      } else if (!logoPreview && form.logo_url) {
        // User removed the logo entirely
        const oldPathMatch = form.logo_url.match(/\/brand-assets\/(logo-.*)$/)
        if (oldPathMatch && oldPathMatch[1]) {
          await supabase.storage.from('brand-assets').remove([oldPathMatch[1]])
        }
        finalLogoUrl = ''
      }

      const result = await updateCompanySettings({ ...form, logo_url: finalLogoUrl })
      
      if (result && 'success' in result && result.success) {
        setForm(prev => ({ ...prev, logo_url: finalLogoUrl }))
        setLogoFile(null)
        setSaved(true)
      } else {
        throw new Error(result && 'error' in result && typeof result.error === 'string' ? result.error : 'Failed to save settings.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader pageTitle="Company Settings" />
      <RoleTabBar role="admin" />

      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Building2 className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Company Settings</h1>
        </div>

        {/* Contractor Settings quick-link */}
        <Link
          href="/admin/settings/contractors/categories"
          className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl mb-4 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
              <Tag className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Contractor Categories</p>
              <p className="text-xs text-gray-500">Add, edit, or deactivate trade categories for contractors</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors" />
        </Link>

        {/* Feedback Portal quick-link */}
        <Link
          href="/admin/feedback"
          className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl mb-6 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
              <MessageSquarePlus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Feedback Portal</p>
              <p className="text-xs text-gray-500">Review bug reports, feature requests, and user suggestions</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors" />
        </Link>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading settings…</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Section 1: Branding & Logo */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Branding</h2>
              
              <div className="space-y-4">
                <Label>Company Logo</Label>
                <div className="flex items-start gap-6">
                  {logoPreview ? (
                    <div className="relative group">
                      <div className="w-24 h-24 border rounded-lg bg-gray-50 flex items-center justify-center p-2 overflow-hidden">
                        <img src={logoPreview} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm border border-red-200 hover:bg-red-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-24 h-24 border border-dashed rounded-lg bg-gray-50 flex flex-col items-center justify-center text-gray-400">
                      <Building2 className="w-8 h-8 mb-1 opacity-50" />
                      <span className="text-[10px] uppercase font-semibold">No Logo</span>
                    </div>
                  )}
                  
                  <div className="flex-1 space-y-2">
                    <Input
                      id="logo_upload"
                      type="file"
                      accept="image/png, image/jpeg, image/svg+xml"
                      onChange={handleLogoSelect}
                      className="max-w-xs cursor-pointer"
                    />
                    <p className="text-xs text-gray-500">
                      Supported formats: PNG, JPG, SVG. Maximum size: 2MB.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Company Information */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Company Information</h2>
              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name <span className="text-red-500">*</span></Label>
                <Input
                  id="company_name"
                  value={form.company_name}
                  onChange={e => handleChange('company_name', e.target.value)}
                  required
                  placeholder="Royal Development"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => handleChange('email', e.target.value)}
                  placeholder="info@example.ca"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={e => handleChange('phone', e.target.value)}
                  placeholder="+1 (416) 000-0000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={form.website}
                  onChange={e => handleChange('website', e.target.value)}
                  placeholder="https://royaldevelopment.ca"
                />
              </div>
            </div>

            {/* Section 2: Address */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Address</h2>
              <div className="space-y-2">
                <Label htmlFor="address">Street Address</Label>
                <Input
                  id="address"
                  value={form.address}
                  onChange={e => handleChange('address', e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={e => handleChange('city', e.target.value)}
                    placeholder="Toronto"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="province">Province</Label>
                  <Input
                    id="province"
                    value={form.province}
                    onChange={e => handleChange('province', e.target.value)}
                    placeholder="ON"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal_code">Postal Code</Label>
                <Input
                  id="postal_code"
                  value={form.postal_code}
                  onChange={e => handleChange('postal_code', e.target.value)}
                  placeholder="M5V 3A8"
                />
              </div>
            </div>

            {/* Section 3: Tax Information */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Tax Information</h2>
              <div className="space-y-2">
                <Label htmlFor="hst_number">HST/GST Number</Label>
                <Input
                  id="hst_number"
                  value={form.hst_number}
                  onChange={e => handleChange('hst_number', e.target.value)}
                  placeholder="123456789 RT0001"
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Success message */}
            {saved && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Settings saved successfully.
              </div>
            )}

            {/* Save button */}
            <div className="flex justify-end">
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-6">
                {saving ? 'Saving…' : 'Save Settings'}
              </Button>
            </div>

          </form>
        )}
      </div>
    </div>
  )
}
