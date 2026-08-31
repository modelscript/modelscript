import { generateCodeGraphBridge } from "../src/codegen/graph.js";
import { generateTypes } from "../src/codegen/types.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

describe("Model Attributes & WASM Blackboard Tests", () => {
  it("should generate NodeFlag and Property enums for bool and property model attributes", () => {
    const testDsl = language({
      name: "TestLang",
      rules: {
        Program: ($) => repeat($.Decl),
        Decl: ($) => seq(field("name", $.Identifier), ";"),
        Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
      },
      model: {
        Decl: {
          isComponent: { type: "bool", default: true },
          weight: { type: "f64", default: 1.0 },
        },
      },
    });

    const normalized = {
      symToInt: new Map([
        ["Program", 1],
        ["Decl", 2],
        ["Identifier", 3],
      ]),
      fieldToInt: new Map([["name", 1]]),
    };

    const typesCode = generateTypes(testDsl as any, normalized as any);

    expect(typesCode).toContain("export enum NodeFlag {");
    expect(typesCode).toContain("IS_COMPONENT = 1 << 0");

    expect(typesCode).toContain("export enum Property {");
    expect(typesCode).toContain("IS_COMPONENT = 1");
    expect(typesCode).toContain("WEIGHT = 2");
  });

  it("should transpile inline functional model attributes into dispatchers", () => {
    const testDsl = language({
      name: "TestLang",
      rules: {
        Program: ($) => repeat($.Decl),
        Decl: ($) => seq(field("name", $.Identifier), ";"),
        Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
      },
      model: {
        Decl: {
          computedVal: (db, node) => 42,
        },
      },
    });

    const bridgeCode = generateCodeGraphBridge(testDsl as any);

    expect(bridgeCode).toContain("compute_attr_computedVal");
    expect(bridgeCode).toContain("return 42;");
  });
});
