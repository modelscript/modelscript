import {
  ModelicaArrayEquation,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaDAE,
  ModelicaExpression,
  ModelicaFunctionCallExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaUnaryExpression,
} from "./dae.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "./syntax.js";

type TapeOp =
  | { type: "const"; val: number }
  | { type: "var"; name: string }
  | { type: "add"; a: number; b: number }
  | { type: "sub"; a: number; b: number }
  | { type: "mul"; a: number; b: number }
  | { type: "div"; a: number; b: number }
  | { type: "pow"; a: number; b: number }
  | { type: "neg"; a: number }
  | { type: "sin"; a: number }
  | { type: "cos"; a: number }
  | { type: "tan"; a: number }
  | { type: "exp"; a: number }
  | { type: "log"; a: number }
  | { type: "sqrt"; a: number };

function formatCDouble(v: number): string {
  if (!isFinite(v)) return v === Infinity ? "INFINITY" : v === -Infinity ? "(-INFINITY)" : "NAN";
  const s = v.toString();
  return !s.includes(".") && !s.includes("e") && !s.includes("E") ? s + ".0" : s;
}

/**
 * Builds a Static Computation Tape (Wengert List) representing equations exactly as
 * unrolled, straight-line C-code assignments (Three-Address Code).
 * This eliminates Expression Swell (O(2^N) code generation) by deduplicating
 * identical tree operations and applying Algorithmic Differentiation (AD) step-by-step.
 */
export class StaticTapeBuilder {
  public ops: TapeOp[] = [];
  private cache = new Map<string, number>();

  public pushOp(op: TapeOp): number {
    const key = JSON.stringify(op);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached; // Deduplicate shared expressions
    const idx = this.ops.length;
    this.ops.push(op);
    this.cache.set(key, idx);
    return idx;
  }

  /**
   * Traverse the Modelica AST and construct the static tape sequence.
   * Returns the array index of the root tape node.
   */
  public walk(expr: ModelicaExpression): number {
    if (expr instanceof ModelicaRealLiteral) return this.pushOp({ type: "const", val: expr.value });
    if (expr instanceof ModelicaIntegerLiteral) return this.pushOp({ type: "const", val: expr.value });
    if (expr instanceof ModelicaBooleanLiteral) return this.pushOp({ type: "const", val: expr.value ? 1 : 0 });

    // Variables
    if (expr instanceof ModelicaNameExpression) return this.pushOp({ type: "var", name: expr.name });
    if (expr && typeof expr === "object" && "name" in expr)
      return this.pushOp({ type: "var", name: (expr as { name: string }).name });

    if (expr instanceof ModelicaUnaryExpression) {
      const a = this.walk(expr.operand);
      if (
        expr.operator === ModelicaUnaryOperator.UNARY_MINUS ||
        expr.operator === ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS
      ) {
        return this.pushOp({ type: "neg", a });
      }
      return a; // plus
    }

    if (expr instanceof ModelicaBinaryExpression) {
      const a = this.walk(expr.operand1);
      const b = this.walk(expr.operand2);
      switch (expr.operator) {
        case ModelicaBinaryOperator.ADDITION:
        case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
          return this.pushOp({ type: "add", a, b });
        case ModelicaBinaryOperator.SUBTRACTION:
        case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
          return this.pushOp({ type: "sub", a, b });
        case ModelicaBinaryOperator.MULTIPLICATION:
        case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
          return this.pushOp({ type: "mul", a, b });
        case ModelicaBinaryOperator.DIVISION:
        case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
          return this.pushOp({ type: "div", a, b });
        case ModelicaBinaryOperator.EXPONENTIATION:
        case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
          return this.pushOp({ type: "pow", a, b });
      }
    }

    if (expr instanceof ModelicaFunctionCallExpression) {
      if (expr.args.length === 1 && expr.args[0]) {
        const a = this.walk(expr.args[0]);
        switch (expr.functionName) {
          case "sin":
          case "Modelica.Math.sin":
            return this.pushOp({ type: "sin", a });
          case "cos":
          case "Modelica.Math.cos":
            return this.pushOp({ type: "cos", a });
          case "tan":
          case "Modelica.Math.tan":
            return this.pushOp({ type: "tan", a });
          case "exp":
          case "Modelica.Math.exp":
            return this.pushOp({ type: "exp", a });
          case "log":
          case "Modelica.Math.log":
            return this.pushOp({ type: "log", a });
          case "sqrt":
            return this.pushOp({ type: "sqrt", a });
        }
      }
    }

    // Unrecognized or non-differentiable features default to constant 0 tape node.
    return this.pushOp({ type: "const", val: 0 });
  }

