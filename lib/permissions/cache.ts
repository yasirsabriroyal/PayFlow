import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Permission Cache Layer
 * 
 * Provides in-memory caching for role-permission mappings to reduce
 * database lookups during authorization checks.
 * 
 * Features:
 * - TTL-based expiration (default: 5 minutes)
 * - Automatic cache invalidation on permission updates
 * - Fallback to DB on cache miss
 * - Role-specific and permission-specific caching
 */

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes default
const CACHE_MAX_ENTRIES = 100 // Maximum cache entries to prevent memory bloat

// Cache entry structure
interface CacheEntry<T> {
  data: T
  expiresAt: number
  createdAt: number
}

// Permission matrix: role -> set of permission keys
type PermissionMatrix = Map<string, Set<string>>

// Cache store - module-level singleton
let permissionMatrixCache: CacheEntry<PermissionMatrix> | null = null
const rolePermissionsCache: Map<string, CacheEntry<string[]>> = new Map()

// Cache statistics for monitoring
let cacheStats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
  lastRefresh: 0,
}

/**
 * Check if a cache entry is still valid
 */
function isValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  if (!entry) return false
  return Date.now() < entry.expiresAt
}

/**
 * Create a new cache entry with TTL
 */
function createEntry<T>(data: T, ttlMs: number = CACHE_TTL_MS): CacheEntry<T> {
  const now = Date.now()
  return {
    data,
    createdAt: now,
    expiresAt: now + ttlMs,
  }
}

/**
 * Get the full permission matrix from cache or database
 */
export async function getPermissionMatrix(): Promise<PermissionMatrix> {
  // Check cache first
  if (isValid(permissionMatrixCache)) {
    cacheStats.hits++
    return permissionMatrixCache.data
  }

  cacheStats.misses++
  
  // Cache miss - load from database
  const supabase = getSupabaseAdmin()
  
  // Query actual schema: role_permissions has 'role' and 'permission' columns (varchar)
  const { data: rolePermissions, error } = await supabase
    .from('role_permissions')
    .select('role, permission')

  if (error) {
    console.error('[PermissionCache] Failed to load permission matrix:', error)
    // Return empty matrix on error - fail secure
    return new Map()
  }

  // Build the permission matrix
  const matrix: PermissionMatrix = new Map()
  
  for (const rp of rolePermissions || []) {
    const roleName = rp.role
    const permissionKey = rp.permission
    
    if (roleName && permissionKey) {
      if (!matrix.has(roleName)) {
        matrix.set(roleName, new Set())
      }
      matrix.get(roleName)!.add(permissionKey)
    }
  }

  // Store in cache
  permissionMatrixCache = createEntry(matrix)
  cacheStats.lastRefresh = Date.now()
  
  return matrix
}

/**
 * Get permissions for a specific role from cache
 */
export async function getRolePermissions(roleName: string): Promise<string[]> {
  // Check role-specific cache first
  const roleEntry = rolePermissionsCache.get(roleName)
  if (isValid(roleEntry)) {
    cacheStats.hits++
    return roleEntry.data
  }

  // Try to get from matrix cache
  const matrix = await getPermissionMatrix()
  const permissions = matrix.get(roleName)
  
  if (permissions) {
    const permissionArray = Array.from(permissions)
    
    // Store in role-specific cache
    rolePermissionsCache.set(roleName, createEntry(permissionArray))
    
    // Trim cache if too large
    if (rolePermissionsCache.size > CACHE_MAX_ENTRIES) {
      const oldestKey = rolePermissionsCache.keys().next().value
      if (oldestKey) rolePermissionsCache.delete(oldestKey)
    }
    
    return permissionArray
  }
  
  return []
}

/**
 * Check if a role has a specific permission (cached)
 */
export async function hasPermissionCached(roleName: string, permissionKey: string): Promise<boolean> {
  const matrix = await getPermissionMatrix()
  const rolePermissions = matrix.get(roleName)
  
  if (!rolePermissions) {
    return false
  }
  
  return rolePermissions.has(permissionKey)
}

/**
 * Invalidate all permission caches
 * Call this when permissions are updated
 */
export function invalidatePermissionCache(): void {
  permissionMatrixCache = null
  rolePermissionsCache.clear()
  cacheStats.invalidations++
  
  console.log('[PermissionCache] Cache invalidated')
}

/**
 * Invalidate cache for a specific role
 */
export function invalidateRoleCache(roleName: string): void {
  rolePermissionsCache.delete(roleName)
  // Also invalidate matrix since it contains role data
  permissionMatrixCache = null
  cacheStats.invalidations++
  
  console.log(`[PermissionCache] Cache invalidated for role: ${roleName}`)
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): {
  hits: number
  misses: number
  invalidations: number
  hitRate: number
  lastRefresh: number
  matrixCached: boolean
  roleCacheSize: number
} {
  const total = cacheStats.hits + cacheStats.misses
  return {
    ...cacheStats,
    hitRate: total > 0 ? cacheStats.hits / total : 0,
    matrixCached: isValid(permissionMatrixCache),
    roleCacheSize: rolePermissionsCache.size,
  }
}

/**
 * Reset cache statistics (useful for testing)
 */
export function resetCacheStats(): void {
  cacheStats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
    lastRefresh: 0,
  }
}

/**
 * Warm the cache by preloading the permission matrix
 * Call this on server startup if desired
 */
export async function warmCache(): Promise<void> {
  console.log('[PermissionCache] Warming cache...')
  await getPermissionMatrix()
  console.log('[PermissionCache] Cache warmed')
}

/**
 * Force refresh the cache from database
 */
export async function refreshCache(): Promise<void> {
  invalidatePermissionCache()
  await getPermissionMatrix()
}
