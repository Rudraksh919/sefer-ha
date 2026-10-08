import { describe, expect, it } from 'vitest'
import { resolveBondType, resolveCountryCode, resolveForeignPortCode, resolvePortCode } from '../src/lib/netchb-codes'

describe('NetCHB code resolution', () => {
  it('resolves known CBP port names and passes through 4-digit codes', () => {
    expect(resolvePortCode('Seattle')).toBe('3001')
    expect(resolvePortCode('Tacoma')).toBe('3002')
    expect(resolvePortCode('TACOMA, WA')).toBe('3002')
    expect(resolvePortCode('Tacoma, WA, U.S.A.')).toBe('3002')
    expect(resolvePortCode('3001')).toBe('3001')
    expect(resolvePortCode('Cat Lai')).toBeNull()
  })


  it('resolves ISO alpha-2 country codes and passes them through', () => {
    expect(resolveCountryCode('Vietnam')).toBe('VN')
    expect(resolveCountryCode('Bangladesh')).toBe('BD')
    expect(resolveCountryCode('vn')).toBe('VN')
    expect(resolveCountryCode('Atlantis')).toBeNull()
  })

  it('keeps bond types inside the XSD enumeration only', () => {
    expect(resolveBondType('00')).toBe('00')
    expect(resolveBondType('08')).toBe('08')
    expect(resolveBondType('single')).toBe('09')
    expect(resolveBondType('Continuous')).toBe('08')
    expect(resolveBondType('mystery')).toBeNull()
  })

  it('resolves foreign ports to Schedule K codes and passes through 5-digit codes', () => {
    expect(resolveForeignPortCode('12345')).toBe('12345')
    expect(resolveForeignPortCode('Cat Lai, HCMC, VN')).toBe('55224')
    expect(resolveForeignPortCode('Ho Chi Minh City')).toBe('55224')
    expect(resolveForeignPortCode('Atlantis')).toBeNull()
  })
})
