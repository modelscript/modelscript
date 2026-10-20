// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runPscadSimulationPipeline } from "../src/language.js";
import { clearPscadSources, registerPscadSource } from "../src/model/workspace-registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = process.env["PSCAD_CORPUS_DIR"] ?? path.resolve(here, "../../../.cache/pscad-corpus");

/** Ratchet: minimum EMT netlist coverage per corpus file. Only ever raise. */
const BASELINE: Record<string, number> = {
  "DC_EMT_demo.pscx": 0.9,
  "DC_EMT_compare.pscx": 0.9,
};

function findFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? findFiles(p) : /\.(pscx|pslx)$/i.test(e.name) ? [p] : [];
  });
}

describe("PSCAD simulation honesty", () => {
  it("strict mode refuses the synthetic fallback", () => {
    const xml = `<project name="t" version="5.0.2"><definitions/></project>`;
    const r = runPscadSimulationPipeline({ documentText: xml, runSimulation: true, strict: true });
    assert.equal(r.simulationResult, undefined);
    assert.equal(r.simulationReport.solver, "none");
    assert.ok(r.diagnostics.some((d) => d.rule === "emt-no-solver"));
  });

  const all = findFiles(corpus);
  clearPscadSources();
  for (const f of all) registerPscadSource(f, readFileSync(f, "utf8"));
  const files = all.filter((f) => f.endsWith(".pscx"));
  for (const file of files) {
    const name = path.basename(file);
    it(`coverage ratchet: ${name}`, () => {
      const r = runPscadSimulationPipeline({ documentText: readFileSync(file, "utf8") });
      const c = r.simulationReport.coverage;
      console.log(
        `${name}: ${c.lowered}/${c.simulatable} (${(c.ratio * 100).toFixed(0)}%) dropped: ` +
          c.dropped
            .slice(0, 12)
            .map((d) => `${d.definition}×${d.count}`)
            .join(" "),
      );
      assert.ok(c.ratio >= (BASELINE[name] ?? 0), `${name} coverage ${c.ratio} below baseline`);
    });
  }
});
