'use client'

import { useState } from 'react'
import { 
  CheckCircle, 
  FileText,
  ArrowLeft,
  DollarSign,
  Building2,
  Shield,
  PenTool,
  Clock,
  FileSignature,
  AlertCircle
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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

// Mock data for paid invoices
const mockPaidInvoices = [
  {
    id: '1',
    project: 'Oakwood Towers - Phase 1',
    invoiceNumber: 'INV-2024-0125',
    amount: 45000,
    paidDate: '2024-01-10',
    paymentRef: 'EFT-20240110-001',
    lienWaiverSigned: false,
  },
  {
    id: '2',
    project: 'Oakwood Towers - Phase 1',
    invoiceNumber: 'INV-2024-0118',
    amount: 32500,
    paidDate: '2024-01-05',
    paymentRef: 'EFT-20240105-003',
    lienWaiverSigned: true,
    lienWaiverSignedDate: '2024-01-06',
  },
  {
    id: '3',
    project: 'Riverside Commercial Plaza',
    invoiceNumber: 'INV-2024-0102',
    amount: 78000,
    paidDate: '2023-12-28',
    paymentRef: 'EFT-20231228-002',
    lienWaiverSigned: false,
  },
  {
    id: '4',
    project: 'Heritage Renovation Project',
    invoiceNumber: 'INV-2024-0095',
    amount: 28500,
    paidDate: '2023-12-20',
    paymentRef: 'EFT-20231220-001',
    lienWaiverSigned: true,
    lienWaiverSignedDate: '2023-12-21',
  },
  {
    id: '5',
    project: 'Oakwood Towers - Phase 1',
    invoiceNumber: 'INV-2024-0088',
    amount: 56000,
    paidDate: '2023-12-15',
    paymentRef: 'EFT-20231215-004',
    lienWaiverSigned: false,
  },
]

export default function VendorCompliancePage() {
  const [invoices, setInvoices] = useState(mockPaidInvoices)
  const [signDialogOpen, setSignDialogOpen] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<typeof mockPaidInvoices[0] | null>(null)
  const [signatureName, setSignatureName] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleOpenSign = (invoice: typeof mockPaidInvoices[0]) => {
    setSelectedInvoice(invoice)
    setSignatureName('')
    setAgreedToTerms(false)
    setSignDialogOpen(true)
  }

  const handleSign = () => {
    if (!selectedInvoice || !signatureName.trim() || !agreedToTerms) return

    setInvoices(prev => prev.map(inv => 
      inv.id === selectedInvoice.id 
        ? { ...inv, lienWaiverSigned: true, lienWaiverSignedDate: new Date().toISOString().slice(0, 10) }
        : inv
    ))

    setSignDialogOpen(false)
    setSelectedInvoice(null)
    setSuccessMessage(`Lien waiver for ${selectedInvoice.invoiceNumber} has been signed and submitted.`)
    setTimeout(() => setSuccessMessage(null), 4000)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  const pendingWaivers = invoices.filter(inv => !inv.lienWaiverSigned)
  const signedWaivers = invoices.filter(inv => inv.lienWaiverSigned)
  const totalPaid = invoices.reduce((sum, inv) => sum + inv.amount, 0)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link 
                href="/vendor/portal" 
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold">Compliance & Lien Waivers</h1>
                <p className="text-sm text-muted-foreground">Sign statutory declarations for paid invoices</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </header>

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
                <p className="text-2xl font-semibold">{invoices.length}</p>
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
            {invoices.map((invoice) => (
              <div 
                key={invoice.id} 
                className="px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    invoice.lienWaiverSigned 
                      ? 'bg-success/10' 
                      : 'bg-warning/10'
                  }`}>
                    {invoice.lienWaiverSigned ? (
                      <CheckCircle className="w-5 h-5 text-success" />
                    ) : (
                      <FileSignature className="w-5 h-5 text-warning" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{invoice.invoiceNumber}</p>
                      {invoice.lienWaiverSigned ? (
                        <span className="px-2 py-0.5 text-xs font-medium bg-success/10 text-success rounded-full">
                          Signed
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning rounded-full">
                          Pending
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{invoice.project}</p>
                    <p className="text-xs text-muted-foreground">
                      Paid: {invoice.paidDate} | Ref: {invoice.paymentRef}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(invoice.amount)}</p>
                    {invoice.lienWaiverSigned && invoice.lienWaiverSignedDate && (
                      <p className="text-xs text-muted-foreground">
                        Signed on {invoice.lienWaiverSignedDate}
                      </p>
                    )}
                  </div>
                  
                  {!invoice.lienWaiverSigned ? (
                    <Button onClick={() => handleOpenSign(invoice)}>
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
            ))}
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
              Statutory Declaration for Invoice {selectedInvoice?.invoiceNumber}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Invoice Details */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Project</span>
                <span className="font-medium">{selectedInvoice?.project}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Invoice Amount</span>
                <span className="font-medium">{selectedInvoice && formatCurrency(selectedInvoice.amount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payment Date</span>
                <span className="font-medium">{selectedInvoice?.paidDate}</span>
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
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setSignDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="flex-1" 
              onClick={handleSign}
              disabled={!signatureName.trim() || !agreedToTerms}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Sign & Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
