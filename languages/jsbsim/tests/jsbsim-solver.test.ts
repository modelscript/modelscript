// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { linearizeFlightDynamics, parseJsbsim, solveFlightDynamics, trimFlightCondition } from "../src/index.js";

const TEST_XML = `<?xml version="1.0"?>
<fdm_config name="c172_test" version="2.0">
  <metrics>
    <wingarea unit="FT2"> 174.0 </wingarea>
    <wingspan unit="FT"> 36.0 </wingspan>
    <chord unit="FT"> 4.9 </chord>
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
      <function name="aero/coefficient/CD0">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <value> 0.028 </value>
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

test("JSBSim Solver: integrates 6-DOF cruise trajectory", () => {
  const doc = parseJsbsim(TEST_XML);
  const res = solveFlightDynamics(doc, {
    duration: 5.0,
    timeStep: 0.02,
    initialAltitudeFt: 5000.0,
    initialSpeedFps: 180.0,
  });

  assert.equal(res.aircraftName, "c172_test");
  assert.ok(res.stepsCount >= 200);
  assert.ok(res.finalSpeed > 100.0 && res.finalSpeed < 300.0);
});

test("JSBSim Solver: trims steady flight and extracts Short-Period & Phugoid modes", () => {
  const doc = parseJsbsim(TEST_XML);
  const trim = trimFlightCondition(doc, { speedFps: 180.0, altitudeFt: 5000.0 });

  assert.equal(trim.converged, true);
  assert.ok(trim.throttle > 0.0 && trim.throttle < 1.0);

  const lin = linearizeFlightDynamics(doc, { speedFps: 180.0, altitudeFt: 5000.0 });
  assert.equal(lin.A.length, 4);
  assert.ok(lin.shortPeriod.naturalFrequencyRadSec > lin.phugoid.naturalFrequencyRadSec);
  assert.ok(lin.shortPeriod.dampingRatio > 0.0);
});
