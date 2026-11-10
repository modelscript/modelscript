// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JSBSim Flight Dynamics Model Benchmark Runner
 *
 * Simulates nonlinear 6-DOF flight equations of motion, computes steady-state flight trim,
 * and extracts longitudinal dynamic stability modes (Short-Period and Phugoid).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  linearizeFlightDynamics,
  lowerJsbsimToDae,
  parseJsbsim,
  solveFlightDynamics,
  trimFlightCondition,
  type JsbsimLinearizationResult,
  type JsbsimSimulationResult,
  type JsbsimTrimResult,
} from "../src/index.js";

export const C172_FULL_AERO_DECK = `<?xml version="1.0"?>
<fdm_config name="c172p_benchmark" version="2.0">
  <fileheader>
    <author>ModelScript Aerospace Benchmark Suite</author>
    <description>Cessna 172 Skyhawk Full 6-DOF Aerodynamic Benchmark Model</description>
  </fileheader>
  <metrics>
    <wingarea unit="FT2"> 174.0 </wingarea>
    <wingspan unit="FT"> 36.0 </wingspan>
    <chord unit="FT"> 4.9 </chord>
    <htailarea unit="FT2"> 21.9 </htailarea>
    <htailarm unit="FT"> 15.7 </htailarm>
    <vtailarea unit="FT2"> 16.5 </vtailarea>
    <vtailarm unit="FT"> 15.7 </vtailarm>
    <location name="AERORP" unit="IN"><x>43.2</x><y>0.0</y><z>0.0</z></location>
  </metrics>
  <mass_balance>
    <emptywt unit="LBS"> 1500.0 </emptywt>
    <location name="CG" unit="IN"><x>41.5</x><y>0.0</y><z>0.0</z></location>
    <ixx unit="SLUG*FT2"> 948.0 </ixx>
    <iyy unit="SLUG*FT2"> 1346.0 </iyy>
    <izz unit="SLUG*FT2"> 1967.0 </izz>
    <ixz unit="SLUG*FT2"> 0.0 </ixz>
  </mass_balance>
  <propulsion>
    <engine file="Lycoming-O-320">
      <location unit="IN"><x>20.0</x><y>0.0</y><z>0.0</z></location>
      <max_thrust> 450.0 </max_thrust>
    </engine>
  </propulsion>
  <aerodynamics>
    <axis name="LIFT">
      <function name="aero/coefficient/CLwbh">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <table>
            <independentVar lookup="row">aero/alpha-rad</independentVar>
            <tableData>
              -0.20  -0.65
               0.00   0.32
               0.10   0.82
               0.20   1.32
            </tableData>
          </table>
        </product>
      </function>
    </axis>
    <axis name="DRAG">
      <function name="aero/coefficient/CD">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <sum>
            <value> 0.028 </value>
            <table>
              <independentVar lookup="row">aero/alpha-rad</independentVar>
              <tableData>
                -0.20   0.040
                 0.00   0.000
                 0.10   0.020
                 0.20   0.065
              </tableData>
            </table>
          </sum>
        </product>
      </function>
    </axis>
    <axis name="PITCH">
      <function name="aero/coefficient/Cmalpha">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <value> -0.80 </value>
        </product>
      </function>
    </axis>
  </aerodynamics>
</fdm_config>`;

export interface JsbsimBenchmarkReport {
  aircraftName: string;
  trimConverged: boolean;
  trimAlphaDeg: number;
  trimThrottle: number;
  shortPeriodOmegaRadSec: number;
  shortPeriodZeta: number;
  phugoidOmegaRadSec: number;
  phugoidZeta: number;
  simStepsCount: number;
  simFinalSpeedFps: number;
  simFinalAltitudeFt: number;
  daeVariablesCount: number;
  daeEquationsCount: number;
  isSquare: boolean;
}

export function runJsbsimBenchmark(xml = C172_FULL_AERO_DECK): JsbsimBenchmarkReport {
  const doc = parseJsbsim(xml);

  // 1. Flight condition trim solver
  const trim: JsbsimTrimResult = trimFlightCondition(doc, { speedFps: 180.0, altitudeFt: 5000.0 });
  assert.ok(trim.converged, "JSBSim trim solver must converge");
  assert.ok(trim.throttle > 0.1 && trim.throttle < 0.9, `Throttle ${trim.throttle} within engine envelope`);

  // 2. Longitudinal modal analysis
  const lin: JsbsimLinearizationResult = linearizeFlightDynamics(doc, { speedFps: 180.0, altitudeFt: 5000.0 });
  assert.ok(lin.shortPeriod.naturalFrequencyRadSec > 1.0, `Short-period omega ${lin.shortPeriod.naturalFrequencyRadSec}`);
  assert.ok(lin.shortPeriod.dampingRatio > 0.3, `Short-period damping ${lin.shortPeriod.dampingRatio}`);
  assert.ok(lin.phugoid.naturalFrequencyRadSec < 0.5, `Phugoid omega ${lin.phugoid.naturalFrequencyRadSec}`);

  // 3. Nonlinear 6-DOF trajectory simulation
  const sim: JsbsimSimulationResult = solveFlightDynamics(doc, {
    duration: 10.0,
    timeStep: 0.02,
    initialAltitudeFt: 5000.0,
    initialSpeedFps: 180.0,
  });
  assert.ok(sim.stepsCount >= 450);
  assert.ok(sim.finalSpeed > 150.0 && sim.finalSpeed < 220.0);
  assert.ok(sim.finalAltitude > 4500.0 && sim.finalAltitude < 5500.0);

  // 4. DAE lowering
  const dae = lowerJsbsimToDae(doc);
  const nVars = dae.variables().length;
  const nEqs = dae.equations().length;
  assert.equal(nVars, nEqs, "JSBSim DAE arena must be square");

  return {
    aircraftName: doc.model.name,
    trimConverged: trim.converged,
    trimAlphaDeg: (trim.alphaRad * 180.0) / Math.PI,
    trimThrottle: trim.throttle,
    shortPeriodOmegaRadSec: lin.shortPeriod.naturalFrequencyRadSec,
    shortPeriodZeta: lin.shortPeriod.dampingRatio,
    phugoidOmegaRadSec: lin.phugoid.naturalFrequencyRadSec,
    phugoidZeta: lin.phugoid.dampingRatio,
    simStepsCount: sim.stepsCount,
    simFinalSpeedFps: sim.finalSpeed,
    simFinalAltitudeFt: sim.finalAltitude,
    daeVariablesCount: nVars,
    daeEquationsCount: nEqs,
    isSquare: nVars === nEqs,
  };
}

if (process.argv[1] && process.argv[1].endsWith("jsbsim-benchmark-runner.ts")) {
  console.log("=== JSBSim 6-DOF Flight Dynamics Benchmark ===");
  const report = runJsbsimBenchmark();
  console.log(JSON.stringify(report, null, 2));
}
