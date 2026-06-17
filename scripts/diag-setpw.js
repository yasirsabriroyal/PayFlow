const { createClient } = require('@supabase/supabase-js')

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const authUserId = 'e451e562-9b6b-43f0-9081-983775efffca'
  const tempPassword = 'PayflowDiag!2026'
  const { data, error } = await admin.auth.admin.updateUserById(authUserId, { password: tempPassword })
  if (error) { console.log('[v0] set-password FAILED:', error.message); process.exit(1) }
  console.log('[v0] password set for', data.user.email)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
