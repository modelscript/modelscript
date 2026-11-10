// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { jsbsimToModelica, lowerJsbsimToDae, parseJsbsim } from "../src/index.js";

const VALID_XML = `<?xml version="1.0"?>
<fdm_config name="c172_dae" version="2.0">
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
  <aerodynamics>
    <axis name="LIFT">
      <function name="CL"><value>4.5</value></function>
    </axis>
    <axis name="DRAG">
      <function name="CD"><value>0.03</value></function>
    </axis>
    <axis name="PITCH">
      <function name="Cm"><value>-0.7</value></function>
    </axis>
  </aerodynamics>
</fdm_config>`;

test("JSBSim DAE Lowering: compiles 6-DOF equations to DAE arena", () => {
  const doc = parseJsbsim(VALID_XML);
  const dae = lowerJsbsimToDae(doc);

  assert.ok(dae.variables().length >= 10);
  assert.equal(dae.variables().length, dae.equations().length, "Must be structurally square");
  assert.notEqual(dae.lookupVariable("u"), -1);
  assert.notEqual(dae.lookupVariable("altitude"), -1);
});

test("JSBSim Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const doc = parseJsbsim(VALID_XML);
  const mo = jsbsimToModelica(doc, "C172FlightModel");

  assert.ok(mo.includes("model C172FlightModel"));
  assert.ok(mo.includes("parameter Real S_w = 174.00"));
  assert.ok(mo.includes("der(altitude) = u * theta - w;"));
  assert.ok(mo.includes("end C172FlightModel;"));
});
