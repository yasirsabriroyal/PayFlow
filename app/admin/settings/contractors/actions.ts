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

export interface ContractorSubcategory {
  id: string
  organization_id: string
  category_id: string
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

export interface SubcategoryActionResult {
  success: boolean
  error?: string
  subcategory?: ContractorSubcategory
}

export interface GetCategoriesResult {
  success: boolean
  error?: string
  categories: ContractorCategory[]
}

export interface GetSubcategoriesResult {
  success: boolean
  error?: string
  subcategories: ContractorSubcategory[]
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

function revalidateAll() {
  revalidatePath('/admin/settings/contractors/categories')
  revalidatePath('/admin/contractors/new')
  revalidatePath('/admin/contractors')
  revalidatePath('/pm/contractors/new')
}

// =============================================
// READ CATEGORIES — PUBLIC
// =============================================

/**
 * Returns active contractor categories for the current org, sorted A-Z.
 * No permission gate — any authenticated user filling a contractor form may call this.
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
 * Sorted: active A-Z first, then inactive A-Z.
 */
export async function getAllContractorCategories(): Promise<GetCategoriesResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const { data, error } = await supabase
      .from('contractor_categories')
      .select('*')
      .eq('organization_id', orgId)
      .order('is_active', { ascending: false }) // active first
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, categories: (data ?? []) as ContractorCategory[] }
  }) as Promise<GetCategoriesResult>
}

// =============================================
// READ SUBCATEGORIES — PUBLIC
// =============================================

/**
 * Returns active subcategories for a given category, sorted A-Z.
 * No permission gate — used in all contractor forms.
 */
export async function getContractorSubcategories(
  categoryId: string
): Promise<GetSubcategoriesResult> {
  try {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('contractor_subcategories')
      .select('*')
      .eq('category_id', categoryId)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, subcategories: (data ?? []) as ContractorSubcategory[] }
  } catch (err) {
    console.error('[contractor-subcategories] getContractorSubcategories error:', err)
    return { success: false, error: 'Failed to load subcategories.', subcategories: [] }
  }
}

/**
 * Returns ALL subcategories for a category (active + inactive) for the admin UI.
 * Sorted: active A-Z, then inactive A-Z.
 */
export async function getAllContractorSubcategories(
  categoryId: string
): Promise<GetSubcategoriesResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('contractor_subcategories')
      .select('*')
      .eq('category_id', categoryId)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, subcategories: (data ?? []) as ContractorSubcategory[] }
  }) as Promise<GetSubcategoriesResult>
}

// =============================================
// CREATE CATEGORY
// =============================================

export async function createContractorCategory(input: {
  name: string
  description?: string
}): Promise<CategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const name = normalizeName(input.name)
    if (!name) return { success: false, error: 'Category name is required.' }
    if (name.length > 80) return { success: false, error: 'Category name must be 80 characters or fewer.' }

    const slug = toSlug(name)

    const { data: existing } = await supabase
      .from('contractor_categories')
      .select('id, is_active')
      .eq('organization_id', orgId)
      .ilike('name', name)
      .limit(1)
      .single()

    if (existing) {
      const status = existing.is_active
        ? 'already exists'
        : 'already exists but is deactivated — reactivate it instead'
      return { success: false, error: `A category named "${name}" ${status}.` }
    }

    const { data, error } = await supabase
      .from('contractor_categories')
      .insert({
        organization_id: orgId,
        name,
        slug,
        description: input.description?.trim() || null,
        display_order: 0,
        is_active: true,
        created_by: userData?.id ?? null,
        updated_by: userData?.id ?? null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: `A category named "${name}" already exists.` }
      throw error
    }

    revalidateAll()
    return { success: true, category: data as ContractorCategory }
  }) as Promise<CategoryActionResult>
}

// =============================================
// UPDATE CATEGORY
// =============================================

