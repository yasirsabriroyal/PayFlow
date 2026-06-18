'use client'

import { useState, useEffect, useCallback } from 'react'
import { renderNotificationPreview, getPreviewSampleData } from '@/app/admin/settings/communication/actions'
import { Button } from '@/components/ui/button'
import { Mail, Loader2, Users, FileText, RefreshCw, ChevronDown } from 'lucide-react'

const TEMPLATE_OPTIONS: { key: string; label: string; vendor?: boolean; internal?: boolean }[] = [
  { key: 'invoice_submitted',       label: 'Invoice Submitted',           vendor: true,  internal: true },
  { key: 'invoice_approved',        label: 'Invoice Approved',            vendor: true,  internal: true },
  { key: 'invoice_rejected',        label: 'Invoice Rejected',            vendor: true,  internal: true },
  { key: 'revision_requested',      label: 'Revision Requested',          vendor: true,  internal: true },
  { key: 'payment_confirmation',    label: 'Payment Confirmation',        vendor: true,  internal: true },
  { key: 'payment_run_confirmation',label: 'Payment Run Confirmation',    vendor: false, internal: true },
  { key: 'contractor_invite',       label: 'Contractor Invitation',       vendor: true,  internal: false },
  { key: 'welcome',                 label: 'Welcome / Account Created',   vendor: true,  internal: false },
  { key: 'compliance_reminder',     label: 'Compliance Document Reminder',vendor: true,  internal: false },
  { key: 'password_reset',          label: 'Password Reset',              vendor: true,  internal: false },
]

const RECIPIENT_ROLES = [
  { value: 'vendor',   label: 'Contractor / Vendor', audience: 'vendor'    as const },
  { value: 'admin',    label: 'Administrator',        audience: 'internal'  as const },
  { value: 'accountant',label: 'Accountant',          audience: 'internal'  as const },
  { value: 'pm',       label: 'Project Manager',      audience: 'internal'  as const },
]

