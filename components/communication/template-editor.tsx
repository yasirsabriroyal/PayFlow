'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  getTemplateForEditing,
  renderTemplatePreview,
  saveTemplate,
  resetTemplate,
} from '@/app/admin/settings/communication/actions'
import {
  TEMPLATE_CATALOG,
  TEMPLATE_KEYS,
  type TemplateKey,
  type TemplateSlots,
  type MergeField,
} from '@/lib/email/templates/catalog'
import {
  Mail,
  Loader2,
  CheckCircle,
  Info,
  RotateCcw,
  Lock,
  FileText,
} from 'lucide-react'

const EMPTY_SLOTS: TemplateSlots = { subject: '', opening: '', closing: '', help: '', notes: '' }

// Group the catalog keys by category for the sidebar list.
const GROUPED = TEMPLATE_KEYS.reduce<Record<string, TemplateKey[]>>((acc, key) => {
  const cat = TEMPLATE_CATALOG[key].category
  ;(acc[cat] ??= []).push(key)
  return acc
}, {})
const CATEGORY_ORDER = ['Onboarding', 'Invoices', 'Payments', 'Compliance', 'Account']

export function TemplateEditor() {
  const [activeKey, setActiveKey] = useState<TemplateKey>('payment_confirmation')
  const [slots, setSlots] = useState<TemplateSlots>(EMPTY_SLOTS)
  const [defaults, setDefaults] = useState<TemplateSlots>(EMPTY_SLOTS)
  const [mergeFields, setMergeFields] = useState<MergeField[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const def = TEMPLATE_CATALOG[activeKey]

  // Load the selected template's editable slots.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSaved(false)
    setError(null)
    getTemplateForEditing(activeKey).then((res) => {
      if (cancelled) return
      if (res && 'success' in res && res.success) {
        setSlots(res.slots)
        setDefaults(res.defaults)
        setMergeFields(res.mergeFields)
      } else {
        setError((res && 'error' in res && res.error) || 'Failed to load template.')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeKey])

  const refreshPreview = useCallback(
    async (key: TemplateKey, current: TemplateSlots) => {
      setPreviewLoading(true)
      try {
        const res = await renderTemplatePreview(key, current)
        if (res && 'html' in res && res.html) setPreviewHtml(res.html)
      } catch {
        /* preview is best-effort */
      } finally {
        setPreviewLoading(false)
      }
    },
    []
  )

  // Debounced live preview whenever slots change (after initial load).
  useEffect(() => {
    if (loading) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => refreshPreview(activeKey, slots), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [slots, activeKey, loading, refreshPreview])

  function handleSlot<K extends keyof TemplateSlots>(field: K, value: string) {
    setSlots((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await saveTemplate(activeKey, slots)
      if (res && 'success' in res && res.success) {
        setSaved(true)
      } else {
        throw new Error((res && 'error' in res && res.error) || 'Failed to save template.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    setError(null)
    setSaved(false)
    try {
      const res = await resetTemplate(activeKey)
      if (res && 'success' in res && res.success) {
        // Reload the now-default slots into the editor.
        const reload = await getTemplateForEditing(activeKey)
        if (reload && 'success' in reload && reload.success) setSlots(reload.slots)
      } else {
        throw new Error((res && 'error' in res && res.error) || 'Failed to reset template.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      setResetting(false)
    }
  }

  const isModified =
    slots.subject !== defaults.subject ||
    slots.opening !== defaults.opening ||
    slots.closing !== defaults.closing ||
    slots.help !== defaults.help ||
    slots.notes !== defaults.notes

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_1fr] gap-6 items-start">
      {/* LEFT: template list */}
      <nav className="bg-white border border-gray-200 rounded-xl p-3 lg:sticky lg:top-6" aria-label="Email templates">
        {CATEGORY_ORDER.filter((c) => GROUPED[c]?.length).map((cat) => (
          <div key={cat} className="mb-3 last:mb-0">
            <p className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">{cat}</p>
            <ul>
              {GROUPED[cat].map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setActiveKey(key)}
                    aria-current={key === activeKey}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                      key === activeKey
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {TEMPLATE_CATALOG[key].label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* MIDDLE: editor */}
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">{def.label}</h2>
              <p className="text-sm text-gray-500">{def.description}</p>
            </div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading template…</div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="tpl-subject">Subject Line</Label>
                <Input
                  id="tpl-subject"
                  value={slots.subject}
                  onChange={(e) => handleSlot('subject', e.target.value)}
                  placeholder={defaults.subject}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-opening">Opening Message</Label>
                <Textarea
                  id="tpl-opening"
                  value={slots.opening}
                  onChange={(e) => handleSlot('opening', e.target.value)}
                  rows={3}
                  placeholder={defaults.opening}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-closing">Closing Message</Label>
                <Textarea
                  id="tpl-closing"
                  value={slots.closing}
                  onChange={(e) => handleSlot('closing', e.target.value)}
                  rows={2}
                  placeholder={defaults.closing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-help">Help / Support Text</Label>
                <Textarea
                  id="tpl-help"
                  value={slots.help}
                  onChange={(e) => handleSlot('help', e.target.value)}
                  rows={2}
                  placeholder={defaults.help}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-notes">Additional Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
                <Textarea
                  id="tpl-notes"
                  value={slots.notes}
                  onChange={(e) => handleSlot('notes', e.target.value)}
                  rows={2}
                  placeholder="Shown below the details, if provided."
                />
              </div>

              <div className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
                <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  The payment / invoice details table, audit fields, security disclaimer, and footer are
                  system-controlled and always included — they cannot be edited or removed.
                </span>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
              )}
              {saved && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" /> Template saved successfully.
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleReset}
                  disabled={resetting || !isModified}
                  className="text-gray-600 hover:text-gray-900 px-2"
                >
                  {resetting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  <span className="ml-1.5">Reset to default</span>
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                >
                  {saving ? 'Saving…' : 'Save Template'}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Placeholder guide */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Info className="w-4 h-4 text-gray-500" /> Available Placeholders
          </div>
          <p className="text-xs text-gray-500">
            Type these tokens into any field above. They are replaced with real values when the email is sent.
          </p>
          <div className="divide-y divide-gray-100">
            {mergeFields.map((f) => (
              <div key={f.token} className="flex items-baseline justify-between gap-4 py-2">
                <code className="text-xs font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{f.token}</code>
                <span className="text-xs text-gray-500 text-right">{f.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: live preview */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden lg:sticky lg:top-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Mail className="w-4 h-4 text-gray-500" /> Live Email Preview
          </div>
          {previewLoading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
        </div>
        {previewHtml ? (
          <iframe title="Template preview" srcDoc={previewHtml} className="w-full h-[720px] bg-white" sandbox="" />
        ) : (
          <div className="h-[720px] flex items-center justify-center text-gray-400 text-sm">Generating preview…</div>
        )}
      </div>
    </div>
  )
}
