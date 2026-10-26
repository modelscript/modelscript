// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeSimaAction, getSimaDocumentSymbols, getSimaHover, simaToDae, validateSima } from "../src/index.js";

const SAMPLE_SIMO_DECK = `! SIMO / RIFLEX Benchmark: OC4 Semi-Submersible Floating Offshore Wind
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

describe("@modelscript/sima LSP service & DAE lowering suite", () => {
  it("validates SIMA deck and reports diagnostics", () => {
    const diags = validateSima(SAMPLE_SIMO_DECK, "oc4_semi.inp");
    assert.ok(Array.isArray(diags));
    // Clean benchmark should have 0 or few warnings
    for (const d of diags) {
      assert.ok(d.source === "modelscript-sima");
      assert.ok(typeof d.code === "string");
    }
  });

  it("extracts document symbols including environment, vessels, fairleads, and mooring lines", () => {
    const symbols = getSimaDocumentSymbols(SAMPLE_SIMO_DECK, "oc4_semi.inp");
    assert.ok(symbols.length > 0);
    const root = symbols[0]!;
    assert.ok(root.children && root.children.length >= 3);
    const envSym = root.children.find((c) => c.name === "Environment");
    assert.ok(envSym, "Expected Environment symbol");
    const vesselSym = root.children.find((c) => c.name.includes("OC4_Semi") || c.name.includes("semi_hull"));
    assert.ok(vesselSym, "Expected vessel symbol");
    assert.ok(vesselSym.children && vesselSym.children.length === 3, "Expected 3 fairlead symbols");
  });

  it("provides contextual hover information for floater and lines", () => {
    const lines = SAMPLE_SIMO_DECK.split("\n");
    const bodyLineIdx = lines.findIndex((l) => l.includes("BODY"));
    assert.ok(bodyLineIdx >= 0);

    const hoverVessel = getSimaHover(SAMPLE_SIMO_DECK, { line: bodyLineIdx, character: 5 });
    assert.ok(hoverVessel);
    assert.ok(hoverVessel.contents.value.includes("Floater Vessel"));
    assert.ok(hoverVessel.contents.value.includes("OC4_Semi"));

    const lineLineIdx = lines.findIndex((l) => l.includes("LINE line_1"));
    assert.ok(lineLineIdx >= 0);
    const hoverLine = getSimaHover(SAMPLE_SIMO_DECK, { line: lineLineIdx, character: 5 });
    assert.ok(hoverLine);
    assert.ok(hoverLine.contents.value.includes("Mooring Line"));
  });

  it("lowers SIMA model directly to linear-memory DAE arena", () => {
    const dae = simaToDae({
      vessels: [
        {
          id: "semi_1",
          name: "SemiSubmersible",
          mass: 1.4e7,
          displacement: 1.4e4,
          cg: [0, 0, -13],
          radiiOfGyration: [32, 32, 34],
          massMatrix: [],
          hydrostaticMatrix: [],
          linearDamping: [],
          quadraticDamping: [],
          gmTransverse: 4.5,
          gmLongitudinal: 5.0,
          fairleads: [],
        },
      ],
      lines: [],
      environment: {
        waterDepth: 200,
        waterDensity: 1025,
        seabedFriction: 0.5,
        wave: { spectrum: "jonswap", hs: 8.0, tp: 12.0, gamma: 3.3, direction: 0 },
        wind: { speed: 20, direction: 0 },
        current: { surfaceSpeed: 1.2, direction: 0 },
      },
      simulation: { timeStep: 0.1, duration: 100, solver: "cummins_dae" },
    });

    assert.ok(dae.varCount > 20);
    assert.ok(dae.eqCount > 15);
  });

  it("executes domain actions via executeSimaAction", async () => {
    const resLint = await executeSimaAction("lint", { content: SAMPLE_SIMO_DECK });
    assert.ok(Array.isArray(resLint));

    const resMo = await executeSimaAction("to_modelica", { content: SAMPLE_SIMO_DECK });
    assert.ok(typeof resMo === "string");
    assert.ok(resMo.includes("model OffshoreSystem"));

    const resDae = await executeSimaAction("to_dae", { content: SAMPLE_SIMO_DECK });
    assert.ok(resDae.varCount > 0);
    assert.ok(resDae.eqCount > 0);
  });
});