export async function updateContractorCategory(
  id: string,
  input: { name?: string; description?: string }
): Promise<CategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const updates: Record<string, unknown> = { updated_by: userData?.id ?? null }

    if (input.name !== undefined) {
      const name = normalizeName(input.name)
      if (!name) return { success: false, error: 'Category name is required.' }
      if (name.length > 80) return { success: false, error: 'Category name must be 80 characters or fewer.' }

      const { data: existing } = await supabase
        .from('contractor_categories')
        .select('id')
        .eq('organization_id', orgId)
        .ilike('name', name)
        .neq('id', id)
        .limit(1)
        .single()

      if (existing) return { success: false, error: `A category named "${name}" already exists.` }

      updates.name = name
      updates.slug = toSlug(name)
    }

    if (input.description !== undefined) {
      updates.description = input.description.trim() || null
    }

    const { data, error } = await supabase
      .from('contractor_categories')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: 'A category with that name already exists.' }
      throw error
    }

    revalidateAll()
    return { success: true, category: data as ContractorCategory }
  }) as Promise<CategoryActionResult>
}

// =============================================
// TOGGLE CATEGORY ACTIVE
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
      .update({ is_active: isActive, updated_by: userData?.id ?? null })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) throw error

    revalidateAll()
    return { success: true, category: data as ContractorCategory }
  }) as Promise<CategoryActionResult>
}

// =============================================
// CREATE SUBCATEGORY
// =============================================

export async function createContractorSubcategory(input: {
  category_id: string
  name: string
  description?: string
}): Promise<SubcategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const name = normalizeName(input.name)
    if (!name) return { success: false, error: 'Subcategory name is required.' }
    if (name.length > 80) return { success: false, error: 'Subcategory name must be 80 characters or fewer.' }

    const slug = toSlug(name)

    // Duplicate check within same category
    const { data: existing } = await supabase
      .from('contractor_subcategories')
      .select('id, is_active')
      .eq('category_id', input.category_id)
      .ilike('name', name)
      .limit(1)
      .single()

    if (existing) {
      const status = existing.is_active
        ? 'already exists under this category'
        : 'already exists but is deactivated — reactivate it instead'
      return { success: false, error: `A subcategory named "${name}" ${status}.` }
    }

    const { data, error } = await supabase
      .from('contractor_subcategories')
      .insert({
        organization_id: orgId,
        category_id: input.category_id,
        name,
        slug,
        description: input.description?.trim() || null,
        display_order: 0,
        is_active: true,
        created_by: userData?.id ?? null,
        updated_by: userData?.id ?? null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: `A subcategory named "${name}" already exists under this category.` }
      throw error
    }

    revalidateAll()
    return { success: true, subcategory: data as ContractorSubcategory }
  }) as Promise<SubcategoryActionResult>
}

// =============================================
// UPDATE SUBCATEGORY
// =============================================

export async function updateContractorSubcategory(
  id: string,
  input: { name?: string; description?: string }
): Promise<SubcategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()

    const updates: Record<string, unknown> = { updated_by: userData?.id ?? null }

    if (input.name !== undefined) {
      const name = normalizeName(input.name)
      if (!name) return { success: false, error: 'Subcategory name is required.' }
      if (name.length > 80) return { success: false, error: 'Subcategory name must be 80 characters or fewer.' }

      // Get category_id for the duplicate check
      const { data: existing_sub } = await supabase
        .from('contractor_subcategories')
        .select('category_id')
        .eq('id', id)
        .single()

      if (existing_sub) {
        const { data: duplicate } = await supabase
          .from('contractor_subcategories')
          .select('id')
          .eq('category_id', existing_sub.category_id)
          .ilike('name', name)
          .neq('id', id)
          .limit(1)
          .single()

        if (duplicate) return { success: false, error: `A subcategory named "${name}" already exists under this category.` }
      }

      updates.name = name
      updates.slug = toSlug(name)
    }

    if (input.description !== undefined) {
      updates.description = input.description.trim() || null
    }

    const { data, error } = await supabase
      .from('contractor_subcategories')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: 'A subcategory with that name already exists under this category.' }
      throw error
    }

    revalidateAll()
    return { success: true, subcategory: data as ContractorSubcategory }
  }) as Promise<SubcategoryActionResult>
}

// =============================================
// TOGGLE SUBCATEGORY ACTIVE
// =============================================

export async function toggleContractorSubcategoryActive(
  id: string,
  isActive: boolean
): Promise<SubcategoryActionResult> {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('contractor_subcategories')
      .update({ is_active: isActive, updated_by: userData?.id ?? null })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    revalidateAll()
    return { success: true, subcategory: data as ContractorSubcategory }
  }) as Promise<SubcategoryActionResult>
}

// =============================================
// REORDER (kept for future drag-and-drop)
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
    revalidateAll()
    return { success: true }
  }) as Promise<{ success: boolean; error?: string }>
}
