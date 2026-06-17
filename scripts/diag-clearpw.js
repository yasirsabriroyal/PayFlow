const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const EMAIL = 'info@renobydesign.ca'

async function main() {
  // Find the user
  let userId = null
  let page = 1
  while (!userId) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const u = data.users.find((x) => x.email?.toLowerCase() === EMAIL)
    if (u) userId = u.id
    if (data.users.length < 200) break
    page++
  }
  if (!userId) {
    console.log('User not found:', EMAIL)
    return
  }

  // Set an unknown random password so the diagnostic password no longer works.
  const randomPw = crypto.randomBytes(24).toString('base64') + 'Aa1!'
  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: randomPw })
  if (pwErr) throw pwErr

  // Revoke all active sessions for this user.
  const { error: signOutErr } = await admin.auth.admin.signOut(userId, 'global')
  if (signOutErr) console.log('signOut warning:', signOutErr.message)

  console.log('Cleared diagnostic password and revoked sessions for', EMAIL)
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1) })
