import { compileRewriteRules } from "../src/codegen/compile_rules.js";

describe("E-Graph Rewrite Rules & Simplifications", () => {
  it("compiles string S-expression rules correctly", () => {
    const rules = [
      { name: "add_zero", lhs: "x + 0", rhs: "x" },
      { name: "mul_one", lhs: "(x * 1)", rhs: "x" },
    ];
    const code = compileRewriteRules(rules);
    expect(code).toContain("// Rule: add_zero");
    expect(code).toContain("// Rule: mul_one");
    expect(code).toContain("saturateEGraph()");
    expect(code).toContain("extractAst");
  });

  it("compiles lambda combinator rules correctly", () => {
    const rules = [
      {
        name: "lambda_add_zero",
        lhs: ($, x: any) => $.add(x, 0),
        rhs: ($, x: any) => x,
      },
      {
        name: "lambda_mul_one",
        lhs: ($, x: any) => $.mul(x, 1),
        rhs: ($, x: any) => x,
      },
    ];
    const code = compileRewriteRules(rules);
    expect(code).toContain("// Rule: lambda_add_zero");
    expect(code).toContain("// Rule: lambda_mul_one");
    expect(code).toContain("isConstant(");
  });

  it("handles complex precedence and parenthesis grouping in S-expressions", () => {
    const rules = [{ name: "nested_rule", lhs: "(x + y) * 1", rhs: "x + y" }];
    const code = compileRewriteRules(rules);
    expect(code).toContain("// Rule: nested_rule");
    expect(code).toContain("op == 1282"); // mul
  });
});
