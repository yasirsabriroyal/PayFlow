'use client'

import { useState, useEffect, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  getCompanyOffices,
  getFooterSettings,
  saveOffice,
  deleteOffice,
  saveFooterSettings,
  type OfficeInput,
} from '@/app/admin/settings/communication/actions'
import {
  Building2,
  Plus,
  Trash2,
  Star,
  StarOff,
  CheckCircle,
  Loader2,
  AlertTriangle,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Globe,
  Linkedin,
  Facebook,
  Instagram,
  Youtube,
  Twitter,
} from 'lucide-react'

type Office = {
  id: string
  office_name: string
  address_1: string | null
  address_2: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country: string | null
  phone: string | null
  is_primary: boolean
  display_order: number
}

type FooterSettings = {
  footer_disclaimer: string | null
  social_facebook: string | null
  social_linkedin: string | null
  social_instagram: string | null
  social_twitter: string | null
  social_youtube: string | null
}

const EMPTY_OFFICE: OfficeInput = {
  officeName: '',
  address1: '',
  address2: '',
  city: '',
  province: 'Alberta',
  postalCode: '',
  country: 'Canada',
  phone: '',
  isPrimary: false,
  displayOrder: 0,
}

const LOCKED_ELEMENTS = [
  '"Powered by PayFlow" attribution',
  'System security notices',
  'Future unsubscribe controls',
  'Required compliance notices',
]

