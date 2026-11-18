// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPowerWorldToDae } from "../src/dae/powerworld-to-dae.js";
import { parsePowerWorldAux } from "../src/parser/powerworld-parser.js";

describe("PowerWorld AUX to DAEBuilder Lowering", () => {
  it("lowers buses, branches, gens, and loads into DAEBuilder", () => {
    const aux = `
DATA (Bus, [BusNum, BusName, BusNomVolt, BusSlack])
{
  1 "Slack" 230.0 YES
  2 "LoadBus" 230.0 NO
}
DATA (Gen, [BusNum, GenID, GenStatus, GenMW])
{
  1 "1" Closed 100.0
}
DATA (Load, [BusNum, LoadID, LoadStatus, LoadMW])
{
  2 "1" Closed 100.0
}
DATA (Branch, [BusNumFrom, BusNumTo, LineCircuit, LineR, LineX, LineAMVA])
{
  1 2 "1" 0.005 0.04 300.0
}
`;
    const dae = lowerPowerWorldToDae(parsePowerWorldAux(aux), { modelName: "TwoBusGrid" });
    assert.notEqual(dae.lookupVariable("V_bus_1"), -1);
    assert.notEqual(dae.lookupVariable("theta_bus_1"), -1);
    assert.notEqual(dae.lookupVariable("V_bus_2"), -1);
    assert.notEqual(dae.lookupVariable("theta_bus_2"), -1);
    assert.notEqual(dae.lookupVariable("P_br_1_2_1_1"), -1);
    assert.ok(dae.variables().length >= 7);
    assert.ok(dae.equations().length >= 6);
  });
});
