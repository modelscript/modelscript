// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a SLAM II combined discrete-continuous model into executable Modelica 3.x code.
 */

import type { SlamExprNode, SlamModel } from "../types.js";

function exprToModelica(expr: SlamExprNode): string {
  switch (expr.kind) {
    case "number":
      return Number.isInteger(expr.value) ? `${expr.value}.0` : String(expr.value);
    case "state":
      if (expr.array === "SS") return `SS_${expr.index}`;
      if (expr.array === "DD") return `der(SS_${expr.index})`;
      if (expr.array === "XX") return `XX_${expr.index}`;
      return `ATRIB_${expr.index}`;
    case "ident":
      if (expr.name === "TNOW") return "time";
      return expr.name;
    case "unary":
      return `(${expr.op}${exprToModelica(expr.operand)})`;
    case "binary":
      return `(${exprToModelica(expr.left)} ${expr.op} ${exprToModelica(expr.right)})`;
    case "call":
      return `${expr.callee.toLowerCase()}(${expr.args.map(exprToModelica).join(", ")})`;
  }
}

export function slamToModelica(model: SlamModel): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_") || "SlamModel";
  const lines: string[] = [];

  lines.push(`// Modelica 3.x projection generated from SLAM II model: ${model.name}`);
  if (model.gen) {
    lines.push(`// Analyst: ${model.gen.analyst} | Project: ${model.gen.project}`);
  }
  lines.push(`model ${modelName}`);

  // Collect initial values from INTLC
  const initSS = new Map<number, number>();
  const initXX = new Map<number, number>();
  for (const init of model.intlc) {
    if (init.kind === "SS" && init.index !== undefined && init.numericValue !== undefined) {
      initSS.set(init.index, init.numericValue);
    } else if (init.kind === "XX" && init.index !== undefined && init.numericValue !== undefined) {
      initXX.set(init.index, init.numericValue);
    }
  }

  // Gather all SS and XX indices referenced
  const ssIndices = new Set<number>(initSS.keys());
  const xxIndices = new Set<number>(initXX.keys());
  if (model.continuous) {
    for (let i = 1; i <= model.continuous.nnequations + model.continuous.nnstates; i++) {
      ssIndices.add(i);
    }
  }
  for (const eq of model.stateEquations) {
    ssIndices.add(eq.index);
  }
  for (const node of model.nodes) {
    if (node.type === "ASSIGN") {
      for (const pair of node.assignments ?? []) {
        const m = pair.lhs.match(/^(SS|XX)\((\d+)\)$/);
        if (m) {
          if (m[1] === "SS") ssIndices.add(Number.parseInt(m[2]!, 10));
          else xxIndices.add(Number.parseInt(m[2]!, 10));
        }
      }
    }
  }

  // Emit continuous state variables
  if (ssIndices.size > 0) {
    lines.push("  // SLAM II Continuous State Variables (SS)");
    for (const idx of [...ssIndices].sort((a, b) => a - b)) {
      const start = initSS.get(idx) ?? 0.0;
      lines.push(`  Real SS_${idx}(start = ${start}, fixed = true);`);
    }
  }

  // Emit discrete global variables (XX)
  if (xxIndices.size > 0) {
    lines.push("  // SLAM II Global Discrete Variables (XX)");
    for (const idx of [...xxIndices].sort((a, b) => a - b)) {
      const start = initXX.get(idx) ?? 0.0;
      lines.push(`  discrete Real XX_${idx}(start = ${start}, fixed = true);`);
    }
  }

  // Emit resource parameters & balances
  if (model.resources.size > 0) {
    lines.push("  // SLAM II Network Resources");
    for (const [name, res] of model.resources) {
      const cap = res.resourceUnits ?? 1;
      lines.push(`  parameter Real RES_${name}_cap = ${cap}.0;`);
      lines.push(`  discrete Real RES_${name}_busy(start = 0.0);`);
      lines.push(`  Real RES_${name}_avail;`);
      lines.push(`  Real RES_${name}_util;`);
    }
  }

  // Emit DETECT crossing counters
  const detectNodes = model.nodes.filter((n) => n.type === "DETECT");
  if (detectNodes.length > 0) {
    lines.push("  // SLAM II Threshold Detectors (DETECT)");
    for (const det of detectNodes) {
      lines.push(`  discrete Integer ${det.id}_crossings(start = 0);`);
    }
  }

  lines.push("equation");

  // Continuous equations
  for (const eq of model.stateEquations) {
    const rhs = exprToModelica(eq.rhsExpr);
    if (eq.lhsKind === "DD") {
      lines.push(`  der(SS_${eq.index}) = ${rhs};`);
    } else {
      lines.push(`  SS_${eq.index} = ${rhs};`);
    }
  }

  // Resource conservation equations
  for (const [name] of model.resources) {
    lines.push(`  RES_${name}_avail = RES_${name}_cap - RES_${name}_busy;`);
    lines.push(`  RES_${name}_util = RES_${name}_busy / RES_${name}_cap;`);
  }

  // DETECT when-clauses
  for (const det of detectNodes) {
    const m = (det.detectVar ?? "SS(1)").match(/^(SS|DD)\((\d+)\)$/i);
    const varName = m ? (m[1]!.toUpperCase() === "DD" ? `der(SS_${m[2]})` : `SS_${m[2]}`) : "SS_1";
    const threshold = det.detectThreshold ?? 0.0;
    const dir = (det.detectDirection ?? "XP").toUpperCase();
    const cond =
      dir === "XN" || dir === "N" || dir === "NEGATIVE" ? `${varName} <= ${threshold}` : `${varName} >= ${threshold}`;

    lines.push(`  when ${cond} then`);
    lines.push(`    ${det.id}_crossings = pre(${det.id}_crossings) + 1;`);
    lines.push(`  end when;`);
  }

  // Experiment annotation from INITIALIZE
  if (model.initialize) {
    lines.push(
      `  annotation(experiment(StartTime = ${model.initialize.ttbeg}, StopTime = ${model.initialize.ttfin}));`,
    );
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}
