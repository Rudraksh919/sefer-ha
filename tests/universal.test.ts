import { describe, expect, it } from 'vitest'
import { detectConflicts, fieldLabel, normalizeConflicts } from '../src/lib/conflicts'
import { findArrivalDate } from '../src/lib/dates'
import { applyEntryDefaults, stateFromAddress } from '../src/lib/derive'
import { buildMid, lineMid } from '../src/lib/mid'
import { normalizeFieldValue } from '../src/lib/normalize'
import { findCountryCode, resolveCountryCode, resolveForeignPortCode, resolvePortCode, resolveUnit } from '../src/lib/netchb-codes'
import { renderNetchbXml } from '../src/lib/netchb-renderer'
import { shipmentSchema, type Shipment } from '../src/lib/shipment'
import { completionSteps } from '../src/lib/todo'
import { validateShipment } from '../src/lib/validation'
import { validateNetchbXml } from '../server/xsd-validator'

const f = <T>(value: T | null, confidence = 1) => ({ value, confidence })

function build(overrides: Record<string, unknown> = {}): Shipment {
  return shipmentSchema.parse({
    importer: { name: f('Acme Imports'), address: f('1 Main St'), taxId: f(null, 0) },
    consignee: { name: f('Acme DC'), address: f('500 Dock Rd, Savannah, GA 31408') },
    seller: { name: f('Seller'), address: f('Shenzhen') },
    invoice: { number: f('INV/2026-77'), date: f('2026-03-01'), currency: f('USD'), incoterm: f('FOB') },
    transport: { processingPort: f(null, 0), entryPort: f(null, 0), loadingPort: f('Shanghai, China'), dischargePort: f('Savannah, GA'), vessel: f('MV TEST'), voyage: f('12W'), billOfLading: f('ABCD123456'), arrivalDate: f('2026-03-20'), containers: [f('MSKU 000000 0')], packageUnit: f('PALLETS') },
    entry: { type: f(null, 0), bondType: f(null, 0), date: f(null, 0) },
    totals: { packages: f(10), grossWeight: f(500.4), freight: f(0), insurance: f(0), assists: f(null, 0) },
    lines: [
      { description: f('Widgets'), countryOfOrigin: f('China'), htsCode: f('8479.89'), quantity: f(100), unit: f('Pairs'), value: f(1000), assist: f(250), grossWeight: f(200) },
      { description: f('Gadgets'), countryOfOrigin: f('Germany'), htsCode: f('8479.89.9499'), quantity: f(50), unit: f('Sets'), value: f(500.5), manufacturer: { name: f('Hans Werk GmbH'), address: f('12 Industriestrasse, Essen'), city: f('Essen') } },
    ],
    ...overrides,
  })
}

describe('port, country and unit resolution is not limited to one shipment', () => {
  it('resolves ports across the official Schedule D/K tables', () => {
    expect(resolvePortCode('Los Angeles, CA')).toBe('2704')
    expect(resolvePortCode('Long Beach')).toBe('2709')
    expect(resolvePortCode('Savannah, GA, USA')).toBe('1703')
    expect(resolveForeignPortCode('Shanghai, China')).toBe('57035')
    expect(resolveForeignPortCode('Qingdao')).toBe('57047')
    expect(resolveForeignPortCode('Cat Lai, HCMC, VN')).toBe('55224')
    expect(resolveForeignPortCode('Atlantis')).toBeNull()
  })

  it('resolves any country name, plus common variants', () => {
    expect(resolveCountryCode('Germany')).toBe('DE')
    expect(resolveCountryCode('Viet Nam')).toBe('VN')
    expect(resolveCountryCode('Made in Czechia')).toBe('CZ')
    expect(resolveCountryCode('Atlantis')).toBeNull()
  })

  it('maps invoice units to XSD codes and never guesses', () => {
    expect(resolveUnit('Pairs')).toBe('PRS')
    expect(resolveUnit('KGS')).toBe('KG')
    expect(resolveUnit('dozen')).toBe('DOZ')
    expect(resolveUnit('pcs')).toBe('PCS')
    expect(resolveUnit('Sets')).toBeNull()
  })
})

