'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Calculator, Building2, Clock, CheckCircle2, AlertTriangle,
  ChevronLeft, Search, Filter, ChevronDown, DollarSign,
  Calendar, Unlock, Timer, ArrowRight, Check, Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getHoldbacks, releaseHoldback } from '../actions'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/app-header'
import { useListStatePreservation } from '@/lib/workflow-navigation'

// Mock holdback data
const mockHoldbacks = [
  {
    id: '1',
    project: { name: 'Riverside Plaza Tower A', number: 'PRJ-2024-001' },
    contractor: { name: 'Elite Electrical Ltd.', id: 'CNT-001' },
    invoiceNumber: 'INV-2024-0145',
    invoiceDate: '2024-01-15',
    holdbackAmount: 4500.00,
    holdbackDate: '2024-01-20',
    daysHeld: 52,
    status: 'eligible',
  },
  {
    id: '2',
    project: { name: 'Riverside Plaza Tower A', number: 'PRJ-2024-001' },
    contractor: { name: 'ProPlumb Solutions Inc.', id: 'CNT-002' },
    invoiceNumber: 'INV-2024-0189',
    invoiceDate: '2024-01-28',
    holdbackAmount: 3200.00,
    holdbackDate: '2024-02-01',
    daysHeld: 48,
    status: 'eligible',
  },
  {
    id: '3',
    project: { name: 'Downtown Office Complex', number: 'PRJ-2024-002' },
    contractor: { name: 'SteelFrame Structures', id: 'CNT-003' },
    invoiceNumber: 'INV-2024-0201',
    invoiceDate: '2024-02-05',
    holdbackAmount: 8750.00,
    holdbackDate: '2024-02-08',
    daysHeld: 41,
    status: 'pending',
  },
  {
    id: '4',
    project: { name: 'Lakeview Condominiums', number: 'PRJ-2024-003' },
    contractor: { name: 'HVAC Masters Corp.', id: 'CNT-004' },
    invoiceNumber: 'INV-2024-0223',
    invoiceDate: '2024-02-12',
    holdbackAmount: 6100.00,
    holdbackDate: '2024-02-15',
    daysHeld: 34,
    status: 'pending',
  },
  {
    id: '5',
    project: { name: 'Downtown Office Complex', number: 'PRJ-2024-002' },
    contractor: { name: 'Elite Electrical Ltd.', id: 'CNT-001' },
    invoiceNumber: 'INV-2024-0245',
    invoiceDate: '2024-02-18',
    holdbackAmount: 2800.00,
    holdbackDate: '2024-02-20',
    daysHeld: 29,
    status: 'pending',
  },
  {
    id: '6',
    project: { name: 'Industrial Park Phase 2', number: 'PRJ-2024-004' },
    contractor: { name: 'ConcreteWorks Ltd.', id: 'CNT-005' },
    invoiceNumber: 'INV-2024-0267',
    invoiceDate: '2024-02-25',
    holdbackAmount: 12500.00,
    holdbackDate: '2024-02-28',
    daysHeld: 21,
    status: 'pending',
  },
  {
    id: '7',
    project: { name: 'Riverside Plaza Tower A', number: 'PRJ-2024-001' },
    contractor: { name: 'FinishLine Drywall', id: 'CNT-006' },
    invoiceNumber: 'INV-2024-0289',
    invoiceDate: '2024-03-01',
    holdbackAmount: 5400.00,
    holdbackDate: '2024-03-04',
    daysHeld: 16,
    status: 'pending',
  },
  {
    id: '8',
    project: { name: 'Lakeview Condominiums', number: 'PRJ-2024-003' },
    contractor: { name: 'ProPlumb Solutions Inc.', id: 'CNT-002' },
    invoiceNumber: 'INV-2024-0312',
    invoiceDate: '2024-03-08',
    holdbackAmount: 4200.00,
    holdbackDate: '2024-03-11',
    daysHeld: 9,
    status: 'pending',
  },
]

const HOLDBACK_PERIOD = 45 // Standard 45-day statutory holdback

