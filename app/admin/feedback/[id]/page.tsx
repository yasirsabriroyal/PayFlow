'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bug,
  Lightbulb,
  Sparkles,
  MessageSquare,
  Clock,
  User,
  Send,
  ChevronRight,
  Lock,
  Globe,
  Paperclip,
  CheckCircle2,
  AlertCircle,
  UserCircle,
  Calendar,
  Tag,
  Layers,
  ThumbsUp,
  Flag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import {
  getFeedbackTicket,
  updateFeedbackStatus,
  assignFeedbackTicket,
  addFeedbackComment,
  setFeedbackPriority,
  getAdminUsersForAssignment,
  type FeedbackTicketDetail,
  type FeedbackPriority,
  FEEDBACK_PRIORITY_LABELS,
} from '@/lib/actions/feedback'
import {
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  isTransitionAllowed,
  type FeedbackStatus,
  type FeedbackType,
} from '@/lib/feedback/constants'
import Link from 'next/link'

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
  bug_report:      <Bug className="w-4 h-4 text-red-500" />,
  feature_request: <Lightbulb className="w-4 h-4 text-yellow-500" />,
  suggestion:      <Sparkles className="w-4 h-4 text-sky-500" />,
  general:         <MessageSquare className="w-4 h-4 text-muted-foreground" />,
}