describe('comparison and conflicts', () => {
  it('compares amounts numerically, ignoring separators and units', () => {
    expect(normalizeFieldValue('totals.grossWeight', '1,930.000 KGS')).toBe(normalizeFieldValue('totals.grossWeight', '1930'))
    expect(detectConflicts([{ field: 'lines.0.value', value: '6,480.00', document: 'a' }, { field: 'lines.0.value', value: '6480', document: 'b' }])).toEqual([])
    expect(detectConflicts([{ field: 'totals.grossWeight', value: '1,930.000 KGS', document: 'a' }, { field: 'totals.grossWeight', value: '1,888.00 KGS', document: 'b' }])).toHaveLength(1)
  })

  it('rewrites bracket paths from the model to the app\'s dotted paths', () => {
    expect(normalizeConflicts([{ field: 'lines[1].quantity', values: ['1,200', '1,176'] }])).toEqual([{ field: 'lines.1.quantity', values: ['1,200', '1,176'] }])
  })
})


describe('defaults, MID, containers, steps', () => {
  it('defaults ports, entry type and date from the documents and flags them', () => {
    const shipment = build()
    applyEntryDefaults(shipment)
    expect(shipment.transport.entryPort.value).toBe('1703')
    expect(shipment.transport.processingPort.value).toBe('1703')
    expect(shipment.entry.type.value).toBe('01')
    expect(shipment.entry.date.value).toBe('2026-03-20')
    expect(shipment.flags.map((flag) => flag.field)).toEqual(expect.arrayContaining(['transport.entryPort', 'entry.type', 'entry.date']))
  })

  it('never overwrites a value that is already set', () => {
    const shipment = build({ entry: { type: f('03'), bondType: f('08'), date: f('2026-04-01') } })
    applyEntryDefaults(shipment)
    expect(shipment.entry.type.value).toBe('03')
    expect(shipment.entry.date.value).toBe('2026-04-01')
  })

  it('builds a MID from manufacturer details', () => {
    expect(buildMid('DE', 'Hans Werk GmbH', '12 Industriestrasse, Essen', 'Essen')).toBe('DEHANWER12ESS')
    expect(buildMid('DE', 'Hans Werk GmbH', null, 'Essen')).toBeNull()
  })

  it('finds the destination state only when it is a real state code', () => {
    expect(stateFromAddress('500 Dock Rd, Savannah, GA 31408')).toBe('GA')
    expect(stateFromAddress('Unit 5, Zone XX 12345')).toBeNull()
  })

  it('warns when the container check digit is wrong', () => {
    const issue = validateShipment(build()).find((entry) => entry.path === 'transport.containers.0')
    expect(issue?.message).toContain('check digit')
    const valid = build({ transport: { ...build().transport, containers: [f('OPLU 304172 2')] } })
    expect(validateShipment(valid).some((entry) => entry.path === 'transport.containers.0')).toBe(false)
  })

  it('lists what a broker still has to do', () => {
    const steps = completionSteps(build()).join('\n')
    expect(steps).toContain('importer of record')
    expect(steps).toContain('10-digit HTSUS')
    expect(steps).toContain('assist')
    expect(steps).toContain('manufacturer')
  })
})

describe('XML for an unrelated shipment', () => {
  it('is XSD-valid, adds assists to line value, and maps units, MID, manifest and charges', async () => {
    const shipment = build({ totals: { packages: f(10), grossWeight: f(500.4), freight: f(300), insurance: f(25.5), assists: f(null, 0) } })
    applyEntryDefaults(shipment)
    const rendered = renderNetchbXml(shipment)
    expect('xml' in rendered).toBe(true)
    if (!('xml' in rendered)) return
    const { xml } = rendered
    expect(xml).toContain('<value>1250.00</value>')
    expect(xml).toContain('<unit-of-measure1>PRS</unit-of-measure1>')
    expect(xml).toContain('<manufacturer-id>DEHANWER12ESS</manufacturer-id>')
    expect(xml).toContain('<unit>PLT</unit>')
    expect(xml).toContain('<charges>326</charges>')
    expect(xml).toContain('<state-destination>GA</state-destination>')
    expect(xml).toContain('<container-number>MSKU0000000</container-number>')
    expect(xml).toContain('<lading-port>57035</lading-port>')
    expect(xml).not.toContain('<unit-of-measure1>SETS')
    await expect(validateNetchbXml(xml)).resolves.toEqual({ valid: true })
  })

  it('prorates a shipment-level assist across lines when none is tied to a line', () => {
    const shipment = build({ totals: { packages: f(10), grossWeight: f(500), freight: f(0), insurance: f(0), assists: f(150) } })
    shipment.lines[0].assist = undefined
    applyEntryDefaults(shipment)
    const rendered = renderNetchbXml(shipment)
    expect('xml' in rendered && rendered.xml).toContain('<value>1099.97</value>')
    expect('xml' in rendered && rendered.xml).toContain('<value>550.53</value>')
  })
})

