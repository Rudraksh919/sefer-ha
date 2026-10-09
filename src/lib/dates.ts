import { addFlag, type Shipment } from './shipment.js'

// Date normalization.
//
// Documents and models produce dates in many formats (09/12/2026, 12-Sep-2026,
// 20260912, 2026/09/12). The NetCHB XSD requires YYYY-MM-DD. Values are
// normalized to ISO when recognizable; anything unrecognizable is left as-is so
// it is surfaced for manual review instead of silently failing the extraction.

const months: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function monthNumber(name: string): string | undefined {
  const lower = name.toLowerCase()
  return months[lower.slice(0, 4)] ?? months[lower.slice(0, 3)]
}

function build(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return false
  return build(Number(match[1]), Number(match[2]), Number(match[3])) !== null
}

const slashDate = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/

// 12/09/2026 is ambiguous (December 9 or September 12) when both parts could be a month.
export function isAmbiguousDate(value: string): boolean {
  const match = slashDate.exec(value.trim())
  return !!match && Number(match[1]) <= 12 && Number(match[2]) <= 12 && match[1] !== match[2]
}

// `notAfter` (an ISO date) resolves ambiguity: pick the reading that does not fall after it, closest first.
export function normalizeDate(value: string, notAfter?: string): string {
  const trimmed = value.trim()
  if (isIsoDate(trimmed)) return trimmed

  // 20260912
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed)
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3])) ?? trimmed

  // 2026-9-12, 2026/09/12, 2026.09.12
  match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed)
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3])) ?? trimmed

  // 12-Sep-2026, 12 Sep 2026, 12 Sept 2026
  match = /^(\d{1,2})[- ]([A-Za-z]{3,})[- ,]+(\d{4})$/.exec(trimmed)
  if (match) {
    const month = monthNumber(match[2])
    if (month) return build(Number(match[3]), Number(month), Number(match[1])) ?? trimmed
  }

  // Sep 12, 2026 / September 12 2026
  match = /^([A-Za-z]{3,})[- ](\d{1,2})[- ,]+(\d{4})$/.exec(trimmed)
  if (match) {
    const month = monthNumber(match[1])
    if (month) return build(Number(match[3]), Number(month), Number(match[2])) ?? trimmed
  }

  // 09/12/2026 or 12/09/2026: M/D/Y unless the first part cannot be a month or `notAfter` rules it out.
  match = slashDate.exec(trimmed)
  if (match) {
    const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
    // Readings that are real dates, M/D first; a part above 12 can only be the day.
    const readings = [build(year, first, second), build(year, second, first)].filter((date): date is string => date !== null)
    const plausible = readings.filter((date) => !notAfter || date <= notAfter)
    const pick = plausible.length ? plausible : readings
    return (notAfter ? pick[pick.length - 1] : pick[0]) ?? trimmed
  }

  return trimmed
}

export const shipmentDatePaths = ['invoice.date', 'transport.arrivalDate', 'entry.date'] as const

export function normalizeShipmentDates(shipment: Shipment): void {
  // Arrival is normalized first: an invoice cannot be dated after the goods arrive.
  const order = ['transport.arrivalDate', 'invoice.date', 'entry.date'] as const
  for (const path of order) {
    const keys = path.split('.')
    const target = keys.slice(0, -1).reduce<Record<string, unknown>>((current, key) => current[key] as Record<string, unknown>, shipment as unknown as Record<string, unknown>)
    const field = target[keys.at(-1)!] as { value: string | null }
    if (typeof field.value !== 'string') continue
    const raw = field.value
    field.value = normalizeDate(raw, path === 'invoice.date' ? shipment.transport.arrivalDate.value ?? undefined : undefined)
    if (isAmbiguousDate(raw)) addFlag(shipment, path, `Date "${raw}" is ambiguous (day/month vs month/day); read as ${field.value}. Confirm it.`)
  }
}

const dateToken = String.raw`(\d{1,2}[-/. ][A-Za-z]{3,9}[-/. ,]+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})`
const etaPatterns = [
  // "ETD / ETA: ... 24-SEP-2026 / 14-OCT-2026": the second date is the ETA.
  { pattern: new RegExp(String.raw`ETD\s*[/&,]\s*ETA[\s\S]{0,120}?${dateToken}\s*[/&,-]\s*${dateToken}`, 'i'), group: 2 },
  { pattern: new RegExp(String.raw`\bETA\b\s*[:\-]?\s*${dateToken}`, 'i'), group: 1 },
]

// Fallback for when the model returns no arrival date although a document's text states an ETA.
export function findArrivalDate(texts: string[]): string | null {
  for (const text of texts) {
    for (const { pattern, group } of etaPatterns) {
      const match = pattern.exec(text)
      const date = match ? normalizeDate(match[group]) : null
      if (date && isIsoDate(date)) return date
    }
  }
  return null
}
