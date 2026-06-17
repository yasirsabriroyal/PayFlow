import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Briefcase, Building2, FileText, DollarSign, Clock, Shield, ChevronRight, Plus, History, PenTool, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoutButton } from '@/components/auth/logout-button'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { WorkflowLink } from '@/components/workflow-link'

import { getVendorPortalStats, getContractorCompliance } from '@/lib/actions/vendor-portal'
import { formatCurrency } from '@/lib/utils'
import { ROUTES } from '@/lib/navigation'

export default async function VendorPortalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { success, stats } = await getVendorPortalStats()
  const displayStats = success && stats ? stats : {
    pendingReviewCount: 0,
    approvedCount: 0,
    paidThisMonthCents: 0,
    holdbackBalanceCents: 0,
    wcbStatus: 'Pending',
    wcbExpiry: 'N/A'
  }

  const { items: complianceItems, bankingOnFile } = await getContractorCompliance()
  const expiringOrExpired = complianceItems.filter(
    (i) => i.status === 'expiring' || i.status === 'expired',
  )

  const statusStyles: Record<string, { dot: string; text: string; label: (i: typeof complianceItems[number]) => string }> = {
    verified: {
      dot: 'bg-success/5 border-success/20',
      text: 'text-success',
      label: (i) => (i.expiryDate ? `Valid until ${new Date(i.expiryDate).toLocaleDateString('en-CA')}` : 'On file'),
    },
    expiring: {
      dot: 'bg-warning/5 border-warning/20',
      text: 'text-warning',
      label: (i) => `Expires in ${i.daysUntilExpiry} day${i.daysUntilExpiry === 1 ? '' : 's'}`,
    },
    expired: {
      dot: 'bg-destructive/5 border-destructive/20',
      text: 'text-destructive',
      label: () => 'Expired',
    },
    pending: {
      dot: 'bg-muted border-border',
      text: 'text-muted-foreground',
      label: () => 'Under review',
    },
    rejected: {
      dot: 'bg-destructive/5 border-destructive/20',
      text: 'text-destructive',
      label: () => 'Rejected — re-upload',
    },
    missing: {
      dot: 'bg-muted border-border',
      text: 'text-muted-foreground',
      label: () => 'Not provided',
    },
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Contractor Portal" />
      <RoleTabBar role="contractor" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Contractor Portal</h1>
            <p className="text-muted-foreground mt-1">
              Manage your invoices and track payment status.
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{displayStats.pendingReviewCount}</p>
                  <p className="text-sm text-muted-foreground">Pending Review</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{displayStats.approvedCount}</p>
                  <p className="text-sm text-muted-foreground">Approved</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{formatCurrency(displayStats.paidThisMonthCents / 100)}</p>
                  <p className="text-sm text-muted-foreground">Paid This Month</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{formatCurrency(displayStats.holdbackBalanceCents / 100)}</p>
                  <p className="text-sm text-muted-foreground">Holdback Balance</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <WorkflowLink
              href="/vendor/invoices/new"
              contextTitle="New Invoice"
              className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Plus className="w-6 h-6 text-primary" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h2 className="font-semibold text-lg">Submit New Invoice</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Submit an invoice for payment processing
              </p>
            </WorkflowLink>

            <WorkflowLink
              href="/vendor/invoices"
              contextTitle="My Invoices"
              className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-warning/10 rounded-lg flex items-center justify-center">
                  <History className="w-6 h-6 text-warning" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h2 className="font-semibold text-lg">My Invoices</h2>
              <p className="text-sm text-muted-foreground mt-1">
                View and track the status of submitted invoices
              </p>
            </WorkflowLink>

            <WorkflowLink 
              href="/vendor/compliance"
              contextTitle="Lien Waivers"
              className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                  <PenTool className="w-6 h-6 text-accent" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h2 className="font-semibold text-lg">Lien Waivers</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Sign statutory declarations for paid invoices
              </p>
            </WorkflowLink>
          </div>

          {/* Expiry alert banner */}
          {expiringOrExpired.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-warning">Compliance documents need attention</p>
                <p className="text-sm text-muted-foreground">
                  {expiringOrExpired.map((i) => i.label).join(', ')}{' '}
                  {expiringOrExpired.length === 1 ? 'is' : 'are'} expiring soon or expired.{' '}
                  <WorkflowLink href={ROUTES.vendor.compliance} contextTitle="Compliance" className="text-warning underline font-medium">
                    Update now
                  </WorkflowLink>
                </p>
              </div>
            </div>
          )}

          {/* Compliance Status */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">Compliance Status</h2>
              <Button variant="outline" size="sm" asChild>
                <WorkflowLink href={ROUTES.vendor.compliance} contextTitle="Update Documents">Manage Documents</WorkflowLink>
              </Button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {complianceItems.map((item) => {
                  const style = statusStyles[item.status] ?? statusStyles.missing
                  return (
                    <div
                      key={item.documentType}
                      className={`flex items-center gap-3 p-3 border rounded-lg ${style.dot}`}
                    >
                      <div className="w-8 h-8 bg-background rounded-full flex items-center justify-center shrink-0">
                        <Shield className={`w-4 h-4 ${style.text}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        <p className={`text-xs ${style.text}`}>{style.label(item)}</p>
                      </div>
                    </div>
                  )
                })}
                <div className={`flex items-center gap-3 p-3 border rounded-lg ${bankingOnFile ? 'bg-success/5 border-success/20' : 'bg-muted border-border'}`}>
                  <div className="w-8 h-8 bg-background rounded-full flex items-center justify-center shrink-0">
                    <DollarSign className={`w-4 h-4 ${bankingOnFile ? 'text-success' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">Banking Info</p>
                    <p className={`text-xs ${bankingOnFile ? 'text-success' : 'text-muted-foreground'}`}>
                      {bankingOnFile ? 'On file' : 'Not provided'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
