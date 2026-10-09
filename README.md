# NetCHB Entry Builder

Upload the paperwork for an import shipment (commercial invoice, packing list, bill of lading, as PDFs or photos) and get back an entry XML in the format NetCHB expects, plus a plain list of what a broker still needs to do before filing it.

It's TypeScript from end to end: a Vite front end, a small Hono API, and Zod for the data model.

## How it works

1. **Read the documents (browser).** PDFs are read page by page. Pages with a text layer are sent as text, laid out line by line. Scanned pages are rendered at 2.5x so handwriting and stamps stay readable. Digital pages also get a light image, so the model can see the table layout.
2. **Extract (API plus an LLM through OpenRouter).** A vision model turns the documents into JSON that must match a strict schema. Each field carries a confidence and the document and page it came from. If the documents don't say something, the field stays empty and the model is told never to invent a value.
3. **Clean up and cross-check (plain code, no LLM).**
   - Dates become `YYYY-MM-DD`. A date like `12/09/2026` is ambiguous, so the code picks the reading that doesn't put the invoice after the arrival date, and flags it.
   - Ports are looked up in the full official CBP tables: Schedule D for U.S. ports (431) and Schedule K for foreign ports (3,590). Countries use the ISO list, and units are mapped to the codes the NetCHB schema allows.
   - Values that appear in more than one document are compared as numbers, so `1,930.000 KGS` and `1930` agree, but 1,930 vs 1,888 is a conflict.
   - Anything no document states is filled in sensibly and flagged: entry and processing port (from the U.S. discharge port), entry type `01`, and entry date (the arrival date).
4. **Review (browser).** Every field is editable and shows its confidence and source. Conflicts, flags and a "Steps to complete before filing" list sit at the top.
5. **Generate the XML (API).** A deterministic renderer builds the entry, and the server validates it against NetCHB's own `entry.xsd` and `data_type.xsd`. Only XML that passes is shown, copied or downloaded.

## Project structure

```text
.
├── src/                        Web app and logic shared with the API
│   ├── main.ts                 Entry point
│   ├── app.ts                  The UI: upload, review form, XML result
│   ├── app.css, style.css      Styles
│   ├── lib/
│   │   ├── document-input.ts   Reads PDFs and images in the browser
│   │   ├── extraction.ts       The LLM call, prompt and retries
│   │   ├── shipment.ts         Zod model of a shipment
│   │   ├── dates.ts            Date parsing, ambiguous dates, ETA fallback
│   │   ├── normalize.ts        Compares values across documents
│   │   ├── conflicts.ts        Finds conflicts between documents
│   │   ├── sanitize.ts         Stops foreign ports landing in U.S. port fields
│   │   ├── derive.ts           Flagged defaults (ports, entry type and date)
│   │   ├── netchb-codes.ts     Ports, countries, units, container check digit
│   │   ├── ports-data.ts       Official CBP Schedule D and K port tables
│   │   ├── mid.ts              Manufacturer ID (MID) builder
│   │   ├── validation.ts       Checks that must pass before XML is built
│   │   ├── todo.ts             "Steps to complete before filing"
│   │   └── netchb-renderer.ts  Builds the entry XML
│   └── schemas/                NetCHB's entry.xsd and data_type.xsd
├── server.ts                   Hono API: /api/extract and /api/generate
├── server/xsd-validator.ts     Validates XML against the schemas (libxml2)
├── tests/                      Vitest suites, including XSD validation
├── results/                    Output saved from a run of the app on the sample documents
├── AI-chats/                   Exported AI chat history for this project
├── WRITEUP.md                  The one-page writeup
├── .env.example                Settings template (copy to .env)
└── package.json, vite.config.ts, tsconfig*.json
```

## What NetCHB expects

NetCHB's XML web service takes an `<entry>` document in the `http://www.netchb.com/xml/entry` namespace. I used the published `entry.xsd` and `data_type.xsd` (bundled in `src/schemas`) as the contract. The parts used here:

