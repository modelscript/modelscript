// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateIdmtTripTime,
  evaluateDifferentialTrip,
  OPEN_RELAY_CATALOG,
  parseRioFile,
  type RelaySettingManifest,
  type TimeOvercurrentSetting,
  verifyProtectionSelectivity,
} from "../src/solvers/protection/relay-schema.js";

test("calculateIdmtTripTime: computes IEC and IEEE standard inverse curves correctly", () => {
  const iecStd: TimeOvercurrentSetting = {
    functionName: "51-IEC",
    curveType: "iec_standard_inverse",
    pickupCurrentA: 5.0,
    timeDial: 0.5,
  };

  // Below pickup: no trip
  assert.strictEqual(calculateIdmtTripTime(iecStd, 4.5), Infinity);
  assert.strictEqual(calculateIdmtTripTime(iecStd, 5.0), Infinity);

  // At 2x pickup (I = 10A, M = 2)
  // t = 0.5 * ( 0.14 / (2^0.02 - 1) ) ≈ 0.5 * (0.14 / 0.01396) ≈ 5.01s
  const t2x = calculateIdmtTripTime(iecStd, 10.0);
  assert.ok(Math.abs(t2x - 5.01) < 0.1, `Expected ~5.01s, got ${t2x}`);

  // At 10x pickup (I = 50A, M = 10)
  // t = 0.5 * ( 0.14 / (10^0.02 - 1) ) ≈ 0.5 * (0.14 / 0.04713) ≈ 1.485s
  const t10x = calculateIdmtTripTime(iecStd, 50.0);
  assert.ok(Math.abs(t10x - 1.485) < 0.05, `Expected ~1.485s, got ${t10x}`);

  // Inverse time: higher current results in faster clearing
  assert.ok(t10x < t2x, "Higher fault current must result in shorter trip time");

  // IEEE Very Inverse
  const ieeeVi: TimeOvercurrentSetting = {
    functionName: "51-IEEE-VI",
    curveType: "ieee_very_inverse",
    pickupCurrentA: 5.0,
    timeDial: 1.0,
  };
  const tVi = calculateIdmtTripTime(ieeeVi, 15.0); // M = 3
  // t = 1.0 * (19.61 / (3^2 - 1) + 0.491) = 19.61 / 8 + 0.491 ≈ 2.451 + 0.491 ≈ 2.942s
  assert.ok(Math.abs(tVi - 2.942) < 0.05, `Expected ~2.942s, got ${tVi}`);
});

test("evaluateDifferentialTrip: percentage restraint, dual slope, and harmonic inrush blocking", () => {
  const diffSetting = OPEN_RELAY_CATALOG.siemens_siprotec_7ut86!.ansi87!;

  // 1. Through-fault (external fault): I1 = 5.0 pu, I2 = 5.0 pu (equal current in and out)
  // Idiff = 0.0 pu, Irest = 5.0 pu
  const externalFault = evaluateDifferentialTrip(diffSetting, 5.0, 5.0);
  assert.strictEqual(externalFault.tripped, false, "External fault should NOT trip differential protection");
  assert.strictEqual(externalFault.iDiffPu, 0.0);

  // 2. Internal fault: I1 = 3.0 pu, I2 = 0.0 pu
  // Idiff = 3.0 pu, Irest = 1.5 pu <= IrKnee (1.5 pu)
  // Threshold = 0.20 + 0.25 * 1.5 = 0.575 pu
  const internalFault = evaluateDifferentialTrip(diffSetting, 3.0, 0.0);
  assert.strictEqual(internalFault.tripped, true, "Internal fault should trip differential protection");
  assert.strictEqual(internalFault.blockedByHarmonic, false);

  // 3. Inrush condition: Internal differential current accompanied by 20% 2nd harmonic
  const inrushFault = evaluateDifferentialTrip(diffSetting, 3.0, 0.0, { second: 0.20 });
  assert.strictEqual(inrushFault.tripped, false, "Transformer inrush with 20% 2nd harmonic should be blocked");
  assert.strictEqual(inrushFault.blockedByHarmonic, true);

  // 4. Heavy internal fault exceeding unrestrained instantaneous threshold (8.0 pu)
  // Even with inrush harmonics, unrestrained trip must execute!
  const heavyFault = evaluateDifferentialTrip(diffSetting, 10.0, 0.0, { second: 0.25 });
  assert.strictEqual(heavyFault.tripped, true, "Severe internal fault > 8.0 pu must trip unrestrained");
  assert.strictEqual(heavyFault.blockedByHarmonic, false);
});

test("OPEN_RELAY_CATALOG: contains standard industrial models", () => {
  assert.ok(OPEN_RELAY_CATALOG.siemens_siprotec_7sa87);
  assert.ok(OPEN_RELAY_CATALOG.abb_relion_rel670);
  assert.ok(OPEN_RELAY_CATALOG.sel_421);
  assert.ok(OPEN_RELAY_CATALOG.sel_751);
  assert.ok(OPEN_RELAY_CATALOG.siemens_siprotec_7ut86);

  const sel421 = OPEN_RELAY_CATALOG.sel_421!;
  assert.strictEqual(sel421.manufacturer, "SEL");
  assert.strictEqual(sel421.ansi21?.length, 3);
  assert.strictEqual(sel421.ansi21[0]?.characteristic, "mho");

  const siprotec = OPEN_RELAY_CATALOG.siemens_siprotec_7sa87!;
  assert.strictEqual(siprotec.manufacturer, "Siemens");
  assert.strictEqual(siprotec.ansi21?.length, 3);
  assert.strictEqual(siprotec.ansi21[0]?.characteristic, "quadrilateral");
});

