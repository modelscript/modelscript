// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  type DistributionFeederReliabilityModel,
  evaluateDistributionReliability,
} from "../src/solvers/reliability/distribution-reliability.js";

test("evaluateDistributionReliability: baseline radial feeder evaluates IEEE 1366 indices", () => {
  const model: DistributionFeederReliabilityModel = {
    feederId: "Feeder_Alpha",
    sourceBusId: "Substation",
    branches: [
      { id: "L1", fromBus: "Substation", toBus: "Bus1", lengthKm: 2.0, failureRatePerYear: 0.1, repairTimeHours: 3.0 },
      { id: "L2", fromBus: "Bus1", toBus: "Bus2", lengthKm: 3.0, failureRatePerYear: 0.15, repairTimeHours: 3.5 },
      { id: "L3", fromBus: "Bus2", toBus: "Bus3", lengthKm: 2.5, failureRatePerYear: 0.12, repairTimeHours: 4.0 },
    ],
    loadPoints: [
      { busId: "Bus1", customerCount: 400, averageLoadKw: 800 },
      { busId: "Bus2", customerCount: 600, averageLoadKw: 1200 },
      { busId: "Bus3", customerCount: 500, averageLoadKw: 1000 },
    ],
  };

  const res = evaluateDistributionReliability(model);

  assert.equal(res.system.totalCustomers, 1500);
  assert.equal(res.system.totalLoadKw, 3000);

  // SAIFI must be positive and typical for distribution (~0.5 - 2.5 int/cust/yr)
  assert.ok(
    res.system.saifi > 0.1 && res.system.saifi < 3.0,
    `SAIFI should be in typical range, got ${res.system.saifi}`,
  );

  // SAIDI must be positive and CAIDI = SAIDI / SAIFI
  assert.ok(res.system.saidi > 0, `SAIDI must be positive, got ${res.system.saidi}`);
  assert.ok(Math.abs(res.system.caidi - res.system.saidi / res.system.saifi) < 0.05, "CAIDI must equal SAIDI / SAIFI");

  // ASAI must be > 0.999
  assert.ok(res.system.asai > 0.999, `ASAI should be > 0.999, got ${res.system.asai}`);

  // EENS must be positive
  assert.ok(res.system.eensMwh > 0, `EENS must be positive, got ${res.system.eensMwh}`);

  // Critical branches must be sorted
  assert.ok(res.criticalBranches.length === 3);
  assert.ok(res.criticalBranches[0]!.contributionToSaidiHours >= res.criticalBranches[1]!.contributionToSaidiHours);
});

test("evaluateDistributionReliability: recloser with auto-reclosing reduces SAIDI and generates MAIFI", () => {
  const baseModel: DistributionFeederReliabilityModel = {
    feederId: "Feeder_Beta",
    sourceBusId: "Substation",
    branches: [
      { id: "L1", fromBus: "Substation", toBus: "Bus1", failureRatePerYear: 0.2, repairTimeHours: 3.0 },
      { id: "L2", fromBus: "Bus1", toBus: "Bus2", failureRatePerYear: 0.3, repairTimeHours: 3.0 },
    ],
    loadPoints: [
      { busId: "Bus1", customerCount: 500, averageLoadKw: 1000 },
      { busId: "Bus2", customerCount: 500, averageLoadKw: 1000 },
    ],
  };

  const resWithoutRecloser = evaluateDistributionReliability(baseModel);

  const modelWithRecloser: DistributionFeederReliabilityModel = {
    ...baseModel,
    protectionDevices: [{ id: "REC1", type: "recloser", branchId: "L1", hasAutoReclosing: true }],
  };

  const resWithRecloser = evaluateDistributionReliability(modelWithRecloser);

  // Auto-reclosing clears temporary faults, reducing sustained SAIFI & SAIDI
  assert.ok(
    resWithRecloser.system.saifi < resWithoutRecloser.system.saifi,
    `SAIFI with recloser (${resWithRecloser.system.saifi}) should be lower than without (${resWithoutRecloser.system.saifi})`,
  );
  assert.ok(
    resWithRecloser.system.saidi < resWithoutRecloser.system.saidi,
    `SAIDI with recloser (${resWithRecloser.system.saidi}) should be lower than without (${resWithoutRecloser.system.saidi})`,
  );

  // Cleared temporary faults register as MAIFI
  assert.ok(resWithRecloser.system.maifi > 0, "Recloser must generate non-zero MAIFI");
  assert.equal(resWithoutRecloser.system.maifi, 0, "No recloser should yield 0 MAIFI");
});

test("evaluateDistributionReliability: tie switch backfeeding improves reliability", () => {
  const baseModel: DistributionFeederReliabilityModel = {
    feederId: "Feeder_Gamma",
    sourceBusId: "Substation",
    branches: [
      { id: "L1", fromBus: "Substation", toBus: "Bus1", failureRatePerYear: 0.15, repairTimeHours: 4.0 },
      { id: "L2", fromBus: "Bus1", toBus: "Bus2", failureRatePerYear: 0.2, repairTimeHours: 4.0 },
    ],
    loadPoints: [
      { busId: "Bus1", customerCount: 300, averageLoadKw: 600 },
      { busId: "Bus2", customerCount: 700, averageLoadKw: 1400 },
    ],
  };

  const resRadial = evaluateDistributionReliability(baseModel);

  const modelWithTie: DistributionFeederReliabilityModel = {
    ...baseModel,
    tieSwitches: [
      {
        id: "TIE_1",
        fromBus: "Bus2",
        toBus: "AdjacentFeeder",
        normallyOpen: true,
        reserveCapacityMw: 5.0, // Sufficient capacity to backfeed
        switchingTimeHours: 0.25, // 15 min automated backfeed
      },
    ],
  };

  const resTie = evaluateDistributionReliability(modelWithTie);

  // Backfeeding reduces outage duration from 4h MTTR to 0.25h switching time for backfed loads
  assert.ok(
    resTie.system.saidi < resRadial.system.saidi,
    `SAIDI with tie switch (${resTie.system.saidi}) must be lower than pure radial (${resRadial.system.saidi})`,
  );
  assert.ok(
    resTie.system.eensMwh < resRadial.system.eensMwh,
    `EENS with tie switch (${resTie.system.eensMwh}) must be lower than pure radial (${resRadial.system.eensMwh})`,
  );
});
