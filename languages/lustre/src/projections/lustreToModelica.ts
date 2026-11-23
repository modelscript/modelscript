// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from Lustre synchronous dataflow programs to Modelica 3.3+ Synchronous Clocks
 * (`Clock`, `previous`, `sample`, `hold`, `firstTick`).
 */

import type { LustreExpr, LustreNodeDecl, LustreProgram, LustreType } from "../types.js";

export interface LustreToModelicaOptions {
  /** Base periodic clock sample interval in seconds (default `0.01`). */
  samplePeriod?: number;
  /** Optional enclosing Modelica package name. */
  packageName?: string;
}

function mapModelicaType(t: LustreType): string {
  if (t.kind === "base") {
    if (t.name === "bool") return "Boolean";
    if (t.name === "int") return "Integer";
    return "Real";
  }
  if (t.kind === "named") return t.name;
  return `${mapModelicaType(t.element)}[${t.size}]`;
}

function defaultStartLiteral(t: LustreType): string {
  if (t.kind === "base") {
    if (t.name === "bool") return "false";
    if (t.name === "int") return "0";
    return "0.0";
  }
  return "0.0";
}

function emitExpr(expr: LustreExpr, sampledInputs: Set<string>): string {
  switch (expr.kind) {
    case "bool":
      return expr.value ? "true" : "false";
    case "int":
    case "real":
      return String(expr.value);
    case "var":
      return sampledInputs.has(expr.name) ? `${expr.name}_clk` : expr.name;
    case "unary": {
      const inner = emitExpr(expr.operand, sampledInputs);
      if (expr.op === "pre") return `previous(${inner})`;
      if (expr.op === "current") return `hold(${inner})`;
      if (expr.op === "not") return `(not ${inner})`;
      return `(-${inner})`;
    }
    case "binary": {
      const l = emitExpr(expr.left, sampledInputs);
      const r = emitExpr(expr.right, sampledInputs);
      if (expr.op === "->") {
        return `(if firstTick() then ${l} else ${r})`;
      }
      if (expr.op === "when") {
        return `subSample(${l}, ${r})`;
      }
      if (expr.op === "=>") {
        return `((not ${l}) or ${r})`;
      }
      if (expr.op === "xor") {
        return `(${l} <> ${r})`;
      }
      if (expr.op === "div") {
        return `div(${l}, ${r})`;
      }
      if (expr.op === "mod") {
        return `mod(${l}, ${r})`;
      }
      if (expr.op === "=") {
        return `(${l} == ${r})`;
      }
      return `(${l} ${expr.op} ${r})`;
    }
    case "if":
      return `(if ${emitExpr(expr.cond, sampledInputs)} then ${emitExpr(expr.thenExpr, sampledInputs)} else ${emitExpr(expr.elseExpr, sampledInputs)})`;
    case "merge":
      return `(if ${sampledInputs.has(expr.clockVar) ? `${expr.clockVar}_clk` : expr.clockVar} then ${emitExpr(expr.trueExpr, sampledInputs)} else ${emitExpr(expr.falseExpr, sampledInputs)})`;
    case "call": {
      const args = expr.args.map((a) => emitExpr(a, sampledInputs)).join(", ");
      if (expr.callee === "int") return `integer(${args})`;
      if (expr.callee === "real") return `Real(${args})`;
      return `${expr.callee}(${args})`;
    }
    case "tuple":
      return `(${expr.elements.map((e) => emitExpr(e, sampledInputs)).join(", ")})`;
    case "array":
      return `{${expr.elements.map((e) => emitExpr(e, sampledInputs)).join(", ")}}`;
    case "index":
      return `${emitExpr(expr.array, sampledInputs)}[${emitExpr(expr.index, sampledInputs)} + 1]`;
  }
}

function emitNode(node: LustreNodeDecl, samplePeriod: number, indent: string): string {
  const lines: string[] = [];
  const sampledInputs = new Set<string>(node.inputs.map((v) => v.name));

  lines.push(`${indent}model ${node.name} "Projected from Lustre ${node.kind} ${node.name}"`);
  lines.push(`${indent}  parameter Real Ts = ${samplePeriod} "Base synchronous clock period [s]";`);
  lines.push(`${indent}  Clock clk = Clock(Ts);`);

  // Continuous/external input ports + clocked sampled streams
  for (const inp of node.inputs) {
    const mType = mapModelicaType(inp.type);
    lines.push(`${indent}  input ${mType} ${inp.name};`);
    lines.push(`${indent}  ${mType} ${inp.name}_clk;`);
  }

  // Output ports (held for continuous consumers) + internal clocked outputs
  for (const out of node.outputs) {
    const mType = mapModelicaType(out.type);
    lines.push(`${indent}  output ${mType} ${out.name}_out;`);
    lines.push(`${indent}  ${mType} ${out.name}(start = ${defaultStartLiteral(out.type)});`);
  }

  // Local clocked variables
  for (const loc of node.locals) {
    const mType = mapModelicaType(loc.type);
    lines.push(`${indent}  ${mType} ${loc.name}(start = ${defaultStartLiteral(loc.type)});`);
  }

  lines.push(`${indent}equation`);

  // Sample inputs onto base clock
  for (const inp of node.inputs) {
    lines.push(`${indent}  ${inp.name}_clk = sample(${inp.name}, clk);`);
  }

  // Clocked dataflow equations
  for (const eq of node.equations) {
    const lhsText = eq.lhs.length === 1 ? eq.lhs[0]! : `(${eq.lhs.join(", ")})`;
    lines.push(`${indent}  ${lhsText} = ${emitExpr(eq.rhs, sampledInputs)};`);
  }

  // Hold clocked outputs for continuous-time consumers
  for (const out of node.outputs) {
    lines.push(`${indent}  ${out.name}_out = hold(${out.name});`);
  }

  // Synchronous assertions
  for (const a of node.assertions) {
    lines.push(`${indent}  assert(${emitExpr(a.expr, sampledInputs)}, "Lustre assertion violated in ${node.name}");`);
  }

  lines.push(`${indent}end ${node.name};`);
  return lines.join("\n");
}

/**
 * Projects a parsed Lustre program into Modelica 3.3+ synchronous clocked source code.
 */
export function lustreToModelica(program: LustreProgram, options: LustreToModelicaOptions = {}): string {
  const samplePeriod = options.samplePeriod ?? 0.01;
  const pkgName = options.packageName;
  const lines: string[] = [];

  if (pkgName) {
    lines.push(`package ${pkgName} "Auto-generated from Lustre synchronous dataflow program"`);
  }

  const indent = pkgName ? "  " : "";

  for (const c of program.consts) {
    const mType = c.type
      ? mapModelicaType(c.type)
      : c.value?.kind === "bool"
        ? "Boolean"
        : c.value?.kind === "int"
          ? "Integer"
          : "Real";
    const valStr = c.value ? ` = ${emitExpr(c.value, new Set())}` : "";
    lines.push(`${indent}constant ${mType} ${c.name}${valStr};`);
  }

  for (const node of program.nodes) {
    if (lines.length > 0) lines.push("");
    lines.push(emitNode(node, samplePeriod, indent));
  }

  if (pkgName) {
    lines.push(`end ${pkgName};`);
  }

  return lines.join("\n") + "\n";
}
