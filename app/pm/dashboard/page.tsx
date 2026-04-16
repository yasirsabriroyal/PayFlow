'use client'

/**
 * PM Dashboard - RBAC Hardened with Full Navigation
 * 
 * This page is resilient to:
 * - Permission failures (returns empty arrays)
 * - Auth failures (returns empty arrays)
 * - Database errors (returns empty arrays)
 * - Rate limit failures (returns empty arrays)
 * 
 * All RBAC-protected action failures result in safe UI states, not crashes.
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  Briefcase, 
  Users, 
  FileText, 
  AlertCircle, 
  Building2, 
  ChevronRight,
  FileCheck,
  Plus,
  Settings,
  LogOut,
  ClipboardList
} from 'lucide-react'
import { getPMProjects, getContractors, getPMInvoices } from '../actions'
import { createClient } from '@/lib/supabase/client'
import { AppHeader } from '@/components/app-header'
import { WorkflowLink } from '@/components/workflow-link'

// Safe type definitions with defaults
type Project = {
  id: string
  name: string
  project_number: string
  is_active: boolean
}

type Contractor = {
  id: string
  company_name: string
  contact_name?: string
  status: string
}

type Invoice = {
  id: string
  invoice_number: string
  total_cents: number
  status: string
}

// Safe count helper - never crashes
function safeCount(arr: unknown): number {
  if (!arr) return 0
  if (!Array.isArray(arr)) return 0
  return arr.length
}

export default function PMDashboardPage() {
  // State with safe defaults
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [userName, setUserName] = useState('Project Manager')
  const [userEmail, setUserEmail] = useState('')
  const [mounted, setMounted] = useState(false)

  // Fetch user info and data
  useEffect(() => {
    setMounted(true)
    
    async function loadData() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const fullName = `${user.user_metadata?.first_name || ''} ${user.user_metadata?.last_name || ''}`.trim()
        setUserName(fullName || 'Project Manager')
        setUserEmail(user.email || '')
      }
      
      const errorList: string[] = []
      
      // Fetch projects - safe
      try {
        const projectsResult = await getPMProjects()
        if (projectsResult?.success && Array.isArray(projectsResult.projects)) {
          setProjects(projectsResult.projects)
        } else {
          errorList.push('Projects: ' + ((projectsResult as { error?: string })?.error || 'Permission denied or unavailable'))
        }
      } catch (err) {
        errorList.push('Projects: ' + (err instanceof Error ? err.message : 'Fetch failed'))
      }

      // Fetch contractors - safe
      try {
        const contractorsResult = await getContractors()
        if (contractorsResult?.success && Array.isArray(contractorsResult.contractors)) {
          setContractors(contractorsResult.contractors)
        } else {
          errorList.push('Contractors: ' + ((contractorsResult as { error?: string })?.error || 'Permission denied or unavailable'))
        }
      } catch (err) {
        errorList.push('Contractors: ' + (err instanceof Error ? err.message : 'Fetch failed'))
      }

      // Fetch invoices - safe
      try {
        const invoicesResult = await getPMInvoices()
        if (invoicesResult?.success && Array.isArray(invoicesResult.invoices)) {
          setInvoices(invoicesResult.invoices)
        } else {
          errorList.push('Invoices: ' + ((invoicesResult as { error?: string })?.error || 'Permission denied or unavailable'))
        }
      } catch (err) {
        errorList.push('Invoices: ' + (err instanceof Error ? err.message : 'Fetch failed'))
      }

      setErrors(errorList)
      setIsLoading(false)
    }

    loadData()
  }, [])

  // Safe counts - NEVER access .length directly on state
  const projectCount = safeCount(projects)
  const contractorCount = safeCount(contractors)
  const invoiceCount = safeCount(invoices)

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="PM Dashboard" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">PM Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                Manage projects, review invoices, and create payment certificates.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/pm/approvals">
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  Create Payment Certificate
                </Button>
              </Link>
            </div>
          </div>

          {/* Error banner - shows RBAC/permission issues without crashing */}
          {errors.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 text-amber-800 mb-2">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Some data could not be loaded</span>
              </div>
              <ul className="text-sm text-amber-700 list-disc list-inside">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Quick Access Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link 
              href="/pm/invoices/new" 
              className="p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <Plus className="w-6 h-6 text-emerald-600" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">New Invoice</p>
                <p className="text-sm text-muted-foreground">Create contractor invoice</p>
              </div>
            </Link>

            <Link 
              href="/pm/approvals" 
              className="p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <FileCheck className="w-6 h-6 text-primary" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Approvals</p>
                <p className="text-sm text-muted-foreground">Review & approve invoices</p>
              </div>
            </Link>

            <Link 
              href="/pm/certificates" 
              className="p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <ClipboardList className="w-6 h-6 text-green-600" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Certificates</p>
                <p className="text-sm text-muted-foreground">View & create payment certs</p>
              </div>
            </Link>

            <Link 
              href="/pm/projects" 
              className="p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <Briefcase className="w-6 h-6 text-blue-600" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Projects</p>
                <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                  {mounted ? `${projectCount} active` : '-'}
                </p>
              </div>
            </Link>

            <Link 
              href="/pm/contractors" 
              className="p-5 bg-card border border-border rounded-xl hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <Users className="w-6 h-6 text-purple-600" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-4">
                <p className="font-semibold">Contractors</p>
                <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                  {mounted ? `${contractorCount} registered` : '-'}
                </p>
              </div>
            </Link>

          </div>

          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading dashboard data...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Projects */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Recent Projects</CardTitle>
                  <Link href="/pm/projects">
                    <Button variant="outline" size="sm" className="gap-1">
                      View All
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  {projectCount === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No projects available</p>
                  ) : (
                    <div className="space-y-3">
                      {projects.slice(0, 5).map((project) => (
                        <WorkflowLink 
                          key={project.id} 
                          href={`/projects/${project.id}`}
                          contextTitle={project.name}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                        >
                          <div>
                            <p className="font-medium">{project.name}</p>
                            <p className="text-sm text-muted-foreground">{project.project_number}</p>
                          </div>
                          <Badge variant={project.is_active ? 'default' : 'secondary'}>
                            {project.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </WorkflowLink>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pending Invoices */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Pending Invoices</CardTitle>
                  <Link href="/pm/approvals">
                    <Button variant="outline" size="sm" className="gap-1">
                      View All
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  {invoiceCount === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="text-muted-foreground">No pending invoices</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Invoices requiring your approval will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {invoices.slice(0, 5).map((invoice) => (
                        <WorkflowLink 
                          key={invoice.id} 
                          href={`/invoices/${invoice.id}`}
                          contextTitle={invoice.invoice_number}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                        >
                          <div>
                            <p className="font-medium">{invoice.invoice_number}</p>
                            <p className="text-sm text-muted-foreground">
                              ${(invoice.total_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <Badge variant="outline">{invoice.status}</Badge>
                        </WorkflowLink>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Contractors */}
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Assigned Contractors</CardTitle>
                  <Link href="/pm/contractors">
                    <Button variant="outline" size="sm" className="gap-1">
                      View All
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  {contractorCount === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No contractors assigned</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {contractors.slice(0, 6).map((contractor) => (
                        <WorkflowLink 
                          key={contractor.id} 
                          href={`/pm/contractors/${contractor.id}`}
                          contextTitle={contractor.company_name}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                        >
                          <div>
                            <p className="font-medium">{contractor.company_name}</p>
                            {contractor.contact_name && (
                              <p className="text-sm text-muted-foreground">{contractor.contact_name}</p>
                            )}
                          </div>
                          <Badge 
                            variant={contractor.status === 'active' ? 'default' : 'secondary'}
                          >
                            {contractor.status}
                          </Badge>
                        </WorkflowLink>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
