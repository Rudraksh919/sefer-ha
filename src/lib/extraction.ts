import { z } from 'zod'
import { reconcileConflicts } from './conflicts.js'
import { normalizeShipmentDates } from './dates.js'
import { sanitizeTransportPorts } from './sanitize.js'
import { shipmentSchema, type Shipment } from './shipment.js'

const documentSchema = z.object({
  name: z.string().min(1).max(255).refine((name) => /\.(pdf|png|jpe?g|webp|txt|csv)$/i.test(name), {
    message: 'Unsupported document filename.',
  }),
  text: z.string().max(100_000).optional(),
  images: z.array(z.string().startsWith('data:image/').max(15 * 1024 * 1024)).max(20).optional(),
}).refine((document) => document.text || document.images?.length, {
  message: 'A document needs extracted text or at least one image.',
})

export const extractionRequestSchema = z.object({
  documents: z.array(documentSchema).min(1).max(10),
})

export type ExtractionRequest = z.infer<typeof extractionRequestSchema>

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

const extractionInstructions = `You extract US customs-entry shipment data from shipping documents. Return only JSON that matches the provided schema.

Golden rule: populate a field only when a document explicitly states that exact customs concept. Never map a similar-looking value from a different concept. When the documents do not state a field, use {"value":null,"confidence":0}. Never invent, derive, or assume values.

Do NOT map these confusions:
- A bill-of-lading or invoice "Type of Move", "Service Type", "CFS / DOOR", "CY/CY", "Door", "Port to Door" value is not entry.type. entry.type is the 2-digit CBP entry type code (for example 01 = consumption). Use null unless that code is stated.
- "Shipped on Board", "On Board", "Departure", or sailing dates are not entry.date or arrivalDate. entry.date is the CBP entry filing date; arrivalDate is the vessel arrival date at the US port. Use null when they are not stated.
- A carrier, forwarder, booking, or reference number is not invoice.number or billOfLading unless it is explicitly labeled as that.
- An Incoterm or shipment move value is not bondType.

Field formats:
- Dates: YYYY-MM-DD.
- entry.type: 2-digit CBP entry type code only.
- bondType: one of 00, 08, or 09.
- countryOfOrigin: country name (for example "Vietnam").
- HTS: exactly one HTS code per line, digits only (for example "610910").

Ports (keep the human-readable port name; the application maps names to codes):
- processingPort: the 4-digit U.S. CBP port that will process the entry. This is always a U.S. port. NEVER use the foreign port of loading or discharge here. Use null if the documents do not state a U.S. processing port.
- entryPort: the 4-digit CBP Schedule D U.S. port of entry (where the goods enter the United States).
- dischargePort: the U.S. port where the vessel unloads.
- loadingPort: the FOREIGN port of loading (for example "Cat Lai, HCMC, VN" or "Ho Chi Minh City"). This is not a U.S. port and must never be used for processingPort or entryPort.

Freight and insurance: read totals.freight and totals.insurance from the commercial invoice when it itemizes freight and insurance charges (for example "Freight USD 3850", "Insurance USD 185"). Use null when the invoice does not itemize them.

Assists: if documents mention buyer-supplied, free-of-charge, or no-charge materials, tooling, or components (possible assists), do NOT populate totals.assists. Instead add a review flag, for example {"field":"totals.assists","message":"Buyer-supplied material detected; review whether it is a dutiable assist."}. Populate totals.assists only when the entry explicitly states an assist amount.

Confidence: use 0.9 to 1.0 only when a document states the value for that exact concept; use 0.3 to 0.6 when the mapping is uncertain or inferred from context; use 0 when the value is unknown.

Also record an "observations" array: one entry per identifier value you see, with the field path, the raw value, and the source document name, for example {"field":"invoice.number","value":"INV-1","document":"invoice.pdf"}. Include observations for invoice number, bill of lading, processing port, entry port, port of discharge, importer tax id, entry type, bond type, and each line's HTS code, country of origin, and value whenever they appear. Report the values exactly as written even when documents disagree; the application detects conflicts by comparing them.

Do not generate XML. Extract only facts visible in the documents.`

function parseModelJson(content: string): unknown {
  const json = content.trim().replace(/^```json\s*|\s*```$/g, '')
  return JSON.parse(json)
}

export async function extractShipment(
  request: ExtractionRequest,
  apiKey: string,
  model = 'openrouter/free',
  fetcher: typeof fetch = fetch,
): Promise<Shipment> {
  const content = request.documents.flatMap((document) => [
    { type: 'text', text: `Document: ${document.name}\n${document.text ?? ''}` },
    ...(document.images ?? []).map((image) => ({ type: 'image_url', image_url: { url: image } })),
  ])

  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: extractionInstructions },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Shipment JSON schema:\n${JSON.stringify(z.toJSONSchema(shipmentSchema))}` },
            ...content,
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter extraction failed (${response.status}).`)
  }

  const data = await response.json() as ChatResponse
  const contentText = data.choices?.[0]?.message?.content
  if (!contentText) {
    throw new Error('OpenRouter returned no extraction result.')
  }

  const shipment = shipmentSchema.parse(parseModelJson(contentText))
  normalizeShipmentDates(shipment)
  sanitizeTransportPorts(shipment)
  return { ...shipment, conflicts: reconcileConflicts(shipment) }
}
