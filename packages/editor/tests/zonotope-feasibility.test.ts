// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIsomorphicRenameScramble,
  checkZonotopeFeasibility,
  computeParaphraseNeighborhood,
  extractNumericParamsFromSource,
  type NumericParamSpec,
} from "../src/workbench/util/zonotope-feasibility.js";
import {
  buildGeneratorSummaries,
  createInitialZonotopeWorkbenchState,
  DEFAULT_MODALITY_BUDGETS,
  getGeneratorColor,
  parseLinearConstraintExpression,
  REL_TYPE_SHORT_LABELS,
  toApiHypergraphOverrides,
  ZONOTOPE_PALETTE,
  type LinearConstraintSpec,
} from "../src/workbench/util/zonotope-workbench-state.js";

describe("zonotope-workbench-state utilities", () => {
  it("creates initial state with cloned default budgets and palette lookup", () => {
    const state = createInitialZonotopeWorkbenchState();
    assert.equal(state.stressScale, 1.0);
    assert.equal(state.activeGroupId, null);
    assert.equal(state.activeBrush, "select");
    assert.equal(state.scramblePreview, false);
    assert.deepEqual(state.budgets, DEFAULT_MODALITY_BUDGETS);
    assert.notEqual(state.budgets, DEFAULT_MODALITY_BUDGETS);

    assert.equal(ZONOTOPE_PALETTE.length, 12);
    assert.equal(REL_TYPE_SHORT_LABELS[0], "LOCK");
    assert.equal(REL_TYPE_SHORT_LABELS[4], "FLOW ±1");
    assert.equal(REL_TYPE_SHORT_LABELS[6], "TOL");

    const lockedColor = getGeneratorColor(0);
    assert.equal(lockedColor.solid, "#94a3b8");
    assert.deepEqual(getGeneratorColor(1), ZONOTOPE_PALETTE[0]);
    assert.deepEqual(getGeneratorColor(13), ZONOTOPE_PALETTE[0]);
  });

  it("aggregates active generators and converts pending overrides for the API", () => {
    const summaries = buildGeneratorSummaries({
      spans: [
        { groupId: 0, relTypeId: 0, relSign: 0, text: "parameter" },
        { groupId: 2, relTypeId: 2, relSign: -1, symbolName: "C1", text: "C1" },
        { groupId: 1, relTypeId: 1, relSign: 1, symbolName: "R1", text: "R1", ontologyIri: "qudt:Resistance" },
        { groupId: 1, relTypeId: 1, relSign: 1, symbolName: "R1", text: "R1" },
      ],
    });

    assert.equal(summaries.length, 2);
    assert.deepEqual(summaries[0], {
      groupId: 1,
      symbolName: "R1",
      relTypeId: 1,
      relLabel: "SYNC",
      relSign: 1,
      spanCount: 2,
      ontologyIri: "qudt:Resistance",
    });
    assert.deepEqual(summaries[1], {
      groupId: 2,
      symbolName: "C1",
      relTypeId: 2,
      relLabel: "INV",
      relSign: -1,
      spanCount: 1,
    });
    assert.deepEqual(buildGeneratorSummaries(null), []);

    const apiOverrides = toApiHypergraphOverrides([
      {
        id: "ov-1",
        tokenIndex: 4,
        symbolName: "R1",
        textSnippet: "R1",
        groupId: 1,
        relTypeId: 1,
        relSign: 1,
        modality: "physics",
        note: "lock resistor",
      },
      {
        id: "ov-2",
        groupId: 0,
        relTypeId: 0,
        relSign: 0,
        modality: "code",
      },
    ]);

    assert.deepEqual(apiOverrides, [
      { tokenIndex: 4, symbolName: "R1", groupId: 1, relTypeId: 1, relSign: 1 },
      { groupId: 0, relTypeId: 0, relSign: 0 },
    ]);
    assert.equal("tokenIndex" in apiOverrides[1]!, false);
    assert.equal("symbolName" in apiOverrides[1]!, false);
  });
});

