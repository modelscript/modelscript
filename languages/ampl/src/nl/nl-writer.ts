// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — AMPL .nl Format Writer (ASL ASCII Serializer).
 *
 * Emits standard AMPL .nl format files (Gay 1997 specification) including full
 * prefix nonlinear expression opcode graphs (`C<k>` and `O<k>`), nonlinear variable
 * partition headers, cumulative Jacobian column counts (`k`), and sparsity patterns
 * for interoperability with external solvers (HiGHS, KNITRO, IPOPT, Couenne, Bonmin,
 * Gurobi, CPLEX, SCIP).
 */

import type { AmplExpr, InstantiatedProblem } from "../types.js";

const ASL_FUNCTION_OPCODES: Record<string, string> = {
  floor: "o13",
  ceil: "o14",
  abs: "o15",
  tanh: "o37",
  tan: "o38",
  sqrt: "o39",
  sinh: "o40",
  sin: "o41",
  log10: "o42",
  log: "o43",
  ln: "o43",
  exp: "o44",
  cosh: "o45",
  cos: "o46",
  atanh: "o47",
  atan2: "o48",
  atan: "o49",
  asinh: "o50",
  asin: "o51",
  acosh: "o52",
  acos: "o53",
  erf: "o56",
  erfc: "o57",
  gamma: "o58",
  lgamma: "o59",
  bessel_j0: "o60",
  besselj0: "o60",
  bessel_j1: "o61",
  besselj1: "o61",
  bessel_y0: "o62",
  bessely0: "o62",
  bessel_y1: "o63",
  bessely1: "o63",
  normal01: "o64",
  normal: "o65",
  normal_pdf: "o66",
  normalpdf: "o66",
};

/**
 * Collects all variable IDs referenced inside a nonlinear AST.
 */
export function collectNonlinearVars(
  expr: AmplExpr | undefined,
  varNameMap: Map<string, number>,
  out: Set<number>,
): void {
  if (!expr) return;
  switch (expr.kind) {
    case "identifier": {
      const id = varNameMap.get(expr.name);
      if (id !== undefined) out.add(id);
      break;
    }
    case "subscript": {
      const idxStr = expr.indices
        .map((i) => (i.kind === "number" ? String(i.value) : i.kind === "string" ? i.value : i.kind === "identifier" ? i.name : ""))
        .join(",");
      const fullName = `${expr.name}[${idxStr}]`;
      const id = varNameMap.get(fullName);
      if (id !== undefined) out.add(id);
      break;
    }
    case "unary":
      collectNonlinearVars(expr.expr, varNameMap, out);
      break;
    case "binary":
      collectNonlinearVars(expr.left, varNameMap, out);
      collectNonlinearVars(expr.right, varNameMap, out);
      break;
    case "call":
      for (const a of expr.args) collectNonlinearVars(a, varNameMap, out);
      break;
    case "if_then_else":
      collectNonlinearVars(expr.condition, varNameMap, out);
      collectNonlinearVars(expr.thenExpr, varNameMap, out);
      collectNonlinearVars(expr.elseExpr, varNameMap, out);
      break;
    case "reduction":
      collectNonlinearVars(expr.expr, varNameMap, out);
      break;
  }
}

/**
 * Serializes a nonlinear `AmplExpr` tree into ASL prefix opcode lines.
 */
