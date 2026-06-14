import 'server-only'
import { render } from '@react-email/render'
import { NotificationEmail, type EmailDetailRow } from '@/emails/notification-email'
import { getEmailBranding, type EmailBranding } from '@/lib/branding/get-active-branding'

export interface RenderEmailInput {
  title: string
  greeting?: string
  paragraphs: string[]
  details?: EmailDetailRow[]
  ctaLabel?: string
  ctaUrl?: string
  preview?: string
  /** Provide pre-resolved branding to avoid a second DB read; falls back to getEmailBranding(). */
  branding?: EmailBranding
  /** Tenancy seam: resolves which org's branding to use (single-tenant default today). */
  orgId?: string | null
}

export interface RenderedEmail {
  html: string
  text: string
}

/**
 * Render a branded PayFlow email to HTML + plain text using the active tenant
 * branding. This is the single entry point for all transactional email bodies;
 * the legacy inline-HTML builders are being retired in favor of this renderer.
 */
export async function renderBrandedEmail(input: RenderEmailInput): Promise<RenderedEmail> {
  const branding = input.branding ?? (await getEmailBranding(input.orgId))

  const element = (
    <NotificationEmail
      branding={branding}
      title={input.title}
      greeting={input.greeting}
      paragraphs={input.paragraphs}
      details={input.details}
      ctaLabel={input.ctaLabel}
      ctaUrl={input.ctaUrl}
      preview={input.preview}
    />
  )

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])

  return { html, text }
}
