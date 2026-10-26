// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { lintStepContent, StepErrorCode } from "../src/index.js";

describe("@modelscript/step Pre-Flight Linter (T1001–T1008)", () => {
  const validStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STEP AP214'),'2;1');
FILE_NAME('test.stp','2026-10-25T12:00:00',('Author'),('Org'),'Preprocessor','OriginatingSystem','Authorization');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#20 = DIRECTION('',(0.0,0.0,1.0));
#30 = AXIS2_PLACEMENT_3D('',#10,#20,#20);
ENDSEC;
END-ISO-10303-21;
`;

  test("reports 0 diagnostics for valid STEP AP214 file", () => {
    const diags = lintStepContent(validStep);
    const errors = diags.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Expected 0 errors on valid deck, got: ${JSON.stringify(errors)}`);
  });

  test("T1005: detects unresolved entity references", () => {
    const invalidStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#20 = AXIS2_PLACEMENT_3D('',#10,#999);
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(invalidStep);
    const unres = diags.find((d) => d.code === "T1005");
    assert.ok(unres, "Should detect T1005 unresolved entity reference");
    assert.ok(unres.message.includes("#999"));
    assert.equal(unres.numericCode, StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code);
  });

  test("T1006: detects duplicate entity IDs", () => {
    const duplicateStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#10 = DIRECTION('',(1.0,0.0,0.0));
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(duplicateStep);
    const dup = diags.find((d) => d.code === "T1006");
    assert.ok(dup, "Should detect T1006 duplicate entity ID");
    assert.ok(dup.message.includes("#10"));
  });

  test("T1001 & T1004: detects missing framing and DATA section", () => {
    const brokenStep = `HEADER;
ENDSEC;
`;
    const diags = lintStepContent(brokenStep);
    assert.ok(
      diags.some((d) => d.code === "T1001"),
      "Should detect T1001 missing framing",
    );
    assert.ok(
      diags.some((d) => d.code === "T1004"),
      "Should detect T1004 missing DATA section",
    );
  });
});
