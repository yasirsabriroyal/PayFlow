'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Receipt, Building2, Briefcase, Calculator, FileText, Upload, Info, Trash2, X, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { getPMProjects, createPMInvoice } from '../../actions'
import { getProjectContractors } from '@/app/projects/[id]/actions'
import { AppHeader } from '@/components/app-header'

type Project = {
  id: string
  name: string
  project_number: string
}

type Contractor = {
  id: string
  company_name: string
  contact_name: string
  status: string
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

export default function NewInvoicePage() {
  const router = useRouter()
  const { toast } = useToast()
  
  const [projectId, setProjectId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [invoiceTotal, setInvoiceTotal] = useState('')
  const [holdbackPercentage, setHoldbackPercentage] = useState('10')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [contractorsLoading, setContractorsLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  useEffect(() => {
    const loadProjects = async () => {
      const projectsResult = await getPMProjects()
      
      if (projectsResult.success) {
        setProjects(projectsResult.projects as Project[])
        setProjectsError(null)
      } else {
        setProjects([])
        setProjectsError(
          (projectsResult as { error?: string }).error ||
            'Unable to load projects. You may not have permission, or there are no active projects.'
        )
      }
      setLoading(false)
    }
    loadProjects()
  }, [])
  
  // Load only the contractors assigned to the selected project.
  // Resets the chosen contractor whenever the project changes.
  useEffect(() => {
    if (!projectId) {
      setContractors([])
      setContractorId('')
      return
    }
    
    let cancelled = false
    const loadContractors = async () => {
      setContractorsLoading(true)
      setContractorId('')
      const result = await getProjectContractors(projectId)
      if (cancelled) return
      
      if (result.success && result.data) {
        // Flatten the join rows into the contractor shape the select expects.
        const mapped: Contractor[] = result.data
          .filter(row => row.contractor)
          .map(row => ({
            id: row.contractor.id,
            company_name: row.contractor.company_name,
            contact_name: row.contractor.contact_name,
            status: row.contractor.status,
          }))
        setContractors(mapped)
      } else {
        setContractors([])
      }
      setContractorsLoading(false)
    }
    loadContractors()
    
    return () => {
      cancelled = true
    }
  }, [projectId])
  
  const totalCents = Math.round(parseFloat(invoiceTotal || '0') * 100)
  const holdbackRate = parseFloat(holdbackPercentage || '0') / 100
  const holdbackCents = Math.round(totalCents * holdbackRate)
  const netPayableCents = totalCents - holdbackCents
  
  const selectedProject = projects.find(p => p.id === projectId)
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
      setFiles((prev) => [...prev, ...newFiles])
    }
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!projectId) {
      toast({ title: 'Error', description: 'Please select a project', variant: 'destructive' })
      return
    }
    if (!contractorId) {
      toast({ title: 'Error', description: 'Please select a contractor', variant: 'destructive' })
      return
    }
    if (totalCents <= 0) {
      toast({ title: 'Error', description: 'Invoice total must be greater than 0', variant: 'destructive' })
      return
    }
    
    setSubmitting(true)
    
    const result = await createPMInvoice({
      project_id: projectId,
      contractor_id: contractorId,
      total_cents: totalCents,
      holdback_percentage: parseFloat(holdbackPercentage),
      description: description || undefined,
      notes: notes || undefined,
    })
    
    if (result.success && result.invoice) {
      const createdInvoice = result.invoice
      
      if (files.length > 0) {
        try {
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const formData = new FormData()
            formData.append('file', file)
            formData.append('invoice_id', createdInvoice.id)
            const documentType = i === 0 ? 'original_invoice' : 'supporting_doc'
            formData.append('document_type', documentType)

            await fetch('/api/documents/upload', {
              method: 'POST',
              body: formData,
            })
          }
        } catch (uploadErr) {
          console.error('Error uploading invoice attachments:', uploadErr)
          toast({
            title: 'Upload Warning',
            description: 'Invoice was created, but some attachments failed to upload.',
            variant: 'destructive',
          })
        }
      }

      toast({ title: 'Success', description: 'Invoice created successfully' })
      router.push(`/invoices/${createdInvoice.id}`)
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to create invoice', variant: 'destructive' })
      setSubmitting(false)
    }
  }
  
  if (loading) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </div>
      </main>
    )
  }
  
  return (
    <main className="min-h-screen bg-background">
      <AppHeader 
        pageTitle="Create New Invoice"
        pageDescription="Enter contractor invoice details"
      />
      
      <div className="max-w-4xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-primary" />
                  Project & Contractor
                </CardTitle>
                <CardDescription>Select the project and contractor for this invoice</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="project">Project *</Label>
                  <Select value={projectId} onValueChange={setProjectId} disabled={projects.length === 0}>
                    <SelectTrigger id="project">
                      <SelectValue placeholder={projects.length === 0 ? 'No projects available' : 'Select a project'} />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(project => (
                        <SelectItem key={project.id} value={project.id}>
                          <div className="flex flex-col">
                            <span>{project.name}</span>
                            <span className="text-xs text-muted-foreground">{project.project_number}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectsError && (
                    <p className="text-xs text-destructive">{projectsError}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="contractor">Contractor *</Label>
                  <Select
                    value={contractorId}
                    onValueChange={setContractorId}
                    disabled={!projectId || contractorsLoading || contractors.length === 0}
                  >
                    <SelectTrigger id="contractor">
                      <SelectValue
                        placeholder={
                          !projectId
                            ? 'Select a project first'
                            : contractorsLoading
                            ? 'Loading contractors...'
                            : contractors.length === 0
                            ? 'No contractors assigned to this project'
                            : 'Select a contractor'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {contractors.map(contractor => (
                        <SelectItem key={contractor.id} value={contractor.id}>
                          <div className="flex flex-col">
                            <span>{contractor.company_name}</span>
                            <span className="text-xs text-muted-foreground">{contractor.contact_name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectId && !contractorsLoading && contractors.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      This project has no assigned contractors yet.{' '}
                      <Link
                        href={`/projects/${projectId}`}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Assign a contractor
                      </Link>{' '}
                      on the project page before invoicing.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-primary" />
                  Invoice Details
                </CardTitle>
                <CardDescription>Enter the invoice amount and holdback percentage</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="total">Invoice Total *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="total"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={invoiceTotal}
                        onChange={(e) => setInvoiceTotal(e.target.value)}
                        className="pl-7"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="holdback">Holdback %</Label>
                    <div className="relative">
                      <Input
                        id="holdback"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={holdbackPercentage}
                        onChange={(e) => setHoldbackPercentage(e.target.value)}
                        className="pr-7"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    placeholder="e.g., Progress billing for foundation work"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any additional notes or comments..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
            
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  Attachments (Optional)
                </CardTitle>
                <CardDescription>Upload the original invoice document and any supporting files</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={handleFileChange}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  />
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Click to select files</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, or Images up to 10MB</p>
                </div>
                
                {files.length > 0 && (
                  <div className="space-y-2 mt-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Selected Files</p>
                    <div className="divide-y divide-border border border-border rounded-lg bg-muted/20">
                      {files.map((file, index) => (
                        <div key={index} className="flex items-center justify-between p-3 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="truncate font-medium">{file.name}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              ({(file.size / 1024).toFixed(1)} KB)
                            </span>
                            {index === 0 && (
                              <Badge variant="outline" className="text-[10px] uppercase font-bold py-0 h-4 border-primary text-primary bg-primary/5">
                                Original Invoice
                              </Badge>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeFile(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          
          <div className="space-y-6">
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-primary" />
                  Invoice Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(selectedProject || contractorId) && (
                  <div className="space-y-2 pb-4 border-b border-border">
                    {selectedProject && (
                      <div className="flex items-center gap-2 text-sm">
                        <Briefcase className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{selectedProject.name}</span>
                      </div>
                    )}
                    {contractorId && (
                      <div className="flex items-center gap-2 text-sm">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <span>{contractors.find(c => c.id === contractorId)?.company_name}</span>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatCurrency(totalCents / 100)}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Holdback ({holdbackPercentage}%)</span>
                    <span className="text-warning">-{formatCurrency(holdbackCents / 100)}</span>
                  </div>
                  
                  <Separator />
                  
                  <div className="flex justify-between text-lg">
                    <span className="font-semibold">Net Payable</span>
                    <span className="font-bold text-primary">{formatCurrency(netPayableCents / 100)}</span>
                  </div>
                </div>
                
                <div className="bg-muted/50 rounded-lg p-3 mt-4">
                  <div className="flex gap-2">
                    <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      After creating this invoice, you can issue Payment Certificates to certify amounts for payment.
                    </p>
                  </div>
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full mt-4" 
                  size="lg"
                  disabled={submitting || !projectId || !contractorId || totalCents <= 0}
                >
                  {submitting ? 'Creating...' : 'Create Invoice'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </form>
      </div>
    </main>
  )
}
