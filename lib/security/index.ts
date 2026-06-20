/**
 * Security Module - Enterprise RBAC Hardening
 *
 * Centralized exports for all security-related functionality:
 * - secureAction: Unified server action wrapper with telemetry
 * - Security telemetry: Authorization event logging
 * - Type-safe permission utilities
 */

// Secure action wrapper
export {
  secureAction,
  secureActionAny,
  secureCriticalAction,
  type ActionResult,
  type SecureActionOptions,
} from './secureAction'

// Security telemetry (async functions only — no object/enum exports from 'use server' files)
export {
  logPermissionDenied,
  logPermissionsModified,
  logSecurityEvent,
  getRecentSecurityEvents,
} from './telemetry'

// Security types and enums (not 'use server' — safe to export as values)
export {
  SecurityEventType,
  type SecurityEvent,
  type SecurityEventRecord,
} from './types'

// Re-export core permission types and utilities for convenience
export {
  PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  type Permission,
  type UserRole,
  type PermissionsMatrix,
  isValidPermission,
  isValidRole,
} from '../permissions/constants'

// Re-export permission enforcement
export {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getCurrentUser,
  PermissionError,
} from '../permissions'

// AuthenticatedUser lives in auth.ts
export type { AuthenticatedUser } from '../permissions/auth'

// Rate limiting
export {
  withRateLimit,
  checkRateLimit,
  incrementRateLimit,
  rateLimitedAction,
  getRateLimitStats,
  clearRateLimitStore,
  RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitResult,
} from './rateLimit'

// Policy engine (PBAC)
export {
  authorize,
  authorizeAction,
  registerPolicy,
  unregisterPolicy,
  getAllPolicies,
  getPoliciesForPermission,
  isAssignedToProject,
  exceedsAmountThreshold,
  hasElevatedRole,
  type Policy,
  type PolicyContext,
  type PolicyResult,
  type AuthorizationResult,
} from './policyEngine'

// Policy registry
export {
  registerDefaultPolicies,
  POLICIES,
} from './policies'