test("parseRioFile: parses Omicron / DIgSILENT .rio relay settings files", () => {
  const rioSample = `; Omicron RIO Export File
BEGIN DEVICE
  MANUFACTURER = Siemens
  SERIES = SIPROTEC 5
  MODEL = 7SA87_Feeder1
  CT_PRIM = 1200
  CT_SEC = 1
  VT_PRIM = 110000
  VT_SEC = 100
END DEVICE

BEGIN DISTANCE
  LINE_ANGLE = 78.0
END DISTANCE

BEGIN ZONE
  Z = 4.2
  R = 9.0
  PHI = 78.0
  TIME = 0.00
  SHAPE = QUAD
  DIR = FORWARD
END ZONE

BEGIN ZONE
  Z = 7.5
  R = 15.0
  PHI = 78.0
  TIME = 0.35
  SHAPE = QUAD
  DIR = FORWARD
END ZONE

BEGIN OVERCURRENT
  IS = 1.2
  I_INST = 15.0
END OVERCURRENT
`;

  const relay = parseRioFile(rioSample);
  assert.strictEqual(relay.manufacturer, "Siemens");
  assert.strictEqual(relay.model, "7SA87_Feeder1");
  assert.strictEqual(relay.ctRatio.primaryA, 1200);
  assert.strictEqual(relay.ctRatio.secondaryA, 1);
  assert.strictEqual(relay.vtRatio?.primaryV, 110000);
  assert.strictEqual(relay.vtRatio?.secondaryV, 100);

  // Distance zones
  assert.strictEqual(relay.ansi21?.length, 2);
  const z1 = relay.ansi21[0]!;
  assert.strictEqual(z1.zoneNumber, 1);
  assert.strictEqual(z1.reachOhm, 4.2);
  assert.strictEqual(z1.resistanceReachOhm, 9.0);
  assert.strictEqual(z1.delaySec, 0.0);
  assert.strictEqual(z1.characteristic, "quadrilateral");

  const z2 = relay.ansi21[1]!;
  assert.strictEqual(z2.zoneNumber, 2);
  assert.strictEqual(z2.reachOhm, 7.5);
  assert.strictEqual(z2.delaySec, 0.35);

  // Overcurrent
  assert.strictEqual(relay.ansi51?.length, 1);
  assert.strictEqual(relay.ansi51[0]?.pickupCurrentA, 1.2);
  assert.strictEqual(relay.ansi50?.length, 1);
  assert.strictEqual(relay.ansi50[0]?.pickupCurrentA, 15.0);
});

test("verifyProtectionSelectivity: evaluates CTI coordination between feeder and upstream backup", () => {
  // Primary Feeder Relay (fast instantaneous trip for in-zone faults)
  const primaryRelay: RelaySettingManifest = {
    id: "feeder_cb1",
    manufacturer: "SEL",
    series: "SEL-700",
    model: "SEL-751",
    ctRatio: { primaryA: 600, secondaryA: 5 },
    ansi50: [{ functionName: "50P", pickupCurrentA: 20.0, delaySec: 0.03 }], // 20A sec = 2400A prim -> trips in 30ms
  };

  // Upstream Transformer Backup Relay (delayed time-overcurrent)
  const backupRelay: RelaySettingManifest = {
    id: "transformer_cb0",
    manufacturer: "Siemens",
    series: "SIPROTEC 5",
    model: "7SJ85",
    ctRatio: { primaryA: 1200, secondaryA: 1 },
    ansi51: [
      {
        functionName: "51P",
        curveType: "iec_standard_inverse",
        pickupCurrentA: 1.0, // 1A sec = 1200A prim
        timeDial: 0.25,
      },
    ],
  };

  // For a fault current of 4,800 A:
  // Primary sees 4800 * (5 / 600) = 40A sec >= 20A -> trips in 0.03s
  // Backup sees 4800 * (1 / 1200) = 4.0A sec (M = 4)
  // Backup trip time = 0.25 * (0.14 / (4^0.02 - 1)) ≈ 0.25 * (0.14 / 0.02811) ≈ 1.245s
  // Margin = 1.245s - 0.03s = 1.215s >= 0.30s -> Selective!
  const resSelective = verifyProtectionSelectivity(primaryRelay, backupRelay, 4800, 0.30);
  assert.strictEqual(resSelective.selective, true);
  assert.ok(resSelective.coordinationTimeMarginSec > 1.0);
  assert.strictEqual(resSelective.violationDescription, undefined);

  // Unselective test case: backup delay is only 0.10s -> margin = 0.10 - 0.03 = 0.07s < 0.30s
  const fastBackupRelay: RelaySettingManifest = {
    ...backupRelay,
    ansi50: [{ functionName: "50P", pickupCurrentA: 2.0, delaySec: 0.10 }],
  };
  const resUnselective = verifyProtectionSelectivity(primaryRelay, fastBackupRelay, 4800, 0.30);
  assert.strictEqual(resUnselective.selective, false);
  assert.ok(resUnselective.coordinationTimeMarginSec < 0.30);
  assert.ok(resUnselective.violationDescription?.includes("less than required CTI"));
});
