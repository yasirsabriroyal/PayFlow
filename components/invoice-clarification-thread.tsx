'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  getInvoiceThread,
  postInvoiceMessage,
  type ThreadMessage,
} from '@/lib/invoices/clarification-thread'
import { MessageSquare, Paperclip, Send, X, FileText, Download, Loader2 } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  accountant: 'Accountant',
  project_manager: 'Project Manager',
  contractor: 'Contractor',
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function InvoiceClarificationThread({ invoiceId }: { invoiceId: string }) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const result = await getInvoiceThread(invoiceId)
    if (result.success && result.messages) {
      setMessages(result.messages)
    }
    setLoading(false)
  }, [invoiceId])

  useEffect(() => {
    load()
  }, [load])

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    const allowed = ['application/pdf', 'image/png', 'image/jpeg']
    const valid = picked.filter((f) => allowed.includes(f.type) && f.size <= 10 * 1024 * 1024)
    if (valid.length !== picked.length) {
      toast({
        title: 'Some files skipped',
        description: 'Only PDF, PNG, or JPEG files up to 10MB are allowed.',
        variant: 'destructive',
      })
    }
    setFiles((prev) => [...prev, ...valid])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSend() {
    const trimmed = body.trim()
    if (!trimmed) {
      toast({ title: 'Message required', description: 'Type a message before sending.', variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      const result = await postInvoiceMessage(invoiceId, trimmed)
      if (!result.success || !result.messageId) {
        toast({ title: 'Unable to send', description: result.error || 'Failed to send message', variant: 'destructive' })
        return
      }

      // Upload any attachments against the new message.
      if (files.length > 0) {
        let failed = 0
        for (const file of files) {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('invoice_id', invoiceId)
          fd.append('message_id', result.messageId)
          const res = await fetch('/api/invoice-messages/upload', { method: 'POST', body: fd })
          if (!res.ok) failed += 1
        }
        if (failed > 0) {
          toast({
            title: 'Some attachments failed',
            description: `${failed} file(s) could not be uploaded.`,
            variant: 'destructive',
          })
        }
      }

      setBody('')
      setFiles([])
      await load()
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Clarification Thread
        </CardTitle>
        <CardDescription>
          Ask questions or share corrections with the contractor and finance team. Posting here does
          not change the invoice status.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Messages */}
        <div className="flex flex-col gap-3" aria-live="polite">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading messages</span>
            </div>
          ) : messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No messages yet. Start the conversation below.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col gap-1 rounded-lg border p-3 ${
                  m.isMine ? 'border-primary/30 bg-primary/5' : 'bg-muted/40'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{m.authorName}</span>
                  <Badge variant={m.authorKind === 'contractor' ? 'secondary' : 'outline'}>
                    {ROLE_LABELS[m.authorRole] || m.authorRole}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatTime(m.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{m.body}</p>
                {m.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={`/api/invoice-messages/attachments/${a.id}?inline=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted"
                      >
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="max-w-[180px] truncate">{a.fileName}</span>
                        {a.fileSizeBytes ? (
                          <span className="text-muted-foreground">{formatBytes(a.fileSizeBytes)}</span>
                        ) : null}
                        <Download className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="flex flex-col gap-2 border-t pt-4">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message…"
            rows={3}
            disabled={sending}
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              multiple
              onChange={onPickFiles}
              className="hidden"
              aria-label="Attach files"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <Paperclip className="mr-2 h-4 w-4" aria-hidden="true" />
              Attach
            </Button>
            <Button type="button" size="sm" onClick={handleSend} disabled={sending}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Send
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
