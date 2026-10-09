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

async function renderPage(page: PDFPageProxy, scale: number, quality: number): Promise<string> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to render PDF page.')

  await page.render({ canvas, canvasContext: context, viewport }).promise
  return canvas.toDataURL('image/jpeg', quality)
}

// Text items come with positions: start a new line whenever the baseline moves so labels stay next to their values.
function pageText(items: Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>): string {
  let text = ''
  let lastY: number | null = null
  for (const item of items) {
    if (item.str === undefined) continue
    const y = item.transform?.[5] ?? 0
    const separator = lastY === null ? '' : Math.abs(y - lastY) > 2 ? '\n' : ' '
    text += separator + item.str
    lastY = y
  }
  return text
}

async function readPdf(file: File): Promise<ExtractionRequest['documents'][number]> {
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const textParts: string[] = []
  const images: string[] = []

  // Scans (no text layer) go as high-resolution images so handwriting and stamps stay legible. Digital pages go as
  // exact text plus a light image, because a text layer loses the table layout that ties labels to values.
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPdfPages); pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const text = pageText((await page.getTextContent()).items as Parameters<typeof pageText>[0]).trim()
    const digital = text.length >= 40
    if (digital) textParts.push(`--- page ${pageNumber} ---\n${text}`)
    images.push(await (digital ? renderPage(page, 1.5, 0.8) : renderPage(page, 2.5, 0.92)))
  }

  return { name: file.name, ...(textParts.length ? { text: textParts.join('\n') } : {}), ...(images.length ? { images } : {}) }
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
