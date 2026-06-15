import { type NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Get document from database
    const adminSupabase = getSupabaseAdmin()
    const { data: document, error: dbError } = await adminSupabase
      .from('invoice_documents')
      .select('file_url, file_name, file_type, uploaded_by, uploaded_by_auth_id, invoice_id')
      .eq('id', id)
      .single()

    if (dbError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Verify ownership or admin/PM/accountant role to prevent IDOR.
    // NOTE: user.id is the Supabase auth id; the users table keys role on
    // auth_user_id (its own id is a separate internal uuid).
    const { data: userData } = await supabase
      .from('users')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .single()
    const isInternalStaff = userData?.role === 'admin' || userData?.role === 'project_manager' || userData?.role === 'accountant'
    const isUploader = !!userData?.id && document.uploaded_by === userData.id
    // Contractors have no public.users row, so they're matched on the auth id
    // we now record at upload time.
    const isUploaderByAuth = document.uploaded_by_auth_id === user.id

    // Fallback for contractors: allow access when this auth user owns the
    // invoice the document belongs to (covers legacy rows missing the auth id).
    let isInvoiceOwner = false
    if (!isInternalStaff && !isUploader && !isUploaderByAuth && document.invoice_id) {
      const { data: contractor } = await adminSupabase
        .from('contractors')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (contractor?.id) {
        const { data: invoice } = await adminSupabase
          .from('invoices')
          .select('contractor_id')
          .eq('id', document.invoice_id)
          .maybeSingle()
        isInvoiceOwner = invoice?.contractor_id === contractor.id
      }
    }

    if (!isInternalStaff && !isUploader && !isUploaderByAuth && !isInvoiceOwner) {
       return NextResponse.json({ error: 'Unauthorized to access this document' }, { status: 403 })
    }

    // Fetch from Blob storage (file_url contains the blob pathname)
    const result = await get(document.file_url, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    })

    if (!result) {
      return new NextResponse('File not found', { status: 404 })
    }

    // Handle 304 Not Modified
    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          'Cache-Control': 'private, no-cache',
        },
      })
    }

    // `?inline=1` renders the file in-browser (preview); default forces download.
    const inline = request.nextUrl.searchParams.get('inline') === '1'
    const disposition = inline ? 'inline' : 'attachment'

    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || document.file_type,
        'Content-Disposition': `${disposition}; filename="${document.file_name}"`,
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch (error) {
    console.error('Error serving file:', error)
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
