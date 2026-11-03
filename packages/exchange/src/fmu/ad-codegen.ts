// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, type DAEBuilder, EqKind, ExprKind, StaticTapeBuilder } from "@modelscript/runtime";

import { type Fmi3Variable } from "./fmi3.js";

/** Extract derivative name (like der(x)) from expression without depending on external module. */
function extractDer(dae: DAEBuilder, exprId: number): string | null {
  if (exprId >= 0 && dae.getExprKind(exprId) === ExprKind.Der) {
    const operand = dae.getExprData1(exprId);
    if (operand >= 0 && dae.getExprKind(operand) === ExprKind.Name) {
      return dae.interner.resolve(dae.getExprData1(operand));
    }
  }
  return null;
}

/**
 * Compiles the entire system of derivative equations into a single C-function
 * that calculates the exact Jacobian Matrix via Reverse-Mode AD.
 */
export function generateModelEvaluateJacobian(id: string, dae: DAEBuilder, vars: Fmi3Variable[]): string[] {
  const L: string[] = [];
  L.push(`/* Exact Analytical Jacobian via Static C-Tape AD */`);
  L.push(`void ${id}_evaluate_jacobian(${id}_Instance* inst, double* jac_out) {`);

  // Map variable names to VR array lookups
  const varMap = new Map<string, string>();
  for (const v of vars) {
    varMap.set(v.name, `inst->vars[${v.valueReference}]`);
  }
  varMap.set("time", `inst->time`);

  // Gather target equations (der(x) = f(x,u))
  const derEqs: { state: string; rhs: number }[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    const kind = dae.getEqKind(idx);
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const ld = extractDer(dae, lhs);
    const rd = extractDer(dae, rhs);

    if (kind === EqKind.Array) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const targetRhs = ld ? rhs : lhs;
      const vIdx = dae.getVarIdxByName(baseName);
      const dims = vIdx >= 0 ? dae.getVarShape(vIdx) : [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;
      for (let i = 0; i < size; i++) {
        derEqs.push({ state: `${baseName}[${i + 1}]`, rhs: targetRhs });
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhs: rhs });
    else if (rd) derEqs.push({ state: rd, rhs: lhs });
  }

  const tape = new StaticTapeBuilder();
  const outputIndices: number[] = [];
  for (const eq of derEqs) {
    outputIndices.push(tape.addExpression(eq.rhs, dae));
  }

  // Generate Forward Pass (value population)
  L.push("  /* --- Forward Pass --- */");
  const fwdCode = tape.emitForwardC((name: string) => {
    return varMap.get(name) ?? "0.0 /* " + name + " */";
  });
  L.push(...fwdCode);

  // Generate Reverse Pass (Jacobian construction)
  // For each output, we do a backward sweep to get the row of the Jacobian!
  L.push("  /* --- Reverse Pass (Jacobian Construction) --- */");
  for (let row = 0; row < outputIndices.length; row++) {
    const outIdx = outputIndices[row]!;
    const derEq = derEqs[row]!;
    L.push(`  { /* Row ${row}: derivative of ${derEq.state} */`);
    const { code, gradients } = tape.emitReverseC(outIdx);
    L.push(...code.map((c) => "  " + c)); // Indent inside block

    // Assign gradients into jac_out
    for (let col = 0; col < derEqs.length; col++) {
      const colEq = derEqs[col]!;
      const stateName = colEq.state;
      const gradIdx = gradients.get(stateName);
      if (gradIdx !== undefined) {
        L.push(
          `    jac_out[${row * derEqs.length + col}] = dt[${gradIdx}]; /* d(der_${derEq.state})/d(${stateName}) */`,
        );
      } else {
        L.push(`    jac_out[${row * derEqs.length + col}] = 0.0;`);
      }
    }
    L.push(`  }`);
  }

  L.push(`}`);
  return L;
}

/**
 * Compiles the exact analytical gradient of the objective function via Reverse-Mode AD.
 */
