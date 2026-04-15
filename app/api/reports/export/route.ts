import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Dataset configurations with their table mappings and select queries
const datasetConfig: Record<string, { 
  table: string; 
  select: string;
  transform?: (row: Record<string, unknown>) => Record<string, unknown>;
}> = {
  invoices: {
    table: 'invoices',
    select: '*, contractors(company_name), projects(name, project_number)',
    transform: (row) => ({
      ...row,
      contractor_name: (row.contractors as { company_name?: string })?.company_name,
      project_name: (row.projects as { name?: string })?.name,
      project_number: (row.projects as { project_number?: string })?.project_number,
    }),
  },
  holdbacks: {
    table: 'holdback_ledgers',
    select: '*, contractors(company_name), projects(name), invoices(invoice_number)',
    transform: (row) => ({
      ...row,
      contractor_name: (row.contractors as { company_name?: string })?.company_name,
      project_name: (row.projects as { name?: string })?.name,
      invoice_number: (row.invoices as { invoice_number?: string })?.invoice_number,
    }),
  },
  projects: {
    table: 'v_project_budget_summary',
    select: '*',
  },
  payments: {
    table: 'payments',
    select: '*, contractors(company_name)',
    transform: (row) => ({
      ...row,
      contractor_name: (row.contractors as { company_name?: string })?.company_name,
    }),
  },
  contractors: {
    table: 'contractors',
    select: '*',
  },
}

// Column display names mapping
const columnLabels: Record<string, string> = {
  id: 'ID',
  invoice_number: 'Invoice Number',
  contractor_name: 'Contractor',
  project_name: 'Project',
  project_number: 'Project Number',
  amount_cents: 'Amount (cents)',
  status: 'Status',
  submitted_at: 'Submitted Date',
  approved_at: 'Approved Date',
  paid_at: 'Paid Date',
  holdback_amount_cents: 'Holdback Amount (cents)',
  release_date: 'Release Date',
  company_name: 'Company Name',
  email: 'Email',
  phone: 'Phone',
  current_budget_cents: 'Budget (cents)',
  spent_cents: 'Spent (cents)',
  remaining_cents: 'Remaining (cents)',
  created_at: 'Created Date',
}

function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  
  const stringValue = String(value)
  
  // If value contains comma, newline, or quote, wrap in quotes and escape internal quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  
  return stringValue
}

function formatCentsAsDollars(value: unknown): string {
  if (typeof value === 'number') {
    return (value / 100).toFixed(2)
  }
  return String(value ?? '')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { dataset, columns, filters } = body as {
      dataset: string
      columns: string[]
      filters?: Record<string, unknown>
    }

    // Validate input
    if (!dataset || !datasetConfig[dataset]) {
      return NextResponse.json(
        { error: 'Invalid dataset specified' },
        { status: 400 }
      )
    }

    if (!columns || columns.length === 0) {
      return NextResponse.json(
        { error: 'No columns specified for export' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get dataset configuration
    const config = datasetConfig[dataset]

    // Build and execute query
    let query = supabase.from(config.table).select(config.select)

    // Apply optional filters
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query = query.eq(key, value)
        }
      })
    }

    // Execute query with pagination for large datasets
    const { data, error } = await query.limit(10000)

    if (error) {
      console.error('[v0] CSV Export query error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch data' },
        { status: 500 }
      )
    }

    // Transform data if needed
    const transformedData = config.transform 
      ? (data || []).map(config.transform)
      : (data || [])

    // Generate CSV content using streaming approach
    const encoder = new TextEncoder()
    
    // Create a readable stream for the CSV
    const stream = new ReadableStream({
      start(controller) {
        // Write BOM for Excel compatibility with UTF-8
        controller.enqueue(encoder.encode('\ufeff'))
        
        // Write header row
        const headerRow = columns
          .map(col => columnLabels[col] || col)
          .map(escapeCSVValue)
          .join(',')
        controller.enqueue(encoder.encode(headerRow + '\n'))
        
        // Write data rows
        for (const row of transformedData) {
          const dataRow = columns
            .map(col => {
              let value = row[col]
              
              // Format cents columns as dollars for display
              if (col.endsWith('_cents') && typeof value === 'number') {
                value = formatCentsAsDollars(value)
              }
              
              return escapeCSVValue(value)
            })
            .join(',')
          controller.enqueue(encoder.encode(dataRow + '\n'))
        }
        
        controller.close()
      },
    })

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `payflow_${dataset}_export_${timestamp}.csv`

    // Return streaming response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    console.error('[v0] CSV Export error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET endpoint for simple exports without body
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const dataset = searchParams.get('dataset')
  const columnsParam = searchParams.get('columns')
  
  if (!dataset || !columnsParam) {
    return NextResponse.json(
      { error: 'Missing required parameters: dataset, columns' },
      { status: 400 }
    )
  }

  const columns = columnsParam.split(',')
  
  // Forward to POST handler
  const mockRequest = new NextRequest(request.url, {
    method: 'POST',
    body: JSON.stringify({ dataset, columns }),
  })
  
  return POST(mockRequest)
}
