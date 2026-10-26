// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  easy5ToDae,
  executeEasy5Action,
  getEasy5DocumentSymbols,
  getEasy5Hover,
  parseEasy5,
  validateEasy5,
} from "../src/index.js";

const SAMPLE_EASY5_MODEL = `MODEL: PitchControl
TITLE: "Aircraft Pitch Rate Feedback Controller"

COMPONENTS:
  IN01 TYPE=GP/IN TITLE="Forward Integrator"
    XP: GAIN=5.0, S0=0.0

  GA01 TYPE=GP/GA TITLE="Pitch Rate Gain"
    XP: K=2.5

  SJ01 TYPE=GP/SJ TITLE="Error Summer"
    XP: SGN1=1.0, SGN2=-1.0

CONNECTIONS:
  SJ01.OUT -> GA01.IN
  GA01.OUT -> IN01.IN
`;

describe("@modelscript/easy5 LSP service & DAE lowering suite", () => {
  it("validates EASY5 model and reports diagnostics", () => {
    const diags = validateEasy5(SAMPLE_EASY5_MODEL, "pitch_control.ez5");
    assert.ok(Array.isArray(diags));
    for (const d of diags) {
      assert.ok(d.source === "modelscript-easy5");
      assert.ok(typeof d.code === "string");
    }
  });

  it("extracts document symbols including integrators, gains, summing junctions", () => {
    const symbols = getEasy5DocumentSymbols(SAMPLE_EASY5_MODEL, "pitch_control.ez5");
    assert.ok(symbols.length > 0);
    const root = symbols[0]!;
    assert.ok(root.children && root.children.length >= 3);
    const gaSym = root.children.find((c) => c.name.includes("GA01"));
    assert.ok(gaSym, "Expected GA01 symbol");
    assert.ok(gaSym.detail && gaSym.detail.includes("Gain: K = 2.5"));
  });

  it("provides contextual hover information for control blocks", () => {
    const lines = SAMPLE_EASY5_MODEL.split("\n");
    const gaLineIdx = lines.findIndex((l) => l.includes("GA01 TYPE=GP/GA"));
    assert.ok(gaLineIdx >= 0);

    const hoverGain = getEasy5Hover(SAMPLE_EASY5_MODEL, { line: gaLineIdx, character: 5 });
    assert.ok(hoverGain);
    assert.ok(hoverGain.contents.value.includes("GA01"));
    assert.ok(hoverGain.contents.value.includes("Pitch Rate Gain"));
  });

  it("lowers EASY5 model directly to linear-memory DAE arena using easy5ToDae", () => {
    const model = parseEasy5(SAMPLE_EASY5_MODEL);
    const dae = easy5ToDae(model);

    assert.ok(dae.varCount > 3);
    assert.ok(dae.eqCount >= 2);
  });

  it("executes domain actions via executeEasy5Action", async () => {
    const resLint = await executeEasy5Action("lint", { content: SAMPLE_EASY5_MODEL });
    assert.ok(Array.isArray(resLint));

    const resMo = await executeEasy5Action("to_modelica", { content: SAMPLE_EASY5_MODEL });
    assert.ok(typeof resMo === "string");
    assert.ok(resMo.includes("model PitchControl"));

    const resDae = await executeEasy5Action("to_dae", { content: SAMPLE_EASY5_MODEL });
    assert.ok(resDae.varCount > 0);
    assert.ok(resDae.eqCount > 0);
  });
});
