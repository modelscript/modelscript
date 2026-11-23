// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintCeaSource } from "../src/index.js";

describe("@modelscript/cea — Pre-flight Lints (CEA1001–CEA5006)", () => {
  it("reports zero diagnostics for a valid LOX/LH2 rocket problem deck", () => {
    const src = `
problem case=SSME rocket equilibrium p,bar=200 o/f=6.0 supar=77.5
reactants
  fuel=H2(L) wt%=100 t(k)=20.27
  oxid=O2(L) wt%=100 t(k)=90.17
output siunits short trace=1e-5
end
`;
    const diags = lintCeaSource(src);
    assert.equal(diags.length, 0, `Expected no diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects missing problem (CEA1002), missing reactants (CEA1003), and missing end (CEA1004)", () => {
    const diags = lintCeaSource("# empty deck\n");
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("CEA1002"), "Expected CEA1002");
    assert.ok(codes.has("CEA1003"), "Expected CEA1003");
    assert.ok(codes.has("CEA1004"), "Expected CEA1004");
  });

  it("detects unknown problem type (CEA2001) and unknown reactant species (CEA2002)", () => {
    const src = `
problem warpdrive p,bar=10
reactants
  fuel=UNOBTAINIUM wt%=100
  oxid=O2 wt%=100
end
`;
    const diags = lintCeaSource(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("CEA2001"), "Expected CEA2001");
    assert.ok(codes.has("CEA2002"), "Expected CEA2002");
  });

  it("detects non-positive pressure (CEA3001), temperature (CEA3002), expansion ratio (CEA3003), and negative o/f (CEA3004)", () => {
    const src = `
problem rocket p,bar=-5 t,k=0 supar=-10 o/f=-2.5
reactants
  fuel=H2 wt%=100 t(k)=-10
  oxid=O2 wt%=100
end
`;
    const diags = lintCeaSource(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("CEA3001"), "Expected CEA3001");
    assert.ok(codes.has("CEA3002"), "Expected CEA3002");
    assert.ok(codes.has("CEA3003"), "Expected CEA3003");
    assert.ok(codes.has("CEA3004"), "Expected CEA3004");
  });

  it("detects fuel/oxid wt% not summing to 100% (CEA4001/CEA4002) and conflicting only/omit (CEA4003)", () => {
    const src = `
problem hp p,bar=10 o/f=3.0
reactants
  fuel=CH4 wt%=60
  fuel=H2 wt%=20
  oxid=O2 wt%=90
only H2O CO2 CO
omit CO
end
`;
    const diags = lintCeaSource(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("CEA4001"), "Expected CEA4001");
    assert.ok(codes.has("CEA4002"), "Expected CEA4002");
    assert.ok(codes.has("CEA4003"), "Expected CEA4003");
  });

  it("detects missing pressure (CEA5001), missing temperature for tp (CEA5002), and invalid trace (CEA5006)", () => {
    const src = `
problem tp
reactants
  name=CH4 moles=1
  name=O2 moles=2
output trace=2.5
end
`;
    const diags = lintCeaSource(src);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("CEA5001"), "Expected CEA5001");
    assert.ok(codes.has("CEA5002"), "Expected CEA5002");
    assert.ok(codes.has("CEA5006"), "Expected CEA5006");
  });
});
