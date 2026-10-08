// OCR-aware identifier normalization.
//
// The same identifier can appear differently across documents because OCR
// confuses visually similar characters (O/0, I/1/L, S/5, B/8, Z/2, G/6) and
// because documents use different separators. Values are normalized before they
// are compared across documents so that genuine disagreements are detected and
// OCR noise is not reported as a conflict.

export type ValueKind = 'text' | 'code' | 'numeric'

// Letters OCR commonly produces in place of digits inside numeric identifiers.
const ocrDigitEquivalents: Record<string, string> = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1',
  Z: '2',
  E: '3',
  A: '4',
  S: '5',
  G: '6',
  T: '7',
  B: '8',
}

export function normalizeValue(value: string, kind: ValueKind = 'text'): string {
  const collapsed = value.trim().replace(/\s+/g, ' ')
  if (kind === 'text') return collapsed.toUpperCase()
  const compact = collapsed.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return kind === 'numeric' ? compact.replace(/[A-Z]/g, (character) => ocrDigitEquivalents[character] ?? character) : compact
}

const numericFields = new Set(['processingport', 'entryport', 'loadingport', 'dischargeport', 'htscode', 'taxid', 'bondtype', 'type', 'value', 'quantity', 'packages', 'grossweight', 'freight', 'insurance', 'assists'])
const codeFields = new Set(['number', 'billoflading', 'containers', 'container', 'voyage', 'voyageno'])

export function valueKindForField(field: string): ValueKind {
  const leaf = field.split('.').pop()?.replace(/[^a-z]/gi, '').toLowerCase() ?? ''
  if (numericFields.has(leaf)) return 'numeric'
  if (codeFields.has(leaf)) return 'code'
  return 'text'
}

export function normalizeFieldValue(field: string, value: string): string {
  return normalizeValue(value, valueKindForField(field))
}
