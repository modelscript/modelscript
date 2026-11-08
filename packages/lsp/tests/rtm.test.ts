// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CstLinkSynthesizer, RtmIndexEngine, SuspectTracker } from "../src/rtm/index.js";

describe("Interactive Traceability Matrix (RTM) Engine", () => {
  test("classifyDomain identifies all multi-tier digital thread domains", () => {
    assert.equal(RtmIndexEngine.classifyDomain({ ruleName: "RequirementDefinition" } as SymbolEntry), "requirement");
    assert.equal(RtmIndexEngine.classifyDomain({ ruleName: "PartUsage" } as SymbolEntry), "sysml_logical");
    assert.equal(
      RtmIndexEngine.classifyDomain({ ruleName: "ModelicaClass", resourceId: "file:///Motor.mo" } as SymbolEntry),
      "modelica_physics",
    );
    assert.equal(
      RtmIndexEngine.classifyDomain({ ruleName: "VerificationCaseUsage" } as SymbolEntry),
      "verification_case",
    );
  });

  test("extractLinks, buildMatrix, and computeAnalytics correctly calculate digital thread health", () => {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    // 1. Part: Battery
    const partSym: SymbolEntry = {
      id: 1,
      name: "battery",
      kind: "Usage",
      ruleName: "PartUsage",
      resourceId: "file:///vehicle.sysml",
      startOffset: 10,
      endOffset: 50,
      parentId: null,
    };
    symbols.set(1, partSym);
    byName.set("battery", [1]);

    // 2. Requirement: MaxWeight
    const reqSym1: SymbolEntry = {
      id: 2,
      name: "MaxWeightReq",
      kind: "Definition",
      ruleName: "RequirementDefinition",
      resourceId: "file:///requirements.sysml",
      startOffset: 0,
      endOffset: 100,
      parentId: null,
      metadata: { id: "REQ-001", doc: "Maximum weight limit" },
    };
    symbols.set(2, reqSym1);
    byName.set("MaxWeightReq", [2]);

    // 3. Orphan Requirement: RangeReq
    const reqSym2: SymbolEntry = {
      id: 3,
      name: "RangeReq",
      kind: "Definition",
      ruleName: "RequirementDefinition",
      resourceId: "file:///requirements.sysml",
      startOffset: 110,
      endOffset: 200,
      parentId: null,
      metadata: { id: "REQ-002", doc: "Minimum driving range" },
    };
    symbols.set(3, reqSym2);
    byName.set("RangeReq", [3]);

    // 4. Satisfy link: battery satisfies MaxWeightReq
    const satisfySym: SymbolEntry = {
      id: 4,
      name: "MaxWeightReq",
      kind: "Usage",
      ruleName: "SatisfyRequirementUsage",
      resourceId: "file:///vehicle.sysml",
      startOffset: 25,
      endOffset: 45,
      parentId: 1,
    };
    symbols.set(4, satisfySym);
    childrenOf.set(1, [4]);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    const matrix = RtmIndexEngine.buildMatrix(index, "sysml_logical", "requirement");

    assert.equal(matrix.rows.length, 1);
    assert.equal(matrix.rows[0]!.name, "battery");

    assert.equal(matrix.cols.length, 2);
    assert.equal(matrix.cols[0]!.name, "MaxWeightReq");
    assert.equal(matrix.cols[1]!.name, "RangeReq");

    // Check link existence
    const link = matrix.links["battery|MaxWeightReq"];
    assert.ok(link);
    assert.equal(link.linkKind, "satisfy");
    assert.equal(link.targetName, "MaxWeightReq");

    // Check Analytics
    assert.equal(matrix.analytics.totalRequirements, 2);
    assert.equal(matrix.analytics.satisfiedCount, 1);
    assert.equal(matrix.analytics.satisfiedPercentage, 50);
    assert.deepEqual(matrix.analytics.orphanRequirements, ["RangeReq"]);
    assert.deepEqual(matrix.analytics.unallocatedComponents, []);
  });

  test("SuspectTracker detects breaking modifications and flags links", () => {
    const tracker = new SuspectTracker();

    const baselineEntry: SymbolEntry = {
      id: 10,
      name: "ThermalReq",
      kind: "Definition",
      ruleName: "RequirementDefinition",
      resourceId: "file:///thermal.sysml",
      startOffset: 0,
      endOffset: 50,
      parentId: null,
      metadata: { limit: 400 },
    };

    tracker.recordBaseline("ThermalReq", baselineEntry);
    assert.equal(tracker.checkLinkSuspect("radiator|ThermalReq").isSuspect, false);

    // Flag suspect
    tracker.flagSuspect("ThermalReq", "Constraint limit lowered from 400K to 380K");

    const check = tracker.checkLinkSuspect("radiator|ThermalReq");
    assert.equal(check.isSuspect, true);
    assert.match(check.reason!, /Constraint limit lowered/);

    // Clear suspect
    tracker.clearSuspect("radiator|ThermalReq");
    assert.equal(tracker.checkLinkSuspect("radiator|ThermalReq").isSuspect, false);
  });

  test("CstLinkSynthesizer bi-directionally inserts and removes trace links in SysML v2", () => {
    const originalSysml = `part def Vehicle {
  part battery : Battery;
}`;

    // Synthesize link converting semicolon to block
    const edits = CstLinkSynthesizer.synthesizeSysMLTraceLink(originalSysml, "battery", "MaxWeightReq", "satisfy");

    assert.ok(edits && edits.length > 0);
    assert.equal(edits[0]!.newText, ` {\n  satisfy MaxWeightReq;\n}`);

    // Test inserting inside an existing block
    const blockSysml = `part def Vehicle {
  part motor : Motor {
    attribute power = 100;
  }
}`;

    const blockEdits = CstLinkSynthesizer.synthesizeSysMLTraceLink(blockSysml, "motor", "PowerReq", "satisfy");

    assert.ok(blockEdits && blockEdits.length > 0);
    assert.equal(blockEdits[0]!.newText, `\n  satisfy PowerReq;`);

    // Test removing link
    const withLink = `part def Vehicle {
  part motor : Motor {
    satisfy PowerReq;
    attribute power = 100;
  }
}`;

    const removeEdits = CstLinkSynthesizer.removeSysMLTraceLink(withLink, "PowerReq", "satisfy");

    assert.ok(removeEdits && removeEdits.length > 0);
    assert.equal(removeEdits[0]!.newText, "");
  });

  test("CstLinkSynthesizer bi-directionally inserts and removes trace links in Modelica", () => {
    const originalModelica = `model Chassis
  parameter Real mass = 1500;
end Chassis;`;

    const edits = CstLinkSynthesizer.synthesizeModelicaTraceLink(
      originalModelica,
      "Chassis",
      "StructuralReq",
      "satisfy",
    );

    assert.ok(edits && edits.length > 0);
    assert.match(edits[0]!.newText, /annotation\(__modelscript\(satisfies="StructuralReq"\)\);/);

    // Test removal
    const withAnnot = `model Chassis
  parameter Real mass = 1500;
  annotation(__modelscript(satisfies="StructuralReq"));
end Chassis;`;

    const removeEdits = CstLinkSynthesizer.removeModelicaTraceLink(withAnnot, "StructuralReq");
    assert.ok(removeEdits && removeEdits.length > 0);
    assert.equal(removeEdits[0]!.newText, "");
  });

  test("CstLinkSynthesizer ignores comments and string literals when locating SysML v2 elements", () => {
    const sysmlWithComments = `package VehiclePkg {
  // part battery : FakeBattery;
  /* part battery : OldBattery; */
  attribute note = "part battery : StringBattery;";
  part battery : Battery;
}`;

    const edits = CstLinkSynthesizer.synthesizeSysMLTraceLink(sysmlWithComments, "battery", "WeightReq", "satisfy");
    assert.ok(edits && edits.length === 1);
    assert.strictEqual(edits[0].newText, ` {\n  satisfy WeightReq;\n}`);
    // Verify position is at the real declaration semicolon, not the comments
    assert.ok(edits[0].range.start.line === 4);
  });

  test("CstLinkSynthesizer handles multi-model Modelica documents and nested annotations", () => {
    const multiModelica = `package VehicleModels
  // end Motor;
  model Motor
    parameter Real power = 100;
  end Motor;

  model Inverter
    parameter Real freq = 50;
    annotation(__modelscript(nested(a=1), satisfies="EfficiencyReq"));
  end Inverter;
end VehicleModels;`;

    // Synthesize into Motor
    const edits = CstLinkSynthesizer.synthesizeModelicaTraceLink(multiModelica, "Motor", "PowerReq", "satisfy");
    assert.ok(edits && edits.length === 1);
    assert.match(edits[0].newText, /annotation\(__modelscript\(satisfies="PowerReq"\)\);/);
    assert.strictEqual(edits[0].range.start.line, 4);

    // Remove nested annotation from Inverter
    const removeEdits = CstLinkSynthesizer.removeModelicaTraceLink(multiModelica, "EfficiencyReq");
    assert.ok(removeEdits && removeEdits.length === 1);
    assert.strictEqual(removeEdits[0].newText, "");
    assert.strictEqual(removeEdits[0].range.start.line, 8);
  });

  test("CstLinkSynthesizer works with parsed CST node trees", () => {
    const mockTree = {
      rootNode: {
        type: "source_file",
        children: [
          {
            type: "class_definition",
            startIndex: 0,
            endIndex: 75,
            children: [
              { type: "IDENT", text: "DroneMotor", startIndex: 6, endIndex: 16 },
              { type: "end", text: "end", startIndex: 60, endIndex: 63 },
            ],
          },
        ],
      },
    };
    const code = "model DroneMotor\n  parameter Real power = 200;\nend DroneMotor;\n";
    const edits = CstLinkSynthesizer.synthesizeModelicaTraceLink(code, "DroneMotor", "ThrustReq", "satisfy", mockTree);
    assert.ok(edits && edits.length === 1);
    assert.match(edits[0].newText, /annotation\(__modelscript\(satisfies="ThrustReq"\)\);/);

    const mockAnnotTree = {
      rootNode: {
        type: "source_file",
        children: [
          {
            type: "annotation",
            startIndex: 30,
            endIndex: 82,
            text: 'annotation(__modelscript(satisfies="ThrustReq"));',
          },
        ],
      },
    };
    const codeWithAnnot =
      'model DroneMotor\n  parameter Real power = 200;\n  annotation(__modelscript(satisfies="ThrustReq"));\nend DroneMotor;\n';
    const removeEdits = CstLinkSynthesizer.removeModelicaTraceLink(codeWithAnnot, "ThrustReq", mockAnnotTree);
    assert.ok(removeEdits && removeEdits.length === 1);
    assert.strictEqual(removeEdits[0].newText, "");
  });
});
