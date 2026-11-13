/**
 * Prepend `/// <reference lib="dom" />` to the emitted entry declaration file.
 *
 * Why this exists: the public `.d.ts` surface names five DOM globals — `Blob`, `File`,
 * `ImageBitmap`, `Response`, `BufferSource` — because the OCR provider takes an image and
 * the manifest loader takes a fetch. A consumer compiling with `lib: ["ES2023"]` alone then
 * fails with `TS2304` in our own shipped declarations, not in their code.
 *
 * A triple-slash directive written in `src/index.ts` does NOT survive emit: `tsc` drops it
 * (verified against TypeScript 5.9.3). Neither does a `/// <reference lib="dom" />` in a
 * module the entry imports type-only — the emitted `.d.ts` for that module is `export {};`
 * with the directive stripped. So the directive is re-attached here, after emit, where it
 * is written to disk verbatim and shipped in the tarball.
 *
 * The reference is program-wide once the entry declaration is loaded, so the sibling
 * declarations (`extract.d.ts`, `ocr/*.d.ts`) resolve the same globals from it.
 *
 * Idempotent: re-running leaves an already-marked file untouched, and `tsc -p .` rewrites
 * the file so the step always runs against fresh emit.
 */
import { readFile, writeFile } from "node:fs/promises";

const REFERENCE = '/// <reference lib="dom" />\n';
const ENTRY = new URL("../dist/index.d.ts", import.meta.url);

const current = await readFile(ENTRY, "utf8");
if (!current.startsWith(REFERENCE)) {
  await writeFile(ENTRY, REFERENCE + current, "utf8");
  process.stdout.write("emit-dom-reference: attached DOM lib reference to dist/index.d.ts\n");
}