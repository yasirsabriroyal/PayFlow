import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { getVendorProfile } from '@/lib/actions/vendor-profile'
import { ProfileForm } from './profile-form'

export default async function VendorProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { success, profile } = await getVendorProfile()

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Company Profile" />
      <RoleTabBar role="contractor" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Company Profile</h1>
          <p className="text-muted-foreground mt-1">
            Manage your company information, trade, and contact details.
          </p>
        </div>

        {success && profile ? (
          <ProfileForm profile={profile} />
        ) : (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <p className="font-medium">Profile not found</p>
            <p className="text-sm text-muted-foreground mt-1">
              We couldn&apos;t load your contractor profile. Please complete onboarding first.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
