// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Real-world corpus ratchet. Set PSCAD_CORPUS_DIR (default: <repo>/.cache/pscad-corpus)
 * to a directory containing `.pscx`/`.pslx` files; the test is skipped if none exist.
 *
 * Baselines record the CURRENT state of the pipeline on DC-EMT_v0. They may only be
 * raised as the hardening plan lands; lowering a baseline is a regression.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { computeCorpusMetrics, formatCorpusReport, type CorpusFileMetrics } from "./corpus-metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = process.env["PSCAD_CORPUS_DIR"] ?? path.resolve(__dirname, "../../../.cache/pscad-corpus");

function findFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findFiles(p));
    else if (/\.(pscx|pslx)$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** Minimum acceptable fractions per file name (ratchet: raise as coverage improves). */
const BASELINES: Record<string, { portCoverage: number; wireAttachment: number; catalogCoverage: number }> = {
  "DC_EMT_demo.pscx": { portCoverage: 0.75, wireAttachment: 0.84, catalogCoverage: 0.2 },
  "DC_EMT_compare.pscx": { portCoverage: 0.69, wireAttachment: 0.77, catalogCoverage: 0.2 },
  "DC_EMT_lib.pslx": { portCoverage: 0.98, wireAttachment: 0.71, catalogCoverage: 0.2 },
};

const files = findFiles(corpusDir);

describe("PSCAD real-world corpus", { skip: files.length === 0 ? `no corpus at ${corpusDir}` : false }, () => {
  const rows: CorpusFileMetrics[] = [];

  for (const file of files) {
    const name = path.basename(file);
    it(`parses and processes ${name} without throwing`, () => {
      const text = fs.readFileSync(file, "utf-8");
      const m = computeCorpusMetrics(name, text);
      rows.push(m);
      assert.ok(m.components > 0, "expected components");
      assert.ok(m.parseMs < 2000, `parse too slow: ${m.parseMs.toFixed(0)}ms`);
      const base = BASELINES[name];
      if (base) {
        assert.ok(
          m.portCoverage >= base.portCoverage,
          `port coverage ${m.portCoverage.toFixed(2)} < ${base.portCoverage}`,
        );
        assert.ok(
          m.wireAttachment >= base.wireAttachment,
          `wire attachment ${m.wireAttachment.toFixed(2)} < ${base.wireAttachment}`,
        );
        assert.ok(
          m.catalogCoverage >= base.catalogCoverage,
          `catalog coverage ${m.catalogCoverage.toFixed(2)} < ${base.catalogCoverage}`,
        );
      }
    });
  }

  it("prints the corpus report", () => {
    console.log("\n" + formatCorpusReport(rows));
    const missing = new Set(rows.flatMap((r) => r.missingMasterTypes));
    console.log(`\nmaster types missing from catalog (${missing.size}): ${[...missing].join(", ")}`);
  });
});
