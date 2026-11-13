# @receipt-lens/core

Receipt parsing that runs entirely in the browser: OCR on-device, a deterministic parser, and a
validator that only checks what the receipt actually printed.

No image, OCR text, or parsed field ever leaves the device. Inference runs locally through
`onnxruntime-web` against self-hosted, content-hashed model assets — there is no third-party endpoint
in the request path, and the pipeline contains no network call other than fetching those assets from
the app's own origin.

> This package is the extraction core of [receipt-lens](https://github.com/geko-rgb/receipt-lens).
> Full benchmarks and design notes: [github.com/geko-rgb/receipt-lens](https://github.com/geko-rgb/receipt-lens).

## Quickstart

```bash
npm install @receipt-lens/core
```

One call, if you want one:

```ts
import { extract } from "@receipt-lens/core";

const result = await extract(file, {
  provider: "pp-ocrv6",
  criticalOcrConfidenceFloor: 0.5,
  warningOcrConfidenceFloor: 0.7,
  strictArithmetic: true,
});

result.ocr;        // normalized lines and words, with boxes and scores
result.parse;      // items, quantities, prices, taxes, charges, subtotal, grand total
result.validation; // findings, `uncertain`, and the canonical validated items
```

Or the stages separately — `extract()` is exactly this composition and holds no logic of its own:

```ts
import { ocr, parse, validate } from "@receipt-lens/core";

const ocrResult = await ocr(image, { provider });        // any OcrProvider
const parseResult = parse(ocrResult);                    // pure: OCR in, new result out
const validation = validate(parseResult, {
  criticalOcrConfidenceFloor: 0.5,
  warningOcrConfidenceFloor: 0.7,
  strictArithmetic: true,
});
```

`parse()` accepts normalized `OcrResult` only — never an image, never provider-specific raw output — and
is pure and deterministic: the same input produces a byte-identical result, the input is never mutated,
and no nested reference is shared into the output.

## Options

| option | default | meaning |
|---|---|---|
| `criticalOcrConfidenceFloor` | `0.50` | below it, an item's name/price score is a critical finding |
| `warningOcrConfidenceFloor` | `0.70` | between the two floors is a review signal, not a rejection |
| `strictArithmetic` | `true` | `false` keeps running every arithmetic check but marks its findings `advisory` |

`criticalOcrConfidenceFloor` must not exceed `warningOcrConfidenceFloor`. A reversed or out-of-range pair
throws a `RangeError` rather than being silently repaired — that is caller misuse, not an operational
failure, so it never borrows one of the three error codes below.

These floors are **initial defaults, not calibrated probabilities**. They are exercised by authored
fixtures: the benchmark corpus is dataset reference OCR, which supplies no recognition score at all, so
every benchmarked receipt takes the `confidence_unavailable` path and no floor comparison runs.

## Findings

`validate()` returns extraction findings — never a single blended confidence number:

```ts
interface ValidationFinding {
  severity: "critical" | "minor";
  code: string;                 // stable; react to this, never to `message`
  scope: "receipt" | "item" | "row" | "charge";
  message: string;
  itemRefs?: string[];          // e.g. ["i7"]
  rowRefs?: string[];           // e.g. ["u3"]
  chargeRefs?: string[];        // e.g. ["t1", "subtotal", "grandTotal"]
  advisory?: boolean;           // only in relaxed arithmetic mode
}
```

Three properties worth building against:

- **Conditional.** A check runs only where the receipt gives both operands and their meaning is known.
  A receipt that prints no subtotal never gets an item-sum verdict — in either direction, not even
  "items may be missing". An item sum below the printed subtotal is reported as possibly-missing rows,
  not as a contradiction; only a sum above it can be one.
- **Addressed.** Every finding names the item, row, or charge that caused it, so a UI can highlight the
  line rather than the receipt.
- **Never silent.** An itemless result is a `zero_items` critical, not an empty success. Missing unit
  prices are reported at the severity the data supports: an item with no money at all is critical
  (`item_without_price`); an item that printed a line total but no unit price is a review finding
  (`price_not_resolved`), because deriving the unit price by division is forbidden by design.

`uncertain` is true when a non-advisory critical finding exists. A non-advisory critical also caps the
confidence of the items it affects at `0.5` — receipt-level criticals cap every item, item-level ones cap
one. A cap never raises a lower score and never turns `null` into a number.

With `strictArithmetic: false`, arithmetic findings carry `advisory: true`: they display, they do not set
`uncertain`, they do not cap confidence, and they do not block anything.

## Errors

`ocr()` and `extract()` throw `ReceiptLensError` for operational failures only, with exactly three codes:
`IMAGE_UNREADABLE`, `MODEL_LOAD_FAILED`, `RECOGNIZE_FAILED`. A blank scan is **not** an error — it is a
valid zero-word `OcrResult` that parses to zero items and validates to a `zero_items` finding.

## What this package does not do

`validate()` checks parse-derived data and nothing else. It cannot know whether bill units are assigned,
whether a payer exists, whether drafts are resolved, or whether the bill can lock. Those belong to the
application layer, which owns all bill-state findings. Core exposes no blocker type, and a minor finding
can still block an application action — read codes, never message text.

This package also does not implement bill splitting. `ParticipantId` is a type alias, not an allocation
API; the split math lives in the application.

## Provider

The default is `pp-ocrv6` (PP-OCRv6 Tiny, WASM), swappable through the `OcrProvider` interface:

```ts
import { createPPOCRv6Provider, type OcrProvider } from "@receipt-lens/core";

const provider: OcrProvider = createPPOCRv6Provider({ assetBaseUrl: "/models/" });
```

Assets — detection model, recognition model, dictionary — are served from your own origin, listed in
a manifest that pins each asset's byte size and SHA-256; the provider verifies both before it
compiles anything. Model binaries are not shipped inside this package; the cache key is the manifest
hash. Serve the set from `test-assets/models/` in this repository at the path you pass.

### `assetBaseUrl`

`assetBaseUrl` moves the whole model set, not just the manifest:

- the manifest is fetched from `<assetBaseUrl>manifest.json`;
- every asset is fetched from `<assetBaseUrl><file>`, so the manifest's own site-absolute `url` values
  (`/assets/models/…`) do not have to match your deployment;
- a trailing slash is optional — `"/models"` and `"/models/"` behave identically.

Omit it and the manifest's `url` values are used verbatim, which is what a host serving
`/assets/models/` expects.

```ts
// Serves /models/manifest.json, /models/PP-OCRv6_tiny_det.onnx, and so on.
createPPOCRv6Provider({ assetBaseUrl: "/models" });
```

`manifestUrl` overrides only the manifest's own location when the manifest is served somewhere the
asset prefix cannot express.

## Accuracy

Headline figures on SROIE, strict exact match (every field the dataset supports agrees on that receipt):

| Mode | Model | SROIE eval | SROIE dev |
|---|---|---:|---:|
| parser-only | reference OCR | 60.7% | 60.4% |
| end-to-end | PP-OCRv6 Tiny (default) | 57.3% | 57.7% |
| end-to-end | PP-OCRv6 Small | 62.9% | 63.8% |

Read them together. Parser-only is the parser scoring text that is already correct, so it isolates the
parser; end-to-end is the number a user experiences. Reference OCR and real OCR group lines differently,
so neither is a strict ceiling on the other — real OCR can occasionally group a receipt better than the
reference fixtures do.

Scope and limits, stated plainly:

- These are CORD-v2 and SROIE reference-OCR numbers, not a claim about arbitrary receipts. CORD is
  Indonesian and is treated as a layout-stress bucket, not a headline.
- Parser-only accuracy measures the automated path only. Rows the parser cannot classify are preserved
  as ambiguous rows for manual review, so a user who reviews them sees higher effective accuracy.
- No row-classification gold split exists in the pinned snapshot, and no confidence calibration corpus
  has been chosen — the `0.50`/`0.70` floors are declared defaults, not measured probabilities.

Re-derive these in the full repository: [github.com/geko-rgb/receipt-lens](https://github.com/geko-rgb/receipt-lens).

## Privacy

Receipt OCR, parsing, and bill calculations run locally in the browser. After the required model assets
are available, the inference workflow works without outbound network access: no cross-origin request is
made and no receipt-image bytes are sent anywhere.

## Entry points

`@receipt-lens/core` resolves to an ES module. Only the OCR provider is browser-runtime-specific:
`parse()` and `validate()` take no DOM or platform types and run unchanged under Node.

The OCR provider and the manifest loader name browser globals (`Blob`, `File`, `ImageBitmap`,
`Response`, `BufferSource`). The shipped declarations carry a `/// <reference lib="dom" />`, so a
project compiling with `lib: ["ES2023"]` alone still typechecks against this package.

## Development

```bash
pnpm install
pnpm build      # tsc -p . → dist/, then attaches the DOM lib reference to dist/index.d.ts
pnpm test       # vitest run (OCR tests read test-assets/models/)
pnpm typecheck
```

The OCR tests read the pinned model assets from `test-assets/models/` (manifest + detection model,
recognition model, dictionary). They are test-only; nothing under `test-assets/` ships in the npm
tarball.

## License

[MIT](./LICENSE)