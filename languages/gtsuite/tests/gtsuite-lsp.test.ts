// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeGtsuiteAction,
  getGtsuiteDocumentSymbols,
  getGtsuiteHover,
  gtsuiteToDae,
  parseGtmModel,
  validateGtsuite,
} from "../src/index.js";

const SAMPLE_GTM_MODEL = `MODEL: Test_Turbo_4Cyl
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.0, EFF = 0.76, MASS_FLOW = 0.14)
  PLENUM_IN = plenum (VOL = 0.0035, P = 180000, T = 315)
  RUNNER1 = intake_runner (D = 0.045, L = 0.35)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 1.9, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> PLENUM_IN.in
  PLENUM_IN.port1 -> RUNNER1.in
  RUNNER1.out -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

describe("@modelscript/gtsuite LSP service & DAE lowering suite", () => {
  it("validates GT-SUITE model and reports diagnostics", () => {
    const diags = validateGtsuite(SAMPLE_GTM_MODEL, "engine.gtm");
    assert.ok(Array.isArray(diags));
    for (const d of diags) {
      assert.ok(d.source === "modelscript-gtsuite");
      assert.ok(typeof d.code === "string");
    }
  });

  it("extracts document symbols including cylinders, plenums, turbochargers", () => {
    const symbols = getGtsuiteDocumentSymbols(SAMPLE_GTM_MODEL, "engine.gtm");
    assert.ok(symbols.length > 0);
    const root = symbols[0]!;
    assert.ok(root.children && root.children.length >= 5);
    const cylSym = root.children.find((c) => c.name.includes("CYL1"));
    assert.ok(cylSym, "Expected cylinder symbol");
    assert.ok(cylSym.detail && cylSym.detail.includes("Bore: 82.5mm"));
  });

  it("provides contextual hover information for engine components", () => {
    const lines = SAMPLE_GTM_MODEL.split("\n");
    const cylLineIdx = lines.findIndex((l) => l.includes("CYL1 = cylinder"));
    assert.ok(cylLineIdx >= 0);

    const hoverCyl = getGtsuiteHover(SAMPLE_GTM_MODEL, { line: cylLineIdx, character: 5 });
    assert.ok(hoverCyl);
    assert.ok(hoverCyl.contents.value.includes("CYL1"));
    assert.ok(hoverCyl.contents.value.includes("Bore"));
    assert.ok(hoverCyl.contents.value.includes("82.5 mm"));
  });

  it("lowers GT-SUITE model directly to linear-memory DAE arena using gtsuiteToDae", () => {
    const model = parseGtmModel(SAMPLE_GTM_MODEL);
    const dae = gtsuiteToDae(model);

    assert.ok(dae.varCount > 5);
    assert.ok(dae.eqCount >= 5);
  });

  it("executes domain actions via executeGtsuiteAction", async () => {
    const resLint = await executeGtsuiteAction("lint", { content: SAMPLE_GTM_MODEL });
    assert.ok(Array.isArray(resLint));

    const resMo = await executeGtsuiteAction("to_modelica", { content: SAMPLE_GTM_MODEL });
    assert.ok(typeof resMo === "string");
    assert.ok(resMo.includes("model Test_Turbo_4Cyl"));

    const resDae = await executeGtsuiteAction("to_dae", { content: SAMPLE_GTM_MODEL });
    assert.ok(resDae.varCount > 0);
    assert.ok(resDae.eqCount > 0);
  });
});
