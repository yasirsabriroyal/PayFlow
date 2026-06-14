import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Heading,
  Text,
  Link,
  Button,
  Img,
  Hr,
  Preview,
} from '@react-email/components'
import type { EmailBranding } from '@/lib/branding/get-active-branding'

/** A single label/value row rendered in the system-controlled detail table. */
export interface EmailDetailRow {
  label: string
  value: string
  /** Emphasize monetary / status values. */
  strong?: boolean
}

export interface NotificationEmailProps {
  branding: EmailBranding
  /** Main heading shown in the branded header bar. */
  title: string
  /** Optional greeting line, e.g. "Hi Acme Builders,". */
  greeting?: string
  /** Body paragraphs (used by generic, non-templated alerts). */
  paragraphs: string[]
  /** Tenant-editable opening message, rendered before the details table. */
  opening?: string
  /** Tenant-editable closing message, rendered after the call to action. */
  closing?: string
  /** Tenant-editable help/contact message, rendered in the footer area. */
  help?: string
  /** Tenant-editable optional note, rendered in a highlighted box near the details. */
  notes?: string
  /** System-controlled required fields (vendor, invoice #, amount, status, etc.). */
  details?: EmailDetailRow[]
  /** Optional call to action. */
  ctaLabel?: string
  ctaUrl?: string
  /** Short preheader text shown in inbox preview. */
  preview?: string
}

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/**
 * The single branded email shell for PayFlow.
 *
 * Layout is SYSTEM-CONTROLLED (header / details table / footer structure are not
 * tenant-editable). Tenant branding (logo, name, colors, contact) is injected via
 * `branding`. The "Powered by PayFlow" footer always renders unless the tenant's
 * plan enables white-label (branding.whiteLabelEnabled).
 */
export function NotificationEmail({
  branding,
  title,
  greeting,
  paragraphs,
  opening,
  closing,
  help,
  notes,
  details,
  ctaLabel,
  ctaUrl,
  preview,
}: NotificationEmailProps) {
  const primary = branding.primaryColor
  const accent = branding.accentColor

  return (
    <Html>
      <Head />
      {preview ? <Preview>{preview}</Preview> : null}
      <Body style={{ backgroundColor: '#f1f5f9', margin: 0, padding: '24px 0', fontFamily: FONT_STACK }}>
        <Container style={{ maxWidth: 600, margin: '0 auto', backgroundColor: '#ffffff', borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          {/* SYSTEM-CONTROLLED: branded header */}
          <Section style={{ backgroundColor: primary, padding: '20px 24px' }}>
            <Row>
              {branding.logoUrl ? (
                <Column style={{ width: 44, verticalAlign: 'middle' }}>
                  <Img
                    src={branding.logoUrl}
                    alt={branding.companyName}
                    width={36}
                    height={36}
                    style={{ borderRadius: 6, display: 'block', objectFit: 'contain', backgroundColor: '#ffffff' }}
                  />
                </Column>
              ) : null}
              <Column style={{ verticalAlign: 'middle' }}>
                <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: 600, margin: 0, opacity: 0.85 }}>
                  {branding.companyName}
                </Text>
                <Heading as="h1" style={{ color: '#ffffff', fontSize: 20, fontWeight: 700, margin: '2px 0 0' }}>
                  {title}
                </Heading>
              </Column>
            </Row>
          </Section>

          {/* Body */}
          <Section style={{ padding: '24px' }}>
            {greeting ? (
              <Text style={{ fontSize: 15, color: '#0f172a', margin: '0 0 16px' }}>{greeting}</Text>
            ) : null}

            {/* TENANT-EDITABLE: opening message */}
            {opening ? (
              <Text style={{ fontSize: 14, lineHeight: '22px', color: '#334155', margin: '0 0 16px' }}>
                {opening}
              </Text>
            ) : null}

            {paragraphs.map((p, i) => (
              <Text key={i} style={{ fontSize: 14, lineHeight: '22px', color: '#334155', margin: '0 0 16px' }}>
                {p}
              </Text>
            ))}

            {/* SYSTEM-CONTROLLED: required fields table */}
            {details && details.length > 0 ? (
              <Section style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 16px', margin: '0 0 20px' }}>
                {details.map((d, i) => (
                  <Row key={i}>
                    <Column style={{ padding: '10px 0', borderBottom: i < details.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <Text style={{ fontSize: 12, color: '#64748b', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {d.label}
                      </Text>
                    </Column>
                    <Column style={{ padding: '10px 0', textAlign: 'right', borderBottom: i < details.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <Text style={{ fontSize: 14, fontWeight: d.strong ? 700 : 500, color: d.strong ? accent : '#0f172a', margin: 0 }}>
                        {d.value}
                      </Text>
                    </Column>
                  </Row>
                ))}
              </Section>
            ) : null}

            {/* TENANT-EDITABLE: optional note, highlighted */}
            {notes ? (
              <Section style={{ backgroundColor: '#f8fafc', borderLeft: `3px solid ${accent}`, borderRadius: 4, padding: '12px 16px', margin: '0 0 20px' }}>
                <Text style={{ fontSize: 13, lineHeight: '20px', color: '#475569', margin: 0 }}>{notes}</Text>
              </Section>
            ) : null}

            {ctaLabel && ctaUrl ? (
              <Button
                href={ctaUrl}
                style={{ backgroundColor: primary, color: '#ffffff', padding: '12px 24px', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}
              >
                {ctaLabel}
              </Button>
            ) : null}

            {/* TENANT-EDITABLE: closing message */}
            {closing ? (
              <Text style={{ fontSize: 14, lineHeight: '22px', color: '#334155', margin: '20px 0 0' }}>
                {closing}
              </Text>
            ) : null}
          </Section>

          <Hr style={{ borderColor: '#e2e8f0', margin: 0 }} />

          {/* SYSTEM-CONTROLLED: footer with tenant contact + PayFlow attribution */}
          <Section style={{ padding: '16px 24px', backgroundColor: '#f8fafc' }}>
            {/* TENANT-EDITABLE: help / contact message */}
            {help ? (
              <Text style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px', fontStyle: 'italic' }}>
                {help}
              </Text>
            ) : null}
            <Text style={{ fontSize: 12, color: '#64748b', margin: '0 0 4px' }}>
              {branding.legalName || branding.companyName}
            </Text>
            {(branding.address || branding.phone || branding.supportEmail) ? (
              <Text style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 4px' }}>
                {[branding.address, branding.phone, branding.supportEmail].filter(Boolean).join('  •  ')}
              </Text>
            ) : null}
            {branding.website ? (
              <Text style={{ fontSize: 11, margin: '0 0 8px' }}>
                <Link href={branding.website} style={{ color: '#64748b' }}>
                  {branding.website.replace(/^https?:\/\//, '')}
                </Link>
              </Text>
            ) : null}

            {!branding.whiteLabelEnabled ? (
              <Text style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0' }}>
                Secure payment workflow powered by{' '}
                <Link href="https://payflow.app" style={{ color: '#64748b', fontWeight: 600 }}>
                  PayFlow
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default NotificationEmail
