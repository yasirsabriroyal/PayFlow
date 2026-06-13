import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { WorkflowLink } from '@/components/workflow-link'
import { getVendorInvoices } from '@/lib/actions/vendor-invoices'
import { VendorInvoiceList } from './invoice-list'

export default async function VendorInvoicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { invoices } = await getVendorInvoices()

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Contractor Portal" />
      <RoleTabBar role="contractor" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">My Invoices</h1>
              <p className="text-muted-foreground mt-1">
                Track the status of every invoice you&apos;ve submitted.
              </p>
            </div>
            <Button asChild>
              <WorkflowLink href="/vendor/invoices/new" contextTitle="New Invoice">
                <Plus className="w-4 h-4 mr-2" />
                Submit Invoice
              </WorkflowLink>
            </Button>
          </div>

          {invoices.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
                <FileText className="w-6 h-6 text-muted-foreground" />
              </div>
              <h2 className="font-semibold text-lg">No invoices yet</h2>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Once you submit an invoice it will appear here with its current status.
              </p>
              <Button asChild>
                <WorkflowLink href="/vendor/invoices/new" contextTitle="New Invoice">
                  <Plus className="w-4 h-4 mr-2" />
                  Submit your first invoice
                </WorkflowLink>
              </Button>
            </div>
          ) : (
            <VendorInvoiceList invoices={invoices} />
          )}
        </div>
      </main>
    </div>
  )
}
