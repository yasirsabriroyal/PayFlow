import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { InvoiceTable } from './invoice-table'

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

export default async function AdminInvoicesPage() {
  const supabase = getSupabaseAdmin()

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      status,
      amount_cents,
      net_payable_cents,
      created_at,
      contractor:contractors ( company_name ),
      project:projects ( name )
    `)
    .order('created_at', { ascending: false })

  const rows: InvoiceRow[] = (invoices ?? []).map((inv) => {
    const contractor = Array.isArray(inv.contractor)
      ? (inv.contractor[0] ?? null)
      : inv.contractor
    const project = Array.isArray(inv.project)
      ? (inv.project[0] ?? null)
      : inv.project
    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      status: inv.status,
      amount_cents: inv.amount_cents,
      net_payable_cents: inv.net_payable_cents,
      created_at: inv.created_at,
      contractor: contractor as { company_name: string } | null,
      project: project as { name: string } | null,
    }
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader pageTitle="All Invoices" />
      <RoleTabBar role="admin" />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">All Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">{rows.length} invoice{rows.length !== 1 ? 's' : ''} total</p>
        </div>
        <InvoiceTable invoices={rows} />
      </main>
    </div>
  )
}
