// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInp, solveWaterQuality } from "../src/index.js";

describe("EPANET Multi-Species Disinfection Byproducts & Nitrification Kinetics", () => {
  const MUNICIPAL_NETWORK = `[TITLE]
Municipal Water Distribution Network with Storage Tank

[JUNCTIONS]
;ID   Elev   Demand  Pattern
 J1   10.0   30.0    
 J2   15.0   25.0    
 J3   20.0   20.0    
 J_PERIPHERY 25.0 5.0

[RESERVOIRS]
;ID   Head
 WTP_SOURCE 65.0

[TANKS]
;ID   Elev   InitLevel  MinLevel  MaxLevel  Diam  MinVol
 T1   40.0   6.0        2.0       10.0      25.0  0.0

[PIPES]
;ID   Node1       Node2       Length  Diam  Roughness  Status
 P1   WTP_SOURCE  J1          1500    400   120        OPEN
 P2   J1          J2          1000    350   120        OPEN
 P3   J2          J3          800     300   120        OPEN
 P4   J2          T1          500     300   120        OPEN
 P5   J3          J_PERIPHERY 2500    150   100        OPEN

[OPTIONS]
 UNITS       LPS
 HEADLOSS    H-W
`;

  it("1. Simulates Total Trihalomethanes (TTHM) formation under Stage 2 DBPR", () => {
    const net = parseInp(MUNICIPAL_NETWORK);
    const res = solveWaterQuality(net, {
      parameter: "DBP_TTHM",
      durationHours: 48,
      timeStepMinutes: 30,
      tocMgL: 3.5, // 3.5 mg/L TOC
      waterTempCelsius: 24.0, // Warm summer temperature promotes DBP growth
      waterPh: 7.8,
      maxTthmThresholdUgL: 80.0,
    });

    assert.strictEqual(res.parameter, "DBP_TTHM");
    assert.ok(res.maxTthmUgL !== undefined && res.maxTthmUgL > 15.0, "TTHM should form beyond source 15 ug/L");
    assert.ok(res.summary.includes("Stage 2 DBPR"), "Summary must reference Stage 2 DBPR");

    // Periphery node has longest travel time -> highest TTHM
    const sourceProf = res.nodeProfiles.get("WTP_SOURCE")!;
    const periphProf = res.nodeProfiles.get("J_PERIPHERY")!;
    assert.ok(
      periphProf.averageValue > sourceProf.averageValue,
      `Periphery TTHM (${periphProf.averageValue.toFixed(1)}) should exceed source (${sourceProf.averageValue.toFixed(1)})`,
    );
  });

  it("2. Simulates Haloacetic Acids (HAA5) formation and detects regulatory violations", () => {
    const net = parseInp(MUNICIPAL_NETWORK);
    const res = solveWaterQuality(net, {
      parameter: "DBP_HAA5",
      durationHours: 48,
      timeStepMinutes: 30,
      tocMgL: 4.2,
      waterTempCelsius: 26.0,
      maxHaa5ThresholdUgL: 40.0, // Strict utility threshold
    });

    assert.strictEqual(res.parameter, "DBP_HAA5");
    assert.ok(res.maxHaa5UgL !== undefined && res.maxHaa5UgL > 10.0, "HAA5 should form beyond source level");
    assert.ok(res.summary.includes("HAA5"), "Summary must report HAA5 results");

    // Check profiles have violatesDbpStandard populated
    for (const prof of res.nodeProfiles.values()) {
      assert.strictEqual(typeof prof.violatesDbpStandard, "boolean");
    }
  });

  it("3. Evaluates Chloramine auto-decomposition and Nitrification risk", () => {
    const net = parseInp(MUNICIPAL_NETWORK);
    const res = solveWaterQuality(net, {
      parameter: "CHLORAMINE_NITRIFICATION",
      durationHours: 48,
      timeStepMinutes: 30,
      sourceQualityMgL: 3.0, // 3.0 mg/L monochloramine
      freeAmmoniaMgL: 0.25, // 0.25 mg/L free ammonia promotes nitrification
      waterTempCelsius: 25.0,
      minResidualThresholdMgL: 1.0,
    });

    assert.strictEqual(res.parameter, "CHLORAMINE_NITRIFICATION");
    assert.ok(res.summary.includes("Nitrification Assessment"), "Summary must indicate nitrification assessment");
    assert.ok(res.minSystemResidual < 3.0, "Monochloramine should decay across network");

    // Profiles should categorize nitrification risk
    for (const prof of res.nodeProfiles.values()) {
      assert.ok(
        ["LOW", "MODERATE", "HIGH"].includes(prof.nitrificationRisk ?? ""),
        `Profile should have valid nitrification risk: ${prof.nitrificationRisk}`,
      );
    }

    assert.ok(Array.isArray(res.nitrificationAlertNodes), "Should report array of alert nodes");
  });
});