  /**
   * Emit the C-code evaluating the expressions step-by-step.
   * `varResolver` maps the Modelica variable name into a valid C-code getter string
   * (e.g., `inst->vars[VR_X]`).
   */

  public getDependencies(outputIndex: number): Set<string> {
    const deps = new Set<string>();
    if (outputIndex < 0 || outputIndex >= this.ops.length) return deps;

    const visited = new Set<number>();
    const stack = [outputIndex];
    while (stack.length > 0) {
      const idx = stack.pop()!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (visited.has(idx)) continue;
      visited.add(idx);

      const op = this.ops[idx]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (op.type === "var") deps.add(op.name);

      if ("a" in op && typeof op.a === "number") stack.push(op.a);
      if ("b" in op && typeof op.b === "number") stack.push(op.b);
    }
    return deps;
  }

  public emitForwardC(varResolver: (name: string) => string): string[] {
    const lines: string[] = [];
    if (this.ops.length === 0) return lines;
    lines.push(`  double t[${this.ops.length}];`);

    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      let rhs = "0.0";
      switch (op.type) {
        case "const":
          rhs = formatCDouble(op.val);
          break;
        case "var":
          rhs = varResolver(op.name);
          break;
        case "add":
          rhs = `t[${op.a}] + t[${op.b}]`;
          break;
        case "sub":
          rhs = `t[${op.a}] - t[${op.b}]`;
          break;
        case "mul":
          rhs = `t[${op.a}] * t[${op.b}]`;
          break;
        case "div":
          rhs = `t[${op.a}] / t[${op.b}]`;
          break;
        case "pow":
          rhs = `pow(t[${op.a}], t[${op.b}])`;
          break;
        case "neg":
          rhs = `-t[${op.a}]`;
          break;
        case "sin":
          rhs = `sin(t[${op.a}])`;
          break;
        case "cos":
          rhs = `cos(t[${op.a}])`;
          break;
        case "tan":
          rhs = `tan(t[${op.a}])`;
          break;
        case "exp":
          rhs = `exp(t[${op.a}])`;
          break;
        case "log":
          rhs = `log(t[${op.a}])`;
          break;
        case "sqrt":
          rhs = `sqrt(t[${op.a}])`;
          break;
      }
      lines.push(`  t[${i}] = ${rhs};`);
    }
    return lines;
  }

  /**
   * Emit the Reverse-Mode AD Backpropagation C-code.
   * Runs the chain rule entirely backwards through the tape.
   * Call this AFTER emitForwardC() so the `t[]` array is populated.
   *
   * `outputIndex` is the element of the tape we are differentiating.
   * Returns a map of (variable Name -> dt index) so the caller can extract the gradients.
   */

  /**
   * Emit the Forward Directional Derivative C-code.
   * Computes the Jacobian-vector product: `dot_t = J * v`
   * `dot_t` is initialized by the caller.
   */
  public emitForwardDirectionalC(): string[] {
    const lines: string[] = [];
    if (this.ops.length === 0) return lines;

    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (op.type === "const" || op.type === "var") continue;

      let rhs = "0.0";
      switch (op.type) {
        case "add":
          rhs = `dot_t[${op.a}] + dot_t[${op.b}]`;
          break;
        case "sub":
          rhs = `dot_t[${op.a}] - dot_t[${op.b}]`;
          break;
        case "mul":
          rhs = `dot_t[${op.a}] * t[${op.b}] + t[${op.a}] * dot_t[${op.b}]`;
          break;
        case "div":
          rhs = `(dot_t[${op.a}] * t[${op.b}] - t[${op.a}] * dot_t[${op.b}]) / (t[${op.b}] * t[${op.b}])`;
          break;
        case "pow":
          rhs = `t[${i}] * (dot_t[${op.b}] * log(t[${op.a}]) + t[${op.b}] * dot_t[${op.a}] / t[${op.a}])`;
          break;
        case "neg":
          rhs = `-dot_t[${op.a}]`;
          break;
        case "sin":
          rhs = `dot_t[${op.a}] * cos(t[${op.a}])`;
          break;
        case "cos":
          rhs = `-dot_t[${op.a}] * sin(t[${op.a}])`;
          break;
        case "tan":
          rhs = `dot_t[${op.a}] * (1.0 + t[${i}] * t[${i}])`;
          break;
        case "exp":
          rhs = `dot_t[${op.a}] * t[${i}]`;
          break;
        case "log":
          rhs = `dot_t[${op.a}] / t[${op.a}]`;
          break;
        case "sqrt":
          rhs = `dot_t[${op.a}] / (2.0 * t[${i}])`;
          break;
      }
      lines.push(`  dot_t[${i}] = ${rhs};`);
    }
    return lines;
  }

  /**
   * Emit the Reverse-Over-Forward AD C-code to extract Hessian-vector products.
   * Expects `t`, `dt`, and `dot_t` to be populated.
   * Populates `dot_dt` array.
   */
  public emitReverseDirectionalC(outputIndex: number): string[] {
    const lines: string[] = [];
    if (this.ops.length === 0 || outputIndex < 0 || outputIndex >= this.ops.length) return lines;

    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (op.type === "const" || op.type === "var") continue;

      lines.push(`  if (dt[${i}] != 0.0 || dot_dt[${i}] != 0.0) {`);
      switch (op.type) {
        case "add":
          lines.push(`    dot_dt[${op.a}] += dot_dt[${i}];`);
          lines.push(`    dot_dt[${op.b}] += dot_dt[${i}];`);
          break;
        case "sub":
          lines.push(`    dot_dt[${op.a}] += dot_dt[${i}];`);
          lines.push(`    dot_dt[${op.b}] -= dot_dt[${i}];`);
          break;
        case "mul":
          lines.push(`    dot_dt[${op.a}] += dot_dt[${i}] * t[${op.b}] + dt[${i}] * dot_t[${op.b}];`);
          lines.push(`    dot_dt[${op.b}] += dot_dt[${i}] * t[${op.a}] + dt[${i}] * dot_t[${op.a}];`);
          break;
        case "div":
          lines.push(
            `    dot_dt[${op.a}] += dot_dt[${i}] / t[${op.b}] - dt[${i}] * dot_t[${op.b}] / (t[${op.b}] * t[${op.b}]);`,
          );
          lines.push(
            `    dot_dt[${op.b}] -= dot_dt[${i}] * t[${op.a}] / (t[${op.b}] * t[${op.b}]) + dt[${i}] * dot_t[${op.a}] / (t[${op.b}] * t[${op.b}]) - dt[${i}] * 2.0 * t[${op.a}] * dot_t[${op.b}] / (t[${op.b}] * t[${op.b}] * t[${op.b}]);`,
          );
          break;
        case "pow":
          lines.push(`    double dt_a_term = t[${op.b}] * pow(t[${op.a}], t[${op.b}] - 1.0);`);
          lines.push(
            `    double dot_dt_a_term = dot_t[${op.b}] * pow(t[${op.a}], t[${op.b}] - 1.0) + t[${op.b}] * pow(t[${op.a}], t[${op.b}] - 1.0) * (dot_t[${op.b}] * log(t[${op.a}]) + (t[${op.b}] - 1.0) * dot_t[${op.a}] / t[${op.a}]);`,
          );
          lines.push(`    dot_dt[${op.a}] += dot_dt[${i}] * dt_a_term + dt[${i}] * dot_dt_a_term;`);
          lines.push(`    double dt_b_term = t[${i}] * log(t[${op.a}]);`);
          lines.push(
            `    double dot_dt_b_term = dot_t[${i}] * log(t[${op.a}]) + t[${i}] * dot_t[${op.a}] / t[${op.a}];`,
          );
          lines.push(`    dot_dt[${op.b}] += dot_dt[${i}] * dt_b_term + dt[${i}] * dot_dt_b_term;`);
          break;
        case "neg":
          lines.push(`    dot_dt[${op.a}] -= dot_dt[${i}];`);
          break;
        case "sin":
          lines.push(
            `    dot_dt[${op.a}] += dot_dt[${i}] * cos(t[${op.a}]) - dt[${i}] * dot_t[${op.a}] * sin(t[${op.a}]);`,
          );
          break;
        case "cos":
          lines.push(
            `    dot_dt[${op.a}] -= dot_dt[${i}] * sin(t[${op.a}]) + dt[${i}] * dot_t[${op.a}] * cos(t[${op.a}]);`,
          );
          break;
        case "tan":
          lines.push(
            `    dot_dt[${op.a}] += dot_dt[${i}] * (1.0 + t[${i}] * t[${i}]) + dt[${i}] * 2.0 * t[${i}] * dot_t[${i}];`,
          );
          break;
        case "exp":
          lines.push(`    dot_dt[${op.a}] += dot_dt[${i}] * t[${i}] + dt[${i}] * dot_t[${i}];`);
          break;
        case "log":
          lines.push(
            `    dot_dt[${op.a}] += dot_dt[${i}] / t[${op.a}] - dt[${i}] * dot_t[${op.a}] / (t[${op.a}] * t[${op.a}]);`,
          );
          break;
        case "sqrt":
          lines.push(
            `    dot_dt[${op.a}] += dot_dt[${i}] / (2.0 * t[${i}]) - dt[${i}] * dot_t[${i}] / (2.0 * t[${i}] * t[${i}]);`,
          );
          break;
      }
      lines.push(`  }`);
    }
    return lines;
  }

  public emitReverseC(outputIndex: number): { code: string[]; gradients: Map<string, number> } {
    const lines: string[] = [];
    if (this.ops.length === 0 || outputIndex < 0 || outputIndex >= this.ops.length) {
      return { code: [], gradients: new Map() };
    }

    lines.push(`  double dt[${this.ops.length}];`);
    lines.push(`  memset(dt, 0, ${this.ops.length} * sizeof(double));`);
    lines.push(`  dt[${outputIndex}] = 1.0; /* Seed the gradient */`);

    // Reverse topological traversal
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (op.type === "const" || op.type === "var") continue;

      // Optimization: if dt is 0, skip branching
      lines.push(`  if (dt[${i}] != 0.0) {`);
      switch (op.type) {
        case "add":
          lines.push(`    dt[${op.a}] += dt[${i}];`);
          lines.push(`    dt[${op.b}] += dt[${i}];`);
          break;
        case "sub":
          lines.push(`    dt[${op.a}] += dt[${i}];`);
          lines.push(`    dt[${op.b}] -= dt[${i}];`);
          break;
        case "mul":
          lines.push(`    dt[${op.a}] += dt[${i}] * t[${op.b}];`);
          lines.push(`    dt[${op.b}] += dt[${i}] * t[${op.a}];`);
          break;
        case "div":
          lines.push(`    dt[${op.a}] += dt[${i}] / t[${op.b}];`);
          lines.push(`    dt[${op.b}] -= dt[${i}] * t[${op.a}] / (t[${op.b}] * t[${op.b}]);`);
          break;
        case "pow":
          lines.push(`    dt[${op.a}] += dt[${i}] * t[${op.b}] * pow(t[${op.a}], t[${op.b}] - 1.0);`);
          lines.push(`    dt[${op.b}] += dt[${i}] * t[${i}] * log(t[${op.a}]);`); // t[i] is a^b
          break;
        case "neg":
          lines.push(`    dt[${op.a}] -= dt[${i}];`);
          break;
        case "sin":
          lines.push(`    dt[${op.a}] += dt[${i}] * cos(t[${op.a}]);`);
          break;
        case "cos":
          lines.push(`    dt[${op.a}] -= dt[${i}] * sin(t[${op.a}]);`);
          break;
        case "tan":
          lines.push(`    dt[${op.a}] += dt[${i}] * (1.0 + t[${i}] * t[${i}]);`); // 1 + tan²x
          break;
        case "exp":
          lines.push(`    dt[${op.a}] += dt[${i}] * t[${i}];`);
          break;
        case "log":
          lines.push(`    dt[${op.a}] += dt[${i}] / t[${op.a}];`);
          break;
        case "sqrt":
          lines.push(`    dt[${op.a}] += dt[${i}] / (2.0 * t[${i}]);`);
          break;
      }
      lines.push(`  }`);
    }

    // Extract gradients mapping
    const gradients = new Map<string, number>();
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (op.type === "var") {
        // Variables can be read multiple times (e.g. x in x + x).
        // Since `cache` deduplicates, there is only one `var: x` operator!
        gradients.set(op.name, i);
      }
    }

    return { code: lines, gradients };
  }
}

