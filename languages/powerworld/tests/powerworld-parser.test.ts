// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePowerWorldAux } from "../src/parser/powerworld-parser.js";
import { projectPowerWorldToPsseRaw } from "../src/projections/aux-to-psse.js";

const SAMPLE_AUX = `
// 3-Bus IEEE Test Case in PowerWorld AUX format
DATA (Bus, [BusNum, BusName, BusNomVolt, BusPUVolt, BusAngle, BusSlack])
{
  1 "Slack_138" 138.0 1.02 0.0 YES
  2 "Gen_138"   138.0 1.01 2.5 NO
  3 "Load_138"  138.0 0.98 -3.1 NO
}

DATA (Gen, [BusNum, GenID, GenStatus, GenMW, GenMVR, GenMWMax, GenMWMin, GenVoltSet])
{
  1 "1" Closed 150.0 25.0 300.0 10.0 1.02
  2 "1" Closed 100.0 15.0 200.0  0.0 1.01
}

DATA (Load, [BusNum, LoadID, LoadStatus, LoadMW, LoadMVR])
{
  3 "1" Closed 245.0 40.0
}

DATA (Branch, [BusNumFrom, BusNumTo, LineCircuit, LineStatus, LineR, LineX, LineC, LineAMVA, LineXfmr])
{
  1 2 "1" Closed 0.01 0.05 0.02 250.0 NO
  2 3 "1" Closed 0.02 0.08 0.03 250.0 NO
  1 3 "1" Closed 0.015 0.06 0.01 200.0 YES
}

DATA (Contingency, [CTGName, CTGSkip])
{
  "L_1_3_OUT" NO
}

SCRIPT
{
  EnterMode(RUN);
  SolvePowerFlow(RECTNEWT);
}
`;

describe("PowerWorld AUX Parser & PSS/E Projection", () => {
  it("parses buses, gens, loads, branches, contingencies, and script blocks", () => {
    const model = parsePowerWorldAux(SAMPLE_AUX);

    assert.equal(model.buses.length, 3);
    assert.equal(model.busByNum.get(1)?.isSlack, true);
    assert.equal(model.busByNum.get(2)?.busName, "Gen_138");
    assert.equal(model.generators.length, 2);
    assert.equal(model.loads.length, 1);
    assert.equal(model.branches.length, 3);
    assert.equal(model.branches[2]?.isTransformer, true);
    assert.equal(model.contingencies.length, 1);
    assert.equal(model.contingencies[0]?.name, "L_1_3_OUT");

    assert.equal(model.scriptBlocks.length, 1);
    assert.equal(model.scriptBlocks[0]?.commands.length, 2);
    assert.equal(model.scriptBlocks[0]?.commands[1]?.name, "SolvePowerFlow");
  });

  it("projects PowerWorld AUX model to valid PSS/E v33 .raw text", () => {
    const model = parsePowerWorldAux(SAMPLE_AUX);
    const raw = projectPowerWorldToPsseRaw(model);
    assert.ok(raw.includes("0, 100.00, 33, 0, 1, 60.00"));
    assert.ok(raw.includes("Slack_138"));
    assert.ok(raw.includes("END OF BUS DATA"));
    assert.ok(raw.includes("END OF TRANSFORMER DATA"));
  });
});
