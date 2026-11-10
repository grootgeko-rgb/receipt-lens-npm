import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ModelManifest } from "./model-manifest.js";

/**
 * `test-assets/models/` is the standalone copy of the model directory served by the app in
 * github.com/geko-rgb/receipt-lens under `/assets/models/*`. A file sitting in the directory is
 * reachable by name even when no manifest names it — that is how an unshipped experiment tier could
 * end up next to the shipped Tiny set and be measured as if it were the product. These pins make
 * the directory's contents the manifest's own statement rather than a convention.
 */
const modelsUrl = new URL("../../test-assets/models/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", modelsUrl), "utf8")) as ModelManifest;

describe("the served model directory holds exactly what the manifest pins", () => {
  it("carries no asset file the manifest does not name", async () => {
    const entries = await readdir(modelsUrl, { withFileTypes: true });
    const pinned = new Set(manifest.assets.map((asset) => asset.file));
    const stray = entries
      .filter((entry) => entry.isFile() && entry.name !== "manifest.json" && !pinned.has(entry.name))
      .map((entry) => entry.name);
    // A stray tier here would be served at /assets/models/<file> and offered to the OCR harness by name.
    expect(stray).toEqual([]);
  });

  it("pins nothing outside this directory, so a quarantine subdirectory can never be an asset", () => {
    // An unproven tier lives in a git-ignored quarantine subdirectory until it has benchmark evidence.
    for (const asset of manifest.assets) {
      expect(asset.file).not.toContain("/");
      expect(asset.url).toBe(`/assets/models/${asset.file}`);
    }
  });

  it("names only the tier DECISIONS/0015 put in front of users", () => {
    expect(manifest.assets.map((asset) => asset.file).sort()).toEqual([
      "PP-OCRv6_tiny_det.onnx",
      "PP-OCRv6_tiny_rec.onnx",
      "PP-OCRv6_tiny_rec.txt",
    ]);
  });
});
