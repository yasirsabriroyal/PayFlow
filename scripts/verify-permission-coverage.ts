#!/usr/bin/env npx ts-node
/**
 * Permission Coverage Scanner
 * 
 * Scans the codebase for RBAC violations:
 * - Server actions without secureAction or requirePermission
 * - Direct DB mutations without authorization guard
 * - Routes missing protectRoute()
 * 
 * Usage: npx ts-node scripts/verify-permission-coverage.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================
// CONFIGURATION
// ============================================

const PROJECT_ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(PROJECT_ROOT, 'app')
const LIB_DIR = path.join(PROJECT_ROOT, 'lib')

// Patterns that indicate protected actions
const PROTECTION_PATTERNS = [
  /requirePermission\s*\(/,
  /withPermission\s*\(/,
  /secureAction\s*\(/,
  /secureCriticalAction\s*\(/,
  /secureActionAny\s*\(/,
  /guardedAction\s*\(/,
  /guardedActionAny\s*\(/,
]

// Patterns that indicate route protection
const ROUTE_PROTECTION_PATTERNS = [
  /protectRoute\s*\(/,
  /requirePermission\s*\(/,
]

// Patterns that indicate server actions
const SERVER_ACTION_PATTERNS = [
  /'use server'/,
  /"use server"/,
]

// Patterns that indicate DB mutations
const DB_MUTATION_PATTERNS = [
  /\.insert\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /\.upsert\s*\(/,
  /getSupabaseAdmin\s*\(\)/,
]

// Files/directories to skip
const SKIP_PATTERNS = [
  /node_modules/,
  /\.next/,
  /\.git/,
  /scripts\/verify-permission-coverage\.ts$/,
  /__tests__/,
  /\.test\./,
  /\.spec\./,
]

// ============================================
// TYPES
// ============================================

interface Violation {
  file: string
  line: number
  type: 'unprotected_action' | 'unprotected_mutation' | 'unprotected_route'
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  code: string
}

interface ScanResult {
  violations: Violation[]
  scannedFiles: number
  protectedActions: number
  protectedRoutes: number
}

// ============================================
// SCANNER FUNCTIONS
// ============================================

function shouldSkipFile(filePath: string): boolean {
  return SKIP_PATTERNS.some(pattern => pattern.test(filePath))
}

function getAllFiles(dir: string, extension: string): string[] {
  const files: string[] = []
  
  if (!fs.existsSync(dir)) {
    return files
  }
  
  const items = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name)
    
    if (shouldSkipFile(fullPath)) {
      continue
    }
    
    if (item.isDirectory()) {
      files.push(...getAllFiles(fullPath, extension))
    } else if (item.name.endsWith(extension)) {
      files.push(fullPath)
    }
  }
  
  return files
}

function hasProtection(content: string): boolean {
  return PROTECTION_PATTERNS.some(pattern => pattern.test(content))
}

function hasRouteProtection(content: string): boolean {
  return ROUTE_PROTECTION_PATTERNS.some(pattern => pattern.test(content))
}

function isServerActionFile(content: string): boolean {
  return SERVER_ACTION_PATTERNS.some(pattern => pattern.test(content))
}

function hasDbMutation(content: string): boolean {
  return DB_MUTATION_PATTERNS.some(pattern => pattern.test(content))
}

function extractFunctionDefinitions(content: string): Array<{name: string, line: number, code: string}> {
  const functions: Array<{name: string, line: number, code: string}> = []
  const lines = content.split('\n')
  
  // Match: export async function name( or export function name(
  const exportFunctionRegex = /^export\s+(async\s+)?function\s+(\w+)\s*\(/
  
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(exportFunctionRegex)
    if (match) {
      // Get a few lines for context
      const codeContext = lines.slice(i, Math.min(i + 10, lines.length)).join('\n')
      functions.push({
        name: match[2],
        line: i + 1,
        code: codeContext,
      })
    }
  }
  
  return functions
}

function scanServerActions(files: string[]): Violation[] {
  const violations: Violation[] = []
  
  for (const file of files) {
    if (!file.includes('actions.ts') && !file.includes('actions.tsx')) {
      continue
    }
    
    const content = fs.readFileSync(file, 'utf-8')
    
    if (!isServerActionFile(content)) {
      continue
    }
    
    const functions = extractFunctionDefinitions(content)
    
    for (const func of functions) {
      // Check if function has protection
      const functionContent = content.slice(
        content.indexOf(`function ${func.name}`),
        content.indexOf(`function ${func.name}`) + 500
      )
      
      if (!hasProtection(functionContent)) {
        // Check if it's a read-only function (less severe)
        const isReadOnly = /get|fetch|list|find|search/i.test(func.name)
        
        violations.push({
          file: path.relative(PROJECT_ROOT, file),
          line: func.line,
          type: 'unprotected_action',
          description: `Server action '${func.name}' is not protected by secureAction, requirePermission, or withPermission`,
          severity: isReadOnly ? 'medium' : 'critical',
          code: func.code.slice(0, 100) + '...',
        })
      }
    }
  }
  
  return violations
}

function scanDbMutations(files: string[]): Violation[] {
  const violations: Violation[] = []
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')
    
    if (!hasDbMutation(content)) {
      continue
    }
    
    // Skip if file has protection
    if (hasProtection(content)) {
      continue
    }
    
    // Check for mutations in non-action files
    if (!file.includes('actions.ts')) {
      const lines = content.split('\n')
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        
        if (DB_MUTATION_PATTERNS.some(pattern => pattern.test(line))) {
          violations.push({
            file: path.relative(PROJECT_ROOT, file),
            line: i + 1,
            type: 'unprotected_mutation',
            description: 'Direct DB mutation found outside of protected server action',
            severity: 'high',
            code: line.trim().slice(0, 80),
          })
        }
      }
    }
  }
  
  return violations
}

function scanRouteLayouts(files: string[]): Violation[] {
  const violations: Violation[] = []
  
  // Protected route patterns - these should have protectRoute
  const protectedPaths = [
    '/admin',
    '/accountant',
    '/pm',
  ]
  
  for (const file of files) {
    // Only check layout files
    if (!file.includes('layout.tsx') && !file.includes('layout.ts')) {
      continue
    }
    
    // Check if this is a protected path
    const isProtectedPath = protectedPaths.some(p => file.includes(`/app${p}`))
    
    if (!isProtectedPath) {
      continue
    }
    
    const content = fs.readFileSync(file, 'utf-8')
    
    if (!hasRouteProtection(content)) {
      violations.push({
        file: path.relative(PROJECT_ROOT, file),
        line: 1,
        type: 'unprotected_route',
        description: 'Protected route layout missing protectRoute() call',
        severity: 'critical',
        code: 'Layout does not call protectRoute()',
      })
    }
  }
  
  return violations
}

function countProtectedItems(files: string[]): { actions: number, routes: number } {
  let actions = 0
  let routes = 0
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')
    
    // Count protected actions
    const actionMatches = content.match(/(?:secureAction|requirePermission|withPermission|guardedAction)\s*\(/g)
    if (actionMatches) {
      actions += actionMatches.length
    }
    
    // Count protected routes
    const routeMatches = content.match(/protectRoute\s*\(/g)
    if (routeMatches) {
      routes += routeMatches.length
    }
  }
  
  return { actions, routes }
}

// ============================================
// MAIN SCANNER
// ============================================

function runScan(): ScanResult {
  console.log('Starting RBAC Permission Coverage Scan...\n')
  
  // Get all TypeScript files
  const appFiles = getAllFiles(APP_DIR, '.tsx').concat(getAllFiles(APP_DIR, '.ts'))
  const libFiles = getAllFiles(LIB_DIR, '.ts')
  const allFiles = [...appFiles, ...libFiles]
  
  console.log(`Scanning ${allFiles.length} files...\n`)
  
  // Run scans
  const actionViolations = scanServerActions(appFiles)
  const mutationViolations = scanDbMutations(allFiles)
  const routeViolations = scanRouteLayouts(appFiles)
  
  const allViolations = [
    ...actionViolations,
    ...mutationViolations,
    ...routeViolations,
  ]
  
  // Count protected items
  const { actions, routes } = countProtectedItems(allFiles)
  
  return {
    violations: allViolations,
    scannedFiles: allFiles.length,
    protectedActions: actions,
    protectedRoutes: routes,
  }
}

function formatReport(result: ScanResult): string {
  const lines: string[] = []
  
  lines.push('=' .repeat(60))
  lines.push('RBAC PERMISSION COVERAGE REPORT')
  lines.push('=' .repeat(60))
  lines.push('')
  
  lines.push(`Files Scanned: ${result.scannedFiles}`)
  lines.push(`Protected Actions Found: ${result.protectedActions}`)
  lines.push(`Protected Routes Found: ${result.protectedRoutes}`)
  lines.push('')
  
  if (result.violations.length === 0) {
    lines.push('STATUS: PASS - No violations found')
    lines.push('')
  } else {
    lines.push(`STATUS: FAIL - ${result.violations.length} violation(s) found`)
    lines.push('')
    
    // Group by severity
    const bySeverity = {
      critical: result.violations.filter(v => v.severity === 'critical'),
      high: result.violations.filter(v => v.severity === 'high'),
      medium: result.violations.filter(v => v.severity === 'medium'),
      low: result.violations.filter(v => v.severity === 'low'),
    }
    
    for (const [severity, violations] of Object.entries(bySeverity)) {
      if (violations.length === 0) continue
      
      lines.push('-'.repeat(60))
      lines.push(`${severity.toUpperCase()} SEVERITY (${violations.length})`)
      lines.push('-'.repeat(60))
      
      for (const v of violations) {
        lines.push('')
        lines.push(`File: ${v.file}:${v.line}`)
        lines.push(`Type: ${v.type}`)
        lines.push(`Description: ${v.description}`)
        lines.push(`Code: ${v.code}`)
      }
      
      lines.push('')
    }
  }
  
  lines.push('=' .repeat(60))
  lines.push(`Report generated: ${new Date().toISOString()}`)
  lines.push('=' .repeat(60))
  
  return lines.join('\n')
}

// ============================================
// ENTRY POINT
// ============================================

const result = runScan()
const report = formatReport(result)

console.log(report)

// Write report to file
const reportPath = path.join(PROJECT_ROOT, 'docs', 'PERMISSION_COVERAGE_REPORT.txt')
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, report)
console.log(`\nReport saved to: ${reportPath}`)

// Exit with error code if violations found
if (result.violations.length > 0) {
  const criticalCount = result.violations.filter(v => v.severity === 'critical').length
  if (criticalCount > 0) {
    console.error(`\nFAILED: ${criticalCount} critical violation(s) found`)
    process.exit(1)
  }
}
