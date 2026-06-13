'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { CheckCircle2, XCircle, FileText, Building2, Clock } from 'lucide-react'
import { approveBankingChangeRequest, rejectBankingChangeRequest } from '@/lib/actions/banking-changes'

interface BankingRequest {
  id: string
  status: string
  contractorId: string
  companyName: string
  contactName: string | null
  email: string | null
  newBankName: string | null
  newAccountMasked: string | null
  oldBankName: string | null
  oldAccountMasked: string | null
  hasVoidCheque: boolean
  reason: string | null
  createdAt: string
  decidedAt: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-warning/10 text-warning border-warning/20',
  approved: 'bg-success/10 text-success border-success/20',
  rejected: 'bg-destructive/10 text-destructive border-destructive/20',
}

export function BankingChangesList({ requests }: { requests: BankingRequest[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')

  async function handleApprove(id: string) {
    setLoadingId(id)
    const res = await approveBankingChangeRequest(id)
    if (res.success) {
      toast({ title: 'Banking change approved', description: 'The new account is now on file.' })
      router.refresh()
    } else {
      toast({ title: 'Unable to approve', description: res.error || 'Please try again.', variant: 'destructive' })
    }
    setLoadingId(null)
  }

  async function handleReject() {
    if (!rejectId) return
    setLoadingId(rejectId)
    const res = await rejectBankingChangeRequest(rejectId, rejectReason)
    if (res.success) {
      toast({ title: 'Request rejected', description: 'The contractor has been notified.' })
      setRejectId(null)
      setRejectReason('')
      router.refresh()
    } else {
      toast({ title: 'Unable to reject', description: res.error || 'Please try again.', variant: 'destructive' })
    }
    setLoadingId(null)
  }

  function renderCard(r: BankingRequest, actionable: boolean) {
    return (
      <div key={r.id} className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{r.companyName}</p>
              <p className="text-sm text-muted-foreground truncate">
                {r.contactName || r.email || 'Contractor'}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={STATUS_STYLES[r.status] ?? ''}>
            {r.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase text-muted-foreground mb-1">Current</p>
            <p className="text-sm font-medium">{r.oldBankName || '—'}</p>
            <p className="text-sm font-mono">{r.oldAccountMasked || 'No account on file'}</p>
          </div>
          <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
            <p className="text-xs uppercase text-muted-foreground mb-1">Requested</p>
            <p className="text-sm font-medium">{r.newBankName || '—'}</p>
            <p className="text-sm font-mono">{r.newAccountMasked || '—'}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {new Date(r.createdAt).toLocaleDateString('en-CA')}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" />
            {r.hasVoidCheque ? 'Void cheque attached' : 'No void cheque'}
          </span>
        </div>

        {r.status === 'rejected' && r.reason && (
          <p className="mt-3 text-sm text-destructive">Reason: {r.reason}</p>
        )}

        {actionable && (
          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              size="sm"
              onClick={() => handleApprove(r.id)}
              disabled={loadingId === r.id}
              className="gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejectId(r.id)}
              disabled={loadingId === r.id}
              className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            No pending banking change requests.
          </div>
        ) : (
          pending.map((r) => renderCard(r, true))
        )}
      </section>

      {decided.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Decided
          </h2>
          {decided.map((r) => renderCard(r, false))}
        </section>
      )}

      <Dialog open={Boolean(rejectId)} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Banking Change</DialogTitle>
            <DialogDescription>
              Provide a reason. The contractor will be notified and their banking will remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || loadingId === rejectId}
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
