import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { XmlDocument, XsdValidator } from 'libxml2-wasm'
import { xmlRegisterFsInputProviders } from 'libxml2-wasm/lib/nodejs.mjs'

xmlRegisterFsInputProviders()

const entrySchemaUrl = new URL('../src/schemas/entry.xsd', import.meta.url)
const dataSchemaUrl = new URL('../src/schemas/data_type.xsd', import.meta.url)

export type XmlValidationResult = { valid: true } | { valid: false; errors: string[] }

export async function validateNetchbXml(xml: string): Promise<XmlValidationResult> {
  const entrySchema = (await readFile(fileURLToPath(entrySchemaUrl), 'utf8')).replace(
    'schemaLocation="data_type.xsd"',
    `schemaLocation="${pathToFileURL(fileURLToPath(dataSchemaUrl)).href}"`,
  )
  const schemaDocument = XmlDocument.fromString(entrySchema)
  const document = XmlDocument.fromString(xml)

  try {
    const validator = XsdValidator.fromDoc(schemaDocument)
    try {
      validator.validate(document)
      return { valid: true }
    } finally {
      validator.dispose()
    }
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : 'XSD validation failed.'] }
  } finally {
    document.dispose()
    schemaDocument.dispose()
  }
}
