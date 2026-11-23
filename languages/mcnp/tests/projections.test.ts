// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMcnpDeck } from "../src/parser/index.js";
import { mcnpToCadAssembly, mcnpToModelica, mcnpToOpenScad } from "../src/projections/index.js";

describe("MCNP Projections (Modelica, OpenSCAD & @modelscript/cad)", () => {
  const sampleDeck = parseMcnpDeck(`Reflected Godiva Sphere
1 1 -18.74 -1    IMP:N=1
2 2 -1.0    1 -2 IMP:N=1
3 0         2    IMP:N=0

1 SO 8.741
2 SO 15.0

MODE N
M1 92235.80c 1.0
M2 1001.80c 2.0 8016.80c 1.0
KCODE 1000 1.0 10 50
KSRC 0 0 0
`);

  it("projects MCNP deck to valid Modelica point-kinetics and cell flux-balance model", () => {
    const mo = mcnpToModelica(sampleDeck);
    assert.ok(mo.includes("model Reflected_Godiva_Sphere"));
    assert.ok(mo.includes("der(n) ="));
    assert.ok(mo.includes("der(C[i]) ="));
    assert.ok(mo.includes("der(phi_1) ="));
    assert.ok(mo.includes("der(phi_2) ="));
    assert.ok(mo.includes("end Reflected_Godiva_Sphere;"));
  });

  it("projects MCNP CSG cells to OpenSCAD geometry with difference() for shells", () => {
    const scad = mcnpToOpenScad(sampleDeck);
    assert.ok(scad.includes("module cell_1()"));
    assert.ok(scad.includes("sphere(r = 8.741"));
    assert.ok(scad.includes("module cell_2()"));
    assert.ok(scad.includes("difference()"));
    assert.ok(scad.includes("cell_1();"));
    assert.ok(scad.includes("cell_2();"));
  });

  it("builds a @modelscript/cad 3D Assembly from non-graveyard cells", () => {
    const asm = mcnpToCadAssembly(sampleDeck);
    assert.strictEqual(asm.name, "Reflected Godiva Sphere");
    assert.strictEqual(asm.parts.length, 2);
    assert.strictEqual(asm.parts[0]!.material, "M1");
    assert.strictEqual(asm.parts[1]!.material, "M2");
  });
});
