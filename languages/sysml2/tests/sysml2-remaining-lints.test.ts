// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  getSysML2ErrorCodeDef,
  loadEmbeddedKerMLStdlib,
  registerSysmlWasmParser,
  SysML2ErrorCode,
  verifyHighIndexParametricDae,
  verifySpatialEnvelopesFormal,
  verifySysML2Formal,
  verifySysML2FormalSync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function buildLintEnv(code: string, uri = "file:///test/RemainingLints.sysml") {
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

describe("SysML v2 Remaining SOTA & Formal Verification Lints (S2012, S3018, S4025, S4026, S6004, S6021, S6031, S6032, S6033, S6042)", () => {
  it("registers all 9 new error codes in SysML2ErrorCode and getSysML2ErrorCodeDef", () => {
    const expected = [
      { key: "UNUSED_IMPORT_OR_PRIVATE_MEMBER", code: 2012, rule: "unused-import-or-private-member", severity: "info" },
      { key: "INVALID_CAST_OR_TYPE_TEST", code: 3018, rule: "invalid-cast-or-type-test", severity: "warning" },
      { key: "INDIVIDUAL_OR_PORTION_MISUSE", code: 4025, rule: "individual-or-portion-misuse", severity: "error" },
      { key: "METADATA_ANNOTATION_INVALID", code: 4026, rule: "metadata-annotation-invalid", severity: "error" },
      {
        key: "OPAQUE_INTERFACE_INCOMPATIBILITY",
        code: 6004,
        rule: "opaque-interface-incompatibility",
        severity: "error",
      },
      { key: "SEQUENCE_INDEX_OUT_OF_BOUNDS", code: 6021, rule: "sequence-index-out-of-bounds", severity: "error" },
      {
        key: "HIGH_INDEX_PARAMETRIC_CONSTRAINT",
        code: 6031,
        rule: "high-index-parametric-constraint",
        severity: "warning",
      },
      {
        key: "CYBER_PHYSICAL_NYQUIST_VIOLATION",
        code: 6033,
        rule: "cyber-physical-nyquist-violation",
        severity: "warning",
      },
      {
        key: "SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION",
        code: 6042,
        rule: "spatial-envelope-clash-or-protrusion",
        severity: "warning",
      },
    ] as const;

    for (const item of expected) {
      const def = SysML2ErrorCode[item.key];
      assert.strictEqual(def.code, item.code);
      assert.strictEqual(def.rule, item.rule);
      assert.strictEqual(def.severity, item.severity);
      assert.strictEqual(getSysML2ErrorCodeDef(item.code)?.rule, item.rule);
      assert.strictEqual(getSysML2ErrorCodeDef(`S${item.code}`)?.code, item.code);
      assert.strictEqual(getSysML2ErrorCodeDef(item.rule)?.code, item.code);
    }
  });

  it("S2012: flags unused user package imports and unused private members without flagging stdlib or referenced symbols", async () => {
    const code = `
      package UnusedLib {
        part def UnusedWidget {
          attribute rating : ScalarValues::Real;
        }
      }
      package UsedLib {
        part def ActiveSensor {
          attribute gain : ScalarValues::Real;
        }
      }
      package SystemPkg {
        private import ScalarValues::*;
        private import ISQ::*;
        private import UnusedLib::*;
        private import UsedLib::*;

        private part def DeadHelper {
          attribute v : Real;
        }
        private part def LiveHelper {
          attribute v : Real;
        }

        part def Controller {
          private attribute secretUnused : Real = 1.0;
          private attribute secretUsed : Real = 2.0;
          attribute doubled : Real = secretUsed * 2.0;
          part sensor : ActiveSensor;
          part helper : LiveHelper;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const s2012 = diags.filter((d: any) => d.code === 2012);
    const messages = s2012.map((d: any) => d.message);

    assert.ok(
      messages.some((m: string) => m.includes("UnusedLib::*")),
      `Expected unused import UnusedLib::*, got ${JSON.stringify(messages)}`,
    );
    assert.ok(
      messages.some((m: string) => m.includes("DeadHelper")),
      `Expected unused private DeadHelper, got ${JSON.stringify(messages)}`,
    );
    assert.ok(
      messages.some((m: string) => m.includes("secretUnused")),
      `Expected unused private secretUnused, got ${JSON.stringify(messages)}`,
    );
    assert.ok(!messages.some((m: string) => m.includes("ScalarValues")), "Must not flag stdlib ScalarValues import");
    assert.ok(!messages.some((m: string) => m.includes("ISQ")), "Must not flag stdlib ISQ import");
    assert.ok(!messages.some((m: string) => m.includes("UsedLib")), "Must not flag used package import UsedLib");
    assert.ok(!messages.some((m: string) => m.includes("LiveHelper")), "Must not flag referenced private LiveHelper");
    assert.ok(!messages.some((m: string) => m.includes("secretUsed")), "Must not flag referenced private secretUsed");
  });

  it("S3018: flags disjoint casts and classification tests while allowing valid upcasts/downcasts", async () => {
    const code = `
      package TypeCastSuite {
        private import ScalarValues::*;

        #disjoint part def SolidChassis {
          attribute mass : Real;
        }
        #disjoint part def FluidCoolant {
          attribute viscosity : Real;
        }
        part def HeavyChassis :> SolidChassis {
          attribute armor : Real;
        }
        action def ComputeTrajectory {
          in dt : Real;
        }

        part def Inspector {
          attribute flag : Boolean = true;
          attribute count : Integer = 3;
          part chassis : SolidChassis;
          part heavy : HeavyChassis;

          // Disjoint casts / type tests (should trigger S3018)
          attribute badBoolCast : Real = flag as Real;
          attribute badPartStringTest : Boolean = chassis hastype String;
          attribute badPartActionTest : Boolean = chassis istype ComputeTrajectory;
          attribute badDisjointTest : Boolean = chassis hastype FluidCoolant;

          // Valid casts / type tests (must NOT trigger S3018)
          attribute okNumericCast : Real = count as Real;
          attribute okDowncastTest : Boolean = chassis hastype HeavyChassis;
          attribute okUpcastTest : Boolean = heavy istype SolidChassis;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const s3018 = diags.filter((d: any) => d.code === 3018);
    assert.strictEqual(s3018.length, 4, `Expected exactly 4 S3018 diagnostics, got ${JSON.stringify(s3018)}`);
  });

  it("S4025: enforces individual uniqueness, variation incompatibility, and snapshot/timeslice ownership & immutability", async () => {
    const badCode = `
      package PortionSuite {
        private import ScalarValues::*;

        individual part def EarthOrbit {
          attribute altitude : Real;
        }
        individual part def MarsOrbit {
          attribute altitude : Real;
        }

        variation individual part def BadVarInd {
          variant part optA;
        }

        attribute def BadAttrContainer {
          snapshot illegalSnap;
        }

        part def Spacecraft {
          individual part impossibleDual : EarthOrbit, MarsOrbit;
          timeslice badMutableSlice := EarthOrbit;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(badCode);
    const diags = await qe.runAllLintsAsync(uri);
    const s4025 = diags.filter((d: any) => d.code === 4025);
    assert.ok(s4025.length >= 4, `Expected >= 4 S4025 errors, got ${JSON.stringify(s4025)}`);

    const cleanCode = `
      package CleanPortionSuite {
        private import ScalarValues::*;

        individual part def EarthInstance {
          attribute radius : Real = 6371.0;
        }
        part defBooster {
          attribute thrust : Real = 1000.0;
        }
        part def MissionVehicle {
          individual part homeWorld : EarthInstance;
          snapshot liftoffState;
          timeslice ascentWindow;
        }
      }
    `;
    const cleanEnv = await buildLintEnv(cleanCode, "file:///test/CleanPortions.sysml");
    const cleanDiags = await cleanEnv.qe.runAllLintsAsync(cleanEnv.uri);
    assert.strictEqual(
      cleanDiags.filter((d: any) => d.code === 4025).length,
      0,
      `Expected 0 S4025 errors on clean model, got ${JSON.stringify(cleanDiags)}`,
    );
  });

  it("S4026: validates user-defined @Metadata and #Metadata annotations and redefined metadata fields", async () => {
    const code = `
      package MetadataValidationSuite {
        private import ScalarValues::*;

        metadata def SafetyProfile {
          attribute sil : Integer;
          attribute reviewer : String;
        }

        part def PlainActuator {
          attribute force : Real;
        }

        // Invalid: @PlainActuator and #PlainActuator resolve to PartDefinition, not MetadataDefinition
        #PlainActuator part def WrongPrefixTarget {
          attribute x : Real;
        }

        part def WrongAtTarget {
          @PlainActuator;
          attribute x : Real;
        }

        // Invalid: unknownField does not exist on SafetyProfile
        part def WrongFieldTarget {
          @SafetyProfile {
            sil = 3;
            nonExistentField = 42;
          }
          attribute x : Real;
        }

        // Valid: proper @SafetyProfile fields and built-in convention tags (#unsafe, #disjoint)
        #disjoint part def ValidAnnotatedPart {
          @SafetyProfile {
            sil = 4;
            reviewer = "alice";
          }
          attribute x : Real;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const s4026 = diags.filter((d: any) => d.code === 4026);
    const msgs = s4026.map((d: any) => d.message);

    assert.strictEqual(s4026.length, 3, `Expected 3 S4026 errors, got ${JSON.stringify(s4026)}`);
    assert.ok(msgs.some((m: string) => m.includes("#PlainActuator")));
    assert.ok(msgs.some((m: string) => m.includes("@PlainActuator")));
    assert.ok(msgs.some((m: string) => m.includes("nonExistentField")));
  });

  it("S6004: detects opaque port interface contract incompatibility with Craig interpolation", async () => {
    const code = `
      package OpaqueInterfaceSuite {
        private import ScalarValues::*;

        port def DcPowerPort {
          attribute voltage : Real;
          attribute current : Real;
        }

        part def HvSource {
          port pOut : DcPowerPort {
            assert constraint { voltage >= 48.0 }
          }
        }

        part def LvAvionics {
          port pIn : ~DcPowerPort {
            assert constraint { voltage <= 28.0 }
          }
        }

        part def CompatibleLoad {
          port pIn : ~DcPowerPort {
            assert constraint { voltage >= 36.0 and voltage <= 60.0 }
          }
        }

        part def BadPowerBus {
          part src : HvSource;
          part sink : LvAvionics;
          connect src.pOut to sink.pIn;
        }

        part def GoodPowerBus {
          part src : HvSource;
          part sink : CompatibleLoad;
          connect src.pOut to sink.pIn;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const s6004 = diags.filter((d: any) => d.code === 6004);

    assert.strictEqual(s6004.length, 1, `Expected 1 S6004 error on BadPowerBus, got ${JSON.stringify(s6004)}`);
    assert.ok(
      s6004[0]!.message.includes("Craig interpolant"),
      `Expected Craig interpolant explanation in: ${s6004[0]!.message}`,
    );
    assert.ok(s6004[0]!.message.includes("voltage"), `Expected shared feature 'voltage' in: ${s6004[0]!.message}`);
  });

  it("S6021: detects 1-based KerML sequence indexing out-of-bounds (0, negative, and > upper)", async () => {
    const code = `
      package SequenceBoundsSuite {
        private import ScalarValues::*;

        part def CellModule {
          attribute v : Real = 3.7;
        }

        part def BatteryArray {
          part cells[4] : CellModule;
          attribute zeroIdx : CellModule = cells#(0);
          attribute overflowIdx : CellModule = cells#(5);
          attribute validFirst : CellModule = cells#(1);
          attribute validLast : CellModule = cells#(4);
        }

        calc def SelectOutOfRange {
          in idx : Integer;
          part items[3] : CellModule;
          assert constraint { idx >= 4 }
          return : CellModule = items#(idx);
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);
    const s6021 = diags.filter((d: any) => d.code === 6021);
    assert.strictEqual(s6021.length, 3, `Expected 3 S6021 errors (0, 5, idx>=4), got ${JSON.stringify(s6021)}`);
  });

  it("S6032 (Conservation) & S6033 (Nyquist): detects steady-state flow imbalance and slow discrete controller sampling", async () => {
    const code = `
      package FlowAndNyquistSuite {
        private import ScalarValues::*;

        // S6032 steady-state flow conservation violation on #conserved manifold
        #conserved part def LeakyManifold {
          in port inlet {
            attribute massFlow : Real = 12.0;
          }
          out port branchA {
            attribute massFlow : Real = 5.0;
          }
          out port branchB {
            attribute massFlow : Real = 4.0;
          }
        }

        // Clean conserved manifold (12 == 7 + 5)
        #conserved part def BalancedManifold {
          in port inlet {
            attribute massFlow : Real = 12.0;
          }
          out port branchA {
            attribute massFlow : Real = 7.0;
          }
          out port branchB {
            attribute massFlow : Real = 5.0;
          }
        }

        // S6033 Cyber-Physical Nyquist violation: 25 ms period (40 Hz) <= 2 * 30 Hz (60 Hz)
        part def SlowDigitalController {
          attribute samplePeriod : Real = 25.0 [ms];
        }
        part def FastDigitalController {
          attribute samplePeriod : Real = 2.0 [ms];
        }
        part def ServoActuatorPlant {
          attribute bandwidth : Real = 30.0 [Hz];
        }

        part def UnstableServoLoop {
          part ctrl : SlowDigitalController;
          part plant : ServoActuatorPlant;
        }

        part def StableServoLoop {
          part ctrl : FastDigitalController;
          part plant : ServoActuatorPlant;
        }
      }
    `;
    const { qe, uri } = await buildLintEnv(code);
    const diags = await qe.runAllLintsAsync(uri);

    const s6032 = diags.filter((d: any) => d.code === 6032);
    assert.strictEqual(
      s6032.length,
      1,
      `Expected 1 S6032 conservation error on LeakyManifold, got ${JSON.stringify(s6032)}`,
    );
    assert.ok(s6032[0]!.message.includes("LeakyManifold"));

    const s6033 = diags.filter((d: any) => d.code === 6033);
    assert.strictEqual(
      s6033.length,
      1,
      `Expected 1 S6033 Nyquist warning on UnstableServoLoop, got ${JSON.stringify(s6033)}`,
    );
    assert.ok(s6033[0]!.message.includes("40") && s6033[0]!.message.includes("60"));
  });

  it("S6042: detects 3D RCC-8 sibling AABB clashes, parent enclosure protrusions, and @MaxLength wire violations", async () => {
    const code = `
      package SpatialPackagingSuite {
        private import ScalarValues::*;

        port def SignalPort {
          attribute sig : Real;
        }

        part def AvionicsBay {
          @SpatialBox { x = 0.0; y = 0.0; z = 0.0; dx = 10.0; dy = 10.0; dz = 10.0; }

          part ecuA {
            @SpatialBox { x = 1.0; y = 1.0; z = 1.0; dx = 3.0; dy = 3.0; dz = 3.0; }
            port pOut : SignalPort;
          }
          // Overlaps ecuA in [2..4]x[2..4]x[2..4] (rcc:PO)
          part ecuB {
            @SpatialBox { x = 2.0; y = 2.0; z = 2.0; dx = 3.0; dy = 3.0; dz = 3.0; }
          }
          // Protrudes outside [0..10] bay (x + dx = 12.0 > 10.0) and center distance from ecuA > 4.0
          part remoteSensor {
            @SpatialBox { x = 8.0; y = 1.0; z = 1.0; dx = 4.0; dy = 2.0; dz = 2.0; }
            port pIn : ~SignalPort;
          }

          connection harness connect ecuA.pOut to remoteSensor.pIn {
            @MaxLength { max = 4.0; }
          }
        }

        part def CleanAvionicsBay {
          @SpatialBox { minX = 0.0; minY = 0.0; minZ = 0.0; maxX = 10.0; maxY = 10.0; maxZ = 10.0; }

          part unitA {
            @SpatialBox { x = 1.0; y = 1.0; z = 1.0; dx = 2.0; dy = 2.0; dz = 2.0; }
            port pOut : SignalPort;
          }
          // Externally touching face at x=3.0 (rcc:EC) -> zero interior volume overlap, valid!
          part unitB {
            @SpatialBox { x = 3.0; y = 1.0; z = 1.0; dx = 2.0; dy = 2.0; dz = 2.0; }
            port pIn : ~SignalPort;
          }

          connection shortHarness connect unitA.pOut to unitB.pIn {
            @MaxLength { max = 5.0; }
          }
        }
      }
    `;
    const { qe, db, uri } = await buildLintEnv(code);
    const liveDiags = await qe.runAllLintsAsync(uri);
    const s6042 = liveDiags.filter((d: any) => d.code === 6042);

    assert.strictEqual(
      s6042.length,
      3,
      `Expected 3 S6042 spatial warnings (clash, protrusion, maxLength), got ${JSON.stringify(s6042)}`,
    );
    assert.ok(s6042.some((d: any) => d.message.includes("protrudes")));
    assert.ok(s6042.some((d: any) => d.message.includes("clash")));
    assert.ok(s6042.some((d: any) => d.message.includes("maxLength")));

    const formalSpatial = verifySpatialEnvelopesFormal(db, { resourceUri: uri });
    assert.strictEqual(formalSpatial.length, 3);
  });

  it("S6031: detects high-index parametric DAEs via Pantelides / Pryce structural index analysis without flagging Index-1 ODEs/DAEs", async () => {
    const code = `
      package HighIndexDaeSuite {
        private import ScalarValues::*;

        // Index-3 Cartesian Pendulum DAE (should trigger S6031)
        part def CartesianPendulum {
          constant attribute L : Real = 1.0;
          constant attribute g : Real = 9.81;
          attribute x : Real = 1.0;
          attribute y : Real = 0.0;
          attribute vx : Real = 0.0;
          attribute vy : Real = 0.0;
          attribute tension : Real;

          constraint kinX { der(x) == vx }
          constraint kinY { der(y) == vy }
          constraint dynX { der(vx) == -tension * x }
          constraint dynY { der(vy) == -tension * y - g }
          constraint rodHolonomic { x * x + y * y == L * L }
        }

        // Index-2 Coupled State Algebraic Constraint (should trigger S6031)
        part def CoupledStateAlgebraic {
          attribute x : Real = 1.0;
          attribute y : Real = 2.0;
          attribute u : Real;
          constraint c1 { der(x) == 1.0 }
          constraint c2 { der(y) == u }
          constraint stateLink { y == 2.0 * x }
        }

        // Clean Index-1 Harmonic Oscillator ODE (must NOT trigger S6031)
        part def HarmonicOscillator {
          constant attribute k : Real = 10.0;
          attribute pos : Real = 1.0;
          attribute vel : Real = 0.0;
          constraint c1 { der(pos) == vel }
          constraint c2 { der(vel) == -k * pos }
        }

        // Clean Index-1 Semi-Explicit DAE (must NOT trigger S6031)
        part def SemiExplicitIndex1 {
          attribute stateX : Real = 1.0;
          attribute algY : Real;
          constraint diffEq { der(stateX) == -stateX + algY }
          constraint algEq { algY == 2.0 * stateX }
        }
      }
    `;
    const { db, uri } = await buildLintEnv(code, "file:///test/HighIndexDae.sysml");

    const directHi = verifyHighIndexParametricDae(db, { resourceUri: uri });
    assert.strictEqual(directHi.length, 2, `Expected 2 S6031 diagnostics, got ${JSON.stringify(directHi)}`);
    const names = directHi.map((d) => d.message);
    assert.ok(
      names.some(
        (m) => (m.includes("CartesianPendulum") && m.includes("rodHolonomic")) || m.includes("x * x + y * y == L * L"),
      ),
    );
    assert.ok(names.some((m) => m.includes("CoupledStateAlgebraic") && m.includes("y == 2.0 * x")));

    const syncFormal = verifySysML2FormalSync(db, { resourceUri: uri }).filter((d) => d.code === 6031);
    assert.strictEqual(syncFormal.length, 2);

    const asyncFormal = (await verifySysML2Formal(db, { resourceUri: uri })).filter((d) => d.code === 6031);
    assert.strictEqual(asyncFormal.length, 2);
  });
});
