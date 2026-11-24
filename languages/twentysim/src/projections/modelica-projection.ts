// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a 20-sim Bond Graph / SIDOPS model to clean acausal Modelica source code.
 */

import { parseTwentySim } from "../parser/emx-parser.js";
import type { SidopsExpr, TwentySimModel, TwentySimSubmodel } from "../types.js";

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `m_${cleaned}` : cleaned || "Main";
}

function formatExpr(expr: SidopsExpr, prefix = ""): string {
  const q = (id: string): string => (prefix ? `${prefix}_${id}` : id);
  switch (expr.kind) {
    case "number":
      return Number.isInteger(expr.value) ? `${expr.value}.0` : String(expr.value);
    case "boolean":
      return expr.value ? "true" : "false";
    case "string":
      return `"${expr.value}"`;
    case "ident":
      return expr.name === "time" ? "time" : q(expr.name);
    case "member":
      return q(`${expr.object}_${expr.field}`);
    case "unary": {
      const op = expr.op === "not" ? "not " : expr.op;
      return `(${op}${formatExpr(expr.operand, prefix)})`;
    }
    case "binary": {
      const op = expr.op === "<>" ? "<>" : expr.op;
      return `(${formatExpr(expr.left, prefix)} ${op} ${formatExpr(expr.right, prefix)})`;
    }
    case "if":
      return `(if ${formatExpr(expr.condition, prefix)} then ${formatExpr(expr.thenExpr, prefix)} else ${formatExpr(expr.elseExpr, prefix)})`;
    case "call": {
      const fn = expr.callee.toLowerCase();
      if (fn === "ddt") {
        return `der(${expr.args[0] ? formatExpr(expr.args[0], prefix) : "0.0"})`;
      }
      return `${fn}(${expr.args.map((a) => formatExpr(a, prefix)).join(", ")})`;
    }
  }
}

