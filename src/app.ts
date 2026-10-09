import './app.css'
import { prepareDocuments } from './lib/document-input.js'
import { fieldLabel, reconcileConflicts } from './lib/conflicts.js'
import { applyEntryDefaults } from './lib/derive.js'
import { normalizeDate, normalizeShipmentDates } from './lib/dates.js'
import { resolveForeignPortCode, resolvePortCode } from './lib/netchb-codes.js'
import { sanitizeTransportPorts } from './lib/sanitize.js'
import { requiredShipmentFields, shipmentSchema, type Shipment } from './lib/shipment.js'
import { completionSteps } from './lib/todo.js'
import { validateShipment, type ValidationIssue } from './lib/validation.js'

type Stage = 'Uploading' | 'Reading documents' | 'Extracting shipment data' | 'Validating extracted data' | 'Ready for review' | 'Generating XML' | 'Validating XML' | 'Complete' | 'Failed'
type FieldValue = { value: string | number | null; confidence: number; source?: { document: string; page?: number } }
type State = { stage: Stage; files: File[]; shipment: Shipment | null; error: string | null; message: string | null; xml: string | null; validationErrors: string[]; validationValid: boolean }
type InputType = 'text' | 'date' | 'number'
type IssueMap = Map<string, ValidationIssue>

const stages: Stage[] = ['Uploading', 'Reading documents', 'Extracting shipment data', 'Validating extracted data', 'Ready for review', 'Generating XML', 'Validating XML', 'Complete']
const processingMessages: Partial<Record<Stage, string>> = {
  'Reading documents': 'Reading and preparing your documents…',
  'Extracting shipment data': 'Extracting shipment data with AI… this can take a moment.',
  'Validating extracted data': 'Validating extracted data…',
  'Generating XML': 'Generating NetCHB XML…',
  'Validating XML': 'Validating XML against the NetCHB schema…',
}
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const state: State = { stage: 'Uploading', files: [], shipment: null, error: null, message: null, xml: null, validationErrors: [], validationValid: false }
const field = <T extends string | number>(value: T | null, confidence = value === null ? 0 : 1) => ({ value, confidence })
const party = () => ({ name: field<string>(null), address: field<string>(null), taxId: field<string>(null), city: field<string>(null), mid: field<string>(null) })

const reviewGroups: Array<{ legend: string; fields: Array<[string, string, InputType?]> }> = [
  { legend: 'Importer', fields: [['importer.name', 'Importer name'], ['importer.address', 'Importer address'], ['importer.taxId', 'Importer tax ID']] },
  { legend: 'Consignee', fields: [['consignee.name', 'Ultimate consignee'], ['consignee.address', 'Consignee address']] },
  { legend: 'Seller', fields: [['seller.name', 'Seller'], ['seller.address', 'Seller address']] },
  { legend: 'Invoice', fields: [['invoice.number', 'Invoice number'], ['invoice.date', 'Invoice date', 'date'], ['invoice.currency', 'Currency'], ['invoice.incoterm', 'Incoterm']] },
  { legend: 'Transport', fields: [['transport.processingPort', 'Processing port'], ['transport.entryPort', 'Entry port'], ['transport.loadingPort', 'Port of loading'], ['transport.dischargePort', 'Port of discharge'], ['transport.vessel', 'Vessel'], ['transport.voyage', 'Voyage'], ['transport.billOfLading', 'House bill of lading'], ['transport.houseScac', 'House bill SCAC'], ['transport.masterBill', 'Master bill of lading'], ['transport.masterScac', 'Carrier SCAC'], ['transport.packageUnit', 'Package type'], ['transport.arrivalDate', 'Arrival date', 'date']] },
  { legend: 'Entry', fields: [['entry.type', 'Entry type'], ['entry.bondType', 'Bond type'], ['entry.date', 'Entry date', 'date']] },
  { legend: 'Shipment totals', fields: [['totals.packages', 'Packages', 'number'], ['totals.grossWeight', 'Gross weight', 'number'], ['totals.freight', 'Freight', 'number'], ['totals.insurance', 'Insurance', 'number'], ['totals.assists', 'Assists (total, only if not tied to a line)', 'number']] },
]

