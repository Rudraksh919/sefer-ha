import { describe, expect, it } from 'vitest'
import { isIsoDate, normalizeDate } from '../src/lib/dates'

describe('date normalization', () => {
  it('keeps ISO dates', () => {
    expect(normalizeDate('2026-09-12')).toBe('2026-09-12')
  })

  it('normalizes common document formats', () => {
    expect(normalizeDate('09/12/2026')).toBe('2026-09-12')
    expect(normalizeDate('12-Sep-2026')).toBe('2026-09-12')
    expect(normalizeDate('Sep 12, 2026')).toBe('2026-09-12')
    expect(normalizeDate('20260912')).toBe('2026-09-12')
    expect(normalizeDate('2026/9/12')).toBe('2026-09-12')
  })

  it('treats the first part as the day when it cannot be a month', () => {
    expect(normalizeDate('25/12/2026')).toBe('2026-12-25')
  })

  it('leaves unrecognizable values for manual review', () => {
    expect(normalizeDate('sometime in 2026')).toBe('sometime in 2026')
    expect(isIsoDate('sometime in 2026')).toBe(false)
    expect(isIsoDate('2026-02-30')).toBe(false)
  })
})