describe('regressions found in a real run', () => {
  it('ignores a factory tax number in the MID field and builds the MID instead', () => {
    const shipment = build()
    shipment.lines[1].manufacturer!.mid = f('3702148865')
    expect(lineMid(shipment.lines[1])?.mid).toBe('DEHANWER12ESS')
    shipment.lines[1].manufacturer!.mid = f('DEHANWER12ESS-X')
    expect(lineMid(shipment.lines[1])?.derived).toBe(true)
    shipment.lines[1].manufacturer!.mid = f('deabc123')
    expect(lineMid(shipment.lines[1])).toEqual({ mid: 'DEABC123', derived: false })
  })

  it('reduces a verbose incoterm to its 3-letter code', () => {
    const shipment = build({ invoice: { number: f('1'), date: f('2026-03-01'), currency: f('USD'), incoterm: f('CIF TACOMA, WA (INCOTERMS 2020)') } })
    applyEntryDefaults(shipment)
    expect(shipment.invoice.incoterm.value).toBe('CIF')
  })

  it('labels conflict fields readably', () => {
    expect(fieldLabel('lines.1.quantity')).toBe('Line 2 quantity')
    expect(fieldLabel('transport.containers.0.value')).toBe('transport container 1')
    expect(fieldLabel('totals.grossWeight')).toBe('totals grossWeight')
  })
})

describe('regressions found in run 5', () => {
  it('lets a valid check digit settle a container disagreement', () => {
    expect(normalizeConflicts([{ field: 'transport.containers.0.value', values: ['OPLU3041728', 'OPLU3041722'] }])).toEqual([])
    expect(normalizeConflicts([{ field: 'transport.containers.0.value', values: ['OPLU3041728', 'OPLU3041729'] }])).toHaveLength(1)
  })

  it('falls back to today\'s date for the entry date when there is no arrival date', () => {
    const shipment = build({ transport: { ...build().transport, arrivalDate: f(null, 0) } })
    applyEntryDefaults(shipment)
    expect(shipment.entry.date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(shipment.flags.some((flag) => flag.field === 'entry.date' && flag.message.includes('today'))).toBe(true)
  })

  it('labels a line-level flag as that line', () => {
    expect(fieldLabel('lines.4')).toBe('Line 5')
  })
})

describe('regressions found in the downloaded run XML', () => {
  it('uses only the first line of a multi-line description, within 70 characters', () => {
    const shipment = build()
    shipment.lines[0].description = f("MEN'S CREW NECK SHORT SLEEVE T-SHIRT\n100% Cotton single jersey, 160 GSM, knitted")
    applyEntryDefaults(shipment)
    const rendered = renderNetchbXml(shipment)
    expect('xml' in rendered && rendered.xml).toContain('<description>MEN&apos;S CREW NECK SHORT SLEEVE T-SHIRT</description>')
  })
})

describe('checks added after run 6', () => {
  it('reads the ETA from document text when the model returns none', () => {
    expect(findArrivalDate(['Port of Discharge: X\nB/L No.:   ETD / ETA: BMLVHCM26090418   24-SEP-2026 / 14-OCT-2026\nNo. Style'])).toBe('2026-10-14')
    expect(findArrivalDate(['Vessel ETA: 03/11/2026'])).toBe('2026-03-11')
    expect(findArrivalDate(['shipped on board 24-SEP-2026', ''])).toBeNull()
  })

  it('finds a country named in an address', () => {
    expect(findCountryCode('Plot 41, Gazipur, Bangladesh')).toBe('BD')
    expect(findCountryCode('Lot C7-C8, Road No. 9, Di An City, Binh Duong Province, Vietnam')).toBe('VN')
    expect(findCountryCode('1 Main St, Papua New Guinea')).toBe('PG')
    expect(findCountryCode('21820 76th Avenue South, Kent, WA 98032')).toBeNull()
  })

  it('warns when the manufacturer is in a different country than the line origin, and builds the MID from the manufacturer country', () => {
    const shipment = build()
    shipment.lines[0].countryOfOrigin = f('Vietnam')
    shipment.lines[0].manufacturer = { name: f('SP Garments Dhaka Ltd'), address: f('Plot 41, Gazipur, Bangladesh'), city: f('Gazipur') }
    expect(validateShipment(shipment).some((issue) => issue.path === 'lines.0.manufacturer.address' && issue.message.includes('BD'))).toBe(true)
    expect(lineMid(shipment.lines[0])?.mid.startsWith('BD')).toBe(true)
  })
})
