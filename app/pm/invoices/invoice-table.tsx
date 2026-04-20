'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { EnrichedInvoiceRow, SummaryStats } from './page'

function fmt(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft:              { label: 'Draft',           className: 'bg-gray-100 text-gray-600 border-gray-200' },
    submitted:          { label: 'Submitted',        className: 'bg-amber-100 text-amber-700 border-amber-200' },
    pending_approval:   { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700 border-amber-200' },
    approved:           { label: 'Approved',         className: 'bg-blue-100 text-blue-700 border-blue-200' },
    paid:               { label: 'Paid',             className: 'bg-green-100 text-green-700 border-green-200' },
    rejected:           { label: 'Rejected',         className: 'bg-red-100 text-red-700 border-red-200' },
    disputed:           { label: 'Disputed',         className: 'bg-orange-100 text-orange-700 border-orange-200' },
    payment_processing: { label: 'Processing',       className: 'bg-blue-100 text-blue-600 border-blue-200' },
  }
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  )
}

export function InvoiceTable({ invoices, stats }: { invoices: EnrichedInvoiceRow[]; stats: SummaryStats }) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')

  const projects = Array.from(
    new Set(invoices.map((i) => i.project?.name).filter((n): n is string => Boolean(n)))
  )

  const filtered = invoices.filter((inv) => {
    const q = query.trim().toLowerCase()
    const matchesQuery =
      !q ||
      inv.invoice_number.toLowerCase().includes(q) ||
      (inv.contractor?.company_name ?? '').toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter
    const matchesProject = projectFilter === 'all' || inv.project?.name === projectFilter
    return matchesQuery && matchesStatus && matchesProject
  })

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-2xl font-bold text-blue-700">{stats.total_invoices}</p>
          <p className="text-sm text-blue-600 mt-0.5">Total Invoices</p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-700">{stats.pending_approval}</p>
          <p className="text-sm text-amber-600 mt-0.5">Pending Approval</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-blue-800">{stats.approved}</p>
          <p className="text-sm text-blue-700 mt-0.5">Approved</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
          <p className="text-2xl font-bold text-orange-700">{stats.certs_outstanding}</p>
          <p className="text-sm text-orange-600 mt-0.5">Certs Outstanding</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search invoice # or contractor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
          <option value="disputed">Disputed</option>
        </select>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">
              {invoices.length === 0
                ? 'No invoices found for your assigned projects.'
                : 'No invoices match your search.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contractor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Project</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Invoice Total</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Certified</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Remaining</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Certs</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((inv) => {
                const isFullyCertified = inv.remaining_to_certify_cents <= 0
                const isPartiallyCertified = !isFullyCertified && inv.total_certified_cents > 0
                const remainingColor = isFullyCertified
                  ? 'text-green-600 font-medium'
                  : isPartiallyCertified
                  ? 'text-orange-500 font-medium'
                  : 'text-red-500 font-medium'

                let rowClass = 'hover:bg-gray-50 transition-colors'
                if (inv.outstanding_certs > 0) {
                  rowClass += ' border-l-4 border-l-amber-400'
                } else if (inv.status === 'rejected') {
                  rowClass += ' border-l-4 border-l-red-400'
                } else if (inv.status === 'paid') {
                  rowClass += ' opacity-60'
                }

                return (
                  <tr key={inv.id} className={rowClass}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/pm/invoices/${inv.id}`}
                        className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{inv.contractor?.company_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{inv.project?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(inv.amount_cents)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(inv.total_certified_cents)}</td>
                    <td className={`px-4 py-3 text-right ${remainingColor}`}>
                      {fmt(Math.max(0, inv.remaining_to_certify_cents))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                        {inv.cert_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
