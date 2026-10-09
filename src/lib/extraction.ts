import { z } from 'zod'
import { reconcileConflicts } from './conflicts.js'
import { findArrivalDate, normalizeShipmentDates } from './dates.js'
import { applyEntryDefaults } from './derive.js'
import { sanitizeTransportPorts } from './sanitize.js'
import { addFlag, shipmentSchema, type Shipment } from './shipment.js'

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

// Pin a vision-capable model for repeatable results; openrouter/free routes to a different model each call.
const retryAttempts = 4
const retryDelayMs = 4000
export const defaultModel = 'google/gemini-2.5-flash'

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

const extractionInstructions = `You extract US customs-entry shipment data from shipping documents. Return only JSON that matches the provided schema.

Golden rule: populate a field only when a document states that exact customs concept, or states it in an unambiguous different wording. Never map a similar-looking value from a different concept. When the documents do not state a field, use {"value":null,"confidence":0}. Never invent or assume values. The application fills in defaults for entry type, entry date, processing port and entry port, so leave those null unless a document states them.

Do NOT map these confusions:
- A bill-of-lading or invoice "Type of Move", "Service Type", "CFS / DOOR", "CY/CY", "Door", "Port to Door" value is not entry.type. entry.type is the 2-digit CBP entry type code (for example 01 = consumption). Use null unless that code is stated.
- "Shipped on Board", "On Board", "Departure", or sailing dates are not entry.date or arrivalDate. entry.date is the CBP entry filing date; arrivalDate is the vessel arrival date at the US port. Use null when they are not stated.
- A booking, purchase-order, or reference number is not invoice.number or billOfLading unless it is explicitly labeled as that.
- An Incoterm or shipment move value is not bondType.
- The document's shipper is not the importer. The importer is the buyer / "sold to" / bill-to party that will import the goods into the U.S.; the ultimate consignee is the "ship to / deliver to / consignee" party. They may be the same company.

Field formats:
- Dates: YYYY-MM-DD.
- entry.type: 2-digit CBP entry type code only.
- bondType: one of 00, 08, or 09.
- countryOfOrigin: country name (for example "Vietnam").
- HTS: exactly one HTS code per line, digits only, exactly as written in the documents; never pad or invent digits (for example "610910").

Ports (keep the human-readable port name; the application maps names to codes):
- processingPort: the 4-digit U.S. CBP port that will process the entry. This is always a U.S. port. NEVER use the foreign port of loading or discharge here. Use null if the documents do not state a U.S. processing port.
- entryPort: the 4-digit CBP Schedule D U.S. port of entry (where the goods enter the United States).
- dischargePort: the U.S. port where the vessel unloads.
- loadingPort: the FOREIGN port of loading (for example "Shanghai, CN" or "Rotterdam"). This is not a U.S. port and must never be used for processingPort or entryPort.

Freight and insurance: read totals.freight and totals.insurance from the commercial invoice when it itemizes freight and insurance charges (for example "Freight USD 3850", "Insurance USD 185"). Use null when the invoice does not itemize them.

Assists: when an invoice or packing list says materials, tooling, or components were supplied by the buyer free of charge or at no charge (a possible assist) AND states their value, put that value in the assist field of the line item that uses them (lines[n].assist) and add a review flag such as {"field":"lines.3.assist","message":"Buyer-supplied material valued at USD X; confirm it is a dutiable assist."}. If no value is stated, only add the flag. Leave totals.assists null unless a document states a total assist amount that cannot be tied to a line.
Free-of-charge or no-commercial-value items (samples): use the "value for customs purposes" if one is stated, otherwise use null, and add a review flag.

Matching and conflicts: match packing-list rows to invoice lines by style or item number before comparing anything. A remark about one style or carton (for example "made in X") applies only to that style and must never be attached to a different line. Report a conflict only when two documents explicitly give different values for the same item. A line's manufacturer must be in that line's country of origin unless a document says otherwise: when most lines come from one factory but a note names a different factory (and country) for one style, assign the different factory only to that style.

Totals: totals.grossWeight is the bill of lading's gross weight when one is shown (the entry weight must match the manifest); use the packing list only when there is no bill of lading. totals.packages is the number of packages on the bill of lading, otherwise on the packing list. When the bill of lading and packing list disagree on weight or package count, report both as observations so the difference is shown.

Per-line data: each line's description is the goods name only (for example "Men's crew neck T-shirt"), without composition, colours, size ratios, or notes. For each invoice line also read grossWeight (kg) from the packing list for the same style/item when a per-item gross weight is given (total gross weight of that line, not per carton). Match packing-list rows to invoice lines by style number or description.

Manufacturer: the manufacturer is the party that made the goods. Use the factory named as "manufactured by", the packing-list or bill-of-lading shipper/exporter when it is a factory (not a trading company or "on behalf of" agent), or a factory named in a note for that item. Different lines can have different manufacturers (for example a note saying an item was made by a sister factory in another country). Fill manufacturer.name, manufacturer.address, and manufacturer.city (the town or city named in the address, not a province or state; for example "Essen"). Put a factory tax or registration number in manufacturer.taxId, and use manufacturer.mid only for a value explicitly labelled MID or manufacturer ID from the document. Use confidence 0.5-0.7 for an inferred manufacturer, and null when no factory is identifiable.

Corrections: if a value is crossed out and a handwritten or stamped correction is written next to it (for example a container number), use the corrected value, give it confidence 0.7, and mention the crossed-out value in a review flag; do not record the crossed-out value as an observation. Read every identifier (container, bill of lading, invoice, booking, tax numbers) character by character and do not drop or merge characters; a container number is 4 letters, 6 digits, 1 check digit.

Bills of lading: transport.billOfLading is the HOUSE bill number (the B/L No. on the document issued by the freight forwarder or NVOCC). transport.masterBill is the master bill / ocean carrier bill number when shown, transport.masterScac is the ocean carrier's 4-letter SCAC (carrier code) when shown, and transport.houseScac is the issuer's SCAC when shown. If the document gives only one bill number, it is the house bill. transport.packageUnit is the package type written on the bill of lading or packing list for the package count (for example "CARTONS", "PALLETS").

Arrival date: transport.arrivalDate is the vessel's arrival (ETA) date at the U.S. port; an "ETA" on the invoice or any other document is that date, and the departure (ETD) or shipped-on-board date is not.

Dates: always output YYYY-MM-DD. For numeric dates like 12/09/2026, decide day/month order from the other dates in the documents (an invoice cannot be dated after the shipment arrives, and ETD/ETA or "shipped on board" dates give the order); documents from outside the United States usually write day/month/year.

Confidence: use 0.9 to 1.0 only when a document states the value for that exact concept; use 0.3 to 0.6 when the mapping is uncertain or inferred from context; use 0 when the value is unknown.

Also record an "observations" array: one entry per identifier value you see, with the field path, the raw value, and the source document name, for example {"field":"invoice.number","value":"INV-1","document":"invoice.pdf"}. Include observations for invoice number, bill of lading, container numbers, processing port, entry port, port of discharge, importer tax id, entry type, bond type, total packages, total gross weight, and each line's HTS code, country of origin, quantity, and value whenever they appear in more than one place. Use dotted zero-based paths for lines, for example "lines.0.quantity" (never "lines[0].quantity"). Report the values exactly as written even when documents disagree; the application detects conflicts by comparing them.

Do not generate XML. Extract only facts visible in the documents.`

