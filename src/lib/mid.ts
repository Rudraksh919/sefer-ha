import { findCountryCode, resolveCountryCode } from './netchb-codes.js'
import type { Shipment } from './shipment.js'

// CBP Manufacturer Identification Code (MID), built from the manufacturer's
// details: country + first 3 letters of the first two name words + the leading
// address digits (max 4) + first 3 letters of the city.
export function buildMid(country: string | null, name: string | null, address: string | null, city: string | null): string | null {
  if (!country || !name || !address || !city) return null
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  const cityLetters = city.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  const cityAt = address.toLowerCase().indexOf(city.toLowerCase())
  const street = cityAt > 0 ? address.slice(0, cityAt) : address
  const digits = street.replace(/\D/g, '').slice(0, 4)
  if (!words.length || !cityLetters) return null
  return `${country}${words.slice(0, 2).map((word) => word.slice(0, 3)).join('')}${digits}${cityLetters}`.slice(0, 15)
}


// The MID's country is the manufacturer's (from its address), falling back to the line's origin.
// A well-formed MID typed by the user (or stated on a document) wins over the derived one.
export function lineMid(line: Shipment['lines'][number]): { mid: string; derived: boolean } | null {
  const manual = line.manufacturer?.mid?.value?.trim().toUpperCase()
  if (manual && /^[A-Z]{2}[A-Z0-9]{1,13}$/.test(manual)) return { mid: manual, derived: false }
  const mid = buildMid(findCountryCode(line.manufacturer?.address.value) ?? resolveCountryCode(line.countryOfOrigin.value), line.manufacturer?.name.value ?? null, line.manufacturer?.address.value ?? null, line.manufacturer?.city?.value ?? null)
  return mid ? { mid, derived: true } : null
}
