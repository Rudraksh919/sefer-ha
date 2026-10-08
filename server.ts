import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import { extractShipment, extractionRequestSchema } from './src/lib/extraction.js'
import { renderNetchbXml } from './src/lib/netchb-renderer.js'
import { shipmentSchema } from './src/lib/shipment.js'
import { sanitizeTransportPorts } from './src/lib/sanitize.js'
import { validateNetchbXml } from './server/xsd-validator.js'

const app = new Hono()

function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    const paths = [...new Set(error.issues.map((issue) => issue.path.join('.')).filter(Boolean))]
    return `Extraction did not match the shipment schema${paths.length ? `: ${paths.join(', ')}` : ''}.`
  }
  return error instanceof Error ? error.message : 'Shipment extraction failed.'
}

app.use('/api/*', cors())

app.post('/api/generate', async (context) => {
  const shipment = shipmentSchema.safeParse(await context.req.json())
  if (!shipment.success) {
    return context.json({ error: 'Invalid shipment data.', details: shipment.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }, 400)
  }

  sanitizeTransportPorts(shipment.data)
  const rendered = renderNetchbXml(shipment.data)
  if ('errors' in rendered) {
    return context.json({ error: 'Complete required fields before generating XML.', details: rendered.errors }, 422)
  }

  const validation = await validateNetchbXml(rendered.xml)
  if (!validation.valid) {
    return context.json({ error: 'Generated XML failed NetCHB XSD validation.', validation }, 422)
  }

  return context.json({ xml: rendered.xml, validation }, 200)
})

app.post('/api/extract', async (context) => {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return context.json({ error: 'OPENROUTER_API_KEY is not configured.' }, 500)
  }

  const payload = extractionRequestSchema.safeParse(await context.req.json())
  if (!payload.success) {
    return context.json({ error: 'Invalid extraction request.', details: payload.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }, 400)
  }

  try {
    const shipment = await extractShipment(payload.data, apiKey, process.env.OPENROUTER_MODEL)
    return context.json({ shipment })
  } catch (error) {
    return context.json({ error: describeError(error) }, 422)
  }
})

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`Shipment API listening on http://localhost:${port}`)
