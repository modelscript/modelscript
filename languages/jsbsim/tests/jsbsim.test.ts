// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAeroExpr,
  evaluateAeroTable,
  jsbsimToModelica,
  JsbsimWorkspaceIndex,
  linearizeFlightDynamics,
  lintJsbsim,
  lowerJsbsimToDae,
  parseJsbsim,
  serializeJsbsim,
  solveFlightDynamics,
  trimFlightCondition,
} from "../src/index.js";

const VALID_C172_XML = `<?xml version="1.0"?>
<fdm_config name="c172p" version="2.0" release="BETA">
  <fileheader>
    <author>ModelScript Aerospace Team</author>
    <description>Cessna 172 Skyhawk Flight Dynamics Model</description>
  </fileheader>
  <metrics>
    <wingarea unit="FT2"> 174.0 </wingarea>
    <wingspan unit="FT"> 36.0 </wingspan>
    <chord unit="FT"> 4.9 </chord>
    <htailarea unit="FT2"> 21.9 </htailarea>
    <htailarm unit="FT"> 15.7 </htailarm>
    <vtailarea unit="FT2"> 16.5 </vtailarea>
    <vtailarm unit="FT"> 15.7 </vtailarm>
    <location name="AERORP" unit="IN">
      <x> 43.2 </x>
      <y> 0.0 </y>
      <z> 0.0 </z>
    </location>
  </metrics>
  <mass_balance>
    <emptywt unit="LBS"> 1500.0 </emptywt>
    <location name="CG" unit="IN">
      <x> 41.5 </x>
      <y> 0.0 </y>
      <z> 0.0 </z>
    </location>
    <ixx unit="SLUG*FT2"> 948.0 </ixx>
    <iyy unit="SLUG*FT2"> 1346.0 </iyy>
    <izz unit="SLUG*FT2"> 1967.0 </izz>
    <ixz unit="SLUG*FT2"> 0.0 </ixz>
  </mass_balance>
  <ground_reactions>
    <contact type="BOGEY" name="NOSE">
      <location unit="IN"> <x> -6.8 </x> <y> 0.0 </y> <z> -30.0 </z> </location>
      <static_friction> 0.8 </static_friction>
      <dynamic_friction> 0.5 </dynamic_friction>
      <spring_coeff unit="LBS/FT"> 1800.0 </spring_coeff>
      <damping_coeff unit="LBS/FT/SEC"> 600.0 </damping_coeff>
      <steerable> 1 </steerable>
    </contact>
    <contact type="BOGEY" name="MAIN_LEFT">
      <location unit="IN"> <x> 58.2 </x> <y> -43.0 </y> <z> -32.0 </z> </location>
      <static_friction> 0.8 </static_friction>
      <dynamic_friction> 0.5 </dynamic_friction>
      <spring_coeff unit="LBS/FT"> 5400.0 </spring_coeff>
      <damping_coeff unit="LBS/FT/SEC"> 1600.0 </damping_coeff>
      <brake_group> LEFT </brake_group>
    </contact>
    <contact type="BOGEY" name="MAIN_RIGHT">
      <location unit="IN"> <x> 58.2 </x> <y> 43.0 </y> <z> -32.0 </z> </location>
      <static_friction> 0.8 </static_friction>
      <dynamic_friction> 0.5 </dynamic_friction>
      <spring_coeff unit="LBS/FT"> 5400.0 </spring_coeff>
      <damping_coeff unit="LBS/FT/SEC"> 1600.0 </damping_coeff>
      <brake_group> RIGHT </brake_group>
    </contact>
  </ground_reactions>
  <propulsion>
    <engine file="Lycoming-O-320">
      <location unit="IN"> <x> 20.0 </x> <y> 0.0 </y> <z> 0.0 </z> </location>
    </engine>
  </propulsion>
  <aerodynamics>
    <axis name="LIFT">
      <function name="aero/coefficient/CLalpha">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <value> 4.8 </value>
        </product>
      </function>
    </axis>
    <axis name="DRAG">
      <function name="aero/coefficient/CD0">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <value> 0.027 </value>
        </product>
      </function>
    </axis>
    <axis name="PITCH">
      <function name="aero/coefficient/Cmalpha">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <value> -0.75 </value>
        </product>
      </function>
    </axis>
  </aerodynamics>
</fdm_config>`;

