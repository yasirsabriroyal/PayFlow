'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bug,
  Lightbulb,
  Sparkles,
  MessageSquare,
  ArrowLeft,
  Send,
  Paperclip,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { createFeedbackTicket } from '@/lib/actions/feedback'
import { type FeedbackType } from '@/lib/feedback/constants'
import Link from 'next/link'

// ─── Constants ───────────────────────────────────────────────────────────────

const FEEDBACK_TYPES: { value: FeedbackType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'bug_report',
    label: 'Bug Report',
    description: 'Something is broken or not working as expected.',
    icon: <Bug className="w-4 h-4" />,
  },
  {
    value: 'feature_request',
    label: 'Feature Request',
    description: 'Request a new feature or capability.',
    icon: <Lightbulb className="w-4 h-4" />,
  },
  {
    value: 'suggestion',
    label: 'Suggestion',
    description: 'Suggest an improvement to an existing feature.',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    value: 'general',
    label: 'General Feedback',
    description: 'Share general thoughts or product feedback.',
    icon: <MessageSquare className="w-4 h-4" />,
  },
]

const MODULE_OPTIONS = [
  'Invoices',
  'Payments',
  'Projects',
  'Contractors',
  'Reports',
  'Settings',
  'Notifications',
  'Dashboard',
  'Other',
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewFeedbackPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [successTicket, setSuccessTicket] = useState<string | null>(null)

  const [type, setType] = useState<FeedbackType>('bug_report')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [modulePage, setModulePage] = useState<string>('')

  // Bug-specific
  const [stepsToReproduce, setStepsToReproduce] = useState('')
  const [expectedResult, setExpectedResult] = useState('')
  const [actualResult, setActualResult] = useState('')

  // Feature-specific
  const [businessReason, setBusinessReason] = useState('')
  const [desiredOutcome, setDesiredOutcome] = useState('')

  // Attachments
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<File[]>([])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAttachments((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...files.filter((f) => !existing.has(f.name + f.size))]
    })
    // Reset input so the same file can be re-added after removal
    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!title.trim() || !description.trim()) {
      setError('Title and description are required.')
      return
    }

    startTransition(async () => {
      const result = await createFeedbackTicket({
        type,
        title: title.trim(),
        description: description.trim(),
        module_page:         modulePage || undefined,
        steps_to_reproduce:  type === 'bug_report'      ? stepsToReproduce.trim() || undefined : undefined,
        expected_result:     type === 'bug_report'      ? expectedResult.trim()   || undefined : undefined,
        actual_result:       type === 'bug_report'      ? actualResult.trim()     || undefined : undefined,
        business_reason:     type === 'feature_request' ? businessReason.trim()   || undefined : undefined,
        desired_outcome:     type === 'feature_request' ? desiredOutcome.trim()   || undefined : undefined,
      })

      if (result.success && result.ticketId && result.ticketNumber) {
        // Upload any selected attachments now that we have a ticket ID
        if (attachments.length > 0) {
          await Promise.allSettled(
            attachments.map((file) => {
              const fd = new FormData()
              fd.append('file', file)
              fd.append('ticket_id', result.ticketId!)
              return fetch('/api/feedback/upload', { method: 'POST', body: fd })
            })
          )
        }

        setSuccessTicket(result.ticketNumber)
        // Redirect to My Feedback after a brief moment
        setTimeout(() => router.push('/feedback'), 2000)
      } else {
        setError(result.error ?? 'An unexpected error occurred. Please try again.')
      }
    })
  }

  if (successTicket) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Feedback Submitted" />
        <main className="max-w-2xl mx-auto px-4 py-24 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mb-2">
            <MessageSquare className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold">Feedback submitted successfully</h2>
          <p className="text-muted-foreground">
            Your ticket <span className="font-mono font-semibold text-foreground">{successTicket}</span> has been created.
            Our team will review it shortly. Redirecting you now...
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Submit Feedback" />
      <RoleTabBar role="admin" />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="mb-8">
          <Link
            href="/feedback"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to My Feedback
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Submit Feedback</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Help us improve PayFlow. All submissions are reviewed by our team.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Feedback type selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Feedback Type <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  type="button"
                  onClick={() => setType(ft.value)}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                    type === ft.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
                  }`}
                >
                  <span className={`mt-0.5 ${type === ft.value ? 'text-primary' : 'text-muted-foreground'}`}>
                    {ft.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium leading-tight">{ft.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ft.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Core fields */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-sm font-medium">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="Brief summary of the issue or request"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Provide as much detail as possible..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[120px]"
                maxLength={5000}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="module" className="text-sm font-medium text-muted-foreground">
                Module / Page <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Select value={modulePage} onValueChange={setModulePage}>
                <SelectTrigger id="module">
                  <SelectValue placeholder="Which part of the app does this relate to?" />
                </SelectTrigger>
                <SelectContent>
                  {MODULE_OPTIONS.map((mod) => (
                    <SelectItem key={mod} value={mod}>{mod}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Attachments <span className="text-muted-foreground text-xs font-normal">(optional — PDF, PNG, JPEG, max 10MB each)</span>
            </Label>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {attachments.length > 0 && (
              <div className="space-y-1.5">
                {attachments.map((file, i) => (
                  <div
                    key={`${file.name}-${file.size}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border text-sm"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 truncate text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              <Paperclip className="w-3.5 h-3.5" />
              {attachments.length === 0 ? 'Add attachment' : 'Add another'}
            </Button>
          </div>

          {/* Bug-specific fields */}
          {type === 'bug_report' && (
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Bug className="w-4 h-4 text-red-500" />
                  Bug Details
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  These details help us reproduce and fix the issue faster.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="steps" className="text-sm font-medium text-muted-foreground">
                  Steps to Reproduce <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="steps"
                  placeholder="1. Go to...&#10;2. Click on...&#10;3. See error"
                  value={stepsToReproduce}
                  onChange={(e) => setStepsToReproduce(e.target.value)}
                  className="min-h-[90px] font-mono text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expected" className="text-sm font-medium text-muted-foreground">
                    Expected Result
                  </Label>
                  <Textarea
                    id="expected"
                    placeholder="What should happen?"
                    value={expectedResult}
                    onChange={(e) => setExpectedResult(e.target.value)}
                    className="min-h-[80px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="actual" className="text-sm font-medium text-muted-foreground">
                    Actual Result
                  </Label>
                  <Textarea
                    id="actual"
                    placeholder="What actually happens?"
                    value={actualResult}
                    onChange={(e) => setActualResult(e.target.value)}
                    className="min-h-[80px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Feature-specific fields */}
          {type === 'feature_request' && (
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-yellow-500" />
                  Feature Context
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Help us understand the business need behind this request.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="business" className="text-sm font-medium text-muted-foreground">
                  Business Reason <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="business"
                  placeholder="Why is this feature needed? What problem does it solve?"
                  value={businessReason}
                  onChange={(e) => setBusinessReason(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="outcome" className="text-sm font-medium text-muted-foreground">
                  Desired Outcome <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="outcome"
                  placeholder="What would success look like?"
                  value={desiredOutcome}
                  onChange={(e) => setDesiredOutcome(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" type="button" asChild>
              <Link href="/feedback">Cancel</Link>
            </Button>
            <Button type="submit" disabled={isPending}>
              <Send className="w-4 h-4 mr-2" />
              {isPending ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
