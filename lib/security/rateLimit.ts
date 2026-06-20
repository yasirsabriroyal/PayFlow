import { headers } from 'next/headers'
import { logSecurityEvent } from './telemetry'
import { SecurityEventType } from './types'

// ============================================
// RATE LIMIT CONFIGURATION
// ============================================

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number
  /** Time window in seconds */
  windowSeconds: number
  /** Identifier for this limit (for logging) */
  name: string
  /** Whether to block or just warn on limit exceeded */
  mode: 'block' | 'warn'
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  retryAfterSeconds?: number
}

// Default rate limits for critical actions
export const RATE_LIMITS = {
  // Financial operations
  EXECUTE_EFT: {
    maxRequests: 10,
    windowSeconds: 60,
    name: 'execute_eft',
    mode: 'block' as const,
  },
  APPROVE_INVOICE: {
    maxRequests: 30,
    windowSeconds: 60,
    name: 'approve_invoice',
    mode: 'block' as const,
  },
  RELEASE_HOLDBACK: {
    maxRequests: 20,
    windowSeconds: 60,
    name: 'release_holdback',
    mode: 'block' as const,
  },
  
  // User management
  CREATE_USER: {
    maxRequests: 10,
    windowSeconds: 60,
    name: 'create_user',
    mode: 'block' as const,
  },
  MANAGE_USERS: {
    maxRequests: 10,
    windowSeconds: 60,
    name: 'manage_users',
    mode: 'block' as const,
  },
  MODIFY_PERMISSIONS: {
    maxRequests: 20,
    windowSeconds: 60,
    name: 'modify_permissions',
    mode: 'block' as const,
  },
  
  // Data export
  EXPORT_REPORT: {
    maxRequests: 5,
    windowSeconds: 60,
    name: 'export_report',
    mode: 'warn' as const,
  },
  
  // Vendor operations
  CREATE_VENDOR: {
    maxRequests: 20,
    windowSeconds: 60,
    name: 'create_vendor',
    mode: 'block' as const,
  },
} as const

// ============================================
// IN-MEMORY RATE LIMIT STORE
// ============================================

interface RateLimitEntry {
  count: number
  windowStart: number
  resetAt: number
}

// In-memory store (per-instance, not distributed)
// For production, consider Redis or similar
const rateLimitStore = new Map<string, RateLimitEntry>()

// Cleanup old entries periodically
const CLEANUP_INTERVAL = 60 * 1000 // 1 minute
let lastCleanup = Date.now()

function cleanupExpiredEntries() {
  const now = Date.now()
  
  if (now - lastCleanup < CLEANUP_INTERVAL) {
    return
  }
  
  lastCleanup = now
  
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}

// ============================================
// RATE LIMIT FUNCTIONS
// ============================================

/**
 * Get a unique key for rate limiting
 */
function getRateLimitKey(userId: string, limitName: string): string {
  return `ratelimit:${limitName}:${userId}`
}

/**
 * Check if a request is within rate limits
 */
export function checkRateLimit(
  userId: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanupExpiredEntries()
  
  const key = getRateLimitKey(userId, config.name)
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000
  
  let entry = rateLimitStore.get(key)
  
  // Create new entry if doesn't exist or window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      windowStart: now,
      resetAt: now + windowMs,
    }
    rateLimitStore.set(key, entry)
  }
  
  // Check if within limit
  const allowed = entry.count < config.maxRequests
  const remaining = Math.max(0, config.maxRequests - entry.count)
  const resetAt = new Date(entry.resetAt)
  const retryAfterSeconds = allowed ? undefined : Math.ceil((entry.resetAt - now) / 1000)
  
  return {
    allowed,
    remaining,
    resetAt,
    retryAfterSeconds,
  }
}

/**
 * Increment rate limit counter
 */
export function incrementRateLimit(
  userId: string,
  config: RateLimitConfig
): void {
  const key = getRateLimitKey(userId, config.name)
  const entry = rateLimitStore.get(key)
  
  if (entry) {
    entry.count++
    rateLimitStore.set(key, entry)
  }
}

/**
 * Rate limit wrapper for server actions
 * 
 * Usage:
 * ```ts
 * export async function executeEFT(params: EFTParams) {
 *   const rateLimitResult = await withRateLimit(userId, RATE_LIMITS.EXECUTE_EFT, async () => {
 *     // Your action logic
 *     return { success: true }
 *   })
 *   
 *   if (!rateLimitResult.success) {
 *     return { error: rateLimitResult.error }
 *   }
 *   
 *   return rateLimitResult.data
 * }
 * ```
 */
export async function withRateLimit<T>(
  userId: string,
  config: RateLimitConfig,
  action: () => Promise<T>
): Promise<
  | { success: true; data: T }
  | { success: false; error: string; retryAfterSeconds?: number }
> {
  // Get request metadata for logging
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || 'unknown'
  
  // Check rate limit
  const result = checkRateLimit(userId, config)
  
  if (!result.allowed) {
    // Log rate limit exceeded
    await logSecurityEvent({
      type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      userId,
      actionName: config.name,
      metadata: {
        ip,
        retryAfterSeconds: result.retryAfterSeconds,
        resetAt: result.resetAt.toISOString(),
      },
    })
    
    if (config.mode === 'block') {
      return {
        success: false,
        error: `Rate limit exceeded. Try again in ${result.retryAfterSeconds} seconds.`,
        retryAfterSeconds: result.retryAfterSeconds,
      }
    }
    
    // Warn mode - log but continue
    console.warn(
      `[RateLimit] Warning: Rate limit exceeded for ${config.name} by user ${userId}`
    )
  }
  
  // Increment counter before action
  incrementRateLimit(userId, config)
  
  try {
    const data = await action()
    return { success: true, data }
  } catch (error) {
    throw error
  }
}

/**
 * Rate-limited secure action wrapper
 * Combines secureAction with rate limiting
 */
export function rateLimitedAction<TInput, TOutput>(
  rateLimitConfig: RateLimitConfig,
  action: (userId: string, input: TInput) => Promise<TOutput>
): (userId: string, input: TInput) => Promise<
  | { success: true; data: TOutput }
  | { success: false; error: string; retryAfterSeconds?: number }
> {
  return async (userId: string, input: TInput) => {
    return withRateLimit(userId, rateLimitConfig, () => action(userId, input))
  }
}

// ============================================
// RATE LIMIT STATISTICS
// ============================================

export interface RateLimitStats {
  totalEntries: number
  entriesByLimit: Record<string, number>
}

export function getRateLimitStats(): RateLimitStats {
  const stats: RateLimitStats = {
    totalEntries: rateLimitStore.size,
    entriesByLimit: {},
  }
  
  for (const key of rateLimitStore.keys()) {
    const limitName = key.split(':')[1]
    stats.entriesByLimit[limitName] = (stats.entriesByLimit[limitName] || 0) + 1
  }
  
  return stats
}

/**
 * Clear all rate limit entries (for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear()
}
