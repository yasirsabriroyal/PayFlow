'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getVendorLienWaivers } from '@/lib/actions/lien-waivers'
import {
  CheckCircle,
  FileText,
  DollarSign,
  Shield,
  PenTool,
  Clock,
  FileSignature,
  AlertCircle,
  Loader2,
  CalendarCheck,
  Monitor,
  Wifi,
  Trash2,
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
import { ComplianceDocuments } from './compliance-documents'

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
  signature_data: string | null
  signer_ip_address: string | null
  signer_user_agent: string | null
}

type SignatureMode = 'type' | 'draw'

export default function VendorCompliancePage() {
  const [waivers, setWaivers] = useState<LienWaiver[]>([])
  const [loading, setLoading] = useState(true)

  // Sign dialog
  const [signDialogOpen, setSignDialogOpen] = useState(false)
  const [selectedWaiver, setSelectedWaiver] = useState<LienWaiver | null>(null)
  const [signatureMode, setSignatureMode] = useState<SignatureMode>('type')
  const [signatureName, setSignatureName] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Canvas draw pad
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  // View dialog
  const [viewDialogOpen, setViewDialogOpen] = useState(false)

  // ─── Data fetch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    getVendorLienWaivers().then((result) => {
      setWaivers(result.success ? (result.waivers as LienWaiver[]) : [])
      setLoading(false)
    })
  }, [])

  // ─── Canvas helpers ──────────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    isDrawing.current = true
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getCanvasPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }, [])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getCanvasPos(e, canvas)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'hsl(var(--foreground))'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasDrawn(true)
  }, [])

  const stopDraw = useCallback(() => {
    isDrawing.current = false
  }, [])

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const getCanvasDataUrl = (): string | null => {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn) return null
    return canvas.toDataURL('image/png')
  }

  // ─── Dialog openers ──────────────────────────────────────────────────────────
  const handleOpenSign = (waiver: LienWaiver) => {
    setSelectedWaiver(waiver)
    setSignatureName('')
    setAgreedToTerms(false)
    setErrorMessage(null)
    setSignatureMode('type')
    setHasDrawn(false)
    setSignDialogOpen(true)
    // clear canvas after dialog opens (it re-mounts)
    setTimeout(() => clearCanvas(), 50)
  }

  const handleOpenView = (waiver: LienWaiver) => {
    setSelectedWaiver(waiver)
    setViewDialogOpen(true)
  }

  // ─── Sign submit ─────────────────────────────────────────────────────────────
  const handleSign = async () => {
    if (!selectedWaiver || !agreedToTerms) return
    if (!selectedWaiver.payment_request_id) {
      setErrorMessage('This invoice has no associated payment request to waive yet.')
      return
    }

    const typedName = signatureName.trim()
    const drawnDataUrl = getCanvasDataUrl()

    if (signatureMode === 'type' && !typedName) {
      setErrorMessage('Please type your full legal name to sign.')
      return
    }
    if (signatureMode === 'draw' && !drawnDataUrl) {
      setErrorMessage('Please draw your signature before submitting.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    const payload = JSON.stringify({
      name: typedName || null,
      drawn: signatureMode === 'draw',
      dataUrl: drawnDataUrl || null,
      signed_at: new Date().toISOString(),
    })

    try {
      const res = await fetch('/api/lien-waivers/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentRequestId: selectedWaiver.payment_request_id,
          signatureData: payload,
        }),
      })
      const result = await res.json()

      if (result.success) {
        const signedDate = new Date().toISOString()
        setWaivers((prev) =>
          prev.map((w) =>
            w.id === selectedWaiver.id
              ? { ...w, status: 'signed', signed_at: signedDate, signature_data: payload }
              : w
          )
        )
        setSignDialogOpen(false)
        setSuccessMessage(`Lien waiver for ${selectedWaiver.invoice_number} has been signed and submitted.`)
        setSelectedWaiver(null)
        setTimeout(() => setSuccessMessage(null), 4000)
      } else {
        setErrorMessage(result.error || 'Failed to sign waiver. Please try again.')
      }
    } catch {
      setErrorMessage('Network error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100)

  const parseSigData = (raw: string | null) => {
    try { return JSON.parse(raw || '{}') } catch { return {} }
  }

  const isSignEnabled =
    agreedToTerms &&
    (signatureMode === 'type' ? signatureName.trim().length > 0 : hasDrawn)

  const pendingWaivers = waivers.filter((w) => w.status !== 'signed')
  const signedWaivers = waivers.filter((w) => w.status === 'signed')
  const totalPaid = waivers.reduce((sum, w) => sum + (w.amount_cents || 0), 0)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Compliance & Lien Waivers" />
      <RoleTabBar role="contractor" />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {successMessage && (
          <div className="bg-success/10 border border-success/20 text-success rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5" />
            <p className="font-medium">{successMessage}</p>
          </div>
        )}

        <ComplianceDocuments />

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { icon: DollarSign, color: 'success', label: 'Total Received', value: formatCurrency(totalPaid) },
            { icon: FileText, color: 'primary', label: 'Paid Invoices', value: waivers.length },
            { icon: Clock, color: 'warning', label: 'Pending Waivers', value: pendingWaivers.length },
            { icon: Shield, color: 'accent', label: 'Signed Waivers', value: signedWaivers.length },
          ].map(({ icon: Icon, color, label, value }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 bg-${color}/10 rounded-lg flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 text-${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{value}</p>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {pendingWaivers.length > 0 && (
          <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
            <div>
              <p className="font-medium text-warning">Action Required</p>
              <p className="text-sm text-muted-foreground">
                You have {pendingWaivers.length} paid invoice{pendingWaivers.length !== 1 ? 's' : ''} awaiting
                lien waiver signatures. Sign these to maintain compliance and expedite future holdback releases.
              </p>
            </div>
          </div>
        )}

        {/* Invoice list */}
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
                const sig = parseSigData(waiver.signature_data)
                return (
                  <div
                    key={waiver.id}
                    className="px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSigned ? 'bg-success/10' : 'bg-warning/10'}`}>
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
                            <span className="px-2 py-0.5 text-xs font-medium bg-success/10 text-success rounded-full">Signed</span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning rounded-full">Pending</span>
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
                          <>
                            <p className="text-xs text-muted-foreground">
                              Signed {new Date(waiver.signed_at).toLocaleDateString('en-CA')}
                            </p>
                            {sig.name && (
                              <p className="text-xs font-serif italic text-success">{sig.name}</p>
                            )}
                            {!sig.name && sig.drawn && (
                              <p className="text-xs italic text-success">Drawn signature</p>
                            )}
                          </>
                        )}
                      </div>

                      {!isSigned ? (
                        <Button onClick={() => handleOpenSign(waiver)}>
                          <PenTool className="w-4 h-4 mr-2" />
                          Sign Lien Waiver
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleOpenView(waiver)}>
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

      {/* ── Signed Waiver View Dialog ─────────────────────────────────────── */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <DialogTitle className="text-center text-xl">Signed Lien Waiver</DialogTitle>
            <DialogDescription className="text-center">
              Statutory Declaration — Invoice {selectedWaiver?.invoice_number}
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const sig = parseSigData(selectedWaiver?.signature_data ?? null)
            return (
              <div className="space-y-4 py-2">
                {/* Invoice details */}
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  {[
                    ['Invoice', selectedWaiver?.invoice_number],
                    ['Project', selectedWaiver?.project_name],
                    ['Amount', selectedWaiver ? formatCurrency(selectedWaiver.amount_cents) : null],
                    ['Payment Date', selectedWaiver && new Date(selectedWaiver.payment_date).toLocaleDateString('en-CA')],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{val}</span>
                    </div>
                  ))}
                </div>

                {/* Declaration */}
                <div className="border border-border rounded-lg p-4 bg-muted/30">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    I hereby declare that all labor, services, and materials provided under this invoice
                    have been paid in full by the undersigned contractor. I release and waive any and all
                    liens, claims, or encumbrances against the property, the owner, and the general
                    contractor in connection with this payment.
                  </p>
                </div>

                {/* Signature block */}
                <div className="border border-success/30 bg-success/5 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 text-success">
                    <CalendarCheck className="w-4 h-4" />
                    <span className="text-sm font-medium">Electronically Signed</span>
                  </div>
                  {selectedWaiver?.signed_at && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(selectedWaiver.signed_at).toLocaleString('en-CA', {
                        dateStyle: 'long',
                        timeStyle: 'short',
                      })}
                    </p>
                  )}
                  <div className="pt-2 border-t border-success/20">
                    <p className="text-xs text-muted-foreground mb-2">Electronic Signature</p>
                    {sig.drawn && sig.dataUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={sig.dataUrl}
                        alt="Electronic signature"
                        className="max-h-20 border border-success/20 rounded bg-card p-1"
                      />
                    ) : (
                      <p className="text-2xl font-serif italic text-success">
                        {sig.name || 'Signed'}
                      </p>
                    )}
                    {sig.name && sig.drawn && (
                      <p className="text-xs text-muted-foreground mt-1">Signed by: {sig.name}</p>
                    )}
                  </div>
                </div>

                {/* Audit trail */}
                {(selectedWaiver?.signer_ip_address || selectedWaiver?.signer_user_agent) && (
                  <div className="border border-border rounded-lg p-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audit Trail</p>
                    {selectedWaiver.signer_ip_address && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Wifi className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-mono">{selectedWaiver.signer_ip_address}</span>
                      </div>
                    )}
                    {selectedWaiver.signer_user_agent && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Monitor className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="break-all line-clamp-2">{selectedWaiver.signer_user_agent}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          <DialogFooter>
            <Button className="w-full" variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── E-Signature Dialog ───────────────────────────────────────────────── */}
      <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <FileSignature className="w-8 h-8 text-primary" />
            </div>
            <DialogTitle className="text-center text-xl">Sign Lien Waiver</DialogTitle>
            <DialogDescription className="text-center">
              Statutory Declaration — Invoice {selectedWaiver?.invoice_number}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Invoice summary */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              {[
                ['Project', selectedWaiver?.project_name],
                ['Amount', selectedWaiver && formatCurrency(selectedWaiver.amount_cents)],
                ['Payment Date', selectedWaiver && new Date(selectedWaiver.payment_date).toLocaleDateString('en-CA')],
              ].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{val}</span>
                </div>
              ))}
            </div>

            {/* Declaration */}
            <div className="border border-border rounded-lg p-4 bg-muted/30">
              <p className="text-sm text-muted-foreground leading-relaxed">
                I hereby declare that all labor, services, and materials provided under this invoice
                have been paid in full by the undersigned contractor. I release and waive any and all
                liens, claims, or encumbrances against the property, the owner, and the general
                contractor in connection with this payment.
              </p>
            </div>

            {/* Signature mode toggle */}
            <div>
              <Label className="mb-2 block">Signature Method</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSignatureMode('type')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    signatureMode === 'type'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Type Name
                </button>
                <button
                  type="button"
                  onClick={() => { setSignatureMode('draw'); setTimeout(() => clearCanvas(), 50) }}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    signatureMode === 'draw'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <PenTool className="w-4 h-4" />
                  Draw Signature
                </button>
              </div>
            </div>

            {/* Type mode */}
            {signatureMode === 'type' && (
              <div className="space-y-2">
                <Label htmlFor="signature">Full Legal Name</Label>
                <div className="relative">
                  <Input
                    id="signature"
                    placeholder="Enter your full legal name"
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    className="text-lg font-serif italic pr-10"
                  />
                  <PenTool className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                {signatureName && (
                  <div className="p-4 border border-dashed border-border rounded-lg bg-card">
                    <p className="text-xs text-muted-foreground mb-1">Signature preview</p>
                    <p className="text-2xl font-serif italic text-primary">{signatureName}</p>
                  </div>
                )}
              </div>
            )}

            {/* Draw mode */}
            {signatureMode === 'draw' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Draw Your Signature</Label>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>
                </div>
                <div className="relative border-2 border-dashed border-border rounded-lg bg-card overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    width={460}
                    height={140}
                    className="w-full touch-none cursor-crosshair"
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={stopDraw}
                    onMouseLeave={stopDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={stopDraw}
                  />
                  {!hasDrawn && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <p className="text-sm text-muted-foreground select-none">Sign here</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Use your mouse or finger to draw your signature above.</p>

                {/* Optional: also capture name when drawing */}
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="draw-name" className="text-xs">
                    Printed Name <span className="text-muted-foreground">(optional — for audit record)</span>
                  </Label>
                  <Input
                    id="draw-name"
                    placeholder="Your full name"
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {/* Agreement */}
            <div className="flex items-start gap-3">
              <Checkbox
                id="agree"
                checked={agreedToTerms}
                onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
              />
              <Label htmlFor="agree" className="text-sm leading-relaxed cursor-pointer">
                I confirm that I am authorized to sign this statutory declaration on behalf of my
                company and that all information provided is true and accurate.
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
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setSignDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSign}
              disabled={!isSignEnabled || isSubmitting}
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