test("JSBSim Parser: parses C172 aircraft XML into structured AST", () => {
  const doc = parseJsbsim(VALID_C172_XML, "c172p.xml");
  const m = doc.model;

  assert.equal(m.name, "c172p");
  assert.equal(m.version, "2.0");
  assert.ok(m.fileHeader?.includes("Cessna 172"));

  assert.equal(m.metrics.wingArea, 174.0);
  assert.equal(m.metrics.wingspan, 36.0);
  assert.equal(m.metrics.chord, 4.9);
  assert.equal(m.metrics.aeroCenter.x, 43.2);

  assert.equal(m.massBalance.emptyWeight, 1500.0);
  assert.equal(m.massBalance.ixx, 948.0);
  assert.equal(m.massBalance.iyy, 1346.0);
  assert.equal(m.massBalance.izz, 1967.0);

  assert.equal(m.groundReactions.length, 3);
  const nose = m.groundReactions.find((g) => g.name === "NOSE");
  assert.ok(nose);
  assert.equal(nose.steerable, true);

  assert.equal(m.engines.length, 1);
  assert.equal(m.engines[0]?.name, "Lycoming-O-320");

  assert.equal(m.aeroCoefficients.length, 3);
  const cl = m.aeroCoefficients.find((c) => c.axis === "LIFT");
  assert.ok(cl);
  assert.equal(cl.baseValue, 4.8);
});

test("JSBSim Serializer: roundtrips AST into valid JSBSim XML", () => {
  const doc = parseJsbsim(VALID_C172_XML);
  const xml = serializeJsbsim(doc);

  assert.ok(xml.includes('<fdm_config name="c172p"'));
  assert.ok(xml.includes('<wingarea unit="FT2"> 174 </wingarea>'));
  assert.ok(xml.includes('<emptywt unit="LBS"> 1500 </emptywt>'));
  assert.ok(xml.includes('<contact type="BOGEY" name="NOSE">'));
  assert.ok(xml.includes('<axis name="LIFT">'));

  const reloaded = parseJsbsim(xml);
  assert.equal(reloaded.model.name, doc.model.name);
  assert.equal(reloaded.model.metrics.wingArea, doc.model.metrics.wingArea);
  assert.equal(reloaded.model.groundReactions.length, doc.model.groundReactions.length);
});

