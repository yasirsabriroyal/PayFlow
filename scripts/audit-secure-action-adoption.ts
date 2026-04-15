#!/usr/bin/env npx ts-node
/**
 * Secure Action Adoption Audit
 * 
 * Audits server actions to verify adoption of the enterprise secureAction wrapper.
 * Reports which actions use the new pattern vs the legacy pattern.
 * 
 * Usage: npx ts-node scripts/audit-secure-action-adoption.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================
// CONFIGURATION
// ============================================

const PROJECT_ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(PROJECT_ROOT, 'app')

// Patterns for the new enterprise wrapper
const ENTERPRISE_PATTERNS = {
  secureAction: /export\s+const\s+(\w+)\s*=\s*secureAction\s*\(/g,
  secureCriticalAction: /export\s+const\s+(\w+)\s*=\s*secureCriticalAction\s*\(/g,
  secureActionAny: /export\s+const\s+(\w+)\s*=\s*secureActionAny\s*\(/g,
}

// Patterns for legacy patterns (still valid but not enterprise-grade)
const LEGACY_PATTERNS = {
  withPermission: /export\s+async\s+function\s+(\w+).*\n.*withPermission\s*\(/g,
  requirePermission: /export\s+async\s+function\s+(\w+).*\n.*requirePermission\s*\(/g,
  guardedAction: /export\s+async\s+function\s+(\w+).*\n.*guardedAction\s*\(/g,
}

// Pattern for unprotected functions (potential violations)
const UNPROTECTED_EXPORT = /export\s+async\s+function\s+(\w+)\s*\(/g

// Skip these files/directories
const SKIP_PATTERNS = [
  /node_modules/,
  /\.next/,
  /\.git/,
  /__tests__/,
  /\.test\./,
  /\.spec\./,
]

// ============================================
// TYPES
// ============================================

interface ActionInfo {
  name: string
  file: string
  pattern: 'enterprise' | 'legacy' | 'unprotected'
  patternType: string
  hasRateLimit: boolean
  hasPolicyContext: boolean
  isCritical: boolean
  module: string
}

interface AuditResult {
  enterpriseActions: ActionInfo[]
  legacyActions: ActionInfo[]
  unprotectedActions: ActionInfo[]
  summary: {
    total: number
    enterprise: number
    legacy: number
    unprotected: number
    adoptionRate: number
    criticalActions: number
    rateLimitedActions: number
  }
}

// ============================================
// SCANNER FUNCTIONS
// ============================================

function shouldSkipFile(filePath: string): boolean {
  return SKIP_PATTERNS.some(pattern => pattern.test(filePath))
}

function getAllActionFiles(dir: string): string[] {
  const files: string[] = []
  
  if (!fs.existsSync(dir)) {
    return files
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    
    if (shouldSkipFile(fullPath)) {
      continue
    }
    
    if (entry.isDirectory()) {
      files.push(...getAllActionFiles(fullPath))
    } else if (entry.name === 'actions.ts' || entry.name === 'actions.tsx') {
      files.push(fullPath)
    }
  }
  
  return files
}

function extractModule(filePath: string): string {
  const relativePath = path.relative(APP_DIR, filePath)
  const parts = relativePath.split(path.sep)
  return parts.slice(0, -1).join('/')
}

function analyzeActionFile(filePath: string): ActionInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const actions: ActionInfo[] = []
  const module = extractModule(filePath)
  
  // Track found action names to avoid duplicates
  const foundActions = new Set<string>()
  
  // Check for enterprise patterns
  for (const [patternType, pattern] of Object.entries(ENTERPRISE_PATTERNS)) {
    // Reset regex
    pattern.lastIndex = 0
    let match
    
    while ((match = pattern.exec(content)) !== null) {
      const actionName = match[1]
      if (!foundActions.has(actionName)) {
        foundActions.add(actionName)
        
        // Look for options in the action definition
        const actionStart = match.index
        const actionSection = content.slice(actionStart, actionStart + 1000)
        
        actions.push({
          name: actionName,
          file: filePath,
          pattern: 'enterprise',
          patternType,
          hasRateLimit: /rateLimit:\s*RATE_LIMITS\./.test(actionSection),
          hasPolicyContext: /getPolicyContext:/.test(actionSection),
          isCritical: /isCritical:\s*true/.test(actionSection),
          module,
        })
      }
    }
  }
  
  // Check for legacy patterns
  for (const [patternType, pattern] of Object.entries(LEGACY_PATTERNS)) {
    pattern.lastIndex = 0
    let match
    
    while ((match = pattern.exec(content)) !== null) {
      const actionName = match[1]
      if (!foundActions.has(actionName)) {
        foundActions.add(actionName)
        actions.push({
          name: actionName,
          file: filePath,
          pattern: 'legacy',
          patternType,
          hasRateLimit: false,
          hasPolicyContext: false,
          isCritical: false,
          module,
        })
      }
    }
  }
  
  // Check for unprotected exports
  UNPROTECTED_EXPORT.lastIndex = 0
  let match
  
  while ((match = UNPROTECTED_EXPORT.exec(content)) !== null) {
    const actionName = match[1]
    if (!foundActions.has(actionName)) {
      // This is an exported function that doesn't use any protection pattern
      foundActions.add(actionName)
      actions.push({
        name: actionName,
        file: filePath,
        pattern: 'unprotected',
        patternType: 'none',
        hasRateLimit: false,
        hasPolicyContext: false,
        isCritical: false,
        module,
      })
    }
  }
  
  return actions
}

function runAudit(): AuditResult {
  const actionFiles = getAllActionFiles(APP_DIR)
  
  const enterpriseActions: ActionInfo[] = []
  const legacyActions: ActionInfo[] = []
  const unprotectedActions: ActionInfo[] = []
  
  for (const file of actionFiles) {
    const actions = analyzeActionFile(file)
    
    for (const action of actions) {
      switch (action.pattern) {
        case 'enterprise':
          enterpriseActions.push(action)
          break
        case 'legacy':
          legacyActions.push(action)
          break
        case 'unprotected':
          unprotectedActions.push(action)
          break
      }
    }
  }
  
  const total = enterpriseActions.length + legacyActions.length + unprotectedActions.length
  const adoptionRate = total > 0 
    ? Math.round((enterpriseActions.length / total) * 100) 
    : 0
  
  return {
    enterpriseActions,
    legacyActions,
    unprotectedActions,
    summary: {
      total,
      enterprise: enterpriseActions.length,
      legacy: legacyActions.length,
      unprotected: unprotectedActions.length,
      adoptionRate,
      criticalActions: enterpriseActions.filter(a => a.isCritical).length,
      rateLimitedActions: enterpriseActions.filter(a => a.hasRateLimit).length,
    },
  }
}

// ============================================
// REPORT GENERATION
// ============================================

function printReport(result: AuditResult): void {
  console.log('\n' + '='.repeat(60))
  console.log('  SECURE ACTION ADOPTION AUDIT REPORT')
  console.log('='.repeat(60))
  
  // Summary
  console.log('\n📊 SUMMARY')
  console.log('-'.repeat(40))
  console.log(`Total Actions:        ${result.summary.total}`)
  console.log(`Enterprise Pattern:   ${result.summary.enterprise} (${result.summary.adoptionRate}%)`)
  console.log(`Legacy Pattern:       ${result.summary.legacy}`)
  console.log(`Unprotected:          ${result.summary.unprotected}`)
  console.log(`Critical Actions:     ${result.summary.criticalActions}`)
  console.log(`Rate Limited Actions: ${result.summary.rateLimitedActions}`)
  
  // Enterprise Actions
  if (result.enterpriseActions.length > 0) {
    console.log('\n✅ ENTERPRISE ACTIONS (secureAction)')
    console.log('-'.repeat(40))
    for (const action of result.enterpriseActions) {
      const flags = []
      if (action.hasRateLimit) flags.push('RL')
      if (action.hasPolicyContext) flags.push('POLICY')
      if (action.isCritical) flags.push('CRITICAL')
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
      console.log(`  ${action.module}/${action.name}${flagStr}`)
    }
  }
  
  // Legacy Actions
  if (result.legacyActions.length > 0) {
    console.log('\n⚠️  LEGACY ACTIONS (needs migration)')
    console.log('-'.repeat(40))
    for (const action of result.legacyActions) {
      console.log(`  ${action.module}/${action.name} (${action.patternType})`)
    }
  }
  
  // Unprotected Actions
  if (result.unprotectedActions.length > 0) {
    console.log('\n❌ UNPROTECTED ACTIONS (CRITICAL)')
    console.log('-'.repeat(40))
    for (const action of result.unprotectedActions) {
      console.log(`  ${action.module}/${action.name}`)
    }
  }
  
  // Recommendations
  console.log('\n📋 RECOMMENDATIONS')
  console.log('-'.repeat(40))
  
  if (result.summary.unprotected > 0) {
    console.log(`  CRITICAL: ${result.summary.unprotected} unprotected actions need immediate attention`)
  }
  
  if (result.summary.legacy > 0) {
    console.log(`  Migrate ${result.summary.legacy} legacy actions to secureAction for:`)
    console.log('    - Rate limiting support')
    console.log('    - Policy engine integration')
    console.log('    - Enhanced security telemetry')
  }
  
  if (result.summary.adoptionRate === 100) {
    console.log('  All actions are using the enterprise secureAction pattern!')
  } else if (result.summary.adoptionRate >= 80) {
    console.log(`  Good progress! ${result.summary.adoptionRate}% adoption rate`)
  } else {
    console.log(`  Consider accelerating migration (${result.summary.adoptionRate}% adoption)`)
  }
  
  console.log('\n' + '='.repeat(60))
  console.log(`  Audit completed at ${new Date().toISOString()}`)
  console.log('='.repeat(60) + '\n')
}

// ============================================
// MAIN
// ============================================

const result = runAudit()
printReport(result)

// Exit with error code if there are unprotected actions
if (result.summary.unprotected > 0) {
  process.exit(1)
}
