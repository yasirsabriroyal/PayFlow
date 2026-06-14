'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCompanySettings, updateCompanySettings } from '@/app/admin/actions'
import { renderBrandingPreview } from './actions'
import { TemplateEditor } from '@/components/communication/template-editor'
import { Palette, CheckCircle, Lock, AlertTriangle, Loader2, Mail, ExternalLink, Info } from 'lucide-react'

interface BrandingForm {
  company_name: string
  legal_name: string
  sender_display_name: string
  support_contact: string
  email: string
  primary_color: string
  accent_color: string
  white_label_enabled: boolean
}

const DEFAULT_PRIMARY = '#334155'
const DEFAULT_ACCENT = '#059669'
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const EMPTY_FORM: BrandingForm = {
  company_name: '',
  legal_name: '',
  sender_display_name: '',
  support_contact: '',
  email: '',
  primary_color: DEFAULT_PRIMARY,
  accent_color: DEFAULT_ACCENT,
  white_label_enabled: false,
}

// Merge fields available to template authors / shown for transparency.
const MERGE_FIELDS: { token: string; description: string }[] = [
  { token: '{{vendor_name}}', description: 'Recipient vendor / contractor name' },
  { token: '{{invoice_number}}', description: 'Invoice reference number' },
  { token: '{{project_name}}', description: 'Associated project name' },
  { token: '{{payment_amount}}', description: 'Amount paid in this transaction' },
  { token: '{{remaining_balance}}', description: 'Outstanding balance after payment' },
  { token: '{{payment_date}}', description: 'Date the payment was issued' },
  { token: '{{payment_reference}}', description: 'EFT / cheque / batch reference' },
  { token: '{{processed_by}}', description: 'Name of the AP user who issued payment' },
]

/** WCAG relative luminance + contrast ratio for white text on a brand color. */
function contrastWithWhite(hex: string): number | null {
  if (!HEX.test(hex)) return null
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const toLin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = toLin(parseInt(h.slice(0, 2), 16))
  const g = toLin(parseInt(h.slice(2, 4), 16))
  const b = toLin(parseInt(h.slice(4, 6), 16))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // White luminance is 1.0
  return Math.round(((1.0 + 0.05) / (lum + 0.05)) * 100) / 100
}

