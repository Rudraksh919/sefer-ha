import { scheduleD, scheduleK } from './ports-data.js'

// NetCHB code reference and normalization.
//
// The NetCHB entry XSD requires machine codes, while extracted documents and
// the review UI use human-readable values:
//   - processing-port / entry-port / unlading-port: 4-digit CBP port codes
//     (CBP Schedule D). NetCHB docs example: <processing-port>2605</processing-port>.
//   - lading-port (port of loading): 5-digit foreign port codes (CBP Schedule K).
//   - country-origin: ISO 3166-1 alpha-2 (Vietnam -> VN, Bangladesh -> BD).
//   - bond-type: XSD enumeration 00, 08, 09.
//
// Ports are resolved through the reference table below rather than a hardcoded
// single case. Add verified entries only - unknown values are surfaced for
// manual review and never guessed. Normalization runs only when rendering XML;
// the UI keeps the document text.

// Port tables come from the official CBP lists (see ports-data.ts). The extras below
// are well-known names that Schedule D/K lists differently or not at all.
const extraUsPorts: Array<[string, string]> = [['4601', 'New York/Newark Area']]
const extraForeignPorts: Array<[string, string, string]> = [
  ['55224', 'Cat Lai; Cat Lai Terminal; HCMC; Saigon Newport; VNSGN; VNCLP; VNCLI', 'Vietnam'],
  ['55201', 'Hai Phong; Haiphong Port; VNHPH', 'Vietnam'],
]

// Name -> codes (a name shared by several ports keeps all of them so ambiguity is detectable).
function index<T extends [string, string, ...string[]]>(rows: T[], names: (row: T) => string[]): Map<string, Array<{ code: string; row: T }>> {
  const map = new Map<string, Array<{ code: string; row: T }>>()
  for (const row of rows) {
    for (const name of names(row)) {
      const key = normalizePortName(name)
      if (key && !map.get(key)?.some((entry) => entry.code === row[0])) map.set(key, [...(map.get(key) ?? []), { code: row[0], row }])
    }
  }
  return map
}

function normalizePortName(name: string): string {
  return name.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim()
}

const usPortsByName = index([...scheduleD, ...extraUsPorts], ([, name]) => {
  const city = name.split(',')[0]
  return [name, city, name.replace(/,\s*/g, ' ')]
})
const foreignPortsByName = index([...scheduleK, ...extraForeignPorts], ([, name, country]) => name.split(';').flatMap((alias) => [alias, `${alias}, ${country}`]))

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

// "Tacoma, WA, U.S.A.", "TACOMA WA", "Tacoma", "Cat Lai, HCMC, VN": try the whole string, then the
// leading pieces (city, then city + state/country), and accept only an unambiguous match.
function lookup(map: Map<string, Array<{ code: string; row: string[] }>>, value: string, countryOf?: (row: string[]) => string): string | null {
  const pieces = value.trim().split(/[,/(]/).map((piece) => piece.trim()).filter(Boolean)
  const candidates = [value, pieces.slice(0, 2).join(' '), pieces[0], ...pieces.slice(1)].filter((candidate): candidate is string => !!candidate)
  for (const candidate of candidates) {
    const matches = map.get(normalizePortName(candidate))
    if (!matches) continue
    if (new Set(matches.map((match) => match.code)).size === 1) return matches[0].code
    // Several ports share the name (for example two "Santos"): use a country named in the text.
    const byCountry = matches.filter((match) => countryOf && normalizePortName(value).includes(normalizePortName(countryOf(match.row))))
    if (byCountry.length === 1) return byCountry[0].code
  }
  return null
}

export function resolvePortCode(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return isValidUsPortCode(trimmed) ? trimmed : lookup(usPortsByName, trimmed)
}

export function resolveForeignPortCode(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return isValidForeignPortCode(trimmed) ? trimmed : lookup(foreignPortsByName, trimmed, (row) => row[2] ?? '')
}

const regionNames = new Intl.DisplayNames('en', { type: 'region' })
const countriesByName = new Map<string, string>()
for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const second of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = first + second
    const name = regionNames.of(code)
    if (name && name !== code) countriesByName.set(name.toLowerCase(), code)
  }
}
for (const [alias, code] of Object.entries({
  'viet nam': 'VN', korea: 'KR', 'south korea': 'KR', 'republic of korea': 'KR', russia: 'RU', turkey: 'TR', uk: 'GB', 'great britain': 'GB', england: 'GB',
  usa: 'US', america: 'US', 'united states of america': 'US', china: 'CN', "people's republic of china": 'CN', prc: 'CN', 'hong kong sar china': 'HK', 'hong kong': 'HK', macau: 'MO',
  czechia: 'CZ', 'czech republic': 'CZ', uae: 'AE', burma: 'MM', laos: 'LA', 'ivory coast': 'CI', taiwan: 'TW', 'türkiye': 'TR', holland: 'NL',
})) countriesByName.set(alias, code)

