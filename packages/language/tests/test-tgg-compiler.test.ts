import { compileTGGRules } from "../src/codegen/compile_tgg.js";
import { tggDefaultVal, tggEq, tggRule, tggTypeMap } from "../src/dsl.js";

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
});