export function generateModelEvaluateObjective(id: string, dae: DAEBuilder, vars: Fmi3Variable[]): string[] {
  const L: string[] = [];
  L.push(`/* Exact Analytical Objective */`);
  L.push(`void ${id}_evaluate_objective(${id}_Instance* inst, double* obj_out) {`);

  const varMap = new Map<string, string>();
  for (const v of vars) {
    varMap.set(v.name, `inst->vars[${v.valueReference}]`);
  }
  varMap.set("time", `inst->time`);

  if (dae.objectiveExprId < 0) {
    L.push(`  *obj_out = 0.0;`);
    L.push(`}`);
    return L;
  }

  const tape = new StaticTapeBuilder();
  const objIdx = tape.addExpression(dae.objectiveExprId, dae);

  L.push("  /* --- Forward Pass --- */");
  const fwdCode = tape.emitForwardC((name: string) => {
    return varMap.get(name) ?? "0.0 /* " + name + " */";
  });
  L.push(...fwdCode);

  L.push(`  *obj_out = t[${objIdx}];`);
  L.push(`}`);

  L.push(``);
  L.push(`/* Exact Analytical Objective Gradient via Reverse-Mode AD */`);
  L.push(`void ${id}_evaluate_objective_gradient(${id}_Instance* inst, double* grad_out) {`);

  // We assume optimization variables are the continuous states + inputs.
  // In a real shooting method, variables are discrete nodes of states/inputs, but for now
  // we compute gradients w.r.t the continuous model states and inputs.
  const optVars = vars.filter((v) => v.causality === "input" || v.causality === "local");

  if (dae.objectiveExprId < 0) {
    for (let i = 0; i < optVars.length; i++) L.push(`  grad_out[${i}] = 0.0;`);
    L.push(`}`);
    return L;
  }

  L.push("  /* --- Forward Pass --- */");
  L.push(...fwdCode); // Re-use forward code from objective

  L.push("  /* --- Reverse Pass (Gradient Construction) --- */");
  const { code, gradients } = tape.emitReverseC(objIdx);
  L.push(...code);

  for (let i = 0; i < optVars.length; i++) {
    const v = optVars[i]!;
    const gradIdx = gradients.get(v.name);
    if (gradIdx !== undefined) {
      L.push(`  grad_out[${i}] = dt[${gradIdx}]; /* d(obj)/d(${v.name}) */`);
    } else {
      L.push(`  grad_out[${i}] = 0.0;`);
    }
  }

  L.push(`}`);
  return L;
}

/**
 * Compiles the exact Hessian Matrix of the Lagrangian via Reverse-Over-Forward AD.
 */
export function generateModelEvaluateHessian(id: string, dae: DAEBuilder, vars: Fmi3Variable[]): string[] {
  const L: string[] = [];
  L.push(`/* Exact Analytical Hessian of Lagrangian via Reverse-Over-Forward AD */`);
  L.push(`void ${id}_evaluate_hessian(${id}_Instance* inst, double obj_factor, double* lambda, double* hess_out) {`);

  const varMap = new Map<string, string>();
  for (const v of vars) {
    varMap.set(v.name, `inst->vars[${v.valueReference}]`);
  }
  varMap.set("time", `inst->time`);

  const derEqs: { state: string; rhs: number }[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.Array) continue;
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const ld = extractDer(dae, lhs);
    const rd = extractDer(dae, rhs);
    if (ld) derEqs.push({ state: ld, rhs: rhs });
    else if (rd) derEqs.push({ state: rd, rhs: lhs });
  }

  const tape = new StaticTapeBuilder();

  const indepVars: string[] = [];
  for (const eq of derEqs) {
    if (!indepVars.includes(eq.state)) indepVars.push(eq.state);
  }

  const eqIndices: number[] = [];
  for (const eq of derEqs) {
    eqIndices.push(tape.addExpression(eq.rhs, dae));
  }

  let lagrangianNode = tape.pushOp({ type: "const", val: 0.0 });
  for (let i = 0; i < eqIndices.length; i++) {
    const lamVar = tape.pushOp({ type: "var", name: `LAMBDA_${i}` });
    const term = tape.pushOp({ type: "mul", a: lamVar, b: eqIndices[i]! });
    lagrangianNode = tape.pushOp({ type: "add", a: lagrangianNode, b: term });
  }

  L.push("  /* --- Forward Pass --- */");
  const fwdCode = tape.emitForwardC((name: string) => {
    if (name.startsWith("LAMBDA_")) {
      const idx = name.replace("LAMBDA_", "");
      return `lambda[${idx}]`;
    }
    return varMap.get(name) ?? "0.0 /* " + name + " */";
  });
  L.push(...fwdCode);

  L.push("  /* --- Reverse Pass --- */");
  const { code: revCode, gradients } = tape.emitReverseC(lagrangianNode);
  L.push(...revCode);

  L.push("  /* --- Hessian computation via Reverse-Over-Forward --- */");
  L.push(`  double dot_t[${tape.length}];`);
  L.push(`  double dot_dt[${tape.length}];`);

  const indepVarIndices: number[] = [];
  for (const v of indepVars) {
    const vNode = gradients.get(v);
    if (vNode !== undefined) indepVarIndices.push(vNode);
  }

  for (let col = 0; col < indepVars.length; col++) {
    const seedNode = indepVarIndices[col]!;
    L.push(`  { /* Column ${col}: derivative wrt ${indepVars[col]} */`);
    L.push(`    memset(dot_t, 0, sizeof(dot_t));`);
    L.push(`    memset(dot_dt, 0, sizeof(dot_dt));`);
    L.push(`    dot_t[${seedNode}] = 1.0; /* Seed the forward directional derivative */`);

    const fwdDirCode = tape.emitForwardDirectionalC();
    L.push(...fwdDirCode.map((c) => "    " + c.trim()));

    const revDirCode = tape.emitReverseDirectionalC(lagrangianNode);
    L.push(...revDirCode.map((c) => "    " + c.trim()));

    for (let row = 0; row < indepVars.length; row++) {
      const rowNode = indepVarIndices[row]!;
      L.push(`    hess_out[${row * indepVars.length + col}] = dot_dt[${rowNode}];`);
    }
    L.push(`  }`);
  }

  L.push(`}`);
  return L;
}