describe("parseLinearConstraintExpression", () => {
  it("parses simple inequalities and equalities", () => {
    const c1 = parseLinearConstraintExpression("wall_thickness >= 2.0", "3d", "c_wall");
    assert.ok(c1);
    assert.equal(c1.id, "c_wall");
    assert.equal(c1.sense, ">=");
    assert.equal(c1.rhs, 2);
    assert.equal(c1.modality, "3d");
    assert.deepEqual(c1.coeffs, { wall_thickness: 1 });

    const c2 = parseLinearConstraintExpression("R1 - R2 == 0", "physics", "c_eq");
    assert.ok(c2);
    assert.equal(c2.sense, "==");
    assert.equal(c2.rhs, 0);
    assert.deepEqual(c2.coeffs, { R1: 1, R2: -1 });
  });

  it("parses multi-term linear combinations, negative coefficients, and terms on both sides", () => {
    const c1 = parseLinearConstraintExpression("2*wall_thickness + bore <= 20", "3d");
    assert.ok(c1);
    assert.equal(c1.sense, "<=");
    assert.equal(c1.rhs, 20);
    assert.deepEqual(c1.coeffs, { wall_thickness: 2, bore: 1 });

    const c2 = parseLinearConstraintExpression("0.5 * L1 + 1.5 * L2 <= 10", "physics");
    assert.ok(c2);
    assert.equal(c2.sense, "<=");
    assert.equal(c2.rhs, 10);
    assert.deepEqual(c2.coeffs, { L1: 0.5, L2: 1.5 });

    const c3 = parseLinearConstraintExpression("-2.5 * x - y >= -12.5", "physics");
    assert.ok(c3);
    assert.equal(c3.sense, ">=");
    assert.equal(c3.rhs, -12.5);
    assert.deepEqual(c3.coeffs, { x: -2.5, y: -1 });

    const c4 = parseLinearConstraintExpression("2*a + 4 <= b + 10", "physics");
    assert.ok(c4);
    assert.equal(c4.sense, "<=");
    assert.equal(c4.rhs, 6);
    assert.deepEqual(c4.coeffs, { a: 2, b: -1 });
  });

  it("rejects empty, constant-only, strict, and nonlinear expressions", () => {
    assert.equal(parseLinearConstraintExpression(""), null);
    assert.equal(parseLinearConstraintExpression("5 <= 10"), null);
    assert.equal(parseLinearConstraintExpression("x < 10"), null);
    assert.equal(parseLinearConstraintExpression("x * y <= 10"), null);
    assert.equal(parseLinearConstraintExpression("1 / x <= 2"), null);
    assert.equal(parseLinearConstraintExpression("x <= 5 <= 10"), null);
  });
});

