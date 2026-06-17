/**
 * Project Number utilities
 *
 * Canonical format: PRJ-YYYY-### (e.g. PRJ-2026-001)
 * - YYYY is the calendar year the project number was generated in.
 * - ### is a zero-padded, per-year incrementing sequence that resets each year.
 *
 * These are pure functions so they can be unit-tested and shared between the
 * client (for display/validation hints) and the server (authoritative checks).
 *
 * NOTE on multi-tenancy: the `projects` table is currently single-tenant (no
 * organization_id column). The generation helpers accept an optional list of
 * existing numbers so that, once a tenant column is introduced, the caller can
 * scope the query per tenant without changing this logic.
 */

export const PROJECT_NUMBER_PREFIX = 'PRJ'

// Accept 3+ digits so sequences beyond 999 in a single year still validate.
export const PROJECT_NUMBER_REGEX = /^PRJ-\d{4}-\d{3,}$/

export function isValidProjectNumber(value: string | null | undefined): boolean {
  if (!value) return false
  return PROJECT_NUMBER_REGEX.test(value.trim())
}

/** Format a year + sequence into a canonical project number. */
export function formatProjectNumber(year: number, sequence: number): string {
  const seq = String(Math.max(1, sequence)).padStart(3, '0')
  return `${PROJECT_NUMBER_PREFIX}-${year}-${seq}`
}

/** Extract the numeric sequence from a project number for a given year, or null. */
export function parseSequenceForYear(value: string, year: number): number | null {
  const match = value.trim().match(/^PRJ-(\d{4})-(\d{3,})$/)
  if (!match) return null
  if (Number(match[1]) !== year) return null
  return Number(match[2])
}

/**
 * Compute the next available project number for `year` given the set of
 * existing project numbers. Numbering resets each year.
 */
export function computeNextProjectNumber(existingNumbers: string[], year: number): string {
  let maxSeq = 0
  for (const num of existingNumbers) {
    const seq = parseSequenceForYear(num, year)
    if (seq !== null && seq > maxSeq) {
      maxSeq = seq
    }
  }
  return formatProjectNumber(year, maxSeq + 1)
}
