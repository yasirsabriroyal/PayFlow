'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId } from '@/lib/tenancy'
import { withPermission, PERMISSIONS } from '@/lib/permissions'

// =============================================
// TYPES
// =============================================

export interface ContractorCategory {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface CategoryActionResult {
  success: boolean
  error?: string
  category?: ContractorCategory
}

export interface GetCategoriesResult {
  success: boolean
  error?: string
  categories: ContractorCategory[]
}

// =============================================
// HELPERS
// =============================================

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

// =============================================
// READ — PUBLIC (all authenticated users need this for forms)
// =============================================

/**
 * Returns active contractor categories for the current org, sorted by display_order.
 * Used in all contractor forms (admin, PM, vendor).
 * No permission gate — any authenticated user filling out a contractor form may call this.
 */
export async function getContractorCategories(): Promise<GetCategoriesResult> {
  try {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const { data, error } = await supabase
      .from('contractor_categories')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, categories: (data ?? []) as ContractorCategory[] }
  } catch (err) {
    console.error('[contractor-categories] getContractorCategories error:', err)
    return { success: false, error: 'Failed to load categories.', categories: [] }
  }
}

/**
 * Returns ALL categories (active + inactive) for the admin management UI.
 * Requires: MANAGE_USERS (administration permission — same gate used for settings pages).
 */
export async function getAllContractorCategories(): Promise<GetCategoriesResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const { data, error } = await supabase
      .from('contractor_categories')
      .select('*')
      .eq('organization_id', orgId)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, categories: (data ?? []) as ContractorCategory[] }
  }) as Promise<GetCategoriesResult>
}

// =============================================
// CREATE
// =============================================

export async function createContractorCategory(input: {
  name: string
  description?: string
  display_order?: number
}): Promise<CategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const name = normalizeName(input.name)
    if (!name) return { success: false, error: 'Category name is required.' }
    if (name.length > 80) return { success: false, error: 'Category name must be 80 characters or fewer.' }

    const slug = toSlug(name)

    // Duplicate check (case-insensitive)
    const { data: existing } = await supabase
      .from('contractor_categories')
      .select('id, is_active')
      .eq('organization_id', orgId)
      .ilike('name', name)
      .limit(1)
      .single()

    if (existing) {
      const status = existing.is_active ? 'already exists' : 'already exists but is deactivated — reactivate it instead'
      return { success: false, error: `A category named "${name}" ${status}.` }
    }

    const { data, error } = await supabase
      .from('contractor_categories')
      .insert({
        organization_id: orgId,
        name,
        slug,
        description: input.description?.trim() || null,
        display_order: input.display_order ?? 0,
        is_active: true,
        created_by: userData?.id ?? null,
        updated_by: userData?.id ?? null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: `A category named "${name}" already exists.` }
      }
      throw error
    }

    revalidatePath('/admin/settings/contractors/categories')
    revalidatePath('/admin/contractors/new')
    revalidatePath('/pm/contractors/new')

    return { success: true, category: data as ContractorCategory }
  }) as Promise<CategoryActionResult>
}

// =============================================
// UPDATE
// =============================================

export async function updateContractorCategory(
  id: string,
  input: {
    name?: string
    description?: string
    display_order?: number
  }
): Promise<CategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const updates: Record<string, unknown> = {
      updated_by: userData?.id ?? null,
    }

    if (input.name !== undefined) {
      const name = normalizeName(input.name)
      if (!name) return { success: false, error: 'Category name is required.' }
      if (name.length > 80) return { success: false, error: 'Category name must be 80 characters or fewer.' }

      // Duplicate check excluding self
      const { data: existing } = await supabase
        .from('contractor_categories')
        .select('id')
        .eq('organization_id', orgId)
        .ilike('name', name)
        .neq('id', id)
        .limit(1)
        .single()

      if (existing) {
        return { success: false, error: `A category named "${name}" already exists.` }
      }

      updates.name = name
      updates.slug = toSlug(name)
    }

    if (input.description !== undefined) {
      updates.description = input.description.trim() || null
    }

    if (input.display_order !== undefined) {
      updates.display_order = input.display_order
    }

    const { data, error } = await supabase
      .from('contractor_categories')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A category with that name already exists.' }
      }
      throw error
    }

    revalidatePath('/admin/settings/contractors/categories')
    revalidatePath('/admin/contractors/new')
    revalidatePath('/pm/contractors/new')

    return { success: true, category: data as ContractorCategory }
  }) as Promise<CategoryActionResult>
}

// =============================================
// TOGGLE ACTIVE / DEACTIVATE
// =============================================

export async function toggleContractorCategoryActive(
  id: string,
  isActive: boolean
): Promise<CategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const { data, error } = await supabase
      .from('contractor_categories')
      .update({
        is_active: isActive,
        updated_by: userData?.id ?? null,
      })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) throw error

    revalidatePath('/admin/settings/contractors/categories')
    revalidatePath('/admin/contractors/new')
    revalidatePath('/pm/contractors/new')

    return { success: true, category: data as ContractorCategory }
  }) as Promise<CategoryActionResult>
}

// =============================================
// REORDER
// =============================================

export async function reorderContractorCategories(
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const updates = orderedIds.map((id, index) =>
      supabase
        .from('contractor_categories')
        .update({ display_order: index + 1, updated_by: userData?.id ?? null })
        .eq('id', id)
        .eq('organization_id', orgId)
    )

    await Promise.all(updates)

    revalidatePath('/admin/settings/contractors/categories')

    return { success: true }
  }) as Promise<{ success: boolean; error?: string }>
}
