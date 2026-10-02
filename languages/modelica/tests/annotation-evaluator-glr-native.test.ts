// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AnnotationEvaluator, evalSafeArithmetic, evaluateCSTExpression } from "../src/diagram/annotation-evaluator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("GLR-Native Annotation Evaluator & CST Direct Lowering", async () => {
  const { parser } = await createWasmParser(modelicaWasm);

  describe("1. Arithmetic Tokenizer Without Whitespace & Exponentiation Associativity", () => {
    it("parses arithmetic expressions without spaces around + and -", () => {
      assert.strictEqual(evalSafeArithmetic("10+20"), 30);
      assert.strictEqual(evalSafeArithmetic("10-20"), -10);
      assert.strictEqual(evalSafeArithmetic("100/5+3*2-4"), 22);
    });

    it("evaluates scientific notation without eating subsequent operators", () => {
      assert.strictEqual(evalSafeArithmetic("1e-3"), 0.001);
      assert.strictEqual(evalSafeArithmetic("1e+3"), 1000);
      assert.strictEqual(evalSafeArithmetic("1e2+50"), 150);
    });

    it("evaluates exponentiation as right-associative per Modelica §3.2", () => {
      // 2 ^ 3 ^ 2 = 2 ^ (3 ^ 2) = 2 ^ 9 = 512
      assert.strictEqual(evalSafeArithmetic("2^3^2"), 512);
    });
  });

  describe("2. Comprehensive Positional Argument Mapping on Graphical Primitives", () => {
    it("maps positional arguments for Text correctly (extent and string)", () => {
      const src = `
model PositionalTextTest
  annotation(Icon(graphics = {
    Text({{-10, -10}, {10, 10}}, "StatusLabel")
  }));
end PositionalTextTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();
      const icon = evaluator.evaluate(tree.rootNode, "Icon");
      assert.ok(icon?.graphics?.[0]);
      const textItem = icon.graphics[0];
      assert.strictEqual(textItem["@type"], "Text");
      assert.deepStrictEqual(textItem.extent, [
        [-10, -10],
        [10, 10],
      ]);
      assert.strictEqual(textItem.textString, "StatusLabel");
      assert.strictEqual(textItem.string, "StatusLabel");
    });

    it("maps positional arguments for Line with visible, points, and color", () => {
      const src = `
model PositionalLineTest
  annotation(Icon(graphics = {
    Line(true, {{0, 0}, {50, 50}}, {255, 0, 0})
  }));
end PositionalLineTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();
      const icon = evaluator.evaluate(tree.rootNode, "Icon");
      assert.ok(icon?.graphics?.[0]);
      const lineItem = icon.graphics[0];
      assert.strictEqual(lineItem["@type"], "Line");
      assert.strictEqual(lineItem.visible, true);
      assert.deepStrictEqual(lineItem.points, [
        [0, 0],
        [50, 50],
      ]);
      assert.deepStrictEqual(lineItem.color, [255, 0, 0]);
    });
  });

  describe("3. DynamicSelect CST Unwrapping, Property Propagation & Export", () => {
    it("extracts DynamicSelect from CST without null-coercion and records property name", () => {
      const src = `
model DynamicSelectTest
  Boolean activeColor = true;
  annotation(Icon(graphics = {
    Line(color = DynamicSelect({0, 0, 0}, activeColor), points = {{0, 0}, {10, 10}})
  }));
end DynamicSelectTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();
      const icon = evaluator.evaluate(tree.rootNode, "Icon");

      assert.ok(icon?.graphics?.[0]);
      const lineItem = icon.graphics[0];
      assert.strictEqual(lineItem["@type"], "Line");
      assert.deepStrictEqual(lineItem.color, [0, 0, 0]);
      assert.deepStrictEqual(lineItem.points, [
        [0, 0],
        [10, 10],
      ]);

      assert.strictEqual(evaluator.dynamicBindings.length, 1);
      assert.strictEqual(evaluator.dynamicBindings[0].property, "color");
      assert.strictEqual(evaluator.dynamicBindings[0].variableName, "activeColor");
      assert.deepStrictEqual(evaluator.dynamicBindings[0].staticExpr, [0, 0, 0]);

      // Verify dynamicBindings is attached to returned icon object
      assert.ok(icon.dynamicBindings);
      assert.strictEqual(icon.dynamicBindings.length, 1);
      assert.strictEqual(icon.dynamicBindings[0].property, "color");
    });
  });

  describe("4. Direct CST Array Evaluation With Logic and Math", () => {
    it("evaluates if-then-else expressions inside CST array literals", () => {
      const src = `
model ArrayLogicTest
  parameter Boolean flag = true;
  parameter Real arr[2] = {if flag then 10 else 20, 30};
end ArrayLogicTest;
`;
      const tree = parser.parse(src);
      function findComp(node: any): any {
        if (node.type === "component_declaration" && node.text?.includes("arr")) return node;
        for (const c of node.children) {
          const f = findComp(c);
          if (f) return f;
        }
        return null;
      }
      const comp = findComp(tree.rootNode);
      const modExpr = comp.children
        .find((c: any) => c.type === "declaration")
        ?.children.find((c: any) => c.type === "modification")
        ?.children.find((c: any) => c.type === "modification_expression");

      const scope = {
        flag: true,
        resolveSimpleName: (name: string) => (name === "flag" ? true : undefined),
      };

      const result = evaluateCSTExpression(modExpr, scope);
      assert.deepStrictEqual(result, [10, 30]);
    });

    it("evaluates binary expressions directly inside CST arrays", () => {
      const src = `
model ArrayMathTest
  parameter Real arr[3] = {10+20, -50+5, 2*3};
end ArrayMathTest;
`;
      const tree = parser.parse(src);
      function findComp(node: any): any {
        if (node.type === "component_declaration" && node.text?.includes("arr")) return node;
        for (const c of node.children) {
          const f = findComp(c);
          if (f) return f;
        }
        return null;
      }
      const comp = findComp(tree.rootNode);
      const modExpr = comp.children
        .find((c: any) => c.type === "declaration")
        ?.children.find((c: any) => c.type === "modification")
        ?.children.find((c: any) => c.type === "modification_expression");

      const result = evaluateCSTExpression(modExpr);
      assert.deepStrictEqual(result, [30, -45, 6]);
    });

    it("evaluates 2D matrix notation with semicolon row separators from CST", () => {
      const src = `
model MatrixCstTest
  parameter Real m[2, 2] = [1, 2; 3, 4];
end MatrixCstTest;
`;
      const tree = parser.parse(src);
      function findComp(node: any): any {
        if (node.type === "component_declaration" && node.text?.includes("m")) return node;
        for (const c of node.children) {
          const f = findComp(c);
          if (f) return f;
        }
        return null;
      }
      const comp = findComp(tree.rootNode);
      const modExpr = comp.children
        .find((c: any) => c.type === "declaration")
        ?.children.find((c: any) => c.type === "modification")
        ?.children.find((c: any) => c.type === "modification_expression");

      const result = evaluateCSTExpression(modExpr);
      assert.deepStrictEqual(result, [
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe("5. Repeated Key Aggregation into Arrays (choices annotation)", () => {
    it("aggregates repeated choice arguments into an array rather than overwriting", () => {
      const src = `
model ChoicesTest
  parameter Real x = 1 annotation(choices(choice = 1, choice = 2, choice = 3));
end ChoicesTest;
`;
      const tree = parser.parse(src);
      function findComp(node: any): any {
        if (node.type === "component_declaration") return node;
        for (const c of node.children) {
          const f = findComp(c);
          if (f) return f;
        }
        return null;
      }
      const comp = findComp(tree.rootNode);
      const evaluator = new AnnotationEvaluator();
      const choices = evaluator.evaluate(comp, "choices");
      assert.ok(choices);
      assert.strictEqual(choices["@type"], "choices");
      assert.deepStrictEqual(choices.choice, [1, 2, 3]);
    });
  });

  describe("6. Fast-Path Optimization Check", () => {
    it("immediately returns null when node text does not include 'annotation'", () => {
      const src = `
model FastPathTest
  Real x = 10;
equation
  x = 20;
end FastPathTest;
`;
      const tree = parser.parse(src);
      function findEq(node: any): any {
        if (node.type === "equation") return node;
        for (const c of node.children) {
          const f = findEq(c);
          if (f) return f;
        }
        return null;
      }
      const eq = findEq(tree.rootNode);
      const evaluator = new AnnotationEvaluator();
      const res = evaluator.evaluate(eq, "diffusion");
      assert.strictEqual(res, null);
    });
  });
});
