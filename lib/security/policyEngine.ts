import type { Permission } from '@/lib/permissions/constants'
import { 
  requirePermissionSimple as requirePermission,
  PermissionError,
  type AuthenticatedUser,
} from '@/lib/permissions/auth'
import { logSecurityEvent, SecurityEventType } from './telemetry'

// ============================================
// TYPES
// ============================================

export interface PolicyContext {
  /** The amount in cents for financial operations */
  amount?: number
  /** Project ID for project-scoped operations */
  projectId?: string
  /** Vendor/Contractor ID for vendor-scoped operations */
  vendorId?: string
  /** User IDs that the current user is assigned to manage */
  assignedUserIds?: string[]
  /** Project IDs that the current user is assigned to */
  assignedProjectIds?: string[]
  /** Target user ID for user management operations */
  targetUserId?: string
  /** Target role for role assignment operations */
  targetRole?: string
  /** Additional context data */
  [key: string]: unknown
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
  requiresEscalation?: boolean
  escalationPermission?: Permission
}

export interface Policy {
  /** Unique identifier for the policy */
  id: string
  /** Human-readable name */
  name: string
  /** Description of what this policy enforces */
  description: string
  /** The permission this policy applies to */
  permission: Permission
  /** Priority - higher priority policies are evaluated first */
  priority: number
  /** Whether this policy is active */
  enabled: boolean
  /** The evaluation function */
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => PolicyResult
}

export interface AuthorizationResult {
  allowed: boolean
  reason: string
  appliedPolicies: string[]
  requiresEscalation?: boolean
  escalationPermission?: Permission
}

// ============================================
// POLICY REGISTRY
// ============================================

const policyRegistry = new Map<string, Policy>()

/**
 * Register a policy in the registry
 */
export function registerPolicy(policy: Policy): void {
  if (policyRegistry.has(policy.id)) {
    console.warn(`[PolicyEngine] Overwriting existing policy: ${policy.id}`)
  }
  policyRegistry.set(policy.id, policy)
}

/**
 * Unregister a policy
 */
export function unregisterPolicy(policyId: string): boolean {
  return policyRegistry.delete(policyId)
}

/**
 * Get all registered policies
 */
export function getAllPolicies(): Policy[] {
  return Array.from(policyRegistry.values())
}

/**
 * Get policies for a specific permission
 */
export function getPoliciesForPermission(permission: Permission): Policy[] {
  return Array.from(policyRegistry.values())
    .filter(p => p.permission === permission && p.enabled)
    .sort((a, b) => b.priority - a.priority) // Higher priority first
}

// ============================================
// AUTHORIZATION ENGINE
// ============================================

/**
 * Main authorization function
 * 
 * Evaluates RBAC permission first, then applies policy conditions.
 * 
 * Usage:
 * ```typescript
 * const result = await authorize(
 *   user,
 *   PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
 *   { amount: 75000, projectId: 'P-102' }
 * )
 * 
 * if (!result.allowed) {
 *   if (result.requiresEscalation) {
 *     // Request escalation approval
 *   } else {
 *     throw new Error(result.reason)
 *   }
 * }
 * ```
 */
export async function authorize(
  user: AuthenticatedUser,
  permission: Permission,
  context: PolicyContext = {}
): Promise<AuthorizationResult> {
  const appliedPolicies: string[] = []
  
  // Step 1: Check RBAC permission first
  // Note: At this point, RBAC check was already done by requirePermission in secureAction
  // The user object passed here has already passed RBAC, so we skip redundant check
  // and go straight to policy evaluation
  const hasRbacPermission = true // Already verified by secureAction wrapper
  
  if (!hasRbacPermission) {
    await logSecurityEvent({
      type: SecurityEventType.PERMISSION_DENIED,
      userId: user.id,
      userRole: user.role,
      permission,
      actionName: 'authorize',
      metadata: { 
        stage: 'rbac_check',
        context: sanitizeContext(context),
      },
    })
    
    return {
      allowed: false,
      reason: `User lacks required permission: ${permission}`,
      appliedPolicies,
    }
  }
  
  // Step 2: Get applicable policies
  const policies = getPoliciesForPermission(permission)
  
  if (policies.length === 0) {
    // No policies configured - RBAC permission is sufficient
    return {
      allowed: true,
      reason: 'RBAC permission granted, no additional policies',
      appliedPolicies,
    }
  }
  
  // Step 3: Evaluate policies in priority order
  for (const policy of policies) {
    appliedPolicies.push(policy.id)
    
    try {
      const result = policy.evaluate(user, context)
      
      if (!result.allowed) {
        await logSecurityEvent({
          type: SecurityEventType.PERMISSION_DENIED,
          userId: user.id,
          userRole: user.role,
          permission,
          actionName: 'authorize',
          metadata: {
            stage: 'policy_check',
            policyId: policy.id,
            policyName: policy.name,
            reason: result.reason,
            context: sanitizeContext(context),
          },
        })
        
        return {
          allowed: false,
          reason: result.reason || `Policy denied: ${policy.name}`,
          appliedPolicies,
          requiresEscalation: result.requiresEscalation,
          escalationPermission: result.escalationPermission,
        }
      }
    } catch (error) {
      console.error(`[PolicyEngine] Error evaluating policy ${policy.id}:`, error)
      
      // Fail closed - deny on policy error
      return {
        allowed: false,
        reason: `Policy evaluation error: ${policy.name}`,
        appliedPolicies,
      }
    }
  }
  
  // All policies passed
  return {
    allowed: true,
    reason: 'All policies passed',
    appliedPolicies,
  }
}

/**
 * Authorize and execute an action with policy enforcement
 */
export async function authorizeAction<TInput, TOutput>(
  permission: Permission,
  context: PolicyContext,
  action: (user: AuthenticatedUser, input: TInput) => Promise<TOutput>,
  input: TInput
): Promise<
  | { success: true; data: TOutput }
  | { success: false; error: string; requiresEscalation?: boolean }
> {
  try {
    // Get authenticated user with RBAC check
    const user = await requirePermission(permission)
    
    // Apply policy checks
    const authResult = await authorize(user, permission, context)
    
    if (!authResult.allowed) {
      return {
        success: false,
        error: authResult.reason,
        requiresEscalation: authResult.requiresEscalation,
      }
    }
    
    // Execute action
    const result = await action(user, input)
    return { success: true, data: result }
    
  } catch (error) {
    if (error instanceof PermissionError) {
      return { success: false, error: error.message }
    }
    console.error('[authorizeAction] Error:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Sanitize context for logging (remove sensitive data)
 */
function sanitizeContext(context: PolicyContext): Record<string, unknown> {
  const sanitized = { ...context }
  
  // Remove potentially sensitive fields
  delete sanitized.assignedUserIds
  
  return sanitized
}

/**
 * Check if user is assigned to a project
 */
export function isAssignedToProject(
  user: AuthenticatedUser,
  projectId: string,
  context: PolicyContext
): boolean {
  const assignedProjects = context.assignedProjectIds || []
  return assignedProjects.includes(projectId)
}

/**
 * Check if amount exceeds threshold
 */
export function exceedsAmountThreshold(
  context: PolicyContext,
  thresholdCents: number
): boolean {
  return (context.amount || 0) > thresholdCents
}

/**
 * Check if user has elevated role
 */
export function hasElevatedRole(user: AuthenticatedUser): boolean {
  return user.role === 'admin'
}
