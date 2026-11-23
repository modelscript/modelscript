// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseScale } from "../src/parser/scale-parser.js";

describe("SCALE / KENO / ORIGEN Semantic Parser", () => {
  it("parses a complete CSAS6 PWR pin-cell criticality deck with KENO VI geometry", () => {
    const src = `' PWR UO2 Pin Cell Benchmark
=csas6
PWR 3.5 wt% UO2 Pin Cell
v7.1-252
read comp
  uo2 1 den=10.41 1.0 900.0 92235 3.5 92238 96.5 end
  zirc4 3 den=6.56 1.0 600.0 end
  h2o 2 den=0.72 1.0 580.0 end
end comp
read celldata
  latticecell squarepitch pitch=1.26 2 fuelr=0.4096 1 cladr=0.475 3 end
end celldata
read param
  npg=2000 gen=250 nsk=50
end param
read geom
  global unit 1
  cylinder 1 0.4096 182.88 -182.88
  cylinder 2 0.4750 182.88 -182.88
  cuboid 3 0.63 -0.63 0.63 -0.63 182.88 -182.88
  media 1 1 1
  media 3 1 2 -1
  media 2 1 3 -2
  boundary 3
end geom
read bounds
  all=mirror
end bounds
end
`;
    const deck = parseScale(src, "pwr_pincell.scale");
    assert.equal(deck.sequence, "csas6");
    assert.equal(deck.sequenceType, "csas6");
    assert.equal(deck.title, "PWR 3.5 wt% UO2 Pin Cell");
    assert.equal(deck.crossSectionLib, "v7.1-252");
    assert.equal(deck.compositions.length, 3);
    assert.equal(deck.compositions[0]!.materialName, "uo2");
    assert.equal(deck.compositions[0]!.mixtureId, 1);
    assert.equal(deck.compositions[0]!.density, 10.41);
    assert.equal(deck.compositions[0]!.temperature, 900.0);
    assert.equal(deck.compositions[0]!.enrichment, 3.5);
    assert.equal(deck.cellData.length, 1);
    assert.equal(deck.params.parameters["npg"], 2000);
    assert.equal(deck.params.parameters["gen"], 250);
    assert.equal(deck.bounds?.all, "mirror");
    assert.equal(deck.units.size, 1);

    const u1 = deck.units.get(1)!;
    assert.equal(u1.isGlobal, true);
    assert.equal(u1.bodies.length, 3);
    assert.equal(u1.media.length, 3);
    assert.equal(u1.boundaryBodyId, 3);
    assert.deepEqual(u1.media[1]!.regions, [2, -1]);
  });

  it("parses KENO array lattices with repeat notation and hole placements", () => {
    const src = `=csas5
2x2 Fuel Assembly Array
v7-238
read comp
  uo2 1 den=10.4 1.0 900.0 end
  h2o 2 den=1.0 1.0 300.0 end
end comp
read geom
  unit 1
  cylinder 1 0.41 10.0 -10.0
  cuboid 2 0.63 -0.63 0.63 -0.63 10.0 -10.0
  media 1 1 1
  media 2 1 2 -1
  boundary 2
  unit 2
  sphere 1 0.25
  media 2 1 1
  boundary 1
  global unit 10
  cuboid 1 1.26 -1.26 1.26 -1.26 10.0 -10.0
  array 1 1
  hole 2 origin x=0.0 y=0.0 z=0.0
  boundary 1
end geom
read array
  ara=1 nux=2 nuy=2 nuz=1
  fill 4*1 end fill
end array
end
`;
    const deck = parseScale(src);
    assert.equal(deck.sequence, "csas5");
    assert.equal(deck.units.size, 3);
    const arr = deck.arrays.get(1)!;
    assert.equal(arr.nux, 2);
    assert.equal(arr.nuy, 2);
    assert.equal(arr.nuz, 1);
    assert.deepEqual(arr.fill, [1, 1, 1, 1]);
    assert.equal(deck.units.get(10)!.holes.length, 1);
    assert.equal(deck.units.get(10)!.arrayPlacements.length, 1);
  });

  it("parses ORIGEN isotope depletion case with lib, mat, time, power, flux, save", () => {
    const src = `=origen
PWR Fuel Depletion Case
case(burn1) {
  lib { file="pwr_u235.f33" }
  mat {
    units=atoms
    iso=[ u235=1.0e21 i135=1.0e15 xe135=0.0 ]
  }
  time {
    units=hours
    t=[ 2 6 12 24 ]
  }
  flux=[ 3.0e13 3.0e13 0.0 0.0 ]
  power=[ 35.0 35.0 0.0 0.0 ]
  save
}
end
`;
    const deck = parseScale(src);
    assert.equal(deck.sequence, "origen");
    assert.equal(deck.origenCases.length, 1);
    const oc = deck.origenCases[0]!;
    assert.equal(oc.id, "burn1");
    assert.equal(oc.library, "pwr_u235.f33");
    assert.equal(oc.nuclides.length, 3);
    assert.equal(oc.nuclides[0]!.nuclide, "U-235");
    assert.equal(oc.nuclides[1]!.nuclide, "I-135");
    assert.equal(oc.time?.unit, "hours");
    assert.deepEqual(oc.time?.values, [2, 6, 12, 24]);
    assert.deepEqual(oc.time?.valuesSeconds, [7200, 21600, 43200, 86400]);
    assert.deepEqual(oc.flux, [3.0e13, 3.0e13, 0.0, 0.0]);
    assert.equal(oc.save, true);
  });

  it("records unclosed read blocks for downstream linting", () => {
    const src = `=csas6
Unclosed Comp Test
read comp
  uo2 1 den=10.4 1.0 900.0 end
`;
    const deck = parseScale(src);
    assert.equal(deck.readBlocks.length, 1);
    assert.equal(deck.readBlocks[0]!.kind, "comp");
    assert.equal(deck.readBlocks[0]!.closed, false);
  });
});