function parseModelJson(content: string): unknown {
  const json = content.trim().replace(/^```json\s*|\s*```$/g, '')
  return JSON.parse(json)
}

export async function extractShipment(
  request: ExtractionRequest,
  apiKey: string,
  model = defaultModel,
  fetcher: typeof fetch = fetch,
): Promise<Shipment> {
  const content = request.documents.flatMap((document) => [
    { type: 'text', text: `Document: ${document.name}\n${document.text ?? ''}` },
    ...(document.images ?? []).map((image) => ({ type: 'image_url', image_url: { url: image } })),
  ])

  const body = JSON.stringify({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: extractionInstructions },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Shipment JSON schema:
${JSON.stringify(z.toJSONSchema(shipmentSchema))}` },
          ...content,
        ],
      },
    ],
  })

  // Free models are rate limited and sometimes briefly unavailable: retry those, fail fast on anything else.
  let response: Response
  for (let attempt = 1; ; attempt += 1) {
    response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
    })
    if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === retryAttempts) break
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt))
  }

  if (!response.ok) {
    const hint = response.status === 402 ? ' The model needs credits; set OPENROUTER_MODEL to a free vision model or add credits.' : response.status === 429 ? ' The model is rate limited; wait a minute and retry, or choose another model.' : ''
    throw new Error(`OpenRouter extraction failed (${response.status}).${hint}`)
  }

  const data = await response.json() as ChatResponse
  const contentText = data.choices?.[0]?.message?.content
  if (!contentText) {
    throw new Error('OpenRouter returned no extraction result.')
  }

  const shipment = shipmentSchema.parse(parseModelJson(contentText))
  normalizeShipmentDates(shipment)
  sanitizeTransportPorts(shipment)
  if (shipment.transport.arrivalDate.value == null) {
    const eta = findArrivalDate(request.documents.map((document) => document.text ?? ''))
    if (eta) {
      shipment.transport.arrivalDate = { value: eta, confidence: 0.7 }
      addFlag(shipment, 'transport.arrivalDate', 'Arrival date read from the "ETA" in a document because extraction returned none; confirm it.')
    }
  }
  applyEntryDefaults(shipment)
  return { ...shipment, conflicts: reconcileConflicts(shipment) }
}
