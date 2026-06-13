"use client"

import { useState, useEffect } from "react"
import {
  getPendingKycDocuments,
  verifyKycDocument,
  rejectKycDocument,
} from "@/lib/actions/vendor-kyc"
import {
  FileText,
  Check,
  X,
  Eye,
  Clock,
  AlertTriangle,
  Download,
  Building,
  Calendar,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface KYCDocument {
  id: string
  contractor_id: string
  document_type: string
  file_name: string
  document_url: string
  status: "pending" | "verified" | "rejected" | "expired"
  uploaded_at: string
  expiry_date: string | null
  rejection_reason: string | null
  contractor?: {
    company_name: string
    contact_name: string
    email: string
  }
}

const documentTypeLabels: Record<string, string> = {
  wcb_clearance: "WCB Clearance Letter",
  void_cheque: "Void Cheque",
  t5018: "T5018 Form",
  insurance: "Insurance Certificate",
  business_license: "Business License",
}

export function KYCVerificationQueue() {
  const [documents, setDocuments] = useState<KYCDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDoc, setSelectedDoc] = useState<KYCDocument | null>(null)
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const fetchDocuments = async () => {
      const result = await getPendingKycDocuments()
      if (result.success) {
        setDocuments(result.documents as unknown as KYCDocument[])
      } else {
        setDocuments([])
      }
      setLoading(false)
    }

    fetchDocuments()
  }, [])

  const handleVerify = async (doc: KYCDocument) => {
    setIsProcessing(true)
    const result = await verifyKycDocument(doc.id)
    if (result.success) {
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
      setSelectedDoc(null)
    }
    setIsProcessing(false)
  }

  const handleReject = async () => {
    if (!selectedDoc) return
    setIsProcessing(true)
    const result = await rejectKycDocument(selectedDoc.id, rejectionReason)
    if (result.success) {
      setDocuments((prev) => prev.filter((d) => d.id !== selectedDoc.id))
      setSelectedDoc(null)
      setIsRejectDialogOpen(false)
      setRejectionReason("")
    }
    setIsProcessing(false)
  }

  const pendingCount = documents.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">KYC Verification Queue</h3>
          {pendingCount > 0 && (
            <Badge variant="secondary" className="bg-warning/10 text-warning">
              {pendingCount} pending
            </Badge>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          Loading documents...
        </div>
      ) : documents.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-border rounded-lg">
          <Check className="w-10 h-10 text-success mx-auto mb-2" />
          <p className="text-muted-foreground">All documents verified!</p>
          <p className="text-sm text-muted-foreground">
            No pending KYC documents to review.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="p-4 border border-border rounded-lg bg-card hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium">
                      {documentTypeLabels[doc.document_type] || doc.document_type}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building className="w-3.5 h-3.5" />
                      <span>{doc.contractor?.company_name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(doc.uploaded_at).toLocaleDateString("en-CA")}
                      </span>
                      {doc.expiry_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Expires: {new Date(doc.expiry_date).toLocaleDateString("en-CA")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-warning/10 text-warning border-warning/20"
                  >
                    <Clock className="w-3 h-3 mr-1" />
                    Pending
                  </Badge>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedDoc(doc)}
                >
                  <Eye className="w-4 h-4 mr-1.5" />
                  Review
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setSelectedDoc(doc)
                    setIsRejectDialogOpen(true)
                  }}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleVerify(doc)}
                  disabled={isProcessing}
                >
                  <Check className="w-4 h-4 mr-1.5" />
                  Verify
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!selectedDoc && !isRejectDialogOpen} onOpenChange={() => setSelectedDoc(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Document Review
            </DialogTitle>
            <DialogDescription>
              Review the uploaded document and verify or reject it.
            </DialogDescription>
          </DialogHeader>

          {selectedDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Company</p>
                  <p className="font-medium">{selectedDoc.contractor?.company_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Contact</p>
                  <p className="font-medium">{selectedDoc.contractor?.contact_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Document Type</p>
                  <p className="font-medium">
                    {documentTypeLabels[selectedDoc.document_type] ||
                      selectedDoc.document_type}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">File Name</p>
                  <p className="font-medium">{selectedDoc.file_name}</p>
                </div>
                {selectedDoc.expiry_date && (
                  <div>
                    <p className="text-muted-foreground">Expiry Date</p>
                    <p className="font-medium">
                      {new Date(selectedDoc.expiry_date).toLocaleDateString("en-CA")}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Uploaded</p>
                  <p className="font-medium">
                    {new Date(selectedDoc.uploaded_at).toLocaleString("en-CA")}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-muted/50 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm">{selectedDoc.file_name}</span>
                </div>
                <Button variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-1.5" />
                  Download
                </Button>
              </div>

              <div className="p-4 border border-dashed border-border rounded-lg text-center text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Document preview would appear here</p>
                <p className="text-xs">Click download to view the full document</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDoc(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setIsRejectDialogOpen(true)}
            >
              <X className="w-4 h-4 mr-1.5" />
              Reject
            </Button>
            <Button
              onClick={() => selectedDoc && handleVerify(selectedDoc)}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
              ) : (
                <Check className="w-4 h-4 mr-1.5" />
              )}
              Verify Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Reject Document
            </DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this document. The contractor will
              be notified and asked to upload a new document.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="rejectionReason">Rejection Reason *</Label>
            <Textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g., Document is expired, image is unclear, wrong document type..."
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectionReason.trim() || isProcessing}
            >
              {isProcessing ? (
                <div className="w-4 h-4 border-2 border-destructive-foreground/30 border-t-destructive-foreground rounded-full animate-spin mr-2" />
              ) : (
                <X className="w-4 h-4 mr-1.5" />
              )}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
