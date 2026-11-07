// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintQifDocument } from "../src/lints/index.js";
import { parseQif } from "../src/parser/index.js";

describe("QIF 3.0 Semantic Linter (NIST QIF Rules & ASME Y14.5 M8101–M8108)", () => {
  it("emits M8101 on unresolved featureId, characteristicId, deviceId, or datum reference", () => {
    const dsl = `
      QIF 3.0.0 qpId="11111111-1111-4111-8111-111111111111"
      DATUM A id=D1 feature=MISSING_FEAT
      CHARACTERISTIC C1 Position "PosCheck" zone=0.05 material=RFS datums=[A, Z] features=[MISSING_FEAT2] device=MISSING_DEV
      STEP S1 step=1 feature=MISSING_FEAT3 characteristic=MISSING_CHAR device=MISSING_DEV points=6
      ACTUAL ACT1 characteristic=MISSING_CHAR serial="SN-01" value=0.01 status=PASS
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    const m8101 = diags.filter((d) => d.code === "M8101");
    assert(m8101.length >= 6);
    assert(m8101.some((d) => d.message.includes("MISSING_FEAT")));
    assert(m8101.some((d) => d.message.includes("MISSING_DEV")));
    assert(m8101.some((d) => d.message.includes("'Z'")));
  });

  it("emits M8102 on duplicate element ID or QPId UUID", () => {
    const dsl = `
      QIF 3.0.0 qpId="11111111-1111-4111-8111-111111111111"
      FEATURE F1 Cylinder "Bore1" qpId="dup-uuid-1234" size=10.0 points=6
      FEATURE F1 Cylinder "Bore2" qpId="dup-uuid-1234" size=12.0 points=6
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    assert(diags.some((d) => d.code === "M8102"));
  });

  it("emits M8103 on duplicate datum label inside a single DatumReferenceFrame (A | A)", () => {
    const dsl = `
      QIF 3.0.0
      FEATURE F1 Plane "FaceA" points=4
      DATUM A id=D1 feature=F1
      CHARACTERISTIC C1 Position "HolePos" zone=0.05 material=RFS datums=[A, A] features=[F1]
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    const d = diags.find((x) => x.code === "M8103");
    assert(d !== undefined);
    assert(d.message.includes("Duplicate datum label 'A'"));
  });

  it("emits M8104 when MMC or LMC is applied to a non-feature-of-size (Plane) or Flatness tolerance", () => {
    const dsl = `
      QIF 3.0.0
      FEATURE F_PLANE Plane "TopFace" points=4
      FEATURE F_BORE Cylinder "MainBore" size=20.0 points=6
      DATUM A id=D1 feature=F_PLANE
      CHARACTERISTIC C_SURFACE Perpendicularity "PerpPlane" zone=0.02 material=MMC datums=[A] features=[F_PLANE]
      CHARACTERISTIC C_FLAT Flatness "FlatFace" zone=0.01 material=LMC features=[F_BORE]
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    const m8104 = diags.filter((d) => d.code === "M8104");
    assert.strictEqual(m8104.length, 2);
  });

  it("emits M8105 when composite lower-tier tolerance is >= upper-tier tolerance", () => {
    const dsl = `
      QIF 3.0.0
      FEATURE F1 Plane "DatumPlane" points=4
      FEATURE F2 Cylinder "Bore" size=15.0 points=6
      DATUM A id=D1 feature=F1
      CHARACTERISTIC C1 Position "PatternPos" zone=0.05 material=MMC datums=[A] features=[F2] composite=(zone=0.05, material=MMC, datums=[A])
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    assert(diags.some((d) => d.code === "M8105"));
  });

  it("emits M8106 when probing points are below mathematical minimum or QifRules minimum", () => {
    const dsl = `
      QIF 3.0.0
      RULE minTur=4.0 Cylinder=8
      FEATURE F_CYL Cylinder "Shaft" size=20.0 points=4
      FEATURE F_SPH Sphere "Ball" size=10.0 points=3
      FEATURE F_CONE Cone "Taper" points=5
      DEVICE CMM1 CMM "CMM" uncertainty=0.001
      STEP S1 step=1 feature=F_CYL device=CMM1 points=6
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    const m8106 = diags.filter((d) => d.code === "M8106");
    // F_CYL (4 < 8), F_SPH (3 < 4), F_CONE (5 < 6), S1 (6 < 8 from rule)
    assert.strictEqual(m8106.length, 4);
  });

  it("emits M8107 when measurement device calibration uncertainty violates 4:1 TUR threshold", () => {
    const dsl = `
      QIF 3.0.0
      RULE minTur=4.0
      FEATURE F1 Cylinder "PrecisionBore" size=25.0 points=6
      DEVICE CAL1 Caliper "HandCaliper" uncertainty=0.01
      CHARACTERISTIC C1 Position "TightPos" zone=0.04 material=RFS features=[F1] device=CAL1
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    const d = diags.find((x) => x.code === "M8107");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "warning");
    assert(d.message.includes("2.00:1"));
  });

  it("evaluates M8108 with ASME Y14.5 MMC/LMC bonus tolerance correctly", () => {
    const dsl = `
      QIF 3.0.0
      FEATURE F_HOLE Cylinder "MountHole" size=10.0 points=6 internal=true
      CHARACTERISTIC C_POS Position "HolePosition" zone=0.05 material=MMC features=[F_HOLE]
      // Actual 1: measured=0.07 > base(0.05), but actualSize=10.03 gives +0.03 MMC bonus -> effTol=0.08 -> PASS is valid!
      ACTUAL ACT_BONUS_PASS characteristic=C_POS serial="SN-1" value=0.07 actualSize=10.03 status=PASS
      // Actual 2: measured=0.09 > effTol(0.08) while marked PASS -> M8108!
      ACTUAL ACT_BAD_PASS characteristic=C_POS serial="SN-2" value=0.09 actualSize=10.03 status=PASS
      // Actual 3: measured=0.03 <= effTol(0.05) while marked FAIL -> M8108!
      ACTUAL ACT_BAD_FAIL characteristic=C_POS serial="SN-3" value=0.03 actualSize=10.00 status=FAIL
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);
    const m8108 = diags.filter((d) => d.code === "M8108");
    assert.strictEqual(m8108.length, 2);
    assert(m8108.some((d) => d.message.includes("ACT_BAD_PASS")));
    assert(m8108.some((d) => d.message.includes("ACT_BAD_FAIL")));
    assert(!m8108.some((d) => d.message.includes("ACT_BONUS_PASS")));
  });

  it("emits M8109–M8112 for unresolved STEP entity, zero tolerance zone without MMC, circular datum reference, and insufficient SPC subgroup size", () => {
    const dsl = `
      QIF 3.0.0
      FEATURE F1 Cylinder "Bore1" size=10.0 points=6 step=#0
      DATUM A id=D1 feature=F1 datums=[A]
      CHARACTERISTIC C_ZERO Position "ZeroPosRFS" zone=0.0 material=RFS features=[F1]
      CHARACTERISTIC C_SPC Position "SpcPos" zone=0.05 material=MMC features=[F1] subgroupSize=1
    `;
    const doc = parseQif(dsl);
    const diags = lintQifDocument(doc);

    const m8109 = diags.find((d) => d.code === "M8109");
    assert(m8109 !== undefined, "Expected M8109 UNRESOLVED_STEP_ENTITY");
    assert(m8109.message.includes("#0"));

    const m8110 = diags.find((d) => d.code === "M8110");
    assert(m8110 !== undefined, "Expected M8110 ZERO_TOLERANCE_ZONE");
    assert(m8110.message.includes("ZeroPosRFS"));

    const m8111 = diags.find((d) => d.code === "M8111");
    assert(m8111 !== undefined, "Expected M8111 CIRCULAR_DATUM_REFERENCE");
    assert(m8111.message.includes("'A'"));

    const m8112 = diags.find((d) => d.code === "M8112");
    assert(m8112 !== undefined, "Expected M8112 SPC_SUBGROUP_SIZE_INSUFFICIENT");
    assert(m8112.message.includes("SpcPos"));
  });
});

