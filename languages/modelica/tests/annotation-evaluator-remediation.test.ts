// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AnnotationEvaluator,
  evalSafeArithmetic,
  evaluateCSTExpression,
  parseModelicaArrayLiteral,
} from "../src/diagram/annotation-evaluator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Annotation Evaluator Remediation & Hardening", async () => {
  const { parser } = await createWasmParser(modelicaWasm);

  describe("Phase 1: Array Literal & Number Tokenizer", () => {
    it("parses numbers with leading dots and negative signs correctly", () => {
      const res = parseModelicaArrayLiteral("{-.5, .5, 0.5, -1.25e-3}");
      assert.deepStrictEqual(res, [-0.5, 0.5, 0.5, -0.00125]);
    });

    it("handles escaped backslashes preceding quotes without breaking array parsing", () => {
      const res = parseModelicaArrayLiteral('{"C:\\\\", "D:\\\\path\\\\"}');
      assert.deepStrictEqual(res, ["C:\\", "D:\\path\\"]);
    });

    it("evaluates safe arithmetic expressions inside array literals", () => {
      const res = parseModelicaArrayLiteral("{10 + 20, -50 + 5, 2 * 3}");
      assert.deepStrictEqual(res, [30, -45, 6]);
    });

    it("supports 2D matrix notation with square brackets and semicolons", () => {
      const res = parseModelicaArrayLiteral("[1, 2; 3, 4]");
      assert.deepStrictEqual(res, [
        [1, 2],
        [3, 4],
      ]);
    });

    it("evalSafeArithmetic parses expressions with precedence and powers", () => {
      assert.strictEqual(evalSafeArithmetic("2 + 3 * 4"), 14);
      assert.strictEqual(evalSafeArithmetic("(2 + 3) * 4"), 20);
      assert.strictEqual(evalSafeArithmetic("2^3"), 8);
      assert.strictEqual(evalSafeArithmetic("-10 / 2"), -5);
      assert.strictEqual(evalSafeArithmetic("invalid!"), null);
    });
  });

  describe("Phase 2: Multi-Clause Annotation Discovery", () => {
    it("discovers all separate annotation clauses on a model", () => {
      const src = `
model MultiClauseTest
  Real x;
equation
  x = 1.0;
  annotation(Icon());
  annotation(Diagram(coordinateSystem(extent = {{-100, -100}, {100, 100}})));
  annotation(experiment(StartTime = 0, StopTime = 10 + 5));
end MultiClauseTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();

      const icon = evaluator.evaluate(tree.rootNode, "Icon");
      assert.ok(icon, "Icon annotation should be found");
      assert.strictEqual(icon["@type"], "Icon");

      const diag = evaluator.evaluate(tree.rootNode, "Diagram");
      assert.ok(diag, "Diagram annotation should be found");
      assert.strictEqual(diag["@type"], "Diagram");

      const exp = evaluator.evaluate(tree.rootNode, "experiment");
      assert.ok(exp, "experiment annotation should be found");
      assert.strictEqual(exp["@type"], "experiment");
      assert.strictEqual(exp.StartTime, 0);
      assert.strictEqual(exp.StopTime, 15);
    });
  });

  describe("Phase 3: Real CST Support in evaluateInteractive", () => {
    it("extracts Dialog and Interactive annotations directly from CST component declarations", () => {
      const src = `
model InteractiveCstTest
  parameter Real speed = 50 annotation(Dialog(min = 0, max = 100, step = 5, unit = "rpm"));
  Boolean eStop = false annotation(Interactive(type = "momentary", label = "E-Stop"));
end InteractiveCstTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();

      let speedNode: any = null;
      let stopNode: any = null;
      const walk = (n: any) => {
        if (n.type === "component_declaration" || n.type === "component_declaration1") {
          if (n.text.includes("speed")) speedNode = n;
          if (n.text.includes("eStop")) stopNode = n;
        }
        for (const c of n.children || []) walk(c);
      };
      walk(tree.rootNode);

      assert.ok(speedNode, "speed declaration node found");
      assert.ok(stopNode, "eStop declaration node found");

      const speedBinding = evaluator.evaluateInteractive(speedNode, "speed");
      assert.ok(speedBinding, "Dialog binding should be extracted from CST");
      assert.strictEqual(speedBinding.action, "slider");
      assert.strictEqual(speedBinding.variableName, "speed");
      assert.strictEqual(speedBinding.min, 0);
      assert.strictEqual(speedBinding.max, 100);
      assert.strictEqual(speedBinding.step, 5);
      assert.strictEqual(speedBinding.unit, "rpm");

      const stopBinding = evaluator.evaluateInteractive(stopNode, "eStop");
      assert.ok(stopBinding, "Interactive binding should be extracted from CST");
      assert.strictEqual(stopBinding.action, "momentary");
      assert.strictEqual(stopBinding.variableName, "eStop");
      assert.strictEqual(stopBinding.label, "E-Stop");
    });
  });

  describe("Phase 4: WASM CST Expression Lowering & Built-in Functions", () => {
    it("evaluates built-in math functions in CST expression nodes", () => {
      const src = `
model MathExprTest
  Real y = sin(0) + cos(0) + sqrt(16) + min(10, 20);
end MathExprTest;
`;
      const tree = parser.parse(src);
      let exprNode: any = null;
      const walk = (n: any) => {
        if (n.type === "expression" || n.type === "primary") {
          if (n.text.includes("sin(0)")) {
            exprNode = n;
            return;
          }
        }
        for (const c of n.children || []) walk(c);
      };
      walk(tree.rootNode);

      assert.ok(exprNode);
      // sin(0)=0 + cos(0)=1 + sqrt(16)=4 + min(10, 20)=10 = 15
      const val = evaluateCSTExpression(exprNode);
      assert.strictEqual(val, 15);
    });

    it("extracts positional points in Line and Polygon primitives without losing data", () => {
      const src = `
model PositionalPrimitiveTest
  annotation(
    Icon(graphics = {
      Line({{-10, 0}, {10, 0}}, color = {0, 0, 255}),
      Polygon({{0, 0}, {10, 10}, {0, 10}}, fillColor = {255, 0, 0})
    })
  );
end PositionalPrimitiveTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();
      const icon = evaluator.evaluate(tree.rootNode, "Icon");

      assert.ok(icon);
      assert.ok(Array.isArray(icon.graphics));
      assert.strictEqual(icon.graphics.length, 2);

      const line = icon.graphics[0];
      assert.strictEqual(line["@type"], "Line");
      assert.deepStrictEqual(line.points, [
        [-10, 0],
        [10, 0],
      ]);
      assert.deepStrictEqual(line.color, [0, 0, 255]);

      const poly = icon.graphics[1];
      assert.strictEqual(poly["@type"], "Polygon");
      assert.deepStrictEqual(poly.points, [
        [0, 0],
        [10, 10],
        [0, 10],
      ]);
      assert.deepStrictEqual(poly.fillColor, [255, 0, 0]);
    });
  });

  describe("Phase 5: Enum & Scope Resolution Alignment", () => {
    it("resolves qualified enums with package prefixes and unqualified enums", () => {
      const src = `
model EnumTest
  annotation(
    Icon(graphics = {
      Rectangle(
        extent = {{-10, -10}, {10, 10}},
        fillPattern = Modelica.Icons.FillPattern.Solid,
        linePattern = LinePattern.Dash
      )
    })
  );
end EnumTest;
`;
      const tree = parser.parse(src);
      const evaluator = new AnnotationEvaluator();
      const icon = evaluator.evaluate(tree.rootNode, "Icon");

      assert.ok(icon);
      const rect = icon.graphics[0];
      assert.strictEqual(rect["@type"], "Rectangle");
      assert.strictEqual(rect.fillPattern, "Solid");
      assert.strictEqual(rect.linePattern, "Dash");
    });

    it("evaluates standard constants Modelica.Constants.pi and e", () => {
      const piVal = evaluateCSTExpression({ text: "Modelica.Constants.pi" });
      assert.strictEqual(piVal, Math.PI);

      const eVal = evaluateCSTExpression({ text: "Modelica.Constants.e" });
      assert.strictEqual(eVal, Math.E);
    });
  });
});
