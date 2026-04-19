import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Briefcase, Building2, FileText, DollarSign, Clock, Shield, ChevronRight, Plus, History, PenTool } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoutButton } from '@/components/auth/logout-button'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { WorkflowLink } from '@/components/workflow-link'

export default async function VendorPortalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Use user metadata (avoids RLS issues)
  const userData = {
    full_name: `${user.user_metadata?.first_name || ''} ${user.user_metadata?.last_name || ''}`.trim() || 'Contractor',
    email: user.email,
    role: user.user_metadata?.role || 'contractor'
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Contractor Portal" />
      <RoleTabBar role="contractor" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Vendor Portal</h1>
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
                  <p className="text-2xl font-semibold">3</p>
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
                  <p className="text-2xl font-semibold">12</p>
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
                  <p className="text-2xl font-semibold">$45,280</p>
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
                  <p className="text-2xl font-semibold">$12,750</p>
                  <p className="text-sm text-muted-foreground">Holdback Balance</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

          {/* Compliance Status */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">Compliance Status</h2>
              <Button variant="outline" size="sm" asChild>
                <WorkflowLink href="/vendor/onboarding" contextTitle="Update Documents">Update Documents</WorkflowLink>
              </Button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-lg">
                  <div className="w-8 h-8 bg-success/10 rounded-full flex items-center justify-center">
                    <Shield className="w-4 h-4 text-success" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">WCB Clearance</p>
                    <p className="text-xs text-success">Valid until Dec 2024</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-lg">
                  <div className="w-8 h-8 bg-success/10 rounded-full flex items-center justify-center">
                    <FileText className="w-4 h-4 text-success" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">T5018 Consent</p>
                    <p className="text-xs text-success">On file</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-lg">
                  <div className="w-8 h-8 bg-success/10 rounded-full flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-success" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Banking Info</p>
                    <p className="text-xs text-success">Verified</p>
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
