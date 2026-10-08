import { describe, expect, it } from 'vitest'
import { renderNetchbXml } from '../src/lib/netchb-renderer'
import { shipmentSchema } from '../src/lib/shipment'
import { validateNetchbXml } from '../server/xsd-validator'

const field = <T>(value: T, confidence = 0.9) => ({ value, confidence, source: { document: 'fixture.pdf', page: 1 } })

describe('shipment entry flow', () => {
  it('turns a schema-validated extraction into XSD-valid XML', async () => {
    const shipment = shipmentSchema.parse({
      importer: { name: field('Northbound Outfitters'), address: field('Portland, OR'), taxId: field('12-3456789') },
      consignee: { name: field('Cascade Fulfillment'), address: field('Kent, WA') },
      seller: { name: field('Kowloon Bay Apparel'), address: field('Hong Kong') },
      invoice: { number: field('KBAS-NB-26-0912'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
      transport: { processingPort: field('3001'), entryPort: field('Tacoma'), loadingPort: field('Cat Lai'), dischargePort: field('Tacoma'), vessel: field('PACIFIC ARGOS'), voyage: field('041E'), billOfLading: field('BMLVHCM26090418'), arrivalDate: field('2026-10-14'), containers: [field('MSKU1234567')] },
      entry: { type: field('01'), bondType: field('09'), date: field('2026-10-14') },
      totals: { packages: field(138), grossWeight: field(1000), freight: field(3850), insurance: field(185), assists: field(0) },
      lines: [{ description: field("MEN'S T-SHIRT"), countryOfOrigin: field('Vietnam'), htsCode: field('6109.10'), quantity: field(2400), unit: field('PCS'), value: field(6480) }],
      conflicts: [{ field: 'invoice.number', values: ['KBAS-NB-26-0912', 'KBAS-NB-26-0913'] }],
    })
    const rendered = renderNetchbXml(shipment)

    expect('xml' in rendered).toBe(true)
    if (!('xml' in rendered)) return
    await expect(validateNetchbXml(rendered.xml)).resolves.toEqual({ valid: true })
  })
})
