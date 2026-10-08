import { type Shipment } from './shipment.js'
import { errorPaths, validateShipment } from './validation.js'
import { resolveBondType, resolveCountryCode, resolveForeignPortCode, resolvePortCode } from './netchb-codes.js'

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

export function renderNetchbXml(shipment: Shipment): RenderResult {
  const errors = errorPaths(validateShipment(shipment))
  if (errors.length) return { errors }

  const processingPort = resolvePortCode(shipment.transport.processingPort.value)!
  const entryPort = resolvePortCode(shipment.transport.entryPort.value)!
  const dischargePort = resolvePortCode(shipment.transport.dischargePort.value)
  const bondType = resolveBondType(shipment.entry.bondType.value)!
  const countryCodes = shipment.lines.map((line) => resolveCountryCode(line.countryOfOrigin.value)!)

  const totalValue = shipment.lines.reduce((total, line) => total + Number(line.value.value ?? 0), 0)
  const billOfLading = shipment.transport.billOfLading.value?.replace(/[^A-Za-z\d]/g, '')
  const manifest = billOfLading && shipment.totals.packages.value != null
    ? `<bill-of-lading>${element('house-bill', billOfLading)}${element('quantity', Math.round(shipment.totals.packages.value))}${element('unit', 'PKG')}</bill-of-lading>`
    : ''
  const containers = shipment.transport.containers.map((container) => element('container-number', container.value)).join('')
  const lines = shipment.lines.map((line, index) => {
    const quantity = line.quantity.value != null && line.unit.value ? `${element('quantity1', line.quantity.value)}${element('unit-of-measure1', line.unit.value)}` : ''
    return `<line-item>${element('country-origin', countryCodes[index])}<tariffs><tariff>${element('tariff-no', line.htsCode.value?.replace(/\D/g, ''))}${element('value', money(line.value.value))}${quantity}</tariff></tariffs>${element('lading-port', resolveForeignPortCode(shipment.transport.loadingPort.value))}${element('gross-weight', shipment.totals.grossWeight.value == null ? null : Math.round(shipment.totals.grossWeight.value))}</line-item>`
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
    ${element('gross-weight', shipment.totals.grossWeight.value == null ? null : Math.round(shipment.totals.grossWeight.value))}
    ${element('total-entry-value', Math.round(totalValue))}
    ${element('description', shipment.lines[0]?.description.value)}
    ${element('vessel-name', shipment.transport.vessel.value)}
    ${element('unlading-port', dischargePort ?? entryPort)}
    ${element('arrival-date', shipment.transport.arrivalDate.value)}
    ${element('voyage-no', shipment.transport.voyage.value)}
  </header>
  <manifest>${manifest}</manifest>
  ${containers ? `<containers>${containers}</containers>` : ''}
  <invoices>
    <invoice>
      ${element('invoice-no', shipment.invoice.number.value?.replace(/[^A-Za-z\d-]/g, ''))}
      ${currency && currency !== 'USD' ? `<foreign-currency>${element('currency-code', currency)}</foreign-currency>` : ''}
      <line-items>${lines}
      </line-items>
    </invoice>
  </invoices>
</entry>`,
  }
}
