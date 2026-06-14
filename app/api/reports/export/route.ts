import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { hasPermission } from '@/lib/permissions/core'
import { PERMISSIONS, ROLES, type UserRole } from '@/lib/permissions/constants'

/**
 * Dataset configurations.
 *
 * `select` is an explicit, safe column projection — never `*` — so sensitive
 * fields (e.g. encrypted bank data, bank tokens, raw account numbers on
 * contractors) can never be pulled into an export, even by request.
 *
 * `allowedColumns` is the set of output column keys a caller is permitted to
 * request. Any requested column outside this allowlist is rejected.
 */
const datasetConfig: Record<string, {
  table: string
  select: string
  allowedColumns: string[]
  transform?: (row: Record<string, unknown>) => Record<string, unknown>
}> = {
  invoices: {
    table: 'invoices',
    select:
      'id, invoice_number, invoice_date, due_date, subtotal_cents, gst_hst_cents, pst_cents, total_cents, holdback_cents, net_payable_cents, status, created_at, contractors(company_name), projects(name, project_number)',
    allowedColumns: [
      'id', 'invoice_number', 'invoice_date', 'due_date', 'subtotal_cents', 'gst_hst_cents',
      'pst_cents', 'total_cents', 'holdback_cents', 'net_payable_cents', 'status', 'created_at',
      'contractor_name', 'project_name', 'project_number',
    ],
    transform: (row) => ({
      ...row,
      contractor_name: (row.contractors as { company_name?: string })?.company_name,
      project_name: (row.projects as { name?: string })?.name,
      project_number: (row.projects as { project_number?: string })?.project_number,
    }),
  },
  holdbacks: {
    table: 'holdback_ledgers',
    select:
      'id, holdback_amount_cents, holdback_percent, countdown_start_date, release_due_date, days_remaining, status, released_at, released_amount_cents, contractors(company_name), projects(name, project_number), invoices(invoice_number)',
    allowedColumns: [
      'id', 'holdback_amount_cents', 'holdback_percent', 'countdown_start_date', 'release_due_date',
      'days_remaining', 'status', 'released_at', 'released_amount_cents',
      'contractor_name', 'project_name', 'project_number', 'invoice_number',
    ],
    transform: (row) => ({
      ...row,
      contractor_name: (row.contractors as { company_name?: string })?.company_name,
      project_name: (row.projects as { name?: string })?.name,
      project_number: (row.projects as { project_number?: string })?.project_number,
      invoice_number: (row.invoices as { invoice_number?: string })?.invoice_number,
    }),
  },
  projects: {
    table: 'v_project_budget_summary',
    select:
      'id, project_number, name, city, province, original_budget_cents, current_budget_cents, committed_cents, spent_cents, available_cents, spent_percentage, is_active, start_date, estimated_completion_date',
    allowedColumns: [
      'id', 'project_number', 'name', 'city', 'province', 'original_budget_cents',
      'current_budget_cents', 'committed_cents', 'spent_cents', 'available_cents',
      'spent_percentage', 'is_active', 'start_date', 'estimated_completion_date',
    ],
  },
  payments: {
    table: 'payments',
    select:
      'id, payment_date, amount_cents, payment_method, eft_file_id, cheque_number, status, cleared_date, notes, invoice_number, contractors(company_name), projects(name)',
    allowedColumns: [
      'id', 'payment_date', 'amount_cents', 'payment_method', 'eft_file_id', 'cheque_number',
      'status', 'cleared_date', 'notes', 'invoice_number', 'contractor_name', 'project_name',
    ],
    transform: (row) => ({
      ...row,
      contractor_name: (row.contractors as { company_name?: string })?.company_name,
      project_name: (row.projects as { name?: string })?.name,
    }),
  },
  contractors: {
    table: 'contractors',
    // Explicit safe projection — NO bank_* columns, tokens, or raw account numbers.
    select:
      'id, company_name, contact_name, email, phone, city, province, business_number, trade_category, preferred_payment_method, wcb_account_number, wcb_clearance_expiry, status, kyc_completed_at, created_at',
    allowedColumns: [
      'id', 'company_name', 'contact_name', 'email', 'phone', 'city', 'province',
      'business_number', 'trade_category', 'preferred_payment_method', 'wcb_account_number',
      'wcb_clearance_expiry', 'status', 'kyc_completed_at', 'created_at',
    ],
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

    // Resolve the caller's role from the trusted users table (never client metadata)
    const { data: userRecord } = await supabase
      .from('users')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .single()

    const role: UserRole = userRecord?.role && ROLES.includes(userRecord.role as UserRole)
      ? (userRecord.role as UserRole)
      : 'contractor'

    // Enforce the export_reports permission (DB-backed matrix), not just login
    const canExport = await hasPermission(role, PERMISSIONS.REPORTING.EXPORT_REPORTS)
    if (!canExport) {
      return NextResponse.json(
        { error: 'Forbidden: missing export_reports permission' },
        { status: 403 }
      )
    }

    // Get dataset configuration
    const config = datasetConfig[dataset]

    // Validate every requested column against the dataset allowlist. This blocks
    // attempts to exfiltrate non-whitelisted (e.g. sensitive) fields by name.
    const invalidColumns = columns.filter((c) => !config.allowedColumns.includes(c))
    if (invalidColumns.length > 0) {
      return NextResponse.json(
        { error: `Invalid column(s) for ${dataset}: ${invalidColumns.join(', ')}` },
        { status: 400 }
      )
    }

    // Only allow filtering on whitelisted columns as well
    if (filters) {
      const invalidFilterKeys = Object.keys(filters).filter((k) => !config.allowedColumns.includes(k))
      if (invalidFilterKeys.length > 0) {
        return NextResponse.json(
          { error: `Invalid filter column(s): ${invalidFilterKeys.join(', ')}` },
          { status: 400 }
        )
      }
    }

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
    const rawRows = (data || []) as unknown as Record<string, unknown>[]
    const transformedData = config.transform
      ? rawRows.map(config.transform)
      : rawRows

    // Audit the export (best-effort — never block the download). Records who
    // exported what, which columns, and how many rows — but no row data.
    try {
      await getSupabaseAdmin().from('audit_logs').insert({
        action: 'report_exported',
        entity_type: 'report',
        entity_id: dataset,
        user_id: userRecord?.id ?? null,
        user_role: role,
        description: `Exported ${transformedData.length} ${dataset} row(s) to CSV`,
        new_values: { dataset, columns, row_count: transformedData.length },
      })
    } catch (auditErr) {
      console.error('[v0] Export audit log failed:', auditErr)
    }

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
