'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  amount_cents: number
  net_payable_cents: number
  created_at: string
  contractor: { company_name: string } | null
  project: { name: string } | null
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    paid:               { label: 'Paid',               className: 'bg-green-100 text-green-700 border-green-200' },
    approved:           { label: 'Approved',           className: 'bg-blue-100 text-blue-700 border-blue-200' },
    pending_approval:   { label: 'Pending Approval',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    submitted:          { label: 'Submitted',          className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    rejected:           { label: 'Rejected',           className: 'bg-red-100 text-red-700 border-red-200' },
    draft:              { label: 'Draft',              className: 'bg-gray-100 text-gray-600 border-gray-200' },
    payment_processing: { label: 'Processing',         className: 'bg-blue-100 text-blue-600 border-blue-200' },
    disputed:           { label: 'Disputed',           className: 'bg-red-100 text-red-700 border-red-200' },
  }
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  )
}

export function InvoiceTable({ invoices }: { invoices: InvoiceRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? invoices.filter(inv =>
        inv.invoice_number.toLowerCase().includes(query.toLowerCase()) ||
        (inv.contractor?.company_name ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : invoices

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search invoice # or contractor…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">{invoices.length === 0 ? 'No invoices found.' : 'No invoices match your search.'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contractor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Project</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Net Payable</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/accountant/invoices/${inv.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{inv.contractor?.company_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{inv.project?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(inv.amount_cents)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(inv.net_payable_cents)}</td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(inv.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
