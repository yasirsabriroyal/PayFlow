'use client'

import { useState, useEffect } from 'react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCompanySettings, updateCompanySettings } from '@/app/admin/actions'
import { Building2, CheckCircle } from 'lucide-react'

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
}

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
}

export default function CompanySettingsPage() {
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        })
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const result = await updateCompanySettings(form)
    setSaving(false)

    if (result && 'success' in result && result.success) {
      setSaved(true)
    } else {
      setError(result && 'error' in result && typeof result.error === 'string' ? result.error : 'Failed to save settings.')
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

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading settings…</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Section 1: Company Information */}
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
