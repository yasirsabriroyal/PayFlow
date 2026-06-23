/**
 * Schedule calculation utilities for the recurring expense engine.
 * No dependencies on server/browser — safe to import anywhere.
 */

import type { ScheduleFrequency } from './types'

/**
 * Given a schedule, compute the next generation date after `from`.
 * `dayOfMonth` defaults to 1. `dayOfWeek` defaults to 1 (Monday).
 */
export function computeNextGenerationDate(
  frequency: ScheduleFrequency,
  from: Date,
  dayOfMonth: number = 1,
  dayOfWeek: number = 1,
): Date {
  const next = new Date(from)

  switch (frequency) {
    case 'weekly': {
      // Advance to the next occurrence of `dayOfWeek` (0=Sun … 6=Sat)
      const currentDay = next.getUTCDay()
      const diff = (dayOfWeek - currentDay + 7) % 7 || 7
      next.setUTCDate(next.getUTCDate() + diff)
      break
    }
    case 'biweekly': {
      const currentDay = next.getUTCDay()
      const diff = (dayOfWeek - currentDay + 7) % 7 || 7
      next.setUTCDate(next.getUTCDate() + diff + 7) // two weeks out
      break
    }
    case 'monthly': {
      next.setUTCMonth(next.getUTCMonth() + 1)
      next.setUTCDate(Math.min(dayOfMonth, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())))
      break
    }
    case 'quarterly': {
      next.setUTCMonth(next.getUTCMonth() + 3)
      next.setUTCDate(Math.min(dayOfMonth, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())))
      break
    }
    case 'semi_annual': {
      next.setUTCMonth(next.getUTCMonth() + 6)
      next.setUTCDate(Math.min(dayOfMonth, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())))
      break
    }
    case 'annual': {
      next.setUTCFullYear(next.getUTCFullYear() + 1)
      next.setUTCDate(Math.min(dayOfMonth, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())))
      break
    }
  }

  return next
}

/**
 * Compute the first generation date for a brand-new schedule.
 * If start_date is today or in the past, the first run is "now".
 * If start_date is in the future, the first run is start_date (adjusted to dayOfMonth).
 */
export function computeFirstGenerationDate(
  frequency: ScheduleFrequency,
  startDate: Date,
  dayOfMonth: number = 1,
  dayOfWeek: number = 1,
): Date {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const start = new Date(startDate)
  start.setUTCHours(0, 0, 0, 0)

  if (start > today) {
    // First generation is start_date itself (aligned to day_of_month if monthly+)
    return alignToDay(start, frequency, dayOfMonth)
  }

  // Start date is past: compute next occurrence from today
  return computeNextGenerationDate(frequency, today, dayOfMonth, dayOfWeek)
}

/**
 * Align a date to the configured day_of_month for non-weekly frequencies.
 */
function alignToDay(date: Date, frequency: ScheduleFrequency, dayOfMonth: number): Date {
  if (frequency === 'weekly' || frequency === 'biweekly') return date
  const aligned = new Date(date)
  aligned.setUTCDate(
    Math.min(dayOfMonth, daysInMonth(aligned.getUTCFullYear(), aligned.getUTCMonth())),
  )
  return aligned
}

/** UTC-safe days in month helper. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * Build the idempotency period_key for a given date and frequency.
 * e.g. monthly 2026-06-15 → '2026-07', weekly → '2026-W28'
 */
export function buildPeriodKey(date: Date, frequency: ScheduleFrequency): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')

  switch (frequency) {
    case 'weekly':
    case 'biweekly': {
      const week = getISOWeek(date)
      return `${y}-W${String(week).padStart(2, '0')}`
    }
    case 'monthly':
      return `${y}-${m}`
    case 'quarterly': {
      const q = Math.ceil((date.getUTCMonth() + 1) / 3)
      return `${y}-Q${q}`
    }
    case 'semi_annual': {
      const h = date.getUTCMonth() < 6 ? 1 : 2
      return `${y}-H${h}`
    }
    case 'annual':
      return `${y}`
  }
}

/** ISO 8601 week number (UTC). */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Human-friendly description of a frequency + day.
 * e.g. "Monthly on the 1st", "Weekly on Monday"
 */
export function describeSchedule(
  frequency: ScheduleFrequency,
  dayOfMonth?: number | null,
  dayOfWeek?: number | null,
): string {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
  }

  switch (frequency) {
    case 'weekly':
      return `Weekly on ${DAY_NAMES[dayOfWeek ?? 1]}`
    case 'biweekly':
      return `Bi-Weekly on ${DAY_NAMES[dayOfWeek ?? 1]}`
    case 'monthly':
      return `Monthly on the ${ordinal(dayOfMonth ?? 1)}`
    case 'quarterly':
      return `Quarterly on the ${ordinal(dayOfMonth ?? 1)}`
    case 'semi_annual':
      return `Semi-Annual on the ${ordinal(dayOfMonth ?? 1)}`
    case 'annual':
      return `Annual on the ${ordinal(dayOfMonth ?? 1)}`
  }
}

/**
 * Preview the next N generation dates for a schedule config.
 */
export function previewNextDates(
  frequency: ScheduleFrequency,
  startDate: Date,
  count: number = 3,
  dayOfMonth: number = 1,
  dayOfWeek: number = 1,
): Date[] {
  const dates: Date[] = []
  let cursor = computeFirstGenerationDate(frequency, startDate, dayOfMonth, dayOfWeek)
  for (let i = 0; i < count; i++) {
    dates.push(new Date(cursor))
    cursor = computeNextGenerationDate(frequency, cursor, dayOfMonth, dayOfWeek)
  }
  return dates
}
