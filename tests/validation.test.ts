import { describe, expect, it } from 'vitest'
import { shipmentSchema, type Shipment } from '../src/lib/shipment'
import { errorPaths, validateShipment } from '../src/lib/validation'

const field = <T>(value: T, confidence = 1) => ({ value, confidence })

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return shipmentSchema.parse({
    importer: { name: field('Importer'), address: field('Portland'), taxId: field('12-3456789') },
    consignee: { name: field('Consignee'), address: field('Kent') },
    seller: { name: field('Seller'), address: field('Hong Kong') },
    invoice: { number: field('INV-1'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
    transport: { processingPort: field('3001'), entryPort: field('Tacoma'), loadingPort: field('12345'), dischargePort: field('Tacoma'), vessel: field('VESSEL'), voyage: field('041E'), billOfLading: field('BOL1'), arrivalDate: field('2026-10-14'), containers: [] },
    entry: { type: field('01'), bondType: field('09'), date: field('2026-10-14') },
    totals: { packages: field(1), grossWeight: field(1), freight: field(0), insurance: field(0), assists: field(0) },
    lines: [{ description: field('Item'), countryOfOrigin: field('Vietnam'), htsCode: field('6109.10'), quantity: field(1), unit: field('PCS'), value: field(10) }],
    conflicts: [],
    ...overrides,
  })
}

describe('shipment validation', () => {
  it('accepts a complete, code-valid shipment', () => {
    expect(validateShipment(shipment())).toEqual([])
  })

  it('flags an invalid bond type against the XSD enumeration', () => {
    const value = shipment({ entry: { type: field('01'), bondType: field('SINGLE'), date: field('2026-10-14') } })
    expect(errorPaths(validateShipment(value))).toContain('entry.bondType')
  })

  it('does not block on a missing bond type (optional in the XSD)', () => {
    const value = shipment({ entry: { type: field('01'), bondType: field(null, 0), date: field('2026-10-14') } })
    expect(errorPaths(validateShipment(value))).not.toContain('entry.bondType')
  })

  it('surfaces an unresolvable port instead of guessing', () => {
    const value = shipment({ transport: { ...shipment().transport, processingPort: field('Cat Lai') } })
    expect(errorPaths(validateShipment(value))).toContain('transport.processingPort')
  })

  it('warns, without blocking, when the foreign port of loading has no Schedule K code', () => {
    const value = shipment({ transport: { ...shipment().transport, loadingPort: field('Atlantis') } })
    expect(errorPaths(validateShipment(value))).not.toContain('transport.loadingPort')
    expect(validateShipment(value).some((issue) => issue.path === 'transport.loadingPort')).toBe(true)
  })

  it('flags an unknown country of origin', () => {
    const value = shipment({ lines: [{ description: field('Item'), countryOfOrigin: field('Atlantis'), htsCode: field('6109.10'), quantity: field(1), unit: field('PCS'), value: field(10) }] })
    expect(errorPaths(validateShipment(value))).toContain('lines.0.countryOfOrigin')
  })

  it('flags a non-ISO date for manual review instead of failing extraction', () => {
    const value = shipment({ invoice: { number: field('INV-1'), date: field('09/12/2026'), currency: field('USD'), incoterm: field('CIF') } })
    expect(errorPaths(validateShipment(value))).toContain('invoice.date')
  })

  it('flags an invalid entry type code', () => {
    const value = shipment({ entry: { type: field('CFS / DOOR'), bondType: field('09'), date: field('2026-10-14') } })
    expect(errorPaths(validateShipment(value))).toContain('entry.type')
  })

  it('flags a line with more than one HTS code', () => {
    const value = shipment({ lines: [{ description: field('Item'), countryOfOrigin: field('Vietnam'), htsCode: field('6109.10 / 6110.20'), quantity: field(1), unit: field('PCS'), value: field(10) }] })
    expect(errorPaths(validateShipment(value))).toContain('lines.0.htsCode')
  })
  it('validates review fields beyond the required NetCHB fields', () => {
    const value = shipment({
      invoice: { number: field('INV-1'), date: field('2026-09-12'), currency: field('US DOLLARS'), incoterm: field('MADEUP') },
      transport: { ...shipment().transport, billOfLading: field('BOL 1'), containers: [field('BAD')] },
    })
    value.totals.grossWeight.value = 0
    value.lines[0].unit.value = 'PIECES / CARTONS'

    const issues = validateShipment(value)
    expect(errorPaths(issues)).toEqual(expect.arrayContaining(['invoice.currency', 'transport.billOfLading', 'totals.grossWeight']))
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'invoice.incoterm', severity: 'warning' }),
      expect.objectContaining({ path: 'transport.containers.0', severity: 'warning' }),
      expect.objectContaining({ path: 'lines.0.unit', severity: 'warning' }),
    ]))
  })
})