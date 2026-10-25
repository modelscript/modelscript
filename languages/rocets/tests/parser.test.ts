// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRocetsDeck, parseRocetsMap } from "../src/index.js";

describe("@modelscript/rocets Parser Suite", () => {
  it("parses classical and modern NASA ROCETS engine decks", () => {
    const deckSource = `DECK: SSME_Powerhead
TITLE: "Space Shuttle Main Engine Gas Generator Powerhead Cycle"

COMPONENTS:
  OPUMP TYPE=PUMP TITLE="Low Pressure LOX Boost Pump" X=120 Y=150
    PARAMS: DELTA_P=2.5E6, ETA=0.78, RHO=1140.0
    PORTS: IN_P=0.3E6, OUT_P=2.8E6, MDOT=450.0

  FPUMP TYPE=PUMP TITLE="High Pressure Fuel Pump" X=120 Y=320
    PARAMS: DELTA_P=45.0E6, ETA=0.74, RHO=71.0
    PORTS: IN_P=2.0E6, OUT_P=47.0E6, MDOT=75.0

  TURB01 TYPE=TURBINE TITLE="Fuel Turbopump Turbine" X=350 Y=320
    PARAMS: PR=1.65, ETA=0.76, T_IN=980.0
    PORTS: IN_P=35.0E6, OUT_P=21.2E6, MDOT=72.0

  SHAFT01 TYPE=SHAFT TITLE="HPFTP High Speed Shaft" X=240 Y=320
    PARAMS: INERTIA=0.12, SPEED_RPM=34000.0, MAX_RPM=42000.0
    S0: SPEED_RPM=34000.0

  CHAMBER TYPE=CHAMBER TITLE="Main Combustion Chamber & Nozzle" X=600 Y=250
    PARAMS: PC=20.5E6, MR=6.0, AT=0.082, EPS=77.5, VC=0.045
    S0: PC=20.5E6

  MAIN_VALVE TYPE=VALVE TITLE="Main Oxidizer Valve" X=450 Y=150
    PARAMS: CV=0.005, POSITION=1.0

CONNECTIONS:
  OPUMP.OUT_P -> MAIN_VALVE.IN_P
  MAIN_VALVE.OUT_P -> CHAMBER.IN_OX
  FPUMP.OUT_P -> CHAMBER.IN_FUEL
  TURB01.OUT_P -> CHAMBER.IN_GAS
  SHAFT01.TORQUE_TURB -> TURB01.TORQUE
  SHAFT01.TORQUE_PUMP -> FPUMP.TORQUE
`;

    const model = parseRocetsDeck(deckSource);
    assert.strictEqual(model.name, "SSME_Powerhead");
    assert.strictEqual(model.title, "Space Shuttle Main Engine Gas Generator Powerhead Cycle");
    assert.strictEqual(model.components.size, 6);

    const chamber = model.components.get("CHAMBER");
    assert.ok(chamber);
    assert.strictEqual(chamber.type, "CHAMBER");
    assert.strictEqual(chamber.parameters["PC"], 20.5e6);
    assert.strictEqual(chamber.parameters["MR"], 6.0);
    assert.strictEqual(chamber.parameters["AT"], 0.082);

    const shaft = model.components.get("SHAFT01");
    assert.ok(shaft);
    assert.strictEqual(shaft.type, "SHAFT");
    assert.strictEqual(shaft.parameters["SPEED_RPM"], 34000.0);

    assert.strictEqual(model.connections.length, 6);
    assert.strictEqual(model.connections[0]?.fromComponent, "OPUMP");
    assert.strictEqual(model.connections[0]?.toComponent, "MAIN_VALVE");
  });

  it("parses turbomachinery performance maps", () => {
    const mapSource = `MAP: HPFTP_PUMP_MAP
RPM: 20000, 30000, 40000
FLOW_KGS: 40, 60, 80, 100
HEAD:
  1800, 1750, 1680, 1580
  3800, 3720, 3600, 3450
  6200, 6100, 5950, 5700
EFFICIENCY:
  0.65, 0.74, 0.77, 0.72
  0.68, 0.78, 0.81, 0.76
  0.66, 0.76, 0.79, 0.73
`;

    const map = parseRocetsMap(mapSource);
    assert.strictEqual(map.name, "HPFTP_PUMP_MAP");
    assert.strictEqual(map.speedRpm.length, 3);
    assert.strictEqual(map.flowKgS.length, 4);
    assert.strictEqual(map.headOrPressureRatio.length, 3);
    assert.strictEqual(map.efficiency.length, 3);
  });
});
