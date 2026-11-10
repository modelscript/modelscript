// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintJsbsim, parseJsbsim } from "../src/index.js";

test("JSBSim Linter: detects missing aircraft name and negative wing metrics (M8901-M8903)", () => {
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

  assert.ok(diags.find((d) => d.code === 8901), "Expected M8901 missing name");
  assert.ok(diags.find((d) => d.code === 8902), "Expected M8902 non-positive wing area");
  assert.ok(diags.find((d) => d.code === 8903), "Expected M8903 non-positive wingspan/chord");
});

test("JSBSim Linter: detects invalid inertia tensor violating triangle inequality (M8905)", () => {
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
  assert.ok(m8905, "Expected M8905 triangle inequality violation");
});
