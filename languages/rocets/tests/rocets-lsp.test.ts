// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeRocetsAction,
  getRocetsDocumentSymbols,
  getRocetsHover,
  parseRocetsDeck,
  rocetsToDae,
  validateRocets,
} from "../src/index.js";

const SAMPLE_ROCETS_DECK = `DECK: EngineCore
TITLE: "Expander Cycle Rocket Engine"
CYCLE: expander

COMPONENTS:
  CHAMBER TYPE=CHAMBER TITLE="Main Combustion Chamber"
    PARAMS: PC=10.0E6, AT=0.02, CSTAR=1780.0, VC=0.015
    S0: PC=10.0E6

  PUMP01 TYPE=PUMP TITLE="LH2 Main Pump"
    PARAMS: DELTA_P=15.0E6, ETA=0.75, RHO=71.0

  TURB01 TYPE=TURBINE TITLE="Drive Turbine"
    PARAMS: ETA=0.78, PR=2.2

  SHAFT01 TYPE=SHAFT TITLE="Turbopump Shaft"
    PARAMS: INERTIA=0.05, SPEED_RPM=35000.0

CONNECTIONS:
  PUMP01.OUT_P -> CHAMBER.IN_FUEL
`;

describe("@modelscript/rocets LSP service & DAE lowering suite", () => {
  it("validates ROCETS deck and reports diagnostics", () => {
    const diags = validateRocets(SAMPLE_ROCETS_DECK, "engine.roc");
    assert.ok(Array.isArray(diags));
    for (const d of diags) {
      assert.ok(d.source === "modelscript-rocets");
      assert.ok(typeof d.code === "string");
    }
  });

  it("extracts document symbols including chamber, pump, turbine, shaft", () => {
    const symbols = getRocetsDocumentSymbols(SAMPLE_ROCETS_DECK, "engine.roc");
    assert.ok(symbols.length > 0);
    const root = symbols[0]!;
    assert.ok(root.children && root.children.length >= 4);
    const chamberSym = root.children.find((c) => c.name.includes("CHAMBER"));
    assert.ok(chamberSym, "Expected CHAMBER symbol");
    assert.ok(chamberSym.detail && chamberSym.detail.includes("Pc: 10.0 MPa"));
  });

  it("provides contextual hover information for rocket propulsion modules", () => {
    const lines = SAMPLE_ROCETS_DECK.split("\n");
    const chamberLineIdx = lines.findIndex((l) => l.includes("CHAMBER TYPE=CHAMBER"));
    assert.ok(chamberLineIdx >= 0);

    const hoverChamber = getRocetsHover(SAMPLE_ROCETS_DECK, { line: chamberLineIdx, character: 5 });
    assert.ok(hoverChamber);
    assert.ok(hoverChamber.contents.value.includes("CHAMBER"));
    assert.ok(hoverChamber.contents.value.includes("Main Combustion Chamber"));
  });

  it("lowers ROCETS deck directly to linear-memory DAE arena using rocetsToDae", () => {
    const model = parseRocetsDeck(SAMPLE_ROCETS_DECK);
    const dae = rocetsToDae(model);

    assert.ok(dae.varCount > 5);
    assert.ok(dae.eqCount >= 4);
  });

  it("executes domain actions via executeRocetsAction", async () => {
    const resLint = await executeRocetsAction("lint", { content: SAMPLE_ROCETS_DECK });
    assert.ok(Array.isArray(resLint));

    const resMo = await executeRocetsAction("to_modelica", { content: SAMPLE_ROCETS_DECK });
    assert.ok(typeof resMo === "string");
    assert.ok(resMo.includes("model EngineCore"));

    const resDae = await executeRocetsAction("to_dae", { content: SAMPLE_ROCETS_DECK });
    assert.ok(resDae.varCount > 0);
    assert.ok(resDae.eqCount > 0);
  });
});
