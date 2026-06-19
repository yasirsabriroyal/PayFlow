import { put } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

/**
 * Upload a single attachment for a feedback ticket.
 * If ticket_id is omitted (during initial form submission), the file is uploaded
 * to Blob only and the caller must call uploadFeedbackAttachment() separately
 * after the ticket is created.
 *
 * When ticket_id is provided, the DB row is written here directly.
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const ticketId = formData.get('ticket_id') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 })
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: PDF, PNG, JPEG, GIF, WebP' },
        { status: 400 }
      )
    }

    const timestamp = Date.now()
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const pathname = `users/${user.id}/feedback/${ticketId ?? 'pending'}/${timestamp}-${cleanName}`

    const blob = await put(pathname, file, { access: 'private' })

    if (ticketId) {
      // Persist the attachment row now
      const admin = getSupabaseAdmin()

      // Resolve org
      const { data: org } = await admin
        .from('organizations')
        .select('id')
        .eq('is_default', true)
        .limit(1)
        .single()
      const orgId = org?.id

      // Resolve internal user profile
      const { data: profile } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      const { data: attachment, error: dbError } = await admin
        .from('feedback_attachments')
        .insert({
          ticket_id:            ticketId,
          organization_id:      orgId,
          file_url:             blob.pathname,
          file_name:            file.name,
          file_type:            file.type,
          file_size_bytes:      file.size,
          uploaded_by_user_id:  profile?.id ?? null,
        })
        .select('id, file_name, file_type, file_size_bytes, created_at')
        .single()

      if (dbError) {
        console.error('[feedback/upload] DB insert error:', dbError)
        return NextResponse.json({ error: 'Failed to save attachment record' }, { status: 500 })
      }

      return NextResponse.json({ success: true, attachment })
    }

    // No ticket_id — return the blob pathname for deferred linking
    return NextResponse.json({
      success: true,
      pathname: blob.pathname,
      fileName: file.name,
      fileType: file.type,
      fileSizeBytes: file.size,
    })
  } catch (error) {
    console.error('[feedback/upload] error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
