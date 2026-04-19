'use client'

/**
 * PM Contractors Page - View assigned contractors
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  ArrowLeft,
  Users,
  Search,
  Mail,
  Phone,
  ChevronRight,
  Building2,
  Plus
} from 'lucide-react'
import { getPMContractors } from '../actions'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { useListStatePreservation } from '@/lib/workflow-navigation'
import { WorkflowLink } from '@/components/workflow-link'
import { usePermissions } from '@/hooks/use-permissions'

type Contractor = {
  id: string
  company_name: string
  contact_name?: string
  email?: string
  phone?: string
  status: string
  trade?: string
}

export default function PMContractorsPage() {
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { hasPermission } = usePermissions()
  
  // Permission-aware UI state
  const canCreateVendor = hasPermission('create_vendors')
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/pm/contractors')
  const [searchQuery, setSearchQuery] = useState(initialState?.search || '')

  // Save list state when search changes
  useEffect(() => {
    save({ search: searchQuery })
  }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadData = async () => {
      const result = await getPMContractors()
      if (result.success) {
        setContractors(result.contractors as Contractor[])
      }
      setIsLoading(false)
    }
    loadData()
  }, [])

  const filteredContractors = contractors.filter(contractor => 
    contractor.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contractor.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contractor.trade?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="Contractors"
        pageDescription={`${contractors.length} contractor${contractors.length !== 1 ? 's' : ''} registered`}
      />
      <RoleTabBar role="project_manager" />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Search and Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search contractors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {canCreateVendor && (
            <Button asChild>
              <WorkflowLink href="/pm/contractors/new" contextTitle="Add Contractor">
                <Plus className="w-4 h-4 mr-2" />
                Add Contractor
              </WorkflowLink>
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading contractors...</p>
          </div>
        ) : filteredContractors.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? 'No contractors match your search' : 'No contractors assigned'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredContractors.map((contractor) => (
              <WorkflowLink 
                key={contractor.id} 
                href={`/pm/contractors/${contractor.id}`}
                contextTitle={contractor.company_name}
                className="block"
              >
                <Card className="h-full hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{contractor.company_name}</CardTitle>
                          {contractor.contact_name && (
                            <p className="text-sm text-muted-foreground">{contractor.contact_name}</p>
                          )}
                        </div>
                      </div>
                      <Badge variant={contractor.status === 'active' ? 'default' : 'secondary'}>
                        {contractor.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {contractor.trade && (
                      <p className="text-sm text-muted-foreground">
                        Trade: {contractor.trade}
                      </p>
                    )}
                    
                    {contractor.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground truncate">{contractor.email}</span>
                      </div>
                    )}
                    
                    {contractor.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{contractor.phone}</span>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
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
