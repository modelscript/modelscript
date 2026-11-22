// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  runSysML2FastStaticLints,
  runSysML2FormalExtendedLints,
  verifySysML2ChcActionLoops,
  verifySysML2DdeCyberPhysicalLatency,
  verifySysML2EgraphRequirements,
  verifySysML2Hc4RollupBudgets,
  verifySysML2HjiAdversarialHazards,
  verifySysML2StarSetCalcEnvelopes,
  verifySysML2TarjanCyclicBindings,
} from "../src/static-formal-checks.js";

test("S7007: E-graph detects direct requirement contradiction and redundant duplicates", () => {
  const src = `
    requirement def ThermalLimitsA {
      require constraint { temp <= 80 }
      require constraint { mass <= 50 }
    }
    requirement def ThermalLimitsB {
      require constraint { temp > 80 }
      require constraint { mass <= 50 }
    }
  `;
  const diags = verifySysML2EgraphRequirements(src);
  assert.ok(
    diags.some((d) => d.code === 7007 && d.message.includes("contradiction")),
    `Expected S7007 contradiction, got: ${JSON.stringify(diags)}`,
  );
  assert.ok(
    diags.some((d) => d.code === 7007 && d.message.includes("redundant")),
    `Expected S7007 redundancy, got: ${JSON.stringify(diags)}`,
  );
});

test("S7008: HC4 detects infeasible attribute rollup budget", () => {
  const src = `
    part def Drone {
      part frame { attribute mass = 3.5; }
      part battery { attribute mass = 4.2; }
      part payload { attribute mass = 3.0; }
      require constraint { totalMass <= 10.0 }
    }
  `;
  const diags = verifySysML2Hc4RollupBudgets(src);
  assert.ok(
    diags.some((d) => d.code === 7008 && d.message.includes("10.70")),
    `Expected S7008 rollup budget violation, got: ${JSON.stringify(diags)}`,
  );
});

test("S7009: Tarjan SCC detects cyclic bind/flow deadlocks", () => {
  const src = `
    part def ControllerLoop {
      bind a = b;
      bind b = c;
      bind c = a;
    }
  `;
  const diags = verifySysML2TarjanCyclicBindings(src);
  assert.ok(
    diags.some((d) => d.code === 7009 && d.message.includes("->")),
    `Expected S7009 cyclic binding deadlock, got: ${JSON.stringify(diags)}`,
  );
});

test("S7010-S7013: Formal lints detect unbounded action loops, DDE latency instability, HJI hazard breach, and Star-Set calc breach", () => {
  const chcSrc = `
    action def WatchdogLoop {
      while true {
        action ping;
      }
    }
  `;
  assert.ok(verifySysML2ChcActionLoops(chcSrc).some((d) => d.code === 7010));

  const ddeSrc = `
    part def FlightControl {
      attribute sensorDelaySec = 0.02;
      attribute busDelaySec = 0.03;
      attribute bandwidthHz = 50.0;
    }
  `;
  assert.ok(verifySysML2DdeCyberPhysicalLatency(ddeSrc).some((d) => d.code === 7011));

  const hjiSrc = `
    part def AutonomousBraking {
      attribute maxSpoofDisturbance = 2.5;
      attribute controlGain = 1.0;
      attribute safetyMargin = 1.0;
    }
  `;
  assert.ok(verifySysML2HjiAdversarialHazards(hjiSrc).some((d) => d.code === 7012));

  const starSrc = `
    calc def SaturationGain {
      attribute inMax = 10.0;
      attribute slope = 2.5;
      attribute outMax = 20.0;
    }
  `;
  assert.ok(verifySysML2StarSetCalcEnvelopes(starSrc).some((d) => d.code === 7013));
});

test("Clean SysML v2 model passes Tier 1 fast static lints (< 15 ms) and Tier 2 formal lints with 0 diagnostics", () => {
  const cleanSrc = `
    part def HealthyUAV {
      part frame { attribute mass = 2.0; }
      part battery { attribute mass = 3.0; }
      attribute latency = 0.005;
      attribute bandwidth = 20.0;
      bind sensorOut = filterIn;
      bind filterOut = actuatorIn;
      require constraint { totalMass <= 8.0 }
      require constraint { temp <= 75 }
    }
  `;
  const t0 = performance.now();
  const fastDiags = runSysML2FastStaticLints(cleanSrc);
  const elapsedMs = performance.now() - t0;
  assert.equal(fastDiags.length, 0, `Expected 0 fast diagnostics, got: ${JSON.stringify(fastDiags)}`);
  assert.ok(elapsedMs < 15, `Expected Tier 1 fast static lints < 15 ms, took ${elapsedMs.toFixed(2)} ms`);

  const formalDiags = runSysML2FormalExtendedLints(cleanSrc);
  assert.equal(formalDiags.length, 0, `Expected 0 formal diagnostics, got: ${JSON.stringify(formalDiags)}`);
});