describe("checkZonotopeFeasibility (HC4 interval propagation)", () => {
  it("tightens bounds and computes geometric-mean volumeRetention on feasible systems", () => {
    const params: NumericParamSpec[] = [
      { name: "wall_thickness", nominal: 3.0, halfWidth: 1.0, modality: "3d" }, // [2, 4]
      { name: "bore", nominal: 12.0, halfWidth: 2.0, modality: "3d" }, // [10, 14]
    ];
    const c1 = parseLinearConstraintExpression("wall_thickness >= 3.0", "3d", "c_min_wall")!;
    const c2 = parseLinearConstraintExpression("2*wall_thickness + bore <= 20", "3d", "c_envelope")!;

    const res = checkZonotopeFeasibility(params, [c1, c2], 1.0);
    assert.equal(res.feasible, true);
    assert.deepEqual(res.conflictingConstraintIds, []);

    // wall_thickness tightened from [2, 4] to [3, 4] (ratio = 0.5)
    assert.deepEqual(res.tightenedBounds["wall_thickness"], [3, 4]);
    // 2*wall_thickness >= 6 => bore <= 20 - 6 = 14 (already 14, ratio = 1.0)
    assert.deepEqual(res.tightenedBounds["bore"], [10, 14]);
    // Geometric mean = sqrt(0.5 * 1.0)
    assert.ok(Math.abs(res.volumeRetention - Math.sqrt(0.5)) < 1e-6);
    assert.ok(Math.abs(res.feasibilityRate - 0.5) < 1e-6);
    assert.ok(res.estimatedMShift >= 1);
  });

  it("propagates coupled equality constraints across variables", () => {
    const params: NumericParamSpec[] = [
      { name: "R1", nominal: 100, halfWidth: 10, modality: "physics" }, // [90, 110]
      { name: "R2", nominal: 95, halfWidth: 10, modality: "physics" }, // [85, 105]
    ];
    const eq = parseLinearConstraintExpression("R1 - R2 == 0", "physics", "c_match")!;

    const res = checkZonotopeFeasibility(params, [eq], 1.0);
    assert.equal(res.feasible, true);
    assert.deepEqual(res.conflictingConstraintIds, []);
    // Intersection of [90, 110] and [85, 105] is [90, 105]
    assert.deepEqual(res.tightenedBounds["R1"], [90, 105]);
    assert.deepEqual(res.tightenedBounds["R2"], [90, 105]);
    assert.ok(Math.abs(res.volumeRetention - 0.75) < 1e-6);
  });

  it("detects infeasible contradictory constraints and reports exact conflictingConstraintIds", () => {
    const params: NumericParamSpec[] = [
      { name: "wall_thickness", nominal: 3.0, halfWidth: 0.5, modality: "3d" }, // [2.5, 3.5]
      { name: "bore", nominal: 14.0, halfWidth: 1.0, modality: "3d" }, // [13, 15]
    ];
    const constraints: LinearConstraintSpec[] = [
      parseLinearConstraintExpression("wall_thickness >= 3.2", "3d", "c_ok_lower")!,
      parseLinearConstraintExpression("wall_thickness <= 2.8", "3d", "c_conflict_upper")!,
      parseLinearConstraintExpression("bore >= 25.0", "3d", "c_conflict_bore")!,
    ];

    const res = checkZonotopeFeasibility(params, constraints, 1.0);
    assert.equal(res.feasible, false);
    assert.equal(res.volumeRetention, 0);
    assert.equal(res.feasibilityRate, 0);
    assert.deepEqual(res.conflictingConstraintIds.sort(), ["c_conflict_bore", "c_conflict_upper"]);
  });

  it("amplifies perturbation boxes and feasibility impact under stressScale", () => {
    const params: NumericParamSpec[] = [{ name: "R", nominal: 100, halfWidth: 5, modality: "physics" }];
    const c = parseLinearConstraintExpression("R <= 105", "physics", "c_cap")!;

    const res1x = checkZonotopeFeasibility(params, [c], 1.0);
    const res2x = checkZonotopeFeasibility(params, [c], 2.0);

    // At 1x: nominal [95, 105], constraint R <= 105 retains 100%
    assert.equal(res1x.feasible, true);
    assert.deepEqual(res1x.nominalBounds["R"], [95, 105]);
    assert.ok(Math.abs(res1x.volumeRetention - 1.0) < 1e-6);

    // At 2x: nominal [90, 110], constraint R <= 105 tightens to [90, 105] -> 75% retained
    assert.equal(res2x.feasible, true);
    assert.deepEqual(res2x.nominalBounds["R"], [90, 110]);
    assert.deepEqual(res2x.tightenedBounds["R"], [90, 105]);
    assert.ok(Math.abs(res2x.volumeRetention - 0.75) < 1e-6);
    assert.ok(res2x.estimatedMShift > res1x.estimatedMShift);
  });
});

