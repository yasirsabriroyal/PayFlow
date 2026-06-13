'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import type { VendorInvoiceListItem } from '@/lib/actions/vendor-invoices'

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  submitted: { label: 'Submitted', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  pending_approval: { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-700 border-green-200' },
  partially_paid: { label: 'Partially Paid', className: 'bg-teal-100 text-teal-700 border-teal-200' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700 border-red-200' },
  disputed: { label: 'Disputed', className: 'bg-orange-100 text-orange-700 border-orange-200' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  )
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function VendorInvoiceList({ invoices }: { invoices: VendorInvoiceListItem[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const statuses = useMemo(
    () => Array.from(new Set(invoices.map((i) => i.status))),
    [invoices],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return invoices.filter((i) => {
      const matchesQuery =
        !q ||
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.projectName.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || i.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [invoices, query, statusFilter])

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-border flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by number or project"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap border transition-colors ${
              statusFilter === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:text-foreground'
            }`}
          >
            All
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap border transition-colors ${
                statusFilter === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {STATUS_MAP[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 sm:px-6 py-3 font-medium">Invoice</th>
              <th className="px-4 sm:px-6 py-3 font-medium">Project</th>
              <th className="px-4 sm:px-6 py-3 font-medium">Date</th>
              <th className="px-4 sm:px-6 py-3 font-medium text-right">Total</th>
              <th className="px-4 sm:px-6 py-3 font-medium text-right">Net Payable</th>
              <th className="px-4 sm:px-6 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                  No invoices match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => router.push(`/vendor/invoices/${inv.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 sm:px-6 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 sm:px-6 py-3 text-muted-foreground">{inv.projectName}</td>
                  <td className="px-4 sm:px-6 py-3 text-muted-foreground">{formatDate(inv.invoiceDate)}</td>
                  <td className="px-4 sm:px-6 py-3 text-right">{formatCurrency(inv.totalCents / 100)}</td>
                  <td className="px-4 sm:px-6 py-3 text-right">{formatCurrency(inv.netPayableCents / 100)}</td>
                  <td className="px-4 sm:px-6 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
