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
  Paperclip,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import {
  getFeedbackTicket,
  addFeedbackComment,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackTicketDetail,
  type FeedbackStatus,
  type FeedbackType,
} from '@/lib/actions/feedback'
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FeedbackTicketPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [ticket, setTicket] = useState<FeedbackTicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [commentBody, setCommentBody] = useState('')
  const [isPending, startTransition] = useTransition()
  const [commentError, setCommentError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await getFeedbackTicket(params.id, false)
    setTicket(data)
    setLoading(false)
  }, [params.id])

  useEffect(() => { load() }, [load])

  const handlePostComment = () => {
    if (!commentBody.trim()) return
    setCommentError(null)
    startTransition(async () => {
      const result = await addFeedbackComment(params.id, commentBody.trim(), false)
      if (result.success) {
        setCommentBody('')
        await load()
      } else {
        setCommentError(result.error ?? 'Failed to post comment.')
      }
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Feedback" />
        <main className="max-w-4xl mx-auto px-4 py-16 text-center text-muted-foreground text-sm">
          Loading...
        </main>
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Feedback" />
        <main className="max-w-4xl mx-auto px-4 py-16 text-center">
          <p className="text-muted-foreground">Ticket not found.</p>
          <Button variant="link" asChild className="mt-4">
            <Link href="/feedback">Back to My Feedback</Link>
          </Button>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle={`Ticket ${ticket.ticket_number}`} />
      <RoleTabBar role="admin" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          href="/feedback"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to My Feedback
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column — main content */}
          <div className="lg:col-span-2 space-y-5">

            {/* Ticket header card */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  {TYPE_ICON[ticket.type]}
                  <span className="text-sm text-muted-foreground">
                    {FEEDBACK_TYPE_LABELS[ticket.type]}
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-mono text-xs text-muted-foreground">{ticket.ticket_number}</span>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[ticket.status]}`}
                >
                  {FEEDBACK_STATUS_LABELS[ticket.status]}
                </span>
              </div>
              <h1 className="text-xl font-semibold text-balance">{ticket.title}</h1>
              {ticket.module_page && (
                <p className="text-xs text-muted-foreground mt-1.5">Module: {ticket.module_page}</p>
              )}
              <p className="text-sm text-muted-foreground mt-4 leading-relaxed whitespace-pre-wrap">
                {ticket.description}
              </p>
            </div>

            {/* Bug fields */}
            {ticket.type === 'bug_report' && (ticket.steps_to_reproduce || ticket.expected_result || ticket.actual_result) && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Bug className="w-4 h-4 text-red-500" />
                  Bug Details
                </h2>
                {ticket.steps_to_reproduce && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Steps to Reproduce</p>
                    <p className="text-sm whitespace-pre-wrap font-mono bg-muted/40 rounded-lg px-3 py-2">{ticket.steps_to_reproduce}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {ticket.expected_result && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Expected Result</p>
                      <p className="text-sm text-muted-foreground">{ticket.expected_result}</p>
                    </div>
                  )}
                  {ticket.actual_result && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Actual Result</p>
                      <p className="text-sm text-muted-foreground">{ticket.actual_result}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Feature fields */}
            {ticket.type === 'feature_request' && (ticket.business_reason || ticket.desired_outcome) && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-yellow-500" />
                  Feature Context
                </h2>
                {ticket.business_reason && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Business Reason</p>
                    <p className="text-sm text-muted-foreground">{ticket.business_reason}</p>
                  </div>
                )}
                {ticket.desired_outcome && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Desired Outcome</p>
                    <p className="text-sm text-muted-foreground">{ticket.desired_outcome}</p>
                  </div>
                )}
              </div>
            )}

            {/* Comments thread */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold">Comments</h2>
              </div>

              <div className="divide-y divide-border">
                {ticket.comments.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No comments yet. Our team will respond here when there are updates.
                  </div>
                ) : (
                  ticket.comments.map((comment) => (
                    <div key={comment.id} className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span className="text-sm font-medium">{comment.author_name}</span>
                        <span className="text-xs text-muted-foreground capitalize">({comment.author_role})</span>
                        <span className="text-xs text-muted-foreground ml-auto">{formatDateShort(comment.created_at)}</span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed pl-8 whitespace-pre-wrap">{comment.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Post a reply */}
              <div className="px-5 py-4 border-t border-border bg-muted/20">
                <Textarea
                  placeholder="Add a comment or follow-up..."
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  className="min-h-[80px] bg-background"
                />
                {commentError && (
                  <p className="text-xs text-destructive mt-1">{commentError}</p>
                )}
                <div className="flex justify-end mt-2">
                  <Button
                    size="sm"
                    onClick={handlePostComment}
                    disabled={isPending || !commentBody.trim()}
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    {isPending ? 'Posting...' : 'Post Comment'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Attachments */}
            {ticket.attachments.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  Attachments
                </h2>
                <div className="space-y-2">
                  {ticket.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-muted/40 transition-colors text-sm"
                    >
                      <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 truncate">{att.file_name}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column — sidebar */}
          <div className="space-y-5">

            {/* Ticket details */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold">Ticket Details</h2>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ticket</span>
                  <span className="font-mono text-xs">{ticket.ticket_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_VARIANT[ticket.status]}`}
                  >
                    {FEEDBACK_STATUS_LABELS[ticket.status]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span>{FEEDBACK_TYPE_LABELS[ticket.type]}</span>
                </div>
                {ticket.module_page && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Module</span>
                    <span>{ticket.module_page}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span>{formatDateShort(ticket.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span>{formatDateShort(ticket.updated_at)}</span>
                </div>
              </div>
            </div>

            {/* Status timeline */}
            {ticket.status_history.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold mb-4">Status History</h2>
                <div className="relative">
                  <div className="absolute left-2.5 top-0 bottom-0 w-px bg-border" />
                  <div className="space-y-4">
                    {ticket.status_history.map((h) => (
                      <div key={h.id} className="flex gap-3">
                        <div className="w-5 h-5 rounded-full bg-background border-2 border-primary flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs font-medium">
                            {h.old_status
                              ? `${FEEDBACK_STATUS_LABELS[h.old_status as FeedbackStatus] ?? h.old_status} → ${FEEDBACK_STATUS_LABELS[h.new_status as FeedbackStatus] ?? h.new_status}`
                              : FEEDBACK_STATUS_LABELS[h.new_status as FeedbackStatus] ?? h.new_status
                            }
                          </p>
                          <p className="text-xs text-muted-foreground">by {h.changed_by_name}</p>
                          {h.reason && (
                            <p className="text-xs text-muted-foreground italic mt-0.5">{h.reason}</p>
                          )}
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            {formatDate(h.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
