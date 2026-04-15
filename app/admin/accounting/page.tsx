'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  Building2, Shield, Clock, CheckCircle2, AlertTriangle, XCircle,
  ChevronLeft, Search, Filter, ChevronDown, RefreshCw, Database,
  FileText, DollarSign, Unlock, ArrowUpRight, Loader2, Check,
  Calendar, TrendingUp, AlertCircle
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

// Mock audit log data
const mockAuditLogs = [
  {
    id: '1',
    type: 'invoice_approved',
    description: 'Invoice INV-2024-0312 approved for payment',
    entity: { type: 'Invoice', id: 'INV-2024-0312', name: 'ProPlumb Solutions Inc.' },
    amount: 42000.00,
    user: 'Sarah Johnson',
    timestamp: '2024-03-20T14:32:00Z',
    syncStatus: 'pending',
    qbReference: null,
  },
  {
    id: '2',
    type: 'eft_paid',
    description: 'EFT Batch EFT-20240320-001 processed',
    entity: { type: 'EFT Batch', id: 'EFT-20240320-001', name: '5 payments' },
    amount: 127500.00,
    user: 'Mike Chen',
    timestamp: '2024-03-20T11:15:00Z',
    syncStatus: 'pending',
    qbReference: null,
  },
  {
    id: '3',
    type: 'holdback_released',
    description: 'Holdback released for INV-2024-0145',
    entity: { type: 'Holdback', id: 'HB-2024-0145', name: 'Elite Electrical Ltd.' },
    amount: 4500.00,
    user: 'Sarah Johnson',
    timestamp: '2024-03-19T16:45:00Z',
    syncStatus: 'synced',
    qbReference: 'QB-JE-2024-0892',
  },
  {
    id: '4',
    type: 'invoice_approved',
    description: 'Invoice INV-2024-0298 approved for payment',
    entity: { type: 'Invoice', id: 'INV-2024-0298', name: 'SteelFrame Structures' },
    amount: 87500.00,
    user: 'David Park',
    timestamp: '2024-03-19T10:22:00Z',
    syncStatus: 'synced',
    qbReference: 'QB-BILL-2024-0445',
  },
  {
    id: '5',
    type: 'eft_paid',
    description: 'EFT Batch EFT-20240318-002 processed',
    entity: { type: 'EFT Batch', id: 'EFT-20240318-002', name: '3 payments' },
    amount: 68200.00,
    user: 'Mike Chen',
    timestamp: '2024-03-18T15:30:00Z',
    syncStatus: 'synced',
    qbReference: 'QB-PMT-2024-0221',
  },
  {
    id: '6',
    type: 'invoice_approved',
    description: 'Invoice INV-2024-0276 approved for payment',
    entity: { type: 'Invoice', id: 'INV-2024-0276', name: 'HVAC Masters Corp.' },
    amount: 61000.00,
    user: 'Sarah Johnson',
    timestamp: '2024-03-18T09:15:00Z',
    syncStatus: 'failed',
    qbReference: null,
    errorMessage: 'Vendor not found in QuickBooks',
  },
  {
    id: '7',
    type: 'holdback_released',
    description: 'Holdback released for INV-2024-0189',
    entity: { type: 'Holdback', id: 'HB-2024-0189', name: 'ProPlumb Solutions Inc.' },
    amount: 3200.00,
    user: 'Sarah Johnson',
    timestamp: '2024-03-17T14:00:00Z',
    syncStatus: 'synced',
    qbReference: 'QB-JE-2024-0878',
  },
  {
    id: '8',
    type: 'invoice_approved',
    description: 'Invoice INV-2024-0265 approved for payment',
    entity: { type: 'Invoice', id: 'INV-2024-0265', name: 'FinishLine Drywall' },
    amount: 54000.00,
    user: 'David Park',
    timestamp: '2024-03-17T11:30:00Z',
    syncStatus: 'synced',
    qbReference: 'QB-BILL-2024-0432',
  },
]

type SyncStatus = 'pending' | 'synced' | 'failed'

