import type { Shipment } from './shipment.js'

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

export function normalizeDate(value: string): string {
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

  // 09/12/2026 or 12/09/2026. US customs documents use M/D/Y; fall back to D/M/Y
  // when the first part cannot be a month.
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(trimmed)
  if (match) {
    const first = Number(match[1])
    const second = Number(match[2])
    const [month, day] = first <= 12 ? [first, second] : [second, first]
    return build(Number(match[3]), month, day) ?? trimmed
  }

  return trimmed
}

export const shipmentDatePaths = ['invoice.date', 'transport.arrivalDate', 'entry.date'] as const

export function normalizeShipmentDates(shipment: Shipment): void {
  for (const path of shipmentDatePaths) {
    const keys = path.split('.')
    const target = keys.slice(0, -1).reduce<Record<string, unknown>>((current, key) => current[key] as Record<string, unknown>, shipment as unknown as Record<string, unknown>)
    const field = target[keys.at(-1)!] as { value: string | null }
    if (typeof field.value === 'string') field.value = normalizeDate(field.value)
  }
}
