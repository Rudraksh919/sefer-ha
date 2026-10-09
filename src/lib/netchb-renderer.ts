import { type Shipment } from './shipment.js'
import { errorPaths, validateShipment } from './validation.js'
import { resolveBondType, resolveCountryCode, resolveForeignPortCode, resolvePackageUnit, resolvePortCode, resolveUnit } from './netchb-codes.js'
import { stateFromAddress } from './derive.js'
import { lineMid } from './mid.js'

export type RenderResult = { xml: string } | { errors: string[] }

function escapeXml(value: string | number): string {
  return String(value).replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!)
}

function element(name: string, value: string | number | null | undefined): string {
  return value == null || value === '' ? '' : `<${name}>${escapeXml(value)}</${name}>`
}

function money(value: number | null): string | null {
  return value == null ? null : value.toFixed(2)
}

const alnum = (value: string | null | undefined) => value?.replace(/[^A-Za-z\d]/g, '') ?? ''
const scac = (value: string | null | undefined) => { const code = alnum(value).toUpperCase(); return /^(\w{2}|\w{4})$/.test(code) ? code : '' }

// NetCHB takes the carrier SCAC and the bill number as separate elements, so drop a leading SCAC from the bill.
function billWithoutScac(bill: string | null | undefined, code: string): string {
  const compact = alnum(bill)
  return code && compact.toUpperCase().startsWith(code) && compact.length > code.length ? compact.slice(code.length) : compact
}

// Assists are dutiable, so they are added to the entered value of the line they relate to.
// A shipment-level assist that is not tied to any line is prorated across lines by value.
function lineAssists(shipment: Shipment): number[] {
  const tied = shipment.lines.map((line) => line.assist?.value ?? 0)
  const total = shipment.totals.assists.value ?? 0
  const base = shipment.lines.reduce((sum, line) => sum + (line.value.value ?? 0), 0)
  if (tied.some(Boolean) || !total || !base) return tied
  const shares = shipment.lines.map((line) => Math.round(total * ((line.value.value ?? 0) / base) * 100) / 100)
  shares[shares.length - 1] += Math.round((total - shares.reduce((sum, share) => sum + share, 0)) * 100) / 100
  return shares
}

export function renderNetchbXml(shipment: Shipment): RenderResult {
  const errors = errorPaths(validateShipment(shipment))
  if (errors.length) return { errors }

  const { transport, totals } = shipment
  const processingPort = resolvePortCode(transport.processingPort.value)!
  const entryPort = resolvePortCode(transport.entryPort.value)!
  const dischargePort = resolvePortCode(transport.dischargePort.value)
  const bondType = resolveBondType(shipment.entry.bondType.value)
  const loadingPort = resolveForeignPortCode(transport.loadingPort.value)
  const assists = lineAssists(shipment)
  const enteredValues = shipment.lines.map((line, index) => (line.value.value ?? 0) + assists[index])
  const totalValue = Math.round(enteredValues.reduce((sum, value) => sum + value, 0))
  const charges = Math.round((totals.freight.value ?? 0) + (totals.insurance.value ?? 0))
  const grossWeight = totals.grossWeight.value == null ? null : Math.round(totals.grossWeight.value)

  const masterScac = scac(transport.masterScac?.value)
  const houseScac = scac(transport.houseScac?.value)
  const houseBill = billWithoutScac(transport.billOfLading.value, houseScac)
  const manifest = houseBill && totals.packages.value != null
    ? `<bill-of-lading>${element('master-scac', masterScac)}${element('master-bill', billWithoutScac(transport.masterBill?.value, masterScac))}${element('house-scac', houseScac)}${element('house-bill', houseBill)}${element('quantity', Math.round(totals.packages.value))}${element('unit', resolvePackageUnit(transport.packageUnit?.value))}</bill-of-lading>`
    : ''
  const containers = transport.containers.map((container) => element('container-number', container.value?.replace(/\s+/g, '').toUpperCase())).join('')
  const lines = shipment.lines.map((line, index) => {
    const unit = resolveUnit(line.unit.value)
    const quantity = line.quantity.value != null && unit ? `${element('quantity1', line.quantity.value)}${element('unit-of-measure1', unit)}` : ''
    const weight = line.grossWeight?.value == null ? '' : element('gross-weight', Math.round(line.grossWeight.value))
    return `<line-item>${element('country-origin', resolveCountryCode(line.countryOfOrigin.value))}${element('manufacturer-id', lineMid(line)?.mid)}<tariffs><tariff>${element('tariff-no', line.htsCode.value?.replace(/\D/g, ''))}${element('value', money(enteredValues[index]))}${quantity}</tariff></tariffs>${element('lading-port', loadingPort)}${weight}</line-item>`
  }).join('')
  const currency = shipment.invoice.currency.value?.toUpperCase()

  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.netchb.com/xml/entry" xmlns:data="http://www.netchb.com/xml/data">
  <entry-no><system-generated /></entry-no>
  <header>
    ${element('importer-tax-id', shipment.importer.taxId?.value)}
    ${element('importer-name', shipment.importer.name.value)}
    <ultimate-consignee>${element('consignee-name', shipment.consignee.name.value)}</ultimate-consignee>
    ${element('processing-port', processingPort)}
    ${element('entry-port', entryPort)}
    ${element('entry-date', shipment.entry.date.value)}
    ${element('entry-type', shipment.entry.type.value)}
    ${element('bond-type', bondType)}
    ${element('charges', charges > 0 ? charges : null)}
    ${element('gross-weight', grossWeight)}
    ${element('total-entry-value', totalValue >= 1 ? totalValue : null)}
    ${element('description', shipment.lines[0]?.description.value?.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 70))}
    ${element('state-destination', stateFromAddress(shipment.consignee.address.value))}
    ${element('vessel-name', transport.vessel.value)}
    ${element('mode-transportation', transport.vessel.value ? '11' : null)}
    ${element('unlading-port', dischargePort ?? entryPort)}
    ${element('arrival-date', transport.arrivalDate.value)}
    ${element('carrier-code', masterScac)}
    ${element('voyage-no', transport.voyage.value)}
  </header>
  <manifest>${manifest}</manifest>
  ${containers ? `<containers>${containers}</containers>` : ''}
  <invoices>
    <invoice>
      ${element('invoice-no', shipment.invoice.number.value?.replace(/[^A-Za-z\d-]/g, '').slice(0, 17))}
      ${currency && currency !== 'USD' ? `<foreign-currency>${element('currency-code', currency)}</foreign-currency>` : ''}
      <line-items>${lines}
      </line-items>
    </invoice>
  </invoices>
</entry>`,
  }
}
