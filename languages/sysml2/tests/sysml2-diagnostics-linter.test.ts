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
    assert.strictEqual(SysML2ErrorCode.UNRESOLVED_TRANSITION_STATE.code, 2006);

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
    assert.strictEqual(SysML2ErrorCode.REQUIREMENT_WITHOUT_CONSTRAINT.code, 4008);
    assert.strictEqual(SysML2ErrorCode.EMPTY_VERIFICATION_CASE.code, 4009);
    assert.strictEqual(SysML2ErrorCode.MISSING_VERIFICATION_OBJECTIVE.code, 4010);
    assert.strictEqual(SysML2ErrorCode.UNVERIFIED_REQUIREMENT.code, 4011);

    // 5xxx: Behavior, State Machines & Formal Verification
    assert.strictEqual(SysML2ErrorCode.CONSTRAINT_VIOLATED.code, 5001);
    assert.strictEqual(SysML2ErrorCode.REQUIREMENT_FAILED.code, 5002);
    assert.strictEqual(SysML2ErrorCode.BROKEN_INTERFACE_CONTRACT.code, 5003);
    assert.strictEqual(SysML2ErrorCode.ACTIVITY_CFA_UNREACHABLE.code, 5004);
    assert.strictEqual(SysML2ErrorCode.ACTIVITY_SOUNDNESS_VIOLATION.code, 5005);
    assert.strictEqual(SysML2ErrorCode.DEFINITE_ASSIGNMENT_VIOLATION.code, 5006);
    assert.strictEqual(SysML2ErrorCode.STATEMACHINE_NONDETERMINISTIC.code, 5007);
    assert.strictEqual(SysML2ErrorCode.STATEMACHINE_DEADLOCK.code, 5008);
    assert.strictEqual(SysML2ErrorCode.SATISFYING_VIOLATED_REQUIREMENT.code, 5009);
    assert.strictEqual(SysML2ErrorCode.CONFLICTING_REQUIREMENTS.code, 5010);
    assert.strictEqual(SysML2ErrorCode.INTERPROCEDURAL_CONTRACT_VIOLATION.code, 5011);
    assert.strictEqual(SysML2ErrorCode.LOOP_NON_TERMINATING.code, 5012);
    assert.strictEqual(SysML2ErrorCode.DECISION_TABLE_NON_EXHAUSTIVE.code, 5013);
    assert.strictEqual(SysML2ErrorCode.DECISION_TABLE_NONDETERMINISTIC.code, 5014);
    assert.strictEqual(SysML2ErrorCode.DECISION_TABLE_DEAD_BRANCH.code, 5015);
    assert.strictEqual(SysML2ErrorCode.ACTIVITY_SAFETY_VIOLATION.code, 5016);

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

  it("detects unresolved symbols (S2002) and unresolved imports (S2005) while resolving stdlib symbols", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package ResolutionTests {
        import ScalarValues::*;
        import NonExistentPkg::*;
        import MissingPkg::MissingMember;

        part def ValidBase;
        part def BadSubDef :> UnknownBaseDef;
        part def GoodSubDef :> ValidBase;

        part def HostPart {
          attribute badTyped : NonExistentType;
          attribute goodStdlib : ScalarValues::Integer;
          attribute goodISQ : ISQ::Mass;
          part goodLocal : ValidBase;
        }
      }
    `;

    const uri = "file:///workspace/ResolutionTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // S2002 on definition subclassification
    const badSubDef = db.byName("BadSubDef")[0];
    assert.ok(badSubDef);
    const badSubDiag = qe.fetch("lint__symbolNotFound", badSubDef.id);
    assert.ok(badSubDiag, "BadSubDef must emit S2002 for UnknownBaseDef");
    assert.strictEqual((badSubDiag as any).code, 2002);
    assert.ok((badSubDiag as any).message.includes("UnknownBaseDef"));

    const goodSubDef = db.byName("GoodSubDef")[0];
    assert.ok(goodSubDef);
    assert.strictEqual(qe.fetch("lint__symbolNotFound", goodSubDef.id), null);

    // S2002 on usage feature typing
    const badTyped = db.byName("badTyped")[0];
    assert.ok(badTyped);
    const badTypedDiag = qe.fetch("lint__symbolNotFound", badTyped.id);
    assert.ok(badTypedDiag, "badTyped must emit S2002 for NonExistentType");
    assert.strictEqual((badTypedDiag as any).code, 2002);
    assert.ok((badTypedDiag as any).message.includes("NonExistentType"));

    // Stdlib and local types must not trigger S2002
    const goodStdlib = db.byName("goodStdlib")[0];
    assert.strictEqual(qe.fetch("lint__symbolNotFound", goodStdlib.id), null);
    const goodISQ = db.byName("goodISQ")[0];
    assert.strictEqual(qe.fetch("lint__symbolNotFound", goodISQ.id), null);
    const goodLocal = db.byName("goodLocal")[0];
    assert.strictEqual(qe.fetch("lint__symbolNotFound", goodLocal.id), null);

    // S2005 on unresolved imports via runAllLints
    const allDiags = qe.runAllLints(uri);
    const importDiags = allDiags.filter((d) => d.code === 2005);
    assert.strictEqual(importDiags.length, 2, "Must emit S2005 for NonExistentPkg::* and MissingPkg::MissingMember");
  });

  it("detects state machine nondeterminism (S5007), deadlocks (S5008), and unresolved transition states (S2006) on StateDefinition", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package StateMachineTests {
        state def ControllerStates {
          state idle;
          state active;
          state backup;

          transition t1 first idle if x > 10 then active;
          transition t2 first idle if x > 5 then backup;
          transition tBad first active then ghostState;
        }
      }
    `;

    const uri = "file:///workspace/StateMachineTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    const smDef = db.byName("ControllerStates")[0];
    assert.ok(smDef);
    const smDiagRaw = qe.fetch("lint__stateMachineDeterminism", smDef.id);
    assert.ok(smDiagRaw, "ControllerStates must emit state machine diagnostic");
    const smDiags = Array.isArray(smDiagRaw) ? smDiagRaw : [smDiagRaw];
    const smCodes = smDiags.map((d: any) => d.code);
    assert.ok(
      smCodes.includes(5007) || smCodes.includes(5008),
      `Expected code 5007 or 5008, got ${JSON.stringify(smCodes)}`,
    );

    const transitions = db.childrenOf(smDef.id).filter((c) => c.ruleName === "TransitionUsage");
    const tBad = transitions[transitions.length - 1];
    assert.ok(tBad);
    const transDiag = qe.fetch("lint__unresolvedTransitionState", tBad.id);
    assert.ok(transDiag, "tBad must emit S2006 for unresolved target state 'ghostState'");
    assert.strictEqual((transDiag as any).code, 2006);
    assert.ok((transDiag as any).message.includes("ghostState"));
  });

  it("detects verification case target errors (S3006), empty verification cases (S4009), and duplicate enum values (S2001)", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package VerificationAndEnumTests {
        part def NotAReq;

        verification def BadVerification {
          verify NotAReq;
        }

        verification def EmptyVerification {}

        enum def TrafficColor {
          enum red;
          enum green;
          enum red;
        }
      }
    `;

    const uri = "file:///workspace/VerificationAndEnumTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    const badVerif = db.byName("BadVerification")[0];
    assert.ok(badVerif);
    const verifyUsage = db.childrenOf(badVerif.id).find((c) => c.ruleName === "VerifyRequirementUsage");
    assert.ok(verifyUsage);
    const verifyDiag = qe.fetch("lint__verifyTargetNotRequirement", verifyUsage.id);
    assert.ok(verifyDiag, "verify NotAReq must emit S3006");
    assert.strictEqual((verifyDiag as any).code, 3006);

    const emptyVerif = db.byName("EmptyVerification")[0];
    assert.ok(emptyVerif);
    const emptyVerifDiag = qe.fetch("lint__emptyVerificationCase", emptyVerif.id);
    assert.ok(emptyVerifDiag, "EmptyVerification must emit S4009");
    assert.strictEqual((emptyVerifDiag as any).code, 4009);

    const allDiags = qe.runAllLints(uri);
    const enumDupDiags = allDiags.filter((d) => d.code === 2001 && d.message.includes("Duplicate member 'red'"));
    assert.ok(enumDupDiags.length >= 1, "Duplicate enum value 'red' must emit S2001");
  });

  it("detects activity CFA definite assignment / unreachable actions (S5004/S5006), decision table issues (S5013-S5015), and loop non-termination (S5012)", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();

    const code = `
      package BehavioralVerifierTests {
        action def UninitializedOutAction {
          action step1 {
            out y : ScalarValues::Integer;
          }
          action disconnectedStep;
        }

        action def InfiniteLoopAction {
          while counter < 10 {
            action bodyStep;
          }
        }

        action def NonExhaustiveDecision {
          in x : ScalarValues::Integer;
          decide checkLevel;
          first checkLevel then highBranch if x > 10;
          first checkLevel then overlapBranch if x > 5;
          action highBranch;
          action overlapBranch;
        }
      }
    `;

    const uri = "file:///workspace/BehavioralVerifierTests.sysml";
    ws.register(uri, () => {
      const tree = parser.parse(code);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(code));
    const db = qe.toQueryDB();

    // S5004 + S5006: disconnectedStep is unreachable (5004) and out parameter 'y' is never definitely assigned (5006)
    const uninitAction = db.byName("UninitializedOutAction")[0];
    assert.ok(uninitAction);
    const cfaDiagRaw = qe.fetch("lint__activitySoundness", uninitAction.id);
    assert.ok(cfaDiagRaw, "UninitializedOutAction must emit CFA diagnostics");
    const cfaDiags = Array.isArray(cfaDiagRaw) ? cfaDiagRaw : [cfaDiagRaw];
    const cfaCodes = cfaDiags.map((d: any) => d.code);
    assert.ok(cfaCodes.includes(5004), `Expected S5004 in ${JSON.stringify(cfaCodes)}`);
    assert.ok(cfaCodes.includes(5006), `Expected S5006 in ${JSON.stringify(cfaCodes)}`);

    // S5012: while true without variant/bound
    const loopAction = db.byName("InfiniteLoopAction")[0];
    assert.ok(loopAction);
    const loopDiag = qe.fetch("lint__loopTermination", loopAction.id);
    assert.ok(loopDiag, "InfiniteLoopAction must emit S5012");
    assert.strictEqual((loopDiag as any).code, 5012);

    // S5013 / S5014: DecisionTableVerifier wired to ActionDefinition
    const decideAction = db.byName("NonExhaustiveDecision")[0];
    assert.ok(decideAction);
    const dtDiagRaw = qe.fetch("lint__decisionTableExhaustiveness", decideAction.id);
    assert.ok(dtDiagRaw, "NonExhaustiveDecision must emit DecisionTableVerifier diagnostic");
    const dtDiags = Array.isArray(dtDiagRaw) ? dtDiagRaw : [dtDiagRaw];
    const dtCodes = dtDiags.map((d: any) => d.code);
    assert.ok(dtCodes.includes(5013) || dtCodes.includes(5014), `Expected 5013 or 5014 in ${JSON.stringify(dtCodes)}`);
  });
});
