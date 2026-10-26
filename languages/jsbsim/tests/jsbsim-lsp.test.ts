// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeJsbsimAction, getJsbsimDocumentSymbols, getJsbsimHover, validateJsbsim } from "../src/index.js";

const VALID_AIRCRAFT = `<?xml version="1.0"?>
<fdm_config name="TestGlider" version="2.0">
  <metrics>
    <wingarea unit="FT2"> 150.0 </wingarea>
    <wingspan unit="FT"> 45.0 </wingspan>
    <chord unit="FT"> 3.5 </chord>
  </metrics>
  <mass_balance>
    <emptywt unit="LBS"> 800.0 </emptywt>
    <ixx unit="SLUG*FT2"> 500.0 </ixx>
    <iyy unit="SLUG*FT2"> 600.0 </iyy>
    <izz unit="SLUG*FT2"> 800.0 </izz>
  </mass_balance>
  <ground_reactions>
    <contact type="BOGEY" name="MAIN">
      <spring_coeff unit="LBS/FT"> 2000.0 </spring_coeff>
      <damping_coeff unit="LBS/FT/SEC"> 500.0 </damping_coeff>
    </contact>
  </ground_reactions>
  <aerodynamics>
    <axis name="LIFT">
      <function name="CL"><value> 5.2 </value></function>
    </axis>
    <axis name="DRAG">
      <function name="CD"><value> 0.02 </value></function>
    </axis>
  </aerodynamics>
</fdm_config>`;

test("JSBSim LSP: validateJsbsim returns 0 diagnostics on clean document", () => {
  const diags = validateJsbsim(VALID_AIRCRAFT);
  assert.equal(diags.length, 0);
});

test("JSBSim LSP: validateJsbsim returns diagnostics on flawed document", () => {
  const flawed = `<?xml version="1.0"?>
<fdm_config name="" version="2.0">
  <metrics>
    <wingarea unit="FT2"> -100.0 </wingarea>
    <wingspan unit="FT"> 10.0 </wingspan>
    <chord unit="FT"> 2.0 </chord>
  </metrics>
</fdm_config>`;

  const diags = validateJsbsim(flawed);
  assert.ok(diags.length >= 2);
  assert.ok(diags.some((d) => d.code === "M8901"));
  assert.ok(diags.some((d) => d.code === "M8902"));
});

test("JSBSim LSP: getJsbsimDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getJsbsimDocumentSymbols(VALID_AIRCRAFT);
  assert.equal(symbols.length, 1);
  const root = symbols[0]!;
  assert.equal(root.name, "TestGlider");
  assert.ok(root.children && root.children.length >= 3);
  assert.ok(root.children.some((c) => c.name === "Metrics"));
  assert.ok(root.children.some((c) => c.name === "Gear_MAIN"));
});

test("JSBSim LSP: getJsbsimHover returns markdown hover info for metrics and mass balance", () => {
  const lines = VALID_AIRCRAFT.split("\n");
  const metricsLine = lines.findIndex((l) => l.includes("<metrics>"));
  assert.ok(metricsLine >= 0);

  const hover = getJsbsimHover(VALID_AIRCRAFT, { line: metricsLine, character: 3 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("Aircraft Geometric Metrics"));
  assert.ok(hover.contents.value.includes("Wing Area"));
});

test("JSBSim LSP: executeJsbsimAction executes solver and export actions", async () => {
  const simRes = await executeJsbsimAction("jsbsim_simulate", VALID_AIRCRAFT, {
    options: { duration: 5.0 },
  });
  assert.equal(simRes.aircraftName, "TestGlider");
  assert.ok(simRes.stepsCount >= 100);

  const daeRes = await executeJsbsimAction("jsbsim_to_dae", VALID_AIRCRAFT);
  assert.ok(daeRes.variableCount >= 10);

  const moRes = await executeJsbsimAction("jsbsim_to_modelica", VALID_AIRCRAFT, {
    modelName: "GliderFlightModel",
  });
  assert.ok(moRes.includes("model GliderFlightModel"));
  assert.ok(moRes.includes("der(altitude)"));
});