function emptyShipment(): Shipment {
  return shipmentSchema.parse({
    importer: party(), consignee: party(), seller: party(),
    invoice: { number: field<string>(null), date: field<string>(null), currency: field<string>(null), incoterm: field<string>(null) },
    transport: { processingPort: field<string>(null), entryPort: field<string>(null), loadingPort: field<string>(null), dischargePort: field<string>(null), vessel: field<string>(null), voyage: field<string>(null), billOfLading: field<string>(null), arrivalDate: field<string>(null), containers: [] },
    entry: { type: field<string>(null), bondType: field<string>(null), date: field<string>(null) },
    totals: { packages: field<number>(null), grossWeight: field<number>(null), freight: field<number>(null), insurance: field<number>(null), assists: field<number>(null) },
    lines: [emptyLine()], conflicts: [],
  })
}

function emptyLine() {
  return { description: field<string>(null), countryOfOrigin: field<string>(null), htsCode: field<string>(null), quantity: field<number>(null), unit: field<string>(null), value: field<number>(null), assist: field<number>(null), grossWeight: field<number>(null), manufacturer: party() }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function isProcessing(): boolean {
  return state.stage in processingMessages
}

function processingMarkup(): string {
  const message = processingMessages[state.stage]
  if (!message) return ''
  return `<aside class="processing" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><div><strong>${escapeHtml(state.stage)}</strong><p>${escapeHtml(message)}</p><small>Elapsed <span id="elapsed">0s</span></small></div></aside>`
}

let ticker: number | undefined
let startedAt = 0

function syncTicker(): void {
  const elapsed = document.querySelector<HTMLSpanElement>('#elapsed')
  if (isProcessing() && elapsed) {
    if (!ticker) { startedAt = Date.now(); ticker = window.setInterval(() => { const node = document.querySelector<HTMLSpanElement>('#elapsed'); if (node) node.textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s` }, 1000) }
    elapsed.textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s`
  } else if (ticker) {
    window.clearInterval(ticker)
    ticker = undefined
  }
}

function getValue(shipment: Shipment, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], shipment)
}

// Optional extracted fields may be absent; give each an empty value so the form can show and edit it.
function ensureReviewShipment(shipment: Shipment): void {
  shipment.importer.taxId ??= field<string>(null)
  for (const key of ['masterBill', 'masterScac', 'houseScac', 'packageUnit'] as const) shipment.transport[key] ??= field<string>(null)
  shipment.lines.forEach((line) => {
    line.manufacturer ??= party()
    line.manufacturer.city ??= field<string>(null)
    line.manufacturer.mid ??= field<string>(null)
    line.assist ??= field<number>(null)
    line.grossWeight ??= field<number>(null)
  })
}

function setValue(path: string, rawValue: string, type: InputType): void {
  if (!state.shipment) return
  const keys = path.split('.')
  const target = keys.slice(0, -1).reduce<Record<string, unknown>>((current, key) => current[key] as Record<string, unknown>, state.shipment as unknown as Record<string, unknown>)
  const extracted = target[keys.at(-1)!] as FieldValue
  extracted.value = rawValue === '' ? null : type === 'number' ? Number(rawValue) : type === 'date' ? normalizeDate(rawValue) : rawValue
  extracted.confidence = 1
  sanitizeTransportPorts(state.shipment)
}

function missingFields(shipment: Shipment): string[] {
  return requiredShipmentFields.filter((path) => (getValue(shipment, path) as FieldValue | undefined)?.value == null)
}

function portCodeHint(path: string): string {
  if (!state.shipment) return ''
  const value = (getValue(state.shipment, path) as FieldValue | undefined)?.value
  if (value == null) return ''
  if (path === 'transport.loadingPort') {
    const code = resolveForeignPortCode(String(value))
    return code ? `Schedule K ${code}` : 'No verified Schedule K code — enter a 5-digit code or clear this field.'
  }
  if (path === 'transport.processingPort' || path === 'transport.entryPort' || path === 'transport.dischargePort') {
    const code = resolvePortCode(String(value))
    return code ? `CBP Schedule D ${code}` : 'No verified CBP code — enter a valid port name or code.'
  }
  return ''
}

function input(path: string, label: string, type: InputType = 'text', issues: IssueMap = new Map()): string {
  const extracted = getValue(state.shipment!, path) as FieldValue
  const issue = issues.get(path)
  const status = issue?.severity === 'error' || extracted.value == null ? 'missing' : issue || extracted.confidence < 0.75 ? 'low-confidence' : ''
  const source = extracted.source ? ` · ${escapeHtml(extracted.source.document)}${extracted.source.page ? ` p.${extracted.source.page}` : ''}` : ''
  const hint = portCodeHint(path)
  const note = issue ? issue.message : extracted.value == null ? 'Missing' : `${Math.round(extracted.confidence * 100)}% confidence`
  const control = path === 'entry.bondType'
    ? bondTypeControl(path, extracted.value)
    : type === 'date'
      ? `<input data-field="${path}" data-type="date" type="text" placeholder="YYYY-MM-DD" value="${escapeHtml(extracted.value)}">`
      : `<input data-field="${path}" data-type="${type}" type="${type}" value="${escapeHtml(extracted.value)}">`
  return `<label class="field ${status}"><span>${label}</span>${control}<small>${escapeHtml(note)}${hint ? ` · ${escapeHtml(hint)}` : ''}${source}</small></label>`
}

function bondTypeControl(path: string, value: unknown): string {
  const options = ['', '00', '08', '09'].map((code) => `<option value="${code}" ${String(value ?? '') === code ? 'selected' : ''}>${code === '' ? 'Select…' : code}</option>`).join('')
  return `<select data-field="${path}" data-type="text">${options}</select>`
}

function lineMarkup(index: number, issues: IssueMap): string {
  return `<fieldset><div class="section-heading"><legend>Invoice line ${index + 1}</legend><button type="button" class="secondary" data-remove-line="${index}" ${state.shipment!.lines.length === 1 ? 'disabled' : ''}>Remove line</button></div><div class="form-grid lines">${input(`lines.${index}.description`, 'Description', 'text', issues)}${input(`lines.${index}.countryOfOrigin`, 'Country of origin', 'text', issues)}${input(`lines.${index}.htsCode`, 'HTS code', 'text', issues)}${input(`lines.${index}.quantity`, 'Quantity', 'number', issues)}${input(`lines.${index}.unit`, 'Unit', 'text', issues)}${input(`lines.${index}.value`, 'Value (USD)', 'number', issues)}${input(`lines.${index}.assist`, 'Assist added to value (USD)', 'number', issues)}${input(`lines.${index}.grossWeight`, 'Gross weight (kg)', 'number', issues)}${input(`lines.${index}.manufacturer.name`, 'Manufacturer name', 'text', issues)}${input(`lines.${index}.manufacturer.address`, 'Manufacturer address', 'text', issues)}${input(`lines.${index}.manufacturer.city`, 'Manufacturer city', 'text', issues)}${input(`lines.${index}.manufacturer.mid`, 'Manufacturer ID (MID), if known', 'text', issues)}${input(`lines.${index}.manufacturer.taxId`, 'Manufacturer tax ID (not sent)', 'text', issues)}</div></fieldset>`
}

function reviewMarkup(shipment: Shipment): string {
  ensureReviewShipment(shipment)
  const issues = validateShipment(shipment)
  const issueMap: IssueMap = new Map(issues.map((issue) => [issue.path, issue]))
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const conflicts = shipment.conflicts.map((conflict) => `<li><strong>${escapeHtml(fieldLabel(conflict.field))}</strong>: ${escapeHtml(conflict.values.join(' / '))}</li>`).join('')
  const flags = shipment.flags.map((flag) => `<li><strong>${escapeHtml(fieldLabel(flag.field))}</strong>: ${escapeHtml(flag.message)}</li>`).join('')
  const steps = completionSteps(shipment).map((step) => `<li>${escapeHtml(step)}</li>`).join('')
  const groups = reviewGroups.map((group) => `<fieldset><legend>${group.legend}</legend><div class="form-grid">${group.fields.map(([path, label, type]) => input(path, label, type, issueMap)).join('')}</div></fieldset>`).join('')
  const containers = shipment.transport.containers.map((container) => container.value).filter(Boolean).join(', ')
  const issuesNotice = issues.length
    ? `${errors.length ? `<aside class="notice error"><strong>Must fix before generating XML (${errors.length})</strong><ul>${errors.map((issue) => `<li><code>${escapeHtml(issue.path)}</code>: ${escapeHtml(issue.message)}</li>`).join('')}</ul></aside>` : ''}${warnings.length ? `<aside class="notice warning"><strong>Review warnings (${warnings.length})</strong><ul>${warnings.map((issue) => `<li><code>${escapeHtml(issue.path)}</code>: ${escapeHtml(issue.message)}</li>`).join('')}</ul></aside>` : ''}`
    : '<aside class="notice success">Required review fields are complete.</aside>'
  const result = state.xml && state.validationValid
    ? `<section class="xml-result"><div class="section-heading"><h2>Validated NetCHB XML</h2><div class="actions"><button type="button" id="copy-xml" class="secondary">Copy XML</button><button type="button" id="download-xml">Download XML</button></div></div><pre><code>${escapeHtml(state.xml)}</code></pre></section>`
    : ''
  return `<section class="review"><div class="section-heading"><div><p class="eyebrow">Review</p><h2>Confirm shipment data</h2></div><button type="button" id="reset-review" class="secondary">Reset</button></div>${issuesNotice}${conflicts ? `<aside class="notice warning"><strong>Conflicts across documents</strong><ul>${conflicts}</ul></aside>` : ''}${flags ? `<aside class="notice warning"><strong>Review notes</strong><ul>${flags}</ul></aside>` : ''}${steps ? `<aside class="notice warning"><strong>Steps to complete before filing</strong><ul>${steps}</ul></aside>` : ''}${groups}<fieldset><legend>Containers</legend><label class="field"><span>Container numbers</span><input id="containers" value="${escapeHtml(containers)}" placeholder="Comma-separated"><small>One or more container numbers, if present on the bill of lading.</small></label></fieldset>${shipment.lines.map((_, index) => lineMarkup(index, issueMap)).join('')}<div class="actions"><button type="button" id="add-line" class="secondary">Add invoice line</button><button type="button" id="generate-xml">Generate NetCHB XML</button></div>${state.validationErrors.length ? `<aside class="notice error"><strong>XML validation errors</strong><ul>${state.validationErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></aside>` : ''}${result}</section>`
}

function render(): void {
  const currentStage = stages.indexOf(state.stage)
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main><header><p class="eyebrow">NetCHB entry preparation</p><h1>Shipment to reviewed entry data</h1><p class="lede">Upload shipping documents, review extracted facts, then generate validated XML.</p></header><ol class="stages">${stages.map((stage, index) => `<li class="${index < currentStage ? 'complete' : index === currentStage ? 'active' : ''}">${escapeHtml(stage)}</li>`).join('')}</ol>${state.error ? `<aside class="notice error" role="alert">${escapeHtml(state.error)}</aside>` : ''}${state.message ? `<aside class="notice success">${escapeHtml(state.message)}</aside>` : ''}${processingMarkup()}<section class="upload"><h2>Shipment documents</h2><p>Upload up to 10 PDF, PNG, JPEG, WebP, text, or CSV files. Each file may be up to 15 MB.</p><label class="drop-zone" for="documents"><span>Select files</span><input id="documents" type="file" multiple ${isProcessing() ? 'disabled' : ''} accept="application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv,.csv"></label>${state.files.length ? `<ul class="files">${state.files.map((file) => `<li>${escapeHtml(file.name)} <span>${Math.ceil(file.size / 1024)} KB</span></li>`).join('')}</ul>` : ''}<button type="button" id="extract" ${state.files.length && !isProcessing() ? '' : 'disabled'}>${isProcessing() ? 'Processing…' : 'Extract shipment data'}</button></section>${state.shipment ? reviewMarkup(state.shipment) : ''}</main>`
  syncTicker()
  document.querySelector<HTMLInputElement>('#documents')?.addEventListener('change', (event) => { state.files = Array.from((event.target as HTMLInputElement).files ?? []); state.error = null; state.message = null; state.stage = 'Uploading'; render() })
  document.querySelector<HTMLButtonElement>('#extract')?.addEventListener('click', extract)
  document.querySelector<HTMLButtonElement>('#reset-review')?.addEventListener('click', () => { state.shipment = emptyShipment(); state.xml = null; state.validationErrors = []; state.stage = 'Ready for review'; render() })
  document.querySelector<HTMLButtonElement>('#add-line')?.addEventListener('click', () => { state.shipment?.lines.push(emptyLine()); clearResult(); render() })
  document.querySelectorAll<HTMLButtonElement>('[data-remove-line]').forEach((button) => button.addEventListener('click', () => { state.shipment?.lines.splice(Number(button.dataset.removeLine), 1); clearResult(); render() }))
  document.querySelector<HTMLButtonElement>('#generate-xml')?.addEventListener('click', generateXml)
  document.querySelector<HTMLButtonElement>('#download-xml')?.addEventListener('click', downloadXml)
  document.querySelector<HTMLButtonElement>('#copy-xml')?.addEventListener('click', copyXml)
  document.querySelector<HTMLInputElement>('#containers')?.addEventListener('change', (event) => { if (state.shipment) { state.shipment.transport.containers = (event.target as HTMLInputElement).value.split(',').map((value) => value.trim()).filter(Boolean).map((value) => field(value)); clearResult(); render() } })
  document.querySelectorAll<HTMLInputElement>('[data-field]').forEach((element) => element.addEventListener('change', () => { setValue(element.dataset.field!, element.value, element.dataset.type as InputType); clearResult(); render() }))
}

function clearResult(): void { state.xml = null; state.validationErrors = []; state.validationValid = false; state.message = null; state.stage = 'Ready for review' }

async function generateXml(): Promise<void> {
  if (!state.shipment) return
  state.error = null; state.message = null; state.xml = null; state.validationErrors = []; state.validationValid = false; state.stage = 'Generating XML'; render()
  try {
    const response = await fetch(`${apiBaseUrl}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.shipment) })
    state.stage = 'Validating XML'
    const result = await response.json() as { xml?: string; error?: string; details?: string[]; validation?: { valid: boolean; errors?: string[] } }
    state.validationErrors = result.validation?.errors ?? result.details ?? []
    if (response.ok && result.xml && result.validation?.valid) { state.xml = result.xml; state.validationValid = true; state.stage = 'Complete' } else { state.stage = 'Ready for review'; if (!state.validationErrors.length) throw new Error(result.error ?? 'XML generation failed.') }
  } catch (error) { state.stage = 'Failed'; state.error = error instanceof Error ? error.message : 'XML generation failed.' }
  render()
}

