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

  test("ignores #123 inside string literals and /* ... */ comments and supports multi-line entities", () => {
    const multiLineStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
/* Comment referencing #888 should not trigger dangling error */
#10 = CARTESIAN_POINT(
  'Part (see #123 and #456)',
  (0.0, 0.0, 0.0)
);
#20 = DIRECTION(
  '',
  (0.0, 0.0, 1.0)
);
#30 = AXIS2_PLACEMENT_3D(
  'Placement',
  #10,
  #20,
  #20
);
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(multiLineStep);
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  test("T1008: warns on unrecognized FILE_SCHEMA application protocol", () => {
    const unsupportedSchemaStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('CUSTOM_UNKNOWN_SCHEMA'));
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('',(0.0,0.0,0.0));
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(unsupportedSchemaStep);
    const t1008 = diags.find((d) => d.code === "T1008");
    assert.ok(t1008, "Should emit T1008 for unrecognized schema");
    assert.equal(t1008.numericCode, StepErrorCode.UNSUPPORTED_AP_SCHEMA.code);
    assert.ok(t1008.message.includes("CUSTOM_UNKNOWN_SCHEMA"));
  });

  test("T1009: detects non-manifold edge shared by more than two faces", () => {
    const nonManifoldStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = CARTESIAN_POINT('',(1.0,0.0,0.0));
#3 = VERTEX_POINT('',#1);
#4 = VERTEX_POINT('',#2);
#5 = DIRECTION('',(1.0,0.0,0.0));
#6 = VECTOR('',#5,1.0);
#7 = LINE('',#1,#6);
#10 = EDGE_CURVE('',#3,#4,#7,.T.);
#11 = ORIENTED_EDGE('',*,*,#10,.T.);
#12 = ORIENTED_EDGE('',*,*,#10,.F.);
#13 = ORIENTED_EDGE('',*,*,#10,.T.);
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(nonManifoldStep);
    const t1009 = diags.find((d) => d.code === "T1009");
    assert.ok(t1009, "Should detect T1009 non-manifold edge");
    assert.equal(t1009.numericCode, StepErrorCode.NON_MANIFOLD_EDGE.code);
    assert.ok(t1009.message.includes("#10"));
  });

  test("T1010: detects open solid shell in manifold B-Rep", () => {
    const openShellStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = DIRECTION('',(0.0,0.0,1.0));
#3 = AXIS2_PLACEMENT_3D('',#1,#2,#2);
#4 = PLANE('',#3);
#5 = ADVANCED_FACE('',(),#4,.T.);
#20 = OPEN_SHELL('',(#5));
#30 = CLOSED_SHELL('',(#5));
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(openShellStep);
    const openDiags = diags.filter((d) => d.code === "T1010");
    assert.ok(openDiags.length >= 2, "Should detect T1010 on OPEN_SHELL and single-plane CLOSED_SHELL");
    assert.equal(openDiags[0]!.numericCode, StepErrorCode.OPEN_SOLID_SHELL.code);
  });

  test("T1011: detects degenerate zero-magnitude face normal vector", () => {
    const zeroNormalStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = DIRECTION('',(0.0,0.0,0.0));
#3 = AXIS2_PLACEMENT_3D('',#1,#2,#2);
#40 = PLANE('',#3);
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(zeroNormalStep);
    const t1011 = diags.find((d) => d.code === "T1011");
    assert.ok(t1011, "Should detect T1011 degenerate face normal");
    assert.equal(t1011.numericCode, StepErrorCode.DEGENERATE_FACE_NORMAL.code);
    assert.ok(t1011.message.includes("#40"));
  });

  test("T1012: warns on vertex tolerance gap exceeding AP242 uncertainty", () => {
    const gapStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = CARTESIAN_POINT('',(0.005,0.0,0.0));
#10 = VERTEX_POINT('',#1);
#11 = VERTEX_POINT('',#2);
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(gapStep);
    const t1012 = diags.find((d) => d.code === "T1012");
    assert.ok(t1012, "Should detect T1012 vertex tolerance gap");
    assert.equal(t1012.numericCode, StepErrorCode.VERTEX_TOLERANCE_GAP.code);
    assert.ok(t1012.message.includes("#10") && t1012.message.includes("#11"));
  });

  test("T1013: detects self-intersecting boundary loop wire", () => {
    const bowtieWireStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = CARTESIAN_POINT('',(1.0,1.0,0.0));
#3 = CARTESIAN_POINT('',(1.0,0.0,0.0));
#4 = CARTESIAN_POINT('',(0.0,1.0,0.0));
#50 = POLY_LOOP('',(#1,#2,#3,#4));
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(bowtieWireStep);
    const t1013 = diags.find((d) => d.code === "T1013");
    assert.ok(t1013, "Should detect T1013 self-intersecting wire");
    assert.equal(t1013.numericCode, StepErrorCode.SELF_INTERSECTING_WIRE.code);
    assert.ok(t1013.message.includes("#50"));
  });

  test("T1014: warns on unreferenced presentation style assignment", () => {
    const unlinkedStyleStep = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1 = COLOUR_RGB('',0.8,0.2,0.2);
#60 = PRESENTATION_STYLE_ASSIGNMENT((#1));
ENDSEC;
END-ISO-10303-21;
`;
    const diags = lintStepContent(unlinkedStyleStep);
    const t1014 = diags.find((d) => d.code === "T1014");
    assert.ok(t1014, "Should detect T1014 unreferenced presentation item");
    assert.equal(t1014.numericCode, StepErrorCode.UNREFERENCED_PRESENTATION_ITEM.code);
    assert.ok(t1014.message.includes("#60"));
  });
});

