import { headers } from 'next/headers'
import type { Permission } from '@/lib/permissions/constants'
import { 
  requirePermissionSimple as requirePermission, 
  PermissionError,
  type AuthenticatedUser,
} from '@/lib/permissions/auth'
import { logSecurityEvent, SecurityEventType } from './telemetry'
import { 
  checkRateLimit, 
  incrementRateLimit, 
  type RateLimitConfig,
  RATE_LIMITS,
} from './rateLimit'
import { 
  authorize, 
  type PolicyContext,
} from './policyEngine'

// ============================================
// TYPED ACTION RESULT
// ============================================

export type ActionResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code?: string; retryAfterSeconds?: number }

// ============================================
// SECURE ACTION WRAPPER
// ============================================

export interface SecureActionOptions {
  /** The permission required to execute this action */
  permission: Permission
  /** Optional action name for logging (defaults to function name) */
  actionName?: string
  /** Module name for categorization */
  module?: string
  /** Whether this is a critical/sensitive action (logs extra details) */
  isCritical?: boolean
  /** Custom error message for unauthorized access */
  unauthorizedMessage?: string
  /** Rate limit configuration (optional) */
  rateLimit?: RateLimitConfig
  /** Policy context generator (optional) - receives input and returns context for policy evaluation */
  getPolicyContext?: (input: unknown) => PolicyContext
}

/**
 * Enterprise-grade secure action wrapper
 * 
 * Features:
 * - Automatic user authentication
 * - Permission enforcement via requirePermission()
 * - Security telemetry for all access attempts
 * - Standardized error responses
 * - Request metadata capture
 * 
 * Usage:
 * ```ts
 * export const createVendor = secureAction(
 *   PERMISSIONS.VENDORS.CREATE_VENDORS,
 *   async (user, input: CreateVendorInput) => {
 *     // Your action logic here
 *     return { vendorId: '...' }
 *   }
 * )
 * ```
 */
export function secureAction<TInput, TOutput>(
  permission: Permission,
  action: (user: AuthenticatedUser, input: TInput) => Promise<TOutput>,
  options?: Partial<Omit<SecureActionOptions, 'permission'>>
): (input: TInput) => Promise<ActionResult<TOutput>> {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const actionName = options?.actionName || action.name || 'unknown_action'
    const moduleName = options?.module || 'unknown'
    const startTime = Date.now()
    
    // Get request metadata for logging
    const requestMetadata = await getRequestMetadata()
    
    try {
      // Step 1: Authenticate and authorize via RBAC
      const user = await requirePermission(permission)
      
      // Step 2: Check rate limit (if configured)
      if (options?.rateLimit) {
        const rateLimitResult = checkRateLimit(user.id, options.rateLimit)
        
        if (!rateLimitResult.allowed) {
          await logSecurityEvent({
            type: SecurityEventType.RATE_LIMIT_EXCEEDED,
            userId: user.id,
            userRole: user.role,
            permission,
            actionName,
            metadata: {
              ...requestMetadata,
              module: moduleName,
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
            },
          })
          
          return {
            success: false,
            error: `Rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`,
            code: 'RATE_LIMITED',
            retryAfterSeconds: rateLimitResult.retryAfterSeconds,
          }
        }
        
        // Increment rate limit counter
        incrementRateLimit(user.id, options.rateLimit)
      }
      
      // Step 3: Apply policy checks (if configured)
      if (options?.getPolicyContext) {
        const policyContext = options.getPolicyContext(input)
        const authResult = await authorize(user, permission, policyContext)
        
        if (!authResult.allowed) {
          await logSecurityEvent({
            type: SecurityEventType.PERMISSION_DENIED,
            userId: user.id,
            userRole: user.role,
            permission,
            actionName,
            metadata: {
              ...requestMetadata,
              module: moduleName,
              stage: 'policy_check',
              reason: authResult.reason,
              appliedPolicies: authResult.appliedPolicies,
            },
          })
          
          return {
            success: false,
            error: authResult.reason,
            code: authResult.requiresEscalation ? 'ESCALATION_REQUIRED' : 'POLICY_DENIED',
          }
        }
      }
      
      // Log successful authorization for critical actions
      if (options?.isCritical) {
        await logSecurityEvent({
          type: SecurityEventType.PERMISSION_GRANTED,
          userId: user.id,
          userRole: user.role,
          permission,
          actionName,
          metadata: {
            ...requestMetadata,
            module: moduleName,
            inputSummary: summarizeInput(input),
          },
        })
      }
      
      // Step 4: Execute the action
      const result = await action(user, input)
      
      return { success: true, data: result }
    } catch (error) {
      // Handle permission errors
      if (error instanceof PermissionError) {
        // Log unauthorized attempt
        await logSecurityEvent({
          type: SecurityEventType.PERMISSION_DENIED,
          userId: requestMetadata.userId,
          userRole: requestMetadata.userRole,
          permission,
          actionName,
          metadata: {
            ...requestMetadata,
            errorMessage: error.message,
            duration: Date.now() - startTime,
          },
        })
        
        return {
          success: false,
          error: options?.unauthorizedMessage || error.message,
          code: 'FORBIDDEN',
        }
      }
      
      // Handle authentication errors
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        await logSecurityEvent({
          type: SecurityEventType.AUTH_FAILURE,
          userId: undefined,
          userRole: undefined,
          permission,
          actionName,
          metadata: {
            ...requestMetadata,
            errorMessage: error.message,
          },
        })
        
        return {
          success: false,
          error: 'Authentication required',
          code: 'UNAUTHORIZED',
        }
      }
      
      // Handle unexpected errors
      console.error(`[secureAction] Error in ${actionName}:`, error)

      await logSecurityEvent({
        type: SecurityEventType.ACTION_ERROR,
        userId: requestMetadata.userId,
        userRole: requestMetadata.userRole,
        permission,
        actionName,
        metadata: {
          ...requestMetadata,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          duration: Date.now() - startTime,
        },
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
      }
    }
  }
}

