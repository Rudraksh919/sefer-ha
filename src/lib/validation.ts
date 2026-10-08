import { getExtractedValue, requiredShipmentFields, type ExtractedField, type Shipment } from './shipment.js'
import { isIsoDate, shipmentDatePaths } from './dates.js'
import { isValidBondType, isValidEntryType, isValidUsPortCode, resolveCountryCode, resolveForeignPortCode, resolvePortCode } from './netchb-codes.js'

export type ValidationSeverity = 'error' | 'warning'

export type ValidationIssue = {
  path: string
  message: string
  severity: ValidationSeverity
}

const incoterms = new Set(['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'])

// Generic validation for any shipment/document combination. Required values must
// be present; NetCHB codes must resolve to the exact XSD value. Unknown codes are
// surfaced here for manual review and are never inferred.
export function validateShipment(shipment: Shipment): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (path: string, message: string, severity: ValidationSeverity = 'error') => issues.push({ path, message, severity })
  const checkText = (path: string, value: string | null | undefined, label: string, severity: ValidationSeverity = 'error') => {
    if (value != null && !value.trim()) add(path, `${label} cannot be blank.`, severity)
  }
  const checkMoney = (path: string, value: number | null | undefined, label: string) => {
    if (value != null && (!Number.isFinite(value) || value < 0)) add(path, `${label} must be a non-negative number.`)
  }
  const checkPositive = (path: string, value: number | null | undefined, label: string) => {
    if (value != null && (!Number.isFinite(value) || value <= 0)) add(path, `${label} must be greater than zero.`)
  }

  for (const path of requiredShipmentFields) {
    if (getExtractedValue(shipment, path) == null) add(path, 'Required value is missing.')
  }

  checkText('importer.name', shipment.importer.name.value, 'Importer name')
  checkText('importer.address', shipment.importer.address.value, 'Importer address')
  checkText('importer.taxId', shipment.importer.taxId?.value, 'Importer tax ID')
  if (shipment.importer.taxId?.value != null && !/^[A-Za-z0-9-]{2,20}$/.test(shipment.importer.taxId.value.trim())) {
    add('importer.taxId', 'Importer tax ID should contain only letters, numbers, and hyphens.')
  }
  checkText('consignee.name', shipment.consignee.name.value, 'Consignee name')
  checkText('consignee.address', shipment.consignee.address.value, 'Consignee address')
  checkText('seller.name', shipment.seller.name.value, 'Seller name')
  checkText('seller.address', shipment.seller.address.value, 'Seller address')

  checkText('invoice.number', shipment.invoice.number.value, 'Invoice number')
  const currency = shipment.invoice.currency.value?.trim().toUpperCase()
  if (currency != null && !/^[A-Z]{3}$/.test(currency)) add('invoice.currency', 'Currency must be a 3-letter ISO code, for example USD.')
  const incoterm = shipment.invoice.incoterm.value?.trim().toUpperCase()
  if (incoterm != null && !incoterms.has(incoterm)) add('invoice.incoterm', 'Incoterm must be a valid 3-letter Incoterms 2020 code.', 'warning')

  const usPorts: Array<[string, string | null, ValidationSeverity]> = [
    ['transport.processingPort', shipment.transport.processingPort.value, 'error'],
    ['transport.entryPort', shipment.transport.entryPort.value, 'error'],
    ['transport.dischargePort', shipment.transport.dischargePort.value, 'warning'],
  ]
  for (const [path, value, severity] of usPorts) {
    if (value != null && !resolvePortCode(value)) add(path, 'Not a recognized 4-digit CBP port code or known port name; select a valid code.', severity)
  }
  if (shipment.transport.loadingPort.value != null && !resolveForeignPortCode(shipment.transport.loadingPort.value)) {
    add('transport.loadingPort', 'Enter a 5-digit CBP Schedule K foreign port code or clear the field.')
  }
  checkText('transport.vessel', shipment.transport.vessel.value, 'Vessel', 'warning')
  checkText('transport.voyage', shipment.transport.voyage.value, 'Voyage', 'warning')
  checkText('transport.billOfLading', shipment.transport.billOfLading.value, 'Bill of lading')
  if (shipment.transport.billOfLading.value != null && !/^[A-Za-z0-9/-]+$/.test(shipment.transport.billOfLading.value.trim())) {
    add('transport.billOfLading', 'Bill of lading should contain only letters, numbers, slashes, or hyphens.')
  }
  shipment.transport.containers.forEach((container: ExtractedField<string>, index: number) => {
    const value = container.value?.replace(/\s+/g, '').toUpperCase()
    if (value != null && !/^[A-Z]{4}\d{7}$/.test(value)) add(`transport.containers.${index}`, 'Container number should match ISO 6346 format, for example MSKU1234567.', 'warning')
  })

  const bondType = shipment.entry.bondType.value
  if (bondType != null && !isValidBondType(bondType)) add('entry.bondType', 'Bond type must be one of 00, 08, or 09.')

  const entryType = shipment.entry.type.value
  if (entryType != null && !isValidEntryType(entryType)) add('entry.type', 'Entry type must be a valid 2-digit CBP entry type code (for example 01).')

  for (const path of shipmentDatePaths) {
    const value = getExtractedValue(shipment, path)
    if (value != null && !isIsoDate(String(value))) add(path, 'Date must be in YYYY-MM-DD format.')
  }

  checkPositive('totals.packages', shipment.totals.packages.value, 'Packages')
  checkPositive('totals.grossWeight', shipment.totals.grossWeight.value, 'Gross weight')
  checkMoney('totals.freight', shipment.totals.freight.value, 'Freight')
  checkMoney('totals.insurance', shipment.totals.insurance.value, 'Insurance')
  checkMoney('totals.assists', shipment.totals.assists.value, 'Assists')

  shipment.lines.forEach((line, index) => {
    checkText(`lines.${index}.description`, line.description.value, 'Description')

    if (line.countryOfOrigin.value == null) add(`lines.${index}.countryOfOrigin`, 'Country of origin is required.')
    else if (!resolveCountryCode(line.countryOfOrigin.value)) add(`lines.${index}.countryOfOrigin`, 'Unknown country; provide a valid ISO alpha-2 code.')

    if (line.htsCode.value == null) add(`lines.${index}.htsCode`, 'HTS code is required.')
    else if (!/^\d{5,10}$/.test(line.htsCode.value.replace(/\D/g, ''))) add(`lines.${index}.htsCode`, 'Enter exactly one HTS code containing 5 to 10 digits.')

    checkPositive(`lines.${index}.quantity`, line.quantity.value, 'Quantity')
    checkText(`lines.${index}.unit`, line.unit.value, 'Unit')
    if (line.unit.value != null && !/^[A-Za-z0-9]{1,10}$/.test(line.unit.value.trim())) add(`lines.${index}.unit`, 'Unit should be a short unit code, for example PCS.', 'warning')
    if (line.value.value == null) add(`lines.${index}.value`, 'Line value is required.')
    else checkMoney(`lines.${index}.value`, line.value.value, 'Line value')

    if (line.manufacturer) {
      checkText(`lines.${index}.manufacturer.name`, line.manufacturer.name.value, 'Manufacturer name', 'warning')
      checkText(`lines.${index}.manufacturer.address`, line.manufacturer.address.value, 'Manufacturer address', 'warning')
    }
  })

  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.path}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function errorPaths(issues: ValidationIssue[]): string[] {
  return [...new Set(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.path))]
}

export { isValidUsPortCode }