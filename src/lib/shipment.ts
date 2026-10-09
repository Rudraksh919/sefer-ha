import { z } from 'zod'

export const confidenceSchema = z.number().min(0).max(1)
export const sourceSchema = z.object({
  document: z.string().min(1),
  page: z.number().int().positive().optional(),
})

export const extractedField = <T extends z.ZodType>(schema: T) =>
  z.object({
    value: schema.nullable(),
    confidence: confidenceSchema,
    source: sourceSchema.optional(),
  })

const textField = extractedField(z.string().trim().min(1))
// Dates are kept as strings and normalized to ISO on ingestion so a single
// malformed date never rejects an otherwise complete extraction.
const dateField = extractedField(z.string().trim().min(1))
const moneyField = extractedField(z.number().finite().nonnegative())
const quantityField = extractedField(z.number().finite().positive())

export const partySchema = z.object({
  name: textField,
  address: textField,
  taxId: textField.optional(),
  city: textField.optional(),
  // Manufacturer Identification Code, only when a document states one (not the tax ID).
  mid: textField.optional(),
})

export const lineItemSchema = z.object({
  description: textField,
  countryOfOrigin: textField,
  htsCode: textField,
  quantity: quantityField,
  unit: textField,
  value: moneyField,
  manufacturer: partySchema.optional(),
  // Value of buyer-supplied materials (assists) tied to this line; added to its entered value.
  assist: moneyField.optional(),
  grossWeight: quantityField.optional(),
})

export const conflictSchema = z.object({
  field: z.string().min(1),
  values: z.array(z.string().min(1)).min(2),
})

export const observationSchema = z.object({
  field: z.string().min(1),
  value: z.string().min(1),
  document: z.string().min(1),
  page: z.number().int().positive().optional(),
})

// Non-blocking review notes raised during extraction, e.g. a possible assist
// that must be confirmed by a human rather than auto-assigned to a field.
export const flagSchema = z.object({
  field: z.string().min(1),
  message: z.string().min(1),
})

export const shipmentSchema = z.object({
  importer: partySchema,
  consignee: partySchema,
  seller: partySchema,
  invoice: z.object({
    number: textField,
    date: dateField,
    currency: textField,
    incoterm: textField,
  }),
  transport: z.object({
    processingPort: textField,
    entryPort: textField,
    loadingPort: textField,
    dischargePort: textField,
    vessel: textField,
    voyage: textField,
    billOfLading: textField,
    arrivalDate: dateField,
    containers: z.array(textField),
    masterBill: textField.optional(),
    masterScac: textField.optional(),
    houseScac: textField.optional(),
    packageUnit: textField.optional(),
  }),
  entry: z.object({
    type: textField,
    bondType: textField,
    date: dateField,
  }),
  totals: z.object({
    packages: quantityField,
    grossWeight: quantityField,
    freight: moneyField,
    insurance: moneyField,
    assists: moneyField,
  }),
  lines: z.array(lineItemSchema).min(1),
  conflicts: z.array(conflictSchema).default([]),
  observations: z.array(observationSchema).default([]),
  flags: z.array(flagSchema).default([]),
})

export function addFlag(shipment: { flags: ReviewFlag[] }, field: string, message: string): void {
  if (!shipment.flags.some((flag) => flag.field === field && flag.message === message)) shipment.flags.push({ field, message })
}

export type Shipment = z.infer<typeof shipmentSchema>
export type Conflict = z.infer<typeof conflictSchema>
export type Observation = z.infer<typeof observationSchema>
export type ReviewFlag = z.infer<typeof flagSchema>
export type ExtractedField<T> = z.infer<ReturnType<typeof extractedField<z.ZodType<T>>>>

export function getFieldValue(shipment: Shipment, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], shipment)
}

export function getExtractedValue(shipment: Shipment, path: string): string | number | null {
  const field = getFieldValue(shipment, path) as { value?: string | number | null } | undefined
  return field?.value ?? null
}

export const requiredShipmentFields = [
  'invoice.number',
  'invoice.date',
  'invoice.currency',
  'transport.processingPort',
  'transport.entryPort',
  'transport.billOfLading',
  'entry.type',
  'entry.date',
] as const
