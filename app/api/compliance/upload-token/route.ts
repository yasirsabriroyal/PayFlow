import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Client-to-Blob upload token endpoint for contractor compliance documents
 * (WCB clearance, insurance certificate, trade/business license, safety cert).
 *
 * The browser uploads the file directly to Vercel Blob using `upload()` from
 * `@vercel/blob/client`, which calls this route to mint a short-lived, scoped
 * client token. Routing the bytes straight to Blob (instead of through a Server
 * Action) bypasses the 1 MB Server Action body limit, so real PDF/scan
 * documents upload reliably.
 *
 * Security:
 * - Only authenticated contractors can obtain a token.
 * - Compliance docs are often uploaded while a contractor is still
 *   `pending_kyc`, so both `pending_kyc` and `active` are allowed. Suspended or
 *   inactive accounts are rejected.
 * - The token restricts content types and maximum size.
 * - Files land in a private store; serving is gated separately.
 */

// Keep in sync with the client-side validation and the metadata save action.
const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

// 10 MB — covers multi-page scans and phone photos of compliance certificates.
const MAX_SIZE_BYTES = 10 * 1024 * 1024

// Contractor statuses permitted to upload compliance documents.
const ALLOWED_CONTRACTOR_STATUSES = ['pending_kyc', 'active']

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Authenticate the caller and confirm they own a contractor profile.
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

        if (!ALLOWED_CONTRACTOR_STATUSES.includes(contractor.status)) {
          throw new Error('Your account cannot upload compliance documents right now.')
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
        // Only fires on deployed environments (Blob needs a reachable URL).
        // The document row is persisted by `saveComplianceDocument` after the
        // client upload resolves, so this is informational only.
        console.log('[v0] Compliance blob upload completed:', blob.pathname)
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    console.error('[v0] Compliance upload token error:', error)
    const message = error instanceof Error ? error.message : 'Upload not allowed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
