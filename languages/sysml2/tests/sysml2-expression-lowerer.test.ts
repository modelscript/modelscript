// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, ExprKind, initBltWasm, UnaryOp } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { findCstDescendants } from "../src/flattener/cst-lowerer.js";
import { lowerDirectCstExpression } from "../src/flattener/expression-lowerer.js";
import { getSysmlParser } from "../src/sysml2-dae-lowerer.js";

describe("SysML v2 Direct CST Expression Lowerer", async () => {
  await initBltWasm();
  const parser = getSysmlParser();

  test("lowers arithmetic expressions directly from CST without string tokens", () => {
    const src = `
      package Test {
        part def P {
          attribute a : Real;
          attribute b : Real;
          attribute c : Real;
          attribute y : Real;
          constraint c1 {
            y == a + b * c;
          }
        }
      }
    `;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);

    const eqNodes = findCstDescendants(tree.rootNode, "EqualityExpression");
    assert.ok(eqNodes.length > 0);
    const eq = eqNodes[0]!;

    const arena = new DAEBuilder();
    const localNames = new Set(["a", "b", "c", "y"]);

    const rhsNode = eq.child ? eq.child(2) : eq.children?.[2];
    assert.ok(rhsNode);

    const exprId = lowerDirectCstExpression(rhsNode, arena, "p1.", localNames);
    assert.ok(exprId >= 0);

    // Root should be BinOp.Add
    assert.equal(arena.getExprKind(exprId), ExprKind.Binary);
    assert.equal(arena.getExprData1(exprId), BinOp.Add);

    // Left should be p1.a
    const leftId = arena.getExprLeft(exprId);
    assert.equal(arena.getExprKind(leftId), ExprKind.Name);
    const leftNameId = arena.getExprData1(leftId);
    assert.equal(arena.interner.resolve(leftNameId), "p1.a");

    // Right should be BinOp.Mul(p1.b, p1.c)
    const rightId = arena.getExprRight(exprId);
    assert.equal(arena.getExprKind(rightId), ExprKind.Binary);
    assert.equal(arena.getExprData1(rightId), BinOp.Mul);

    const bId = arena.getExprLeft(rightId);
    const cId = arena.getExprRight(rightId);
    assert.equal(arena.interner.resolve(arena.getExprData1(bId)), "p1.b");
    assert.equal(arena.interner.resolve(arena.getExprData1(cId)), "p1.c");
  });

  test("lowers time derivatives der(x) directly from InvocationExpression CST", () => {
    const src = `
      package Test {
        part def MassSpring {
          attribute x : Real;
          attribute v : Real;
          constraint odes {
            der(x) == v;
          }
        }
      }
    `;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);

    const invocations = findCstDescendants(tree.rootNode, "InvocationExpression");
    assert.ok(invocations.length > 0);

    const arena = new DAEBuilder();
    const localNames = new Set(["x", "v"]);
    const derExprId = lowerDirectCstExpression(invocations[0]!, arena, "sys.", localNames);

    assert.equal(arena.getExprKind(derExprId), ExprKind.Der);
    const innerId = arena.getExprData1(derExprId);
    assert.equal(arena.getExprKind(innerId), ExprKind.Name);
    assert.equal(arena.interner.resolve(arena.getExprData1(innerId)), "sys.x");
  });

  test("lowers unary negation and parenthesized expressions respecting precedence", () => {
    const src = `
      package Test {
        part def Pendulum {
          attribute theta : Real;
          attribute g : Real;
          attribute L : Real;
          constraint dyn {
            der(theta) == -(g / L) * theta;
          }
        }
      }
    `;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);

    const eqNodes = findCstDescendants(tree.rootNode, "EqualityExpression");
    assert.ok(eqNodes.length > 0);

    const arena = new DAEBuilder();
    const localNames = new Set(["theta", "g", "L"]);

    const rhsNode = eqNodes[0]!.child ? eqNodes[0]!.child(2) : eqNodes[0]!.children?.[2];
    assert.ok(rhsNode);

    const exprId = lowerDirectCstExpression(rhsNode, arena, "", localNames);
    assert.ok(exprId >= 0);
    assert.equal(arena.getExprKind(exprId), ExprKind.Binary);
    assert.equal(arena.getExprData1(exprId), BinOp.Mul);

    const negDivId = arena.getExprLeft(exprId);
    assert.equal(arena.getExprKind(negDivId), ExprKind.Unary);
    assert.equal(arena.getExprData1(negDivId), UnaryOp.Negate);

    const divId = arena.getExprLeft(negDivId);
    assert.equal(arena.getExprKind(divId), ExprKind.Binary);
    assert.equal(arena.getExprData1(divId), BinOp.Div);
  });
});