export function FooterBuilder() {
  const [offices, setOffices] = useState<Office[]>([])
  const [footerSettings, setFooterSettings] = useState<FooterSettings>({
    footer_disclaimer: null,
    social_facebook: null,
    social_linkedin: null,
    social_instagram: null,
    social_twitter: null,
    social_youtube: null,
  })
  const [loading, setLoading] = useState(true)
  const [editingOffice, setEditingOffice] = useState<OfficeInput & { id?: string } | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [newOffice, setNewOffice] = useState<OfficeInput>({ ...EMPTY_OFFICE })
  const [officeError, setOfficeError] = useState<string | null>(null)
  const [officeSaved, setOfficeSaved] = useState<string | null>(null)
  const [footerSaved, setFooterSaved] = useState(false)
  const [footerError, setFooterError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedOfficeId, setExpandedOfficeId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [officesRes, settingsRes] = await Promise.all([getCompanyOffices(), getFooterSettings()])
      if (officesRes && 'offices' in officesRes && officesRes.success) {
        setOffices(officesRes.offices as Office[])
      }
      if (settingsRes && 'settings' in settingsRes && settingsRes.success && settingsRes.settings) {
        setFooterSettings(settingsRes.settings as FooterSettings)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleSaveOffice(input: OfficeInput & { id?: string }) {
    setOfficeError(null)
    setOfficeSaved(null)
    if (!input.officeName?.trim()) {
      setOfficeError('Office name is required.')
      return
    }
    startTransition(async () => {
      const res = await saveOffice(input)
      if (res && 'success' in res && res.success) {
        setOfficeSaved(input.id || 'new')
        setAddingNew(false)
        setEditingOffice(null)
        setNewOffice({ ...EMPTY_OFFICE })
        // Refresh offices
        const fresh = await getCompanyOffices()
        if (fresh && 'offices' in fresh && fresh.success) setOffices(fresh.offices as Office[])
        setTimeout(() => setOfficeSaved(null), 3000)
      } else {
        setOfficeError(res && 'error' in res ? String(res.error) : 'Failed to save office.')
      }
    })
  }

  async function handleDeleteOffice(officeId: string) {
    setDeletingId(officeId)
    const res = await deleteOffice(officeId)
    setDeletingId(null)
    if (res && 'success' in res && res.success) {
      const fresh = await getCompanyOffices()
      if (fresh && 'offices' in fresh && fresh.success) setOffices(fresh.offices as Office[])
    }
  }

  async function handleSaveFooterSettings() {
    setFooterError(null)
    setFooterSaved(false)
    startTransition(async () => {
      const res = await saveFooterSettings({
        footerDisclaimer: footerSettings.footer_disclaimer,
        socialFacebook: footerSettings.social_facebook,
        socialLinkedin: footerSettings.social_linkedin,
        socialInstagram: footerSettings.social_instagram,
        socialTwitter: footerSettings.social_twitter,
        socialYoutube: footerSettings.social_youtube,
      })
      if (res && 'success' in res && res.success) {
        setFooterSaved(true)
        setTimeout(() => setFooterSaved(false), 3000)
      } else {
        setFooterError(res && 'error' in res ? String(res.error) : 'Failed to save footer settings.')
      }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading footer settings...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Office Locations */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-500" /> Office Locations
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Offices appear in the footer of every outbound email. The primary office is listed first.
            </p>
          </div>
          {!addingNew && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setAddingNew(true); setOfficeError(null) }}
              className="gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add Office
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {/* Existing offices */}
          {offices.map((office) => {
            const isEditing = editingOffice?.id === office.id
            const isExpanded = expandedOfficeId === office.id

            return (
              <div key={office.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900">{office.office_name}</span>
                      {office.is_primary && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                          <Star className="w-3 h-3" /> Primary
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {[office.address_1, office.city, office.province, office.postal_code].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpandedOfficeId(isExpanded ? null : office.id)}
                      className="h-8 w-8 p-0 text-gray-400 hover:text-gray-700"
                      aria-label={isExpanded ? 'Collapse' : 'Edit office'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteOffice(office.id)}
                      disabled={deletingId === office.id}
                      className="h-8 w-8 p-0 text-gray-400 hover:text-red-600"
                      aria-label="Delete office"
                    >
                      {deletingId === office.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {/* Inline edit form */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                    <OfficeForm
                      value={editingOffice?.id === office.id ? editingOffice : {
                        id: office.id,
                        officeName: office.office_name,
                        address1: office.address_1 ?? '',
                        address2: office.address_2 ?? '',
                        city: office.city ?? '',
                        province: office.province ?? '',
                        postalCode: office.postal_code ?? '',
                        country: office.country ?? 'Canada',
                        phone: office.phone ?? '',
                        isPrimary: office.is_primary,
                        displayOrder: office.display_order,
                      }}
                      onChange={(v) => setEditingOffice({ ...v, id: office.id })}
                      onSave={() => handleSaveOffice({ ...(editingOffice?.id === office.id ? editingOffice : { id: office.id, officeName: office.office_name, address1: office.address_1 ?? '', city: office.city ?? '', province: office.province ?? '', postalCode: office.postal_code ?? '', country: office.country ?? 'Canada', phone: office.phone ?? '', isPrimary: office.is_primary, displayOrder: office.display_order }), id: office.id })}
                      onCancel={() => { setExpandedOfficeId(null); setEditingOffice(null); setOfficeError(null) }}
                      saving={isPending}
                      saved={officeSaved === office.id}
                      error={officeError}
                      submitLabel="Save Changes"
                    />
                  </div>
                )}
              </div>
            )
          })}

          {offices.length === 0 && !addingNew && (
            <div className="text-center py-8 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-gray-500 text-sm">
              No office locations yet. Add your first office to display it in email footers.
            </div>
          )}

          {/* New office form */}
          {addingNew && (
            <div className="bg-white border border-blue-200 rounded-xl px-4 pb-4 pt-3">
              <p className="text-sm font-medium text-gray-700 mb-3">New Office</p>
              <OfficeForm
                value={newOffice}
                onChange={setNewOffice}
                onSave={() => handleSaveOffice(newOffice)}
                onCancel={() => { setAddingNew(false); setNewOffice({ ...EMPTY_OFFICE }); setOfficeError(null) }}
                saving={isPending}
                saved={officeSaved === 'new'}
                error={officeError}
                submitLabel="Add Office"
              />
            </div>
          )}
        </div>
      </section>

      {/* Footer Disclaimer */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Footer Disclaimer</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Optional legal / confidentiality text shown at the bottom of every email. Leave blank to omit.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="footer_disclaimer">Disclaimer Text</Label>
          <Textarea
            id="footer_disclaimer"
            value={footerSettings.footer_disclaimer ?? ''}
            onChange={(e) => setFooterSettings((p) => ({ ...p, footer_disclaimer: e.target.value || null }))}
            placeholder="This email and any attachments are confidential and intended solely for the named recipient(s). If you have received this email in error, please notify us immediately."
            rows={4}
            className="text-sm resize-none"
          />
        </div>
      </section>

      {/* Social Links */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Social Links</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Optional social media links rendered as text links in the email footer.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SocialField icon={<Linkedin className="w-4 h-4" />} label="LinkedIn" placeholder="https://linkedin.com/company/..."
            value={footerSettings.social_linkedin ?? ''} onChange={(v) => setFooterSettings((p) => ({ ...p, social_linkedin: v || null }))} />
          <SocialField icon={<Facebook className="w-4 h-4" />} label="Facebook" placeholder="https://facebook.com/..."
            value={footerSettings.social_facebook ?? ''} onChange={(v) => setFooterSettings((p) => ({ ...p, social_facebook: v || null }))} />
          <SocialField icon={<Instagram className="w-4 h-4" />} label="Instagram" placeholder="https://instagram.com/..."
            value={footerSettings.social_instagram ?? ''} onChange={(v) => setFooterSettings((p) => ({ ...p, social_instagram: v || null }))} />
          <SocialField icon={<Twitter className="w-4 h-4" />} label="X / Twitter" placeholder="https://x.com/..."
            value={footerSettings.social_twitter ?? ''} onChange={(v) => setFooterSettings((p) => ({ ...p, social_twitter: v || null }))} />
          <SocialField icon={<Youtube className="w-4 h-4" />} label="YouTube" placeholder="https://youtube.com/@..."
            value={footerSettings.social_youtube ?? ''} onChange={(v) => setFooterSettings((p) => ({ ...p, social_youtube: v || null }))} />
        </div>
      </section>

      {/* Locked elements notice */}
      <section className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">System-Controlled Footer Elements</h2>
        <p className="text-xs text-gray-500 mb-3">
          The following footer elements are always rendered by the system and cannot be removed by tenant admins.
        </p>
        <ul className="space-y-1.5">
          {LOCKED_ELEMENTS.map((el) => (
            <li key={el} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
              {el}
            </li>
          ))}
        </ul>
      </section>

      {/* Save footer settings */}
      {footerError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {footerError}
        </div>
      )}
      {footerSaved && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> Footer settings saved.
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={handleSaveFooterSettings} disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white px-6">
          {isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</> : 'Save Footer Settings'}
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function OfficeForm({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  saved,
  error,
  submitLabel,
}: {
  value: OfficeInput
  onChange: (v: OfficeInput) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  saved: boolean
  error: string | null
  submitLabel: string
}) {
  function set<K extends keyof OfficeInput>(field: K, val: OfficeInput[K]) {
    onChange({ ...value, [field]: val })
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="office_name" className="text-xs">Office Name <span className="text-red-500">*</span></Label>
          <Input id="office_name" value={value.officeName} onChange={(e) => set('officeName', e.target.value)} placeholder="Head Office" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_phone" className="text-xs">Phone</Label>
          <Input id="office_phone" value={value.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+1 403.303.3316" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_addr1" className="text-xs">Address Line 1</Label>
          <Input id="office_addr1" value={value.address1 ?? ''} onChange={(e) => set('address1', e.target.value)} placeholder="116 2 Ave W" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_addr2" className="text-xs">Address Line 2</Label>
          <Input id="office_addr2" value={value.address2 ?? ''} onChange={(e) => set('address2', e.target.value)} placeholder="Suite 200" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_city" className="text-xs">City</Label>
          <Input id="office_city" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Calgary" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_province" className="text-xs">Province / State</Label>
          <Input id="office_province" value={value.province ?? ''} onChange={(e) => set('province', e.target.value)} placeholder="Alberta" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_postal" className="text-xs">Postal Code</Label>
          <Input id="office_postal" value={value.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} placeholder="T1R 0R9" className="text-sm h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="office_country" className="text-xs">Country</Label>
          <Input id="office_country" value={value.country ?? 'Canada'} onChange={(e) => set('country', e.target.value)} placeholder="Canada" className="text-sm h-8" />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
        <input
          type="checkbox"
          checked={value.isPrimary ?? false}
          onChange={(e) => set('isPrimary', e.target.checked)}
          className="h-4 w-4"
        />
        <Star className="w-3.5 h-3.5 text-amber-500" />
        Set as primary office
      </label>
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>
      )}
      {saved && (
        <p className="text-xs text-green-700 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Saved successfully.</p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white h-8">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-8 text-gray-600">Cancel</Button>
      </div>
    </div>
  )
}

function SocialField({
  icon,
  label,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5 text-gray-700">
        <span className="text-gray-400">{icon}</span> {label}
      </Label>
      <Input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm h-8"
      />
    </div>
  )
}