test("JSBSim Linter: valid model produces zero errors", () => {
  const doc = parseJsbsim(VALID_C172_XML);
  const diags = lintJsbsim(doc);

  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

test("JSBSim Linter: detects missing aircraft name and negative wing metrics", () => {
  const flawedXml = `<?xml version="1.0"?>
<fdm_config name="" version="2.0">
  <metrics>
    <wingarea unit="FT2"> -50.0 </wingarea>
    <wingspan unit="FT"> -10.0 </wingspan>
    <chord unit="FT"> 0.0 </chord>
  </metrics>
</fdm_config>`;

  const doc = parseJsbsim(flawedXml);
  const diags = lintJsbsim(doc);

  const m8901 = diags.find((d) => d.code === 8901);
  assert.ok(m8901, "Expected M8901 missing aircraft name");

  const m8902 = diags.find((d) => d.code === 8902);
  assert.ok(m8902, "Expected M8902 non-positive wing area");

  const m8903 = diags.find((d) => d.code === 8903);
  assert.ok(m8903, "Expected M8903 non-positive wingspan/chord");
});

test("JSBSim Linter: detects invalid inertia tensor violating triangle inequality", () => {
  const flawedXml = `<?xml version="1.0"?>
<fdm_config name="BadInertia" version="2.0">
  <mass_balance>
    <emptywt unit="LBS"> 1500.0 </emptywt>
    <ixx unit="SLUG*FT2"> 500.0 </ixx>
    <iyy unit="SLUG*FT2"> 500.0 </iyy>
    <izz unit="SLUG*FT2"> 2500.0 </izz>
  </mass_balance>
  <aerodynamics>
    <axis name="LIFT">
      <function name="CL"><value>4.0</value></function>
    </axis>
  </aerodynamics>
</fdm_config>`;

  const doc = parseJsbsim(flawedXml);
  const diags = lintJsbsim(doc);

  const m8905 = diags.find((d) => d.code === 8905);
  assert.ok(m8905, "Expected M8905 triangle inequality violation (500+500 < 2500)");
});

test("JSBSim Solver: integrates 6-DOF equations of motion during cruise flight", () => {
  const doc = parseJsbsim(VALID_C172_XML);
  const res = solveFlightDynamics(doc, {
    duration: 10.0,
    timeStep: 0.02,
    initialAltitudeFt: 5000.0,
    initialSpeedFps: 180.0,
  });

  assert.equal(res.aircraftName, "c172p");
  assert.ok(res.stepsCount >= 400);

  // Speed and altitude should be within realistic aircraft flight regime
  assert.ok(res.finalSpeed > 100.0 && res.finalSpeed < 300.0);
  assert.ok(res.finalAltitude > 4000.0 && res.finalAltitude < 6000.0);

  const lastStep = res.trajectory[res.trajectory.length - 1]!;
  assert.ok(Math.abs(lastStep.pitchDeg) < 20.0, "Pitch angle should stay within reasonable cruise bounds");
});

test("JSBSim DAE Lowering: compiles 6-DOF equations of motion into DAEBuilder", () => {
  const doc = parseJsbsim(VALID_C172_XML);
  const dae = lowerJsbsimToDae(doc);

  assert.ok(dae.variables().length >= 10, "Expected at least 10 variables");
  assert.ok(dae.equations().length >= 10, "Expected at least 10 equations");

  assert.notEqual(dae.lookupVariable("u"), -1);
  assert.notEqual(dae.lookupVariable("v"), -1);
  assert.notEqual(dae.lookupVariable("w"), -1);
  assert.notEqual(dae.lookupVariable("q"), -1);
  assert.notEqual(dae.lookupVariable("theta"), -1);
  assert.notEqual(dae.lookupVariable("altitude"), -1);
  assert.notEqual(dae.lookupVariable("CL"), -1);
  assert.notEqual(dae.lookupVariable("thrust"), -1);
});

test("JSBSim Modelica Projection: generates syntactically valid Modelica 3.x flight mechanics model", () => {
  const doc = parseJsbsim(VALID_C172_XML);
  const mo = jsbsimToModelica(doc, "C172SkyhawkFlight");

  assert.ok(mo.includes("model C172SkyhawkFlight"));
  assert.ok(mo.includes("parameter Real S_w = 174.00"));
  assert.ok(mo.includes("Real u(start = 180.0)"));
  assert.ok(mo.includes("Real altitude(start = 5000.0)"));
  assert.ok(mo.includes("der(altitude) = u * theta - w;"));
  assert.ok(mo.includes("end C172SkyhawkFlight;"));
});

test("JSBSim Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new JsbsimWorkspaceIndex();
  index.indexFile("file:///aero/c172p.xml", VALID_C172_XML);

  assert.equal(index.fileCount, 1);
  const symbols = index.getSymbols("file:///aero/c172p.xml");
  assert.ok(symbols.length >= 5);

  const modelSym = index.findDefinition("c172p");
  assert.ok(modelSym);

  const metricsSym = index.findDefinition("AirframeMetrics");
  assert.ok(metricsSym);

  const gearSym = index.findDefinition("Gear_NOSE");
  assert.ok(gearSym);
});

test("JSBSim Linter & Solver: detects M8909 undefined FCS input, M8910 unrealistic CG location, and responds to elevatorDeg", () => {
  const fcsCgXml = `<?xml version="1.0"?>
<fdm_config name="UnstableFcsPlane" version="2.0">
  <metrics>
    <wingarea unit="FT2"> 174.0 </wingarea>
    <wingspan unit="FT"> 36.0 </wingspan>
    <chord unit="FT"> 4.9 </chord>
    <location name="AERORP" unit="IN">
      <x> 43.2 </x>
      <y> 0.0 </y>
      <z> 0.0 </z>
    </location>
  </metrics>
  <mass_balance>
    <emptywt unit="LBS"> 1500.0 </emptywt>
    <location name="CG" unit="IN">
      <x> 250.0 </x>
      <y> 0.0 </y>
      <z> 0.0 </z>
    </location>
    <ixx unit="SLUG*FT2"> 948.0 </ixx>
    <iyy unit="SLUG*FT2"> 1346.0 </iyy>
    <izz unit="SLUG*FT2"> 1967.0 </izz>
    <ixz unit="SLUG*FT2"> 120.0 </ixz>
  </mass_balance>
  <ground_reactions>
    <contact type="BOGEY" name="NOSE">
      <location unit="IN"> <x> -6.8 </x> <y> 0.0 </y> <z> -30.0 </z> </location>
    </contact>
  </ground_reactions>
  <flight_control name="FCS">
    <channel name="Pitch">
      <summer name="Pitch Trim Sum">
        <input>fcs/elevator-cmd-norm</input>
        <input>unknown_custom_bus/ghost_signal</input>
        <output>fcs/pitch-trim-sum</output>
      </summer>
    </channel>
  </flight_control>
  <aerodynamics>
    <axis name="LIFT">
      <function name="aero/coefficient/CLalpha"><value> 5.1 </value></function>
    </axis>
    <axis name="DRAG">
      <function name="aero/coefficient/CD0"><value> 0.031 </value></function>
    </axis>
    <axis name="PITCH">
      <function name="aero/coefficient/Cmalpha"><value> -0.82 </value></function>
    </axis>
  </aerodynamics>
</fdm_config>`;

  const doc = parseJsbsim(fcsCgXml);
  const diags = lintJsbsim(doc);

  const m8909 = diags.find((d) => d.code === 8909);
  assert.ok(m8909, "Expected M8909 undefined FCS input property diagnostic");
  assert.ok(m8909.message.includes("unknown_custom_bus/ghost_signal"));

  const m8910 = diags.find((d) => d.code === 8910);
  assert.ok(m8910, "Expected M8910 unrealistic CG location diagnostic");

  // Verify elevatorDeg affects pitch trajectory
  const resZero = solveFlightDynamics(doc, { duration: 2.0, timeStep: 0.02, elevatorDeg: 0.0 });
  const resDefl = solveFlightDynamics(doc, { duration: 2.0, timeStep: 0.02, elevatorDeg: -5.0 });
  const pitchZero = resZero.trajectory[resZero.trajectory.length - 1]!.pitchDeg;
  const pitchDefl = resDefl.trajectory[resDefl.trajectory.length - 1]!.pitchDeg;
  assert.notEqual(pitchZero, pitchDefl, "Elevator deflection should alter pitch attitude trajectory");

  // Verify DAE is square
  const dae = lowerJsbsimToDae(doc);
  assert.equal(dae.variables().length, dae.equations().length, "JSBSim DAE must be structurally square");
});

test("JSBSim Parser & Solver: parses 1D/2D <tableData> lookup tables, <product>/<sum> trees, trims steady flight, and extracts Short-Period & Phugoid modes", () => {
  const tableXml = `<?xml version="1.0"?>
<fdm_config name="c172_tables" version="2.0">
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
      <function name="aero/coefficient/CD">
        <product>
          <property>aero/qbar-psf</property>
          <property>metrics/Sw-sqft</property>
          <sum>
            <value> 0.028 </value>
            <table>
              <independentVar lookup="row">aero/alpha-rad</independentVar>
              <independentVar lookup="column">fcs/flap-pos-deg</independentVar>
              <tableData>
                      0.0    15.0    30.0
                0.0   0.000  0.015   0.035
                0.1   0.020  0.040   0.070
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

  const doc = parseJsbsim(tableXml);
  const clCoeff = doc.model.aeroCoefficients.find((c) => c.axis === "LIFT")!;
  assert.ok(clCoeff.table, "Expected 1D CL lookup table to be parsed");
  assert.equal(clCoeff.table.breakpointsRow.length, 4);

  // Verify 1D linear interpolation at alpha = 0.05 rad -> halfway between 0.32 and 0.82 = 0.57
  const clAt005 = evaluateAeroTable(clCoeff.table, { "aero/alpha-rad": 0.05 });
  assert.ok(Math.abs(clAt005 - 0.57) < 1e-9);

  // Verify 2D bilinear interpolation and recursive <product><sum>...</sum></product> evaluation
  const cdCoeff = doc.model.aeroCoefficients.find((c) => c.axis === "DRAG")!;
  assert.ok(cdCoeff.expr && cdCoeff.table);
  const cdVal = evaluateAeroExpr(cdCoeff.expr, {
    "aero/qbar-psf": 40.0,
    "metrics/Sw-sqft": 174.0,
    "aero/alpha-rad": 0.05,
    "fcs/flap-pos-deg": 7.5,
  });
  // At alpha=0.05, flap=7.5: 2D table bilinear midpoint between (0,0.015) and (0.020,0.040) is 0.01875
  // sum = 0.028 + 0.01875 = 0.04675; product = 40 * 174 * 0.04675 = 325.38
  assert.ok(Math.abs(cdVal - 40.0 * 174.0 * (0.028 + 0.01875)) < 1e-6);

  // Verify Newton-Raphson flight trim solver
  const trim = trimFlightCondition(doc, { speedFps: 180.0, altitudeFt: 5000.0 });
  assert.equal(trim.converged, true);
  assert.ok(trim.residualNorm < 1e-7);
  assert.ok(Math.abs(trim.alphaRad - trim.thetaRad) < 1e-6, "In level flight (gamma=0), theta == alpha");
  assert.ok(trim.throttle > 0.0 && trim.throttle < 1.0);

  // Verify 4x4 longitudinal linearization and Short-Period / Phugoid modal extraction
  const lin = linearizeFlightDynamics(doc, { speedFps: 180.0, altitudeFt: 5000.0 });
  assert.equal(lin.A.length, 4);
  assert.equal(lin.B.length, 4);
  assert.equal(lin.eigenvalues.length, 4);
  // Short-period mode has a significantly higher natural frequency than phugoid mode
  assert.ok(lin.shortPeriod.naturalFrequencyRadSec > lin.phugoid.naturalFrequencyRadSec);
  assert.ok(lin.shortPeriod.dampingRatio > 0.0, "Stable aircraft must have positive short-period damping");
});
