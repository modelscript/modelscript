// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getUserDefinitionForm } from "../src/model/definition-form.js";
import {
  buildProjectModel,
  buildWorkspaceModels,
  wireEnds,
  type ModelDefinition,
  type Pt,
} from "../src/model/pscad-model.js";
import { clearPscadSources } from "../src/model/workspace-registry.js";
import { parsePscx } from "../src/parser/pscx-parser.js";
import { PscadWorkspaceIndex } from "../src/workspace-index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = process.env["PSCAD_CORPUS_DIR"] ?? path.resolve(here, "../../../.cache/pscad-corpus");

/** Ratchet: minimum fraction of wire ends landing on a port or another wire. Only ever raise. */
const BASELINE: Record<string, number> = {
  "DC_EMT_demo.pscx": 0.85,
  "DC_EMT_compare.pscx": 0.83,
  "DC_EMT_lib.pslx": 0.82,
};

function attachRatio(defs: Iterable<ModelDefinition>): number {
  let ends = 0;
  let hit = 0;
  for (const d of defs) {
    for (const w of d.wires) {
      const others = d.wires
        .filter((o) => o !== w)
        .flatMap((o) => o.vertices.slice(1).map((v, k) => [o.vertices[k]!, v] as const));
      for (const e of wireEnds(w) as Pt[]) {
        ends++;
        const onPort = d.instances.some((i) => i.ports.some((p) => p.x === e.x && p.y === e.y));
        const onWire = others.some(
          ([a, b]) =>
            e.x >= Math.min(a.x, b.x) &&
            e.x <= Math.max(a.x, b.x) &&
            e.y >= Math.min(a.y, b.y) &&
            e.y <= Math.max(a.y, b.y),
        );
        if (onPort || onWire) hit++;
      }
    }
  }
  return ends === 0 ? 1 : hit / ends;
}

function find(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) find(p, out);
    else if (e.name in BASELINE) out.push(p);
  }
  return out;
}

describe("pscad semantic model (corpus)", { skip: !existsSync(corpus) }, () => {
  for (const f of existsSync(corpus) ? find(corpus) : []) {
    it(path.basename(f), () => {
      const m = buildProjectModel(readFileSync(f, "utf8"));
      assert.equal(m.errors.length, 0);
      const r = attachRatio(m.definitions.values());
      assert.ok(r >= BASELINE[path.basename(f)]!, `wire attachment ${(r * 100).toFixed(1)}% below baseline`);
    });
  }
});

describe("pscad workspace resolution (corpus)", { skip: !existsSync(corpus) }, () => {
  const all = existsSync(corpus) ? find(corpus) : [];
  it("resolves cross-file user definitions", () => {
    if (all.length < 3) return;
    const models = buildWorkspaceModels(all.map((f) => readFileSync(f, "utf8")));
    const demo = models.get("DC_EMT_demo")!;
    const resolved = demo.definitions
      .get("Main")!
      .instances.filter((i) => i.lib === "DC_EMT_lib" && i.ports.some((p) => p.source === "definition"));
    assert.ok(resolved.length >= 5, `only ${resolved.length} library instances resolved`);
    const r = attachRatio(demo.definitions.values());
    console.log("demo workspace attach", (r * 100).toFixed(1));
    assert.ok(r >= 0.88);
  });
});

describe("pscad workspace registry feeds parsePscx (corpus)", { skip: !existsSync(corpus) }, () => {
  it("gives library instances ports once the library is indexed", () => {
    const all = find(corpus);
    const demoPath = all.find((f) => f.endsWith("DC_EMT_demo.pscx"));
    const libPath = all.find((f) => f.endsWith("DC_EMT_lib.pslx"));
    if (!demoPath || !libPath) return;
    const demo = readFileSync(demoPath, "utf8");
    clearPscadSources();
    const countWithPorts = () =>
      parsePscx(demo).rootModule.components.filter(
        (c) => c.definitionName.startsWith("DC_EMT_lib:") && c.ports.length > 0,
      ).length;
    const before = countWithPorts();
    new PscadWorkspaceIndex().indexFile(libPath, readFileSync(libPath, "utf8"));
    const after = countWithPorts();
    clearPscadSources();
    assert.ok(after > before, "indexed library should add ports to library instances");
  });
});

describe("pscad definition forms (corpus)", { skip: !existsSync(corpus) }, () => {
  it("reads user-definition parameter forms across files", () => {
    const all = find(corpus);
    const demoPath = all.find((f) => f.endsWith("DC_EMT_demo.pscx"));
    const libPath = all.find((f) => f.endsWith("DC_EMT_lib.pslx"));
    if (!demoPath || !libPath) return;
    clearPscadSources();
    new PscadWorkspaceIndex().indexFile(libPath, readFileSync(libPath, "utf8"));
    const form = getUserDefinitionForm(readFileSync(demoPath, "utf8"), "DC_EMT_lib:AC_Grid_Eq");
    clearPscadSources();
    assert.ok(form, "form should resolve through the indexed library");
    const params = form.categories.flatMap((c) => c.parameters);
    const fbase = params.find((p) => p.name === "Fbase");
    assert.equal(fbase?.unit, "Hz");
    assert.equal(fbase?.defaultValue, "60");
    assert.equal(fbase?.label, "Base Frequency");
  });
});
