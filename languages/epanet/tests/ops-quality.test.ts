// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TOU_TARIFF, parseInp, solveOptimalPumpScheduling, solveWaterQuality } from "../src/index.js";

describe("EPANET Optimal Pump Scheduling (OPS) & Water Quality", () => {
  const TEST_NETWORK = `[TITLE]
Municipal Booster Pumping and Elevated Storage Test Network

[JUNCTIONS]
;ID   Elev   Demand  Pattern
 J1   10.0   30.0    PAT1
 J2   15.0   25.0    PAT1
 J3   20.0   20.0    PAT1

[RESERVOIRS]
;ID   Head
 RES1 50.0

[TANKS]
;ID   Elev   InitLevel  MinLevel  MaxLevel  Diam  MinVol
 T1   40.0   6.0        2.0       10.0      25.0  0.0

[PIPES]
;ID   Node1  Node2  Length  Diam  Roughness  Status
 P1   RES1   J1     1200    350   120        OPEN
 P2   J1     J2     800     300   120        OPEN
 P3   J2     J3     600     250   120        OPEN
 P4   J2     T1     400     300   120        OPEN

[PUMPS]
;ID    Node1  Node2  Parameters
 PUMP1 J1     J2     POWER 45.0
 PUMP2 J1     J2     POWER 30.0

[PATTERNS]
;ID   Multipliers
 PAT1 0.7 0.6 0.6 0.7 0.9 1.1 1.3 1.4 1.3 1.2 1.1 1.0 1.0 1.1 1.2 1.3 1.4 1.4 1.3 1.1 0.9 0.8 0.7 0.7

[OPTIONS]
 UNITS       LPS
 HEADLOSS    H-W
`;

  describe("1. Optimal Pump Scheduling (OPS)", () => {
    it("optimizes pump dispatch to minimize energy costs under TOU tariffs", () => {
      const net = parseInp(TEST_NETWORK);
      const res = solveOptimalPumpScheduling(net, DEFAULT_TOU_TARIFF, {
        durationHours: 24,
        maxSwitchesPerPump: 6,
      });

      assert.ok(res.totalCost > 0);
      assert.ok(res.baselineCost > 0);
      assert.ok(
        res.totalCost <= res.baselineCost,
        `Optimal cost (${res.totalCost}) should be less than or equal to baseline (${res.baselineCost})`,
      );
      assert.ok(res.costSavingsPct >= 0, "Savings percentage must be non-negative");

      // Verify tank levels remain within operational limits
      for (const [tankId, traj] of res.tankTrajectories) {
        assert.strictEqual(traj.length, 24);
        for (const pt of traj) {
          assert.ok(
            pt.waterLevelM >= 1.5,
            `Tank ${tankId} level (${pt.waterLevelM} m) violated low limit at hour ${pt.hour}`,
          );
          assert.ok(
            pt.waterLevelM <= 10.5,
            `Tank ${tankId} level (${pt.waterLevelM} m) violated high limit at hour ${pt.hour}`,
          );
        }
      }

      // Verify pump schedules exist for both pumps
      assert.strictEqual(res.pumpSchedules.size, 2);
      assert.ok(res.pumpSchedules.has("PUMP1"));
      assert.ok(res.pumpSchedules.has("PUMP2"));
      assert.strictEqual(res.pumpSchedules.get("PUMP1")?.length, 24);
    });
  });

  describe("2. Multi-Species Water Quality (Chlorine Decay & Water Age)", () => {
    it("simulates 1D advective chlorine disinfectant decay across distribution network", () => {
      const net = parseInp(TEST_NETWORK);
      const res = solveWaterQuality(net, {
        parameter: "CHLORINE",
        durationHours: 24,
        timeStepMinutes: 30,
        sourceQualityMgL: 2.0,
        bulkReactionRatePerDay: -0.6,
      });

      assert.strictEqual(res.parameter, "CHLORINE");
      assert.strictEqual(res.durationHours, 24);
      assert.ok(res.nodeProfiles.size >= 4);

      // Reservoir source should maintain 2.0 mg/L boundary condition
      const resProfile = res.nodeProfiles.get("RES1");
      assert.ok(resProfile);
      assert.strictEqual(resProfile.minValue, 2.0);
      assert.strictEqual(resProfile.maxValue, 2.0);

      // Downstream consumer nodes should experience decay below 2.0 mg/L
      const j3Profile = res.nodeProfiles.get("J3");
      assert.ok(j3Profile);
      assert.ok(
        j3Profile.averageValue < 2.0,
        `Junction J3 average chlorine (${j3Profile.averageValue}) should be less than source 2.0`,
      );
      assert.ok(j3Profile.averageValue > 0.0, "Chlorine should remain positive");
    });

    it("simulates water age accumulation along conveyance paths", () => {
      const net = parseInp(TEST_NETWORK);
      const res = solveWaterQuality(net, {
        parameter: "WATER_AGE",
        durationHours: 24,
        timeStepMinutes: 30,
      });

      assert.strictEqual(res.parameter, "WATER_AGE");

      // Source reservoir should have zero water age
      const resProfile = res.nodeProfiles.get("RES1");
      assert.ok(resProfile);
      assert.strictEqual(resProfile.averageValue, 0.0);

      // Downstream junction J3 should accumulate water age > 0
      const j3Profile = res.nodeProfiles.get("J3");
      assert.ok(j3Profile);
      assert.ok(j3Profile.averageValue > 0.0, "J3 water age should be greater than zero");
    });
  });
});
