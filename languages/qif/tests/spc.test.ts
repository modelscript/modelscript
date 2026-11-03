// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseQif } from "../src/parser/index.js";
import { qifToModelica, qifToSysML2 } from "../src/projections/index.js";
import { evaluateQifSpc, lowerQifToDae } from "../src/spc/index.js";

describe("QIF 3.0 SPC Evaluator, DAE Arena Lowering & Cross-Language Projections", () => {
  const sampleDsl = `
    QIF 3.0.0 qpId="99999999-0000-4000-8000-000000000001"
    HEADER partName="GearboxCover" units="mm"
    FEATURE F_BORE Cylinder "BearingBore" size=50.0 points=8 internal=true
    DEVICE CMM1 CMM "Zeiss_Prismo" uncertainty=0.001
    CHARACTERISTIC C_POS Position "BearingBore_Pos" zone=0.06 material=MMC features=[F_BORE] device=CMM1
    ACTUAL A1 characteristic=C_POS serial="SN-01" value=0.038 actualSize=50.02 status=PASS
    ACTUAL A2 characteristic=C_POS serial="SN-02" value=0.040 actualSize=50.02 status=PASS
    ACTUAL A3 characteristic=C_POS serial="SN-03" value=0.042 actualSize=50.02 status=PASS
    ACTUAL A4 characteristic=C_POS serial="SN-04" value=0.039 actualSize=50.02 status=PASS
    ACTUAL A5 characteristic=C_POS serial="SN-05" value=0.041 actualSize=50.02 status=PASS
  `;

  it("computes MMC bonus tolerance, mean, stdDev, Cp, Cpk, Pp, Ppk, TUR, and Monte Carlo descriptors", () => {
    const doc = parseQif(sampleDsl);
    const spc = evaluateQifSpc(doc);

    assert.strictEqual(spc.totalCharacteristics, 1);
    assert.strictEqual(spc.totalActuals, 5);
    assert.strictEqual(spc.overallPassRate, 1.0);

    const rep = spc.characteristics[0]!;
    // Base 0.06 + MMC bonus (50.02 - 50.0 = 0.02) = 0.08
    assert.strictEqual(rep.baseTolerance, 0.06);
    assert.strictEqual(rep.meanBonusTolerance, 0.02);
    assert.strictEqual(rep.effectiveTolerance, 0.08);
    assert(Math.abs(rep.mean - 0.04) < 1e-9);
    assert(rep.stdDev > 0);
    assert(rep.cp > 2.0);
    assert(rep.cpk > 2.0);
    assert(rep.pp > 2.0);
    assert(rep.ppk > 2.0);
    // TUR = 0.08 / (2 * 0.001) = 40
    assert(rep.tur !== undefined && Math.abs(rep.tur - 40.0) < 1e-6);

    assert.strictEqual(spc.monteCarloDescriptors.length, 1);
    const mc = spc.monteCarloDescriptors[0]!;
    assert.strictEqual(mc.distributionType, "rayleigh");
    assert.strictEqual(mc.effectiveTolerance, 0.08);
  });

  it("lowers QIF features and characteristics directly into DAEBuilder linear memory arena", () => {
    const doc = parseQif(sampleDsl);
    const arena = lowerQifToDae(doc);
    // 1 feature nominal + 5 characteristic variables (nominal, tolerance, bonus, effective_tol, deviation)
    assert.strictEqual(arena.getVarCount(), 6);
    assert.strictEqual(arena.getEqCount(), 6);
  });

  it("projects QIF document to SysML v2 requirement def and verification def", () => {
    const doc = parseQif(sampleDsl);
    const sysml = qifToSysML2(doc);
    assert(sysml.includes("package GearboxCover"));
    assert(sysml.includes("part def BearingBore"));
    assert(sysml.includes("requirement def BearingBore_Pos_Requirement"));
    assert(sysml.includes("verification def InspectionPlanVerification"));
  });

  it("projects QIF document to parameterized Modelica record and model", () => {
    const doc = parseQif(sampleDsl);
    const mo = qifToModelica(doc);
    assert(mo.includes("package GearboxCover"));
    assert(mo.includes("record ToleranceParameters"));
    assert(mo.includes("model QualityInspectionModel"));
    assert(mo.includes("BearingBore_Pos_effective_tol = params.BearingBore_Pos_tolerance + BearingBore_Pos_bonus;"));
  });
});
