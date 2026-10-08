// NetCHB code reference and normalization.
//
// The NetCHB entry XSD requires machine codes, while extracted documents and
// the review UI use human-readable values:
//   - processing-port / entry-port / unlading-port: 4-digit CBP port codes
//     (CBP Schedule D). NetCHB docs example: <processing-port>2605</processing-port>.
//   - lading-port (port of loading): 5-digit foreign port codes.
//   - country-origin: ISO 3166-1 alpha-2 (Vietnam -> VN, Bangladesh -> BD).
//   - bond-type: XSD enumeration 00, 08, 09.
//
// Ports are resolved through the reference table below rather than a hardcoded
// single case. Add verified entries only - unknown values are surfaced for
// manual review and never guessed. Normalization runs only when rendering XML;
// the UI keeps the document text.

export type PortReference = {
  code: string
  name: string
  aliases?: string[]
}

// CBP Schedule D reference (U.S. ports). Extend with verified codes as needed.
export const cbpPorts: PortReference[] = [
  { code: '3001', name: 'Seattle', aliases: ['seattle, wa', 'seattle wa'] },
  { code: '3002', name: 'Tacoma', aliases: ['tacoma, wa', 'tacoma wa'] },
]

// CBP Schedule K reference (foreign ports, 5-digit). Cat Lai is a terminal
// within Ho Chi Minh Port, which Schedule K lists as 55224.
export const cbpForeignPorts: PortReference[] = [
  { code: '55224', name: 'Ho Chi Minh City', aliases: ['saigon', 'thanh pho ho chi minh', 'ho chi minh', 'hcmc', 'cat lai', 'vnsgn', 'vnclp', 'vncli'] },
  { code: '55200', name: 'All Other Viet Nam Ports', aliases: ['vietnam', 'viet nam'] },
]

export const countryCodes: Record<string, string> = {
  vietnam: 'VN',
  bangladesh: 'BD',
  china: 'CN',
  'hong kong': 'HK',
  taiwan: 'TW',
  india: 'IN',
  thailand: 'TH',
  indonesia: 'ID',
  malaysia: 'MY',
  cambodia: 'KH',
  'south korea': 'KR',
  korea: 'KR',
  japan: 'JP',
  mexico: 'MX',
  canada: 'CA',
  germany: 'DE',
  'united kingdom': 'GB',
  uk: 'GB',
  italy: 'IT',
  france: 'FR',
  spain: 'ES',
  turkey: 'TR',
  pakistan: 'PK',
  'sri lanka': 'LK',
  philippines: 'PH',
  singapore: 'SG',
  'united arab emirates': 'AE',
  brazil: 'BR',
}

// Bond types: XSD enumeration is 00, 08, 09. Labels map to the documented
// code; 09 is the single-transaction value and is used in fixtures only as a
// clearly marked demo value, never invented for a real shipment.
export const bondTypeCodes = ['00', '08', '09'] as const
export type BondTypeCode = typeof bondTypeCodes[number]

// CBP entry type codes (data_type.xsd entryType enumeration).
export const entryTypeCodes = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
  '20', '21', '22', '23', '24', '25', '26',
  '30', '31', '32', '33', '34', '38',
  '40', '41', '42', '43', '44', '45', '46',
  '50', '51', '52',
  '60', '61', '62', '63', '64', '65', '66',
  '86',
] as const

const bondTypeLabels: Record<string, string> = {
  'no bond': '00',
  unsecured: '00',
  continuous: '08',
  'continuous bond': '08',
  single: '09',
  'single transaction': '09',
  'single entry': '09',
}

const portsByName = new Map<string, string>()
for (const port of cbpPorts) {
  portsByName.set(port.name.toLowerCase(), port.code)
  for (const alias of port.aliases ?? []) portsByName.set(alias.toLowerCase(), port.code)
}

const foreignPortsByName = new Map<string, string>()
for (const port of cbpForeignPorts) {
  foreignPortsByName.set(port.name.toLowerCase(), port.code)
  for (const alias of port.aliases ?? []) foreignPortsByName.set(alias.toLowerCase(), port.code)
}

export function isValidUsPortCode(value: string): boolean {
  return /^\d{4}$/.test(value.trim())
}

export function isValidForeignPortCode(value: string): boolean {
  return /^\d{5}$/.test(value.trim())
}

export function isValidCountryCode(value: string): boolean {
  return /^[A-Za-z]{2}$/.test(value.trim())
}

export function isValidBondType(value: string): value is BondTypeCode {
  return (bondTypeCodes as readonly string[]).includes(value.trim())
}

export function isValidEntryType(value: string): boolean {
  return (entryTypeCodes as readonly string[]).includes(value.trim())
}

export function resolvePortCode(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (isValidUsPortCode(trimmed)) return trimmed
  // Documents and models often return "Tacoma, WA" or "Tacoma, WA, U.S.A.".
  // Match the full string first, then the leading city before a comma or slash.
  const candidates = [trimmed, trimmed.split(',')[0], trimmed.split(/[/(]/)[0]]
  for (const candidate of candidates) {
    const key = candidate.trim().toLowerCase().replace(/[.]$/, '')
    const code = portsByName.get(key)
    if (code) return code
  }
  return null
}

export function resolveForeignPortCode(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (isValidForeignPortCode(trimmed)) return trimmed
  // Match "Cat Lai, HCMC, VN" or "Ho Chi Minh City" against Schedule K names.
  const candidates = [trimmed, trimmed.split(',')[0], trimmed.split(/[/(]/)[0]]
  for (const candidate of candidates) {
    const key = candidate.trim().toLowerCase().replace(/[.]$/, '')
    const code = foreignPortsByName.get(key)
    if (code) return code
  }
  return null
}

export function resolveCountryCode(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (isValidCountryCode(trimmed)) return trimmed.toUpperCase()
  return countryCodes[trimmed.toLowerCase()] ?? null
}

export function resolveBondType(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (isValidBondType(trimmed)) return trimmed
  return bondTypeLabels[trimmed.toLowerCase()] ?? null
}
