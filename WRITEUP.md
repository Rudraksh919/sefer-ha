# Writeup: NetCHB Entry Builder

## How I approached it

The first thing I settled was where an AI model should and shouldn't be trusted. A vision model reads the documents and fills in a typed form. Every value comes with a confidence score and the page it came from, and anything the documents don't say stays empty. Everything after that is ordinary code I can test: cleaning values, looking up codes, cross-checking documents, and writing the XML. The model never writes XML.

To find out what NetCHB expects, I used the XML schemas NetCHB publishes (`entry.xsd` and `data_type.xsd`) as the contract and bundled them into the app. Every entry the app generates is checked against them on the server before anyone sees it. That caught real mistakes early, like wrong unit codes, malformed tax IDs and ports that weren't four digits.

## Where the documents don't give you everything

This is where most of the judgment went.

- **Fill in what's reasonable, and say so.** Entry port and processing port come from the U.S. discharge port, entry type defaults to `01`, and entry date to the arrival date. Each is marked low confidence and flagged so the broker can confirm it.
- **Ask for what only the broker knows.** The importer of record number, the bond type and the 10-digit tariff classification aren't on shipping documents. They go into a "steps to complete before filing" list instead of blocking the XML, because the schema doesn't require them.
- **Follow the money rules.** In the sample, the buyer supplied the fabric for one style, which makes it a dutiable assist. I add that value to the line it belongs to (not the header) and flag it. Free samples keep their stated customs value and are flagged too.
- **Don't trust a number that appears once.** Weights, quantities and package counts that show up in more than one document are compared as numbers. The sample has a 1,930 vs 1,888 kg difference and a 1,200 vs 1,176 piece difference, and both show up as conflicts.
- **Check the model's work.** A manufacturer whose address is in a different country than the line's origin raises a warning. If the model misses the ETA, the app reads it from the document text.
- **Deal with messy scans.** One container number was crossed out and corrected by hand. The app uses the correction and also checks the container's check digit, which catches a misread.

I also tried not to build for one shipment. Ports use the full official CBP lists, countries use the ISO list, and units are mapped to the schema's list. A test with a second, unrelated shipment (different ports, countries and units) has to produce valid XML too.

## How I used AI

I used several models along the way. For planning I used larger reasoning models like GPT-6 Sol, and for the implementation I used DeepSeek-4.1-flash and GPT-5.6 Terra.

## What I'm not sure about

- Bill numbers are sent without the carrier code at the front. NetCHB's own help page backs this up for master bills, but I couldn't test it against a live account.
- Manufacturer IDs follow CBP's recipe, and NetCHB's sample entry uses the same pattern, but the street digits are ambiguous for some addresses. That's why they're always flagged for a check.
- I never submitted an entry to NetCHB, so "valid against the schema" is the most I can claim.
- Models still misread a character now and then. A master bill number lost one letter in several runs. A stronger model, or re-reading just that field from a zoomed crop, would likely fix it. For now the reviewer catches it.
- Free models were slow, rate limited and inconsistent while I tested. Sometimes they missed two or three specific fields, and other times they got everything right. I'd want to compare a few models properly before trusting any one of them.

## With more time

1. Try the XML on a real NetCHB test account and fix whatever it rejects beyond the schema.
2. Support several invoices, split shipments and multiple bills of lading in one entry.
3. Look up tariff numbers from the official tariff file to suggest 10-digit codes and units, for a broker to confirm.
4. Check manufacturer IDs against CBP's list instead of building them.
5. Build a small labelled set of shipment documents, measure accuracy per model, and add a second pass that re-reads only the low-confidence or conflicting fields.
6. Let the reviewer click a field and see where on the page it came from.
7. Try the newer fast decision models (Jev, Clef) for the judgment calls after extraction, to make them faster and more deterministic.
