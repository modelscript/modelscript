// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseJsbsim, serializeJsbsim } from "../src/index.js";

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
  assert.equal(m.massBalance.emptyWeight, 1500.0);
  assert.equal(m.groundReactions.length, 2);
  assert.equal(m.engines.length, 1);
  assert.equal(m.aeroCoefficients.length, 2);
});

test("JSBSim Serializer: roundtrips AST into valid JSBSim XML", () => {
  const doc = parseJsbsim(VALID_C172_XML);
  const xml = serializeJsbsim(doc);

  assert.ok(xml.includes('<fdm_config name="c172p"'));
  assert.ok(xml.includes('<wingarea unit="FT2"> 174 </wingarea>'));
  assert.ok(xml.includes('<emptywt unit="LBS"> 1500 </emptywt>'));
  assert.ok(xml.includes('<axis name="LIFT">'));

  const reloaded = parseJsbsim(xml);
  assert.equal(reloaded.model.name, doc.model.name);
  assert.equal(reloaded.model.metrics.wingArea, doc.model.metrics.wingArea);
});