- `header`: importer, consignee, ports, dates, entry type, bond, charges, weight, value, vessel, carrier
- `manifest/bill-of-lading`: master and house bills with their carrier codes, quantity and unit
- `containers`
- `invoices/invoice/line-items/line-item`: country of origin, manufacturer ID, `tariffs/tariff` (HTS number, value, quantity, unit), lading port, weight

A few rules worth knowing:

- **Assists are dutiable.** Buyer-supplied material is added to the value of the line that used it, and flagged. An assist that isn't tied to a line is spread across the lines by value.
- **Freight and insurance** go in `charges`, not in line values.
- **Bill numbers** are sent without the carrier code at the front, because the SCAC has its own element. NetCHB's [help page](https://www.netchb.com/static/help/accountCheckMasterBill.html) says to enter the master bill "without SCAC code".
- **Manufacturer IDs** are built the way CBP builds them: country, first three letters of the first two name words, leading address digits, first three letters of the city. That matches the `GBTEDBAK6LON` example in [NetCHB's sample entry](https://www.netchb.com/xml/entry/entryUploadResponse.html). A built MID is always listed for you to verify, and a real MID found on a document or typed into the form wins.

## Running it

You need Node 20 or newer and pnpm.

```bash
pnpm install
cp .env.example .env     # then add your OpenRouter key
pnpm run api             # API on PORT (default 8787); reloads when server files change
pnpm run dev             # web app on http://localhost:5173, proxies /api to the API
```

Start the API first, then the web app, and open http://localhost:5173. Upload your documents, review the fields, and press "Generate NetCHB XML".

Settings in `.env`:

- `OPENROUTER_API_KEY` is required for extraction.
- `OPENROUTER_MODEL` is the model to use (see below).
- `PORT` is the API port. Vite reads the same value for its proxy.

Other commands:

```bash
pnpm test     # 72 tests, including XSD validation of generated XML
pnpm build    # type-check and production build
```

## Choosing a model

Extraction quality is mostly down to the model.

- Use a **vision-capable** model. Scanned PDFs and photos need it.
- A stronger paid model (for example `google/gemini-2.5-flash`) reads handwriting and fine print best.
- Free models work, but they're slow and often rate limited (HTTP 429). The app retries a few times and then tells you.
- Currently its using `Openrouter/free` models.
- A 402 error means the model needs credits on your OpenRouter account.

## Hosting notes

The live demo runs the front end on Vercel and the API on Render's free plan. A few things follow from that:

- **Expect a slow first request.** Render's free plan puts the API to sleep after about 15 minutes without traffic. The next request wakes it, but booting takes roughly 30-60 seconds, and that first request often fails with a 502/503 or a network error. This is the "API error" you may see on a cold start. The request still wakes the server, so retrying after a minute works.
- **Extraction itself is slow on a free model.** It can take 5-10 minutes, and the app says so while it works. Keep the tab open.
- **Point the front end at the API** with `VITE_API_BASE_URL` (set it in Vercel to the Render URL). CORS is already enabled on the API.
- **Ways to avoid the cold start** (not built yet): call a small health endpoint when the page opens so the API wakes up before anyone uploads; retry automatically after a 502/503; ping the API every 10 minutes from a free uptime monitor (Render's free plan has enough instance hours to keep one service up all month); or use a paid always-on instance.

## What it doesn't do (yet)

- **One invoice per entry.** Several invoices in one upload aren't split apart.
- **HTS codes are used as written.** Documents usually carry only 6-digit HS codes, so the app tells you to classify to the full 10-digit HTSUS number instead of guessing.
- **Importer of record number and bond type** are almost never on shipping documents, so they're left for you to fill in.
- **Not generated:** FDA, USDA and other agency data, Section 301/232 and anti-dumping duties, special programs, related-party flags, exam sites.
- **Never submitted to NetCHB.** I had no account, so "valid against the schema" is as far as I can vouch for the XML.
- **The model can still misread things.** Anything uncertain shows up as low confidence, a flag or a conflict, but check identifiers such as bill and container numbers against the documents.
