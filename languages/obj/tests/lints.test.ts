// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintMtl, lintObj } from "../src/lints/index.js";
import { parseMtl, parseObj } from "../src/parser/index.js";

describe("Wavefront OBJ & MTL Linter (OBJ1001–OBJ5006)", () => {
  it("reports OBJ1001 for syntax errors and unknown directives", () => {
    const doc = parseObj("v 1.0 2.0\nbad_directive 123\n");
    const diags = lintObj(doc);
    const syntaxDiags = diags.filter((d) => d.id === "OBJ1001");
    assert.equal(syntaxDiags.length, 2);
  });

  it("reports OBJ2001 for zero indices and OBJ2002/2003/2004 for out-of-range v/vt/vn indices", () => {
    const src = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "vt 0 0", "vn 0 0 1", "f 0 2 3", "f 1/5/9 2 4"].join("\n");

    const diags = lintObj(parseObj(src));
    assert.ok(
      diags.some((d) => d.id === "OBJ2001"),
      "expected OBJ2001 zero index",
    );
    assert.ok(
      diags.some((d) => d.id === "OBJ2002"),
      "expected OBJ2002 vertex out of range",
    );
    assert.ok(
      diags.some((d) => d.id === "OBJ2003"),
      "expected OBJ2003 texcoord out of range",
    );
    assert.ok(
      diags.some((d) => d.id === "OBJ2004"),
      "expected OBJ2004 normal out of range",
    );
  });

  it("reports OBJ3001 for faces with fewer than 3 vertices and OBJ3002 for degenerate zero-area faces", () => {
    const src = ["v 0 0 0", "v 1 0 0", "v 2 0 0", "f 1 2", "f 1 2 3"].join("\n");

    const diags = lintObj(parseObj(src));
    assert.ok(
      diags.some((d) => d.id === "OBJ3001"),
      "expected OBJ3001 face too few vertices",
    );
    assert.ok(
      diags.some((d) => d.id === "OBJ3002"),
      "expected OBJ3002 degenerate collinear face",
    );
  });

  it("reports OBJ4001 for undefined material when MTL is provided and OBJ4002 for out-of-range MTL color", () => {
    const objSrc = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "usemtl MissingMat", "f 1 2 3"].join("\n");
    const mtlSrc = ["newmtl BadColor", "Kd 1.5 -0.1 0.5", "illum 2"].join("\n");

    const obj = parseObj(objSrc);
    const mtl = parseMtl(mtlSrc);
    const diags = lintObj(obj, mtl);
    assert.ok(
      diags.some((d) => d.id === "OBJ4001"),
      "expected OBJ4001 undefined material",
    );
    const colorDiags = lintMtl(mtl).filter((d) => d.id === "OBJ4002");
    assert.equal(colorDiags.length, 2, "expected 2 OBJ4002 warnings for 1.5 and -0.1");
  });

  it("reports OBJ5006 warning for non-manifold edges shared by > 2 faces", () => {
    // 3 triangles sharing edge (1, 2)
    const src = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "v 0 -1 0", "v 0 0 1", "f 1 2 3", "f 1 2 4", "f 1 2 5"].join("\n");

    const diags = lintObj(parseObj(src));
    const nm = diags.filter((d) => d.id === "OBJ5006");
    assert.equal(nm.length, 1);
    assert.equal(nm[0]?.severity, "warning");
  });
});
