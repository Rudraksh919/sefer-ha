import { describe, expect, it } from 'vitest'
import { extractShipment, extractionRequestSchema } from '../src/lib/extraction'

const field = <T>(value: T, confidence = 1) => ({ value, confidence })

const shipment = {
  importer: { name: field('Importer'), address: field('Portland, OR'), taxId: field(null, 0) },
  consignee: { name: field('Consignee'), address: field('Kent, WA') },
  seller: { name: field('Seller'), address: field('Hong Kong') },
  invoice: { number: field('INV-1'), date: field('2026-09-12'), currency: field('USD'), incoterm: field('CIF') },
  transport: { processingPort: field(null, 0), entryPort: field(null, 0), loadingPort: field('Cat Lai'), dischargePort: field('Tacoma'), vessel: field(null, 0), voyage: field(null, 0), billOfLading: field('BOL-1'), arrivalDate: field(null, 0), containers: [] },
  entry: { type: field(null, 0), bondType: field(null, 0), date: field(null, 0) },
  totals: { packages: field(null, 0), grossWeight: field(null, 0), freight: field(null, 0), insurance: field(null, 0), assists: field(null, 0) },
  lines: [{ description: field('T-shirt'), countryOfOrigin: field('VN'), htsCode: field('6109.10'), quantity: field(2400), unit: field('PCS'), value: field(6480) }],
  conflicts: [],
}

describe('OpenRouter extraction', () => {
  it('rejects requests with no readable content', () => {
    expect(extractionRequestSchema.safeParse({ documents: [{ name: 'invoice.pdf' }] }).success).toBe(false)
  })

  it('enforces document names and payload limits at the API boundary', () => {
    expect(extractionRequestSchema.safeParse({ documents: [{ name: 'invoice.exe', text: 'Invoice' }] }).success).toBe(false)
    expect(extractionRequestSchema.safeParse({ documents: Array.from({ length: 11 }, (_, index) => ({ name: `invoice-${index}.pdf`, text: 'Invoice' })) }).success).toBe(false)
    expect(extractionRequestSchema.safeParse({ documents: [{ name: 'scan.png', images: [`data:image/png,${'x'.repeat(15 * 1024 * 1024)}`] }] }).success).toBe(false)
  })

  it('validates extracted model JSON before returning it', async () => {
    const result = await extractShipment(
      { documents: [{ name: 'invoice.txt', text: 'Invoice INV-1' }] },
      'test-key',
      'openrouter/free',
      async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(shipment) } }] }), { status: 200 }),
    )

    expect(result.invoice.number.value).toBe('INV-1')
    expect(result.importer.taxId.value).toBeNull()
  })

  it('derives conflicts from cross-document observations', async () => {
    const modelOutput = {
      ...shipment,
      observations: [
        { field: 'invoice.number', value: 'INV-1', document: 'invoice.pdf' },
        { field: 'invoice.number', value: 'INV-2', document: 'packing-list.pdf' },
      ],
    }
    const result = await extractShipment(
      { documents: [{ name: 'invoice.txt', text: 'Invoice INV-1' }] },
      'test-key',
      'openrouter/free',
      async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }), { status: 200 }),
    )

    expect(result.conflicts).toEqual([{ field: 'invoice.number', values: ['INV-1', 'INV-2'] }])
  })

  it('normalizes non-ISO dates instead of rejecting the extraction', async () => {
    const modelOutput = { ...shipment, invoice: { ...shipment.invoice, date: field('09/12/2026') } }
    const result = await extractShipment(
      { documents: [{ name: 'invoice.txt', text: 'Invoice INV-1' }] },
      'test-key',
      'openrouter/free',
      async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }), { status: 200 }),
    )

    expect(result.invoice.date.value).toBe('2026-09-12')
  })

  it('preserves review flags raised by the model', async () => {
    const modelOutput = {
      ...shipment,
      flags: [{ field: 'totals.assists', message: 'Buyer-supplied material detected; review whether it is a dutiable assist.' }],
    }
    const result = await extractShipment(
      { documents: [{ name: 'invoice.txt', text: 'Invoice INV-1' }] },
      'test-key',
      'openrouter/free',
      async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }), { status: 200 }),
    )

    expect(result.flags.map((flag) => flag.field)).toContain('totals.assists')
  })
})
