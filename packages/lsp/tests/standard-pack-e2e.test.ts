// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DaeBltReachabilityEngine,
  DAEBuilder,
  EqKind,
  ExprKind,
  globalLibraryRegistry,
  parseSysmlRequirements,
  PressureVesselOracle,
  Variability,
  VarType,
  type ArenaBltResult,
  type ModelscriptLibraryManifest,
  type StandardLookupTable,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  filterRequirementsForModel,
  resolveActiveComplianceProfiles,
} from "../src/services/compliance-profile-service.js";
import { mountedLibraryMetadata, normalizeLibraryName } from "../src/utils/hierarchy-utils.js";

const PACK_DIR = path.resolve(import.meta.dirname, "../../examples/asme-bpvc-viii-1/pack");
const MODEL_FILE = path.resolve(import.meta.dirname, "../../examples/asme-bpvc-viii-1/src/VesselSeparator.mo");
const PACK_NAME = "@modelscript/asme-bpvc-viii-1";

function buildSeparatorArena(overrides: { tWall: number; tHead?: number; pHydro?: number; pSet?: number }): {
  arena: DAEBuilder;
  blt: ArenaBltResult;
} {
  const arena = new DAEBuilder();
  const addParam = (name: string, val: number) => {
    const idx = arena.addVariable(name, VarType.Real, Variability.Parameter);
    arena.setVarStartValue(idx, val);
    arena.setVarExpression(idx, arena.addRealLiteral(val));
  };
  addParam("P", 2.5);
  addParam("MAWP", 2.6);
  addParam("R", 800.0);
  addParam("D", 1600.0);
  addParam("E", 0.85);
  addParam("designTempF", 500.0);
  addParam("t_wall", overrides.tWall);
  addParam("t_head", overrides.tHead ?? 18.5);
  addParam("P_hydro", overrides.pHydro ?? 3.5);
  addParam("P_set", overrides.pSet ?? 2.55);

  const matIdx = arena.addVariable("materialSpec", VarType.String, Variability.Parameter);
  arena.setVarExpression(matIdx, arena.addStringLiteral("SA-516-70"));

  const hoopIdx = arena.addVariable("hoopStress", VarType.Real, Variability.Continuous);
  const pRef = arena.addExpression(ExprKind.Name, arena.interner.intern("P"));
  const rRef = arena.addExpression(ExprKind.Name, arena.interner.intern("R"));
  const tRef = arena.addExpression(ExprKind.Name, arena.interner.intern("t_wall"));
  const hRef = arena.addExpression(ExprKind.Name, arena.interner.intern("hoopStress"));
  const mulExpr = arena.addBinaryExpr(3, pRef, rRef);
  const divExpr = arena.addBinaryExpr(4, mulExpr, tRef);
  const eq = arena.addEquation(EqKind.Simple, hRef, divExpr);

  return {
    arena,
    blt: {
      sortedEquations: [eq],
      blocks: [{ vars: [hoopIdx], eqIdxs: [eq], type: "causal" }],
      varToBlock: new Map([[hoopIdx, 0]]),
      isValidCausal: true,
      equationCount: 1,
    },
  };
}

