import { describe, expect, it } from 'vitest'
import { sanitizeTransportPorts } from '../src/lib/sanitize'
import { shipmentSchema } from '../src/lib/shipment'

const field = <T>(value: T, confidence = 1) => ({ value, confidence })

function base() {
  return shipmentSchema.parse({
    importer: { name: field('Importer'), address: field('Portland'), taxId: field('12-3456789') },
    consignee: { name: field('Consignee'), address: field('Kent') },
    seller: { name: field('Seller'), address: field('Hong Kong') },
    invoice: { number: field('INV-1'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
    transport: { processingPort: field('CAT LAI, HCMC, VN'), entryPort: field('TACOMA, WA'), loadingPort: field('CAT LAI, HCMC, VN'), dischargePort: field('TACOMA, WA'), vessel: field('VESSEL'), voyage: field('041E'), billOfLading: field('BOL1'), arrivalDate: field('2026-10-14'), containers: [] },
    entry: { type: field('01'), bondType: field('09'), date: field('2026-10-14') },
    totals: { packages: field(1), grossWeight: field(1), freight: field(0), insurance: field(0), assists: field(0) },
    lines: [{ description: field('Item'), countryOfOrigin: field('Vietnam'), htsCode: field('610910'), quantity: field(1), unit: field('PCS'), value: field(10) }],
    conflicts: [],
  })
}

describe('transport port sanitizing', () => {
  it('clears a foreign port from the processing port and flags it for review', () => {
    const shipment = base()
    sanitizeTransportPorts(shipment)
    expect(shipment.transport.processingPort.value).toBeNull()
    expect(shipment.transport.processingPort.confidence).toBe(0)
    expect(shipment.flags.some((flag) => flag.field === 'transport.processingPort')).toBe(true)
  })

  it('keeps a valid U.S. port name', () => {
    const shipment = base()
    sanitizeTransportPorts(shipment)
    expect(shipment.transport.entryPort.value).toBe('TACOMA, WA')
  })
})