export default function HoldbackLedgerPage() {
  const { hasPermission } = usePermissions()
  const { toast } = useToast()
  
  // Permission-aware UI state
  const canReleaseHoldback = hasPermission('process_payments')
  
  // List state preservation
  const { initialState, save } = useListStatePreservation('/accountant/holdbacks')
  
  const [holdbacks, setHoldbacks] = useState<typeof mockHoldbacks>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(initialState?.search || '')
  const [statusFilter, setStatusFilter] = useState<string | null>(initialState?.filters?.status as string || null)
  
  // Save state when search or filter changes
  useEffect(() => {
    save({ search: searchQuery, filters: { status: statusFilter || '' } })
  }, [searchQuery, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  const [releaseModalOpen, setReleaseModalOpen] = useState(false)
  const [selectedHoldback, setSelectedHoldback] = useState<typeof mockHoldbacks[0] | null>(null)
  const [isReleasing, setIsReleasing] = useState(false)
  const [releaseSuccess, setReleaseSuccess] = useState(false)
  
  // Fetch holdbacks from server action on mount
  useEffect(() => {
    const fetchHoldbacksData = async () => {
      const result = await getHoldbacks()
      if (result.success && result.holdbacks.length > 0) {
        // Map server response to local type
        setHoldbacks(result.holdbacks.map((h: Record<string, unknown>) => ({
          id: h.id as string,
          project: { 
            name: (h.project as Record<string, unknown>)?.name as string || 'Unknown Project', 
            number: (h.project as Record<string, unknown>)?.project_number as string || '' 
          },
          contractor: { 
            name: (h.contractor as Record<string, unknown>)?.company_name as string || 'Unknown', 
            id: (h.contractor as Record<string, unknown>)?.id as string || '' 
          },
          invoiceNumber: (h.invoice as Record<string, unknown>)?.invoice_number as string || '',
          invoiceDate: h.created_at as string,
          holdbackAmount: ((h.amount_cents as number) || 0) / 100,
          holdbackDate: h.created_at as string,
          daysHeld: Math.floor((Date.now() - new Date(h.created_at as string).getTime()) / (1000 * 60 * 60 * 24)),
          status: h.status === 'released' ? 'released' : 
                 Math.floor((Date.now() - new Date(h.created_at as string).getTime()) / (1000 * 60 * 60 * 24)) >= 45 ? 'eligible' : 'pending',
        })))
      } else if (process.env.NODE_ENV === 'development') {
        // DEV ONLY: Fall back to mock data when database is empty
        console.warn('[DEV] No holdbacks in database - using mock data')
        setHoldbacks(mockHoldbacks)
      } else {
        // Production: Show empty state
        setHoldbacks([])
      }
      setLoading(false)
    }
    
    fetchHoldbacksData()
  }, [])

  const filteredHoldbacks = holdbacks.filter(h => {
    const matchesSearch = 
      h.project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.contractor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesStatus = !statusFilter || h.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  const eligibleCount = holdbacks.filter(h => h.status === 'eligible').length
  const pendingCount = holdbacks.filter(h => h.status === 'pending').length
  const totalHoldbackAmount = holdbacks.reduce((sum, h) => sum + h.holdbackAmount, 0)
  const eligibleAmount = holdbacks.filter(h => h.status === 'eligible').reduce((sum, h) => sum + h.holdbackAmount, 0)

  const getDaysRemaining = (daysHeld: number) => {
    return Math.max(0, HOLDBACK_PERIOD - daysHeld)
  }

  const getCountdownDisplay = (holdback: typeof mockHoldbacks[0]) => {
    const daysRemaining = getDaysRemaining(holdback.daysHeld)
    
    if (daysRemaining === 0 || holdback.status === 'eligible') {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-success font-medium">Eligible for Release</span>
        </div>
      )
    } else if (daysRemaining <= 7) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-warning rounded-full" />
          <span className="text-warning font-medium">{daysRemaining} Days Left</span>
        </div>
      )
    } else if (daysRemaining <= 14) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-warning rounded-full" />
          <span className="text-muted-foreground">{daysRemaining} Days Left</span>
        </div>
      )
    } else {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-muted-foreground/50 rounded-full" />
          <span className="text-muted-foreground">{daysRemaining} Days Left</span>
        </div>
      )
    }
  }

  const getProgressBar = (daysHeld: number) => {
    const progress = Math.min(100, (daysHeld / HOLDBACK_PERIOD) * 100)
    let bgColor = 'bg-muted-foreground/30'
    
    if (progress >= 100) {
      bgColor = 'bg-success'
    } else if (progress >= 85) {
      bgColor = 'bg-warning'
    } else if (progress >= 50) {
      bgColor = 'bg-primary/60'
    }
    
    return (
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${bgColor} transition-all duration-300`}
          style={{ width: `${progress}%` }}
        />
      </div>
    )
  }

  const handleRelease = (holdback: typeof mockHoldbacks[0]) => {
    setSelectedHoldback(holdback)
    setReleaseModalOpen(true)
    setReleaseSuccess(false)
  }

  const confirmRelease = async () => {
    if (!selectedHoldback) return
    
    setIsReleasing(true)
    
    // Call server action with permission enforcement
    const result = await releaseHoldback({ holdbackId: selectedHoldback.id })
    
    if (result.success) {
      // Remove from list
      setHoldbacks(prev => prev.filter(h => h.id !== selectedHoldback.id))
      setReleaseSuccess(true)
      toast({
        title: 'Holdback Released',
        description: `$${selectedHoldback.holdbackAmount.toLocaleString()} has been released to ${selectedHoldback.contractor.name}.`,
      })
    } else {
      toast({
        title: 'Release Failed',
        description: result.error || 'Failed to release holdback.',
        variant: 'destructive',
      })
    }
    
    setIsReleasing(false)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-CA', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="Holdback Ledger"
        pageDescription="45-Day Statutory Holdback Tracking"
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{eligibleCount}</p>
                <p className="text-sm text-muted-foreground">Eligible for Release</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{pendingCount}</p>
                <p className="text-sm text-muted-foreground">Still in Holdback</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(totalHoldbackAmount)}</p>
                <p className="text-sm text-muted-foreground">Total Held</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                <Unlock className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(eligibleAmount)}</p>
                <p className="text-sm text-muted-foreground">Ready to Release</p>
              </div>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
          <Calendar className="w-5 h-5 text-primary mt-0.5" />
          <div>
            <p className="font-medium text-sm">Builder&apos;s Lien Act Compliance</p>
            <p className="text-sm text-muted-foreground">
              Under the Alberta Builder&apos;s Lien Act, a 10% statutory holdback must be retained for 45 days 
              after substantial completion. Funds become eligible for release once the holdback period expires.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by project, contractor, or invoice..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="w-4 h-4" />
                {statusFilter ? (statusFilter === 'eligible' ? 'Eligible' : 'Pending') : 'All Status'}
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setStatusFilter(null)}>
                All Status
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('eligible')}>
                Eligible for Release
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('pending')}>
                Still in Holdback
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Holdback Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Project
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Contractor
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Invoice #
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Holdback Amount
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Holdback Date
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4 min-w-[200px]">
                    Release Countdown
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredHoldbacks.map((holdback) => (
                  <tr key={holdback.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-sm">{holdback.project.name}</p>
                        <p className="text-xs text-muted-foreground">{holdback.project.number}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm">{holdback.contractor.name}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-mono">{holdback.invoiceNumber}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm font-semibold">{formatCurrency(holdback.holdbackAmount)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-muted-foreground">{formatDate(holdback.holdbackDate)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        {getCountdownDisplay(holdback)}
                        {getProgressBar(holdback.daysHeld)}
                        <p className="text-xs text-muted-foreground">
                          Day {holdback.daysHeld} of {HOLDBACK_PERIOD}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {holdback.status === 'eligible' ? (
                        <Button 
                          size="sm" 
                          className="gap-2 bg-success hover:bg-success/90"
onClick={() => handleRelease(holdback)}
                            disabled={!canReleaseHoldback}
                            title={!canReleaseHoldback ? 'You do not have permission to release holdbacks' : undefined}
                          >
                            <Unlock className="w-4 h-4" />
                            Release Funds
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground px-3 py-1.5 bg-muted rounded-md">
                            Locked
                          </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredHoldbacks.length === 0 && (
            <div className="p-12 text-center">
              <Timer className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">No holdbacks found matching your criteria.</p>
            </div>
          )}
        </div>
      </main>

      {/* Release Confirmation Modal */}
      <Dialog open={releaseModalOpen} onOpenChange={setReleaseModalOpen}>
        <DialogContent className="sm:max-w-md">
          {!releaseSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Unlock className="w-5 h-5 text-success" />
                  Release Holdback Funds
                </DialogTitle>
                <DialogDescription>
                  Confirm that you want to release these holdback funds to the contractor.
                </DialogDescription>
              </DialogHeader>
              
              {selectedHoldback && (
                <div className="space-y-4 py-4">
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Contractor</span>
                      <span className="text-sm font-medium">{selectedHoldback.contractor.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Invoice</span>
                      <span className="text-sm font-mono">{selectedHoldback.invoiceNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Project</span>
                      <span className="text-sm">{selectedHoldback.project.name}</span>
                    </div>
                    <div className="border-t border-border pt-3 flex justify-between">
                      <span className="text-sm font-medium">Release Amount</span>
                      <span className="text-lg font-semibold text-success">
                        {formatCurrency(selectedHoldback.holdbackAmount)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      This action will schedule an EFT payment to the contractor for the holdback amount. 
                      Ensure all lien waivers have been received.
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setReleaseModalOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={confirmRelease} 
                  disabled={isReleasing}
                  className="gap-2 bg-success hover:bg-success/90"
                >
                  {isReleasing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Confirm Release
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                </div>
                <DialogTitle className="text-center">Funds Released Successfully</DialogTitle>
                <DialogDescription className="text-center">
                  The holdback funds have been scheduled for release.
                </DialogDescription>
              </DialogHeader>
              
              {selectedHoldback && (
                <div className="py-4">
                  <div className="bg-muted/50 rounded-lg p-4 text-center space-y-1">
                    <p className="text-2xl font-semibold text-success">
                      {formatCurrency(selectedHoldback.holdbackAmount)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      to {selectedHoldback.contractor.name}
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button onClick={() => setReleaseModalOpen(false)} className="w-full">
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
