import { 
  registerPolicy, 
  type Policy,
  type PolicyContext,
  isAssignedToProject,
  exceedsAmountThreshold,
  hasElevatedRole,
} from './policyEngine'
import { PERMISSIONS, type Permission } from '@/lib/permissions/constants'
import { type AuthenticatedUser } from '@/lib/permissions/auth'

// ============================================
// FINANCIAL POLICIES
// ============================================

/**
 * EFT Limit Policy
 * 
 * Payments above $50,000 require admin role or elevated permission.
 */
export const EFT_LIMIT_POLICY: Policy = {
  id: 'eft_limit_50k',
  name: 'EFT Amount Limit',
  description: 'Payments above $50,000 require admin approval',
  permission: PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
  priority: 100,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    const THRESHOLD_CENTS = 50_000_00 // $50,000 in cents
    
    if (exceedsAmountThreshold(context, THRESHOLD_CENTS)) {
      if (hasElevatedRole(user)) {
        return { allowed: true }
      }
      
      return {
        allowed: false,
        reason: `EFT payments above $50,000 require admin approval. Amount: $${((context.amount || 0) / 100).toLocaleString()}`,
        requiresEscalation: true,
        escalationPermission: PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
      }
    }
    
    return { allowed: true }
  },
}

/**
 * Holdback Release Limit Policy
 * 
 * Holdback releases above $25,000 require admin role.
 */
export const HOLDBACK_RELEASE_LIMIT_POLICY: Policy = {
  id: 'holdback_release_limit_25k',
  name: 'Holdback Release Limit',
  description: 'Holdback releases above $25,000 require admin approval',
  permission: PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS,
  priority: 100,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    const THRESHOLD_CENTS = 25_000_00 // $25,000 in cents
    
    if (exceedsAmountThreshold(context, THRESHOLD_CENTS)) {
      if (hasElevatedRole(user)) {
        return { allowed: true }
      }
      
      return {
        allowed: false,
        reason: `Holdback releases above $25,000 require admin approval. Amount: $${((context.amount || 0) / 100).toLocaleString()}`,
        requiresEscalation: true,
      }
    }
    
    return { allowed: true }
  },
}

// ============================================
// PROJECT SCOPE POLICIES
// ============================================

/**
 * PM Project Scope Policy
 * 
 * Project managers can only approve invoices for their assigned projects.
 */
export const PM_PROJECT_SCOPE_POLICY: Policy = {
  id: 'pm_project_scope',
  name: 'PM Project Scope',
  description: 'Project managers can only approve invoices within assigned projects',
  permission: PERMISSIONS.INVOICES.APPROVE_INVOICES,
  priority: 90,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    // Admins bypass project scope restriction
    if (hasElevatedRole(user)) {
      return { allowed: true }
    }
    
    // Only enforce for project_manager role
    if (user.role !== 'project_manager') {
      return { allowed: true }
    }
    
    // Check if project ID is provided
    if (!context.projectId) {
      return {
        allowed: false,
        reason: 'Project ID is required for invoice approval',
      }
    }
    
    // Check if user is assigned to the project
    if (!isAssignedToProject(user, context.projectId, context)) {
      return {
        allowed: false,
        reason: `You are not assigned to project ${context.projectId}`,
      }
    }
    
    return { allowed: true }
  },
}

/**
 * PM Reject Invoice Scope Policy
 * 
 * Project managers can only reject invoices for their assigned projects.
 * Mirrors PM_PROJECT_SCOPE_POLICY but for REJECT_INVOICES permission.
 */
export const PM_REJECT_INVOICE_SCOPE_POLICY: Policy = {
  id: 'pm_reject_invoice_scope',
  name: 'PM Reject Invoice Scope',
  description: 'Project managers can only reject invoices within assigned projects',
  permission: PERMISSIONS.INVOICES.REJECT_INVOICES,
  priority: 90,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    // Admins bypass project scope restriction
    if (hasElevatedRole(user)) {
      return { allowed: true }
    }
    
    // Only enforce for project_manager role
    if (user.role !== 'project_manager') {
      return { allowed: true }
    }
    
    // Check if project ID is provided
    if (!context.projectId) {
      return {
        allowed: false,
        reason: 'Project ID is required for invoice rejection',
      }
    }
    
    // Check if user is assigned to the project
    if (!isAssignedToProject(user, context.projectId, context)) {
      return {
        allowed: false,
        reason: `You are not assigned to project ${context.projectId}`,
      }
    }
    
    return { allowed: true }
  },
}

