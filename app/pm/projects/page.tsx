'use client'

/**
 * PM Projects Page - View assigned projects
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  ArrowLeft,
  Briefcase,
  Search,
  Building2,
  Calendar,
  DollarSign,
  ChevronRight
} from 'lucide-react'
import { getPMProjects } from '../actions'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'

type Project = {
  id: string
  name: string
  project_number: string
  address_line1?: string
  city?: string
  province?: string
  start_date?: string
  estimated_completion_date?: string
  original_budget_cents: number
  is_active: boolean
}

export default function PMProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/pm/projects')
  const [searchQuery, setSearchQuery] = useState(initialState?.search || '')

  // Save list state when search changes
  useEffect(() => {
    save({ search: searchQuery })
  }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadData = async () => {
      const result = await getPMProjects()
      if (result.success) {
        setProjects(result.projects as Project[])
      }
      setIsLoading(false)
    }
    loadData()
  }, [])

  const filteredProjects = projects.filter(project => 
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.project_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.city?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100)
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not set'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="My Projects"
        pageDescription={`${projects.length} project${projects.length !== 1 ? 's' : ''} assigned`}
      />
      <RoleTabBar role="project_manager" />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12">
            <Briefcase className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? 'No projects match your search' : 'No projects assigned'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => (
              <WorkflowLink 
                key={project.id} 
                href={`/pm/projects/${project.id}`}
                contextTitle={project.name}
              >
                <Card className="h-full hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{project.name}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {project.project_number}
                        </p>
                      </div>
                      <Badge variant={project.is_active ? 'default' : 'secondary'}>
                        {project.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(project.address_line1 || project.city) && (
                      <div className="flex items-start gap-2 text-sm">
                        <Building2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span className="text-muted-foreground">
                          {[project.address_line1, project.city, project.province]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {formatDate(project.start_date)} - {formatDate(project.estimated_completion_date)}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Budget: {formatCurrency(project.original_budget_cents)}
                      </span>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </WorkflowLink>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
