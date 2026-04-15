'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Receipt, Building2, Briefcase, Calculator, FileText, Upload, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { getPMProjects, getContractors, createPMInvoice } from '../../actions'
import { AppHeader } from '@/components/app-header'

type Project = {
  id: string
  name: string
  project_number: string
  default_holdback_percentage?: number
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
  
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  
  useEffect(() => {
    const loadData = async () => {
      const [projectsResult, contractorsResult] = await Promise.all([
        getPMProjects(),
        getContractors()
      ])
      
      if (projectsResult.success) {
        setProjects(projectsResult.projects as Project[])
      }
      if (contractorsResult.success) {
        setContractors(contractorsResult.contractors as Contractor[])
      }
      setLoading(false)
    }
    loadData()
  }, [])
  
  const totalCents = Math.round(parseFloat(invoiceTotal || '0') * 100)
  const holdbackRate = parseFloat(holdbackPercentage || '0') / 100
  const holdbackCents = Math.round(totalCents * holdbackRate)
  const netPayableCents = totalCents - holdbackCents
  
  const selectedProject = projects.find(p => p.id === projectId)
  
  useEffect(() => {
    if (selectedProject?.default_holdback_percentage !== undefined) {
      setHoldbackPercentage(selectedProject.default_holdback_percentage.toString())
    }
  }, [selectedProject])
  
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
      toast({ title: 'Success', description: 'Invoice created successfully' })
      router.push(`/invoices/${result.invoice.id}`)
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
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger id="project">
                      <SelectValue placeholder="Select a project" />
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
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="contractor">Contractor *</Label>
                  <Select value={contractorId} onValueChange={setContractorId}>
                    <SelectTrigger id="contractor">
                      <SelectValue placeholder="Select a contractor" />
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
                <CardTitle className="flex items-center gap-2 text-muted-foreground">
                  <Upload className="w-5 h-5" />
                  Attachments (Optional)
                </CardTitle>
                <CardDescription>Upload supporting documents like contracts or receipts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Document upload coming soon</p>
                </div>
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
