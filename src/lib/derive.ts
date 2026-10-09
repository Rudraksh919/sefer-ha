import { resolvePortCode } from './netchb-codes.js'
import { addFlag, type ExtractedField, type Shipment } from './shipment.js'

// Fill entry fields that no shipping document states but that can be reasonably
// derived. Every derived value is low-confidence and flagged so the broker confirms it;
// values the user or extractor already set are never overwritten.

function fill<T>(shipment: Shipment, path: string, target: ExtractedField<T>, value: T | null, message: string): void {
  if (target.value != null || value == null) return
  target.value = value
  target.confidence = 0.5
  addFlag(shipment, path, message)
}

const incotermCodes = /(?<![A-Z])(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)(?![A-Z])/i

export function applyEntryDefaults(shipment: Shipment): void {
  const { transport, entry } = shipment
  // "CIF TACOMA, WA (INCOTERMS 2020)" -> "CIF"
  const incoterm = shipment.invoice.incoterm
  const code = incoterm.value && incotermCodes.exec(incoterm.value)?.[1]
  if (code) incoterm.value = code.toUpperCase()
  const usPort = resolvePortCode(transport.dischargePort.value)
  const portNote = 'Defaulted to the U.S. port of discharge; confirm the port where the entry will be filed.'
  fill(shipment, 'transport.entryPort', transport.entryPort, usPort, portNote)
  fill(shipment, 'transport.processingPort', transport.processingPort, resolvePortCode(transport.entryPort.value), portNote)
  fill(shipment, 'entry.type', entry.type, '01', 'Defaulted to 01 (free and dutiable consumption entry); change it for FTZ, warehouse, or informal entries.')
  fill(shipment, 'entry.date', entry.date, transport.arrivalDate.value, 'Defaulted to the vessel arrival date; set the actual filing date.')
  fill(shipment, 'entry.date', entry.date, new Date().toISOString().slice(0, 10), "Defaulted to today's date because no arrival date was found; set the actual filing date.")
}

// Two-letter U.S. state / territory codes accepted by the NetCHB XSD (usStateType).
export const usStateCodes = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP'.split(' '))

export function stateFromAddress(address: string | null | undefined): string | null {
  const match = /\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(address ?? '')
  return match && usStateCodes.has(match[1]) ? match[1] : null
}
