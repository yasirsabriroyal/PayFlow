import { put } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { checkThreadAccess } from '@/lib/invoices/clarification-thread'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

/**
 * Upload a single attachment for an existing clarification-thread message.
 * The message must already exist (post the message first, then attach files).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const invoiceId = formData.get('invoice_id') as string | null
    const messageId = formData.get('message_id') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!invoiceId || !messageId) {
      return NextResponse.json({ error: 'invoice_id and message_id are required' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 })
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only PDF, PNG, and JPEG are allowed' },
        { status: 400 }
      )
    }

    // Authorize: caller must be a participant in this invoice's thread.
    const access = await checkThreadAccess(invoiceId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 })
    }

    const admin = getSupabaseAdmin()

    // Verify the message exists and belongs to this invoice.
    const { data: message } = await admin
      .from('invoice_messages')
      .select('id, invoice_id')
      .eq('id', messageId)
      .maybeSingle()
    if (!message || message.invoice_id !== invoiceId) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const timestamp = Date.now()
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const pathname = `users/${user.id}/invoice-messages/${invoiceId}/${messageId}/${timestamp}-${cleanName}`

    const blob = await put(pathname, file, { access: 'private' })

    const { data: attachment, error: dbError } = await admin
      .from('invoice_message_attachments')
      .insert({
        message_id: messageId,
        invoice_id: invoiceId,
        file_name: file.name,
        file_type: file.type,
        file_size_bytes: file.size,
        file_url: blob.pathname,
        uploaded_by_auth_id: user.id,
      })
      .select('id, file_name, file_type, file_size_bytes, created_at')
      .single()

    if (dbError) {
      console.error('Save attachment error:', dbError)
      return NextResponse.json({ error: 'Failed to save attachment' }, { status: 500 })
    }

    return NextResponse.json({ success: true, attachment })
  } catch (error) {
    console.error('Attachment upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
