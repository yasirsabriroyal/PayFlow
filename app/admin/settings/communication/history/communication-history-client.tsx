'use client'

import { useEffect, useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Mail,
  MessageSquare,
  Smartphone,
  Bell,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import {
  getCommunicationHistory,
  type CommunicationLogRow,
  type CommunicationLogPage,
} from './actions'

const CHANNELS = [
  { value: 'all', label: 'All channels' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'in_app', label: 'In-app' },
]

const STATUSES = [
  { value: 'all', label: 'All statuses' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
]

function channelIcon(channel: string) {
  switch (channel) {
    case 'email':
      return <Mail className="w-4 h-4 text-gray-500" />
    case 'sms':
      return <Smartphone className="w-4 h-4 text-gray-500" />
    case 'whatsapp':
      return <MessageSquare className="w-4 h-4 text-gray-500" />
    default:
      return <Bell className="w-4 h-4 text-gray-500" />
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    delivered: 'bg-green-100 text-green-700 border-green-200',
    sent: 'bg-blue-100 text-blue-700 border-blue-200',
    simulated: 'bg-blue-100 text-blue-700 border-blue-200',
    failed: 'bg-red-100 text-red-700 border-red-200',
    bounced: 'bg-red-100 text-red-700 border-red-200',
    complained: 'bg-amber-100 text-amber-700 border-amber-200',
    skipped: 'bg-gray-100 text-gray-600 border-gray-200',
    deferred: 'bg-amber-100 text-amber-700 border-amber-200',
  }
  const cls = styles[status] || 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  )
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CommunicationHistoryClient() {
  const [channel, setChannel] = useState('all')
  const [status, setStatus] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<CommunicationLogRow | null>(null)

  // Debounce the free-text search so we don't query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const [data, setData] = useState<CommunicationLogPage | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await getCommunicationHistory({ channel, status, search, page })
      if (!res || !('success' in res) || !res.success) {
        throw new Error((res && 'error' in res && res.error) || 'Failed to load')
      }
      setData(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [channel, status, search, page])

  useEffect(() => {
    load()
  }, [load])

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search recipient or subject…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-3">
          <Select
            value={channel}
            onValueChange={(v) => {
              setChannel(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {error ? (
          <div className="flex items-center gap-2 justify-center py-12 text-red-600">
            <AlertCircle className="w-5 h-5" />
            Failed to load communication history.
          </div>
        ) : isLoading && rows.length === 0 ? (
          <div className="flex items-center gap-2 justify-center py-12 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No communications found for these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Channel</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 capitalize">
                        {channelIcon(r.channel)}
                        <span className="text-gray-700">{r.channel.replace('_', '-')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.recipientName}</div>
                      {r.recipientEmail && (
                        <div className="text-xs text-gray-500">{r.recipientEmail}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="truncate text-gray-700">{r.subject || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelected(r)
                        }}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <DetailDialog row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm text-gray-900 text-right break-words">{value}</span>
    </div>
  )
}

function DetailDialog({ row, onClose }: { row: CommunicationLogRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {channelIcon(row.channel)}
                {row.subject || 'Notification'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <DetailRow label="Status" value={<StatusBadge status={row.status} />} />
                <DetailRow label="Recipient" value={row.recipientName} />
                {row.recipientEmail && <DetailRow label="Email" value={row.recipientEmail} />}
                {row.recipientRole && (
                  <DetailRow label="Role" value={<span className="capitalize">{row.recipientRole.replace('_', ' ')}</span>} />
                )}
                <DetailRow label="Event" value={<span className="capitalize">{row.eventType.replace(/_/g, ' ')}</span>} />
                {row.templateKey && (
                  <DetailRow
                    label="Template"
                    value={`${row.templateKey}${row.templateVersion ? ` (v${row.templateVersion})` : ''}`}
                  />
                )}
                <DetailRow label="Created" value={formatDate(row.createdAt)} />
                <DetailRow label="Sent" value={formatDate(row.sentAt)} />
                <DetailRow label="Delivered" value={formatDate(row.deliveredAt)} />
                {row.failedAt && <DetailRow label="Failed" value={formatDate(row.failedAt)} />}
                {row.externalMessageId && (
                  <DetailRow
                    label="Provider ID"
                    value={<span className="font-mono text-xs">{row.externalMessageId}</span>}
                  />
                )}
              </div>

              {row.errorMessage && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{row.errorMessage}</span>
                </div>
              )}

              {row.ccRecipients && row.ccRecipients.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Copied (CC)</h3>
                  <div className="flex flex-wrap gap-2">
                    {row.ccRecipients.map((cc, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs text-gray-600"
                      >
                        {cc.name || cc.email}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {row.channel === 'email' && row.emailBody ? (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Rendered Message</h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                    <iframe
                      title="Email content"
                      srcDoc={row.emailBody}
                      sandbox=""
                      className="w-full h-80 bg-white"
                    />
                  </div>
                </div>
              ) : row.messagePreview ? (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Message</h3>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-3">
                    {row.messagePreview}
                  </p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
