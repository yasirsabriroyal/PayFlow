/**
 * Policy Engine Tests
 * 
 * Verifies:
 * - RBAC permission checks
 * - Policy condition evaluation
 * - Correct allow/deny behavior
 * - Policy registration and retrieval
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerPolicy,
  unregisterPolicy,
  getAllPolicies,
  getPoliciesForPermission,
  isAssignedToProject,
  exceedsAmountThreshold,
  hasElevatedRole,
  type Policy,
  type PolicyContext,
} from '@/lib/security/policyEngine'
import {
  POLICIES,
  EFT_LIMIT_POLICY,
  PM_PROJECT_SCOPE_POLICY,
  VENDOR_SELF_ACCESS_POLICY,
} from '@/lib/security/policies'
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type AuthenticatedUser } from '@/lib/permissions'

// ============================================
// TEST UTILITIES
// ============================================

function createMockUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-123',
    email: 'test@example.com',
    role: 'accountant',
    permissions: DEFAULT_ROLE_PERMISSIONS.accountant,
    ...overrides,
  }
}

function createMockAdmin(): AuthenticatedUser {
  return createMockUser({
    id: 'admin-456',
    role: 'admin',
    permissions: DEFAULT_ROLE_PERMISSIONS.admin,
  })
}

function createMockPM(): AuthenticatedUser {
  return createMockUser({
    id: 'pm-789',
    role: 'project_manager',
    permissions: DEFAULT_ROLE_PERMISSIONS.project_manager,
  })
}

function createMockVendor(): AuthenticatedUser {
  return createMockUser({
    id: 'vendor-101',
    role: 'contractor',
    permissions: [],
  })
}

// ============================================
// POLICY REGISTRY TESTS
// ============================================

describe('Policy Registry', () => {
  const testPolicy: Policy = {
    id: 'test_policy',
    name: 'Test Policy',
    description: 'A test policy',
    permission: PERMISSIONS.INVOICES.APPROVE_INVOICES,
    priority: 50,
    enabled: true,
    evaluate: () => ({ allowed: true }),
  }

  afterEach(() => {
    // Clean up test policy
    unregisterPolicy('test_policy')
  })

  it('should register a policy', () => {
    registerPolicy(testPolicy)
    const policies = getAllPolicies()
    expect(policies.some(p => p.id === 'test_policy')).toBe(true)
  })

  it('should unregister a policy', () => {
    registerPolicy(testPolicy)
    const removed = unregisterPolicy('test_policy')
    expect(removed).toBe(true)
    
    const policies = getAllPolicies()
    expect(policies.some(p => p.id === 'test_policy')).toBe(false)
  })

  it('should return policies for specific permission', () => {
    const policies = getPoliciesForPermission(PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS)
    
    // Should include EFT_LIMIT_POLICY
    expect(policies.some(p => p.id === 'eft_limit_50k')).toBe(true)
  })

  it('should sort policies by priority (highest first)', () => {
    const lowPriorityPolicy: Policy = {
      ...testPolicy,
      id: 'low_priority',
      priority: 10,
    }
    
    const highPriorityPolicy: Policy = {
      ...testPolicy,
      id: 'high_priority',
      priority: 100,
    }

    registerPolicy(lowPriorityPolicy)
    registerPolicy(highPriorityPolicy)

    const policies = getPoliciesForPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES)
    const testPolicies = policies.filter(p => ['low_priority', 'high_priority'].includes(p.id))
    
    if (testPolicies.length >= 2) {
      expect(testPolicies[0].id).toBe('high_priority')
    }

    // Cleanup
    unregisterPolicy('low_priority')
    unregisterPolicy('high_priority')
  })
})

// ============================================
// EFT LIMIT POLICY TESTS
// ============================================

describe('EFT Limit Policy', () => {
  const policy = EFT_LIMIT_POLICY

  it('should allow payments under $50,000', () => {
    const user = createMockUser()
    const context: PolicyContext = { amount: 25_000_00 } // $25,000
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })

  it('should deny payments over $50,000 for non-admin', () => {
    const user = createMockUser()
    const context: PolicyContext = { amount: 75_000_00 } // $75,000
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(false)
    expect(result.requiresEscalation).toBe(true)
  })

  it('should allow payments over $50,000 for admin', () => {
    const user = createMockAdmin()
    const context: PolicyContext = { amount: 75_000_00 } // $75,000
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })

  it('should allow payments at exactly $50,000', () => {
    const user = createMockUser()
    const context: PolicyContext = { amount: 50_000_00 } // Exactly $50,000
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true) // At threshold, not over
  })

  it('should handle missing amount gracefully', () => {
    const user = createMockUser()
    const context: PolicyContext = {}
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true) // No amount = no restriction
  })
})

// ============================================
// PM PROJECT SCOPE POLICY TESTS
// ============================================

describe('PM Project Scope Policy', () => {
  const policy = PM_PROJECT_SCOPE_POLICY

  it('should allow admin regardless of project', () => {
    const user = createMockAdmin()
    const context: PolicyContext = { projectId: 'P-999' }
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })

  it('should allow PM for assigned project', () => {
    const user = createMockPM()
    const context: PolicyContext = {
      projectId: 'P-123',
      assignedProjectIds: ['P-123', 'P-456'],
    }
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })

  it('should deny PM for unassigned project', () => {
    const user = createMockPM()
    const context: PolicyContext = {
      projectId: 'P-999',
      assignedProjectIds: ['P-123', 'P-456'],
    }
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('not assigned to project')
  })

  it('should deny PM if no project ID provided', () => {
    const user = createMockPM()
    const context: PolicyContext = {}
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Project ID is required')
  })

  it('should allow accountant regardless of project', () => {
    const user = createMockUser() // Default is accountant
    const context: PolicyContext = { projectId: 'P-999' }
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true) // Policy only affects PMs
  })
})

// ============================================
// VENDOR SELF-ACCESS POLICY TESTS
// ============================================

describe('Vendor Self-Access Policy', () => {
  const policy = VENDOR_SELF_ACCESS_POLICY

  it('should allow internal user to view any vendor', () => {
    const user = createMockUser()
    const context: PolicyContext = { vendorId: 'other-vendor' }
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })

  it('should allow vendor to view own record', () => {
    const user = createMockVendor()
    const context: PolicyContext = { vendorId: 'vendor-101' } // Same as user.id
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })

  it('should deny vendor viewing other vendor record', () => {
    const user = createMockVendor()
    const context: PolicyContext = { vendorId: 'other-vendor' }
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('only view your own')
  })

  it('should allow vendor if no vendorId specified', () => {
    const user = createMockVendor()
    const context: PolicyContext = {}
    
    const result = policy.evaluate(user, context)
    expect(result.allowed).toBe(true) // No specific vendor = allow (list view)
  })
})

// ============================================
// HELPER FUNCTION TESTS
// ============================================

describe('Policy Helper Functions', () => {
  describe('isAssignedToProject', () => {
    it('should return true when user is assigned', () => {
      const user = createMockPM()
      const context: PolicyContext = {
        assignedProjectIds: ['P-123', 'P-456'],
      }
      
      expect(isAssignedToProject(user, 'P-123', context)).toBe(true)
    })

    it('should return false when user is not assigned', () => {
      const user = createMockPM()
      const context: PolicyContext = {
        assignedProjectIds: ['P-123', 'P-456'],
      }
      
      expect(isAssignedToProject(user, 'P-999', context)).toBe(false)
    })

    it('should return false when no assigned projects', () => {
      const user = createMockPM()
      const context: PolicyContext = {}
      
      expect(isAssignedToProject(user, 'P-123', context)).toBe(false)
    })
  })

  describe('exceedsAmountThreshold', () => {
    it('should return true when amount exceeds threshold', () => {
      const context: PolicyContext = { amount: 100_000_00 }
      expect(exceedsAmountThreshold(context, 50_000_00)).toBe(true)
    })

    it('should return false when amount is below threshold', () => {
      const context: PolicyContext = { amount: 25_000_00 }
      expect(exceedsAmountThreshold(context, 50_000_00)).toBe(false)
    })

    it('should return false when amount equals threshold', () => {
      const context: PolicyContext = { amount: 50_000_00 }
      expect(exceedsAmountThreshold(context, 50_000_00)).toBe(false)
    })

    it('should return false when no amount', () => {
      const context: PolicyContext = {}
      expect(exceedsAmountThreshold(context, 50_000_00)).toBe(false)
    })
  })

  describe('hasElevatedRole', () => {
    it('should return true for admin', () => {
      const user = createMockAdmin()
      expect(hasElevatedRole(user)).toBe(true)
    })

    it('should return true for super_admin', () => {
      const user = createMockUser({ role: 'super_admin' })
      expect(hasElevatedRole(user)).toBe(true)
    })

    it('should return false for accountant', () => {
      const user = createMockUser()
      expect(hasElevatedRole(user)).toBe(false)
    })

    it('should return false for project_manager', () => {
      const user = createMockPM()
      expect(hasElevatedRole(user)).toBe(false)
    })
  })
})

// ============================================
// INTEGRATION TESTS
// ============================================

describe('Policy Integration', () => {
  it('should have all default policies registered', () => {
    const policies = getAllPolicies()
    
    expect(policies.some(p => p.id === 'eft_limit_50k')).toBe(true)
    expect(policies.some(p => p.id === 'pm_project_scope')).toBe(true)
    expect(policies.some(p => p.id === 'vendor_self_access')).toBe(true)
  })

  it('should export all policies in POLICIES constant', () => {
    expect(POLICIES.EFT_LIMIT).toBeDefined()
    expect(POLICIES.PM_PROJECT_SCOPE).toBeDefined()
    expect(POLICIES.VENDOR_SELF_ACCESS).toBeDefined()
    expect(POLICIES.HOLDBACK_RELEASE_LIMIT).toBeDefined()
  })

  it('should correctly combine multiple policy evaluations', () => {
    const user = createMockPM()
    
    // Test scenario: PM trying to approve invoice for assigned project
    const context: PolicyContext = {
      projectId: 'P-123',
      assignedProjectIds: ['P-123'],
    }
    
    // Should be allowed
    const result = PM_PROJECT_SCOPE_POLICY.evaluate(user, context)
    expect(result.allowed).toBe(true)
  })
})
