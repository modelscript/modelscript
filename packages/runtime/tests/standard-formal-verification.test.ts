// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  DaeBltReachabilityEngine,
  DAEBuilder,
  EqKind,
  ExprKind,
  globalLibraryRegistry,
  parseSysmlRequirements,
  Variability,
  VarType,
  VerificationRunner,
  type ArenaBltResult,
  type QueryDB,
  type SimulationResult,
  type SymbolEntry,
} from "../src/index.js";

const PACK_NAME = "@test/runtime-asme-bpvc";

function registerSyntheticAsmePack(): void {
  globalLibraryRegistry.registerLibraryBundle(
    {
      name: PACK_NAME,
      version: "0.1.0",
      modelscript: {
        tier: "stable",
        category: "standard-pack",
        languages: ["sysml2", "modelica"],
        standard: {
          code: "ASME-BPVC-VIII-1",
          edition: "2023",
          profile: "pressure-vessel",
          activation: "import",
          namespaces: ["ASME_BPVC_VIII_1"],
          calculators: [
            {
              calcName: "AllowableStress",
              kind: "table",
              target: "SA516_Gr70_AllowableStress",
            },
          ],
        },
        runtime: {
          tables: {
            SA516_Gr70_AllowableStress: "tables/sa516-gr70.json",
          },
        },
      },
    },
    {
      tables: {
        SA516_Gr70_AllowableStress: {
          kind: "keyed-piecewise-linear",
          series: {
            "SA-516-70": {
              x: [100, 500, 700, 800],
              y: [137.9, 137.9, 118.0, 82.0],
            },
          },
        },
      },
    },
  );
}

const asmeSysmlDoc = `
  library package ASME_BPVC_VIII_1 {
    calc def AllowableStress {
      @LookupTable { table = "SA516_Gr70_AllowableStress"; }
      in mat : String;
      in tempF : Real;
      return : Real;
    }

    calc def UG27MinThickness {
      in P : Real;
      in R : Real;
      in S : Real;
      in E : Real;
      return : Real = (P * R) / (S * E - 0.6 * P);
    }

    @StandardClause {
      standard = "ASME BPVC VIII-1";
      edition = "2023";
      clauseId = "UG-27(c)(1)";
      severity = "error";
    }
    requirement def UG27_ShellThickness {
      subject vessel : CylindricalShell;
      assume constraint { vessel.P > 0.0 }
      require constraint {
        vessel.t_wall >= UG27MinThickness(
          vessel.P,
          vessel.R,
          AllowableStress(vessel.materialSpec, vessel.designTempF),
          vessel.E
        )
      }
    }
  }
`;

function buildVesselArena(opts: {
  P: number;
  R: number;
  tWall: number;
  E: number;
  tempF: number;
  materialSpec: string;
}): { arena: DAEBuilder; blt: ArenaBltResult } {
  const arena = new DAEBuilder();
  const addParam = (name: string, val: number) => {
    const idx = arena.addVariable(name, VarType.Real, Variability.Parameter);
    arena.setVarStartValue(idx, val);
    arena.setVarExpression(idx, arena.addRealLiteral(val));
    return idx;
  };
  addParam("P", opts.P);
  addParam("R", opts.R);
  addParam("t_wall", opts.tWall);
  addParam("E", opts.E);
  addParam("designTempF", opts.tempF);

  const matIdx = arena.addVariable("materialSpec", VarType.String, Variability.Parameter);
  arena.setVarExpression(matIdx, arena.addStringLiteral(opts.materialSpec));

  // Algebraic variable stress = P * R / t_wall
  const stressIdx = arena.addVariable("hoopStress", VarType.Real, Variability.Continuous);
  const pRef = arena.addExpression(ExprKind.Name, arena.interner.intern("P"));
  const rRef = arena.addExpression(ExprKind.Name, arena.interner.intern("R"));
  const tRef = arena.addExpression(ExprKind.Name, arena.interner.intern("t_wall"));
  const sRef = arena.addExpression(ExprKind.Name, arena.interner.intern("hoopStress"));
  const mulExpr = arena.addBinaryExpr(3 /* Mul */, pRef, rRef);
  const divExpr = arena.addBinaryExpr(4 /* Div */, mulExpr, tRef);
  const eq = arena.addEquation(EqKind.Simple, sRef, divExpr);

  const blt: ArenaBltResult = {
    sortedEquations: [eq],
    blocks: [{ vars: [stressIdx], eqIdxs: [eq], type: "causal" }],
    varToBlock: new Map([[stressIdx, 0]]),
    isValidCausal: true,
    equationCount: 1,
  };
  return { arena, blt };
}

