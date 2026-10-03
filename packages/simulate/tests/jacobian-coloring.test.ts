// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateJacobianColoring } from "@modelscript/dsl/codegen/coloring.js";

describe("Distance-2 Graph Coloring Generator", () => {
  test("generates Curtis-Powell-Reid graph coloring function", () => {
    const code = generateJacobianColoring();
    expect(code).toContain("export function colorJacobian");
    expect(code).toContain("conflictMatrixPtr");
    expect(code).toContain("usedColorsPtr");
  });
});
