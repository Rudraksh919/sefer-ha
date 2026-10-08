import { describe, expect, it } from 'vitest'
import { isSupportedDocument } from '../src/lib/document-input'

const file = (name: string, type: string) => ({ name, type }) as File

describe('document input', () => {
  it('accepts PDFs, images, text, and CSV documents', () => {
    expect(isSupportedDocument(file('invoice.pdf', 'application/pdf'))).toBe(true)
    expect(isSupportedDocument(file('packing-list.png', 'image/png'))).toBe(true)
    expect(isSupportedDocument(file('notes.txt', 'text/plain'))).toBe(true)
    expect(isSupportedDocument(file('lines.csv', 'application/octet-stream'))).toBe(true)
  })

  it('rejects unsupported document formats', () => {
    expect(isSupportedDocument(file('shipment.exe', 'application/octet-stream'))).toBe(false)
  })
})