const ALL_STATUSES = Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </p>
  )
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <span className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0">{icon}</span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium text-foreground">{value}</span>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminFeedbackDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()

  const [ticket, setTicket]               = useState<FeedbackTicketDetail | null>(null)
  const [loading, setLoading]             = useState(true)
  const [adminUsers, setAdminUsers]       = useState<Array<{ id: string; name: string; role: string }>>([])
  const [activeTab, setActiveTab]         = useState<'comments' | 'notes' | 'history' | 'attachments'>('comments')

  // Status update
  const [newStatus, setNewStatus]         = useState<FeedbackStatus | ''>('')
  const [statusReason, setStatusReason]   = useState('')
  const [statusError, setStatusError]     = useState<string | null>(null)
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null)
  const [isPendingStatus, startStatusTransition] = useTransition()

  // Assign
  const [assignee, setAssignee]           = useState<string>('')
  const [assignError, setAssignError]     = useState<string | null>(null)
  const [isPendingAssign, startAssignTransition] = useTransition()

  // Comment / note
  const [commentBody, setCommentBody]     = useState('')
  const [commentIsInternal, setCommentIsInternal] = useState(false)
  const [commentError, setCommentError]   = useState<string | null>(null)
  const [isPendingComment, startCommentTransition] = useTransition()

  // Priority
  const [priorityPending, setPriorityPending] = useState(false)

  const load = useCallback(async () => {
    const [data, users] = await Promise.all([
      getFeedbackTicket(params.id, true),
      getAdminUsersForAssignment(),
    ])
    setTicket(data)
    setAdminUsers(users)
    if (data) {
      setAssignee(data.assigned_to ?? 'unassigned')
    }
    setLoading(false)
  }, [params.id])

  useEffect(() => { load() }, [load])

  const handleStatusUpdate = () => {
    if (!newStatus) return
    setStatusError(null)
    setStatusSuccess(null)
    startStatusTransition(async () => {
      const result = await updateFeedbackStatus(params.id, newStatus as FeedbackStatus, statusReason || undefined)
      if (result.success) {
        setStatusSuccess(`Status updated to "${FEEDBACK_STATUS_LABELS[newStatus as FeedbackStatus]}".`)
        setNewStatus('')
        setStatusReason('')
        await load()
      } else {
        setStatusError(result.error ?? 'Failed to update status.')
      }
    })
  }

  const handleAssign = (userId: string) => {
    setAssignee(userId)
    setAssignError(null)
    startAssignTransition(async () => {
      const result = await assignFeedbackTicket(params.id, userId === 'unassigned' ? null : userId)
      if (!result.success) {
        setAssignError(result.error ?? 'Failed to assign ticket.')
      } else {
        await load()
      }
    })
  }

  const handlePostComment = () => {
    if (!commentBody.trim()) return
    setCommentError(null)
    startCommentTransition(async () => {
      const result = await addFeedbackComment(params.id, commentBody.trim(), commentIsInternal)
      if (result.success) {
        setCommentBody('')
        await load()
        // Switch to the relevant tab
        setActiveTab(commentIsInternal ? 'notes' : 'comments')
      } else {
        setCommentError(result.error ?? 'Failed to post.')
      }
    })
  }

  const handlePriorityChange = async (priority: FeedbackPriority | 'none') => {
    if (priorityPending) return
    setPriorityPending(true)
    await setFeedbackPriority(params.id, priority === 'none' ? null : priority)
    await load()
    setPriorityPending(false)
  }

  // ─── Loading ─────────────────────────────────────────────────────────────����──

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Feedback" />
        <RoleTabBar role="admin" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            Loading ticket...
          </div>
        </main>
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Feedback" />
        <RoleTabBar role="admin" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-muted-foreground" />
            <p className="text-lg font-medium">Ticket not found</p>
            <p className="text-sm text-muted-foreground">This ticket may have been deleted or you don&apos;t have access.</p>
            <Button variant="outline" size="sm" onClick={() => router.push('/admin/feedback')}>
              Back to inbox
            </Button>
          </div>
        </main>
      </div>
    )
  }

  const allowedTransitions = ALL_STATUSES.filter(
    (s) => s !== ticket.status && isTransitionAllowed(ticket.status, s)
  )

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Feedback" />
      <RoleTabBar role="admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Back + breadcrumb */}
        <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
          <Link
            href="/admin/feedback"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Feedback Inbox
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="font-mono text-xs">{ticket.ticket_number}</span>
        </div>

        {/* Page layout: main content + right sidebar */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* ── LEFT: Main content ─────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Ticket header card */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                    {TYPE_ICON[ticket.type]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground font-mono mb-1">{ticket.ticket_number}</p>
                    <h1 className="text-xl font-semibold leading-snug text-balance">{ticket.title}</h1>
                  </div>
                </div>
                <span
                  className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_VARIANT[ticket.status]}`}
                >
                  {FEEDBACK_STATUS_LABELS[ticket.status]}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground border-t border-border pt-4">
                <span className="flex items-center gap-1.5">
                  {TYPE_ICON[ticket.type]}
                  {FEEDBACK_TYPE_LABELS[ticket.type]}
                </span>
                {ticket.module_page && (
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3" />
                    {ticket.module_page}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  {formatDateShort(ticket.created_at)}
                </span>
                <span className="flex items-center gap-1.5">
                  <ThumbsUp className="w-3 h-3" />
                  {ticket.vote_count ?? 0} {ticket.vote_count === 1 ? 'vote' : 'votes'}
                </span>
                {/* Priority selector */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <Flag className="w-3 h-3" />
                  <Select
                    value={ticket.priority ?? 'none'}
                    onValueChange={(v) => handlePriorityChange(v as FeedbackPriority | 'none')}
                    disabled={priorityPending}
                  >
                    <SelectTrigger className="h-6 text-xs px-2 w-28 border-dashed">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No priority</SelectItem>
                      {(Object.entries(FEEDBACK_PRIORITY_LABELS) as [FeedbackPriority, string][]).map(([val, label]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Description + type-conditional fields */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-5">
              <div>
                <SectionLabel>Description</SectionLabel>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
              </div>

              {/* Bug-specific */}
              {ticket.type === 'bug_report' && (ticket.steps_to_reproduce || ticket.expected_result || ticket.actual_result) && (
                <>
                  {ticket.steps_to_reproduce && (
                    <div>
                      <SectionLabel>Steps to Reproduce</SectionLabel>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.steps_to_reproduce}</p>
                    </div>
                  )}
                  {ticket.expected_result && (
                    <div>
                      <SectionLabel>Expected Result</SectionLabel>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.expected_result}</p>
                    </div>
                  )}
                  {ticket.actual_result && (
                    <div>
                      <SectionLabel>Actual Result</SectionLabel>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.actual_result}</p>
                    </div>
                  )}
                </>
              )}

              {/* Feature-specific */}
              {ticket.type === 'feature_request' && (ticket.business_reason || ticket.desired_outcome) && (
                <>
                  {ticket.business_reason && (
                    <div>
                      <SectionLabel>Business Reason</SectionLabel>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.business_reason}</p>
                    </div>
                  )}
                  {ticket.desired_outcome && (
                    <div>
                      <SectionLabel>Desired Outcome</SectionLabel>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.desired_outcome}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Tabs: Comments / Internal Notes / History / Attachments */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-border">
                {([
                  { key: 'comments',    label: `Comments (${ticket.comments.length})` },
                  { key: 'notes',       label: `Internal Notes (${ticket.internal_notes.length})` },
                  { key: 'history',     label: `History (${ticket.status_history.length})` },
                  { key: 'attachments', label: `Attachments (${ticket.attachments.length})` },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                      activeTab === key
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab: Comments */}
              {activeTab === 'comments' && (
                <div className="p-5 space-y-4">
                  {ticket.comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No public comments yet.</p>
                  ) : (
                    ticket.comments.map((c) => (
                      <div key={c.id} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-sm font-medium">{c.author_name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{c.author_role.replace('_', ' ')}</span>
                            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{formatDate(c.created_at)}</span>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-muted/40 rounded-lg px-4 py-3">
                            {c.body}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab: Internal Notes */}
              {activeTab === 'notes' && (
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-200 rounded-lg px-3 py-2">
                    <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                    Internal notes are only visible to admins. Submitters will never see this content.
                  </div>
                  {ticket.internal_notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No internal notes yet.</p>
                  ) : (
                    ticket.internal_notes.map((n) => (
                      <div key={n.id} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                          <Lock className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-sm font-medium">{n.author_name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{n.author_role.replace('_', ' ')}</span>
                            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{formatDate(n.created_at)}</span>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-amber-500/5 border border-amber-200/50 rounded-lg px-4 py-3">
                            {n.body}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab: Status History */}
              {activeTab === 'history' && (
                <div className="p-5">
                  {ticket.status_history.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No status changes recorded yet.</p>
                  ) : (
                    <ol className="relative border-l border-border ml-3 space-y-0">
                      {ticket.status_history.map((h, i) => (
                        <li key={h.id} className="ml-5 pb-6 last:pb-0">
                          <span className="absolute -left-[9px] w-4 h-4 rounded-full bg-card border-2 border-primary flex items-center justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          </span>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {h.old_status && (
                              <>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[h.old_status as FeedbackStatus]}`}>
                                  {FEEDBACK_STATUS_LABELS[h.old_status as FeedbackStatus] ?? h.old_status}
                                </span>
                                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                              </>
                            )}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[h.new_status as FeedbackStatus]}`}>
                              {FEEDBACK_STATUS_LABELS[h.new_status as FeedbackStatus] ?? h.new_status}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">{formatDate(h.created_at)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            by <span className="font-medium text-foreground">{h.changed_by_name}</span>
                            {' '}&middot; <span className="capitalize">{h.changed_by_role.replace('_', ' ')}</span>
                          </p>
                          {h.reason && (
                            <p className="text-xs text-muted-foreground mt-1 italic">&ldquo;{h.reason}&rdquo;</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Tab: Attachments */}
              {activeTab === 'attachments' && (
                <div className="p-5">
                  {ticket.attachments.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      <Paperclip className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                      No attachments on this ticket.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ticket.attachments.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20"
                        >
                          <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm font-medium flex-1 min-w-0 truncate">{a.file_name}</span>
                          {a.file_size_bytes && (
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {formatFileSize(a.file_size_bytes)}
                            </span>
                          )}
                          <a
                            href={`/api/feedback/attachments/${a.id}?inline=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex-shrink-0 ml-2"
                          >
                            View
                          </a>
                          <a
                            href={`/api/feedback/attachments/${a.id}`}
                            className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                            download={a.file_name}
                          >
                            Download
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Compose comment / internal note */}
            <div className="bg-card border border-border rounded-xl p-5">
              <SectionLabel>Add Comment or Internal Note</SectionLabel>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setCommentIsInternal(false)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    !commentIsInternal
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Public Comment
                </button>
                <button
                  onClick={() => setCommentIsInternal(true)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    commentIsInternal
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  Internal Note
                </button>
              </div>
              {commentIsInternal && (
                <p className="text-xs text-amber-600 mb-2">
                  This note will only be visible to admins. The submitter will not be notified.
                </p>
              )}
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={commentIsInternal ? 'Add an internal note for the team...' : 'Write a public response visible to the submitter...'}
                className={`mb-3 resize-none ${commentIsInternal ? 'border-amber-200 focus-visible:ring-amber-400' : ''}`}
                rows={4}
              />
              {commentError && (
                <p className="text-xs text-destructive mb-2">{commentError}</p>
              )}
              <Button
                onClick={handlePostComment}
                disabled={!commentBody.trim() || isPendingComment}
                className={commentIsInternal ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}
                size="sm"
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {isPendingComment
                  ? 'Posting...'
                  : commentIsInternal
                  ? 'Post Internal Note'
                  : 'Post Comment'}
              </Button>
            </div>
          </div>

          {/* ── RIGHT: Admin sidebar ───────────────────────────────────────── */}
          <div className="lg:w-72 flex-shrink-0 space-y-4">

            {/* Update status */}
            <div className="bg-card border border-border rounded-xl p-5">
              <SectionLabel>Update Status</SectionLabel>

              {allowedTransitions.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  No further transitions available.
                </div>
              ) : (
                <>
                  <Select value={newStatus} onValueChange={(v) => { setNewStatus(v as FeedbackStatus); setStatusError(null); setStatusSuccess(null) }}>
                    <SelectTrigger className="w-full mb-3">
                      <SelectValue placeholder="Select new status..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedTransitions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {FEEDBACK_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Textarea
                    placeholder="Reason for change (optional)"
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    className="mb-3 resize-none text-sm"
                    rows={2}
                  />

                  {statusError && (
                    <p className="text-xs text-destructive mb-2">{statusError}</p>
                  )}
                  {statusSuccess && (
                    <p className="text-xs text-green-600 mb-2">{statusSuccess}</p>
                  )}

                  <Button
                    className="w-full"
                    size="sm"
                    disabled={!newStatus || isPendingStatus}
                    onClick={handleStatusUpdate}
                  >
                    {isPendingStatus ? 'Updating...' : 'Update Status'}
                  </Button>
                </>
              )}
            </div>

            {/* Ticket meta */}
            <div className="bg-card border border-border rounded-xl p-5">
              <SectionLabel>Ticket Details</SectionLabel>
              <div className="divide-y divide-border">
                <MetaRow
                  icon={<Tag className="w-4 h-4" />}
                  label="Current Status"
                  value={
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[ticket.status]}`}>
                      {FEEDBACK_STATUS_LABELS[ticket.status]}
                    </span>
                  }
                />
                <MetaRow
                  icon={<UserCircle className="w-4 h-4" />}
                  label="Submitted By"
                  value={
                    <span>
                      {ticket.submitted_by_name}
                      {ticket.submitted_by_email && (
                        <span className="block text-xs text-muted-foreground font-normal">{ticket.submitted_by_email}</span>
                      )}
                    </span>
                  }
                />
                <MetaRow
                  icon={<Calendar className="w-4 h-4" />}
                  label="Submitted"
                  value={formatDateShort(ticket.created_at)}
                />
                <MetaRow
                  icon={<Clock className="w-4 h-4" />}
                  label="Last Updated"
                  value={formatDate(ticket.updated_at)}
                />
                {ticket.resolved_at && (
                  <MetaRow
                    icon={<CheckCircle2 className="w-4 h-4" />}
                    label="Resolved"
                    value={formatDateShort(ticket.resolved_at)}
                  />
                )}
              </div>
            </div>

            {/* Assignee */}
            <div className="bg-card border border-border rounded-xl p-5">
              <SectionLabel>Assignee</SectionLabel>
              <Select
                value={assignee}
                onValueChange={handleAssign}
                disabled={isPendingAssign}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {adminUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                      <span className="text-xs text-muted-foreground ml-1.5 capitalize">
                        {u.role.replace('_', ' ')}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignError && (
                <p className="text-xs text-destructive mt-1.5">{assignError}</p>
              )}
            </div>

            {/* Quick stats */}
            <div className="bg-card border border-border rounded-xl p-5">
              <SectionLabel>Activity</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold">{ticket.comments.length}</p>
                  <p className="text-xs text-muted-foreground">Comments</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold">{ticket.internal_notes.length}</p>
                  <p className="text-xs text-muted-foreground">Notes</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold">{ticket.status_history.length}</p>
                  <p className="text-xs text-muted-foreground">Updates</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold">{ticket.attachments.length}</p>
                  <p className="text-xs text-muted-foreground">Files</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
