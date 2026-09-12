import { tggCompute, tggPath, tggRule } from "@modelscript/dsl";
import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer, type PolyglotNode } from "@modelscript/runtime/polyglot-transformer.js";
import assert from "node:assert";
import { describe, it } from "node:test";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("TGG Incremental Multi-Way Cross-Domain Digital Thread Joins", () => {
  it("should compile and evaluate multi-hop digital thread queries across domains", () => {
    const rules = [
      tggRule({
        name: "TraceRequirementToPhysicsComponent",
        source: ($, v) => $.SysMLPart({ name: v("partName") }),
        target: ($, v) => $.ModelicaComponent({ name: v("partName"), typeSpec: v("inferredType") }),
        where: (v) => [
          tggPath(v("partName"), "requirements/satisfies/id", v("reqId")),
          tggCompute(v("inferredType"), "getTypeFromRequirement", v("reqId")),
        ],
      }),
    ];

    const compiled = compileTGGRules(rules);
    expect(compiled.ruleCount).toBe(1);
    expect(compiled.sourceCode).toContain("Property path: __var_partName --[requirements/satisfies/id]--> __var_reqId");
    expect(compiled.sourceCode).toContain('Compute: __var_inferredType = query("getTypeFromRequirement", __var_reqId)');
  });

  it("should incrementally link SysML architecture, Modelica physics, and OWL2 ontological inferences", () => {
    const transformer = new PolyglotTransformer();

    // 1. Register domain emitters
    transformer.registerEmitter("modelica", (node, t) => {
      const parts: string[] = [`model ${node.name}`];
      for (const comp of node.components || []) {
        parts.push(`  ${comp.typeSpecifier} ${comp.name};`);
      }
      // Inject reasoner inferred features (e.g. from OWL2 knowledge base)
      const inferred = t.getInferredFeatures(node.name);
      for (const inf of inferred) {
        parts.push(`  parameter ${inf.type} ${inf.name} /* inferred by OWL2 reasoner */;`);
      }
      parts.push(`end ${node.name};`);
      return parts.join("\n");
    });

    // 2. Ontological background knowledge: ElectricDrivetrain must have batteryVoltage and maxTorque
    transformer.addReasonerFact("hasFeature", "ElectricDrivetrain", "batteryVoltage:Real");
    transformer.addReasonerFact("hasFeature", "ElectricDrivetrain", "maxTorque:Real");

    // 3. SysML v2 model with traceability link
    const sysmlNode: PolyglotNode = {
      name: "ElectricDrivetrain",
      components: [
        { name: "inverter", typeSpecifier: "Inverter400V" },
        { name: "motor", typeSpecifier: "PMSM" },
      ],
      requirements: [{ satisfies: { id: "REQ-POWERTRAIN-EFFICIENCY" } }] as any,
    };

    // 4. Transform to Modelica
    const modelicaCode = transformer.transform(sysmlNode, "modelica");
    expect(modelicaCode).toContain("model ElectricDrivetrain");
    expect(modelicaCode).toContain("Inverter400V inverter;");
    expect(modelicaCode).toContain("PMSM motor;");
    expect(modelicaCode).toContain("parameter Real batteryVoltage /* inferred by OWL2 reasoner */;");
    expect(modelicaCode).toContain("parameter Real maxTorque /* inferred by OWL2 reasoner */;");

    // 5. Incremental addition of an ontological fact (O(ΔN)) without reallocating models
    transformer.addReasonerFact("hasFeature", "ElectricDrivetrain", "thermalLimit:Real");
    const updatedModelica = transformer.transform(sysmlNode, "modelica");
    expect(updatedModelica).toContain("parameter Real thermalLimit /* inferred by OWL2 reasoner */;");
  });
});