function emitSubmodel(sub: TwentySimSubmodel, prefix: string, decls: string[], eqs: string[]): void {
  const q = (name: string): string => (prefix ? `${prefix}_${name}` : name);

  for (const p of sub.parameters) {
    const val = typeof p.value === "number" ? p.value : 1.0;
    const kw = p.isConstant ? "constant" : "parameter";
    decls.push(`  ${kw} Real ${q(p.name)} = ${val};`);
  }

  for (const v of sub.variables) {
    const startAttr = v.initialValue !== undefined ? `(start = ${v.initialValue})` : "";
    decls.push(`  Real ${q(v.name)}${startAttr};`);
  }

  if (sub.equations.length > 0) {
    for (const eq of sub.equations) {
      if (eq.lhs.kind === "ident" && eq.rhs.kind === "call" && eq.rhs.callee.toLowerCase() === "int") {
        const integrand = eq.rhs.args[0] ? formatExpr(eq.rhs.args[0], prefix) : "0.0";
        eqs.push(`  der(${q(eq.lhs.name)}) = ${integrand};`);
      } else {
        eqs.push(`  ${formatExpr(eq.lhs, prefix)} = ${formatExpr(eq.rhs, prefix)};`);
      }
    }
  } else if (sub.submodels.length === 0) {
    const pe = q("p_e");
    const pf = q("p_f");
    switch (sub.elementKind) {
      case "R": {
        const r =
          sub.parameters.find((p) => ["r", "resistance", "b", "damping"].includes(p.name.toLowerCase()))?.value ?? 1.0;
        decls.push(`  Real ${pe};`, `  Real ${pf};`);
        eqs.push(`  ${pe} = ${r} * ${pf};`);
        break;
      }
      case "C": {
        const c =
          sub.parameters.find((p) => ["c", "capacitance", "compliance"].includes(p.name.toLowerCase()))?.value ?? 1.0;
        decls.push(`  Real ${pe};`, `  Real ${pf};`, `  Real ${q("q")}(start = 0.0);`);
        eqs.push(`  der(${q("q")}) = ${pf};`, `  ${pe} = ${q("q")} / ${c};`);
        break;
      }
      case "I": {
        const i =
          sub.parameters.find((p) => ["i", "m", "mass", "inertia", "l"].includes(p.name.toLowerCase()))?.value ?? 1.0;
        decls.push(`  Real ${pe};`, `  Real ${pf};`, `  Real ${q("p_state")}(start = 0.0);`);
        eqs.push(`  der(${q("p_state")}) = ${pe};`, `  ${pf} = ${q("p_state")} / ${i};`);
        break;
      }
      case "Se": {
        const e =
          sub.parameters.find((p) => ["effort", "e", "value", "f", "v"].includes(p.name.toLowerCase()))?.value ?? 1.0;
        decls.push(`  Real ${pe};`, `  Real ${pf};`);
        eqs.push(`  ${pe} = ${e};`);
        break;
      }
      case "Sf": {
        const f = sub.parameters.find((p) => ["flow", "f", "value"].includes(p.name.toLowerCase()))?.value ?? 1.0;
        decls.push(`  Real ${pe};`, `  Real ${pf};`);
        eqs.push(`  ${pf} = ${f};`);
        break;
      }
      default:
        break;
    }
  }

  for (const child of sub.submodels) {
    emitSubmodel(child, q(child.name), decls, eqs);
  }

  // Emit junction equations
  const subByName = new Map(sub.submodels.map((s) => [s.name, s]));
  const juncBonds = new Map<string, Array<{ e: string; f: string; sign: 1 | -1 }>>();

  for (const conn of sub.connections) {
    if (conn.kind === "signal") {
      eqs.push(`  ${q(`${conn.toSubmodel}_${conn.toPort}`)} = ${q(`${conn.fromSubmodel}_${conn.fromPort}`)};`);
      continue;
    }
    const fromSub = subByName.get(conn.fromSubmodel);
    const toSub = subByName.get(conn.toSubmodel);
    if (!fromSub || !toSub) continue;
    const fromIsJunc = fromSub.elementKind === "0" || fromSub.elementKind === "1";
    const toIsJunc = toSub.elementKind === "0" || toSub.elementKind === "1";
    if (!fromIsJunc && !toIsJunc) {
      eqs.push(
        `  ${q(`${conn.fromSubmodel}_${conn.fromPort}_e`)} = ${q(`${conn.toSubmodel}_${conn.toPort}_e`)};`,
        `  ${q(`${conn.fromSubmodel}_${conn.fromPort}_f`)} = ${q(`${conn.toSubmodel}_${conn.toPort}_f`)};`,
      );
      continue;
    }
    const eVar = !fromIsJunc
      ? q(`${conn.fromSubmodel}_${conn.fromPort}_e`)
      : !toIsJunc
        ? q(`${conn.toSubmodel}_${conn.toPort}_e`)
        : q(`${conn.id}_e`);
    const fVar = !fromIsJunc
      ? q(`${conn.fromSubmodel}_${conn.fromPort}_f`)
      : !toIsJunc
        ? q(`${conn.toSubmodel}_${conn.toPort}_f`)
        : q(`${conn.id}_f`);

    if (fromIsJunc) {
      if (!juncBonds.has(fromSub.name)) juncBonds.set(fromSub.name, []);
      juncBonds.get(fromSub.name)!.push({ e: eVar, f: fVar, sign: -1 });
    }
    if (toIsJunc) {
      if (!juncBonds.has(toSub.name)) juncBonds.set(toSub.name, []);
      juncBonds.get(toSub.name)!.push({ e: eVar, f: fVar, sign: 1 });
    }
  }

  for (const [jName, list] of juncBonds.entries()) {
    const junc = subByName.get(jName);
    if (!junc || list.length === 0) continue;
    if (junc.elementKind === "0") {
      for (let k = 1; k < list.length; k++) {
        eqs.push(`  ${list[k]!.e} = ${list[0]!.e};`);
      }
      const sum = list
        .map((b, idx) => (idx === 0 ? (b.sign === 1 ? b.f : `-${b.f}`) : b.sign === 1 ? ` + ${b.f}` : ` - ${b.f}`))
        .join("");
      eqs.push(`  ${sum} = 0.0;`);
    } else if (junc.elementKind === "1") {
      for (let k = 1; k < list.length; k++) {
        eqs.push(`  ${list[k]!.f} = ${list[0]!.f};`);
      }
      const sum = list
        .map((b, idx) => (idx === 0 ? (b.sign === 1 ? b.e : `-${b.e}`) : b.sign === 1 ? ` + ${b.e}` : ` - ${b.e}`))
        .join("");
      eqs.push(`  ${sum} = 0.0;`);
    }
  }
}

/**
 * Projects a 20-sim model (`.emx`/`.emxz`/`.sid`) into a self-contained Modelica model.
 */
export function twentySimToModelica(modelOrSource: TwentySimModel | string): string {
  const model = typeof modelOrSource === "string" ? parseTwentySim(modelOrSource) : modelOrSource;
  const modelName = sanitizeIdent(model.name);
  const decls: string[] = [];
  const eqs: string[] = [];

  emitSubmodel(model.root, "", decls, eqs);

  return [`model ${modelName}`, ...decls, `equation`, ...eqs, `end ${modelName};`, ""].join("\n");
}
