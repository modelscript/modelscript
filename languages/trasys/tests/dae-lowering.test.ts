// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSurfaceArea, lowerTrasysToCadAssembly } from "../src/cad/index.js";
import { trasysToDae } from "../src/dae/index.js";
import { parseTrasysDeck } from "../src/parser/index.js";

const TWO_PLATE_DECK = `
HEADER OPTIONS DATA
  MODEL = ParallelPlatesDAE
HEADER SURFACE DATA
  S P1 RECTANGLE W=1.0 H=1.0 NODE=101 PROP=BLACK_PAINT ACTIVE=TOP TZ=0.0
  S P2 RECTANGLE W=1.0 H=1.0 NODE=102 PROP=WHITE_PAINT_Z93 ACTIVE=BOTTOM TZ=1.0
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = 400
  BETA = 0
  SOLAR = 1361
  ALBEDO = 0.30
  PLANETIR = 237
HEADER OPERATIONS DATA
  FFCAL
  RKCAL
  QCAL
END OF DATA
`;

describe("TRASYS DAE Lowering & CAD Assembly", () => {
  it("lowers a coupled two-plate radiative network into a DAEBuilder linear-memory arena", () => {
    const deck = parseTrasysDeck(TWO_PLATE_DECK);
    const dae = trasysToDae(deck);

    assert.strictEqual(deck.name, "ParallelPlatesDAE");
    // 2 active surfaces -> 2 radiative balance equations
    assert.strictEqual(dae.eqCount, 2);
    // Global (sigma_SB, T_space) + 2*(8 per-surface params + 1 T var) + 2 pairwise RADK params = 22
    assert.ok(dae.varCount >= 20, `Expected >= 20 DAE vars, got ${dae.varCount}`);
    assert.notStrictEqual(dae.lookupVariable("T_P1"), -1);
    assert.notStrictEqual(dae.lookupVariable("T_P2"), -1);
    assert.notStrictEqual(dae.lookupVariable("G_rad_P1_P2"), -1);
    assert.notStrictEqual(dae.lookupVariable("G_space_P1"), -1);
  });

  it("lowers all 7 TRASYS primitives into a @modelscript/cad Assembly with accurate surface areas", () => {
    const deck = parseTrasysDeck(`
HEADER OPTIONS DATA
  MODEL = AllPrimitivesCAD
HEADER SURFACE DATA
  S R1 RECTANGLE W=2.0 H=3.0 NODE=1 PROP=WHITE_PAINT_Z93
  S D1 DISK R=1.0 NODE=2 PROP=SILVER_TEFLON TZ=1.0
  S C1 CYLINDER R=0.5 L=2.0 NODE=3 PROP=GOLD_KAPTON TX=3.0
  S K1 CONE R1=1.0 R2=0.5 L=1.0 NODE=4 PROP=SOLAR_CELL TX=6.0
  S S1 SPHERE R=0.5 NODE=5 PROP=BLACK_PAINT TY=3.0
  S P1 PARABOLOID R=1.0 F=0.5 NODE=6 PROP=OPTICAL_SOLAR_REFLECTOR TY=6.0
  S G1 POLYGON (0,0,0) (2,0,0) (0,2,0) NODE=7 PROP=0.5, 0.8 TZ=-2.0
END OF DATA
`);
    const asm = lowerTrasysToCadAssembly(deck);
    assert.strictEqual(asm.name, "AllPrimitivesCAD");
    assert.strictEqual(asm.parts.length, 7);

    // Check analytical surface areas
    assert.ok(Math.abs(computeSurfaceArea(deck.surfaces[0]!) - 6.0) < 1e-12); // RECTANGLE 2x3
    assert.ok(Math.abs(computeSurfaceArea(deck.surfaces[1]!) - Math.PI) < 1e-12); // DISK r=1
    assert.ok(Math.abs(computeSurfaceArea(deck.surfaces[2]!) - 2 * Math.PI * 0.5 * 2.0) < 1e-12); // CYLINDER
    assert.ok(Math.abs(computeSurfaceArea(deck.surfaces[4]!) - 4 * Math.PI * 0.25) < 1e-12); // SPHERE r=0.5
    assert.ok(Math.abs(computeSurfaceArea(deck.surfaces[6]!) - 2.0) < 1e-12); // POLYGON right triangle 2x2/2
  });
});