/**
 * Secure action for critical operations (always logs)
 */
export function secureCriticalAction<TInput, TOutput>(
  permission: Permission,
  action: (user: AuthenticatedUser, input: TInput) => Promise<TOutput>,
  actionName?: string
): (input: TInput) => Promise<ActionResult<TOutput>> {
  return secureAction(permission, action, { 
    isCritical: true, 
    actionName,
  })
}

/**
 * Secure action that requires any of multiple permissions
 */
export function secureActionAny<TInput, TOutput>(
  permissions: Permission[],
  action: (user: AuthenticatedUser, input: TInput) => Promise<TOutput>,
  options?: Partial<Omit<SecureActionOptions, 'permission'>>
): (input: TInput) => Promise<ActionResult<TOutput>> {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const actionName = options?.actionName || action.name || 'unknown_action'
    const requestMetadata = await getRequestMetadata()
    
    // Try each permission until one succeeds
    let lastError: PermissionError | null = null
    
    for (const permission of permissions) {
      try {
        const user = await requirePermission(permission)
        
        if (options?.isCritical) {
          await logSecurityEvent({
            type: SecurityEventType.PERMISSION_GRANTED,
            userId: user.id,
            userRole: user.role,
            permission,
            actionName,
            metadata: requestMetadata,
          })
        }
        
        const result = await action(user, input)
        return { success: true, data: result }
      } catch (error) {
        if (error instanceof PermissionError) {
          lastError = error
          continue
        }
        throw error
      }
    }
    
    // All permissions failed
    await logSecurityEvent({
      type: SecurityEventType.PERMISSION_DENIED,
      userId: requestMetadata.userId,
      userRole: requestMetadata.userRole,
      permission: permissions.join(' | '),
      actionName,
      metadata: {
        ...requestMetadata,
        errorMessage: lastError?.message || 'Missing required permissions',
      },
    })
    
    return {
      success: false,
      error: options?.unauthorizedMessage || 'Missing required permissions',
      code: 'FORBIDDEN',
    }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

interface RequestMetadata {
  [key: string]: unknown
  ip?: string
  userAgent?: string
  referer?: string
  timestamp: string
  userId?: string
  userRole?: string
}

async function getRequestMetadata(): Promise<RequestMetadata> {
  try {
    const headersList = await headers()
    
    return {
      ip: headersList.get('x-forwarded-for') || 
          headersList.get('x-real-ip') || 
          'unknown',
      userAgent: headersList.get('user-agent') || undefined,
      referer: headersList.get('referer') || undefined,
      timestamp: new Date().toISOString(),
    }
  } catch {
    return {
      timestamp: new Date().toISOString(),
    }
  }
}

function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) {
    return 'none'
  }
  
  if (typeof input === 'object') {
    const keys = Object.keys(input as object)
    return `object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`
  }
  
  return typeof input
}

// Re-export rate limits for convenience
export { RATE_LIMITS } from './rateLimit'
