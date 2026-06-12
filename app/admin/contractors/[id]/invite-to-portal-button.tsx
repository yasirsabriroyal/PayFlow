'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Loader2, Copy, Check, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  getContractorPortalStatus,
  inviteContractorToPortal,
  type ContractorPortalStatus,
} from '@/app/admin/contractors/actions'

export function InviteToPortalButton({
  contractorId,
  defaultEmail,
}: {
  contractorId: string
  defaultEmail?: string
}) {
  const [status, setStatus] = useState<ContractorPortalStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(defaultEmail || '')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadStatus = useCallback(async () => {
    const res = await getContractorPortalStatus(contractorId)
    if (res.success && res.status) setStatus(res.status)
  }, [contractorId])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const buildUrl = (token: string) =>
    `${window.location.origin}/vendor/accept-invite?token=${token}`

  const handleSend = async () => {
    setIsSending(true)
    setError(null)
    try {
      const res = await inviteContractorToPortal({ contractorId, email: email.trim() || undefined })
      if (!res.success) {
        setError(res.error || 'Failed to send invitation')
        return
      }
      // Prefer an origin-based URL so the copyable link always matches this host
      setInviteUrl(buildUrl(res.data.token))
      await loadStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setIsSending(false)
    }
  }

  const handleCopy = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Already has a login — nothing to invite
  if (status?.hasLogin) {
    return (
      <Badge variant="secondary" className="gap-1 self-start">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Portal Active
      </Badge>
    )
  }

  const hasPending = !!status?.pendingInvitation

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setInviteUrl(null)
          setError(null)
        }
      }}
    >
      <Button size="sm" variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <UserPlus className="w-4 h-4" />
        {hasPending ? 'Resend Invite' : 'Invite to Portal'}
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to Vendor Portal</DialogTitle>
          <DialogDescription>
            Send a secure link so this contractor can set a password and access the portal to
            submit invoices and track payments.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-success/10 text-success-foreground text-sm p-3 rounded-md border border-success/20">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-success" />
              <span>Invitation sent. You can also share this link directly:</span>
            </div>
            <div className="flex items-center gap-2">
              <Input value={inviteUrl} readOnly className="text-xs" />
              <Button size="icon" variant="outline" onClick={handleCopy} aria-label="Copy invite link">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {hasPending && status?.pendingInvitation && (
              <div className="flex items-start gap-2 bg-amber-500/10 text-amber-700 text-sm p-3 rounded-md border border-amber-500/20">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  A pending invitation already exists for {status.pendingInvitation.email}. Sending
                  again will replace it with a new link.
                </span>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="invite-email">Invitation Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="accounts@company.ca"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {inviteUrl ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={handleSend} disabled={isSending} className="gap-2">
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  {hasPending ? 'Resend Invitation' : 'Send Invitation'}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
