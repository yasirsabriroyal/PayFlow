import { type NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { authorizeAttachmentAccess } from '@/lib/invoices/clarification-thread'

/**
 * Serve a clarification-thread message attachment. Authorization allows any
 * participant in the invoice's thread (internal staff with PM scoping, or the
 * invoice's contractor) — so a contractor can view staff-uploaded files and
 * vice versa. `?inline=1` renders in-browser; default forces download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const auth = await authorizeAttachmentAccess(id)
    if (!auth.ok || !auth.fileUrl) {
      return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 })
    }

    const result = await get(auth.fileUrl, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    })

    if (!result) {
      return new NextResponse('File not found', { status: 404 })
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: result.blob.etag, 'Cache-Control': 'private, no-cache' },
      })
    }

    const inline = request.nextUrl.searchParams.get('inline') === '1'
    const disposition = inline ? 'inline' : 'attachment'

    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || auth.fileType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${auth.fileName}"`,
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch (error) {
    console.error('Error serving attachment:', error)
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
