import { compileTGGRules } from "../src/codegen/compile_tgg.js";
import { tggCompute, tggDefaultVal, tggEq, tggRule, tggTypeMap, type PolyglotConfig } from "../src/dsl.js";
import {
  PolyglotTransformer,
  type ModelicaModel,
  type SysML2PartDef,
} from "../src/transformers/polyglot-transformer.js";

describe("TGG Polyglot End-to-End Workflow", () => {
  it("should process declarative polyglot config through compilation and transformation", () => {
    const polyglotConfig: PolyglotConfig = {
      languages: ["sysml2", "modelica"],
      reasonerBindings: ["subClassOf", "hasFeature"],
      typeMaps: {
        modelica: {
          Real: "Real",
          Integer: "Integer",
          Boolean: "Boolean",
          String: "String",
        },
      },
      rules: [
        tggRule({
          name: "ChassisToBlock",
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
          name: "WeightToParameter",
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
        tggRule({
          name: "InferredFeatureProjection",
          source: ($, v) =>
            $.ReasonerFact("hasFeature", {
              subject: v("classId"),
              object: v("featureId"),
            }),
          target: ($, v) =>
            $.ComponentDeclaration({
              name: v("featureName"),
              typeSpecifier: v("featureType"),
            }),
          where: (v) => [
            tggCompute(v("featureName"), "getFeatureName", v("featureId")),
            tggCompute(v("featureType"), "getFeatureType", v("featureId")),
          ],
        }),
      ],
    };

    // 1. AOT Compiler Stage
    const compiled = compileTGGRules(polyglotConfig);
    expect(compiled.ruleCount).toBe(3);
    expect(compiled.sourceCode).toContain("tgg_forward_ChassisToBlock");
    expect(compiled.sourceCode).toContain("tgg_forward_WeightToParameter");
    expect(compiled.sourceCode).toContain("tgg_forward_InferredFeatureProjection");

    // 2. Transformation Stage with Reasoner Inferences
    const transformer = new PolyglotTransformer(polyglotConfig);
    transformer.addReasonerFact("hasFeature", "Chassis", "stiffness:Real");

    const sysml: SysML2PartDef = {
      name: "Chassis",
      isAbstract: true,
      superclasses: ["BaseFrame"],
      attributes: [{ name: "weight", type: "Real", value: "250.0" }],
      ports: [],
      connections: [],
    };

    const modelicaCode = transformer.transformSysML2ToModelica(sysml);
    expect(modelicaCode).toContain("partial model Chassis");
    expect(modelicaCode).toContain("extends BaseFrame;");
    expect(modelicaCode).toContain("parameter Real weight = 250.0;");
    expect(modelicaCode).toContain("parameter Real stiffness; // inferred");

    // 3. Bidirectional round-trip check
    const modelicaModel: ModelicaModel = {
      name: "Chassis",
      isPartial: true,
      extends: ["BaseFrame"],
      components: [{ name: "weight", typeSpecifier: "Real", variability: "parameter", defaultValue: "250.0" }],
      connections: [],
    };

    const sysmlCode = transformer.transformModelicaToSysML2(modelicaModel);
    expect(sysmlCode).toContain("abstract part def Chassis extends BaseFrame {");
    expect(sysmlCode).toContain("attribute weight: Real = 250.0;");
    expect(sysmlCode).toContain("attribute stiffness: Real; // inferred from base");
  });
});