/**
 * Generates a standalone C file (`nlp.c`) implementing the NLP evaluation functions
 * for use with IPOPT's C interface. The generated file contains:
 *   - eval_f:      Cost function evaluation
 *   - eval_g:      Constraint residual evaluation
 *   - eval_grad_f: Cost gradient (reverse-mode AD)
 *   - eval_jac_g:  Constraint Jacobian (forward-over-reverse AD)
 *   - main():      IPOPT driver that creates and solves the problem
 *
 * Compile with: gcc -O2 nlp.c -lipopt -lm -o nlp
 */
export function generateNlpC(
  id: string,
  nVars: number,
  nConstraints: number,
  nnzJacobian: number,
  dae: DAEBuilder,
  vars: Fmi3Variable[],
): string[] {
  const L: string[] = [];

  L.push(`/* Auto-generated NLP for IPOPT — ${id} */`);
  L.push(`/* Compile: gcc -O2 ${id}_nlp.c -lipopt -lm -o ${id}_nlp */`);
  L.push(``);
  L.push(`#include <stdio.h>`);
  L.push(`#include <stdlib.h>`);
  L.push(`#include <string.h>`);
  L.push(`#include <math.h>`);
  L.push(``);
  L.push(`/* Problem dimensions */`);
  L.push(`#define N_VARS ${nVars}`);
  L.push(`#define N_CONSTRAINTS ${nConstraints}`);
  L.push(`#define NNZ_JAC ${nnzJacobian}`);
  L.push(``);

  // Variable map
  const varMap = new Map<string, string>();
  for (const v of vars) {
    varMap.set(v.name, `x[${v.valueReference}]`);
  }

  // Objective function tape
  if (dae.objectiveExprId >= 0) {
    const tape = new StaticTapeBuilder();
    const objIdx = tape.addExpression(dae.objectiveExprId, dae);

    L.push(`/* eval_f: Objective function */`);
    L.push(`double eval_f(const double* x) {`);
    const fwdCode = tape.emitForwardC((name: string) => varMap.get(name) ?? `0.0 /* ${name} */`);
    L.push(...fwdCode);
    L.push(`  return t[${objIdx}];`);
    L.push(`}`);
    L.push(``);

    L.push(`/* eval_grad_f: Objective gradient via reverse-mode AD */`);
    L.push(`void eval_grad_f(const double* x, double* grad) {`);
    L.push(...fwdCode);
    const { code: revCode, gradients } = tape.emitReverseC(objIdx);
    L.push(...revCode);
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i]!;
      const gIdx = gradients.get(v.name);
      L.push(`  grad[${i}] = ${gIdx !== undefined ? `dt[${gIdx}]` : "0.0"};`);
    }
    L.push(`}`);
  } else {
    L.push(`double eval_f(const double* x) { return 0.0; }`);
    L.push(`void eval_grad_f(const double* x, double* grad) { memset(grad, 0, N_VARS * sizeof(double)); }`);
  }
  L.push(``);

  // Constraint function and Jacobian
  if (nConstraints > 0 && dae.getEqCount() > 0) {
    const conTapes: { tape: StaticTapeBuilder; outputIdx: number }[] = [];
    const numEq = Math.min(nConstraints, dae.getEqCount());
    for (let i = 0; i < numEq; i++) {
      const tape = new StaticTapeBuilder(dae.interner);
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      let resIdx = -1;
      if (lhs >= 0 && rhs >= 0) {
        const subExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, lhs, rhs);
        resIdx = tape.addExpression(subExpr, dae);
      } else if (lhs >= 0) {
        resIdx = tape.addExpression(lhs, dae);
      } else if (rhs >= 0) {
        resIdx = tape.addExpression(rhs, dae);
      }
      conTapes.push({ tape, outputIdx: resIdx });
    }

    L.push(`/* eval_g: Constraint residuals via collocation / equation residual tapes */`);
    L.push(`void eval_g(const double* x, double* g) {`);
    L.push(`  memset(g, 0, N_CONSTRAINTS * sizeof(double));`);
    for (let i = 0; i < conTapes.length; i++) {
      const ct = conTapes[i]!;
      if (ct.outputIdx >= 0) {
        L.push(`  { /* Constraint ${i} */`);
        const fwd = ct.tape.emitForwardC((name: string) => varMap.get(name) ?? `0.0 /* ${name} */`);
        L.push("    " + fwd.join("\n    "));
        L.push(`    g[${i}] = t[${ct.outputIdx}];`);
        L.push(`  }`);
      }
    }
    L.push(`}`);
    L.push(``);

    L.push(`/* eval_jac_g: Constraint Jacobian values via reverse-mode AD */`);
    L.push(`void eval_jac_g(const double* x, double* values) {`);
    L.push(`  if (!values) return; /* Structure query */`);
    L.push(`  memset(values, 0, NNZ_JAC * sizeof(double));`);
    let valOffset = 0;
    for (let i = 0; i < conTapes.length; i++) {
      const ct = conTapes[i]!;
      if (ct.outputIdx >= 0) {
        L.push(`  { /* Constraint ${i} Jacobian row */`);
        const fwd = ct.tape.emitForwardC((name: string) => varMap.get(name) ?? `0.0 /* ${name} */`);
        const { code: revCode, gradients } = ct.tape.emitReverseC(ct.outputIdx);
        L.push("    " + fwd.join("\n    "));
        L.push("    " + revCode.join("\n    "));
        for (let j = 0; j < vars.length; j++) {
          const v = vars[j]!;
          const gIdx = gradients.get(v.name);
          if (gIdx !== undefined && valOffset < nnzJacobian) {
            L.push(`    values[${valOffset++}] = dt[${gIdx}];`);
          }
        }
        L.push(`  }`);
      }
    }
    L.push(`}`);
  } else {
    L.push(`/* eval_g: Constraint residuals */`);
    L.push(`void eval_g(const double* x, double* g) {`);
    L.push(`  memset(g, 0, N_CONSTRAINTS * sizeof(double));`);
    L.push(`}`);
    L.push(``);
    L.push(`/* eval_jac_g: Constraint Jacobian values */`);
    L.push(`void eval_jac_g(const double* x, double* values) {`);
    L.push(`  if (!values) return; /* Structure query */`);
    L.push(`  memset(values, 0, NNZ_JAC * sizeof(double));`);
    L.push(`}`);
  }
  L.push(``);

  // Ipopt C API callback adapters & Main driver
  L.push(`#if defined(__has_include)`);
  L.push(`#  if __has_include(<coin-or/IpStdCInterface.h>) && defined(LINK_IPOPT)`);
  L.push(`#    include <coin-or/IpStdCInterface.h>`);
  L.push(`#    define HAVE_IPOPT 1`);
  L.push(`#  endif`);
  L.push(`#endif`);
  L.push(``);
  L.push(`#ifdef HAVE_IPOPT`);
  L.push(`static Bool ipopt_eval_f(Index n, Number* x, Bool new_x, Number* obj_value, UserDataPtr user_data) {`);
  L.push(`  (void)n; (void)new_x; (void)user_data;`);
  L.push(`  *obj_value = eval_f(x);`);
  L.push(`  return TRUE;`);
  L.push(`}`);
  L.push(``);
  L.push(`static Bool ipopt_eval_grad_f(Index n, Number* x, Bool new_x, Number* grad_f, UserDataPtr user_data) {`);
  L.push(`  (void)n; (void)new_x; (void)user_data;`);
  L.push(`  eval_grad_f(x, grad_f);`);
  L.push(`  return TRUE;`);
  L.push(`}`);
  L.push(``);
  L.push(`static Bool ipopt_eval_g(Index n, Number* x, Bool new_x, Index m, Number* g, UserDataPtr user_data) {`);
  L.push(`  (void)n; (void)new_x; (void)m; (void)user_data;`);
  L.push(`  eval_g(x, g);`);
  L.push(`  return TRUE;`);
  L.push(`}`);
  L.push(``);
  L.push(
    `static Bool ipopt_eval_jac_g(Index n, Number* x, Bool new_x, Index m, Index nele_jac, Index* iRow, Index* jCol, Number* values, UserDataPtr user_data) {`,
  );
  L.push(`  (void)new_x; (void)user_data;`);
  L.push(`  if (values == NULL) {`);
  L.push(`    Index idx = 0;`);
  L.push(`    for (Index i = 0; i < m && idx < nele_jac; i++) {`);
  L.push(`      for (Index j = 0; j < n && idx < nele_jac; j++) {`);
  L.push(`        iRow[idx] = i;`);
  L.push(`        jCol[idx] = j;`);
  L.push(`        idx++;`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`  } else {`);
  L.push(`    eval_jac_g(x, values);`);
  L.push(`  }`);
  L.push(`  return TRUE;`);
  L.push(`}`);
  L.push(``);
  L.push(
    `static Bool ipopt_eval_h(Index n, Number* x, Bool new_x, Number obj_factor, Index m, Number* lambda, Bool new_lambda, Index nele_hess, Index* iRow, Index* jCol, Number* values, UserDataPtr user_data) {`,
  );
  L.push(
    `  (void)n; (void)x; (void)new_x; (void)obj_factor; (void)m; (void)lambda; (void)new_lambda; (void)nele_hess; (void)iRow; (void)jCol; (void)values; (void)user_data;`,
  );
  L.push(`  return FALSE;`);
  L.push(`}`);
  L.push(`#endif`);
  L.push(``);
  L.push(`/* IPOPT driver with standalone Newton / Augmented-Lagrangian fallback */`);
  L.push(`int main(int argc, char** argv) {`);
  L.push(`  (void)argc; (void)argv;`);
  L.push(`  printf("NLP problem: ${id}\\n");`);
  L.push(`  printf("  Variables:   %d\\n", N_VARS);`);
  L.push(`  printf("  Constraints: %d\\n", N_CONSTRAINTS);`);
  L.push(`  printf("  NNZ Jacobian: %d\\n", NNZ_JAC);`);
  L.push(``);
  L.push(`  /* Initial guess and bounds */`);
  L.push(`  double x[N_VARS > 0 ? N_VARS : 1];`);
  L.push(`  double x_L[N_VARS > 0 ? N_VARS : 1];`);
  L.push(`  double x_U[N_VARS > 0 ? N_VARS : 1];`);
  L.push(`  for (int i = 0; i < N_VARS; i++) {`);
  L.push(`    x[i] = 0.0;`);
  L.push(`    x_L[i] = -1.0e19;`);
  L.push(`    x_U[i] =  1.0e19;`);
  L.push(`  }`);
  L.push(`  double g[N_CONSTRAINTS > 0 ? N_CONSTRAINTS : 1];`);
  L.push(`  double g_L[N_CONSTRAINTS > 0 ? N_CONSTRAINTS : 1];`);
  L.push(`  double g_U[N_CONSTRAINTS > 0 ? N_CONSTRAINTS : 1];`);
  L.push(`  memset(g, 0, sizeof(g));`);
  L.push(`  memset(g_L, 0, sizeof(g_L));`);
  L.push(`  memset(g_U, 0, sizeof(g_U));`);
  L.push(``);
  L.push(`  /* Evaluate and print initial objective */`);
  L.push(`  double f0 = eval_f(x);`);
  L.push(`  printf("  Initial objective: %.6e\\n", f0);`);
  L.push(``);
  L.push(`  /* Gradient check */`);
  L.push(`  double grad[N_VARS > 0 ? N_VARS : 1];`);
  L.push(`  eval_grad_f(x, grad);`);
  L.push(`  double grad_norm = 0.0;`);
  L.push(`  for (int i = 0; i < N_VARS; i++) grad_norm += grad[i] * grad[i];`);
  L.push(`  grad_norm = sqrt(grad_norm);`);
  L.push(`  printf("  Gradient norm: %.6e\\n", grad_norm);`);
  L.push(``);
  L.push(`#ifdef HAVE_IPOPT`);
  L.push(`  IpoptProblem nlp = CreateIpoptProblem(`);
  L.push(`    N_VARS, x_L, x_U, N_CONSTRAINTS, g_L, g_U, NNZ_JAC, 0, 0,`);
  L.push(`    &ipopt_eval_f, &ipopt_eval_g, &ipopt_eval_grad_f, &ipopt_eval_jac_g, &ipopt_eval_h`);
  L.push(`  );`);
  L.push(`  if (nlp) {`);
  L.push(`    AddIpoptNumOption(nlp, "tol", 1e-7);`);
  L.push(`    AddIpoptIntOption(nlp, "max_iter", 500);`);
  L.push(`    AddIpoptStrOption(nlp, "hessian_approximation", "limited-memory");`);
  L.push(`    double obj_val = f0;`);
  L.push(`    IpoptSolve(nlp, x, g, &obj_val, NULL, NULL, NULL, NULL);`);
  L.push(`    FreeIpoptProblem(nlp);`);
  L.push(`    printf("  Final objective:   %.6e\\n", obj_val);`);
  L.push(`  }`);
  L.push(`#else`);
  L.push(`  /* Standalone Augmented-Lagrangian / Quasi-Newton Descent Loop */`);
  L.push(`  double rho = 10.0;`);
  L.push(`  double lambda[N_CONSTRAINTS > 0 ? N_CONSTRAINTS : 1];`);
  L.push(`  double jac[NNZ_JAC > 0 ? NNZ_JAC : 1];`);
  L.push(`  double x_trial[N_VARS > 0 ? N_VARS : 1];`);
  L.push(`  memset(lambda, 0, sizeof(lambda));`);
  L.push(`  for (int iter = 0; iter < 200; iter++) {`);
  L.push(`    eval_grad_f(x, grad);`);
  L.push(`    if (N_CONSTRAINTS > 0) {`);
  L.push(`      eval_g(x, g);`);
  L.push(`      eval_jac_g(x, jac);`);
  L.push(`      int k = 0;`);
  L.push(`      for (int c = 0; c < N_CONSTRAINTS; c++) {`);
  L.push(`        for (int v = 0; v < N_VARS && k < NNZ_JAC; v++, k++) {`);
  L.push(`          grad[v] += (lambda[c] + rho * g[c]) * jac[k];`);
  L.push(`        }`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`    double step_norm = 0.0;`);
  L.push(`    for (int i = 0; i < N_VARS; i++) step_norm += grad[i] * grad[i];`);
  L.push(`    step_norm = sqrt(step_norm);`);
  L.push(`    if (step_norm < 1e-7) break;`);
  L.push(`    double alpha = 0.1 / (1.0 + step_norm);`);
  L.push(`    double merit0 = eval_f(x);`);
  L.push(`    for (int c = 0; c < N_CONSTRAINTS; c++) merit0 += lambda[c] * g[c] + 0.5 * rho * g[c] * g[c];`);
  L.push(`    for (int ls = 0; ls < 10; ls++) {`);
  L.push(`      for (int i = 0; i < N_VARS; i++) {`);
  L.push(`        double xi = x[i] - alpha * grad[i];`);
  L.push(`        if (xi < x_L[i]) xi = x_L[i];`);
  L.push(`        if (xi > x_U[i]) xi = x_U[i];`);
  L.push(`        x_trial[i] = xi;`);
  L.push(`      }`);
  L.push(`      double merit1 = eval_f(x_trial);`);
  L.push(`      if (N_CONSTRAINTS > 0) {`);
  L.push(`        eval_g(x_trial, g);`);
  L.push(`        for (int c = 0; c < N_CONSTRAINTS; c++) merit1 += lambda[c] * g[c] + 0.5 * rho * g[c] * g[c];`);
  L.push(`      }`);
  L.push(`      if (merit1 <= merit0) {`);
  L.push(`        memcpy(x, x_trial, sizeof(x));`);
  L.push(`        break;`);
  L.push(`      }`);
  L.push(`      alpha *= 0.5;`);
  L.push(`    }`);
  L.push(`    if (N_CONSTRAINTS > 0 && (iter % 10 == 9)) {`);
  L.push(`      eval_g(x, g);`);
  L.push(`      for (int c = 0; c < N_CONSTRAINTS; c++) lambda[c] += rho * g[c];`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`  printf("  Final objective:   %.6e\\n", eval_f(x));`);
  L.push(`#endif`);
  L.push(``);
  L.push(`  return 0;`);
  L.push(`}`);

  return L;
}
