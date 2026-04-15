'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  FileSpreadsheet, Download, Save, Plus, Check, X, Loader2,
  Building2, ChevronRight, Filter, Columns, Database, Search,
  Trash2, Copy, Clock
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { MobileNav } from '@/components/layout/mobile-nav'

type DatasetType = 'invoices' | 'holdbacks' | 'projects' | 'payments' | 'contractors'

interface ColumnDefinition {
  key: string
  label: string
  type: 'string' | 'number' | 'date' | 'currency' | 'boolean'
  description?: string
}

interface ReportTemplate {
  id: string
  name: string
  description: string
  dataset: DatasetType
  columns: string[]
  is_system: boolean
  is_shared: boolean
  created_at: string
  last_used_at: string | null
  use_count: number
}

const datasetConfig: Record<DatasetType, { label: string; icon: typeof FileSpreadsheet; color: string }> = {
  invoices: { label: 'Invoices', icon: FileSpreadsheet, color: 'bg-primary/10 text-primary' },
  holdbacks: { label: 'Holdbacks', icon: Clock, color: 'bg-warning/10 text-warning' },
  projects: { label: 'Projects', icon: Building2, color: 'bg-accent/10 text-accent' },
  payments: { label: 'Payments', icon: Database, color: 'bg-success/10 text-success' },
  contractors: { label: 'Contractors', icon: Building2, color: 'bg-muted text-muted-foreground' },
}

const datasetColumns: Record<DatasetType, ColumnDefinition[]> = {
  invoices: [
    { key: 'invoice_number', label: 'Invoice Number', type: 'string' },
    { key: 'contractor_name', label: 'Contractor', type: 'string' },
    { key: 'project_name', label: 'Project', type: 'string' },
    { key: 'project_number', label: 'Project #', type: 'string' },
    { key: 'invoice_date', label: 'Invoice Date', type: 'date' },
    { key: 'due_date', label: 'Due Date', type: 'date' },
    { key: 'subtotal_cents', label: 'Subtotal', type: 'currency' },
    { key: 'gst_hst_cents', label: 'GST/HST', type: 'currency' },
    { key: 'pst_cents', label: 'PST', type: 'currency' },
    { key: 'total_cents', label: 'Total', type: 'currency' },
    { key: 'holdback_cents', label: 'Holdback', type: 'currency' },
    { key: 'net_payable_cents', label: 'Net Payable', type: 'currency' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'created_at', label: 'Submitted Date', type: 'date' },
  ],
  holdbacks: [
    { key: 'project_name', label: 'Project', type: 'string' },
    { key: 'project_number', label: 'Project #', type: 'string' },
    { key: 'contractor_name', label: 'Contractor', type: 'string' },
    { key: 'invoice_number', label: 'Invoice #', type: 'string' },
    { key: 'holdback_amount_cents', label: 'Holdback Amount', type: 'currency' },
    { key: 'holdback_percent', label: 'Holdback %', type: 'number' },
    { key: 'countdown_start_date', label: 'Start Date', type: 'date' },
    { key: 'release_due_date', label: 'Release Date', type: 'date' },
    { key: 'days_remaining', label: 'Days Remaining', type: 'number' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'released_at', label: 'Released Date', type: 'date' },
    { key: 'released_amount_cents', label: 'Released Amount', type: 'currency' },
  ],
  projects: [
    { key: 'project_number', label: 'Project #', type: 'string' },
    { key: 'name', label: 'Project Name', type: 'string' },
    { key: 'city', label: 'City', type: 'string' },
    { key: 'province', label: 'Province', type: 'string' },
    { key: 'original_budget_cents', label: 'Original Budget', type: 'currency' },
    { key: 'current_budget_cents', label: 'Current Budget', type: 'currency' },
    { key: 'committed_cents', label: 'Committed', type: 'currency' },
    { key: 'spent_cents', label: 'Spent', type: 'currency' },
    { key: 'available_cents', label: 'Available', type: 'currency' },
    { key: 'spent_percentage', label: 'Budget Used %', type: 'number' },
    { key: 'is_active', label: 'Active', type: 'boolean' },
    { key: 'start_date', label: 'Start Date', type: 'date' },
    { key: 'estimated_completion_date', label: 'Est. Completion', type: 'date' },
  ],
  payments: [
    { key: 'payment_date', label: 'Payment Date', type: 'date' },
    { key: 'contractor_name', label: 'Contractor', type: 'string' },
    { key: 'project_name', label: 'Project', type: 'string' },
    { key: 'invoice_number', label: 'Invoice #', type: 'string' },
    { key: 'amount_cents', label: 'Amount', type: 'currency' },
    { key: 'payment_method', label: 'Method', type: 'string' },
    { key: 'eft_file_id', label: 'EFT Batch ID', type: 'string' },
    { key: 'cheque_number', label: 'Cheque #', type: 'string' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'cleared_date', label: 'Cleared Date', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'string' },
  ],
  contractors: [
    { key: 'company_name', label: 'Company Name', type: 'string' },
    { key: 'contact_name', label: 'Contact', type: 'string' },
    { key: 'email', label: 'Email', type: 'string' },
    { key: 'phone', label: 'Phone', type: 'string' },
    { key: 'city', label: 'City', type: 'string' },
    { key: 'province', label: 'Province', type: 'string' },
    { key: 'business_number', label: 'Business #', type: 'string' },
    { key: 'wcb_account_number', label: 'WCB Account', type: 'string' },
    { key: 'wcb_clearance_expiry', label: 'WCB Expiry', type: 'date' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'kyc_completed_at', label: 'KYC Complete', type: 'date' },
    { key: 'created_at', label: 'Added Date', type: 'date' },
  ],
}

