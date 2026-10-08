import { describe, expect, it } from 'vitest'
import { shipmentSchema } from '../src/lib/shipment'

const field = <T>(value: T, confidence = 1) => ({ value, confidence })

const validShipment = {
  importer: { name: field('Northbound Outfitters, Inc.'), address: field('Portland, OR'), taxId: field('12-3456789') },
  consignee: { name: field('Cascade Fulfillment Partners LLC'), address: field('Kent, WA') },
  seller: { name: field('Kowloon Bay Apparel Sourcing Limited'), address: field('Hong Kong') },
  invoice: { number: field('KBAS/NB/26-0912'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
  transport: {
    processingPort: field('3001'), entryPort: field('3001'), loadingPort: field('Cat Lai'), dischargePort: field('Tacoma'),
    vessel: field('PACIFIC ARGOS'), voyage: field('041E'), billOfLading: field('BMLVHCM26090418'), arrivalDate: field('2026-10-14'), containers: [],
  },
  entry: { type: field('01'), bondType: field('SINGLE'), date: field('2026-10-14') },
  totals: { packages: field(138), grossWeight: field(1000), freight: field(3850), insurance: field(185), assists: field(4180) },
  lines: [{ description: field("MEN'S T-SHIRT"), countryOfOrigin: field('VN'), htsCode: field('6109.10'), quantity: field(2400), unit: field('PCS'), value: field(6480) }],
}

describe('shipmentSchema', () => {
  it('accepts a complete normalized shipment', () => {
    expect(shipmentSchema.safeParse(validShipment).success).toBe(true)
  })

  it('allows unavailable extracted values', () => {
    const result = shipmentSchema.safeParse({
      ...validShipment,
      importer: { ...validShipment.importer, taxId: field(null, 0) },
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid extraction confidence', () => {
    const result = shipmentSchema.safeParse({
      ...validShipment,
      invoice: { ...validShipment.invoice, currency: field('USD', 1.1) },
    })

    expect(result.success).toBe(false)
  })
})