describe("End-to-End Reference Standard Pack (@modelscript/asme-bpvc-viii-1)", () => {
  after(() => {
    globalLibraryRegistry.unregisterPackage(PACK_NAME);
    mountedLibraryMetadata.delete(normalizeLibraryName(PACK_NAME));
  });

  it("mounts disk standard pack, scopes unrelated models, and proves UG-27/UG-32/UG-99/UG-125 compliance", () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(PACK_DIR, "package.json"), "utf8")) as {
      name: string;
      version: string;
      modelscript: ModelscriptLibraryManifest;
    };
    const stressTable = JSON.parse(
      fs.readFileSync(path.join(PACK_DIR, "tables/sa516-gr70-allowable-stress.json"), "utf8"),
    ) as StandardLookupTable;
    const sysmlText = fs.readFileSync(path.join(PACK_DIR, "src/asme_viii_1.sysml"), "utf8");
    const vesselMoText = fs.readFileSync(MODEL_FILE, "utf8");

    globalLibraryRegistry.registerLibraryBundle(pkgJson, {
      tables: {
        SA516_Gr70_AllowableStress: stressTable,
      },
    });
    mountedLibraryMetadata.set(normalizeLibraryName(PACK_NAME), {
      name: PACK_NAME,
      version: pkgJson.version,
      category: "standard-pack",
      standardCode: pkgJson.modelscript.standard?.code,
      activation: pkgJson.modelscript.standard?.activation,
      active: false,
    });

    // Verify calculator resolution works from loaded disk table
    assert.strictEqual(globalLibraryRegistry.invokeCalculator("AllowableStress", ["SA-516-70", 500]), 137.9);
    assert.strictEqual(globalLibraryRegistry.invokeCalculator("AllowableStress", ["SA-516-70", 700]), 118.0);

    // Parse real SysML v2 compliance pack file
    const reqs = parseSysmlRequirements(sysmlText);
    assert.strictEqual(reqs.length, 4);

    const tagged = reqs.map((req) => ({
      req,
      sourceUri: `modelscript-stdpack://${PACK_NAME}/src/asme_viii_1.sysml`,
    }));

    // 1. Unrelated model has 0 active ASME rules
    const unrelatedRes = resolveActiveComplianceProfiles({
      modelText: "model UnrelatedOscillator Real x(start=1); equation der(x) = -x; end UnrelatedOscillator;",
      allSysmlDocs: [],
    });
    assert.strictEqual(filterRequirementsForModel(tagged, unrelatedRes).length, 0);

    // 2. VesselSeparator.mo imports ASME_BPVC_VIII_1.* -> all 4 rules activate
    const vesselRes = resolveActiveComplianceProfiles({
      modelText: vesselMoText,
      allSysmlDocs: [],
    });
    const activeReqs = filterRequirementsForModel(tagged, vesselRes);
    assert.strictEqual(activeReqs.length, 4);

    // 3. Undersized shell t_wall=12.0 mm fails UG-27(c)(1) while compliant t_wall=18.5 mm passes all 4 clauses
    const undersized = buildSeparatorArena({ tWall: 12.0 });
    const failSummary = new DaeBltReachabilityEngine(undersized.arena, {
      sysmlRequirements: activeReqs,
    }).verify(undersized.blt);
    assert.strictEqual(failSummary.verdict.kind, "violated");
    const ug27Issue = failSummary.issues.find((i) => i.standardClause?.includes("UG-27"));
    assert.ok(ug27Issue, "Expected UG-27(c)(1) violation");
    assert.ok((ug27Issue.suggestedValue ?? 0) >= 17.28);

    const compliant = buildSeparatorArena({ tWall: 18.5 });
    const passSummary = new DaeBltReachabilityEngine(compliant.arena, {
      sysmlRequirements: activeReqs,
    }).verify(compliant.blt);
    assert.strictEqual(passSummary.verdict.kind, "proven");
    assert.strictEqual(passSummary.issues.length, 0);

    // 4. Cross-check PressureVesselOracle on the same VesselSeparator parameters using loaded table
    const oracle = new PressureVesselOracle();
    oracle.assertUg27Cylinder({
      checkId: "VesselSeparator.Shell",
      vesselName: "VesselSeparator",
      P: 2.5,
      R: 800,
      t: 18.5,
      E: 0.85,
      materialSpec: "SA-516-70",
      designTempF: 500,
    });
    oracle.assertUg32Head({
      checkId: "VesselSeparator.Head",
      vesselName: "VesselSeparator",
      headType: "ellipsoidal",
      P: 2.5,
      D: 1600,
      t: 18.5,
      E: 0.85,
      materialSpec: "SA-516-70",
      designTempF: 500,
    });
    oracle.assertUg99Hydrostatic({
      checkId: "VesselSeparator.Hydro",
      vesselName: "VesselSeparator",
      mawp: 2.6,
      testPressure: 3.5,
    });
    oracle.assertUg125Relief({
      checkId: "VesselSeparator.PRV",
      vesselName: "VesselSeparator",
      mawp: 2.6,
      setPressure: 2.55,
    });
    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("offers S5020 QuickFix to update non-compliant parameter to suggestedValue", async () => {
    const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");
    const { CodeActionKind } = await import("vscode-languageserver");
    const { TextDocument } = await import("vscode-languageserver-textdocument");

    const modelUri = "file:///workspace/VesselSeparator.mo";
    const modelSource = "model VesselSeparator\n  parameter Real t_wall = 12.0;\nend VesselSeparator;\n";
    const textDoc = TextDocument.create(modelUri, "modelica", 1, modelSource);

    let codeActionHandler:
      | ((params: unknown) => Array<{
          title: string;
          kind?: string;
          isPreferred?: boolean;
          edit?: { changes?: Record<string, Array<{ newText: string }>> };
        }>)
      | null = null;

    const mockConnection = {
      onCodeAction: (handler: typeof codeActionHandler) => {
        codeActionHandler = handler;
      },
      onRenameRequest: () => {},
      onPrepareRename: () => {},
      onReferences: () => {},
      onWorkspaceSymbol: () => {},
    };
    const mockDocuments = {
      get: (uri: string) => (uri === modelUri ? textDoc : undefined),
      all: () => [textDoc],
    };

    registerWorkspaceFeaturesProvider(
      mockConnection as unknown as Parameters<typeof registerWorkspaceFeaturesProvider>[0],
      mockDocuments as unknown as Parameters<typeof registerWorkspaceFeaturesProvider>[1],
      new Map(),
      async () => {},
      async () => null,
      () => null,
    );

    assert.ok(codeActionHandler, "Expected onCodeAction handler to be registered");
    const actions = codeActionHandler({
      textDocument: { uri: modelUri },
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 30 } },
      context: {
        diagnostics: [
          {
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 30 } },
            severity: 1,
            code: "S5020",
            source: "modelscript-compliance",
            message: "Standard clause UG-27(c)(1) violated: 't_wall' = 12 < 17.2836",
            data: {
              varName: "t_wall",
              standardClause: "UG-27(c)(1)",
              suggestedValue: 17.29,
              requiredLimit: 17.2836,
            },
          },
        ],
      },
    });

    const fix = actions.find((a) => a.title.includes("t_wall") && a.title.includes("17.29"));
    assert.ok(fix, "Expected S5020 QuickFix code action");
    assert.strictEqual(fix.kind, CodeActionKind.QuickFix);
    assert.strictEqual(fix.isPreferred, true);
    assert.strictEqual(fix.edit?.changes?.[modelUri]?.[0]?.newText, "17.29");
  });
});
