'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  TEMPLATE_CATALOG,
  TEMPLATE_KEYS,
  type TemplateKey,
  type TemplateSlots,
  type MergeField,
} from '@/lib/email/templates/catalog'
import {
  getTemplateForEditing,
  renderTemplatePreview,
  saveTemplate,
  resetTemplate,
} from '@/app/admin/settings/communication/actions'
import {
  Mail,
  Info,
  Loader2,
  CheckCircle,
  RotateCcw,
  ShieldCheck,
  FileText,
} from 'lucide-react'

const EMPTY_SLOTS: TemplateSlots = { subject: '', opening: '', closing: '', help: '', notes: '' }

/** Group catalog keys by their UI category, preserving catalog order. */
function groupedKeys(): { category: string; keys: TemplateKey[] }[] {
  const groups: Record<string, TemplateKey[]> = {}
  for (const key of TEMPLATE_KEYS) {
    const cat = TEMPLATE_CATALOG[key].category
    ;(groups[cat] ??= []).push(key)
  }
  return Object.entries(groups).map(([category, keys]) => ({ category, keys }))
}

export function TemplateEditor() {
  const [activeKey, setActiveKey] = useState<TemplateKey>(TEMPLATE_KEYS[0])
  const [slots, setSlots] = useState<TemplateSlots>(EMPTY_SLOTS)
  const [defaults, setDefaults] = useState<TemplateSlots>(EMPTY_SLOTS)
  const [mergeFields, setMergeFields] = useState<MergeField[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const def = TEMPLATE_CATALOG[activeKey]

  // Load saved slots whenever the selected template changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSaved(false)
    setError(null)
    ;(async () => {
      const res = await getTemplateForEditing(activeKey)
      if (cancelled) return
      if (res && 'success' in res && res.success) {
        setSlots(res.slots)
        setDefaults(res.defaults)
        setMergeFields(res.mergeFields)
      } else {
        setError('error' in (res ?? {}) ? (res as { error: string }).error : 'Failed to load template')
      }
      setLoading(false)
    })()
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

  // Debounced live preview after each edit / template switch.
  useEffect(() => {
    if (loading) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => refreshPreview(activeKey, slots), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [slots, activeKey, loading, refreshPreview])

  function handleSlotChange<K extends keyof TemplateSlots>(field: K, value: string) {
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
      if (res && 'success' in res && res.success) setSaved(true)
      else throw new Error(res && 'error' in res ? (res as { error: string }).error : 'Failed to save')
    } catch (e: any) {
      setError(e.message || 'Failed to save template')
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
        // Re-pull defaults into the editor.
        const reload = await getTemplateForEditing(activeKey)
        if (reload && 'success' in reload && reload.success) setSlots(reload.slots)
        setSaved(true)
      } else {
        throw new Error(res && 'error' in res ? (res as { error: string }).error : 'Failed to reset')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to reset template')
    } finally {
      setResetting(false)
    }
  }

  const groups = groupedKeys()

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
      {/* LEFT: template list */}
      <nav className="bg-white border border-gray-200 rounded-xl p-3 lg:sticky lg:top-6">
        <p className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Templates</p>
        <div className="space-y-4 mt-1">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="px-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {g.category}
              </p>
              <ul className="space-y-0.5">
                {g.keys.map((key) => {
                  const isActive = key === activeKey
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setActiveKey(key)}
                        className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                          isActive
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        {TEMPLATE_CATALOG[key].label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* RIGHT: editor + preview */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Editor */}
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-gray-900">{def.label}</h3>
              <p className="text-sm text-gray-500">{def.description}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              You can edit the wording below. Required details (payment amounts, status, invoice and audit
              information) are always included automatically and cannot be removed.
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading template…
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <SlotField
                id="subject"
                label="Subject Line"
                value={slots.subject}
                placeholder={defaults.subject}
                onChange={(v) => handleSlotChange('subject', v)}
                single
              />
              <SlotField
                id="opening"
                label="Opening"
                hint="The first paragraph, shown above the details."
                value={slots.opening}
                placeholder={defaults.opening}
                onChange={(v) => handleSlotChange('opening', v)}
              />
              <SlotField
                id="closing"
                label="Closing"
                hint="Shown below the details, before the help section."
                value={slots.closing}
                placeholder={defaults.closing}
                onChange={(v) => handleSlotChange('closing', v)}
              />
              <SlotField
                id="help"
                label="Help Text"
                hint="A short line guiding recipients who have questions."
                value={slots.help}
                placeholder={defaults.help}
                onChange={(v) => handleSlotChange('help', v)}
              />
              <SlotField
                id="notes"
                label="Notes (optional)"
                hint="Any extra fine print. Leave blank to omit."
                value={slots.notes}
                placeholder={defaults.notes}
                onChange={(v) => handleSlotChange('notes', v)}
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}
          {saved && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              <CheckCircle className="w-4 h-4 flex-shrink-0" /> Template saved.
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleReset}
              disabled={resetting || loading}
              className="text-gray-600 hover:text-gray-900 gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              {resetting ? 'Resetting…' : 'Reset to default'}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6"
            >
              {saving ? 'Saving…' : 'Save Template'}
            </Button>
          </div>

          {/* Merge fields for this template */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Info className="w-4 h-4 text-gray-500" /> Available Placeholders
            </div>
            <p className="text-xs text-gray-500">
              Type these into any field. They are replaced with real values when the email is sent.
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

        {/* Live preview */}
        <div className="lg:sticky lg:top-6">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Mail className="w-4 h-4 text-gray-500" /> Live Email Preview
              </div>
              {previewLoading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
            </div>
            {previewHtml ? (
              <iframe title="Template preview" srcDoc={previewHtml} className="w-full h-[680px] bg-white" sandbox="" />
            ) : (
              <div className="h-[680px] flex items-center justify-center text-gray-400 text-sm">
                Generating preview…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SlotField({
  id,
  label,
  hint,
  value,
  placeholder,
  onChange,
  single,
}: {
  id: string
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  single?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {single ? (
        <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="resize-y"
        />
      )}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
