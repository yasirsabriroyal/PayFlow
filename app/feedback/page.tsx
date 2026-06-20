'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessageSquarePlus,
  Bug,
  Lightbulb,
  Sparkles,
  MessageSquare,
  ChevronRight,
  Clock,
  CheckCircle2,
  FileText,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getFeedbackTickets,
  getFeedbackStats,
  type FeedbackTicket,
} from '@/lib/actions/feedback'
import { createClient } from '@/lib/supabase/client'
import {
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackStatus,
  type FeedbackType,
} from '@/lib/feedback/constants'
import Link from 'next/link'

// ─── Status badge colours ────────────────────────────────────────────────────
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
  bug_report:      <Bug className="w-3.5 h-3.5" />,
  feature_request: <Lightbulb className="w-3.5 h-3.5" />,
  suggestion:      <Sparkles className="w-3.5 h-3.5" />,
  general:         <MessageSquare className="w-3.5 h-3.5" />,
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function MyFeedbackPage() {
  const router = useRouter()
  const [tickets, setTickets] = useState<FeedbackTicket[]>([])
  const [stats, setStats] = useState({ total: 0, open: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<'admin' | 'accountant' | 'project_manager' | 'contractor'>('contractor')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listResult, statsResult] = await Promise.all([
        getFeedbackTickets({}, false),
        getFeedbackStats(),
      ])
      setTickets(listResult.tickets)
      setStats(statsResult)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Resolve role from auth metadata
    createClient().auth.getUser().then(({ data }) => {
      const role = data.user?.user_metadata?.role
      if (role === 'admin' || role === 'accountant' || role === 'project_manager' || role === 'contractor') {
        setUserRole(role)
      }
    })
  }, [load])

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Feedback" />
      <RoleTabBar role={userRole} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              Feedback &amp; Enhancement Requests
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Submit and track your feedback, bug reports, and feature requests.
            </p>
          </div>
          <Button asChild>
            <Link href="/feedback/new">
              <Plus className="w-4 h-4 mr-2" />
              Submit Feedback
            </Link>
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Submitted</p>
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

        {/* Submissions table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">My Submissions</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Loading...
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <MessageSquarePlus className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No submissions yet</p>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                Submit your first feedback, bug report, or feature request to get started.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/feedback/new">Submit Feedback</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Ticket</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/feedback/${ticket.id}`)}
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
                    <TableCell className="font-medium text-sm max-w-xs truncate">
                      {ticket.title}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[ticket.status]}`}
                      >
                        {FEEDBACK_STATUS_LABELS[ticket.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(ticket.created_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(ticket.updated_at)}
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