describe("extractNumericParamsFromSource", () => {
  it("extracts Modelica parameters while ignoring comments, strings, and comparisons", () => {
    const src = [
      "model RCFilter",
      "  // parameter Real fake = 999;",
      '  parameter Real R = 100 "Resistance R = 50";',
      '  parameter Real C(min=0, unit="F") = 1e-6 "Capacitance";',
      "  parameter Real L = 0.02;",
      "equation",
      '  assert(R == 100, "ok");',
      "end RCFilter;",
    ].join("\n");

    const params = extractNumericParamsFromSource(src, { ...DEFAULT_MODALITY_BUDGETS, physicsParamFraction: 0.1 }, 1.0);

    const byName = new Map(params.map((p) => [p.name, p]));
    assert.equal(byName.has("fake"), false);
    assert.equal(byName.has("min"), false);
    assert.equal(byName.get("R")?.nominal, 100);
    assert.ok(Math.abs((byName.get("R")?.halfWidth ?? 0) - 10) < 1e-9);
    assert.equal(byName.get("R")?.modality, "physics");

    assert.equal(byName.get("C")?.nominal, 1e-6);
    assert.equal(byName.get("C")?.unit, "F");
    assert.equal(byName.get("L")?.nominal, 0.02);
  });

  it("extracts CAD and prose parameters and applies cadToleranceFraction to geometric names", () => {
    const src = [
      "// Housing geometry",
      "wall_thickness = 2.5;",
      "bore = 12.0; // mm",
      "width: 20.0 mm",
      "mass_kg = 4.0;",
      "difference() { cylinder(h=10, r=20); }",
    ].join("\n");

    const params = extractNumericParamsFromSource(
      src,
      {
        ...DEFAULT_MODALITY_BUDGETS,
        cadToleranceFraction: 0.04,
        physicsParamFraction: 0.1,
      },
      1.0,
    );

    const byName = new Map(params.map((p) => [p.name, p]));
    assert.equal(byName.has("h"), false);
    assert.equal(byName.has("r"), false);

    assert.equal(byName.get("wall_thickness")?.nominal, 2.5);
    assert.equal(byName.get("wall_thickness")?.modality, "3d");
    assert.ok(Math.abs((byName.get("wall_thickness")?.halfWidth ?? 0) - 0.1) < 1e-9);

    assert.equal(byName.get("bore")?.nominal, 12.0);
    assert.equal(byName.get("bore")?.modality, "3d");

    assert.equal(byName.get("width")?.nominal, 20.0);
    assert.equal(byName.get("width")?.unit, "mm");
    assert.equal(byName.get("width")?.modality, "3d");

    assert.equal(byName.get("mass_kg")?.nominal, 4.0);
    assert.equal(byName.get("mass_kg")?.modality, "physics");
    assert.ok(Math.abs((byName.get("mass_kg")?.halfWidth ?? 0) - 0.4) < 1e-9);
  });
});

describe("computeParaphraseNeighborhood", () => {
  it("generates unit equivalence, bound reformulation, and synonym paraphrases for temperature/requirements", () => {
    const sentence = "Resistor temperature SHALL NOT exceed <= 85 °C under continuous load.";
    const variants = computeParaphraseNeighborhood(sentence, 0.2);

    assert.equal(variants.length, 3);
    const byKind = new Map(variants.map((v) => [v.kind, v]));

    const unitVar = byKind.get("unit_equiv");
    assert.ok(unitVar);
    assert.ok(unitVar.text.includes("358.15 K"));
    assert.ok(unitVar.epsilonDistance > 0 && unitVar.epsilonDistance <= 0.2);

    const boundVar = byKind.get("bound_reformulation");
    assert.ok(boundVar);
    assert.ok(boundVar.text.includes("MUST NEVER"));
    assert.ok(boundVar.text.includes("at most"));
    assert.ok(boundVar.epsilonDistance > 0 && boundVar.epsilonDistance <= 0.2);

    const synVar = byKind.get("synonym");
    assert.ok(synVar);
    assert.ok(synVar.text.includes("Resistive element"));
    assert.ok(synVar.epsilonDistance > 0 && synVar.epsilonDistance <= 0.2);
  });

  it("handles length/pressure/time unit conversions and respects zero radius", () => {
    const lengthSentence = "Minimum clearance >= 2.5 mm and pressure <= 250 kPa within 50 ms.";
    const variants = computeParaphraseNeighborhood(lengthSentence, 0.15);

    const unitVar = variants.find((v) => v.kind === "unit_equiv");
    assert.ok(unitVar);
    assert.ok(unitVar.text.includes("0.0025 m"));
    assert.ok(unitVar.text.includes("2.5 bar"));
    assert.ok(unitVar.text.includes("0.05 s"));

    const synVar = variants.find((v) => v.kind === "synonym");
    assert.ok(synVar);
    assert.ok(synVar.text.includes("gap allowance"));

    assert.deepEqual(computeParaphraseNeighborhood(lengthSentence, 0), []);
    assert.deepEqual(computeParaphraseNeighborhood("   ", 0.2), []);
  });
});