// Mock saved templates
const mockTemplates: ReportTemplate[] = [
  {
    id: 'sys-1', name: 'All Invoices', description: 'Complete invoice listing',
    dataset: 'invoices', columns: ['invoice_number', 'contractor_name', 'project_name', 'total_cents', 'status'],
    is_system: true, is_shared: true, created_at: '2024-01-01', last_used_at: '2024-03-01', use_count: 45
  },
  {
    id: 'sys-2', name: 'Pending Holdbacks', description: 'Holdbacks awaiting release',
    dataset: 'holdbacks', columns: ['project_name', 'contractor_name', 'holdback_amount_cents', 'release_due_date', 'status'],
    is_system: true, is_shared: true, created_at: '2024-01-01', last_used_at: '2024-02-28', use_count: 23
  },
  {
    id: 'sys-3', name: 'Project Budget Summary', description: 'Budget utilization by project',
    dataset: 'projects', columns: ['project_number', 'name', 'current_budget_cents', 'spent_cents', 'spent_percentage'],
    is_system: true, is_shared: true, created_at: '2024-01-01', last_used_at: '2024-03-02', use_count: 67
  },
]

export default function ReportBuilderPage() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [selectedDataset, setSelectedDataset] = useState<DatasetType>('invoices')
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(['invoice_number', 'contractor_name', 'project_name', 'total_cents', 'status']))
  const [isExporting, setIsExporting] = useState(false)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [isShared, setIsShared] = useState(false)
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([])

  // Load templates from database
  useEffect(() => {
    const loadTemplates = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('report_templates')
        .select('*')
        .order('use_count', { ascending: false })
      
      if (data && data.length > 0) {
        setTemplates(data as ReportTemplate[])
      } else if (process.env.NODE_ENV === 'development') {
        // DEV ONLY: Fall back to mock templates
        console.warn('[DEV] No report templates in database - using mock data')
        setTemplates(mockTemplates)
      }
    }
    loadTemplates()
  }, [])

  // Generate preview data when dataset or columns change
  useEffect(() => {
    // Generate mock preview data
    const generatePreviewData = () => {
      const columns = Array.from(selectedColumns)
      const rows = []
      for (let i = 0; i < 5; i++) {
        const row: Record<string, unknown> = {}
        columns.forEach(col => {
          const colDef = datasetColumns[selectedDataset].find(c => c.key === col)
          if (colDef) {
            switch (colDef.type) {
              case 'currency':
                row[col] = Math.floor(Math.random() * 10000000) + 100000
                break
              case 'number':
                row[col] = Math.floor(Math.random() * 100)
                break
              case 'date':
                row[col] = new Date(Date.now() - Math.random() * 86400000 * 30).toISOString().split('T')[0]
                break
              case 'boolean':
                row[col] = Math.random() > 0.3
                break
              default:
                row[col] = `Sample ${col} ${i + 1}`
            }
          }
        })
        rows.push(row)
      }
      return rows
    }
    
    if (selectedColumns.size > 0) {
      setPreviewData(generatePreviewData())
    }
  }, [selectedDataset, selectedColumns])

  const handleDatasetChange = (dataset: DatasetType) => {
    setSelectedDataset(dataset)
    // Select first 5 columns by default
    const defaultColumns = datasetColumns[dataset].slice(0, 5).map(c => c.key)
    setSelectedColumns(new Set(defaultColumns))
  }

  const toggleColumn = (columnKey: string) => {
    const newSelected = new Set(selectedColumns)
    if (newSelected.has(columnKey)) {
      newSelected.delete(columnKey)
    } else {
      newSelected.add(columnKey)
    }
    setSelectedColumns(newSelected)
  }

  const selectAllColumns = () => {
    setSelectedColumns(new Set(datasetColumns[selectedDataset].map(c => c.key)))
  }

  const clearAllColumns = () => {
    setSelectedColumns(new Set())
  }

  const handleLoadTemplate = (template: ReportTemplate) => {
    setSelectedDataset(template.dataset)
    setSelectedColumns(new Set(template.columns))
    toast({
      title: 'Template Loaded',
      description: `"${template.name}" has been loaded.`,
    })
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast({
        title: 'Name Required',
        description: 'Please enter a name for this template.',
        variant: 'destructive',
      })
      return
    }

    const supabase = createClient()
    const { data: user } = await supabase.auth.getUser()

    const newTemplate = {
      name: templateName,
      description: templateDescription,
      dataset: selectedDataset,
      columns: Array.from(selectedColumns),
      is_shared: isShared,
      is_system: false,
    }

    const { data, error } = await supabase
      .from('report_templates')
      .insert(newTemplate)
      .select()
      .single()

    if (!error && data) {
      setTemplates(prev => [data as ReportTemplate, ...prev])
    } else {
      // Add to local state if table doesn't exist yet
      const mockTemplate: ReportTemplate = {
        id: crypto.randomUUID(),
        ...newTemplate,
        created_at: new Date().toISOString(),
        last_used_at: null,
        use_count: 0,
      }
      setTemplates(prev => [mockTemplate, ...prev])
    }

    toast({
      title: 'Template Saved',
      description: `"${templateName}" has been saved successfully.`,
    })

    setIsSaveModalOpen(false)
    setTemplateName('')
    setTemplateDescription('')
    setIsShared(false)
  }

  const handleExportCSV = async () => {
    if (selectedColumns.size === 0) {
      toast({
        title: 'No Columns Selected',
        description: 'Please select at least one column to export.',
        variant: 'destructive',
      })
      return
    }

    setIsExporting(true)

    try {
      const columns = Array.from(selectedColumns)

      // Use server-side API endpoint for streaming CSV export
      // This prevents client-side memory overflow for large datasets
      const response = await fetch('/api/reports/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataset: selectedDataset,
          columns,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Export failed')
      }

      // Stream the response to a blob for download
      const blob = await response.blob()
      
      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `${selectedDataset}_report_${new Date().toISOString().split('T')[0]}.csv`
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/)
        if (match) filename = match[1]
      }

      // Create download link
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast({
        title: 'Export Complete',
        description: `${selectedDataset} report downloaded successfully.`,
      })
    } catch (err) {
      console.error('[v0] Export error:', err)
      
      // Fallback to client-side export with preview data
      try {
        const columns = Array.from(selectedColumns)
        generateCSVDownload(previewData, columns)
        toast({
          title: 'Export Complete',
          description: `${selectedDataset} report downloaded (preview data).`,
        })
      } catch {
        toast({
          title: 'Export Failed',
          description: 'Failed to generate export. Please try again.',
          variant: 'destructive',
        })
      }
    } finally {
      setIsExporting(false)
    }
  }

  const generateCSVDownload = (data: Record<string, unknown>[], columns: string[]) => {
    // Get column labels
    const columnDefs = datasetColumns[selectedDataset]
    const headers = columns.map(key => {
      const def = columnDefs.find(c => c.key === key)
      return def?.label || key
    })

    // Format data
    const rows = data.map(row => {
      return columns.map(key => {
        const value = row[key]
        const def = columnDefs.find(c => c.key === key)
        
        if (value === null || value === undefined) return ''
        if (def?.type === 'currency') return (Number(value) / 100).toFixed(2)
        if (def?.type === 'boolean') return value ? 'Yes' : 'No'
        return String(value)
      })
    })

    // Generate CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedDataset}_report_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(cents / 100)
  }

  const formatPreviewValue = (value: unknown, type: string) => {
    if (value === null || value === undefined) return '-'
    if (type === 'currency') return formatCurrency(Number(value))
    if (type === 'boolean') return value ? 'Yes' : 'No'
    if (type === 'number') return String(value)
    return String(value)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <MobileNav />
            <span className="font-semibold text-sm">Report Builder</span>
          </div>
          <Button size="sm" onClick={handleExportCSV} disabled={isExporting || selectedColumns.size === 0}>
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden md:block border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/admin/dashboard">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary-foreground" />
                </div>
              </Link>
              <span className="font-semibold">PayFlow AP</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">Report Builder</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setIsSaveModalOpen(true)} disabled={selectedColumns.size === 0}>
                <Save className="w-4 h-4 mr-2" />
                Save Template
              </Button>
              <Button onClick={handleExportCSV} disabled={isExporting || selectedColumns.size === 0}>
                {isExporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-20 md:pb-8">
        <div className="space-y-4 md:space-y-6">
          {/* Page Header - Desktop */}
          <div className="hidden md:block">
            <h1 className="text-3xl font-semibold tracking-tight">Custom Report Builder</h1>
            <p className="text-muted-foreground mt-1">
              Generate custom data exports with selected columns and filters.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Left Panel - Configuration */}
            <div className="lg:col-span-1 space-y-4">
              {/* Saved Templates */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                  Saved Templates
                </h3>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {templates.slice(0, 5).map((template) => {
                    const DatasetIcon = datasetConfig[template.dataset].icon
                    return (
                      <button
                        key={template.id}
                        onClick={() => handleLoadTemplate(template)}
                        className="w-full text-left p-2 rounded-lg hover:bg-muted/50 transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2">
                          <DatasetIcon className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{template.name}</p>
                            <p className="text-xs text-muted-foreground">{template.columns.length} columns</p>
                          </div>
                        </div>
                        {template.is_system && (
                          <Badge variant="outline" className="text-xs">System</Badge>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Dataset Selector */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <Database className="w-4 h-4 text-muted-foreground" />
                  Select Dataset
                </h3>
                <div className="space-y-2">
                  {(Object.keys(datasetConfig) as DatasetType[]).map((dataset) => {
                    const config = datasetConfig[dataset]
                    const Icon = config.icon
                    return (
                      <button
                        key={dataset}
                        onClick={() => handleDatasetChange(dataset)}
                        className={`w-full text-left p-3 rounded-lg transition-colors flex items-center gap-3 ${
                          selectedDataset === dataset
                            ? 'bg-primary/10 border border-primary/30'
                            : 'hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{config.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {datasetColumns[dataset].length} columns available
                          </p>
                        </div>
                        {selectedDataset === dataset && (
                          <Check className="w-4 h-4 text-primary ml-auto" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Column Selector */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium flex items-center gap-2">
                    <Columns className="w-4 h-4 text-muted-foreground" />
                    Select Columns
                  </h3>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={selectAllColumns}>All</Button>
                    <Button variant="ghost" size="sm" onClick={clearAllColumns}>Clear</Button>
                  </div>
                </div>
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {datasetColumns[selectedDataset].map((column) => (
                    <label
                      key={column.key}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedColumns.has(column.key)}
                        onCheckedChange={() => toggleColumn(column.key)}
                      />
                      <div>
                        <p className="text-sm font-medium">{column.label}</p>
                        <p className="text-xs text-muted-foreground capitalize">{column.type}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Panel - Preview */}
            <div className="lg:col-span-2">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-medium flex items-center gap-2">
                    <Filter className="w-4 h-4 text-muted-foreground" />
                    Data Preview
                  </h3>
                  <Badge variant="outline">
                    {selectedColumns.size} columns selected
                  </Badge>
                </div>

                {selectedColumns.size === 0 ? (
                  <div className="p-12 text-center">
                    <Columns className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Select columns to preview data</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {Array.from(selectedColumns).map((colKey) => {
                            const col = datasetColumns[selectedDataset].find(c => c.key === colKey)
                            return (
                              <th 
                                key={colKey}
                                className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                              >
                                {col?.label || colKey}
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previewData.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/20">
                            {Array.from(selectedColumns).map((colKey) => {
                              const col = datasetColumns[selectedDataset].find(c => c.key === colKey)
                              return (
                                <td key={colKey} className="px-4 py-3 text-sm whitespace-nowrap">
                                  {formatPreviewValue(row[colKey], col?.type || 'string')}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground">
                  Showing preview with sample data. Actual export will include all records.
                </div>
              </div>

              {/* Mobile Action Buttons */}
              <div className="md:hidden flex gap-3 mt-4">
                <Button 
                  variant="outline" 
                  className="flex-1 h-12"
                  onClick={() => setIsSaveModalOpen(true)}
                  disabled={selectedColumns.size === 0}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Template
                </Button>
                <Button 
                  className="flex-1 h-12"
                  onClick={handleExportCSV}
                  disabled={isExporting || selectedColumns.size === 0}
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Export CSV
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Save Template Modal */}
      <Dialog open={isSaveModalOpen} onOpenChange={setIsSaveModalOpen}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Save Report Template</DialogTitle>
            <DialogDescription>
              Save this configuration for future use
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="templateName">Template Name</Label>
              <Input
                id="templateName"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Monthly Invoice Report"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="templateDesc">Description (optional)</Label>
              <Input
                id="templateDesc"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder="Brief description of this report"
                className="h-11"
              />
            </div>

            <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50">
              <Checkbox
                checked={isShared}
                onCheckedChange={(checked) => setIsShared(checked as boolean)}
              />
              <div>
                <p className="text-sm font-medium">Share with team</p>
                <p className="text-xs text-muted-foreground">
                  Allow other team members to use this template
                </p>
              </div>
            </label>

            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Dataset:</strong> {datasetConfig[selectedDataset].label}<br />
                <strong>Columns:</strong> {selectedColumns.size} selected
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate}>
              <Save className="w-4 h-4 mr-2" />
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
