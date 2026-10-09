import { fieldLabel } from './conflicts.js'
import { lineMid } from './mid.js'
import { getExtractedValue, type Shipment } from './shipment.js'

// Things a broker still has to do or confirm before the generated entry can be filed.
// Derived from the shipment itself, so it is correct for any set of documents.
export function completionSteps(shipment: Shipment): string[] {
  const steps: string[] = []
  const lineList = (indexes: number[]) => indexes.map((index) => index + 1).join(', ')
  const linesWhere = (test: (line: Shipment['lines'][number]) => boolean) => shipment.lines.flatMap((line, index) => (test(line) ? [index] : []))

  if (getExtractedValue(shipment, 'importer.taxId') == null) steps.push('Add the importer of record number (EIN, e.g. 12-3456789). It is not on the shipping documents.')
  if (getExtractedValue(shipment, 'entry.bondType') == null) steps.push('Select the bond type (08 continuous or 09 single transaction); it depends on the importer\'s bond.')

  const shortHts = linesWhere((line) => (line.htsCode.value?.replace(/\D/g, '').length ?? 0) < 10)
  if (shortHts.length) steps.push(`Classify line(s) ${lineList(shortHts)} to the full 10-digit HTSUS number. The documents give only HS codes, and the HTSUS may require different reporting units (for example DOZ and KG) than the invoice.`)

  const noMid = linesWhere((line) => !lineMid(line))
  if (noMid.length) steps.push(`Add the manufacturer name, address, and city (or its MID) for line(s) ${lineList(noMid)}.`)
  const derivedMid = linesWhere((line) => lineMid(line)?.derived === true)
  if (derivedMid.length) steps.push(`Verify the manufacturer IDs (MIDs) built from the manufacturer details for line(s) ${lineList(derivedMid)}.`)

  const assisted = linesWhere((line) => (line.assist?.value ?? 0) > 0)
  if (assisted.length) steps.push(`Confirm the buyer-supplied material (assist) added to the value of line(s) ${lineList(assisted)} is dutiable.`)
  else if ((shipment.totals.assists.value ?? 0) > 0) steps.push('A shipment-level assist was prorated across all lines by value; assign it to the line that used the material.')

  const incoterm = shipment.invoice.incoterm.value?.toUpperCase()
  if (incoterm && ['CIF', 'CFR', 'CIP', 'CPT'].includes(incoterm) && (shipment.totals.freight.value || shipment.totals.insurance.value)) {
    steps.push(`Invoice terms are ${incoterm}: line values were entered as stated, and freight and insurance were reported under non-dutiable charges. Confirm line values exclude them.`)
  }
  if (shipment.conflicts.length) steps.push(`Resolve the conflicts between documents (${shipment.conflicts.map((conflict) => fieldLabel(conflict.field)).join(', ')}) and correct the values above.`)
  return steps
}
