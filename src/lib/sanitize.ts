import { resolveForeignPortCode, resolvePortCode } from './netchb-codes.js'
import { addFlag, type Shipment } from './shipment.js'

// A U.S. processing/entry/discharge port must never be a foreign port. Models
// sometimes place the foreign port of loading (for example "Cat Lai, HCMC, VN")
// into a U.S. port field. Clear it, lower confidence, and raise a review flag so
// the user enters the real 4-digit CBP port instead of emitting invalid XML.

const usPortFields = [
  { path: 'processingPort', label: 'Processing port' },
  { path: 'entryPort', label: 'Entry port' },
  { path: 'dischargePort', label: 'Port of discharge' },
] as const

export function sanitizeTransportPorts(shipment: Shipment): void {
  for (const { path, label } of usPortFields) {
    const field = shipment.transport[path]
    if (field.value && resolvePortCode(field.value) === null && resolveForeignPortCode(field.value) !== null) {
      addFlag(shipment, `transport.${path}`, `${label} must be a U.S. CBP port, but the document provided the foreign port "${field.value}". Enter the correct 4-digit CBP port.`)
      field.value = null
      field.confidence = 0
    }
  }
}