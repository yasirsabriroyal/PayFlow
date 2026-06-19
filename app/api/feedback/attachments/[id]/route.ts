import { type NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Serve a private feedback attachment.
 * Access rules:
 *  - Admin users can access any attachment in their org.
 *  - Non-admin users can only access attachments on tickets they submitted.
 * ?inline=1 renders in-browser; default forces download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const admin = getSupabaseAdmin()

    // Fetch attachment row
    const { data: attachment, error: attErr } = await admin
      .from('feedback_attachments')
      .select('id, ticket_id, file_url, file_name, file_type, uploaded_by_user_id')
      .eq('id', id)
      .single()

    if (attErr || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    // Resolve caller's internal profile
    const { data: profile } = await admin
      .from('users')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    const isAdmin = profile?.role === 'admin'

    if (!isAdmin) {
      // Submitter access: they must own the parent ticket
      const { data: ticket } = await admin
        .from('feedback_tickets')
        .select('submitted_by_user_id')
        .eq('id', attachment.ticket_id)
        .single()

      const isOwner = ticket?.submitted_by_user_id === profile?.id
      if (!isOwner) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }
    }

    const result = await get(attachment.file_url, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    })

    if (!result) {
      return new NextResponse('File not found', { status: 404 })
    }

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

    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || attachment.file_type || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${attachment.file_name}"`,
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch (error) {
    console.error('[feedback/attachments] serve error:', error)
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
