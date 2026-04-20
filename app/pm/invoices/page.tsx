'use client'

import { useState, useEffect } from 'react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { getPMInvoices } from '@/app/pm/actions'
import { InvoiceTable } from './invoice-table'
import { Loader2 } from 'lucide-react'

export interface EnrichedInvoiceRow {
  id: string
  invoice_number: string
  status: string
  amount_cents: number
  net_payable_cents: number
  holdback_amount_cents: number
  created_at: string
  contractor: { company_name: string } | null
  project: { name: string } | null
  total_certified_cents: number
  remaining_to_certify_cents: number
  cert_count: number
  outstanding_certs: number
}

export interface SummaryStats {
  total_invoices: number
  pending_approval: number
  approved: number
  certs_outstanding: number
}

type RawInvoice = {
  id: string
  invoice_number: string
  status: string
  amount_cents: number
  net_payable_cents: number
  holdback_amount_cents: number
  created_at: string
  contractor: { company_name: string } | { company_name: string }[] | null
  project: { name: string } | { name: string }[] | null
  payment_certificates: { id: string; certified_amount_cents: number; status: string }[] | null
}

export default function PMInvoicesPage() {
  const [invoices, setInvoices] = useState<EnrichedInvoiceRow[]>([])
  const [stats, setStats] = useState<SummaryStats>({
    total_invoices: 0,
    pending_approval: 0,
    approved: 0,
    certs_outstanding: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      const result = await getPMInvoices()
      if (result.success) {
        const raw = result.invoices as unknown as RawInvoice[]

        const rows: EnrichedInvoiceRow[] = raw.map((inv) => {
          const contractor = Array.isArray(inv.contractor)
            ? (inv.contractor[0] ?? null)
            : inv.contractor
          const project = Array.isArray(inv.project)
            ? (inv.project[0] ?? null)
            : inv.project
          const certs = Array.isArray(inv.payment_certificates)
            ? inv.payment_certificates
            : inv.payment_certificates
              ? [inv.payment_certificates]
              : []

          const total_certified_cents = certs.reduce(
            (sum, c) => sum + (c.certified_amount_cents ?? 0),
            0
          )
          const remaining_to_certify_cents = (inv.net_payable_cents ?? 0) - total_certified_cents
          const cert_count = certs.length
          const outstanding_certs = certs.filter((c) => c.status === 'approved').length

          return {
            id: inv.id,
            invoice_number: inv.invoice_number,
            status: inv.status,
            amount_cents: inv.amount_cents,
            net_payable_cents: inv.net_payable_cents,
            holdback_amount_cents: inv.holdback_amount_cents,
            created_at: inv.created_at,
            contractor: contractor as { company_name: string } | null,
            project: project as { name: string } | null,
            total_certified_cents,
            remaining_to_certify_cents,
            cert_count,
            outstanding_certs,
          }
        })

        const computedStats: SummaryStats = {
          total_invoices: rows.length,
          pending_approval: rows.filter((r) => r.status === 'submitted').length,
          approved: rows.filter((r) => r.status === 'approved').length,
          certs_outstanding: rows.reduce((sum, r) => sum + r.outstanding_certs, 0),
        }

        setInvoices(rows)
        setStats(computedStats)
      } else {
        setError('Failed to load invoices.')
      }
      setLoading(false)
    }

    loadData()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader pageTitle="Invoices" />
      <RoleTabBar role="project_manager" />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading ? 'Loading…' : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} across your assigned projects`}
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading invoices…
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-16 text-red-600 text-sm">{error}</div>
        )}

        {!loading && !error && (
          <InvoiceTable invoices={invoices} stats={stats} />
        )}
      </main>
    </div>
  )
}
