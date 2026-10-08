import { describe, expect, it } from 'vitest'
import { renderNetchbXml } from '../src/lib/netchb-renderer'
import { shipmentSchema } from '../src/lib/shipment'
import { validateNetchbXml } from '../server/xsd-validator'

const field = <T>(value: T) => ({ value, confidence: 1 })
const shipment = shipmentSchema.parse({
  importer: { name: field('Northbound Outfitters'), address: field('Portland'), taxId: field('12-3456789') },
  consignee: { name: field('Consignee'), address: field('Kent') }, seller: { name: field('Seller'), address: field('Hong Kong') },
  invoice: { number: field('INV-1'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
  transport: { processingPort: field('3001'), entryPort: field('Tacoma'), loadingPort: field('Cat Lai'), dischargePort: field('Tacoma'), vessel: field('PACIFIC ARGOS'), voyage: field('041E'), billOfLading: field('BOL-1'), arrivalDate: field('2026-10-14'), containers: [] },
  entry: { type: field('01'), bondType: field('09'), date: field('2026-10-14') },
  totals: { packages: field(138), grossWeight: field(1000), freight: field(3850), insurance: field(185), assists: field(0) },
  lines: [{ description: field('T-shirt'), countryOfOrigin: field('Vietnam'), htsCode: field('6109.10'), quantity: field(2400), unit: field('PCS'), value: field(6480) }], conflicts: [],
})

describe('NetCHB XSD validation', () => {
  it('accepts a rendered NetCHB entry', async () => {
    const rendered = renderNetchbXml(shipment)
    expect('xml' in rendered).toBe(true)
    if (!('xml' in rendered)) return

    await expect(validateNetchbXml(rendered.xml)).resolves.toEqual({ valid: true })
  })

  it('reports schema violations', async () => {
    const result = await validateNetchbXml('<entry />')
    expect(result.valid).toBe(false)
  })
})
