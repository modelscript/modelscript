// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintQifDocument } from "../src/lints/index.js";
import { parseQif } from "../src/parser/index.js";
import { reconcileStepWithQif, synthesizeQifFromStep } from "../src/step-bridge/index.js";

describe("STEP AP242 to QIF 3.0 Bridge & Reconciliation", () => {
  const sampleStep = `
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STEP AP242 Model'),'2;1');
ENDSEC;
DATA;
#10 = PLANE('DatumFaceA', #11);
#101 = ADVANCED_FACE('DatumFaceA_Adv', (#12), #10, .T.);
#20 = CYLINDRICAL_SURFACE('MainBoreCyl', #21, 12.5);
#105 = ADVANCED_FACE('MainBoreFace', (#22), #20, .T.);
#30 = SPHERICAL_SURFACE('BallSocket', #31, 8.0);
#200 = DATUM('A', #101);
#210 = FLATNESS_TOLERANCE('BaseFlatness', 0.01, #101);
#220 = POSITION_TOLERANCE('MainBorePos', 0.04, #105);
ENDSEC;
END-ISO-10303-21;
  `;

  it("reconciles valid STEP entity references and emits M8109 on missing STEP entity IDs", () => {
    const qifDsl = `
      QIF 3.0.0
      FEATURE F1 Plane "DatumPlane" step="#101" points=4
      FEATURE F2 Cylinder "MainBore" size=25.0 step="#105" points=6
      FEATURE F3 Sphere "MissingSphere" size=16.0 step="#999" points=5
    `;
    const doc = parseQif(qifDsl);
    const res = reconcileStepWithQif(sampleStep, doc);

    assert.strictEqual(res.matchedFeatures.length, 2);
    assert(res.matchedFeatures.every((m) => m.geometryCompatible));
    assert.strictEqual(res.unresolvedFeatures.length, 1);
    assert.strictEqual(res.unresolvedFeatures[0]?.stepEntityId, "#999");

    assert.strictEqual(res.diagnostics.length, 1);
    assert.strictEqual(res.diagnostics[0]?.code, "M8109");
    assert(res.diagnostics[0]?.message.includes("#999"));
  });

  it("synthesizes a valid QIF 3.0 document from STEP AP242 entities", () => {
    const synthesized = synthesizeQifFromStep(sampleStep);
    assert(synthesized.features.length >= 3);

    const cylFeat = synthesized.features.find((f) => f.featureType === "Cylinder");
    assert(cylFeat !== undefined);
    // Radius 12.5 in STEP -> Diameter 25.0 in QIF
    assert.strictEqual(cylFeat.nominalSize, 25.0);

    assert(synthesized.characteristics.length >= 2);
    const diags = lintQifDocument(synthesized);
    assert.strictEqual(diags.length, 0);
  });
});