export function serializeAslExprTree(
  expr: AmplExpr,
  varNameMap: Map<string, number>,
  lines: string[],
): void {
  switch (expr.kind) {
    case "number":
      lines.push(`n${expr.value}`);
      return;

    case "identifier": {
      const id = varNameMap.get(expr.name);
      if (id !== undefined) {
        lines.push(`v${id}`);
      } else {
        lines.push("n0");
      }
      return;
    }

    case "subscript": {
      const idxStr = expr.indices
        .map((i) => (i.kind === "number" ? String(i.value) : i.kind === "string" ? i.value : i.kind === "identifier" ? i.name : ""))
        .join(",");
      const fullName = `${expr.name}[${idxStr}]`;
      const id = varNameMap.get(fullName);
      if (id !== undefined) {
        lines.push(`v${id}`);
      } else {
        lines.push("n0");
      }
      return;
    }

    case "unary": {
      if (expr.op === "-") {
        lines.push("o16");
        serializeAslExprTree(expr.expr, varNameMap, lines);
      } else if (expr.op === "not" || expr.op === "!") {
        lines.push("o34");
        serializeAslExprTree(expr.expr, varNameMap, lines);
      } else {
        serializeAslExprTree(expr.expr, varNameMap, lines);
      }
      return;
    }

    case "binary": {
      switch (expr.op) {
        case "+":
          lines.push("o0");
          break;
        case "-":
          lines.push("o1");
          break;
        case "*":
          lines.push("o2");
          break;
        case "/":
          lines.push("o3");
          break;
        case "mod":
          lines.push("o4");
          break;
        case "^":
        case "**":
          lines.push("o5");
          break;
        case "or":
          lines.push("o20");
          break;
        case "and":
          lines.push("o21");
          break;
        case "<":
          lines.push("o22");
          break;
        case "<=":
          lines.push("o23");
          break;
        case "=":
        case "==":
          lines.push("o24");
          break;
        case ">=":
          lines.push("o28");
          break;
        case ">":
          lines.push("o29");
          break;
        case "!=":
        case "<>":
          lines.push("o30");
          break;
        default:
          lines.push("o0");
          break;
      }
      serializeAslExprTree(expr.left, varNameMap, lines);
      serializeAslExprTree(expr.right, varNameMap, lines);
      return;
    }

    case "if_then_else": {
      lines.push("o35");
      serializeAslExprTree(expr.condition, varNameMap, lines);
      serializeAslExprTree(expr.thenExpr, varNameMap, lines);
      serializeAslExprTree(expr.elseExpr, varNameMap, lines);
      return;
    }

    case "call": {
      const fn = expr.fn.toLowerCase();
      if (fn === "min" || fn === "max") {
        lines.push(fn === "min" ? "o11" : "o12");
        lines.push(String(expr.args.length));
        for (const a of expr.args) {
          serializeAslExprTree(a, varNameMap, lines);
        }
        return;
      }
      const opcode = ASL_FUNCTION_OPCODES[fn];
      if (opcode) {
        lines.push(opcode);
        for (const a of expr.args) {
          serializeAslExprTree(a, varNameMap, lines);
        }
        return;
      }
      lines.push("n0");
      return;
    }

    default:
      lines.push("n0");
  }
}

