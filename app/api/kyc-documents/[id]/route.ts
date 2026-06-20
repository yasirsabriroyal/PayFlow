import { type NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authenticated session
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admin / project_manager / accountant may download KYC documents
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()

    const allowedRoles = ['admin', 'project_manager', 'accountant']
    if (!userData || !allowedRoles.includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    // Fetch document record from vendor_kyc_documents
    const adminSupabase = getSupabaseAdmin()
    const { data: doc, error: dbError } = await adminSupabase
      .from('vendor_kyc_documents')
      .select('document_url, file_name, mime_type')
      .eq('id', id)
      .single()

    if (dbError || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (!doc.document_url) {
      return NextResponse.json({ error: 'No file attached to this document' }, { status: 404 })
    }

    // Fetch private blob by pathname
    const result = await get(doc.document_url, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    })

    if (!result) {
      return new NextResponse('File not found in storage', { status: 404 })
    }

    // Handle 304 Not Modified (browser cache hit)
    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          'Cache-Control': 'private, no-cache',
        },
      })
    }

    const inline = request.nextUrl.searchParams.get('inline') === '1'
    const disposition = inline ? 'inline' : 'attachment'
    const fileName = doc.file_name ?? doc.document_url.split('/').pop() ?? 'document'

    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || doc.mime_type || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch (error) {
    console.error('[kyc-documents] Error serving file:', error)
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
