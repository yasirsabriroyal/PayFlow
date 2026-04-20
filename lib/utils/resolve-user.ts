import { SupabaseClient } from '@supabase/supabase-js'

export async function resolveInternalUserId(
  authUserId: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single()

  if (error || !data) return null
  return data.id
}
