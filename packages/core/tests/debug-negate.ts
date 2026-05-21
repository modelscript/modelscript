import { ArenaDAEPrinter, BinOp, ExprKind, UnaryOp } from "@modelscript/compiler";
import Modelica from "@modelscript/modelica/parser";
import { StringWriter } from "@modelscript/utils";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const source = `
model HelloWorld
  Real x(start = 1);
  parameter Real a = 1;
equation
  der(x) = -a * x;
end HelloWorld;
`;

const context = new Context(new NodeFileSystem());
context.load(source);

const dae = context.flattenDAE("HelloWorld", {
  arrayMode: "scalarize",
  functionInlining: "inline",
  canonicalizeEquations: false,
});

if (dae) {
  const arena = dae.arena;
  const out = new StringWriter();
  const printer = new ArenaDAEPrinter(out, arena);
  printer.printDAE(arena);
  console.log("=== DAE Output ===");
  console.log(out.toString());

  for (let i = 0; i < arena.eqCount; i++) {
    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);
    console.log(`\n=== Equation ${i}: lhs=${lhs}, rhs=${rhs} ===`);

    const traceExpr = (id: number, depth = 0): void => {
      if (id < 0) return;
      const indent = "  ".repeat(depth);
      const kind = arena.getExprKind(id);
      const kindName = ExprKind[kind] ?? `?${kind}`;
      const data1 = arena.getExprData1(id);
      const left = arena.getExprLeft(id);
      const right = arena.getExprRight(id);

      let extra = "";
      if (kind === ExprKind.Name) extra = ` name="${arena.interner.resolve(data1)}"`;
      if (kind === ExprKind.Binary) extra = ` op=${BinOp[data1]}`;
      if (kind === ExprKind.Unary) extra = ` op=${UnaryOp[data1]}`;
      if (kind === ExprKind.RealLiteral) extra = ` val=${data1}`;
      if (kind === ExprKind.Negate) extra = ` (dedicated negate)`;

      console.log(`${indent}[${id}] ${kindName}${extra} left=${left} right=${right} data1=${data1}`);

      if (kind === ExprKind.Binary) {
        console.log(`${indent}  LHS:`);
        traceExpr(left, depth + 2);
        console.log(`${indent}  RHS:`);
        traceExpr(right, depth + 2);
      } else if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
        traceExpr(left, depth + 1);
      } else if (kind === ExprKind.Der) {
        traceExpr(data1, depth + 1);
      }
    };

    console.log("--- LHS ---");
    traceExpr(lhs);
    console.log("--- RHS ---");
    traceExpr(rhs);
  }
}
