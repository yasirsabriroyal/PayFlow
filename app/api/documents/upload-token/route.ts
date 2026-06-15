import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Client-to-Blob upload token endpoint for contractor invoice documents.
 *
 * The browser uploads files directly to Vercel Blob using `upload()` from
 * `@vercel/blob/client`, which calls this route to mint a short-lived,
 * scoped client token. Routing the bytes straight to Blob (instead of through
 * a Server Action) bypasses the 1 MB Server Action body limit, so real invoice
 * PDFs and phone scans upload reliably.
 *
 * Security:
 * - Only authenticated, ACTIVE contractors can obtain a token.
 * - The token restricts content types and maximum size.
 * - Files land under a private store; serving is gated separately by
 *   `/api/documents/[id]` against the invoice_documents row.
 */

// Keep in sync with the client-side validation and the serve route.
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]

// 15 MB — comfortably covers multi-page scans and phone photos.
const MAX_SIZE_BYTES = 15 * 1024 * 1024

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Authenticate the caller and confirm they are an active contractor.
        const supabase = await createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          throw new Error('Unauthorized')
        }

        const adminSupabase = getSupabaseAdmin()
        const { data: contractor, error } = await adminSupabase
          .from('contractors')
          .select('id, status')
          .eq('auth_user_id', user.id)
          .single()

        if (error || !contractor) {
          throw new Error('Contractor profile not found')
        }

        if (contractor.status !== 'active') {
          throw new Error('Your account is not active yet.')
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_SIZE_BYTES,
          addRandomSuffix: true,
          // Surface the uploader on the completion callback (when it fires).
          tokenPayload: JSON.stringify({ authUserId: user.id }),
        }
      },
      onUploadCompleted: async ({ blob }) => {
        // Note: this callback only fires when Blob can reach a public URL
        // (i.e. on deployed environments, not localhost). Document rows are
        // persisted by `submitVendorInvoice` after the client upload resolves,
        // so this is purely informational and never the source of truth.
        console.log('[v0] Vendor blob upload completed:', blob.pathname)
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    console.error('[v0] Upload token error:', error)
    const message = error instanceof Error ? error.message : 'Upload not allowed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
