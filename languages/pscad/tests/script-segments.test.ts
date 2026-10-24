// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { getPscadHover } from "../src/catalog/master-library-schemas.js";
import { lintPscx, PscadErrorCode } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";
import {
  evaluateCheckRules,
  evaluateCondition,
  parseBranchSegment,
  parseChecksSegment,
  parseFlyBySegment,
} from "../src/script/script-parser.js";

describe("PSCAD Legacy Script & Fortran Tag Support Suite", () => {
  test("parseFlyBySegment extracts component summary and port-specific documentation", () => {
    const flyByRaw = `
ABC to DQ0 or DQ0 to ABC transformation
Performs Park vector transformations between stationary and rotating reference frames.

:A
Phase A terminal (voltage or current)
:B
Phase B terminal
:C
Phase C terminal
:D
Direct axis component
:Q
Quadrature axis component
:O
Zero sequence component
`;

    const doc = parseFlyBySegment(flyByRaw);
    assert.ok(doc.summary.includes("ABC to DQ0"));
    assert.ok(doc.summary.includes("Park vector transformations"));
    assert.equal(Object.keys(doc.ports).length, 6);
    assert.equal(doc.ports["A"], "Phase A terminal (voltage or current)");
    assert.equal(doc.ports["B"], "Phase B terminal");
    assert.equal(doc.ports["Q"], "Quadrature axis component");
    assert.equal(doc.ports["O"], "Zero sequence component");
  });

  test("parseChecksSegment and evaluateCheckRules evaluate parameter validation assertions", () => {
    const checksRaw = `
ERROR Dimension input must be greater than 0 : Dim > 0
ERROR Output array index exceeds input array bounds : $#DIM(A) >= End
#IF CoreType < 1 || CoreType > 4
  ERROR Incorrect CoreType
#ENDIF
WARNING Core conductor outer radius should be greater than inner radius : R2 > R1
`;

    const rules = parseChecksSegment(checksRaw);
    assert.equal(rules.length, 4);
    assert.equal(rules[0]!.severity, "error");
    assert.equal(rules[0]!.message, "Dimension input must be greater than 0");
    assert.equal(rules[0]!.condition, "Dim > 0");

    assert.equal(rules[1]!.condition, "$#DIM(A) >= End");

    assert.equal(rules[2]!.guard, "CoreType < 1 || CoreType > 4");
    assert.equal(rules[2]!.condition, undefined);

    assert.equal(rules[3]!.severity, "warning");

    // Case 1: Valid parameters (all assertions pass)
    const validParams = { Dim: 3, End: 2, CoreType: 2, R1: 0.01, R2: 0.05 };
    const portDims = { A: 3 };
    const noFailures = evaluateCheckRules(rules, validParams, portDims);
    assert.equal(noFailures.length, 0, "Expected all rules to pass for valid parameters");

    // Case 2: Violated assertions
    const invalidParams = { Dim: -1, End: 5, CoreType: 5, R1: 0.05, R2: 0.01 };
    const failures = evaluateCheckRules(rules, invalidParams, portDims);
    assert.equal(failures.length, 4);
    assert.equal(failures[0]!.message, "Dimension input must be greater than 0");
    assert.equal(failures[1]!.message, "Output array index exceeds input array bounds");
    assert.equal(failures[2]!.message, "Incorrect CoreType");
    assert.equal(failures[3]!.severity, "warning");
    assert.equal(failures[3]!.message, "Core conductor outer radius should be greater than inner radius");
  });

  test("evaluateCondition handles arithmetic, comparisons, logic, and Fortran operators", () => {
    assert.equal(evaluateCondition("2 + 3 == 5", {}), true);
    assert.equal(evaluateCondition("R3 - R2 - SL1 > 0", { R3: 10, R2: 4, SL1: 2 }), true);
    assert.equal(evaluateCondition("R3 - R2 - SL1 > 0", { R3: 5, R2: 4, SL1: 2 }), false);
    assert.equal(evaluateCondition("!(HP && MP && LP)", { HP: 1, MP: 0, LP: 1 }), true);
    assert.equal(evaluateCondition("!(HP && MP && LP)", { HP: 1, MP: 1, LP: 1 }), false);
    assert.equal(evaluateCondition("$in1 .GE. $in2", { in1: 10, in2: 5 }), true);
  });

  test("parseBranchSegment parses passive branches, breakers, ammeters, and sources with #IF guards", () => {
    const branchRaw = `
#IF Type==0
  $A $B       $R 0 0
#ELSEIF Type==1
  $A $B       0 $L 0
#ELSE
  BN = $N1 $N2 AMMETER
  BrA = $A1 $A2 BREAKER 1.0E6
  BA = $NB $NA SOURCE 1.0 0.1 1.0
#ENDIF
`;

    const rBranch = parseBranchSegment(branchRaw, { Type: 0, R: 50.0 });
    assert.equal(rBranch.length, 1);
    assert.equal(rBranch[0]!.kind, "passive");
    assert.equal(rBranch[0]!.fromNode, "A");
    assert.equal(rBranch[0]!.toNode, "B");
    assert.equal(rBranch[0]!.r, "$R");

    const lBranch = parseBranchSegment(branchRaw, { Type: 1, L: 0.1 });
    assert.equal(lBranch.length, 1);
    assert.equal(lBranch[0]!.kind, "passive");
    assert.equal(lBranch[0]!.l, "$L");

    const mixedBranches = parseBranchSegment(branchRaw, { Type: 2 });
    assert.equal(mixedBranches.length, 3);
    assert.equal(mixedBranches[0]!.name, "BN");
    assert.equal(mixedBranches[0]!.kind, "ammeter");
    assert.equal(mixedBranches[1]!.name, "BrA");
    assert.equal(mixedBranches[1]!.kind, "breaker");
    assert.equal(mixedBranches[1]!.extra, "1.0E6");
    assert.equal(mixedBranches[2]!.name, "BA");
    assert.equal(mixedBranches[2]!.kind, "source");
  });

  test("parsePscx extracts script segments and integrates FlyBy hover & Checks linter diagnostics", () => {
    const pscxXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="ScriptTagTest" version="5.0.0" type="case">
  <definitions>
    <Definition classid="UserCmpDefn" name="CustomBlock" id="1001">
      <paramlist name="">
        <param name="Description" value="" />
      </paramlist>
      <graphics>
        <Port x="-20" y="0">
          <paramlist>
            <param name="name" value="IN" />
            <param name="mode" value="1" />
            <param name="dim" value="1" />
          </paramlist>
        </Port>
        <Port x="20" y="0">
          <paramlist>
            <param name="name" value="OUT" />
            <param name="mode" value="2" />
            <param name="dim" value="1" />
          </paramlist>
        </Port>
      </graphics>
      <script>
        <segment name="FlyBy" id="1"><![CDATA[
Advanced Custom Signal Filter
Applies multi-stage digital filtering to input stream.

:IN
Input signal terminal
:OUT
Filtered output signal terminal
]]></segment>
        <segment name="Checks" id="2"><![CDATA[
ERROR Filter cutoff frequency must be positive : fc > 0
WARNING Filter damping ratio is abnormally low : zeta >= 0.1
]]></segment>
        <segment name="Branch" id="3"><![CDATA[
$IN $OUT 100.0 0 0
]]></segment>
      </script>
    </Definition>
  </definitions>
  <schematic classid="UserCanvas">
    <User classid="UserCmp" defn="CustomBlock" id="Cmp1" x="100" y="100" w="40" h="40" z="10">
      <paramlist>
        <param name="fc" value="-5.0" />
        <param name="zeta" value="0.05" />
      </paramlist>
    </User>
  </schematic>
</project>`;

    const project = parsePscx(pscxXml);
    assert.ok(project.definitions?.has("CustomBlock"));
    const def = project.definitions.get("CustomBlock")!;
    assert.ok(def.flyBy);
    assert.ok(def.flyBy.summary.includes("Advanced Custom Signal Filter"));
    assert.equal(def.flyBy.ports["IN"], "Input signal terminal");
    assert.equal(def.flyBy.ports["OUT"], "Filtered output signal terminal");
    assert.equal(def.checks?.length, 2);

    // 1. Verify getPscadHover surfaces FlyBy documentation
    const hoverCmp = getPscadHover(pscxXml, pscxXml.indexOf('defn="CustomBlock"'));
    assert.ok(hoverCmp);
    assert.ok(hoverCmp.contents.includes("Advanced Custom Signal Filter"));
    assert.ok(hoverCmp.contents.includes("Input signal terminal"));
    assert.ok(hoverCmp.contents.includes("Filtered output signal terminal"));

    // 2. Verify getPscadHover on <Definition> element surfaces full definition card
    const hoverDef = getPscadHover(pscxXml, pscxXml.indexOf('name="CustomBlock"'));
    assert.ok(hoverDef);
    assert.ok(hoverDef.contents.includes("PSCAD Component Definition `CustomBlock`"));
    assert.ok(hoverDef.contents.includes("Parameter Validation Rules"));

    // 3. Verify lintPscx evaluates Checks and emits M6016 (error) and M6017 (warning)
    const diags = lintPscx(project);
    const checkError = diags.find((d) => d.code === PscadErrorCode.CHECK_FAILED.code);
    const checkWarning = diags.find((d) => d.code === PscadErrorCode.CHECK_WARNING.code);

    assert.ok(checkError, "Expected M6016 check error for negative cutoff frequency fc");
    assert.ok(checkError.message.includes("Filter cutoff frequency must be positive"));

    assert.ok(checkWarning, "Expected M6017 check warning for low damping zeta");
    assert.ok(checkWarning.message.includes("Filter damping ratio is abnormally low"));
  });
});
