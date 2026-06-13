import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ArrowLeft, Download, FileText } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { WorkflowLink } from '@/components/workflow-link'
import { formatCurrency } from '@/lib/utils'
import { getVendorInvoiceDetail } from '@/lib/actions/vendor-invoices'
import { StatusBadge } from '../invoice-list'

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function VendorInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  const { success, invoice } = await getVendorInvoiceDetail(id)
  if (!success || !invoice) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Contractor Portal" />
      <RoleTabBar role="contractor" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <WorkflowLink
          href="/vendor/invoices"
          contextTitle="My Invoices"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Back to invoices
        </WorkflowLink>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{invoice.invoiceNumber}</h1>
            <p className="text-muted-foreground mt-1">{invoice.projectName}</p>
          </div>
          <StatusBadge status={invoice.status} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Amount breakdown */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold">Amount Breakdown</h2>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(invoice.subtotalCents / 100)}</span>
                </div>
                {invoice.gstHstCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      GST/HST ({(invoice.gstHstRate * 100).toFixed(0)}%)
                    </span>
                    <span className="font-medium">{formatCurrency(invoice.gstHstCents / 100)}</span>
                  </div>
                )}
                {invoice.pstCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">PST ({(invoice.pstRate * 100).toFixed(0)}%)</span>
                    <span className="font-medium">{formatCurrency(invoice.pstCents / 100)}</span>
                  </div>
                )}
                {invoice.qstCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">QST ({(invoice.qstRate * 100).toFixed(2)}%)</span>
                    <span className="font-medium">{formatCurrency(invoice.qstCents / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm pt-3 border-t border-border">
                  <span className="text-muted-foreground">Invoice Total</span>
                  <span className="font-medium">{formatCurrency(invoice.totalCents / 100)}</span>
                </div>
                {invoice.holdbackCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Statutory Holdback</span>
                    <span className="font-medium text-warning">
                      -{formatCurrency(invoice.holdbackCents / 100)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-3 border-t border-border">
                  <span className="font-medium">Net Payable</span>
                  <span className="font-semibold text-lg">{formatCurrency(invoice.netPayableCents / 100)}</span>
                </div>
              </div>
            </div>

            {/* Documents */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold">Documents</h2>
              </div>
              <div className="p-6">
                {invoice.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents attached.</p>
                ) : (
                  <ul className="space-y-2">
                    {invoice.documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-3 p-3 border border-border rounded-lg"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{doc.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(doc.fileSizeBytes)}
                            </p>
                          </div>
                        </div>
                        <a
                          href={`/api/documents/${doc.id}`}
                          className="inline-flex items-center text-sm text-primary hover:underline shrink-0"
                        >
                          <Download className="w-4 h-4 mr-1.5" />
                          Download
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar: status + payment */}
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold">Details</h2>
              </div>
              <div className="p-6 space-y-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice Date</span>
                  <span className="font-medium">{formatDate(invoice.invoiceDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due Date</span>
                  <span className="font-medium">{formatDate(invoice.dueDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-medium">{formatDate(invoice.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold">Payment</h2>
              </div>
              <div className="p-6 space-y-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span className="font-medium text-success">
                    {formatCurrency(invoice.amountPaidCents / 100)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="font-medium">{formatCurrency(invoice.amountRemainingCents / 100)}</span>
                </div>
                {invoice.holdbackCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Holdback Held</span>
                    <span className="font-medium text-warning">
                      {formatCurrency(invoice.holdbackCents / 100)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
