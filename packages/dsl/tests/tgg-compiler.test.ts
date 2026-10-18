// SPDX-License-Identifier: AGPL-3.0-or-later

import {
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
  });
});
