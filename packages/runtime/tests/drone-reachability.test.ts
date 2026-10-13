// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import { describe, it } from "node:test";

import {
  CaeContractOracle,
  SemanticTheoryCoordinator,
  simulateDroneReachability,
  SpatialPhysicsOracle,
} from "../src/index.js";

describe("Native Drone Reachability & Theory Coordination (Runtime Verification)", () => {
  it("Nelson-Oppen Theory Coordinator should prove multi-domain contract SAT", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const spatialOracle = new SpatialPhysicsOracle();
    const caeOracle = new CaeContractOracle();

    coordinator.registerOracle(spatialOracle);
    coordinator.registerOracle(caeOracle);

    // Assert multi-domain contracts
    spatialOracle.assertDroneSlicingProperties({
      mass: 1.2,
      maxVonMisesPa: 172.4e6,
      yieldStrengthPa: 180.0e6,
      frontalAreaM2: 0.03,
      dragCoeff: 0.8,
    });

    caeOracle.assertContract({
      contractId: "SYSML-REQ-FLIGHT-CEILING",
      metricName: "maxClimbVelocity",
      actualValue: 11.42,
      threshold: 12.0,
      operator: "<=",
      unit: "m/s",
    });

    const satResult = coordinator.checkSat();
    expect(satResult.isSat).toBe(true);

    const equalities = spatialOracle.propagateEqualities();
    const massEq = equalities.find((e) => e.varA === "DroneSimulation.m");
    const areaEq = equalities.find((e) => e.varA === "DroneSimulation.A");
    const cdEq = equalities.find((e) => e.varA === "DroneSimulation.Cd");

    expect(massEq).toBeDefined();
    expect(massEq?.bounds?.[0]).toBe(1.2);
    expect(areaEq).toBeDefined();
    expect(areaEq?.bounds?.[0]).toBe(0.03);
    expect(cdEq).toBeDefined();
    expect(cdEq?.bounds?.[0]).toBe(0.8);
  });

  it("linearized zonotope estimate reproduces the reference envelope (non-rigorous)", () => {
    const result = simulateDroneReachability({
      m: 1.2,
      A: 0.03,
      Cd: 0.8,
      rho: 1.225,
      z_target: 11.0,
      kz: 3.1,
      kv: 1.35,
      w_max: 0.5,
      v_limit: 12.0,
    });

    // 1. Zonotope envelope stays below the limit, but this is an estimate, not a proof
    expect(result.envelopeWithinLimit).toBe(true);
    expect(result.zonotopeMaxVelocity).toBe(11.42);
    expect(result.verdict.kind).toBe("unknown");
    expect(result.verdict.kind === "unknown" && result.verdict.reason).toBe("not-rigorous");

    // 2. High-speed performance (< 10ms, typically < 3ms)
    expect(result.durationMs).toBeLessThan(15.0);

    // 3. Interval arithmetic wrapping blow-up crosses the limit at t = 3.42s
    expect(result.intervalBreachTime).toBe(3.42);
    expect(result.intervalMaxVelocity).toBeGreaterThan(12.0);

    // 4. Negative settling velocity dip down to -3.25 m/s
    expect(result.settlingDipVelocity).toBe(-3.25);

    // 5. Summary text must not claim certification
    expect(result.summary).toContain("non-rigorous");
    expect(result.summary).not.toContain("certified");
  });
});
