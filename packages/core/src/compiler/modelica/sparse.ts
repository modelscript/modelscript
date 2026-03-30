/* eslint-disable @typescript-eslint/prefer-for-of */
import { StaticTapeBuilder } from "./ad-codegen.js";
import { ModelicaArrayEquation, ModelicaDAE, ModelicaExpression } from "./dae.js";

/** Extract derivative name (like der(x)) from expression without depending on external module. */
function extractDer(expr: ModelicaExpression): string | null {
  if (expr && typeof expr === "object" && "functionName" in expr && "args" in expr) {
    const fn = (expr as { functionName: string }).functionName;
    if (
      fn === "der" &&
      Array.isArray((expr as { args: unknown[] }).args) &&
      (expr as { args: unknown[] }).args.length === 1
    ) {
      const a = (expr as { args: unknown[] }).args[0];
      if (a && typeof a === "object" && "name" in a) return (a as { name: string }).name;
    }
  }
  return null;
}

export interface CCSMatrix {
  row_indices: number[];
  col_ptr: number[];
  nnz: number;
}

/**
 * Given a Bipartite Graph mapping (List of sets of dependencies per row) and a list of all column variables,
 * generates the CCS (Compressed Column Storage) arrays representing the structural sparsity of the matrix.
 */
export function buildCCS(rowsDeps: Set<string>[], columns: string[]): CCSMatrix {
  const row_indices: number[] = [];
  const col_ptr: number[] = [0];

  for (const colVar of columns) {
    // Find all rows that depend on this column variable
    const rowsForCol: number[] = [];
    for (let r = 0; r < rowsDeps.length; r++) {
      if (rowsDeps[r]?.has(colVar)) {
        rowsForCol.push(r);
      }
    }

    // CCS requires row indices to be sorted per column
    rowsForCol.sort((a, b) => a - b);

    for (const r of rowsForCol) {
      row_indices.push(r);
    }

    col_ptr.push(row_indices.length);
  }

  return {
    row_indices,
    col_ptr,
    nnz: row_indices.length,
  };
}

/**
 * Computes the Bipartite Dependency Graph for the Jacobian of the given DAE.
 * Rows = Equations (derEqs)
 * Cols = State Variables
 */
