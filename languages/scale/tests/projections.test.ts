// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseScale } from "../src/parser/scale-parser.js";
import { scaleToMcnp, scaleToModelica } from "../src/projections/index.js";

describe("SCALE Cross-Language Projections (Modelica & MCNP)", () => {
  it("projects an ORIGEN depletion deck to a valid Modelica 3.x Bateman ODE model", () => {
    const src = `=origen
XenonTransient
case(xe) {
  mat { units=atoms iso=[ i135=1.0e16 xe135=0.0 ] }
  time { units=hours t=[ 1 6 12 ] }
  flux=[ 0 0 0 ]
}
end
`;
    const mo = scaleToModelica(parseScale(src), "XenonDecayModel");
    assert.ok(mo.includes("model XenonDecayModel"));
    assert.ok(mo.includes("der(N_I_135)"));
    assert.ok(mo.includes("der(N_Xe_135)"));
    assert.ok(mo.includes("der(N_Cs_135)"));
    assert.ok(mo.includes("P_decay ="));
    assert.ok(mo.includes("A_total ="));
    assert.ok(mo.includes("end XenonDecayModel;"));
  });

  it("projects a CSAS6 KENO criticality deck to a valid MCNP input deck", () => {
    const src = `=csas6
Godiva Bare Sphere
v7.1-252
read comp
  uo2 1 den=10.4 1.0 300.0 92235 93.5 92238 6.5 end
  h2o 2 den=1.0 1.0 300.0 end
end comp
read param
  npg=5000 gen=300 nsk=50
end param
read geom
  global unit 1
  sphere 1 8.74
  sphere 2 15.0
  media 1 1 1
  media 2 1 2 -1
  boundary 2
end geom
end
`;
    const mcnp = scaleToMcnp(parseScale(src));
    assert.ok(mcnp.includes("Godiva Bare Sphere"));
    assert.ok(mcnp.includes("1 so 8.7400"));
    assert.ok(mcnp.includes("2 so 15.0000"));
    assert.ok(mcnp.includes("imp:n=1"));
    assert.ok(mcnp.includes("imp:n=0 $ graveyard"));
    assert.ok(mcnp.includes("kcode 5000 1.0 50 300"));
    assert.ok(mcnp.includes("m1 "));
    assert.ok(mcnp.includes("m2 "));
  });
});
