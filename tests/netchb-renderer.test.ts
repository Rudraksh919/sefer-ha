import { describe, expect, it } from 'vitest'
import { renderNetchbXml } from '../src/lib/netchb-renderer'
import { shipmentSchema } from '../src/lib/shipment'

const field = <T>(value: T, confidence = 1) => ({ value, confidence })
const shipment = shipmentSchema.parse({
  importer: { name: field('Northbound & Co'), address: field('Portland'), taxId: field('12-3456789') },
  consignee: { name: field('Consignee'), address: field('Kent') }, seller: { name: field('Seller'), address: field('Hong Kong') },
  invoice: { number: field('INV-1'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
  transport: { processingPort: field('3001'), entryPort: field('Tacoma'), loadingPort: field('Cat Lai'), dischargePort: field('Tacoma'), vessel: field('PACIFIC ARGOS'), voyage: field('041E'), billOfLading: field('BOL-1'), arrivalDate: field('2026-10-14'), containers: [] },
  entry: { type: field('01'), bondType: field('09'), date: field('2026-10-14') },
  totals: { packages: field(138), grossWeight: field(1000), freight: field(3850), insurance: field(185), assists: field(0) },
  lines: [{ description: field('T-shirt'), countryOfOrigin: field('Vietnam'), htsCode: field('6109.10'), quantity: field(2400), unit: field('PCS'), value: field(6480) }], conflicts: [],
})

describe('NetCHB XML renderer', () => {
  it('renders ordered XML and escapes field values', () => {
    const result = renderNetchbXml(shipment)
    expect('xml' in result && result.xml).toContain('<entry-no><system-generated /></entry-no>')
    expect('xml' in result && result.xml).toContain('Northbound &amp; Co')
    expect('xml' in result && result.xml).toContain('<tariff-no>610910</tariff-no>')
  })

  it('renders every invoice line', () => {
    const result = renderNetchbXml({ ...shipment, lines: [...shipment.lines, { ...shipment.lines[0], htsCode: field('6206.40'), value: field(1260) }] })
    expect('xml' in result && result.xml.match(/<line-item>/g)).toHaveLength(2)
  })

  it('maps containers, manifest details, foreign currency, and tariff quantities', () => {
    const result = renderNetchbXml({
      ...shipment,
      invoice: { ...shipment.invoice, currency: field('EUR') },
      transport: { ...shipment.transport, billOfLading: field('BOL/1'), loadingPort: field('12345'), dischargePort: field('Tacoma'), containers: [field('MSKU1234567')] },
    })

    expect('xml' in result && result.xml).toContain('<house-bill>BOL1</house-bill>')
    expect('xml' in result && result.xml).toContain('<container-number>MSKU1234567</container-number>')
    expect('xml' in result && result.xml).toContain('<currency-code>EUR</currency-code>')
    expect('xml' in result && result.xml).toContain('<quantity1>2400</quantity1>')
  })

  it('resolves human-readable ports, countries, and bond types to NetCHB codes', () => {
    const result = renderNetchbXml(shipment)

    expect('xml' in result && result.xml).toContain('<entry-port>3002</entry-port>')
    expect('xml' in result && result.xml).toContain('<country-origin>VN</country-origin>')
    expect('xml' in result && result.xml).toContain('<bond-type>09</bond-type>')
  })

  it('reports required ports that cannot be resolved instead of guessing', () => {
    const result = renderNetchbXml({ ...shipment, transport: { ...shipment.transport, processingPort: field('Cat Lai') } })

    expect('errors' in result && result.errors).toContain('transport.processingPort')
  })


  it('reports missing required review fields', () => {
    const result = renderNetchbXml({ ...shipment, entry: { ...shipment.entry, bondType: field(null, 0) } })
    expect('errors' in result && result.errors).toContain('entry.bondType')
  })
})
