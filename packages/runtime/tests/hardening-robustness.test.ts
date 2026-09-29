// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConstrainedZonotope,
  Hc4Contractor,
  Interval,
  SdpSolver,
  TraceRecordNormalizer,
  addMachineEps,
  subMachineEps,
} from "../src/index.js";

describe("Production Hardening & Verification Robustness Suite", () => {
  describe("1. IEEE-754 Outward Directed Rounding & Interval Enclosure", () => {
    it("should strictly expand floating point bounds outward", () => {
      const x = 1.0;
      const xDown = subMachineEps(x);
      const xUp = addMachineEps(x);

      assert.ok(xDown < x, "xDown must be strictly less than x");
      assert.ok(xUp > x, "xUp must be strictly greater than x");
      assert.ok(x - xDown <= 1e-15, "delta must be on the order of machine epsilon");
      assert.ok(xUp - x <= 1e-15, "delta must be on the order of machine epsilon");
    });

    it("should enclose mathematical operations outward across epsilon boundaries", () => {
      const a = new Interval(1.0, 2.0);
      const b = new Interval(3.0, 4.0);

      const add = Interval.addOutward(a, b);
      assert.ok(add.lo < 4.0, "add.lo must be strictly less than nominal 4.0");
      assert.ok(add.hi > 6.0, "add.hi must be strictly greater than nominal 6.0");

      const mul = Interval.mulOutward(a, b);
      assert.ok(mul.lo < 3.0, "mul.lo must be strictly less than nominal 3.0");
      assert.ok(mul.hi > 8.0, "mul.hi must be strictly greater than nominal 8.0");

      const div = Interval.divOutward(a, b);
      assert.ok(div.lo < 1.0 / 4.0);
      assert.ok(div.hi > 2.0 / 3.0);
    });

    it("should evaluate HC4 DAG non-linear constraints with outward rounding", () => {
      const box = new Map<string, Interval>([["x", new Interval(2.0, 3.0)]]);

      const expr = {
        kind: "sqr" as const,
        child: { kind: "var" as const, name: "x" },
      };

      const iv = Hc4Contractor.evalInterval(expr, box);
      assert.ok(iv.lo <= 4.0, "x^2 lower bound must enclose 4.0");
      assert.ok(iv.hi >= 9.0, "x^2 upper bound must enclose 9.0");
    });
  });

  describe("2. SDP Numerical Regularization & Spectral PSD Cone Projection", () => {
    it("should project indefinite matrix onto the PSD cone via Jacobi spectral decomposition", () => {
      // Indefinite matrix with eigenvalues [-1, 3]
      const X = [
        [1.0, 2.0],
        [2.0, 1.0],
      ];

      const X_psd = SdpSolver.projectPsdCone(X, 1e-6);

      // Verify symmetry
      assert.ok(Math.abs(X_psd[0]![1]! - X_psd[1]![0]!) < 1e-10);

      // Verify positive semidefiniteness
      assert.ok(SdpSolver.isPsd(X_psd));

      // Diagonal elements must be >= 1e-6
      assert.ok(X_psd[0]![0]! >= 1e-6);
      assert.ok(X_psd[1]![1]! >= 1e-6);
    });

    it("should factor near-singular matrices with adaptive Tikhonov regularization", () => {
      const singularA = [
        [1.0, 1.0],
        [1.0, 1.0],
      ];

      const L = SdpSolver.choleskyRegularized(singularA, 1e-6);
      assert.ok(L !== null, "Regularized Cholesky must succeed on singular matrix");
      assert.ok(L.length === 2);
    });
  });

  describe("3. Girard/Giroux Constrained Zonotope Order Reduction", () => {
    it("should reduce a high-generator zonotope into a strictly containing bounding super-set", () => {
      // 2D zonotope with 6 generators
      const center = [0, 0];
      const generators = [
        [10.0, 0.0], // Dominant 1
        [0.0, 8.0], // Dominant 2
        [1.0, 1.0], // Small 1
        [-0.5, 0.5], // Small 2
        [0.2, -0.3], // Small 3
        [-0.1, 0.4], // Small 4
      ];

      const cz = new ConstrainedZonotope(center, generators);
      assert.equal(cz.numGenerators, 6);

      // Reduce to 4 generators (2 dominant + 2 diagonal bounding box generators)
      const reduced = cz.reduce(4);
      assert.equal(reduced.numGenerators, 4);

      // Verify that reduced zonotope hull bounds the original hull
      const origHull = cz.toIntervals();
      const redHull = reduced.toIntervals();

      for (let i = 0; i < 2; i++) {
        assert.ok(
          redHull[i]!.lo <= origHull[i]!.lo + 1e-10,
          `Reduced bound lo (${redHull[i]!.lo}) must contain original lo (${origHull[i]!.lo})`,
        );
        assert.ok(
          redHull[i]!.hi >= origHull[i]!.hi - 1e-10,
          `Reduced bound hi (${redHull[i]!.hi}) must contain original hi (${origHull[i]!.hi})`,
        );
      }
    });
  });

  describe("4. Unified Canonical Trace Record Normalization", () => {
    it("should normalize discrete BMC counterexamples", () => {
      const bmcSteps = [
        { state: "IDLE", count: 0 },
        { state: "RUNNING", count: 1 },
        { state: "ERROR", count: 2 },
      ];

      const trace = TraceRecordNormalizer.fromBmcCounterexample(bmcSteps, "SafeStateInvariant");
      assert.equal(trace.source, "bmc");
      assert.equal(trace.status, "FALSIFIED");
      assert.equal(trace.violatingTimeIndex, 2);
      assert.deepEqual(trace.discreteSignals?.["state"], ["IDLE", "RUNNING", "ERROR"]);
      assert.deepEqual(trace.discreteSignals?.["count"], [0, 1, 2]);
    });

    it("should normalize continuous adversarial falsification trajectories", () => {
      const times = [0, 0.5, 1.0];
      const signals = {
        speed: [10, 55, 120],
      };

      const trace = TraceRecordNormalizer.fromFalsificationTrajectory({
        times,
        signals,
        parameters: { maxThrottle: 0.95 },
        propertyName: "SpeedLimitRequirement",
        minRobustness: -20.0,
        violatingTimeIndex: 2,
      });

      assert.equal(trace.source, "falsification");
      assert.equal(trace.status, "FALSIFIED");
      assert.equal(trace.violatingTimeIndex, 2);
      assert.equal(trace.parameters?.["maxThrottle"], 0.95);
      assert.deepEqual(trace.continuousSignals["speed"], [10, 55, 120]);
    });

    it("should normalize reachability tube safety corridors", () => {
      const times = [0, 1.0];
      const tubes = [[{ lo: -1.0, hi: 1.0 }], [{ lo: -0.5, hi: 0.5 }]];

      const trace = TraceRecordNormalizer.fromFlowpipeTubes({
        times,
        variableNames: ["pos"],
        tubes,
      });

      assert.equal(trace.source, "flowpipe_escape");
      assert.equal(trace.status, "CERTIFIED_SAFE");
      assert.deepEqual(trace.continuousSignals["pos_lo"], [-1.0, -0.5]);
      assert.deepEqual(trace.continuousSignals["pos_hi"], [1.0, 0.5]);
      assert.deepEqual(trace.continuousSignals["pos_mid"], [0.0, 0.0]);
    });

    it("should export CanonicalTraceRecord to standard IEEE 1364 VCD format", () => {
      const times = [0, 0.001, 0.002];
      const signals = { voltage: [12.0, 12.5, 11.8] };
      const trace = TraceRecordNormalizer.fromFalsificationTrajectory({
        times,
        signals,
        minRobustness: -1.0,
      });

      const vcd = TraceRecordNormalizer.exportToVcd(trace);
      assert(vcd.includes("$version"), "VCD header missing");
      assert(vcd.includes("$var real 64"), "VCD variable missing");
      assert(vcd.includes("voltage"), "Signal name missing in VCD");
      assert(vcd.includes("#1000"), "Time step #1000 missing in VCD");
    });

    it("should export CanonicalTraceRecord to CSV and interpolate onto a target grid", () => {
      const times = [0, 1.0, 2.0];
      const signals = { temp: [20.0, 30.0, 40.0] };
      const trace = TraceRecordNormalizer.fromFalsificationTrajectory({
        times,
        signals,
        minRobustness: 5.0,
      });

      const csv = TraceRecordNormalizer.exportToCsv(trace);
      assert(csv.startsWith("time,temp"), "CSV header missing");
      assert(csv.includes("1,30"), "CSV row missing");

      // Interpolate at t = 0.5, 1.5
      const interpolated = TraceRecordNormalizer.interpolateTrace(trace, [0.5, 1.5]);
      assert.deepEqual(interpolated.times, [0.5, 1.5]);
      assert.equal(interpolated.continuousSignals["temp"]![0], 25.0);
      assert.equal(interpolated.continuousSignals["temp"]![1], 35.0);
    });
  });
});