export function resolveCountryCode(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (isValidCountryCode(trimmed)) return trimmed.toUpperCase()
  return countriesByName.get(trimmed.toLowerCase().replace(/^made in\s+/, '')) ?? null
}

export function resolveBondType(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (isValidBondType(trimmed)) return trimmed
  return bondTypeLabels[trimmed.toLowerCase()] ?? null
}

const packageUnits: Record<string, string> = {
  carton: 'CTN', cartons: 'CTN', ctn: 'CTN', ctns: 'CTN',
  pallet: 'PLT', pallets: 'PLT', plt: 'PLT',
  package: 'PKG', packages: 'PKG', pkg: 'PKG', pkgs: 'PKG',
  piece: 'PCS', pieces: 'PCS', pcs: 'PCS',
  case: 'CS', cases: 'CS', bale: 'BL', bales: 'BL', bag: 'BG', bags: 'BG', drum: 'DR', drums: 'DR', box: 'BX', boxes: 'BX',
}

// Manifest quantity unit (max 5 chars); falls back to the generic PKG.
export function resolvePackageUnit(value: string | null | undefined): string {
  const key = value?.trim().toLowerCase() ?? ''
  return packageUnits[key] ?? 'PKG'
}

// Unit-of-measure codes accepted by the XSD (unitOfMeasureType), and common invoice spellings of them.
const xsdUnits = new Set('AC ASTM BBL C CAR CC CG CGM CKG CLR CM CM2 CM3 CTN CU CUR CY CYG CYK D DC DEG DOZ DPC DPR FIB FBM G GBQ GR GRL GVW HUN HZ IRC JWL K KCAL KG KHZ KL KM KM2 KM3 KN KPA KSB KVA KVAR KW KWH L LIN LNM M MBQ MC MG MHZ ML MM MPA M2 M3 NO ODE PCS PF PFG PFL PK PRS RPM SBE SQ T V W WG WL WT X'.split(' '))
const unitAliases: Record<string, string> = {
  pc: 'PCS', piece: 'PCS', pieces: 'PCS', ea: 'NO', each: 'NO', nos: 'NO', unit: 'NO', units: 'NO',
  pr: 'PRS', pair: 'PRS', pairs: 'PRS', dozen: 'DOZ', dz: 'DOZ', dzn: 'DOZ',
  kgs: 'KG', kilo: 'KG', kilogram: 'KG', kilograms: 'KG', gram: 'G', grams: 'G', gm: 'G',
  mt: 'T', ton: 'T', tons: 'T', tonne: 'T', tonnes: 'T',
  mtr: 'M', meter: 'M', meters: 'M', metre: 'M', metres: 'M', sqm: 'M2', cbm: 'M3',
  ltr: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  ctns: 'CTN', carton: 'CTN', cartons: 'CTN', pack: 'PK', packs: 'PK', pkg: 'PK',
}

// Returns an XSD unit code for an invoice unit, or null when it cannot be mapped (never guessed).
export function resolveUnit(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase().replace(/[.]/g, '') ?? ''
  const upper = key.toUpperCase()
  return unitAliases[key] ?? (xsdUnits.has(upper) ? upper : null)
}

// ISO 6346: letters are valued 10-38 skipping multiples of 11 (the '?' slots), weighted by 2^position, mod 11 (10 -> 0).
export function containerCheckDigit(container: string): number {
  const sum = [...container.slice(0, 10)].reduce((total, character, position) => {
    return total + '0123456789A?BCDEFGHIJK?LMNOPQRSTU?VWXYZ'.indexOf(character) * 2 ** position
  }, 0)
  return (sum % 11) % 10
}

// A container number with the right shape and a matching ISO 6346 check digit.
export function isValidContainer(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{4}\d{7}$/.test(compact) && containerCheckDigit(compact) === Number(compact[10])
}

// A country named in free text such as an address ("Plot 41, Gazipur, Bangladesh" -> BD). Longest name wins
// ("Papua New Guinea" before "Guinea").
// ponytail: "Georgia" is skipped because it is far more often the U.S. state; add a smarter check if that matters.
const countryNamesLongestFirst = [...countriesByName.keys()].filter((name) => name.length >= 4 && name !== 'georgia').sort((a, b) => b.length - a.length)

export function findCountryCode(text: string | null | undefined): string | null {
  const haystack = ` ${(text ?? '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `
  const name = countryNamesLongestFirst.find((candidate) => haystack.includes(` ${candidate} `))
  return name ? countriesByName.get(name)! : null
}
