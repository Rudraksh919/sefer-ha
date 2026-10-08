import { describe, expect, it } from 'vitest'
import { detectConflicts, mergeConflicts, normalizeConflicts } from '../src/lib/conflicts'

describe('cross-document conflict detection', () => {
  it('detects a real disagreement across documents', () => {
    const conflicts = detectConflicts([
      { field: 'invoice.number', value: 'INV-1', document: 'invoice.pdf' },
      { field: 'invoice.number', value: 'INV-2', document: 'packing-list.pdf' },
    ])
    expect(conflicts).toEqual([{ field: 'invoice.number', values: ['INV-1', 'INV-2'] }])
  })

  it('ignores OCR noise and formatting differences', () => {
    expect(detectConflicts([
      { field: 'lines.0.htsCode', value: '6109.10', document: 'invoice.pdf' },
      { field: 'lines.0.htsCode', value: '61O91O', document: 'packing-list.pdf' },
    ])).toEqual([])
  })

  it('treats a port name and its code as the same value', () => {
    expect(mergeConflicts([{ field: 'transport.entryPort', values: ['Tacoma', '3002'] }])).toEqual([])
  })

  it('keeps genuinely different codes and merges duplicate fields', () => {
    const merged = mergeConflicts(
      [{ field: 'transport.entryPort', values: ['3002', '2704'] }],
      [{ field: 'transport.entryPort', values: ['3002'] }],
    )
    expect(merged).toEqual([{ field: 'transport.entryPort', values: ['3002', '2704'] }])
  })

  it('drops model conflicts that normalize to a single value', () => {
    expect(normalizeConflicts([{ field: 'invoice.number', values: ['inv-1', 'INV/1'] }])).toEqual([])
  })
})