describe("Phase 3: Standard Pack Formal Interval & Dynamic Trajectory Verification", () => {
  after(() => {
    globalLibraryRegistry.unregisterPackage(PACK_NAME);
  });

  it("proves UG-27 failure with suggestedValue and margin, passes adequate wall, and silences failed assume guards", () => {
    registerSyntheticAsmePack();
    const reqs = parseSysmlRequirements(asmeSysmlDoc);
    assert.strictEqual(reqs.length, 1);
    assert.strictEqual(reqs[0]!.standardClause?.clauseId, "UG-27(c)(1)");
    assert.ok(reqs[0]!.assumeAsts && reqs[0]!.assumeAsts.length === 1);
    assert.ok(reqs[0]!.constraintAst);

    // 1. Undersized wall: P=2.5 MPa, R=800 mm, S=137.9 MPa @ 500F, E=0.85
    // t_req = (2.5 * 800) / (137.9 * 0.85 - 0.6 * 2.5) = 2000 / 115.715 = 17.2838 mm
    const undersized = buildVesselArena({
      P: 2.5,
      R: 800,
      tWall: 12.0,
      E: 0.85,
      tempF: 500,
      materialSpec: "SA-516-70",
    });
    const failSummary = new DaeBltReachabilityEngine(undersized.arena, {
      sysmlRequirements: reqs,
    }).verify(undersized.blt);

    assert.strictEqual(failSummary.verdict.kind, "violated");
    const issue = failSummary.issues.find((i) => i.standardClause?.includes("UG-27"));
    assert.ok(issue, "Expected ASME BPVC UG-27 issue");
    assert.strictEqual(issue.severity, "definite");
    assert.ok(Math.abs((issue.requiredLimit ?? 0) - 17.2838) < 0.01);
    assert.ok(Math.abs((issue.margin ?? 0) - (12.0 - 17.2838)) < 0.01);
    assert.ok((issue.suggestedValue ?? 0) >= 17.28);

    // 2. Compliant wall: t_wall = 18.5 mm >= 17.2838 mm
    const compliant = buildVesselArena({
      P: 2.5,
      R: 800,
      tWall: 18.5,
      E: 0.85,
      tempF: 500,
      materialSpec: "SA-516-70",
    });
    const passSummary = new DaeBltReachabilityEngine(compliant.arena, {
      sysmlRequirements: reqs,
    }).verify(compliant.blt);
    assert.strictEqual(passSummary.verdict.kind, "proven");
    assert.strictEqual(passSummary.issues.length, 0);

    // 3. Vacuous applicability: P = 0 -> assume constraint (P > 0) fails cleanly with zero violation
    const unpressurized = buildVesselArena({
      P: 0.0,
      R: 800,
      tWall: 2.0,
      E: 0.85,
      tempF: 500,
      materialSpec: "SA-516-70",
    });
    const skipSummary = new DaeBltReachabilityEngine(unpressurized.arena, {
      sysmlRequirements: reqs,
    }).verify(unpressurized.blt);
    assert.strictEqual(skipSummary.verdict.kind, "proven");
    assert.strictEqual(skipSummary.issues.length, 0);
  });

  it("checks dynamic simulation trajectories against lookup-table temperature derating via VerificationRunner", () => {
    registerSyntheticAsmePack();

    // Build mock QueryDB for verifyCase with dynamic UG27 constraint + SA-516-70 thermal derating
    const reqText = `@StandardClause { standard = "ASME BPVC VIII-1"; clauseId = "UG-27(c)(1)"; }`;
    const entries: SymbolEntry[] = [
      { id: 1, name: "ASME_Pkg", kind: "Package", ruleName: "Package", parentId: null, startOffset: 0, endOffset: 10 },
      {
        id: 2,
        name: "AllowableStress",
        kind: "Definition",
        ruleName: "CalculationDefinition",
        parentId: 1,
        startOffset: 100,
        endOffset: 220,
      },
      {
        id: 3,
        name: "UG27MinThickness",
        kind: "Definition",
        ruleName: "CalculationDefinition",
        parentId: 1,
        startOffset: 221,
        endOffset: 360,
      },
      {
        id: 4,
        name: "UG27_Shell",
        kind: "Definition",
        ruleName: "RequirementDefinition",
        parentId: 1,
        startOffset: 361,
        endOffset: 500,
      },
      {
        id: 5,
        name: "assume_P",
        kind: "Usage",
        ruleName: "RequirementConstraintMember",
        parentId: 4,
        startOffset: 501,
        endOffset: 540,
      },
      {
        id: 6,
        name: "req_t",
        kind: "Usage",
        ruleName: "RequirementConstraintMember",
        parentId: 4,
        startOffset: 541,
        endOffset: 620,
      },
      {
        id: 7,
        name: "VerifyVessel",
        kind: "Usage",
        ruleName: "VerificationCaseUsage",
        parentId: 1,
        startOffset: 621,
        endOffset: 660,
      },
      {
        id: 8,
        name: "UG27_Shell",
        kind: "Usage",
        ruleName: "VerifyRequirementUsage",
        parentId: 7,
        startOffset: 661,
        endOffset: 690,
      },
    ];
    const texts: Record<number, string> = {
      100: `calc def AllowableStress { @LookupTable { table = "SA516_Gr70_AllowableStress"; } in mat : String; in tempF : Real; return : Real; }`,
      221: `calc def UG27MinThickness { in P : Real; in R : Real; in S : Real; in E : Real; return : Real = (P * R) / (S * E - 0.6 * P); }`,
      361: `requirement def UG27_Shell { ${reqText} }`,
      501: `assume constraint { P > 0.0 }`,
      541: `require constraint { t_wall >= UG27MinThickness(P, R, AllowableStress(materialSpec, designTempF), E) }`,
    };

    const byId = new Map(entries.map((e) => [e.id, e]));
    const childrenMap = new Map<number | null, SymbolEntry[]>();
    for (const e of entries) {
      const list = childrenMap.get(e.parentId) ?? [];
      list.push(e);
      childrenMap.set(e.parentId, list);
    }

    const fakeDb: QueryDB = {
      symbol: (id) => byId.get(id),
      byName: (name) => entries.filter((e) => e.name === name),
      childrenOf: (pid) => childrenMap.get(pid) ?? [],
      parentOf: () => undefined,
      allEntries: () => entries,
      cstText: (s) => texts[s] ?? null,
      cstNode: (id) => {
        const entry = byId.get(id);
        if (!entry) return null;
        return { text: texts[entry.startOffset] ?? "", children: [] };
      },
      cstNodeRange: () => null,
      query: () => undefined,
      evaluate: () => undefined,
      checkAssignment: () => true,
    };

    // At t=0..2s designTempF=500F (S=137.9 MPa => t_req=17.28mm, safe with t_wall=19.0mm).
    // At t=4s designTempF=800F (S drops to 82.0 MPa => t_req=29.33mm > 19.0mm -> fails at t=4.0s).
    const simResult: SimulationResult = {
      t: [0.0, 2.0, 4.0],
      states: ["designTempF"],
      y: [[500], [500], [800]],
      parameters: [
        { name: "P", value: 2.5 },
        { name: "R", value: 800 },
        { name: "t_wall", value: 19.0 },
        { name: "E", value: 0.85 },
        { name: "materialSpec", value: "SA-516-70" },
      ],
    };

    const runner = new VerificationRunner(fakeDb);
    const results = runner.verifyCase(7, simResult);
    assert.strictEqual(results.length, 1);
    const r = results[0]!;
    assert.strictEqual(r.isSatisfied, false);
    assert.strictEqual(r.violationTime, 4.0);
    assert.strictEqual(r.standardClause, "ASME BPVC VIII-1 UG-27(c)(1)");
    assert.ok((r.margin ?? 0) < -10.0);
    assert.ok(r.message?.includes("[ASME BPVC VIII-1 UG-27(c)(1)]"));
  });
});
