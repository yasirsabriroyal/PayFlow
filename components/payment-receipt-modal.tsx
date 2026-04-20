'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { getPaymentReceiptData } from '@/app/accountant/actions'
import { X, Printer, Loader2 } from 'lucide-react'

interface ReceiptData {
  payment: {
    id: string
    amount_cents: number
    payment_date: string | null
    payment_method: string | null
    status: string | null
    notes: string | null
  }
  certificate: {
    certificate_number: string
    certified_amount_cents: number
    approved_by_name: string | null
  } | null
  invoice: {
    invoice_number: string
    amount_cents: number
    net_payable_cents: number
    holdback_amount_cents: number
    contractor_name: string
    project_name: string
  } | null
  approved_by_name: string | null
  approved_by_role: string | null
  processed_by_name: string | null
  processed_by_role: string | null
  payment_type: 'certificate' | 'direct'
  companySettings: {
    company_name: string
    address?: string | null
    city?: string | null
    province?: string | null
    postal_code?: string | null
    phone?: string | null
    email?: string | null
    website?: string | null
    hst_number?: string | null
  } | null
}

interface PaymentReceiptModalProps {
  paymentId: string
  invoiceNumber: string
  trigger: React.ReactNode
}

function fmt(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtNow() {
  return new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

export function PaymentReceiptModal({ paymentId, invoiceNumber, trigger }: PaymentReceiptModalProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ReceiptData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleOpen() {
    setOpen(true)
    if (data) return
    setLoading(true)
    setError(null)
    const result = await getPaymentReceiptData(paymentId)
    setLoading(false)
    if (result.success && 'data' in result) {
      setData(result.data as ReceiptData)
    } else {
      setError('error' in result && typeof result.error === 'string' ? result.error : 'Failed to load receipt.')
    }
  }

  const co = data?.companySettings
  const inv = data?.invoice
  const pmt = data?.payment

  const receiptRef = pmt?.id.slice(-8).toUpperCase() ?? '—'
  const addressLine = [co?.city, co?.province, co?.postal_code].filter(Boolean).join(' ')
  const contactLine = [co?.phone, co?.email, co?.website].filter(Boolean).join(' | ')

  return (
    <>
      <span onClick={handleOpen} className="cursor-pointer">{trigger}</span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 print:shadow-none">
          <DialogTitle className="sr-only">Payment Receipt</DialogTitle>

          {/* Modal controls — hidden on print */}
          <div className="flex items-center justify-between px-6 py-3 border-b bg-gray-50 print:hidden">
            <span className="text-sm font-medium text-gray-600">Payment Receipt — {invoiceNumber}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const printContent = document.getElementById('payment-receipt-content')
                  if (!printContent) return
                  const originalBody = document.body.innerHTML
                  document.body.innerHTML = printContent.innerHTML
                  window.print()
                  document.body.innerHTML = originalBody
                  window.location.reload()
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Receipt body */}
          <div id="payment-receipt-content" className="p-8 bg-white">
            {loading && (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                Loading receipt…
              </div>
            )}

            {error && (
              <div className="text-center py-12 text-red-600">{error}</div>
            )}

            {!loading && !error && data && (
              <div className="space-y-6">

                {/* Header */}
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xl font-bold text-gray-900">{co?.company_name ?? 'Royal Development'}</p>
                    {co?.address && <p className="text-sm text-gray-500 mt-0.5">{co.address}</p>}
                    {addressLine && <p className="text-sm text-gray-500">{addressLine}</p>}
                    {contactLine && <p className="text-sm text-gray-500">{contactLine}</p>}
                    {co?.hst_number && <p className="text-sm text-gray-500">HST/GST # {co.hst_number}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-blue-600 tracking-wide">PAYMENT RECEIPT</p>
                    <p className="text-sm text-gray-500 mt-1">Receipt # <span className="font-mono font-semibold text-gray-700">{receiptRef}</span></p>
                    <p className="text-sm text-gray-500">Date: {fmtDate(pmt?.payment_date ?? null)}</p>
                  </div>
                </div>

                <hr className="border-gray-200" />

                {/* Invoice & Payment Info */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Invoice Details</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Invoice #</span>
                        <span className="font-medium">{inv?.invoice_number ?? invoiceNumber}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Contractor</span>
                        <span className="font-medium">{inv?.contractor_name ?? '—'}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Project</span>
                        <span className="font-medium">{inv?.project_name ?? '—'}</span>
                      </div>
                      {data.certificate && (
                        <div className="flex gap-2">
                          <span className="text-gray-500 w-24 flex-shrink-0">Certificate</span>
                          <span className="font-medium">{data.certificate.certificate_number}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Payment Details</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Method</span>
                        <span className="font-medium">{pmt?.payment_method?.toUpperCase() ?? '—'}</span>
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="text-gray-500 w-24 flex-shrink-0">Status</span>
                        <Badge variant={['completed', 'cleared'].includes(pmt?.status ?? '') ? 'default' : 'secondary'} className="text-xs">
                          {pmt?.status ?? '—'}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Amount Paid</span>
                        <span className="font-semibold text-blue-600">{pmt ? fmt(pmt.amount_cents) : '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <hr className="border-gray-200" />

                {/* Financial Summary */}
                {inv && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Financial Summary</p>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Invoice Total</span>
                        <span>{fmt(inv.amount_cents)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Holdback (10%)</span>
                        <span className="text-orange-500">-{fmt(inv.holdback_amount_cents)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Net Payable</span>
                        <span>{fmt(inv.net_payable_cents)}</span>
                      </div>
                      <hr className="border-gray-200" />
                      <div className="flex justify-between font-bold text-blue-600">
                        <span>Amount Paid</span>
                        <span>{pmt ? fmt(pmt.amount_cents) : '—'}</span>
                      </div>
                    </div>
                  </div>
                )}

                <hr className="border-gray-200" />

                {/* Authorization */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Authorization</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs">Approved By</p>
                      <p className="font-medium mt-0.5">
                        {data.approved_by_name ?? 'N/A — Direct Payment'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Processed By</p>
                      <p className="font-medium mt-0.5">
                        {data.processed_by_name ?? '—'}
                        {data.processed_by_role && (
                          <span className="text-gray-400 font-normal ml-1">({data.processed_by_role})</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Processed Date</p>
                      <p className="font-medium mt-0.5">{fmtDate(pmt?.payment_date ?? null)}</p>
                    </div>
                    {pmt?.notes && (
                      <div>
                        <p className="text-gray-500 text-xs">Notes</p>
                        <p className="font-medium mt-0.5">{pmt.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                <hr className="border-gray-200" />

                {/* Footer */}
                <div className="text-center text-xs text-gray-400 space-y-0.5">
                  <p>This receipt was generated by PayFlow AP</p>
                  <p>Generated: {fmtNow()}</p>
                </div>

              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </>
  )
}
