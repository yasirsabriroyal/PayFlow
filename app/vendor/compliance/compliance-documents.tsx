'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Shield,
  Upload,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
  CalendarClock,
} from 'lucide-react'
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
import { upload } from '@vercel/blob/client'
import { useToast } from '@/hooks/use-toast'
import { getContractorCompliance } from '@/lib/actions/vendor-portal'
import type { ComplianceItem } from '@/lib/compliance/constants'
import { saveComplianceDocument } from '@/lib/actions/vendor-kyc'

// Allowed file types & size — kept in sync with the upload-token route and the
// saveComplianceDocument server action.
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png']

// Validate a single file by MIME type (with an extension fallback) and size.
// Returns an error message or null when the file is acceptable.
function validateComplianceFile(file: File): string | null {
  const lowerName = file.name.toLowerCase()
  const extOk = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  const mimeOk = file.type ? ALLOWED_MIME.includes(file.type) : false
  if (!extOk && !mimeOk) {
    return 'Unsupported file type. Use PDF, JPG, or PNG.'
  }
  if (file.size === 0) {
    return 'File is empty.'
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File exceeds the 10 MB limit.'
  }
  return null
}

const STATUS_META: Record<
  ComplianceItem['status'],
  { label: string; cls: string; icon: typeof Shield }
> = {
  verified: { label: 'Verified', cls: 'bg-success/10 text-success', icon: CheckCircle },
  expiring: { label: 'Expiring Soon', cls: 'bg-warning/10 text-warning', icon: CalendarClock },
  expired: { label: 'Expired', cls: 'bg-destructive/10 text-destructive', icon: AlertTriangle },
  pending: { label: 'Under Review', cls: 'bg-muted text-muted-foreground', icon: Clock },
  rejected: { label: 'Rejected', cls: 'bg-destructive/10 text-destructive', icon: XCircle },
  missing: { label: 'Not Provided', cls: 'bg-muted text-muted-foreground', icon: Upload },
}

export function ComplianceDocuments() {
  const { toast } = useToast()
  const [items, setItems] = useState<ComplianceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [active, setActive] = useState<ComplianceItem | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [expiryDate, setExpiryDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    const res = await getContractorCompliance()
    if (res.success) setItems(res.items)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openUpload = (item: ComplianceItem) => {
    setActive(item)
    setFile(null)
    setExpiryDate('')
    setDialogOpen(true)
  }

  const handleUpload = async () => {
    if (!active || !file) return

    // Validate before doing any work so we never start an upload we can't finish.
    const validationError = validateComplianceFile(file)
    if (validationError) {
      toast({ title: 'Invalid file', description: validationError, variant: 'destructive' })
      return
    }

    setSubmitting(true)
    try {
      // 1. Upload the file directly to Vercel Blob, bypassing the 1 MB Server
      //    Action body limit. The token route scopes the path to this user.
      const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const blob = await upload(`compliance/${Date.now()}-${cleanName}`, file, {
        access: 'private',
        handleUploadUrl: '/api/compliance/upload-token',
      })

      // 2. Persist only the metadata (no bytes) via a lightweight Server Action.
      const res = await saveComplianceDocument({
        documentType: active.documentType,
        pathname: blob.pathname,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        expiryDate: expiryDate || null,
      })

      if (res.success) {
        toast({ title: 'Document uploaded', description: `${active.label} submitted for verification.` })
        setDialogOpen(false)
        setActive(null)
        setFile(null)
        setExpiryDate('')
        await load()
      } else {
        toast({ title: 'Upload failed', description: res.error || 'Please try again.', variant: 'destructive' })
      }
    } catch (err) {
      console.error('[v0] Compliance upload error:', err)
      toast({
        title: 'Upload failed',
        description: 'We could not upload your document. Please check the file and try again.',
        variant: 'destructive',
      })
    } finally {
      // Always clear the loading state so the modal never hangs on "Uploading...".
      setSubmitting(false)
    }
  }

  const expiringOrExpired = items.filter((i) => i.status === 'expiring' || i.status === 'expired')

  return (
    <div className="space-y-6">
      {expiringOrExpired.length > 0 && (
        <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-warning">Action Required</p>
            <p className="text-sm text-muted-foreground">
              {expiringOrExpired.map((i) => i.label).join(', ')}{' '}
              {expiringOrExpired.length === 1 ? 'needs' : 'need'} to be renewed. Upload a current
              document to stay compliant and avoid payment holds.
            </p>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold">Compliance Documents</h2>
          <p className="text-sm text-muted-foreground">
            Keep your insurance, licenses, and clearances current.
          </p>
        </div>

        <div className="divide-y divide-border">
          {loading ? (
            <div className="px-6 py-16 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mb-3" />
              <p className="text-sm">Loading documents...</p>
            </div>
          ) : (
            items.map((item) => {
              const meta = STATUS_META[item.status]
              const Icon = meta.icon
              return (
                <div
                  key={item.documentType}
                  className="px-6 py-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Shield className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{item.label}</p>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${meta.cls}`}
                        >
                          <Icon className="w-3 h-3" />
                          {meta.label}
                        </span>
                      </div>
                      {item.fileName && (
                        <p className="text-xs text-muted-foreground truncate">{item.fileName}</p>
                      )}
                      {item.expiryDate && (
                        <p className="text-xs text-muted-foreground">
                          Expires {new Date(item.expiryDate).toLocaleDateString('en-CA')}
                          {item.daysUntilExpiry !== null && item.daysUntilExpiry >= 0
                            ? ` (${item.daysUntilExpiry} days)`
                            : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={item.status === 'missing' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => openUpload(item)}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {item.status === 'missing' ? 'Upload' : 'Replace'}
                  </Button>
                </div>
              )
            })
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload {active?.label}</DialogTitle>
            <DialogDescription>
              Upload a current document. It will be reviewed before being marked verified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="complianceFile">Document File</Label>
              <Input
                id="complianceFile"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null
                  if (selected) {
                    const validationError = validateComplianceFile(selected)
                    if (validationError) {
                      toast({ title: 'Invalid file', description: validationError, variant: 'destructive' })
                      setFile(null)
                      e.target.value = ''
                      return
                    }
                  }
                  setFile(selected)
                }}
              />
              <p className="text-xs text-muted-foreground">PDF, JPG, or PNG. Max 10 MB.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiryDate">Expiry Date (optional)</Label>
              <Input
                id="expiryDate"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                We&apos;ll remind you before this document expires.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleUpload} disabled={!file || submitting}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {submitting ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
