// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintScale } from "../src/lints/index.js";
import { parseScale } from "../src/parser/scale-parser.js";

describe("SCALE Static Linter (SCL1001–SCL5006)", () => {
  it("reports zero errors on a valid CSAS6 criticality deck", () => {
    const valid = `=csas6
Valid Pin Cell
v7.1-252
read comp
  uo2 1 den=10.4 1.0 900.0 enrich=4.0 end
  h2o 2 den=1.0 1.0 300.0 end
end comp
read geom
  global unit 1
  cylinder 1 0.41 10.0 -10.0
  cuboid 2 0.63 -0.63 0.63 -0.63 10.0 -10.0
  media 1 1 1
  media 2 1 2 -1
  boundary 2
end geom
read bounds
  all=mirror
end bounds
end
`;
    const diags = lintScale(parseScale(valid));
    assert.equal(diags.length, 0);
  });

  it("detects unknown sequence (SCL2001) and unclosed read block (SCL1002)", () => {
    const bad = `=foobar99
Bad Deck
read comp
  uo2 1 den=10.4 1.0 900.0 end
`;
    const codes = lintScale(parseScale(bad)).map((d) => d.code);
    assert.ok(codes.includes("SCL2001"));
    assert.ok(codes.includes("SCL1002"));
  });

  it("detects duplicate mixture/unit/array IDs (SCL2002, SCL2003, SCL2004)", () => {
    const bad = `=csas6
Duplicate IDs
read comp
  uo2 1 den=10.4 1.0 900.0 end
  h2o 1 den=1.0 1.0 300.0 end
end comp
read geom
  global unit 1
  sphere 1 5.0
  media 1 1 1
  unit 1
  sphere 1 3.0
  media 1 1 1
end geom
read array
  ara=1 nux=1 nuy=1 nuz=1 fill 1 end fill
  ara=1 nux=1 nuy=1 nuz=1 fill 1 end fill
end array
end
`;
    const codes = lintScale(parseScale(bad)).map((d) => d.code);
    assert.ok(codes.includes("SCL2002"));
    assert.ok(codes.includes("SCL2003"));
    assert.ok(codes.includes("SCL2004"));
  });

  it("detects undefined mixture (SCL3001), undefined unit (SCL3002), and missing global unit (SCL3003)", () => {
    const bad = `=csas6
Missing Refs
read comp
  uo2 1 den=10.4 1.0 900.0 end
end comp
read geom
  unit 1
  sphere 1 5.0
  media 99 1 1
  hole 42 origin x=0 y=0 z=0
end geom
read array
  ara=1 nux=2 nuy=1 nuz=1 fill 1 77 end fill
end array
end
`;
    const codes = lintScale(parseScale(bad)).map((d) => d.code);
    assert.ok(codes.includes("SCL3001"));
    assert.ok(codes.includes("SCL3002"));
    assert.ok(codes.includes("SCL3003"));
  });

  it("detects non-positive density (SCL4001), temperature (SCL4002), and invalid enrichment (SCL4003)", () => {
    const bad = `=csas6
Bad Physics
read comp
  uo2 1 den=-10.4 temp=0.0 enrich=120.0 end
end comp
end
`;
    const codes = lintScale(parseScale(bad)).map((d) => d.code);
    assert.ok(codes.includes("SCL4001"));
    assert.ok(codes.includes("SCL4002"));
    assert.ok(codes.includes("SCL4003"));
  });

  it("detects invalid ORIGEN time/power/nuclide (SCL5001, SCL5002, SCL5006) and geometry/array errors (SCL5004, SCL5005)", () => {
    const bad = `=origen
Bad ORIGEN
case(err1) {
  mat { units=atoms iso=[ u235=-5.0e10 ] }
  time { units=hours t=[ 10 5 ] }
  power=[ -12.0 0.0 ]
  flux=[ -1.0e12 ]
}
read geom
  global unit 1
  cylinder 1 -0.5 5.0 10.0
end geom
read array
  ara=1 nux=2 nuy=2 nuz=1 fill 1 1 end fill
end array
end
`;
    const codes = lintScale(parseScale(bad)).map((d) => d.code);
    assert.ok(codes.includes("SCL5001"));
    assert.ok(codes.includes("SCL5002"));
    assert.ok(codes.includes("SCL5004"));
    assert.ok(codes.includes("SCL5005"));
    assert.ok(codes.includes("SCL5006"));
  });
});