function downloadXml(): void {
  const missing = state.shipment ? missingFields(state.shipment) : []
  if (!state.xml || !state.validationValid || missing.length) return
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([state.xml], { type: 'application/xml' }))
  link.download = 'netchb-entry.xml'
  link.click()
  URL.revokeObjectURL(link.href)
}

async function copyXml(): Promise<void> {
  if (!state.xml || !state.validationValid) return
  try { await navigator.clipboard.writeText(state.xml); state.message = 'XML copied to the clipboard.' } catch { state.error = 'Unable to copy XML. Select it from the result panel instead.' }
  render()
}

async function extract(): Promise<void> {
  try {
    state.error = null; state.message = null; state.stage = 'Reading documents'; render()
    const payload = await prepareDocuments(state.files)
    state.stage = 'Extracting shipment data'; render()
    const response = await fetch(`${apiBaseUrl}/api/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json() as { shipment?: Shipment; error?: string }
    if (!response.ok || !result.shipment) throw new Error(result.error ?? 'Shipment extraction failed.')
    state.stage = 'Validating extracted data'
    const shipment = shipmentSchema.parse(result.shipment)
    normalizeShipmentDates(shipment)
    sanitizeTransportPorts(shipment)
    applyEntryDefaults(shipment)
    shipment.conflicts = reconcileConflicts(shipment)
    ensureReviewShipment(shipment)
    state.shipment = shipment
    clearResult()
    state.stage = 'Ready for review'
  } catch (error) {
    state.stage = 'Failed'
    state.error = error instanceof TypeError && error.message === 'Failed to fetch' ? 'Cannot reach the local API. Start it with `pnpm run api` and confirm PORT matches the API URL.' : error instanceof Error ? error.message : 'Shipment extraction failed.'
  }
  render()
}

render()