describe("buildIsomorphicRenameScramble", () => {
  it("preserves groupId === 0 tokens, remaps groupId > 0 identifiers consistently, and preserves topology invariance", () => {
    const source = [
      "model RC",
      "  parameter Real R1 = 100;",
      "  Real v_out;",
      "equation",
      "  v_out = R1 * 0.5;",
      "end RC;",
    ].join("\n");

    const record = {
      spans: [
        // Line 1: `model` (locked)
        { groupId: 0, relTypeId: 0, relSign: 0, text: "model", startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
        // Line 2: `parameter` (locked), `R1` (group 1), `100` (group 3 numeric - not identifier)
        {
          groupId: 0,
          relTypeId: 0,
          relSign: 0,
          text: "parameter",
          startLine: 2,
          startColumn: 3,
          endLine: 2,
          endColumn: 12,
        },
        {
          groupId: 1,
          relTypeId: 1,
          relSign: 1,
          text: "R1",
          symbolName: "R1",
          startLine: 2,
          startColumn: 18,
          endLine: 2,
          endColumn: 20,
        },
        { groupId: 3, relTypeId: 6, relSign: 1, text: "100", startLine: 2, startColumn: 23, endLine: 2, endColumn: 26 },
        // Line 3: `v_out` (group 2)
        {
          groupId: 2,
          relTypeId: 1,
          relSign: 1,
          text: "v_out",
          symbolName: "v_out",
          startLine: 3,
          startColumn: 8,
          endLine: 3,
          endColumn: 13,
        },
        // Line 4: `equation` (locked)
        {
          groupId: 0,
          relTypeId: 0,
          relSign: 0,
          text: "equation",
          startLine: 4,
          startColumn: 1,
          endLine: 4,
          endColumn: 9,
        },
        // Line 5: `v_out` (group 2), `R1` (group 1)
        {
          groupId: 2,
          relTypeId: 1,
          relSign: 1,
          text: "v_out",
          symbolName: "v_out",
          startLine: 5,
          startColumn: 3,
          endLine: 5,
          endColumn: 8,
        },
        {
          groupId: 1,
          relTypeId: 1,
          relSign: 1,
          text: "R1",
          symbolName: "R1",
          startLine: 5,
          startColumn: 11,
          endLine: 5,
          endColumn: 13,
        },
      ],
    };

    const result = buildIsomorphicRenameScramble(source, record);

    assert.equal(result.invariant, true);
    assert.equal(result.topologySignatureBefore, result.topologySignatureAfter);
    assert.equal(result.preservedLockedCount, 3);
    assert.equal(result.scrambledGroupCount, 2);
    assert.deepEqual(result.renameMap, { R1: "sym_a", v_out: "sym_b" });

    // Locked keywords & numeric literal stay untouched; identifiers renamed consistently
    assert.ok(result.scrambledSource.includes("model RC"));
    assert.ok(result.scrambledSource.includes("parameter Real sym_a = 100;"));
    assert.ok(result.scrambledSource.includes("Real sym_b;"));
    assert.ok(result.scrambledSource.includes("equation"));
    assert.ok(result.scrambledSource.includes("sym_b = sym_a * 0.5;"));
    assert.equal(result.scrambledSource.includes("R1"), false);
    assert.equal(result.scrambledSource.includes("v_out"), false);
  });
});
