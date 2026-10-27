// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileWcojMatcher,
  invertExpression,
  planWcojPattern,
  runCPA,
  tggCompute,
  tggDefaultVal,
  tggEq,
  tggForEach,
  tggFormatUri,
  tggInvertible,
  tggMapList,
  tggPath,
  tggReconcilePhysics,
  tggRule,
  tggTypeMap,
  verifyRuleLosslessness,
} from "@modelscript/dsl";
import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import assert from "node:assert";
import { describe, it } from "node:test";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
  notToContain: (str: string) => assert.ok(!String(val).includes(str)),
  toBeGreaterThanOrEqual: (min: number) => assert.ok(Number(val) >= min),
});

describe("AOT TGG Compiler", () => {
  it("should compile declarative TGG rules into AssemblyScript dispatch tables", () => {
    const rules = [
      tggRule({
        name: "PartDefToModelicaModel",
        source: ($, v) =>
          $.PartDefinition({
            declaredName: v("className"),
            isAbstract: v("abstractFlag"),
          }),
        target: ($, v) =>
          $.ClassDefinition({
            name: v("className"),
            classKind: v("modelKind"),
            isPartial: v("abstractFlag"),
          }),
        where: (v) => [
          tggEq(v("className"), v("className")),
          tggEq(v("abstractFlag"), v("isPartial")),
          tggDefaultVal(v("modelKind"), "block"),
        ],
      }),
      tggRule({
        name: "AttributeToParameter",
        source: ($, v) =>
          $.AttributeUsage({
            name: v("attrName"),
            typeSpecifier: v("attrType"),
            defaultValue: v("valExpr"),
          }),
        target: ($, v) =>
          $.ComponentDeclaration({
            name: v("attrName"),
            typeSpecifier: v("mappedType"),
            variability: "parameter",
            binding: v("valExpr"),
          }),
        where: (v) => [tggTypeMap(v("attrType"), v("mappedType"), "modelica")],
      }),
    ];

    const result = compileTGGRules(rules);

    expect(result.ruleCount).toBe(2);
    expect(result.ruleNames).toEqual(["PartDefToModelicaModel", "AttributeToParameter"]);

    // Verify generated functions
    expect(result.sourceCode).toContain("export function tgg_forward_PartDefToModelicaModel");
    expect(result.sourceCode).toContain("export function tgg_backward_PartDefToModelicaModel");
    expect(result.sourceCode).toContain("export function tgg_propagate_PartDefToModelicaModel");

    expect(result.sourceCode).toContain("export function tgg_forward_AttributeToParameter");
    expect(result.sourceCode).toContain("export function tgg_backward_AttributeToParameter");

    // Verify dispatch tables
    expect(result.sourceCode).toContain("export function tgg_forward_dispatch");
    expect(result.sourceCode).toContain("export function tgg_backward_dispatch");
    expect(result.sourceCode).toContain("export function tgg_propagate_all_stale");

    // Verify correspondence index integration
    expect(result.sourceCode).toContain("corr.addLink(sourceNodeId, targetNodeId, 0, CORR_FLAG_SYNCED, 0);");
    expect(result.sourceCode).toContain("corr.findBySource(sourceNodeId);");
  });

  it("should compile formatUri, mapList, compute, path, forEach, invertible, and real conflict reconciliation", () => {
    const rules = [
      tggRule({
        name: "ComplexConstraintRule",
        source: ($, v) =>
          $.PartDefinition({
            id: v("srcId"),
            items: v("srcItems"),
            rawMass: v("mass_kg"),
            subParts: v("parts"),
            nestedVal: v("srcPathRoot"),
          }),
        target: ($, v) =>
          $.ClassDefinition({
            uri: v("tgtUri"),
            elements: v("tgtItems"),
            computedVal: v("derivedVal"),
            scaledMass: v("mass_g"),
            resolvedRef: v("tgtRef"),
          }),
        where: (v) => [
          tggFormatUri(v("srcId"), "http://example.org/ont#", v("tgtUri")),
          tggMapList(v("srcItems"), v("tgtItems"), (item) => item),
          tggCompute(v("derivedVal"), "computeComplexity", v("srcId")),
          tggPath(v("srcPathRoot"), "port.connector.type", v("tgtRef")),
          tggForEach(v("parts"), v("item"), [tggEq(v("srcId"), v("tgtUri"))]),
          tggInvertible("mass_g = mass_kg * 1000.0 + 0.0"),
          tggReconcilePhysics(v("mass_kg"), v("mass_g"), { min: 0.0, max: 10000.0, tolerance: 1e-3 }),
        ],
      }),
    ];

    const result = compileTGGRules(rules);
    const code = result.sourceCode;

    // formatUri bijective hash XOR + transfer
    expect(code).toContain('// Format URI: __var_tgtUri = "http://example.org/ont#" + __var_srcId');
    expect(code).toContain(
      '// Reverse Format URI: strip prefix "http://example.org/ont#" from __var_tgtUri -> __var_srcId',
    );

    // mapList child list mapping + appendChild
    expect(code).toContain("graph.model.appendChild(targetNodeId, __mapped_fwd_");
    expect(code).toContain("graph.model.appendChild(sourceNodeId, __mapped_bwd_");

    // compute query invocation
    expect(code).toContain("graph.model.compute(sourceNodeId,");

    // path multi-hop traversal
    expect(code).toContain("graph.model.resolveHash(__pathCurr_fwd_");

    // forEach loop and inner constraint emission
    expect(code).toContain("while (__child_");

    // invertible forward and auto-inverted backward numeric transform
    expect(code).toContain("* 1000");
    expect(code).toContain("/ 1000");

    // Conflict reconciliation reads real f64 properties and writes back reconciled values (no hardcoded 0.0, 0.0)
    expect(code).toContain("tgg_reconcile_physics_simplex(slot, __srcVal, __tgtVal,");
    expect(code).notToContain("0.0, 0.0, corr");
    expect(code).toContain("let __srcVal = graph.model.getProperty<f64>(sourceNodeId,");
    expect(code).toContain("let __tgtVal = graph.model.getProperty<f64>(targetNodeId,");

    // Stale attribute propagation in tgg_propagate_ComplexConstraintRule
    expect(code).toContain("__invSrc_prop_0_5");
    expect(code).toContain("__uriVal_prop_0_0");
  });

  it("should resolve distinct bound variables in multi-variable invertible expressions and initialize WCOJ iterators", () => {
    const rules = [
      tggRule({
        name: "ForceLawRule",
        source: ($, v) =>
          $.MechanicalBody({
            mass: v("m"),
            accel: v("a"),
          }),
        target: ($, v) =>
          $.ForceLoad({
            force: v("f"),
          }),
        where: () => [tggInvertible("f = m * a", "m = f / a")],
      }),
    ];

    const compiled = compileTGGRules(rules);
    // 'm' resolves to the primary local variable and 'a' resolves to a separate property load on sourceNodeId
    expect(compiled.sourceCode).toContain("__invSrc_fwd_0_0 * graph.model.getProperty<f64>(sourceNodeId,");

    // WCOJ matcher initializes LeapfrogIterators from DPO edges before intersection
    const plan = planWcojPattern({
      name: "TriangleJoin",
      variables: ["u", "v", "w"],
      edges: [
        { fromVar: "u", toVar: "v", edgeType: "Connect" },
        { fromVar: "v", toVar: "w", edgeType: "Connect" },
        { fromVar: "w", toVar: "u", edgeType: "Connect" },
      ],
    });
    const wcojCode = compileWcojMatcher(plan);
    expect(wcojCode).toContain("leapfrog_init_from_dpo_edges(iter1Ptr, graphPtr,");
    expect(wcojCode).toContain("leapfrog_init_from_dpo_edges(iter2Ptr, graphPtr,");
    expect(wcojCode).toContain("leapfrog_init_from_dpo_edges(iter3Ptr, graphPtr,");
    expect(wcojCode).toContain("leapfrog_intersect_3(iter1Ptr, iter2Ptr, iter3Ptr, resultZSetPtr)");
  });

  it("inverts commutative 2-step affine expressions and detects shared-vertex CPA cycles without cross-language false positives", () => {
    const inv1 = invertExpression("f = 1.8 * c + 32");
    expect(inv1.isInvertible).toBe(true);
    expect(inv1.sourceVar).toBe("c");
    expect(inv1.targetVar).toBe("f");
    expect(inv1.invertedExpr).toBe("(f - 32) / 1.8");

    const inv2 = invertExpression("y = 100 - 2.5 * x");
    expect(inv2.isInvertible).toBe(true);
    expect(inv2.sourceVar).toBe("x");
    expect(inv2.invertedExpr).toBe("(100 - y) / 2.5");

    const inv3 = invertExpression("y = 10 + x * 4");
    expect(inv3.isInvertible).toBe(true);
    expect(inv3.sourceVar).toBe("x");
    expect(inv3.invertedExpr).toBe("(y - 10) / 4");

    // Cross-language rules sharing a generic node type name ("Component") in incompatible language directions should NOT trigger a false cycle
    const noCycleReport = runCPA([
      {
        name: "SysmlToSspComponent",
        sourceLang: "sysml2",
        targetLang: "ssp",
        source: ($) => $.PartUsage({ name: "x" }),
        target: ($) => $.Component({ name: "x" }),
      },
      {
        name: "StepToSysmlComponent",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($) => $.Component({ name: "x" }),
        target: ($) => $.PartUsage({ name: "x" }),
      },
    ]);
    expect(noCycleReport.cycles.length).toBe(0);

    // Two distinct cycles sharing a common vertex A (A -> B -> A and A -> C -> A) should both be detected
    const multiCycleReport = runCPA([
      {
        name: "R_AB",
        source: ($) => $.NodeA({ name: "x" }),
        target: ($) => $.NodeB({ name: "x" }),
      },
      {
        name: "R_BA",
        source: ($) => $.NodeB({ name: "x" }),
        target: ($) => $.NodeA({ name: "x" }),
      },
      {
        name: "R_AC",
        source: ($) => $.NodeA({ name: "x" }),
        target: ($) => $.NodeC({ name: "x" }),
      },
      {
        name: "R_CA",
        source: ($) => $.NodeC({ name: "x" }),
        target: ($) => $.NodeA({ name: "x" }),
      },
    ]);
    expect(multiCycleReport.cycles.length).toBeGreaterThanOrEqual(2);

    // Losslessness verifier should recognize renamed pattern variables (mass: v("m"), accel: v("a"))
    // in multi-variable invertible constraints ("F = m * a")
    const losslessReport = verifyRuleLosslessness(
      tggRule({
        name: "NewtonForceRule",
        source: ($, v) => $.RigidBody({ mass: v("m"), accel: v("a") }),
        target: ($, v) => $.ForceLoad({ force: v("F") }),
        where: () => [tggInvertible("F = m * a")],
      }),
    );
    expect(losslessReport.status).toBe("PROVEN_LOSSLESS");
    expect(losslessReport.leakedAttributes.length).toBe(0);
  });
});