/**
 * PM Payment Certificate Scope Policy
 * 
 * Project managers can only create payment certificates for their assigned projects.
 */
export const PM_PAYMENT_CERTIFICATE_SCOPE_POLICY: Policy = {
  id: 'pm_payment_certificate_scope',
  name: 'PM Payment Certificate Scope',
  description: 'Project managers can only create payment certificates within assigned projects',
  permission: PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE,
  priority: 90,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    // Admins bypass project scope restriction
    if (hasElevatedRole(user)) {
      return { allowed: true }
    }
    
    // Only enforce for project_manager role
    if (user.role !== 'project_manager') {
      return { allowed: true }
    }
    
    // Check if project ID is provided
    if (!context.projectId) {
      return {
        allowed: false,
        reason: 'Project ID is required for payment certificate creation',
      }
    }
    
    // Check if user is assigned to the project
    if (!isAssignedToProject(user, context.projectId, context)) {
      return {
        allowed: false,
        reason: `You are not assigned to project ${context.projectId}`,
      }
    }
    
    return { allowed: true }
  },
}

/**
 * Accountant Project Scope Policy (optional)
 * 
 * When enabled, accountants can only process payments for assigned projects.
 */
export const ACCOUNTANT_PROJECT_SCOPE_POLICY: Policy = {
  id: 'accountant_project_scope',
  name: 'Accountant Project Scope',
  description: 'Accountants can only execute EFT for assigned projects',
  permission: PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
  priority: 80,
  enabled: false, // Disabled by default - enable for stricter control
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    if (hasElevatedRole(user)) {
      return { allowed: true }
    }
    
    if (user.role !== 'accountant') {
      return { allowed: true }
    }
    
    if (!context.projectId) {
      return { allowed: true } // No project scope if not provided
    }
    
    if (!isAssignedToProject(user, context.projectId, context)) {
      return {
        allowed: false,
        reason: `You are not assigned to project ${context.projectId}`,
      }
    }
    
    return { allowed: true }
  },
}

// ============================================
// VENDOR SCOPE POLICIES
// ============================================

/**
 * Vendor Self-Access Policy
 * 
 * Vendors can only view their own records.
 */
export const VENDOR_SELF_ACCESS_POLICY: Policy = {
  id: 'vendor_self_access',
  name: 'Vendor Self Access',
  description: 'Vendors can only view their own records',
  permission: PERMISSIONS.VENDORS.VIEW_VENDORS,
  priority: 100,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    // Internal users can view all vendors
    if (user.role !== 'contractor') {
      return { allowed: true }
    }
    
    // Vendors can only view their own record
    if (context.vendorId && context.vendorId !== user.id) {
      return {
        allowed: false,
        reason: 'You can only view your own vendor record',
      }
    }
    
    return { allowed: true }
  },
}

// ============================================
// USER MANAGEMENT POLICIES
// ============================================

/**
 * Self-Role Modification Policy
 * 
 * Users cannot modify their own role.
 */
export const SELF_ROLE_MODIFICATION_POLICY: Policy = {
  id: 'self_role_modification',
  name: 'Self Role Modification Prevention',
  description: 'Users cannot modify their own role',
  permission: PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  priority: 100,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    const targetUserId = context.targetUserId
    
    if (targetUserId === user.id) {
      return {
        allowed: false,
        reason: 'You cannot modify your own user role',
      }
    }
    
    return { allowed: true }
  },
}

/**
 * Admin Role Assignment Policy
 * 
 * Only super_admin can assign admin role.
 */
export const ADMIN_ROLE_ASSIGNMENT_POLICY: Policy = {
  id: 'admin_role_assignment',
  name: 'Admin Role Assignment',
  description: 'Only super admins can assign admin role',
  permission: PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  priority: 95,
  enabled: true,
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    const targetRole = context.targetRole
    
    if (targetRole === 'admin') {
      if (user.role !== 'admin') {
        return {
          allowed: false,
          reason: 'Only super administrators can assign admin roles',
        }
      }
    }
    
    return { allowed: true }
  },
}