export function computeJacobianSparsity(dae: ModelicaDAE): { ccs: CCSMatrix; states: string[] } {
  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.variables.find((dv) => dv.name === baseName);
      const dims = v?.arrayDimensions ?? [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;
      for (let i = 0; i < size; i++) {
        derEqs.push({ state: `${baseName}[${i + 1}]`, rhs });
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  const tape = new StaticTapeBuilder();
  const rowsDeps: Set<string>[] = [];
  const indepVars = new Set<string>();

  for (const eq of derEqs) {
    indepVars.add(eq.state);
  }

  for (const eq of derEqs) {
    const outIdx = tape.walk(eq.rhs);
    const deps = tape.getDependencies(outIdx);

    // Keep only dependencies that are in our independent variables list
    const filteredDeps = new Set<string>();
    for (const d of deps) {
      if (indepVars.has(d)) filteredDeps.add(d);
    }

    rowsDeps.push(filteredDeps);
  }

  const states = Array.from(indepVars);
  return {
    ccs: buildCCS(rowsDeps, states),
    states,
  };
}

/**
 * Computes the Bipartite Dependency Graph for the Hessian of the Lagrangian.
 * For the Hessian, the matrix is symmetric, covering all independent variables.
 */
export function computeHessianSparsity(dae: ModelicaDAE): { ccs: CCSMatrix; states: string[] } {
  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.variables.find((dv) => dv.name === baseName);
      const dims = v?.arrayDimensions ?? [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;
      for (let i = 0; i < size; i++) {
        derEqs.push({ state: `${baseName}[${i + 1}]`, rhs });
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  const tape = new StaticTapeBuilder();
  const indepVars = new Set<string>();
  for (const eq of derEqs) indepVars.add(eq.state);
  const states = Array.from(indepVars);

  const eqIndices: number[] = [];
  for (const eq of derEqs) {
    eqIndices.push(tape.walk(eq.rhs));
  }

  let lagrangianNode = tape.pushOp({ type: "const", val: 0.0 });
  for (let i = 0; i < eqIndices.length; i++) {
    const lamVar = tape.pushOp({ type: "var", name: `LAMBDA_${i}` });
    const term = tape.pushOp({ type: "mul", a: lamVar, b: eqIndices[i]! }); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    lagrangianNode = tape.pushOp({ type: "add", a: lagrangianNode, b: term });
  }

  // To find the sparsity of the Hessian, we want to know which inputs interact with which inputs.
  // We can do this by running a forward pass on the Tape structural dependencies logic,
  // or simply assuming the Hessian is dense for NLP (which is often true for small models),
  // but let's do structural interaction:
  // If `t_i = f(t_a, t_b)`, any variable in `deps(a)` interacts with `deps(b)`!
  // This means the upper/lower triangular Hessian matrix has non-zeros at `(v1, v2)`
  // for all `v1 in deps(a)` and `v2 in deps(b)`.

  const depsForOp = new Map<number, Set<string>>();
  for (let i = 0; i < tape.ops.length; i++) {
    const op = tape.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = new Set<string>();
    if (op.type === "var" && indepVars.has(op.name)) {
      d.add(op.name);
    } else {
      if ("a" in op && typeof op.a === "number") {
        const ad = depsForOp.get(op.a);
        if (ad) for (const v of ad) d.add(v);
      }
      if ("b" in op && typeof op.b === "number") {
        const bd = depsForOp.get(op.b);
        if (bd) for (const v of bd) d.add(v);
      }
    }
    depsForOp.set(i, d);
  }

  // Interaction graph (Adjacency List)
  const interactions = new Map<string, Set<string>>();
  for (const s of states) interactions.set(s, new Set([s])); // Diagonal is usually non-zero

  for (let i = 0; i < tape.ops.length; i++) {
    const op = tape.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    // Binary operators mix their operands
    if (op.type === "mul" || op.type === "div" || op.type === "pow") {
      const ad = depsForOp.get(op.a)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const bd = depsForOp.get(op.b)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      for (const v1 of ad) {
        for (const v2 of bd) {
          interactions.get(v1)!.add(v2); // eslint-disable-line @typescript-eslint/no-non-null-assertion
          interactions.get(v2)!.add(v1); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
      }
    }
    // Unary nonlinear operators self-interact all their dependencies
    if (
      op.type === "sin" ||
      op.type === "cos" ||
      op.type === "tan" ||
      op.type === "exp" ||
      op.type === "log" ||
      op.type === "sqrt" ||
      op.type === "pow" ||
      op.type === "div" ||
      op.type === "mul"
    ) {
      // Wait, `add` and `sub` are linear, they do NOT create cross-interactions in the Hessian!
      // But nonlinear ops do. If `f(x+y) = sin(x+y)`, the Hessian contains cross term dxdy.
      // So we interact all combinations of `deps(a)`.
      if ("a" in op && typeof op.a === "number") {
        const ad = depsForOp.get(op.a)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
        for (const v1 of ad) {
          for (const v2 of ad) {
            interactions.get(v1)!.add(v2); // eslint-disable-line @typescript-eslint/no-non-null-assertion
          }
        }
      }
    }
  }

  // Lower triangular format for IPOPT!
  const rowsDeps: Set<string>[] = [];

  for (let r = 0; r < states.length; r++) {
    const rowId = states[r]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = new Set<string>();
    for (let c = 0; c <= r; c++) {
      const colId = states[c]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (interactions.get(rowId)?.has(colId)) {
        d.add(colId);
      }
    }
    rowsDeps.push(d);
  }

  return {
    ccs: buildCCS(rowsDeps, states),
    states,
  };
}

/**
 * Emits the C-code static arrays for a given CCS matrix.
 * Example prefix: `ModelName_jacobian` -> generates `int ModelName_jacobian_row_idx[]`
 */
export function generateSparsityArraysC(ccs: CCSMatrix, prefix: string): string[] {
  const lines: string[] = [];
  lines.push(`const int ${prefix}_nnz = ${ccs.nnz};`);
  lines.push(`const int ${prefix}_row_idx[] = {${ccs.row_indices.join(", ")}};`);
  lines.push(`const int ${prefix}_col_ptr[] = {${ccs.col_ptr.join(", ")}};`);
  return lines;
}
