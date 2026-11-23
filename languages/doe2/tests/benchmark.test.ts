// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDoe2 } from "../src/parser/index.js";
import {
  AIR_CP_SI,
  AIR_DENSITY_SI,
  ASHRAE_R_SE_DEFAULT,
  ASHRAE_R_SI_DEFAULT,
  FT_TO_M,
  K_IP_TO_SI,
  R_IP_TO_SI,
  getConstructionThermalProps,
  simulateDoe2Thermal,
  solveDoe2SteadyState,
} from "../src/solver/index.js";

function computeRmse(actual: number[], expected: number[]): number {
  let sumSq = 0.0;
  for (let i = 0; i < actual.length; i++) {
    const diff = (actual[i] ?? 0) - (expected[i] ?? 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

describe("@modelscript/doe2 — ASHRAE Thermal Envelope & Heat-Balance Benchmarks", () => {
  it("matches ASHRAE multi-layer composite wall R-value and U-value exactly (SI & IP)", () => {
    // SI 3-layer ASHRAE composite wall: 100mm brick + R-2.5 insulation + 12.7mm gypsum
    const siDeck = `
INPUT LOADS UNITS = SI ..
"BRICK" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.1016 CONDUCTIVITY = 1.311 DENSITY = 2082 SPECIFIC-HEAT = 921 ..
"INSUL" = MATERIAL TYPE = RESISTANCE RESISTANCE = 2.50 ..
"GYPSUM" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.0127 CONDUCTIVITY = 0.16 DENSITY = 800 SPECIFIC-HEAT = 1090 ..
"LAY-WALL" = LAYERS MATERIAL = ("BRICK", "INSUL", "GYPSUM") ..
"CON-WALL" = CONSTRUCTION TYPE = LAYERS LAYERS = "LAY-WALL" ..
STOP ..
`;
    const propsSi = getConstructionThermalProps(parseDoe2(siDeck), "CON-WALL");
    assert.ok(propsSi, "Expected CON-WALL thermal properties");

    const expectedRSi = ASHRAE_R_SE_DEFAULT + 0.1016 / 1.311 + 2.5 + 0.0127 / 0.16 + ASHRAE_R_SI_DEFAULT;
    const expectedUSi = 1.0 / expectedRSi;

    const rRelErr = Math.abs(propsSi.rTotalSi - expectedRSi) / expectedRSi;
    const uRelErr = Math.abs(propsSi.uValueSi - expectedUSi) / expectedUSi;
    assert.ok(rRelErr < 1e-12, `Expected exact SI R-value parity, relErr=${rRelErr}`);
    assert.ok(uRelErr < 1e-12, `Expected exact SI U-value parity, relErr=${uRelErr}`);

    // IP 3-layer composite wall: 4 in brick (0.3333 ft) + R-19 batt + 0.5 in gypsum (0.0417 ft)
    const ipDeck = `
INPUT LOADS ..
"BRICK" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.3333333 CONDUCTIVITY = 0.757 DENSITY = 130 SPECIFIC-HEAT = 0.22 ..
"R19" = MATERIAL TYPE = RESISTANCE RESISTANCE = 19.0 ..
"GYPSUM" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.0416667 CONDUCTIVITY = 0.0926 DENSITY = 50 SPECIFIC-HEAT = 0.26 ..
"LAY-IP" = LAYERS MATERIAL = ("BRICK", "R19", "GYPSUM") INSIDE-FILM-RES = 0.68 OUTSIDE-FILM-RES = 0.17 ..
"CON-IP" = CONSTRUCTION TYPE = LAYERS LAYERS = "LAY-IP" ..
STOP ..
`;
    const propsIp = getConstructionThermalProps(parseDoe2(ipDeck), "CON-IP");
    assert.ok(propsIp, "Expected CON-IP thermal properties");

    const expectedRIpSi =
      0.17 * R_IP_TO_SI +
      (0.3333333 * FT_TO_M) / (0.757 * K_IP_TO_SI) +
      19.0 * R_IP_TO_SI +
      (0.0416667 * FT_TO_M) / (0.0926 * K_IP_TO_SI) +
      0.68 * R_IP_TO_SI;
    const expectedUIpSi = 1.0 / expectedRIpSi;

    const ipRelErr = Math.abs(propsIp.uValueSi - expectedUIpSi) / expectedUIpSi;
    assert.ok(ipRelErr < 1e-9, `Expected exact IP->SI U-value parity, relErr=${ipRelErr}`);
  });

  it("matches steady-state UA + infiltration heating load Q = (UA + m_dot * c_p) * dT exactly", () => {
    // Single-zone ASHRAE steady-state test box (SI):
    // Wall U = 0.5 W/(m^2*K), gross wall area = 100 m^2, window area = 20 m^2 with U = 2.0 W/(m^2*K)
    // Net opaque wall area = 80 m^2 -> UA_wall = 40 W/K, UA_win = 40 W/K -> UA_total = 80 W/K
    // Volume = 300 m^3, ACH = 1.0 -> m_dot = 1.2 * (300/3600) = 0.1 kg/s -> m_dot * c_p = 100.5 W/K
    // Total conductance = 180.5 W/K, dT = 20 C - (-10 C) = 30 K -> Q = 5415.0 W
    const deck = `
INPUT LOADS UNITS = SI ..
"W-CON" = CONSTRUCTION TYPE = U-VALUE U-VALUE = 0.5 ..
"G-CON" = GLASS-TYPE GLASS-CONDUCTANCE = 2.0 SHGC = 0.5 ..
"BOX" = SPACE AREA = 100 HEIGHT = 3.0 AIR-CHANGES/HR = 1.0 ..
"WALL-1" = EXTERIOR-WALL CONSTRUCTION = "W-CON" AREA = 100 ..
"WIN-1" = WINDOW GLASS-TYPE = "G-CON" AREA = 20 ..
STOP ..
`;
    const doc = parseDoe2(deck);
    const res = solveDoe2SteadyState(doc, {
      outdoorTempC: -10.0,
      zoneTempC: 20.0,
      solarIrradianceWPerM2: 0.0,
      includeInternalGains: false,
    });

    assert.equal(res.spaces.length, 1);
    const sp = res.spaces[0]!;

    const expectedUA = 80.0 * 0.5 + 20.0 * 2.0; // 80.0 W/K
    const expectedMDot = (1.0 * 300.0 * AIR_DENSITY_SI) / 3600.0; // 0.1 kg/s
    const expectedGInf = expectedMDot * AIR_CP_SI; // 100.5 W/K
    const expectedQ = (expectedUA + expectedGInf) * (20.0 - -10.0); // 5415.0 W

    const relErr = Math.abs(sp.netLoadW - expectedQ) / expectedQ;
    assert.ok(relErr < 1e-12, `Expected Q=${expectedQ} W, got ${sp.netLoadW} W (relErr=${relErr})`);
    assert.ok(Math.abs(sp.uaExteriorWPerK - expectedUA) < 1e-12);
    assert.ok(Math.abs(sp.gInfiltrationWPerK - expectedGInf) < 1e-12);
  });

  it("matches analytical 24-hour transient RC zone temperature response within tight relErr and rmse", () => {
    // Pure 1R1C transient cooldown/warmup with constant outdoor temp T_out = 5 C, T_0 = 22 C,
    // constant internal gain Q_int = 1000 W, thermalMassMultiplier = 3.0
    const deck = `
INPUT LOADS UNITS = SI ..
"W-CON" = CONSTRUCTION TYPE = U-VALUE U-VALUE = 0.5 ..
"ZONE-A" = SPACE AREA = 100 HEIGHT = 3.0 LIGHTING-W/AREA = 10.0 AIR-CHANGES/HR = 0.5 ..
"W1" = EXTERIOR-WALL CONSTRUCTION = "W-CON" AREA = 120 ..
STOP ..
`;
    const doc = parseDoe2(deck);
    const tOut = 5.0;
    const t0 = 22.0;
    const massMult = 3.0;

    const sim = simulateDoe2Thermal(doc, {
      durationHours: 24.0,
      timeStepSeconds: 300.0,
      outdoorMeanTempC: tOut,
      outdoorSwingTempC: 0.0,
      peakSolarIrradianceWPerM2: 0.0,
      initialZoneTempC: t0,
      thermalMassMultiplier: massMult,
      useWallMass: false,
      enableHvac: false,
    });

    const volume = 300.0;
    const cZone = volume * AIR_DENSITY_SI * AIR_CP_SI * massMult;
    const gTotal = 120.0 * 0.5 + ((0.5 * volume) / 3600.0) * AIR_DENSITY_SI * AIR_CP_SI;
    const qInt = 1000.0;
    const tau = cZone / gTotal;
    const tEq = tOut + qInt / gTotal;

    const actual: number[] = [];
    const expected: number[] = [];
    let maxRelErr = 0.0;

    for (const step of sim.trajectory) {
      const tSec = step.timeHours * 3600.0;
      const tExact = tEq + (t0 - tEq) * Math.exp(-tSec / tau);
      const tSim = step.zoneTempsC["ZONE-A"]!;
      actual.push(tSim);
      expected.push(tExact);
      const relErr = Math.abs(tSim - tExact) / Math.max(1.0, Math.abs(tExact));
      if (relErr > maxRelErr) maxRelErr = relErr;
    }

    const rmse = computeRmse(actual, expected);
    assert.ok(maxRelErr < 1e-6, `Expected transient 24h maxRelErr < 1e-6, got ${maxRelErr}`);
    assert.ok(rmse < 1e-5, `Expected transient 24h RMSE < 1e-5 K, got ${rmse}`);
  });

  it("simulates 24-hour diurnal 3R2C conditioned zone with HVAC deadband control and energy accounting", () => {
    const deck = `
INPUT LOADS UNITS = SI ..
"CONCRETE" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.20 CONDUCTIVITY = 1.4 DENSITY = 2200 SPECIFIC-HEAT = 840 ..
"INSUL" = MATERIAL TYPE = RESISTANCE RESISTANCE = 2.5 ..
"L1" = LAYERS MATERIAL = ("CONCRETE", "INSUL") ..
"W1" = CONSTRUCTION TYPE = LAYERS LAYERS = "L1" ..
"GLZ" = GLASS-TYPE GLASS-CONDUCTANCE = 1.65 SHGC = 0.42 ..
"OFFICE" = SPACE AREA = 100 HEIGHT = 3.0 LIGHTING-W/AREA = 8.0 AIR-CHANGES/HR = 0.4 ..
"SOUTH" = EXTERIOR-WALL CONSTRUCTION = "W1" AREA = 40 ..
"WIN" = WINDOW GLASS-TYPE = "GLZ" AREA = 12 ..
INPUT SYSTEMS ..
"VAV-1" = SYSTEM TYPE = VAVS COOLING-COP = 3.5 HEATING-EFF = 0.85 ..
"Z1" = ZONE SPACE = "OFFICE" DESIGN-HEAT-T = 20 DESIGN-COOL-T = 24 ..
STOP ..
`;
    const sim = simulateDoe2Thermal(parseDoe2(deck), {
      durationHours: 24.0,
      timeStepSeconds: 300.0,
      outdoorMeanTempC: 18.0,
      outdoorSwingTempC: 16.0,
      peakSolarIrradianceWPerM2: 750.0,
      initialZoneTempC: 21.0,
      hvacGainWPerK: 5000.0,
    });

    assert.equal(sim.spaceNames.length, 1);
    assert.ok(
      sim.minZoneTempsC["OFFICE"]! >= 19.0,
      `Expected heating setpoint hold >= 19 C, got ${sim.minZoneTempsC["OFFICE"]}`,
    );
    assert.ok(
      sim.maxZoneTempsC["OFFICE"]! <= 25.5,
      `Expected cooling setpoint hold <= 25.5 C, got ${sim.maxZoneTempsC["OFFICE"]}`,
    );
    assert.ok(
      (sim.totalCoolingEnergyKWh["OFFICE"] ?? 0) + (sim.totalHeatingEnergyKWh["OFFICE"] ?? 0) > 0,
      "Expected positive HVAC thermal energy over 24h diurnal cycle",
    );
  });
});
