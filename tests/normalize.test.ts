import { describe, expect, it } from 'vitest'
import { normalizeFieldValue, normalizeValue, valueKindForField } from '../src/lib/normalize'

describe('identifier normalization', () => {
  it('absorbs OCR confusions and separators in numeric identifiers', () => {
    expect(normalizeValue('6l09.1O', 'numeric')).toBe('610910')
    expect(normalizeValue('12-3456789', 'numeric')).toBe('123456789')
    expect(normalizeValue('0O', 'numeric')).toBe('00')
  })

  it('compares alphanumeric codes case- and separator-insensitively', () => {
    expect(normalizeValue('inv/1', 'code')).toBe('INV1')
    expect(normalizeValue('INV 1', 'code')).toBe('INV1')
  })

  it('selects the right kind per field', () => {
    expect(valueKindForField('transport.processingPort')).toBe('numeric')
    expect(valueKindForField('lines.0.htsCode')).toBe('numeric')
    expect(valueKindForField('invoice.number')).toBe('code')
    expect(valueKindForField('importer.name')).toBe('text')
    expect(normalizeFieldValue('lines.0.value', '6,480')).toBe('6480')
  })
})