// ============================================
// TIME-BASED POLICIES
// ============================================

/**
 * Business Hours Policy
 * 
 * High-value EFT payments can only be executed during business hours.
 */
export const BUSINESS_HOURS_EFT_POLICY: Policy = {
  id: 'business_hours_eft',
  name: 'Business Hours EFT',
  description: 'High-value EFT payments restricted to business hours (Mon-Fri, 8am-6pm ET)',
  permission: PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
  priority: 70,
  enabled: false, // Disabled by default
  evaluate: (user: AuthenticatedUser, context: PolicyContext) => {
    const THRESHOLD_CENTS = 100_000_00 // $100,000
    
    // Only apply to high-value payments
    if (!exceedsAmountThreshold(context, THRESHOLD_CENTS)) {
      return { allowed: true }
    }
    
    // Admins bypass time restriction
    if (hasElevatedRole(user)) {
      return { allowed: true }
    }
    
    const now = new Date()
    const hour = now.getHours()
    const day = now.getDay()
    
    // Check if weekend (0 = Sunday, 6 = Saturday)
    if (day === 0 || day === 6) {
      return {
        allowed: false,
        reason: 'High-value EFT payments cannot be executed on weekends',
      }
    }
    
    // Check if outside business hours (8am - 6pm)
    if (hour < 8 || hour >= 18) {
      return {
        allowed: false,
        reason: 'High-value EFT payments can only be executed during business hours (8am-6pm)',
      }
    }
    
    return { allowed: true }
  },
}

// ============================================
// POLICY REGISTRATION
// ============================================

/**
 * Register all default policies
 */
export function registerDefaultPolicies(): void {
  // Financial policies
  registerPolicy(EFT_LIMIT_POLICY)
  registerPolicy(HOLDBACK_RELEASE_LIMIT_POLICY)
  
  // Project scope policies
  registerPolicy(PM_PROJECT_SCOPE_POLICY)
  registerPolicy(PM_REJECT_INVOICE_SCOPE_POLICY)
  registerPolicy(PM_PAYMENT_CERTIFICATE_SCOPE_POLICY)
  registerPolicy(ACCOUNTANT_PROJECT_SCOPE_POLICY)
  
  // Vendor policies
  registerPolicy(VENDOR_SELF_ACCESS_POLICY)
  
  // User management policies
  registerPolicy(SELF_ROLE_MODIFICATION_POLICY)
  registerPolicy(ADMIN_ROLE_ASSIGNMENT_POLICY)
  
  // Time-based policies
  registerPolicy(BUSINESS_HOURS_EFT_POLICY)
  
  console.log('[PolicyEngine] Registered default policies')
}

// Auto-register policies when module is loaded
registerDefaultPolicies()

// ============================================
// EXPORTS
// ============================================

export const POLICIES = {
  EFT_LIMIT: EFT_LIMIT_POLICY,
  HOLDBACK_RELEASE_LIMIT: HOLDBACK_RELEASE_LIMIT_POLICY,
  PM_PROJECT_SCOPE: PM_PROJECT_SCOPE_POLICY,
  PM_REJECT_INVOICE_SCOPE: PM_REJECT_INVOICE_SCOPE_POLICY,
  PM_PAYMENT_CERTIFICATE_SCOPE: PM_PAYMENT_CERTIFICATE_SCOPE_POLICY,
  ACCOUNTANT_PROJECT_SCOPE: ACCOUNTANT_PROJECT_SCOPE_POLICY,
  VENDOR_SELF_ACCESS: VENDOR_SELF_ACCESS_POLICY,
  SELF_ROLE_MODIFICATION: SELF_ROLE_MODIFICATION_POLICY,
  ADMIN_ROLE_ASSIGNMENT: ADMIN_ROLE_ASSIGNMENT_POLICY,
  BUSINESS_HOURS_EFT: BUSINESS_HOURS_EFT_POLICY,
} as const