type SampleData = {
  projects: { id: string; name: string; project_number: string }[]
  contractors: { id: string; company_name: string; contact_name: string; email: string }[]
  invoices: { id: string; invoice_number: string; total_cents: number; status: string; contractor_id: string; project_id: string }[]
  users: { id: string; first_name: string; last_name: string; email: string; role: string }[]
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

export function NotificationPreview() {
  const [templateKey, setTemplateKey] = useState('invoice_approved')
  const [recipientRole, setRecipientRole] = useState<typeof RECIPIENT_ROLES[number]>(RECIPIENT_ROLES[0])
  const [sampleData, setSampleData] = useState<SampleData | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedContractorId, setSelectedContractorId] = useState<string>('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('')
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewSubject, setPreviewSubject] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      const res = await getPreviewSampleData()
      if (res && 'success' in res && res.success) {
        setSampleData(res as unknown as SampleData)
        // Auto-select first available items
        if (res.projects.length > 0) setSelectedProjectId(res.projects[0].id)
        if (res.contractors.length > 0) setSelectedContractorId(res.contractors[0].id)
        if (res.invoices.length > 0) setSelectedInvoiceId(res.invoices[0].id)
      }
      setDataLoading(false)
    }
    loadData()
  }, [])

  const buildSampleVars = useCallback((): Record<string, string> => {
    if (!sampleData) return {}
    const project = sampleData.projects.find((p) => p.id === selectedProjectId)
    const contractor = sampleData.contractors.find((c) => c.id === selectedContractorId)
    const invoice = sampleData.invoices.find((i) => i.id === selectedInvoiceId)
    const vars: Record<string, string> = {}
    if (project) {
      vars.project_name = project.name
      vars.project_number = project.project_number
    }
    if (contractor) {
      vars.vendor_name = contractor.company_name
      vars.recipient_name = contractor.company_name
    }
    if (invoice) {
      vars.invoice_number = invoice.invoice_number
      vars.invoice_total = formatCents(invoice.total_cents)
      vars.invoice_status = invoice.status
    }
    return vars
  }, [sampleData, selectedProjectId, selectedContractorId, selectedInvoiceId])

  const runPreview = useCallback(async () => {
    setError(null)
    setLoading(true)
    const vars = buildSampleVars()
    const res = await renderNotificationPreview(templateKey, recipientRole.audience, vars)
    setLoading(false)
    if (res && 'success' in res && res.success && 'html' in res) {
      setPreviewHtml(res.html as string)
      setPreviewSubject(typeof res.subject === 'string' ? res.subject : '')
    } else {
      setError(res && 'error' in res ? String(res.error) : 'Preview failed.')
    }
  }, [templateKey, recipientRole, buildSampleVars])

  // Auto-refresh preview when selections change
  useEffect(() => {
    if (!dataLoading) runPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, recipientRole, selectedProjectId, selectedContractorId, selectedInvoiceId, dataLoading])

  // Recipient inspector — show who would receive this event
  const recipientInspector = (() => {
    const template = TEMPLATE_OPTIONS.find((t) => t.key === templateKey)
    if (!template) return []
    const rows: { role: string; audience: string; templateKey: string }[] = []
    if (template.vendor) rows.push({ role: 'Contractor / Vendor', audience: 'Vendor-facing copy', templateKey: `${templateKey}_vendor` })
    if (template.internal) {
      rows.push({ role: 'Accountant', audience: 'Internal copy', templateKey: `${templateKey}_accountant` })
      rows.push({ role: 'Project Manager', audience: 'Internal copy', templateKey: `${templateKey}_pm` })
      rows.push({ role: 'Administrator', audience: 'Internal copy', templateKey: `${templateKey}_admin` })
    }
    return rows
  })()

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
      {/* Left: filters + inspector */}
      <div className="space-y-4">
        {/* Event picker */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-400" /> Notification Event
          </h3>
          <div className="relative">
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TEMPLATE_OPTIONS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Recipient role picker */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-400" /> Recipient Role
          </h3>
          <div className="space-y-1">
            {RECIPIENT_ROLES.map((role) => {
              const template = TEMPLATE_OPTIONS.find((t) => t.key === templateKey)
              const available = role.audience === 'vendor' ? template?.vendor : template?.internal
              return (
                <label
                  key={role.value}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                    recipientRole.value === role.value
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : available
                      ? 'text-gray-700 hover:bg-gray-50'
                      : 'text-gray-400 cursor-not-allowed opacity-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="recipient_role"
                    value={role.value}
                    checked={recipientRole.value === role.value}
                    disabled={!available}
                    onChange={() => setRecipientRole(role)}
                    className="h-3.5 w-3.5"
                  />
                  {role.label}
                  {!available && <span className="text-xs text-gray-400 ml-auto">N/A</span>}
                </label>
              )
            })}
          </div>
        </div>

        {/* Sample data selectors */}
        {!dataLoading && sampleData && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" /> Sample Data
            </h3>
            <p className="text-xs text-gray-500">Uses real data to populate merge fields.</p>
            {sampleData.projects.length > 0 && (
              <SelectField
                label="Project"
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                options={sampleData.projects.map((p) => ({ value: p.id, label: `${p.project_number} – ${p.name}` }))}
              />
            )}
            {sampleData.contractors.length > 0 && (
              <SelectField
                label="Contractor"
                value={selectedContractorId}
                onChange={setSelectedContractorId}
                options={sampleData.contractors.map((c) => ({ value: c.id, label: c.company_name }))}
              />
            )}
            {sampleData.invoices.length > 0 && (
              <SelectField
                label="Invoice"
                value={selectedInvoiceId}
                onChange={setSelectedInvoiceId}
                options={sampleData.invoices.map((i) => ({ value: i.id, label: `${i.invoice_number} — ${formatCents(i.total_cents)}` }))}
              />
            )}
          </div>
        )}

        {/* Recipient inspector */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Recipient Inspector</h3>
          <p className="text-xs text-gray-500">
            All roles that receive this event and the template copy they see.
          </p>
          <div className="divide-y divide-gray-100">
            {recipientInspector.map((row) => (
              <div key={row.role} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-800">{row.role}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    row.audience === 'Vendor-facing copy'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {row.audience}
                  </span>
                </div>
                <code className="text-xs text-gray-400 font-mono">{row.templateKey}</code>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: live email preview */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Mail className="w-4 h-4 text-gray-500" /> Live Email Preview
          </div>
          <div className="flex items-center gap-2">
            {previewSubject && (
              <span className="text-xs text-gray-500 truncate max-w-[260px]">
                Subject: <span className="text-gray-700 font-medium">{previewSubject}</span>
              </span>
            )}
            {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
            <Button size="sm" variant="ghost" onClick={runPreview} disabled={loading} className="h-7 w-7 p-0">
              <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
              <span className="sr-only">Refresh preview</span>
            </Button>
          </div>
        </div>

        {error ? (
          <div className="p-6 text-center text-red-600 text-sm">{error}</div>
        ) : previewHtml ? (
          <iframe
            title="Email preview"
            srcDoc={previewHtml}
            className="w-full h-[700px] bg-white"
            sandbox=""
          />
        ) : (
          <div className="h-[700px] flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Generating preview…' : 'Select an event and role to preview.'}
          </div>
        )}
      </div>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white pr-7 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>
    </div>
  )
}
