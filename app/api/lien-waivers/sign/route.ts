import { NextRequest, NextResponse } from 'next/server'
import { signLienWaiver } from '@/lib/actions/lien-waivers'

/**
 * POST /api/lien-waivers/sign
 *
 * Wraps the signLienWaiver server action so that we can capture real
 * request-level metadata (IP address, User-Agent) that is unavailable
 * inside a React Server Action / 'use server' function.
 *
 * Body: { paymentRequestId: string; signatureData: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { paymentRequestId, signatureData } = body

    if (!paymentRequestId || !signatureData) {
      return NextResponse.json({ success: false, error: 'Missing required fields.' }, { status: 400 })
    }

    // Capture audit metadata from the incoming request
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'

    // Merge audit fields into the signature payload JSON before persisting
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(signatureData)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid signature data.' }, { status: 400 })
    }

    const enrichedPayload = JSON.stringify({
      ...parsed,
      ip,
      user_agent: userAgent,
    })

    const result = await signLienWaiver(paymentRequestId, enrichedPayload, ip, userAgent)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/lien-waivers/sign] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Server error.' }, { status: 500 })
  }
}
