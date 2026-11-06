// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPrimarySymbol, renderUniversalCodeThumbnailSvg } from "../src/code-thumbnail-builder.js";

describe("Universal Code Thumbnail SVG Engine", () => {
  it("extracts primary subroutine and module symbols from Fortran source", () => {
    const fortranSub = `
subroutine rocket_thrust(t, pressure, thrust)
  implicit none
  real, intent(in) :: t, pressure
  real, intent(out) :: thrust
  thrust = pressure * 144.0
end subroutine rocket_thrust
    `;
    const detected = detectPrimarySymbol(fortranSub, "fortran");
    assert.ok(detected);
    assert.equal(detected.name, "rocket_thrust");
    assert.equal(detected.kind, "subroutine");
  });

  it("extracts model and partial class symbols from Modelica source", () => {
    const moCode = `
partial model ElectricalPin
  Real v;
  flow Real i;
end ElectricalPin;
    `;
    const detected = detectPrimarySymbol(moCode, "modelica");
    assert.ok(detected);
    assert.equal(detected.name, "ElectricalPin");
    assert.equal(detected.kind, "model");
    assert.equal(detected.isPartial, true);
  });

  it("renders valid SVG for Fortran 90 with badge, line numbers, and tspans", () => {
    const fortranCode = `module math_ops
  implicit none
contains
  function add(a, b) result(c)
    real, intent(in) :: a, b
    real :: c
    c = a + b
  end function add
end module math_ops`;

    const svg = renderUniversalCodeThumbnailSvg(fortranCode, {
      dialect: "fortran",
      title: "math_ops.f90",
    });

    assert.ok(svg.includes("<svg"), "Must render root svg tag");
    assert.ok(svg.includes('data-preview-mode="code"'), "Must declare data-preview-mode='code'");
    assert.ok(svg.includes('data-dialect="fortran"'), "Must declare data-dialect='fortran'");
    assert.ok(svg.includes("FORTRAN 90"), "Must include Fortran dialect badge");
    assert.ok(svg.includes("math_ops"), "Must include module name or title");
    assert.ok(svg.includes("9 lines"), "Must include line count");
    assert.ok(svg.includes("<tspan"), "Must render syntax-highlighted tspan tokens");
  });

  it("renders truncation indicator when code exceeds maxLines", () => {
    const longCode = Array.from({ length: 40 }, (_, i) => `x_${i} = ${i} * 2`).join("\n");
    const svg = renderUniversalCodeThumbnailSvg(longCode, {
      dialect: "c",
      maxLines: 10,
    });

    assert.ok(svg.includes("… +30 more lines"), "Must display overflow line count indicator");
  });
});
