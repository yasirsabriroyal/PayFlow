import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Shield, Building2, Users, FileCheck, FolderKanban, ChevronRight, Database, Settings, UsersRound, FileBarChart, CreditCard, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KYCVerificationQueue } from '@/components/admin/kyc-verification-queue'
import { LogoutButton } from '@/components/auth/logout-button'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { WorkflowLink } from '@/components/workflow-link'

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Admin Dashboard" />
      <RoleTabBar role="admin" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Admin Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back. This dashboard will be fully implemented in Step 2.
            </p>
          </div>

          {/* Quick Access Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <WorkflowLink 
              href="/admin/contractors"
              contextTitle="Contractors"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Contractors</p>
                <p className="text-sm text-muted-foreground">Manage vendors & KYC</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/accountant/queue"
              contextTitle="Approvals"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-warning/10 rounded-lg flex items-center justify-center">
                  <FileCheck className="w-6 h-6 text-warning" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Approvals</p>
                <p className="text-sm text-muted-foreground">Payment queue</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/projects"
              contextTitle="Projects"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                  <FolderKanban className="w-6 h-6 text-accent" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Projects</p>
                <p className="text-sm text-muted-foreground">Budgets & change orders</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/accounting"
              contextTitle="Accounting Sync"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-success/10 rounded-lg flex items-center justify-center">
                  <Database className="w-6 h-6 text-success" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Accounting Sync</p>
                <p className="text-sm text-muted-foreground">QuickBooks & audit log</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/team"
              contextTitle="Team Management"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <UsersRound className="w-6 h-6 text-blue-500" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Team Management</p>
                <p className="text-sm text-muted-foreground">Internal users & roles</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/reports/builder"
              contextTitle="Report Builder"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <FileBarChart className="w-6 h-6 text-purple-500" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Report Builder</p>
                <p className="text-sm text-muted-foreground">Custom data exports</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/settings/payments"
              contextTitle="Payment Settings"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-orange-500/10 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-orange-500" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Payment Settings</p>
                <p className="text-sm text-muted-foreground">Compliance guardrails</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/settings/permissions"
              contextTitle="Permissions"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-indigo-500/10 rounded-lg flex items-center justify-center">
                  <Shield className="w-6 h-6 text-indigo-500" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Permissions</p>
                <p className="text-sm text-muted-foreground">Role-based access control</p>
              </div>
            </WorkflowLink>

            <WorkflowLink 
              href="/admin/settings/notifications"
              contextTitle="Notification Rules"
              className="block p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-teal-500/10 rounded-lg flex items-center justify-center">
                  <Bell className="w-6 h-6 text-teal-500" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Notification Rules</p>
                <p className="text-sm text-muted-foreground">Who gets notified per event</p>
              </div>
            </WorkflowLink>
          </div>

          {/* KYC Verification Queue */}
          <div className="bg-card border border-border rounded-xl p-6">
            <KYCVerificationQueue />
          </div>
        </div>
      </main>
    </div>
  )
}
