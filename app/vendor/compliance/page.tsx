'use client'

import { useState, useEffect } from 'react'
import { getVendorLienWaivers, signLienWaiver } from '@/lib/actions/lien-waivers'
import {
  CheckCircle,
  FileText,
  DollarSign,
  Shield,
  PenTool,
  Clock,
  FileSignature,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

type LienWaiver = {
  id: string
  payment_request_id: string | null
  invoice_id: string
  invoice_number: string
  project_name: string
  amount_cents: number
  payment_date: string
  status: 'signed' | 'pending'
  waiver_type: string
  signed_at: string | null
}

export default function VendorCompliancePage() {
  const [waivers, setWaivers] = useState<LienWaiver[]>([])
  const [loading, setLoading] = useState(true)
  const [signDialogOpen, setSignDialogOpen] = useState(false)
  const [selectedWaiver, setSelectedWaiver] = useState<LienWaiver | null>(null)
  const [signatureName, setSignatureName] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const fetchWaivers = async () => {
      const result = await getVendorLienWaivers()
      if (result.success) {
        setWaivers(result.waivers as LienWaiver[])
      } else {
        setWaivers([])
      }
      setLoading(false)
    }
    fetchWaivers()
  }, [])

  const handleOpenSign = (waiver: LienWaiver) => {
    setSelectedWaiver(waiver)
    setSignatureName('')
    setAgreedToTerms(false)
    setErrorMessage(null)
    setSignDialogOpen(true)
  }

  const handleSign = async () => {
    console.log('[v0] handleSign fired', {
      hasWaiver: !!selectedWaiver,
      name: signatureName,
      agreed: agreedToTerms,
      prId: selectedWaiver?.payment_request_id,
    })
    if (!selectedWaiver || !signatureName.trim() || !agreedToTerms) return
    if (!selectedWaiver.payment_request_id) {
      setErrorMessage('This invoice has no associated payment request to waive yet.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    const signaturePayload = JSON.stringify({
      name: signatureName.trim(),
      signed_at: new Date().toISOString(),
    })

    const result = await signLienWaiver(selectedWaiver.payment_request_id, signaturePayload)

    if (result.success) {
      const signedDate = new Date().toISOString()
      setWaivers(prev => prev.map(w =>
        w.id === selectedWaiver.id
          ? { ...w, status: 'signed', signed_at: signedDate }
          : w
      ))
      setSignDialogOpen(false)
      setSuccessMessage(`Lien waiver for ${selectedWaiver.invoice_number} has been signed and submitted.`)
      setSelectedWaiver(null)
      setTimeout(() => setSuccessMessage(null), 4000)
    } else {
      setErrorMessage(result.error || 'Failed to sign waiver. Please try again.')
    }
    setIsSubmitting(false)
  }

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format((cents || 0) / 100)
  }

  const pendingWaivers = waivers.filter(w => w.status !== 'signed')
  const signedWaivers = waivers.filter(w => w.status === 'signed')
  const totalPaid = waivers.reduce((sum, w) => sum + (w.amount_cents || 0), 0)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Compliance & Lien Waivers" />
      <RoleTabBar role="contractor" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Success Message */}
        {successMessage && (
          <div className="bg-success/10 border border-success/20 text-success rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5" />
            <p className="font-medium">{successMessage}</p>
          </div>
        )}
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatCurrency(totalPaid)}</p>
                <p className="text-sm text-muted-foreground">Total Received</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{waivers.length}</p>
                <p className="text-sm text-muted-foreground">Paid Invoices</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{pendingWaivers.length}</p>
                <p className="text-sm text-muted-foreground">Pending Waivers</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{signedWaivers.length}</p>
                <p className="text-sm text-muted-foreground">Signed Waivers</p>
              </div>
            </div>
          </div>
        </div>

        {/* Pending Waivers Alert */}
        {pendingWaivers.length > 0 && (
          <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
            <div>
              <p className="font-medium text-warning">Action Required</p>
              <p className="text-sm text-muted-foreground">
                You have {pendingWaivers.length} paid invoice{pendingWaivers.length !== 1 ? 's' : ''} awaiting lien waiver signatures.
                Sign these to maintain compliance and expedite future holdback releases.
              </p>
            </div>
          </div>
        )}

        {/* Invoices List */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold">Paid Invoices</h2>
            <p className="text-sm text-muted-foreground">Sign lien waivers to release liability</p>
          </div>
          
          <div className="divide-y divide-border">
            {loading ? (
              <div className="px-6 py-16 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mb-3" />
                <p className="text-sm">Loading paid invoices...</p>
              </div>
            ) : waivers.length === 0 ? (
              <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="font-medium">No paid invoices yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Once your invoices are paid, lien waivers will appear here for signing.
                </p>
              </div>
            ) : (
              waivers.map((waiver) => {
                const isSigned = waiver.status === 'signed'
                return (
                  <div
                    key={waiver.id}
                    className="px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isSigned ? 'bg-success/10' : 'bg-warning/10'
                      }`}>
                        {isSigned ? (
                          <CheckCircle className="w-5 h-5 text-success" />
                        ) : (
                          <FileSignature className="w-5 h-5 text-warning" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{waiver.invoice_number}</p>
                          {isSigned ? (
                            <span className="px-2 py-0.5 text-xs font-medium bg-success/10 text-success rounded-full">
                              Signed
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning rounded-full">
                              Pending
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{waiver.project_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Paid: {new Date(waiver.payment_date).toLocaleDateString('en-CA')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(waiver.amount_cents)}</p>
                        {isSigned && waiver.signed_at && (
                          <p className="text-xs text-muted-foreground">
                            Signed on {new Date(waiver.signed_at).toLocaleDateString('en-CA')}
                          </p>
                        )}
                      </div>

                      {!isSigned ? (
                        <Button onClick={() => handleOpenSign(waiver)}>
                          <PenTool className="w-4 h-4 mr-2" />
                          Sign Lien Waiver
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm">
                          <FileText className="w-4 h-4 mr-2" />
                          View
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </main>

      {/* E-Signature Dialog */}
      <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <FileSignature className="w-8 h-8 text-primary" />
            </div>
            <DialogTitle className="text-center text-xl">Sign Lien Waiver</DialogTitle>
            <DialogDescription className="text-center">
              Statutory Declaration for Invoice {selectedWaiver?.invoice_number}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Invoice Details */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Project</span>
                <span className="font-medium">{selectedWaiver?.project_name}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Invoice Amount</span>
                <span className="font-medium">{selectedWaiver && formatCurrency(selectedWaiver.amount_cents)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payment Date</span>
                <span className="font-medium">
                  {selectedWaiver && new Date(selectedWaiver.payment_date).toLocaleDateString('en-CA')}
                </span>
              </div>
            </div>

            {/* Declaration Text */}
            <div className="border border-border rounded-lg p-4 bg-muted/30">
              <p className="text-sm text-muted-foreground leading-relaxed">
                I hereby declare that all labor, services, and materials provided under this invoice 
                have been paid in full by the undersigned contractor. I release and waive any and all 
                liens, claims, or encumbrances against the property, the owner, and the general contractor 
                in connection with this payment.
              </p>
            </div>

            {/* Signature Input */}
            <div className="space-y-2">
              <Label htmlFor="signature">Type Your Full Legal Name to Sign</Label>
              <div className="relative">
                <Input
                  id="signature"
                  placeholder="Enter your full name"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  className="text-lg font-serif italic"
                />
                <PenTool className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              </div>
              {signatureName && (
                <div className="mt-2 p-3 border border-dashed border-border rounded-lg bg-card">
                  <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                  <p className="text-2xl font-serif italic text-primary">{signatureName}</p>
                </div>
              )}
            </div>

            {/* Agreement Checkbox */}
            <div className="flex items-start gap-3">
              <Checkbox 
                id="agree" 
                checked={agreedToTerms}
                onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
              />
              <Label htmlFor="agree" className="text-sm leading-relaxed cursor-pointer">
                I confirm that I am authorized to sign this statutory declaration on behalf of 
                my company and that all information provided is true and accurate.
              </Label>
            </div>

            {errorMessage && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 flex items-center gap-2 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setSignDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button 
              className="flex-1" 
              onClick={handleSign}
              disabled={!signatureName.trim() || !agreedToTerms || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              {isSubmitting ? 'Submitting...' : 'Sign & Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
