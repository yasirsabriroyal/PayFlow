import { getContractorInvitation } from './actions'
import { AcceptInviteForm } from './accept-invite-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, HardHat } from 'lucide-react'
import Link from 'next/link'

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const invitation = await getContractorInvitation(token || '')

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <HardHat className="w-6 h-6 text-accent-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl">Activate Your Portal Access</CardTitle>
          <CardDescription>
            {invitation.valid
              ? `Set a password to access the PayFlow vendor portal${invitation.companyName ? ` for ${invitation.companyName}` : ''}.`
              : 'Vendor portal invitation'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitation.valid && token ? (
            <AcceptInviteForm
              token={token}
              email={invitation.email || ''}
              contactName={invitation.contactName || ''}
            />
          ) : (
            <div className="space-y-4 py-4 text-center">
              <div className="flex items-start gap-2 bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20 text-left">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{invitation.error || 'This invitation link is invalid.'}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Please contact your PayFlow administrator to request a new invitation.
              </p>
              <Link href="/auth/login" className="text-sm text-primary hover:underline font-medium">
                Go to sign in
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
