// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SysML2ErrorCode, createSysML2Diagnostic } from "../src/errors.js";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("SysML v2 Structured Error Codes, Static Diagnostics & Frontend Type Checking (Phase 5)", () => {
  it("verifies SysML2ErrorCode registry structure, numbering scheme, and message formats", () => {
    // 1xxx: Syntax & Naming
    assert.strictEqual(SysML2ErrorCode.PARSE_ERROR.code, 1001);
    assert.strictEqual(SysML2ErrorCode.PARSE_MISSING.code, 1002);
    assert.strictEqual(SysML2ErrorCode.DEFINITION_NAMING.code, 1003);
    assert.strictEqual(SysML2ErrorCode.USAGE_NAMING.code, 1004);
    assert.strictEqual(SysML2ErrorCode.DEFINITION_NAMING.severity, "warning");
    assert.strictEqual(SysML2ErrorCode.USAGE_NAMING.severity, "warning");

    // 2xxx: Scoping & Name Resolution
    assert.strictEqual(SysML2ErrorCode.DUPLICATE_MEMBER.code, 2001);
    assert.strictEqual(SysML2ErrorCode.SYMBOL_NOT_FOUND.code, 2002);
    assert.strictEqual(SysML2ErrorCode.UNRESOLVED_TARGET.code, 2003);
    assert.strictEqual(SysML2ErrorCode.UNRESOLVED_SOURCE.code, 2004);
    assert.strictEqual(SysML2ErrorCode.UNRESOLVED_IMPORT.code, 2005);

    // 3xxx: Type System & Static Checking
    assert.strictEqual(SysML2ErrorCode.TYPE_MISMATCH.code, 3001);
    assert.strictEqual(SysML2ErrorCode.INCOMPATIBLE_PORT_CONNECTION.code, 3002);
    assert.strictEqual(SysML2ErrorCode.DIMENSIONAL_MISMATCH.code, 3003);
    assert.strictEqual(SysML2ErrorCode.INVALID_MULTIPLICITY_BOUNDS.code, 3004);
    assert.strictEqual(SysML2ErrorCode.TARGET_NOT_REQUIREMENT.code, 3005);
    assert.strictEqual(SysML2ErrorCode.VERIFY_TARGET_NOT_A_REQUIREMENT.code, 3006);

    // 4xxx: Structural & Metamodel Semantics
    assert.strictEqual(SysML2ErrorCode.CIRCULAR_SPECIALIZATION.code, 4001);
    assert.strictEqual(SysML2ErrorCode.CYCLIC_SATISFACTION.code, 4002);
    assert.strictEqual(SysML2ErrorCode.EMPTY_DEFINITION.code, 4003);
    assert.strictEqual(SysML2ErrorCode.ABSTRACT_REQUIREMENT_VIOLATION.code, 4004);
    assert.strictEqual(SysML2ErrorCode.ONTOLOGICAL_INCONSISTENCY.code, 4005);
    assert.strictEqual(SysML2ErrorCode.MISSING_SUBJECT.code, 4006);

    // 5xxx: Behavior, State Machines & Formal Verification
    assert.strictEqual(SysML2ErrorCode.CONSTRAINT_VIOLATED.code, 5001);
    assert.strictEqual(SysML2ErrorCode.REQUIREMENT_FAILED.code, 5002);
    assert.strictEqual(SysML2ErrorCode.BROKEN_INTERFACE_CONTRACT.code, 5003);
    assert.strictEqual(SysML2ErrorCode.ACTIVITY_CFA_UNREACHABLE.code, 5004);
    assert.strictEqual(SysML2ErrorCode.ACTIVITY_SOUNDNESS_VIOLATION.code, 5005);
    assert.strictEqual(SysML2ErrorCode.DEFINITE_ASSIGNMENT_VIOLATION.code, 5006);
    assert.strictEqual(SysML2ErrorCode.STATEMACHINE_NONDETERMINISTIC.code, 5007);
    assert.strictEqual(SysML2ErrorCode.STATEMACHINE_DEADLOCK.code, 5008);

    // Helper createSysML2Diagnostic
    const diag = createSysML2Diagnostic(SysML2ErrorCode.TYPE_MISMATCH, ["speed", "Real", "String"]);
    assert.strictEqual(diag.code, 3001);
    assert.strictEqual(diag.rule, "type-mismatch");
    assert.strictEqual(diag.severity, "error");
    assert.ok(
      diag.message.includes("cannot assign value of type 'String' to feature 'speed' with declared type 'Real'"),
    );
  });

  it("detects naming convention violations with structured codes S1003 and S1004", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package NamingTests {
        part def lowercasePartDef;
        part def GoodPartDef {
          attribute BadAttr : ScalarValues::Integer;
          attribute goodAttr : ScalarValues::Integer;
        }
      }
    `;

    const uri = "file:///workspace/NamingTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // S1003: Definition naming
    const badDef = db.byName("lowercasePartDef")[0];
    assert.ok(badDef);
    const defDiag = qe.fetch("lint__definitionNaming", badDef.id);
    assert.ok(defDiag);
    assert.strictEqual((defDiag as any).code, 1003);
    assert.strictEqual((defDiag as any).severity, "warning");

    // S1004: Usage naming
    const badAttr = db.byName("BadAttr")[0];
    assert.ok(badAttr);
    const usageDiag = qe.fetch("lint__usageNaming", badAttr.id);
    assert.ok(usageDiag);
    assert.strictEqual((usageDiag as any).code, 1004);
    assert.strictEqual((usageDiag as any).severity, "warning");

    // Good attributes should have no naming diagnostic
    const goodAttr = db.byName("goodAttr")[0];
    assert.ok(goodAttr);
    const goodUsageDiag = qe.fetch("lint__usageNaming", goodAttr.id);
    assert.strictEqual(goodUsageDiag, null);
  });

  it("detects structural violations: duplicate members S2001 and empty definitions S4003", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package StructuralTests {
        part def EmptyDef {}
        part def DuplicateDef {
          attribute sensor : ScalarValues::Real;
          attribute sensor : ScalarValues::Integer;
        }
      }
    `;

    const uri = "file:///workspace/StructuralTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // S4003: Empty definition
    const emptyDef = db.byName("EmptyDef")[0];
    assert.ok(emptyDef);
    const emptyDiag = qe.fetch("lint__emptyDefinition", emptyDef.id);
    assert.ok(emptyDiag);
    assert.strictEqual((emptyDiag as any).code, 4003);
    assert.strictEqual((emptyDiag as any).severity, "info");

    // S2001: Duplicate member
    const dupDef = db.byName("DuplicateDef")[0];
    assert.ok(dupDef);
    const dupDiag = qe.fetch("lint__duplicateFeatureName", dupDef.id);
    assert.ok(dupDiag);
    assert.strictEqual((dupDiag as any).code, 2001);
    assert.strictEqual((dupDiag as any).severity, "warning");
    assert.ok((dupDiag as any).message.includes("Duplicate member 'sensor'"));
  });

  it("detects circular specialization cycles with code S4001", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package CircularSpecTests {
        part def CycleA :> CycleB {}
        part def CycleB :> CycleA {}
      }
    `;

    const uri = "file:///workspace/CircularSpecTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    const cycleA = db.byName("CycleA")[0];
    assert.ok(cycleA);
    const circDiag = qe.fetch("lint__circularSpecialization", cycleA.id);
    assert.ok(circDiag);
    assert.strictEqual((circDiag as any).code, 4001);
    assert.strictEqual((circDiag as any).severity, "error");
    assert.ok((circDiag as any).message.includes("Circular specialization"));
  });

  it("detects invalid multiplicity bounds with code S3004", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package MultiplicityTests {
        part def Vehicle {
          part wheels [5..2] : Wheel;
        }
        part def Wheel;
      }
    `;

    const uri = "file:///workspace/MultiplicityTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    const wheels = db.byName("wheels")[0];
    assert.ok(wheels);
    const multDiag = qe.fetch("lint__multiplicityBounds", wheels.id);
    assert.ok(multDiag);
    assert.strictEqual((multDiag as any).code, 3004);
    assert.strictEqual((multDiag as any).severity, "error");
    assert.ok((multDiag as any).message.includes("Invalid multiplicity bounds"));
  });

  it("statically type-checks feature assignment bindings and catches type mismatches with code S3001", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);

    const code = `
      package StaticTypeCheckingTests {
        import ScalarValues::*;

        part def SensorModule {
          // Type errors:
          attribute badInt : Integer = "notAnInt";
          attribute badBool : Boolean = 42;
          attribute badStr : String = true;
          attribute badReal : Real = "text";

          // Valid assignments:
          attribute goodInt : Integer = 100;
          attribute goodReal : Real = 3.14159;
          attribute goodWidened : Real = 50;
          attribute goodBool : Boolean = true;
          attribute goodStr : String = "hello world";
        }
      }
    `;

    const uri = "file:///workspace/StaticTypeCheckingTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // 1. badInt: assigning String to Integer
    const badInt = db.byName("badInt")[0];
    assert.ok(badInt);
    const diagInt = qe.fetch("lint__typeMismatchAssignment", badInt.id);
    assert.ok(diagInt, "badInt must produce a type mismatch diagnostic");
    assert.strictEqual((diagInt as any).code, 3001);
    assert.strictEqual((diagInt as any).severity, "error");
    assert.ok((diagInt as any).message.includes("Type mismatch"));

    // 2. badBool: assigning Integer to Boolean
    const badBool = db.byName("badBool")[0];
    assert.ok(badBool);
    const diagBool = qe.fetch("lint__typeMismatchAssignment", badBool.id);
    assert.ok(diagBool, "badBool must produce a type mismatch diagnostic");
    assert.strictEqual((diagBool as any).code, 3001);

    // 3. badStr: assigning Boolean to String
    const badStr = db.byName("badStr")[0];
    assert.ok(badStr);
    const diagStr = qe.fetch("lint__typeMismatchAssignment", badStr.id);
    assert.ok(diagStr, "badStr must produce a type mismatch diagnostic");
    assert.strictEqual((diagStr as any).code, 3001);

    // 4. badReal: assigning String to Real
    const badReal = db.byName("badReal")[0];
    assert.ok(badReal);
    const diagReal = qe.fetch("lint__typeMismatchAssignment", badReal.id);
    assert.ok(diagReal, "badReal must produce a type mismatch diagnostic");
    assert.strictEqual((diagReal as any).code, 3001);

    // 5. Valid assignments must produce zero type mismatch diagnostics
    const goodInt = db.byName("goodInt")[0];
    assert.strictEqual(qe.fetch("lint__typeMismatchAssignment", goodInt.id), null);

    const goodReal = db.byName("goodReal")[0];
    assert.strictEqual(qe.fetch("lint__typeMismatchAssignment", goodReal.id), null);

    const goodWidened = db.byName("goodWidened")[0];
    assert.strictEqual(qe.fetch("lint__typeMismatchAssignment", goodWidened.id), null);

    const goodBool = db.byName("goodBool")[0];
    assert.strictEqual(qe.fetch("lint__typeMismatchAssignment", goodBool.id), null);

    const goodStr = db.byName("goodStr")[0];
    assert.strictEqual(qe.fetch("lint__typeMismatchAssignment", goodStr.id), null);
  });

  it("statically type-checks port connections and detects incompatible port types with code S3002", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package PortTypeTests {
        port def ElectricalPort;
        port def ThermalPort;

        part def System {
          port ep1 : ElectricalPort;
          port ep2 : ElectricalPort;
          port tp1 : ThermalPort;

          connection goodConn connect ep1 to ep2;
          connection badConn connect ep1 to tp1;
        }
      }
    `;

    const uri = "file:///workspace/PortTypeTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // 1. badConn: ElectricalPort vs ThermalPort
    const badConn = db.byName("badConn")[0];
    assert.ok(badConn);
    const connDiag = qe.fetch("lint__connectionTypeCompatibility", badConn.id);
    assert.ok(connDiag, "badConn must produce incompatible port connection error");
    assert.strictEqual((connDiag as any).code, 3002);
    assert.strictEqual((connDiag as any).severity, "error");
    assert.ok((connDiag as any).message.includes("Incompatible port connection"));

    // 2. goodConn: ElectricalPort to ElectricalPort
    const goodConn = db.byName("goodConn")[0];
    assert.ok(goodConn);
    const goodConnDiag = qe.fetch("lint__connectionTypeCompatibility", goodConn.id);
    assert.strictEqual(goodConnDiag, null);
  });

  it("detects requirement satisfaction violations with codes S3005 and S4002", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package RequirementTests {
        part def RegularPart;
        requirement def SafetyReq;

        part def InvalidSatisfier {
          satisfy RegularPart;
        }

        requirement def CycleReqA {
          satisfy CycleReqB;
        }
        requirement def CycleReqB {
          satisfy CycleReqA;
        }
      }
    `;

    const uri = "file:///workspace/RequirementTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // S3005: Target is not a requirement
    const invalidPart = db.byName("InvalidSatisfier")[0];
    assert.ok(invalidPart);
    const invalidSatisfy = db.childrenOf(invalidPart.id).find((c) => c.ruleName === "SatisfyRequirementUsage");
    assert.ok(invalidSatisfy);
    const invalidTargetDiag = qe.fetch("lint__invalidTarget", invalidSatisfy.id);
    assert.ok(invalidTargetDiag);
    assert.strictEqual((invalidTargetDiag as any).code, 3005);
    assert.strictEqual((invalidTargetDiag as any).severity, "error");
    assert.ok((invalidTargetDiag as any).message.includes("is not a Requirement"));

    // S4002: Cyclic satisfaction
    const cycleReqA = db.byName("CycleReqA")[0];
    assert.ok(cycleReqA);
    const cyclicDiag = qe.fetch("lint__cyclicSatisfaction", cycleReqA.id);
    assert.ok(cyclicDiag);
    assert.strictEqual((cyclicDiag as any).code, 4002);
    assert.strictEqual((cyclicDiag as any).severity, "error");
    assert.ok((cyclicDiag as any).message.includes("Circular satisfaction"));
  });

  it("runs all registered lints through QueryEngine.runAllLints and retains numeric codes", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package FullLinterWorkspace {
        part def badNameDef {}
        part def DuplicateHost {
          attribute dupVar : ScalarValues::Integer = "badAssign";
          attribute dupVar : ScalarValues::Integer;
        }
      }
    `;

    const uri = "file:///workspace/FullLinterWorkspace.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));

    const diags = qe.runAllLints(uri);
    assert.ok(diags.length >= 3, `Expected at least 3 diagnostics, got ${diags.length}`);

    const codes = diags.map((d) => d.code).filter(Boolean);
    assert.ok(codes.includes(1003), "Must include definition naming violation S1003");
    assert.ok(codes.includes(2001), "Must include duplicate member violation S2001");
    assert.ok(codes.includes(3001), "Must include type mismatch violation S3001");
    assert.ok(codes.includes(4003), "Must include empty definition violation S4003");
  });
});
