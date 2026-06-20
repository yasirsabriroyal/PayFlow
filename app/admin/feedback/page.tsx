'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bug,
  Lightbulb,
  Sparkles,
  MessageSquare,
  Search,
  ChevronRight,
  Filter,
  Users,
  FileText,
  Clock,
  CheckCircle2,
  InboxIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import {
  getFeedbackTickets,
  type FeedbackTicket,
} from '@/lib/actions/feedback'
import {
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackStatus,
  type FeedbackType,
} from '@/lib/feedback/constants'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<FeedbackStatus, string> = {
  submitted:    'bg-blue-500/10 text-blue-600 border-blue-200',
  under_review: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
  planned:      'bg-sky-500/10 text-sky-600 border-sky-200',
  in_progress:  'bg-orange-500/10 text-orange-600 border-orange-200',
  resolved:     'bg-green-500/10 text-green-600 border-green-200',
  released:     'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  declined:     'bg-red-500/10 text-red-600 border-red-200',
  archived:     'bg-muted text-muted-foreground border-border',
}

const TYPE_ICON: Record<FeedbackType, React.ReactNode> = {
  bug_report:      <Bug className="w-3.5 h-3.5 text-red-500" />,
  feature_request: <Lightbulb className="w-3.5 h-3.5 text-yellow-500" />,
  suggestion:      <Sparkles className="w-3.5 h-3.5 text-sky-500" />,
  general:         <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />,
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const ALL_STATUSES = Object.entries(FEEDBACK_STATUS_LABELS) as [FeedbackStatus, string][]
const ALL_TYPES    = Object.entries(FEEDBACK_TYPE_LABELS)   as [FeedbackType, string][]

const MODULE_OPTIONS = [
  'Invoices', 'Payments', 'Projects', 'Contractors', 'Reports',
  'Settings', 'Notifications', 'Dashboard', 'Other',
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminFeedbackInboxPage() {
  const router = useRouter()
  const [tickets, setTickets] = useState<FeedbackTicket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch]     = useState('')
  const [typeFilter, setType]   = useState<FeedbackType | 'all'>('all')
  const [statusFilter, setStatus] = useState<FeedbackStatus | 'all'>('all')
  const [moduleFilter, setModule] = useState<string>('all')

  // Stats (derived from first full load)
  const [stats, setStats] = useState({ total: 0, open: 0, resolved: 0 })

  const load = useCallback(async (loadStats = false) => {
    setLoading(true)
    const result = await getFeedbackTickets(
      {
        search:     search || undefined,
        type:       typeFilter  !== 'all' ? typeFilter  : undefined,
        status:     statusFilter !== 'all' ? statusFilter : undefined,
        modulePage: moduleFilter !== 'all' ? moduleFilter : undefined,
      },
      true
    )
    setTickets(result.tickets)
    setTotal(result.total)
    if (loadStats) {
      // Compute stats from an unfiltered fetch
      const allResult = await getFeedbackTickets({}, true)
      const all = allResult.tickets
      setStats({
        total:    allResult.total,
        open:     all.filter(t => !['resolved','released','archived','declined'].includes(t.status)).length,
        resolved: all.filter(t => t.status === 'resolved' || t.status === 'released').length,
      })
    }
    setLoading(false)
  }, [search, typeFilter, statusFilter, moduleFilter])

  useEffect(() => { load(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(false) }, [load])

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Feedback Inbox" />
      <RoleTabBar role="admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Feedback Inbox</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review and manage all user submissions.
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <InboxIcon className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total</p>
                <p className="text-xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Clock className="w-4.5 h-4.5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Open</p>
                <p className="text-xl font-semibold">{stats.open}</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-4.5 h-4.5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Resolved</p>
                <p className="text-xl font-semibold">{stats.resolved}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tickets or ticket numbers..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={typeFilter} onValueChange={(v) => setType(v as FeedbackType | 'all')}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {ALL_TYPES.map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatus(v as FeedbackStatus | 'all')}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {ALL_STATUSES.map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={moduleFilter} onValueChange={setModule}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {MODULE_OPTIONS.map((mod) => (
                <SelectItem key={mod} value={mod}>{mod}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {loading ? 'Loading...' : `${total} ticket${total !== 1 ? 's' : ''}`}
            </p>
          </div>

          {!loading && tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <InboxIcon className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No submissions found</p>
              <p className="text-sm text-muted-foreground">
                {search || typeFilter !== 'all' || statusFilter !== 'all'
                  ? 'Try adjusting your filters.'
                  : 'No feedback tickets have been submitted yet.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Ticket</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Submitter</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/admin/feedback/${ticket.id}`)}
                  >
                    <TableCell className="pl-5 font-mono text-xs text-muted-foreground">
                      {ticket.ticket_number}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {TYPE_ICON[ticket.type]}
                        {FEEDBACK_TYPE_LABELS[ticket.type]}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-sm max-w-[220px] truncate">
                      {ticket.title}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ticket.submitted_by_name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ticket.module_page ?? '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[ticket.status]}`}
                      >
                        {FEEDBACK_STATUS_LABELS[ticket.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ticket.assigned_to_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(ticket.created_at)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </main>
    </div>
  )
}
