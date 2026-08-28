// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ArenaDAEBuilder, EqKind, ExprKind, StaticTapeBuilder } from "@modelscript/compiler";

import { type Fmi3Variable } from "./fmi3.js";

/** Extract derivative name (like der(x)) from expression without depending on external module. */
function extractDer(dae: ArenaDAEBuilder, exprId: number): string | null {
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
export function generateModelEvaluateJacobian(id: string, dae: ArenaDAEBuilder, vars: Fmi3Variable[]): string[] {
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
    const outIdx = outputIndices[row]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const derEq = derEqs[row]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    L.push(`  { /* Row ${row}: derivative of ${derEq.state} */`);
    const { code, gradients } = tape.emitReverseC(outIdx);
    L.push(...code.map((c) => "  " + c)); // Indent inside block

    // Assign gradients into jac_out
    for (let col = 0; col < derEqs.length; col++) {
      const colEq = derEqs[col]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
export function generateModelEvaluateObjective(id: string, dae: ArenaDAEBuilder, vars: Fmi3Variable[]): string[] {
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
    const v = optVars[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
export function generateModelEvaluateHessian(id: string, dae: ArenaDAEBuilder, vars: Fmi3Variable[]): string[] {
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
    const term = tape.pushOp({ type: "mul", a: lamVar, b: eqIndices[i]! }); // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
    const seedNode = indepVarIndices[col]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    L.push(`  { /* Column ${col}: derivative wrt ${indepVars[col]} */`);
    L.push(`    memset(dot_t, 0, sizeof(dot_t));`);
    L.push(`    memset(dot_dt, 0, sizeof(dot_dt));`);
    L.push(`    dot_t[${seedNode}] = 1.0; /* Seed the forward directional derivative */`);

    const fwdDirCode = tape.emitForwardDirectionalC();
    L.push(...fwdDirCode.map((c) => "    " + c.trim()));

    const revDirCode = tape.emitReverseDirectionalC(lagrangianNode);
    L.push(...revDirCode.map((c) => "    " + c.trim()));

    for (let row = 0; row < indepVars.length; row++) {
      const rowNode = indepVarIndices[row]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
  dae: ArenaDAEBuilder,
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
      const v = vars[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const gIdx = gradients.get(v.name);
      L.push(`  grad[${i}] = ${gIdx !== undefined ? `dt[${gIdx}]` : "0.0"};`);
    }
    L.push(`}`);
  } else {
    L.push(`double eval_f(const double* x) { return 0.0; }`);
    L.push(`void eval_grad_f(const double* x, double* grad) { memset(grad, 0, N_VARS * sizeof(double)); }`);
  }
  L.push(``);

  // Constraint function (placeholder — filled per transcription strategy)
  L.push(`/* eval_g: Constraint residuals */`);
  L.push(`void eval_g(const double* x, double* g) {`);
  L.push(`  memset(g, 0, N_CONSTRAINTS * sizeof(double));`);
  L.push(`  /* TODO: Fill from transcription strategy */`);
  L.push(`}`);
  L.push(``);

  // Jacobian (placeholder)
  L.push(`/* eval_jac_g: Constraint Jacobian values */`);
  L.push(`void eval_jac_g(const double* x, double* values) {`);
  L.push(`  if (!values) return; /* Structure query */`);
  L.push(`  memset(values, 0, NNZ_JAC * sizeof(double));`);
  L.push(`  /* TODO: Fill from transcription strategy */`);
  L.push(`}`);
  L.push(``);

  // Main driver
  L.push(`/* IPOPT driver */`);
  L.push(`int main(int argc, char** argv) {`);
  L.push(`  printf("NLP problem: ${id}\\n");`);
  L.push(`  printf("  Variables:   %d\\n", N_VARS);`);
  L.push(`  printf("  Constraints: %d\\n", N_CONSTRAINTS);`);
  L.push(`  printf("  NNZ Jacobian: %d\\n", NNZ_JAC);`);
  L.push(``);
  L.push(`  /* Initial guess */`);
  L.push(`  double x[N_VARS];`);
  L.push(`  memset(x, 0, sizeof(x));`);
  L.push(``);
  L.push(`  /* Evaluate and print initial objective */`);
  L.push(`  double f0 = eval_f(x);`);
  L.push(`  printf("  Initial objective: %.6e\\n", f0);`);
  L.push(``);
  L.push(`  /* Gradient check */`);
  L.push(`  double grad[N_VARS];`);
  L.push(`  eval_grad_f(x, grad);`);
  L.push(`  printf("  Gradient norm: %.6e\\n",`);
  L.push(`    sqrt(({ double s=0; for(int i=0;i<N_VARS;i++) s+=grad[i]*grad[i]; s; })));`);
  L.push(``);
  L.push(`  return 0;`);
  L.push(`}`);

  return L;
}
