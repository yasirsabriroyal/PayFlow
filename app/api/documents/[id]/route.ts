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
      .select('file_url, file_name, file_type, uploaded_by')
      .eq('id', id)
      .single()

    if (dbError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Verify ownership or admin/PM/accountant role to prevent IDOR
    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
    const isInternalStaff = userData?.role === 'admin' || userData?.role === 'project_manager' || userData?.role === 'accountant'

    if (!isInternalStaff && document.uploaded_by !== user.id) {
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
