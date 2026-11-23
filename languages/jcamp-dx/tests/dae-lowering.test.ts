// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerJcampDxToDae } from "../src/dae/index.js";

const SAMPLE_IR = `##TITLE=Carbonyl Absorption Spectrum
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##XUNITS=1/CM
##YUNITS=ABSORBANCE
##FIRSTX=1750
##LASTX=1690
##NPOINTS=7
##XFACTOR=1
##YFACTOR=0.01
##XYDATA=(X++(Y..Y))
1750 5 12 45 95 40 10 4
##END=
`;

describe("@modelscript/jcamp-dx Direct DAE Arena Lowering", () => {
  function createMockBuilder() {
    const variables: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> =
      [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];
    let exprSeq = 100;

    const builder = {
      addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
        variables.push({ name, type, variability, causality, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => ++exprSeq,
      addUnaryExpr: () => ++exprSeq,
      addRealLiteral: () => ++exprSeq,
      addName: (varId: number) => 1000 + varId,
      lookupVariable: () => -1,
    };
    return { builder, variables, equations };
  }

  it("lowers Beer-Lambert law and Lorentzian absorption bands directly into IDaeBuilder", () => {
    const { builder, variables, equations } = createMockBuilder();
    const res = lowerJcampDxToDae(builder as never, SAMPLE_IR, {
      lineShape: "lorentzian",
      molarAbsorptivity: 150,
      concentration: 0.02,
      pathLength: 1.0,
    });

    assert.strictEqual(res.lineShape, "lorentzian");
    assert.ok(res.peakCount >= 1, "Should detect and lower at least 1 absorption band");
    assert.ok(
      res.equationCount >= 5,
      "Expected Beer-Lambert + band + total absorbance + transmittance + intensity equations",
    );
    assert.strictEqual(equations.length, res.equationCount);

    const varNames = new Set(variables.map((v) => v.name));
    assert.ok(varNames.has("beer_lambert_A"));
    assert.ok(varNames.has("spectrum_absorbance"));
    assert.ok(varNames.has("spectrum_transmittance"));
    assert.ok(varNames.has("transmitted_intensity_I"));
    assert.ok(varNames.has("band_0_absorbance"));
  });

  it("supports Gaussian line-shape DAE lowering", () => {
    const { builder, equations } = createMockBuilder();
    const res = lowerJcampDxToDae(builder as never, SAMPLE_IR, { lineShape: "gaussian" });
    assert.strictEqual(res.lineShape, "gaussian");
    assert.ok(res.equationCount >= 5);
    assert.strictEqual(equations.length, res.equationCount);
  });
});
