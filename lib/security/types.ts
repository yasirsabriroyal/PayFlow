/**
 * Security Module — Shared types and enums.
 *
 * Intentionally free of 'use server' so these can be safely imported by
 * client components, server actions, and non-server modules alike.
 * The 'use server' file (telemetry.ts) imports from here.
 */

// ============================================
// SECURITY EVENT TYPES
// ============================================

export enum SecurityEventType {
  /** User successfully passed permission check */
  PERMISSION_GRANTED = 'permission_granted',
  /** User was denied access due to missing permission */
  PERMISSION_DENIED = 'permission_denied',
  /** User failed authentication */
  AUTH_FAILURE = 'auth_failure',
  /** Error occurred during action execution */
  ACTION_ERROR = 'action_error',
  /** Permission matrix was modified */
  PERMISSIONS_MODIFIED = 'permissions_modified',
  /** Suspicious activity detected */
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  /** Admin lockout protection triggered */
  LOCKOUT_PROTECTION = 'lockout_protection',
  /** Rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
}

// ============================================
// SECURITY EVENT INTERFACES
// ============================================

export interface SecurityEvent {
  type: SecurityEventType
  userId?: string
  userRole?: string
  permission?: string
  actionName?: string
  metadata?: Record<string, unknown>
}

export interface SecurityEventRecord extends SecurityEvent {
  id: string
  created_at: string
}