export default function AccountingSyncPage() {
  // DEV ONLY: Audit logs - using mock data until real audit_logs table integration
  const [auditLogs, setAuditLogs] = useState(() => {
    // Use mock data in development, empty in production
    return process.env.NODE_ENV === 'development' ? mockAuditLogs : []
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<SyncStatus | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [syncResults, setSyncResults] = useState<{ synced: number; failed: number } | null>(null)

  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = 
      log.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entity.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entity.id.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesStatus = !statusFilter || log.syncStatus === statusFilter
    const matchesType = !typeFilter || log.type === typeFilter
    
    return matchesSearch && matchesStatus && matchesType
  })

  const pendingCount = auditLogs.filter(l => l.syncStatus === 'pending').length
  const syncedCount = auditLogs.filter(l => l.syncStatus === 'synced').length
  const failedCount = auditLogs.filter(l => l.syncStatus === 'failed').length
  const totalSyncedVolume = auditLogs
    .filter(l => l.syncStatus === 'synced')
    .reduce((sum, l) => sum + l.amount, 0)
  const pendingVolume = auditLogs
    .filter(l => l.syncStatus === 'pending')
    .reduce((sum, l) => sum + l.amount, 0)

  const lastSyncDate = 'Mar 19, 2024 at 4:45 PM'

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'invoice_approved':
        return <FileText className="w-4 h-4 text-primary" />
      case 'eft_paid':
        return <DollarSign className="w-4 h-4 text-success" />
      case 'holdback_released':
        return <Unlock className="w-4 h-4 text-accent" />
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'invoice_approved':
        return 'Invoice Approved'
      case 'eft_paid':
        return 'EFT Payment'
      case 'holdback_released':
        return 'Holdback Released'
      default:
        return type
    }
  }

  const getStatusBadge = (status: SyncStatus, errorMessage?: string) => {
    switch (status) {
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-success/10 text-success text-xs font-medium rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Synced
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-warning/10 text-warning text-xs font-medium rounded-full">
            <Clock className="w-3.5 h-3.5" />
            Pending Sync
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-destructive/10 text-destructive text-xs font-medium rounded-full" title={errorMessage}>
            <XCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        )
    }
  }

  const handleSync = async () => {
    setSyncModalOpen(true)
    setIsSyncing(true)
    setSyncSuccess(false)
    
    // Simulate sync process
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Update pending items to synced
    const pendingItems = auditLogs.filter(l => l.syncStatus === 'pending')
    const syncedItems = pendingItems.length
    
    setAuditLogs(prev => prev.map(log => {
      if (log.syncStatus === 'pending') {
        return {
          ...log,
          syncStatus: 'synced' as SyncStatus,
          qbReference: `QB-SYNC-${Date.now().toString().slice(-8)}`
        }
      }
      return log
    }))
    
    setSyncResults({ synced: syncedItems, failed: 0 })
    setIsSyncing(false)
    setSyncSuccess(true)
  }

  const handleRetryFailed = async (logId: string) => {
    setAuditLogs(prev => prev.map(log => {
      if (log.id === logId) {
        return {
          ...log,
          syncStatus: 'synced' as SyncStatus,
          qbReference: `QB-RETRY-${Date.now().toString().slice(-6)}`,
          errorMessage: undefined
        }
      }
      return log
    }))
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-CA', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin/dashboard">
                <Button variant="ghost" size="icon">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="font-semibold">Accounting Sync</h1>
                  <p className="text-sm text-muted-foreground">QuickBooks Integration & Audit Log</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/payments/direct">
                <Button variant="outline" className="gap-2">
                  <DollarSign className="w-4 h-4" />
                  Direct Payment
                </Button>
              </Link>
              <Button onClick={handleSync} disabled={pendingCount === 0} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Sync to QuickBooks
                {pendingCount > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                    {pendingCount}
                </span>
              )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{pendingCount}</p>
                <p className="text-sm text-muted-foreground">Pending Syncs</p>
              </div>
            </div>
            {pendingCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatCurrency(pendingVolume)} to sync
              </p>
            )}
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                <Calendar className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">{lastSyncDate}</p>
                <p className="text-sm text-muted-foreground">Last Sync</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(totalSyncedVolume)}</p>
                <p className="text-sm text-muted-foreground">Total Synced</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${failedCount > 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
                {failedCount > 0 ? (
                  <AlertCircle className="w-5 h-5 text-destructive" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-success" />
                )}
              </div>
              <div>
                <p className="text-2xl font-semibold">{failedCount}</p>
                <p className="text-sm text-muted-foreground">Sync Errors</p>
              </div>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {failedCount > 0 && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-sm">Sync Errors Detected</p>
              <p className="text-sm text-muted-foreground">
                {failedCount} transaction(s) failed to sync. Review and retry the failed items below.
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search transactions..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="w-4 h-4" />
                {statusFilter ? (
                  statusFilter === 'pending' ? 'Pending' : 
                  statusFilter === 'synced' ? 'Synced' : 'Failed'
                ) : 'All Status'}
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setStatusFilter(null)}>All Status</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('pending')}>Pending Sync</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('synced')}>Synced</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('failed')}>Failed</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <FileText className="w-4 h-4" />
                {typeFilter ? getTypeLabel(typeFilter) : 'All Types'}
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTypeFilter(null)}>All Types</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTypeFilter('invoice_approved')}>Invoice Approved</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTypeFilter('eft_paid')}>EFT Payment</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTypeFilter('holdback_released')}>Holdback Released</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Audit Log Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Type
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Description
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Amount
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    User
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Date
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                    QB Reference
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(log.type)}
                        <span className="text-sm">{getTypeLabel(log.type)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm">{log.description}</p>
                        <p className="text-xs text-muted-foreground">{log.entity.name}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm font-semibold">{formatCurrency(log.amount)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-muted-foreground">{log.user}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-muted-foreground">{formatTimestamp(log.timestamp)}</p>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(log.syncStatus as SyncStatus, log.errorMessage)}
                      {log.errorMessage && (
                        <p className="text-xs text-destructive mt-1">{log.errorMessage}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {log.qbReference ? (
                        <span className="text-sm font-mono text-muted-foreground">{log.qbReference}</span>
                      ) : log.syncStatus === 'failed' ? (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="gap-1"
                          onClick={() => handleRetryFailed(log.id)}
                        >
                          <RefreshCw className="w-3 h-3" />
                          Retry
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredLogs.length === 0 && (
            <div className="p-12 text-center">
              <Database className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">No transactions found matching your criteria.</p>
            </div>
          )}
        </div>
      </main>

      {/* Sync Progress Modal */}
      <Dialog open={syncModalOpen} onOpenChange={setSyncModalOpen}>
        <DialogContent className="sm:max-w-md">
          {isSyncing ? (
            <>
              <DialogHeader>
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
                <DialogTitle className="text-center">Syncing to QuickBooks...</DialogTitle>
                <DialogDescription className="text-center">
                  Please wait while we sync your transactions.
                </DialogDescription>
              </DialogHeader>
              <div className="py-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting to QuickBooks Online...
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    Processing {pendingCount} transactions...
                  </div>
                </div>
              </div>
            </>
          ) : syncSuccess ? (
            <>
              <DialogHeader>
                <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                </div>
                <DialogTitle className="text-center">Sync Complete</DialogTitle>
                <DialogDescription className="text-center">
                  All pending transactions have been synced to QuickBooks.
                </DialogDescription>
              </DialogHeader>
              
              {syncResults && (
                <div className="py-4">
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Transactions Synced</span>
                      <span className="text-sm font-semibold text-success">{syncResults.synced}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Failed</span>
                      <span className="text-sm font-semibold">{syncResults.failed}</span>
                    </div>
                    <div className="border-t border-border pt-3 flex justify-between">
                      <span className="text-sm font-medium">Sync Time</span>
                      <span className="text-sm text-muted-foreground">
                        {new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button onClick={() => setSyncModalOpen(false)} className="w-full gap-2">
                  <Check className="w-4 h-4" />
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
