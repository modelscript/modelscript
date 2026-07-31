import { describe, expect, it } from "@jest/globals";
import { generateTypeSystem } from "../src/codegen/typesys.js";

describe("Subtyping Predicates Lambda Support", () => {
  it("should generate AssemblyScript subtyping logic for string and lambda predicates", () => {
    const dsl = {
      name: "SubtypingTestDSL",
      rules: {
        Main: "x",
      },
      typeSystem: {
        subtypingPredicates: [
          "SubClassOf",
          (db: any, src: number, tgt: number) => {
            return src === tgt || db.model.hasFlag(src, "IS_COMPONENT");
          },
        ],
      },
    };

    const code = generateTypeSystem(dsl as any, "");

    // Verify string predicate generated factExists check
    expect(code).toContain("factExists(");

    // Verify lambda predicate transpilation
    expect(code).toContain("let src = sourceId;");
    expect(code).toContain("let tgt = targetId;");
    expect(code).toContain("src === tgt");
    expect(code).toContain("NodeFlag.IS_COMPONENT");
  });
});
