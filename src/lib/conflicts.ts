import type { Conflict, Observation } from './shipment.js'
import { isValidContainer, resolveBondType, resolveCountryCode, resolveForeignPortCode, resolvePortCode } from './netchb-codes.js'
import { normalizeFieldValue } from './normalize.js'

// Deterministic, document-agnostic conflict detection.
//
// Every observation is a value the extractor saw for a field in a specific
// document. Values for the same field are canonicalized (resolved to the NetCHB
// code where possible, otherwise OCR-normalized) and grouped; a field is in
// conflict when two or more distinct canonical values appear. This works for any
// field and any combination of documents, and it does not report a port name and
// its code, or OCR variants of the same code, as a disagreement.

function canonicalFieldValue(field: string, value: string): string {
  const leaf = field.split('.').pop()?.toLowerCase() ?? ''
  if (leaf === 'processingport' || leaf === 'entryport' || leaf === 'dischargeport' || leaf === 'loadingport') {
    return resolvePortCode(value) ?? resolveForeignPortCode(value) ?? normalizeFieldValue(field, value)
  }
  if (leaf === 'countryoforigin') return resolveCountryCode(value) ?? normalizeFieldValue(field, value)
  if (leaf === 'bondtype') return resolveBondType(value) ?? normalizeFieldValue(field, value)
  return normalizeFieldValue(field, value)
}

function groupByCanonical(entries: Array<{ field: string; value: string }>): Map<string, Map<string, string>> {
  const groups = new Map<string, Map<string, string>>()
  for (const { value, ...rest } of entries) {
    // The model may write "lines[1].quantity"; the app uses "lines.1.quantity".
    const entry = { field: rest.field.replace(/\[(\d+)\]/g, '.$1'), value }
    const canonical = canonicalFieldValue(entry.field, entry.value)
    if (!canonical) continue
    const byValue = groups.get(entry.field) ?? new Map<string, string>()
    groups.set(entry.field, byValue)
    if (!byValue.has(canonical)) byValue.set(canonical, entry.value.trim())
  }
  return groups
}

function toConflicts(groups: Map<string, Map<string, string>>): Conflict[] {
  const conflicts: Conflict[] = []
  for (const [field, byValue] of groups) {
    if (byValue.size < 2) continue
    // Two readings of a container number where only one has a valid check digit: the check digit settles it.
    if (/container/i.test(field) && [...byValue.values()].filter(isValidContainer).length === 1) continue
    conflicts.push({ field, values: [...byValue.values()] })
  }
  return conflicts
}

// "lines.1.quantity" -> "Line 2 quantity"; "transport.containers.0.value" -> "transport container 1"
export function fieldLabel(path: string): string {
  return path
    .replace(/\.value$/, '')
    .replace(/^lines\.(\d+)(\.|$)/, (_, index, dot) => `Line ${Number(index) + 1}${dot ? ' ' : ''}`)
    .replace(/\.containers\.(\d+)/, (_, index) => ` container ${Number(index) + 1}`)
    .replace(/\./g, ' ')
}

export function detectConflicts(observations: Observation[]): Conflict[] {
  return toConflicts(groupByCanonical(observations))
}

// Re-canonicalize conflicts that came from the model: drop disagreements that are
// only OCR/formatting noise, and merge duplicates of the same field.
export function normalizeConflicts(conflicts: Conflict[]): Conflict[] {
  return toConflicts(groupByCanonical(conflicts.flatMap((conflict) => conflict.values.map((value) => ({ field: conflict.field, value })))))
}

export function mergeConflicts(...lists: Conflict[][]): Conflict[] {
  return normalizeConflicts(lists.flat())
}

// Single entry point used by the API and the UI so both agree on conflicts.
export function reconcileConflicts(shipment: { conflicts: Conflict[]; observations: Observation[] }): Conflict[] {
  return mergeConflicts(normalizeConflicts(shipment.conflicts), detectConflicts(shipment.observations))
}