export function writeNlProblem(problem: InstantiatedProblem): string {
  const nVars = problem.variables.length;
  const nConstraints = problem.constraints.length;
  const nObj = 1;

  let nRanges = 0;
  let nEq = 0;
  let nlc = 0;
  const nlVarsInCon = new Set<number>();
  const nlVarsInObj = new Set<number>();

  for (const c of problem.constraints) {
    const hasLB = Number.isFinite(c.lb) && c.lb > -1e15;
    const hasUB = Number.isFinite(c.ub) && c.ub < 1e15;
    if (hasLB && hasUB && Math.abs(c.lb - c.ub) < 1e-9) {
      nEq++;
    } else if (hasLB && hasUB) {
      nRanges++;
    }
    if (c.expr.nonlinearTree) {
      nlc++;
      collectNonlinearVars(c.expr.nonlinearTree, problem.varNameMap, nlVarsInCon);
    }
  }

  let nlo = 0;
  if (problem.objective.expr.nonlinearTree) {
    nlo = 1;
    collectNonlinearVars(problem.objective.expr.nonlinearTree, problem.varNameMap, nlVarsInObj);
  }

  let nlvb = 0;
  for (const vId of nlVarsInCon) {
    if (nlVarsInObj.has(vId)) nlvb++;
  }
  const nlvc = nlVarsInCon.size;
  const nlvo = nlVarsInObj.size;

  let nbv = 0;
  let niv = 0;
  for (const v of problem.variables) {
    if (v.type === "binary") nbv++;
    else if (v.type === "integer" || v.type === "semiint") niv++;
  }

  // Build full Jacobian entries per constraint (combining linear terms and nonlinear variable sparsity)
  const conJacobians: { varId: number; coeff: number }[][] = [];
  const colCounts = new Array<number>(nVars).fill(0);
  let nNzJacobian = 0;

  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    const coeffMap = new Map<number, number>();
    for (const t of c.expr.linearTerms) {
      coeffMap.set(t.varId, (coeffMap.get(t.varId) ?? 0) + t.coeff);
    }
    if (c.expr.nonlinearTree) {
      const cNlVars = new Set<number>();
      collectNonlinearVars(c.expr.nonlinearTree, problem.varNameMap, cNlVars);
      for (const vId of cNlVars) {
        if (!coeffMap.has(vId)) coeffMap.set(vId, 0);
      }
    }
    const entries = Array.from(coeffMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([varId, coeff]) => ({ varId, coeff }));
    conJacobians.push(entries);
    nNzJacobian += entries.length;
    for (const e of entries) {
      if (e.varId >= 0 && e.varId < nVars) colCounts[e.varId]!++;
    }
  }

  // Build Objective gradient entries (combining linear terms and nonlinear variable sparsity)
  const objGradMap = new Map<number, number>();
  for (const t of problem.objective.expr.linearTerms) {
    objGradMap.set(t.varId, (objGradMap.get(t.varId) ?? 0) + t.coeff);
  }
  if (problem.objective.expr.nonlinearTree) {
    for (const vId of nlVarsInObj) {
      if (!objGradMap.has(vId)) objGradMap.set(vId, 0);
    }
  }
  const objGradEntries = Array.from(objGradMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([varId, coeff]) => ({ varId, coeff }));

  const lines: string[] = [];

  // 1. Header (ASCII mode)
  lines.push("g3 0 1 0"); // format: text, version 3
  lines.push(`${nVars} ${nConstraints} ${nObj} ${nRanges} ${nEq} 0`);
  lines.push(`${nlc} ${nlo} 0 0 0 0`); // nonlinear constraints & objectives info
  lines.push(`0 0`); // network constraints, objectives
  lines.push(`${nlvc} ${nlvo} ${nlvb} 0 0`); // nonlinear variables in constraints, objectives, both
  lines.push(`0 0 ${nNzJacobian} ${objGradEntries.length}`); // Jacobian & Gradient non-zero counts
  lines.push(`${nbv} ${niv}`); // binary & integer counts

  // 2. Nonlinear Constraint Expression Trees (C<index>)
  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    if (c.expr.nonlinearTree) {
      lines.push(`C${i}`);
      if (Math.abs(c.expr.constant) > 1e-15) {
        lines.push("o0");
        lines.push(`n${c.expr.constant}`);
        serializeAslExprTree(c.expr.nonlinearTree, problem.varNameMap, lines);
      } else {
        serializeAslExprTree(c.expr.nonlinearTree, problem.varNameMap, lines);
      }
    } else if (nlc > 0) {
      lines.push(`C${i}`);
      lines.push(`n${c.expr.constant}`);
    }
  }

  // 3. Objective definition: O<index> <direction> (0=min, 1=max)
  const dirFlag = problem.objective.direction === "maximize" ? 1 : 0;
  lines.push(`O0 ${dirFlag}`);
  if (problem.objective.expr.nonlinearTree) {
    if (Math.abs(problem.objective.expr.constant) > 1e-15) {
      lines.push("o0");
      lines.push(`n${problem.objective.expr.constant}`);
      serializeAslExprTree(problem.objective.expr.nonlinearTree, problem.varNameMap, lines);
    } else {
      serializeAslExprTree(problem.objective.expr.nonlinearTree, problem.varNameMap, lines);
    }
  } else {
    lines.push(`n${problem.objective.expr.constant}`);
  }

  // 4. Initial guesses (x<nVars>)
  lines.push(`x${nVars}`);
  for (let i = 0; i < nVars; i++) {
    lines.push(`${i} ${problem.variables[i]!.initVal}`);
  }

  // 5. Constraint bounds (r)
  // 0: lower <= body <= upper
  // 1: body <= upper
  // 2: body >= lower
  // 3: unconstrained
  // 4: body == lower == upper
  lines.push("r");
  for (const c of problem.constraints) {
    const hasLB = Number.isFinite(c.lb) && c.lb > -1e15;
    const hasUB = Number.isFinite(c.ub) && c.ub < 1e15;
    if (hasLB && hasUB && Math.abs(c.lb - c.ub) < 1e-9) {
      lines.push(`4 ${c.lb}`);
    } else if (hasLB && hasUB) {
      lines.push(`0 ${c.lb} ${c.ub}`);
    } else if (hasUB) {
      lines.push(`1 ${c.ub}`);
    } else if (hasLB) {
      lines.push(`2 ${c.lb}`);
    } else {
      lines.push("3");
    }
  }

  // 6. Variable bounds (b)
  // 0: lower <= x <= upper
  // 1: x <= upper
  // 2: x >= lower
  // 3: free
  // 4: x == bound
  lines.push("b");
  for (const v of problem.variables) {
    const hasLB = Number.isFinite(v.lb) && v.lb > -1e15;
    const hasUB = Number.isFinite(v.ub) && v.ub < 1e15;
    if (hasLB && hasUB && Math.abs(v.lb - v.ub) < 1e-9) {
      lines.push(`4 ${v.lb}`);
    } else if (hasLB && hasUB) {
      lines.push(`0 ${v.lb} ${v.ub}`);
    } else if (hasUB) {
      lines.push(`1 ${v.ub}`);
    } else if (hasLB) {
      lines.push(`2 ${v.lb}`);
    } else {
      lines.push("3");
    }
  }

  // 7. Cumulative Jacobian column counts (k<nVars-1>)
  if (nVars > 1 && nConstraints > 0) {
    lines.push(`k${nVars - 1}`);
    let cum = 0;
    for (let j = 0; j < nVars - 1; j++) {
      cum += colCounts[j]!;
      lines.push(String(cum));
    }
  }

  // 8. Constraint Jacobian entries (J<index> <count>)
  for (let i = 0; i < nConstraints; i++) {
    const entries = conJacobians[i]!;
    if (entries.length > 0) {
      lines.push(`J${i} ${entries.length}`);
      for (const t of entries) {
        lines.push(`${t.varId} ${t.coeff}`);
      }
    }
  }

  // 9. Objective Gradient entries (G0 <count>)
  if (objGradEntries.length > 0) {
    lines.push(`G0 ${objGradEntries.length}`);
    for (const t of objGradEntries) {
      lines.push(`${t.varId} ${t.coeff}`);
    }
  }

  // 10. Suffix entries (S<kind> <count> <name>)
  const varSuffixes = new Map<string, { isFloat: boolean; entries: { id: number; val: number }[] }>();
  for (let i = 0; i < nVars; i++) {
    const v = problem.variables[i]!;
    if (v.customSuffixes) {
      for (const [sufName, val] of v.customSuffixes.entries()) {
        const numVal = typeof val === "number" ? val : Number(val) || 0;
        let group = varSuffixes.get(sufName);
        if (!group) {
          group = { isFloat: !Number.isInteger(numVal), entries: [] };
          varSuffixes.set(sufName, group);
        }
        if (!Number.isInteger(numVal)) group.isFloat = true;
        group.entries.push({ id: i, val: numVal });
      }
    }
  }

  for (const [sufName, group] of varSuffixes.entries()) {
    if (group.entries.length > 0) {
      const kind = group.isFloat ? 2 : 0;
      lines.push(`S${kind} ${group.entries.length} ${sufName}`);
      for (const e of group.entries) {
        lines.push(`${e.id} ${e.val}`);
      }
    }
  }

  const conSuffixes = new Map<string, { isFloat: boolean; entries: { id: number; val: number }[] }>();
  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    if (c.customSuffixes) {
      for (const [sufName, val] of c.customSuffixes.entries()) {
        const numVal = typeof val === "number" ? val : Number(val) || 0;
        let group = conSuffixes.get(sufName);
        if (!group) {
          group = { isFloat: !Number.isInteger(numVal), entries: [] };
          conSuffixes.set(sufName, group);
        }
        if (!Number.isInteger(numVal)) group.isFloat = true;
        group.entries.push({ id: i, val: numVal });
      }
    }
  }

  for (const [sufName, group] of conSuffixes.entries()) {
    if (group.entries.length > 0) {
      const kind = group.isFloat ? 3 : 1;
      lines.push(`S${kind} ${group.entries.length} ${sufName}`);
      for (const e of group.entries) {
        lines.push(`${e.id} ${e.val}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}
