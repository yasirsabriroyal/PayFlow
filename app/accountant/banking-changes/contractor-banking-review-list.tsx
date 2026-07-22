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
import { CheckCircle2, XCircle, Building2, CreditCard, ShieldCheck, ShieldX, Clock, ShieldAlert } from 'lucide-react'
import { approveBankingProfile, rejectBankingProfile } from '@/lib/actions/banking-changes'
import type { ContractorBankingStatusRow } from '@/lib/actions/banking-changes'

// ─── Status display helpers ───────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  not_submitted: {
    label: 'Not Submitted',
    className: 'bg-muted text-muted-foreground border-border',
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
  },
  pending_review: {
    label: 'Pending Review',
    className: 'bg-warning/10 text-warning border-warning/20',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  approved: {
    label: 'Approved',
    className: 'bg-success/10 text-success border-success/20',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    icon: <ShieldX className="w-3.5 h-3.5" />,
  },
  superseded: {
    label: 'Superseded',
    className: 'bg-warning/10 text-warning border-warning/20',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  contractors: ContractorBankingStatusRow[]
  /** If true, show all contractors including approved ones (full overview mode) */
  showAll?: boolean
}

export function ContractorBankingReviewList({ contractors, showAll = false }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  // In overview mode filter to actionable + non-approved by default; show all when showAll=true
  const visible = showAll
    ? contractors
    : contractors.filter((c) => c.bankingApprovalStatus === 'pending_review')

  async function handleApprove(contractorId: string) {
    setLoadingId(contractorId)
    const res = await approveBankingProfile(contractorId)
    if (res.success) {
      toast({ title: 'Banking approved', description: 'Contractor banking is now approved for EFT payments.' })
      router.refresh()
    } else {
      toast({ title: 'Unable to approve', description: res.error || 'Please try again.', variant: 'destructive' })
    }
    setLoadingId(null)
  }

  async function handleReject() {
    if (!rejectId) return
    setLoadingId(rejectId)
    const res = await rejectBankingProfile(rejectId, rejectReason)
    if (res.success) {
      toast({ title: 'Banking rejected', description: 'The banking profile has been marked as rejected.' })
      setRejectId(null)
      setRejectReason('')
      router.refresh()
    } else {
      toast({ title: 'Unable to reject', description: res.error || 'Please try again.', variant: 'destructive' })
    }
    setLoadingId(null)
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {showAll ? 'No contractors found.' : 'No contractors pending direct banking review.'}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {visible.map((c) => {
          const statusConfig = STATUS_CONFIG[c.bankingApprovalStatus] ?? STATUS_CONFIG.not_submitted
          const isActionable = c.bankingApprovalStatus !== 'approved'
          const hasBankingData = Boolean(c.bankName || c.bankAccountMasked)

          return (
            <div key={c.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.companyName}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.contactName || c.email || 'Contractor'}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={`flex items-center gap-1 ${statusConfig.className}`}>
                  {statusConfig.icon}
                  {statusConfig.label}
                </Badge>
              </div>

              {/* Banking details */}
              <div className="mt-4 rounded-md bg-muted/40 p-3 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">{c.bankName || 'Bank not specified'}</p>
                  <p className="text-sm font-mono text-muted-foreground">
                    {c.bankAccountMasked || (hasBankingData ? 'Account on file' : 'No account on file')}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Last updated {new Date(c.updatedAt).toLocaleDateString('en-CA')}
              </p>

              {/* Action buttons — only shown for pending_review and rejected */}
              {isActionable && hasBankingData && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(c.id)}
                    disabled={loadingId === c.id}
                    className="gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve Banking
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setRejectId(c.id); setRejectReason('') }}
                    disabled={loadingId === c.id}
                    className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </Button>
                </div>
              )}

              {isActionable && !hasBankingData && (
                <p className="mt-3 text-xs text-muted-foreground italic">
                  No encrypted banking data on file — cannot approve until contractor submits banking details.
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Reject dialog */}
      <Dialog open={Boolean(rejectId)} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Banking Profile</DialogTitle>
            <DialogDescription>
              Provide a reason for rejection. The contractor will not be able to receive EFT payments until new banking
              details are submitted and approved.
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
              Reject Banking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
