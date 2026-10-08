import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ExtractionRequest } from './extraction.js'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const maxPdfPages = 10
export const maxDocuments = 10
export const maxDocumentBytes = 15 * 1024 * 1024
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function isSupportedDocument(file: File): boolean {
  return file.type === 'application/pdf' || imageMimeTypes.has(file.type) || file.type.startsWith('text/') || file.name.endsWith('.csv')
}

function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read document image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

async function renderPage(page: PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to render PDF page.')

  await page.render({ canvas, canvasContext: context, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.85)
}

async function readPdf(file: File): Promise<ExtractionRequest['documents'][number]> {
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const textParts: string[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    textParts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }

  const text = textParts.join('\n').trim()
  if (text.length >= 100) return { name: file.name, text }

  const pages = await Promise.all(
    Array.from({ length: Math.min(document.numPages, maxPdfPages) }, async (_, index) => renderPage(await document.getPage(index + 1))),
  )
  return { name: file.name, images: pages }
}

export async function prepareDocuments(files: File[]): Promise<ExtractionRequest> {
  if (!files.length) throw new Error('Select at least one shipment document.')
  if (files.length > maxDocuments) throw new Error(`Upload at most ${maxDocuments} documents at a time.`)
  const unsupported = files.find((file) => !isSupportedDocument(file))
  if (unsupported) throw new Error(`${unsupported.name} is not a supported document format.`)
  const oversized = files.find((file) => file.size > maxDocumentBytes)
  if (oversized) throw new Error(`${oversized.name} exceeds the 15 MB document limit.`)

  return {
    documents: await Promise.all(files.map(async (file) => {
      if (file.type === 'application/pdf') return readPdf(file)
      if (imageMimeTypes.has(file.type)) return { name: file.name, images: [await toDataUrl(file)] }
      return { name: file.name, text: await file.text() }
    })),
  }
}
