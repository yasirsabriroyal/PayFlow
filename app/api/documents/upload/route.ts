'use server'

import { put } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const invoiceId = formData.get('invoice_id') as string
    const certificateId = formData.get('certificate_id') as string | null
    const paymentId = formData.get('payment_id') as string | null
    const documentType = formData.get('document_type') as string || 'other'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const pathname = `invoices/${invoiceId}/${timestamp}-${cleanName}`

    // Upload to Blob storage (private)
    const blob = await put(pathname, file, {
      access: 'private',
    })

    // Save document reference to database
    // Store blob.pathname in file_url since that's what we need for get()
    const adminSupabase = getSupabaseAdmin()
    const { data: document, error: dbError } = await adminSupabase
      .from('invoice_documents')
      .insert({
        invoice_id: invoiceId,
        payment_certificate_id: certificateId || null,
        payment_id: paymentId || null,
        entity_type: 'invoice',
        file_name: file.name,
        file_type: file.type,
        file_size_bytes: file.size,
        file_url: blob.pathname, // Store pathname for private blob access via get()
        document_type: documentType,
      })
      .select()
      .single()

    if (dbError) {
      console.error('Database error saving document:', dbError)
      return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      document: {
        id: document.id,
        file_name: document.file_name,
        file_type: document.file_type,
        file_size_bytes: document.file_size_bytes,
        document_type: document.document_type,
      }
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