// import removed
import { type Fmi3Variable } from "./fmi3.js";

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

/**
 * Compiles the entire system of derivative equations into a single C-function
 * that calculates the exact Jacobian Matrix via Reverse-Mode AD.
 */
export function generateModelEvaluateJacobian(id: string, dae: ModelicaDAE, vars: Fmi3Variable[]): string[] {
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
  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.equations) {
    if (eq instanceof ModelicaArrayEquation) continue; // Skip unsupported for NLP right now
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);
    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  const tape = new StaticTapeBuilder();
  const outputIndices: number[] = [];
  for (const eq of derEqs) {
    outputIndices.push(tape.walk(eq.rhs));
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
export function generateModelEvaluateObjective(id: string, dae: ModelicaDAE, vars: Fmi3Variable[]): string[] {
  const L: string[] = [];
  L.push(`/* Exact Analytical Objective */`);
  L.push(`void ${id}_evaluate_objective(${id}_Instance* inst, double* obj_out) {`);

  const varMap = new Map<string, string>();
  for (const v of vars) {
    varMap.set(v.name, `inst->vars[${v.valueReference}]`);
  }
  varMap.set("time", `inst->time`);

  if (!dae.objective) {
    L.push(`  *obj_out = 0.0;`);
    L.push(`}`);
    return L;
  }

  const tape = new StaticTapeBuilder();
  const objIdx = tape.walk(dae.objective);

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

  if (!dae.objective) {
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
export function generateModelEvaluateHessian(id: string, dae: ModelicaDAE, vars: Fmi3Variable[]): string[] {
  const L: string[] = [];
  L.push(`/* Exact Analytical Hessian of Lagrangian via Reverse-Over-Forward AD */`);
  L.push(`void ${id}_evaluate_hessian(${id}_Instance* inst, double obj_factor, double* lambda, double* hess_out) {`);

  const varMap = new Map<string, string>();
  for (const v of vars) {
    varMap.set(v.name, `inst->vars[${v.valueReference}]`);
  }
  varMap.set("time", `inst->time`);

  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.equations) {
    if (eq instanceof ModelicaArrayEquation) continue;
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);
    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  const tape = new StaticTapeBuilder();

  const indepVars: string[] = [];
  for (const eq of derEqs) {
    if (!indepVars.includes(eq.state)) indepVars.push(eq.state);
  }

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
  L.push(`  double dot_t[${tape.ops.length}];`);
  L.push(`  double dot_dt[${tape.ops.length}];`);

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