export default function BrandingCenterPage() {
  const [view, setView] = useState<'branding' | 'templates'>('branding')
  const [form, setForm] = useState<BrandingForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      const result = await getCompanySettings()
      if (result && 'settings' in result && result.settings) {
        const s = result.settings as Record<string, string | boolean | null>
        setForm({
          company_name: (s.company_name as string) ?? '',
          legal_name: (s.legal_name as string) ?? '',
          sender_display_name: (s.sender_display_name as string) ?? '',
          support_contact: (s.support_contact as string) ?? '',
          email: (s.email as string) ?? '',
          primary_color: (s.primary_color as string) || DEFAULT_PRIMARY,
          accent_color: (s.accent_color as string) || DEFAULT_ACCENT,
          white_label_enabled: s.white_label_enabled === true,
        })
      }
      setLoading(false)
    }
    load()
  }, [])

  const refreshPreview = useCallback(async (current: BrandingForm) => {
    setPreviewLoading(true)
    try {
      const res = await renderBrandingPreview({
        companyName: current.company_name,
        legalName: current.legal_name,
        senderDisplayName: current.sender_display_name,
        supportContact: current.support_contact,
        supportEmail: current.email,
        primaryColor: current.primary_color,
        accentColor: current.accent_color,
        whiteLabelEnabled: current.white_label_enabled,
      })
      if (res && 'html' in res && res.html) setPreviewHtml(res.html)
    } catch {
      /* preview is best-effort */
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  // Debounced live preview whenever the form changes (after initial load).
  useEffect(() => {
    if (loading) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => refreshPreview(form), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [form, loading, refreshPreview])

  function handleChange<K extends keyof BrandingForm>(field: K, value: BrandingForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const result = await updateCompanySettings({
        company_name: form.company_name,
        legal_name: form.legal_name,
        sender_display_name: form.sender_display_name,
        support_contact: form.support_contact,
        primary_color: HEX.test(form.primary_color) ? form.primary_color : DEFAULT_PRIMARY,
        accent_color: HEX.test(form.accent_color) ? form.accent_color : DEFAULT_ACCENT,
        // white_label_enabled is intentionally NOT sent here: it is plan-gated (Phase 5).
      })
      if (result && 'success' in result && result.success) {
        setSaved(true)
      } else {
        throw new Error(result && 'error' in result && typeof result.error === 'string' ? result.error : 'Failed to save branding.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
    } finally {
      setSaving(false)
    }
  }

  const primaryContrast = contrastWithWhite(form.primary_color)
  const lowContrast = primaryContrast !== null && primaryContrast < 4.5

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader pageTitle="Communication & Branding" />
      <RoleTabBar role="admin" />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Palette className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Communication &amp; Branding</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6 max-w-2xl">
          Control how outbound emails to vendors look and who they appear to come from. Changes preview live on the
          right and apply to every transactional email once saved.
        </p>

        {/* Section switcher: global branding vs. per-template copy */}
        <div className="inline-flex items-center gap-1 p-1 mb-6 bg-gray-100 rounded-lg">
          <button
            type="button"
            onClick={() => setView('branding')}
            aria-current={view === 'branding'}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              view === 'branding' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Branding
          </button>
          <button
            type="button"
            onClick={() => setView('templates')}
            aria-current={view === 'templates'}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              view === 'templates' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Email Templates
          </button>
        </div>

        {view === 'templates' ? (
          <TemplateEditor />
        ) : loading ? (
          <div className="text-center py-12 text-gray-500">Loading branding…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* LEFT: form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Brand identity */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Brand Identity</h2>
                <div className="space-y-2">
                  <Label htmlFor="company_name">Display Name <span className="text-red-500">*</span></Label>
                  <Input id="company_name" value={form.company_name} required
                    onChange={(e) => handleChange('company_name', e.target.value)} placeholder="Royal Development" />
                  <p className="text-xs text-gray-500">Trading name shown in the email header.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legal_name">Legal Name</Label>
                  <Input id="legal_name" value={form.legal_name}
                    onChange={(e) => handleChange('legal_name', e.target.value)} placeholder="Royal Development Group Ltd." />
                  <p className="text-xs text-gray-500">Registered entity name used in footer disclaimers.</p>
                </div>
              </div>

              {/* Sender identity */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Sender Identity</h2>
                <div className="space-y-2">
                  <Label htmlFor="sender_display_name">Sender Display Name</Label>
                  <Input id="sender_display_name" value={form.sender_display_name}
                    onChange={(e) => handleChange('sender_display_name', e.target.value)} placeholder="Royal Development AP" />
                  <p className="text-xs text-gray-500">The “From” label vendors see in their inbox.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support_contact">Support Contact</Label>
                  <Input id="support_contact" value={form.support_contact}
                    onChange={(e) => handleChange('support_contact', e.target.value)} placeholder="Accounts Payable Team" />
                  <p className="text-xs text-gray-500">Named contact shown in the help section of emails.</p>
                </div>
              </div>

              {/* Brand colors */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Brand Colors</h2>
                <div className="grid grid-cols-2 gap-4">
                  <ColorField label="Primary" hint="Header background" value={form.primary_color}
                    onChange={(v) => handleChange('primary_color', v)} />
                  <ColorField label="Accent" hint="Buttons & links" value={form.accent_color}
                    onChange={(v) => handleChange('accent_color', v)} />
                </div>
                {lowContrast && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      White header text on this primary color has a contrast ratio of{' '}
                      <strong>{primaryContrast}:1</strong>, below the WCAG AA minimum of 4.5:1. Choose a darker primary
                      color for readable header text.
                    </span>
                  </div>
                )}
              </div>

              {/* White-label (plan-gated) */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">White-Label Footer</h2>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    <Lock className="w-3 h-3" /> Plan feature
                  </span>
                </div>
                <label className="flex items-center gap-3 opacity-60 cursor-not-allowed">
                  <input type="checkbox" checked={form.white_label_enabled} disabled className="h-4 w-4" readOnly />
                  <span className="text-sm text-gray-700">Remove the “Powered by PayFlow” footer</span>
                </label>
                <p className="text-xs text-gray-500">
                  White-label removal is governed by your plan entitlement and unlocks in a later release. Until then,
                  the PayFlow footer is shown on all emails.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
              )}
              {saved && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" /> Branding saved successfully.
                </div>
              )}

              <div className="flex items-center justify-between gap-4">
                <a href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
                  Manage logo &amp; address <ExternalLink className="w-3 h-3" />
                </a>
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-6">
                  {saving ? 'Saving…' : 'Save Branding'}
                </Button>
              </div>
            </form>

            {/* RIGHT: live preview + merge fields */}
            <div className="space-y-6 lg:sticky lg:top-6">
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Mail className="w-4 h-4 text-gray-500" /> Live Email Preview
                  </div>
                  {previewLoading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
                </div>
                {previewHtml ? (
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="w-full h-[640px] bg-white"
                    sandbox=""
                  />
                ) : (
                  <div className="h-[640px] flex items-center justify-center text-gray-400 text-sm">
                    Generating preview…
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Info className="w-4 h-4 text-gray-500" /> Available Merge Fields
                </div>
                <p className="text-xs text-gray-500">
                  These placeholders are automatically replaced with real values when an email is sent.
                </p>
                <div className="divide-y divide-gray-100">
                  {MERGE_FIELDS.map((f) => (
                    <div key={f.token} className="flex items-baseline justify-between gap-4 py-2">
                      <code className="text-xs font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{f.token}</code>
                      <span className="text-xs text-gray-500 text-right">{f.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={HEX.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 rounded border border-gray-300 cursor-pointer bg-white p-0.5"
          aria-label={`${label} color picker`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#334155" className="font-mono" />
      </div>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  )
}
