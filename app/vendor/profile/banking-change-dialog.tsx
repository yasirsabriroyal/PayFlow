'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Loader2, ShieldCheck } from 'lucide-react'
import { submitBankingChangeRequest } from '@/lib/actions/banking-changes'

export function BankingChangeDialog() {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    bankName: '',
    institutionNumber: '',
    transitNumber: '',
    accountNumber: '',
  })

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const valid =
    form.institutionNumber.trim().length > 0 &&
    form.transitNumber.trim().length > 0 &&
    form.accountNumber.trim().length > 0

  async function handleSubmit() {
    setSubmitting(true)
    const res = await submitBankingChangeRequest({
      bankName: form.bankName.trim(),
      institutionNumber: form.institutionNumber.trim(),
      transitNumber: form.transitNumber.trim(),
      accountNumber: form.accountNumber.trim(),
    })
    if (res.success) {
      toast({
        title: 'Banking change submitted',
        description: 'Your request is pending review. You will be notified once a decision is made.',
      })
      setForm({ bankName: '', institutionNumber: '', transitNumber: '', accountNumber: '' })
      setOpen(false)
      router.refresh()
    } else {
      toast({ title: 'Unable to submit', description: res.error || 'Please try again.', variant: 'destructive' })
    }
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Request banking change
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Banking Change</DialogTitle>
          <DialogDescription>
            For your security, banking updates are reviewed and approved before taking effect. Your account
            number is encrypted and never displayed in full.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="bcd-bankName">Bank Name</Label>
            <Input
              id="bcd-bankName"
              value={form.bankName}
              onChange={(e) => set('bankName', e.target.value)}
              placeholder="e.g. RBC Royal Bank"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bcd-institution">Institution No. *</Label>
              <Input
                id="bcd-institution"
                inputMode="numeric"
                value={form.institutionNumber}
                onChange={(e) => set('institutionNumber', e.target.value)}
                placeholder="3 digits"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bcd-transit">Transit No. *</Label>
              <Input
                id="bcd-transit"
                inputMode="numeric"
                value={form.transitNumber}
                onChange={(e) => set('transitNumber', e.target.value)}
                placeholder="5 digits"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bcd-account">Account Number *</Label>
            <Input
              id="bcd-account"
              inputMode="numeric"
              value={form.accountNumber}
              onChange={(e) => set('accountNumber', e.target.value)}
              placeholder="Account number"
            />
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Encrypted at rest with AES-256. Only the last 4 digits are ever shown.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || submitting} className="gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit for Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
