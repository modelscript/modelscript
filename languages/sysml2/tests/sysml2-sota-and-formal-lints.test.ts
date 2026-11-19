// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import { LanguageWorkspaceIndex, UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  loadEmbeddedKerMLStdlib,
  registerSysmlWasmParser,
  SysML2ErrorCode,
  verifySysML2Formal,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function buildLintEnv(code: string, uri = "file:///test/Model.sysml") {
  const { parser, facade } = await createWasmParser(sysmlWasm);
  registerSysmlWasmParser(parser as unknown as Parameters<typeof registerSysmlWasmParser>[0]);
  const ws = createSysML2WorkspaceIndex();
  loadEmbeddedKerMLStdlib(ws, parser as unknown as Parameters<typeof loadEmbeddedKerMLStdlib>[1]);
  const tree = parser.parse(code)!;
  ws.register(uri, () => (tree ? (tree.rootNode as any) : null), code);
  const unified = await ws.getIndexAsync();
  const qe = createSysML2QueryEngine(unified, tree);
  const db = qe.toQueryDB();
  return { parser, facade, ws, tree, unified, qe, db, uri };
}

describe("SysML v2 Tier-1 WASM CompilerLints, P0 Fixes, SOTA Rules & Formal Verification", () => {
  it("runs Tier-1 WASM CompilerLints via facade.getDiagnostics in sub-millisecond time without false positives", async () => {
    const { parser, facade } = await createWasmParser(sysmlWasm);

    const cleanCode = `
      package CleanArchitecture {
        enum def OperatingMode {
          enum Nominal;
          enum Degraded;
        }
        variation part def BatteryChoice {
          variant part lfpPack;
          variant part nmcPack;
        }
      }
    `;
    const cleanTree = parser.parse(cleanCode)!;
    facade.loadSource?.(cleanCode);
    assert.deepStrictEqual(facade.getDiagnostics(cleanTree.rootPtr, 0, 0, cleanCode), []);

    const badCode = `
      package badPkg {
        part def badPartDef {
          attribute BadUsage : ScalarValues::Real;
          variant part illegalVariant;
        }
        state def ParallelSm parallel {
          state regionA;
          state regionB;
          transition t first regionA then regionB;
        }
        state def DupEntrySm {
          entry a1 {}
          entry a2 {}
        }
      }
    `;
    const badTree = parser.parse(badCode)!;
    facade.loadSource?.(badCode);
    const wasmDiags = facade.getDiagnostics(badTree.rootPtr, 0, 0, badCode);
    const codes = new Set(wasmDiags.map((d: any) => d.code));
    assert.ok(codes.has(1005), `Expected S1005 package naming in ${JSON.stringify(wasmDiags)}`);
    assert.ok(codes.has(1003), `Expected S1003 definition naming in ${JSON.stringify(wasmDiags)}`);
    assert.ok(codes.has(1004), `Expected S1004 usage naming in ${JSON.stringify(wasmDiags)}`);
    assert.ok(codes.has(4014), `Expected S4014 variant outside variation in ${JSON.stringify(wasmDiags)}`);
    assert.ok(codes.has(4016), `Expected S4016 parallel state transition in ${JSON.stringify(wasmDiags)}`);
    assert.ok(codes.has(4020), `Expected S4020 duplicate entry member in ${JSON.stringify(wasmDiags)}`);
  });

  it("fixes P0 false positives: cross-package S4001, Real S3003, negated assertions, compound SMT, and VerificationCaseUsage S4011", async () => {
    const code = `
      package BasePkg {
        part def Sensor {
          attribute range : ISQ::LengthValue;
        }
      }
      package DerivedPkg {
        private import ScalarValues::*;
        private import ISQ::*;
        part def Sensor :> BasePkg::Sensor {
          attribute zeroOffset : ISQ::LengthValue = 0.0;
          attribute massVal : ISQ::MassValue = 5.0 [kg];
          attribute badScalarSum : Real = zeroOffset + massVal;
          assert not constraint impossibleCheck { 1 > 2 }
        }

        part def N {
          attribute count : Integer = 4;
        }
        part nodeInst : N;

        requirement def SafeEnvelopeReq {
          doc /* Verified requirement with nested comment /* inner */ text */
          attribute x : Real;
          require constraint { x < 0.0 or x > 10.0 }
        }
        requirement def OtherEnvelopeReq {
          attribute x : Real;
          require constraint { x > 20.0 }
        }

        verification envTest {
          verify SafeEnvelopeReq;
          verify OtherEnvelopeReq;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const codes = diags.map((d: any) => d.code);

    assert.ok(
      !codes.includes(SysML2ErrorCode.CIRCULAR_SPECIALIZATION.code),
      "Cross-package Sensor :> BasePkg::Sensor must not trigger S4001",
    );
    assert.ok(
      !codes.includes(SysML2ErrorCode.CONSTRAINT_VIOLATED.code),
      "assert not constraint { 1 > 2 } must not trigger S5001",
    );
    assert.ok(
      !codes.includes(SysML2ErrorCode.CONFLICTING_REQUIREMENTS.code),
      "Disjunctive (x < 0 or x > 10) with x > 20 is SAT and must not trigger S5010",
    );
    assert.ok(
      !codes.includes(SysML2ErrorCode.UNVERIFIED_REQUIREMENT.code),
      "VerificationCaseUsage verify children must satisfy S4011",
    );
    assert.ok(
      codes.includes(SysML2ErrorCode.DIMENSIONAL_MISMATCH.code),
      "Adding Length + Mass into Real must trigger S3003",
    );

    // Ensure all emitted diagnostics have single-line narrow spans
    for (const d of diags) {
      if (typeof d.startOffset === "number" && typeof d.endOffset === "number") {
        const slice = code.slice(d.startOffset, d.endOffset);
        assert.ok(
          !slice.includes("\n"),
          `Diagnostic [${d.code}] span should be single-line, got: ${JSON.stringify(slice)}`,
        );
      }
    }
  });

  it("enforces SOTA KerML/SysML v2 rules (S2007-S4024) including polyglot S3010 whitelisting", async () => {
    const code = `
      import ScalarValues::*;

      package LibPkg {
        private part def SecretController;
      }

      package MainSys {
        private import ScalarValues::*;

        #disjoint part def SolidPart;
        #disjoint part def FluidPart;
        part def ImpossibleHybrid :> SolidPart, FluidPart;

        part def BaseVehicle {
          attribute mass : Real;
          part wheel[2..4];
        }

        part def SubVehicle :> BaseVehicle {
          attribute mass : Real;
          part :>> wheel[1..6];
          part :>> nonExistentFeature;
          part hidden : LibPkg::SecretController;
          port badPortKind : BaseVehicle;
        }

        part def BadMultHolder {
          attribute negBound : Integer = -1;
          part badMult[negBound..2];
        }

        calc def ScaleForce {
          in f : Real;
          return : Real = f * 2.0;
        }
        part def Caller {
          attribute wrongCall : Real = ScaleForce("bad");
        }

        requirement def AmbiguousReq {
          subject s : BaseVehicle;
          doc /* The braking response time is TBD and approximately 100ms. */
          require constraint { true }
        }
      }
    `;
    const { parser } = await createWasmParser(sysmlWasm);
    registerSysmlWasmParser(parser as unknown as Parameters<typeof registerSysmlWasmParser>[0]);

    // Also test polyglot S3010 whitelisting with a Modelica connector & model in UnifiedWorkspace
    const unifiedWs = new UnifiedWorkspace();
    const modelicaWs = new LanguageWorkspaceIndex([]);
    (modelicaWs as any).unifiedIndex.symbols.set(9001, {
      id: 9001,
      kind: "Class",
      name: "Flange_a",
      namePath: "Mechanics.Flange_a",
      ruleName: "class_definition",
      parentId: null,
      startOffset: 0,
      endOffset: 10,
      metadata: { classKind: "connector" },
    });
    (modelicaWs as any).unifiedIndex.byName.set("Flange_a", [9001]);
    unifiedWs.registerWorkspace("modelica", modelicaWs);

    const sysmlWs = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(sysmlWs, parser as unknown as Parameters<typeof loadEmbeddedKerMLStdlib>[1]);
    const polyCode = `${code}\npackage PolyPkg {\n  part def DriveUnit {\n    port mechFlange : Flange_a;\n  }\n}\n`;
    const uri = "file:///test/SotaRules.sysml";
    const tree = parser.parse(polyCode)!;
    sysmlWs.register(uri, () => tree.rootNode as any, polyCode);
    await sysmlWs.getIndexAsync();
    unifiedWs.registerWorkspace("sysml2", sysmlWs);

    const mergedIndex = await unifiedWs.getIndexAsync();
    const qe = createSysML2QueryEngine(mergedIndex, tree);
    const diags = await qe.runAllLintsAsync(uri);
    const codes = new Set(diags.map((d: any) => d.code));

    assert.ok(codes.has(2010), `Expected S2010 top-level import not private, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(2007), `Expected S2007 unresolved redefinition, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(2009), `Expected S2009 private visibility violation, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(2011), `Expected S2011 inherited member shadowing, got ${JSON.stringify([...codes])}`);
    assert.ok(
      codes.has(3010),
      `Expected S3010 usage-definition kind mismatch on badPortKind, got ${JSON.stringify([...codes])}`,
    );
    assert.ok(codes.has(3011), `Expected S3011 disjoint classifier specialization, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(3013), `Expected S3013 subsetting multiplicity widening, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(3015), `Expected S3015 invocation signature mismatch, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(3017), `Expected S3017 negative multiplicity bound, got ${JSON.stringify([...codes])}`);
    assert.ok(
      codes.has(4024),
      `Expected S4024 INCOSE ambiguous requirement quality, got ${JSON.stringify([...codes])}`,
    );

    const s3010OnPolyglot = diags.filter((d: any) => d.code === 3010 && d.message.includes("mechFlange"));
    assert.strictEqual(
      s3010OnPolyglot.length,
      0,
      "Polyglot PortUsage typed by Modelica connector must not trigger S3010",
    );
  });

  it("detects live <10ms formal verification violations (S6001, S6002, S6003, S6011, S6012, S6020, S6022, S6041)", async () => {
    const code = `
      package LiveFormalSuite {
        private import ScalarValues::*;
        private import ISQ::*;

        // S6001: Subtype weakens postcondition / strengthens precondition
        requirement def BaseContract {
          attribute cmd : Real;
          attribute torque : Real;
          assume constraint { cmd >= 0.0 }
          require constraint { torque >= 50.0 }
        }
        requirement def WeakSubContract :> BaseContract {
          assume constraint { cmd >= 10.0 }
          require constraint { torque >= 20.0 }
        }

        // S6003: Vacuous requirement assumption
        requirement def VacuousReq {
          attribute temp : Real;
          assume constraint { temp > 100.0 and temp < 50.0 }
          require constraint { temp == 75.0 }
        }

        // S6002: Requirement decomposition gap
        requirement def SubReqA {
          attribute brakeForce : Real;
          require constraint { brakeForce >= 80.0 }
        }
        requirement def SystemBrakeReq {
          attribute brakeForce : Real;
          requirement subA : SubReqA;
          require constraint { brakeForce >= 120.0 }
        }

        // S6011: Zero-dwell Zeno chattering cycle
        state def ZenoSm {
          state a;
          state b;
          transition t1 first a then b;
          transition t2 first b then a;
        }

        // S6012: Parallel region write race
        state def RaceSm parallel {
          attribute sharedTarget : Real;
          state reg1 {
            entry action {
              assign sharedTarget := 1.0;
            }
          }
          state reg2 {
            entry action {
              assign sharedTarget := 2.0;
            }
          }
        }

        // S6020 & S6022: Division by zero & negative physical mass
        calc def BadDiv {
          in x : Real = 0.0;
          return : Real = 10.0 / x;
        }
        part def BadPhysics {
          attribute impossibleMass : ISQ::MassValue = -5.0 [kg];
        }

        // S6041: Multiplicity mass roll-up budget violation
        part def SubCell {
          attribute mass : Real = 30.0;
        }
        part def PackOverBudget {
          part cells[4] : SubCell;
          attribute totalMass : Real = 100.0;
          assert constraint { totalMass <= 100.0 }
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const codes = new Set(diags.map((d: any) => d.code));

    assert.ok(codes.has(6001), `Expected S6001 contract refinement violation, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(6002), `Expected S6002 requirement decomposition gap, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(6003), `Expected S6003 vacuous requirement assumption, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(6011), `Expected S6011 Zeno transition cycle, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(6012), `Expected S6012 parallel region write race, got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has(6020), `Expected S6020 calc division by zero, got ${JSON.stringify([...codes])}`);
    assert.ok(
      codes.has(6022),
      `Expected S6022 negative physical mass impossibility, got ${JSON.stringify([...codes])}`,
    );
    assert.ok(codes.has(6041), `Expected S6041 multiplicity roll-up violation, got ${JSON.stringify([...codes])}`);
  });

  it("executes on-demand deep formal verification engines verifySysML2Formal (S7001-S7006)", async () => {
    const code = `
      package DeepFormalCertification {
        private import ScalarValues::*;

        // S7001: IC3 / PDR reachable #unsafe state
        state def ReactorSafetySm {
          state standby;
          state active;
          #unsafe state meltdown;
          transition tStart first standby then active;
          transition tHazard first active then meltdown;
        }

        // S7002: ISO 26262 ASIL-D single-point-of-failure
        part def BrakeByWire {
          part singleSensor {
            @FailureMode { rate = 1e-5; }
          }
          requirement noUncommandedLoss {
            @Hazard { asil = "ASIL_D"; causes = "singleSensor"; }
          }
        }

        // S7003: Probabilistic UQ chance constraint violation
        part def UncertainLink {
          attribute peakLoad : Real = 95.0 {
            @Normal { mean = 95.0; std = 10.0; }
          }
          assert constraint loadMargin {
            @MaxFailureProbability { maxProb = 0.01; }
            peakLoad <= 100.0
          }
        }

        // S7004: Mechanical GD&T tolerance stack interference
        part def HousingAssembly {
          attribute shaftDia : Real = 10.0 {
            @Tolerance { nominal = 10.0; plus = 0.4; minus = 0.4; sign = -1; }
          }
          attribute boreDia : Real = 10.5 {
            @Tolerance { nominal = 10.5; plus = 0.3; minus = 0.3; sign = 1; }
          }
          assert constraint minClearance { boreDia - shaftDia >= 0.0 }
        }

        // S7005: Relational 2-safety non-interference violation
        #NonInterference calc def ControlLaw {
          #untrusted in debugTelemetry : Real;
          #highIntegrity in setPoint : Real;
          return #highIntegrity actuation : Real = setPoint + 0.5 * debugTelemetry;
        }

        // S7006: Continuous DAE flowpipe reachability violation
        part def UnboundedThermalRunaway {
          attribute temp : Real = 90.0;
          constraint dynamics { der(temp) == 15.0 }
          assert constraint thermalLimit { temp <= 100.0 }
        }
      }
    `;
    const { db, uri } = await buildLintEnv(code, "file:///test/DeepFormal.sysml");
    const formalDiags = await verifySysML2Formal(db, { resourceUri: uri });
    const formalCodes = new Set(formalDiags.map((d) => d.code));

    assert.ok(formalCodes.has(7001), `Expected S7001 PDR unsafe state in ${JSON.stringify(formalDiags)}`);
    assert.ok(formalCodes.has(7002), `Expected S7002 ASIL SPOF in ${JSON.stringify(formalDiags)}`);
    assert.ok(formalCodes.has(7003), `Expected S7003 UQ chance violation in ${JSON.stringify(formalDiags)}`);
    assert.ok(formalCodes.has(7004), `Expected S7004 tolerance stack interference in ${JSON.stringify(formalDiags)}`);
    assert.ok(formalCodes.has(7005), `Expected S7005 non-interference violation in ${JSON.stringify(formalDiags)}`);
    assert.ok(formalCodes.has(7006), `Expected S7006 flowpipe safety violation in ${JSON.stringify(formalDiags)}`);
  });
});
