import {
  ArenaDAEBuilder,
  EqKind,
  ExprKind,
  Variability,
  evaluateArenaExpression,
  isolateSymbolicallyArena,
  pantelidesIndexReductionArena,
  performBltTransformationArena,
} from "@modelscript/compiler";
import { evaluateArenaDualExpression } from "./arena-dual-evaluator.js";
import { evaluateArenaRuntime } from "./arena-eval-runtime.js";
import { Dual } from "./dual.js";
import { luFactor, luSolve } from "./simulator.js";

/** Maximum Newton iterations for algebraic loop solving. */
const NEWTON_MAX_ITER = 20;
/** Newton convergence tolerance. */
const NEWTON_TOL = 1e-10;
/** Square root of machine epsilon for finite-difference perturbation. */
const SQRT_EPS = 1.4901161193847656e-8;

/** Describes a single action inside a when-clause body. */
interface ArenaWhenAction {
  type: "reinit" | "assign";
  /** StringId of the target variable. */
  targetNameId: number;
  /** ExprId of the right-hand side expression. */
  exprId: number;
}

/** An arena when-clause ready for evaluation during simulation. */
interface ArenaWhenClause {
  /** ExprId of the condition expression. */
  conditionExprId: number;
  /** Actions to execute when the clause fires (rising edge). */
  actions: ArenaWhenAction[];
  /** Whether the condition was active at the previous time step. */
  wasActive: boolean;
}

export class ArenaSimulator {
  public parameters = new Map<string, number>();

  // Sets of VarIdx for fast arena-native processing
  public parameterVars = new Set<number>();
  public stateVars = new Set<number>();
  public derivativeVars = new Set<number>();

  public sortedEquations: number[] = [];
  public blocks: { eqIdxs: number[]; vars: number[] }[] = [];
  public dummyDerivatives = new Set<number>();
  public executionBlocks: import("@modelscript/compiler").ArenaExecutionBlock[] = [];

  /** Extracted when-clauses for event handling. */
  public whenClauses: ArenaWhenClause[] = [];

  /** Warm-start cache for algebraic loop variables (varNameId → value). */
  private algWarmStart = new Map<number, number>();

  constructor(public arena: ArenaDAEBuilder) {}

  prepare() {
    this.resolveParameters();
    this.eliminateAliases();
    this.identifyDerivatives();

    // Arena-Native Pantelides Index Reduction
    const pantelidesRes = pantelidesIndexReductionArena(
      this.arena,
      this.stateVars,
      this.derivativeVars,
      this.parameterVars,
    );
    this.dummyDerivatives = pantelidesRes.dummyDerivatives;

    // Arena-Native BLT / Bipartite Matching
    const bltRes = performBltTransformationArena(this.arena);
    this.sortedEquations = bltRes.sortedEquations;
    this.blocks = bltRes.blocks;

    this.buildExecutionBlocks();
    this.extractWhenClauses();
  }

  private buildExecutionBlocks() {
    for (const block of this.blocks) {
      if (block.eqIdxs.length === 1 && block.vars.length === 1) {
        const eqIdx = block.eqIdxs[0] ?? -1;
        const varIdx = block.vars[0] ?? -1;

        if (eqIdx === -1 || varIdx === -1) continue;

        const isolatedExprId = isolateSymbolicallyArena(this.arena, eqIdx, varIdx);
        if (isolatedExprId !== -1) {
          this.executionBlocks.push({ type: "single", varIdx, exprId: isolatedExprId });
        } else {
          // Could not isolate, leave as implicit 1x1 system
          this.executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: block.vars });
        }
      } else {
        this.executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: block.vars });
      }
    }

    // Identify unused sorted equations (if any)
    const assignedEqs = new Set<number>();
    for (const block of this.blocks) {
      for (const eqIdx of block.eqIdxs) assignedEqs.add(eqIdx);
    }

    for (const eqIdx of this.sortedEquations) {
      if (!assignedEqs.has(eqIdx)) {
        // Equation without an assigned variable (e.g. constraints)
        this.executionBlocks.push({ type: "system", eqIdxs: [eqIdx], vars: [] });
      }
    }
  }

  private resolveParameters() {
    for (let i = 0; i < this.arena.varCount; i++) {
      if (this.arena.isVarRemoved(i)) continue;
      if (this.arena.getVarVariability(i) !== Variability.Parameter) continue;

      this.parameterVars.add(i);

      const exprId = this.arena.getVarExpression(i) as number | undefined;
      const name = this.arena.getVarName(i);
      if (typeof exprId === "number" && exprId !== -1) {
        const val = evaluateArenaExpression(this.arena, exprId, this.parameters);
        if (val !== null && typeof val === "number") {
          this.parameters.set(name, val);
        }
      }
    }
  }

  private eliminateAliases() {
    // Alias elimination was moved to the flattener via eliminateArenaAliases()
    // in O(N) time. The simulator no longer needs to do it!
  }

  private identifyDerivatives() {
    for (let i = 0; i < this.arena.exprCount; i++) {
      if (this.arena.getExprKind(i) === ExprKind.Der) {
        const argId = this.arena.getExprData1(i);
        if (this.arena.getExprKind(argId) === ExprKind.Name) {
          const nameId = this.arena.getExprData1(argId);
          // Find VarIdx for nameId
          let varIdx = -1;
          for (let v = 0; v < this.arena.varCount; v++) {
            if (!this.arena.isVarRemoved(v) && this.arena.getVarNameId(v) === nameId) {
              varIdx = v;
              break;
            }
          }
          if (varIdx !== -1) {
            this.stateVars.add(varIdx);
            // Also find the derivative variable if it exists
            const derName = `der(${this.arena.getVarName(varIdx)})`;
            const derNameId = this.arena.interner.intern(derName);
            for (let v = 0; v < this.arena.varCount; v++) {
              if (!this.arena.isVarRemoved(v) && this.arena.getVarNameId(v) === derNameId) {
                this.derivativeVars.add(v);
                break;
              }
            }
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // When-Clause Extraction
  // ─────────────────────────────────────────────────────────────────────────

  private extractWhenClauses() {
    this.whenClauses = [];
    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      if (this.arena.getEqKind(eqIdx) !== EqKind.When) continue;

      // When equation layout: lhs = condition ExprId, rhs = body eq count, aux = elsewhen count
      const condExprId = this.arena.getEqLhs(eqIdx);
      const bodyCount = this.arena.getEqRhs(eqIdx);

      // Extract actions from body equations (immediately following this When eq)
      const actions = this.extractWhenActions(eqIdx + 1, bodyCount);
      if (actions.length > 0) {
        this.whenClauses.push({ conditionExprId: condExprId, actions, wasActive: false });
      }
    }
  }

  private extractWhenActions(startEqIdx: number, count: number): ArenaWhenAction[] {
    const actions: ArenaWhenAction[] = [];
    for (let i = 0; i < count; i++) {
      const bodyIdx = startEqIdx + i;
      if (bodyIdx >= this.arena.eqCount) break;

      const kind = this.arena.getEqKind(bodyIdx);
      if (kind === EqKind.Simple) {
        const lhs = this.arena.getEqLhs(bodyIdx);
        const rhs = this.arena.getEqRhs(bodyIdx);
        // Check if this is a reinit() call
        if (this.arena.getExprKind(rhs) === ExprKind.Call) {
          const funcNameId = this.arena.getExprData1(rhs);
          const funcName = this.arena.interner.resolve(funcNameId);
          if (funcName === "reinit" && this.arena.getExprKind(lhs) === ExprKind.Name) {
            const targetNameId = this.arena.getExprData1(lhs);
            const valueExprId = this.arena.getExprLeft(rhs);
            actions.push({ type: "reinit", targetNameId, exprId: valueExprId });
            continue;
          }
        }
        // Regular assignment: lhs = rhs
        if (this.arena.getExprKind(lhs) === ExprKind.Name) {
          const targetNameId = this.arena.getExprData1(lhs);
          actions.push({ type: "assign", targetNameId, exprId: rhs });
        }
      }
    }
    return actions;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Newton-Raphson Solver for Algebraic Loops
  // ─────────────────────────────────────────────────────────────────────────

  private solveNewtonBlock(
    block: Extract<import("@modelscript/compiler").ArenaExecutionBlock, { type: "system" }>,
    valuesByStringId: Float64Array,
  ): void {
    const m = block.vars.length;
    if (m === 0) return;

    const x = new Float64Array(m);
    const R = new Float64Array(m);
    const negR = new Float64Array(m);

    // Collect variable name StringIds
    const varNameIds = new Array<number>(m);
    for (let i = 0; i < m; i++) {
      const varIdx = block.vars[i] as number;
      varNameIds[i] = this.arena.getVarNameId(varIdx);
      // Initialize from warm-start cache or current environment
      x[i] = this.algWarmStart.get(varNameIds[i] as number) ?? valuesByStringId[varNameIds[i] as number] ?? 0;
    }

    // Pre-allocate Jacobian rows
    const J: Float64Array[] = new Array(m);
    for (let i = 0; i < m; i++) J[i] = new Float64Array(m);

    let converged = false;

    for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
      // Set current values into the environment
      for (let i = 0; i < m; i++) valuesByStringId[varNameIds[i] as number] = x[i] as number;

      // Evaluate residuals: R_i = x_i - expr_i (where expr_i is the RHS of eq_i isolated for var_i)
      let maxR = 0;
      for (let i = 0; i < m; i++) {
        const eqIdx = block.eqIdxs[i] as number;
        const rhsId = this.arena.getEqRhs(eqIdx);
        const exprVal = evaluateArenaRuntime(this.arena, rhsId, valuesByStringId);
        const val = isFinite(exprVal) ? exprVal : 0;
        R[i] = (x[i] as number) - val;
        maxR = Math.max(maxR, Math.abs(R[i] as number));
      }

      if (maxR < NEWTON_TOL) {
        converged = true;
        break;
      }

      // Compute Jacobian via forward-mode AD (dual numbers)
      const dualVars: Dual[] = [];
      // Fill dualVars from current environment
      for (let sid = 0; sid < valuesByStringId.length; sid++) {
        dualVars[sid] = Dual.constant(valuesByStringId[sid] ?? 0);
      }

      for (let j = 0; j < m; j++) {
        const nid = varNameIds[j] as number;
        // Seed variable j: (x_j, 1)
        dualVars[nid] = new Dual(x[j] as number, 1.0);

        for (let i = 0; i < m; i++) {
          const eqIdx = block.eqIdxs[i] as number;
          const rhsId = this.arena.getEqRhs(eqIdx);
          const dualResult = evaluateArenaDualExpression(this.arena, rhsId, dualVars);
          const Ji = J[i] as Float64Array;
          if (dualResult) {
            // J[i][j] = δ_{ij} - d(expr_i)/dx_j
            Ji[j] = (i === j ? 1 : 0) - dualResult.dot;
          } else {
            // AD failed — fall back to finite differences
            const xj = x[j] as number;
            const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
            valuesByStringId[nid] = xj + eps;
            const perturbedVal = evaluateArenaRuntime(this.arena, this.arena.getEqRhs(eqIdx), valuesByStringId);
            const R_perturbed = (i === j ? xj + eps : (x[i] as number)) - (isFinite(perturbedVal) ? perturbedVal : 0);
            Ji[j] = (R_perturbed - (R[i] as number)) / eps;
            valuesByStringId[nid] = xj;
          }
        }

        // Reset seed
        dualVars[nid] = Dual.constant(x[j] as number);
      }

      // Solve J · Δx = -R via LU factorization
      try {
        const fact = luFactor(J, m);
        for (let i = 0; i < m; i++) negR[i] = -(R[i] as number);
        luSolve(fact, negR);
        for (let i = 0; i < m; i++) {
          const nx = (x[i] as number) + (negR[i] as number);
          x[i] = nx;
          valuesByStringId[varNameIds[i] as number] = nx;
        }
      } catch {
        // Singular Jacobian — skip this block
        return;
      }
    }

    if (!converged) {
      // Write best guess back anyway
    }

    // Write converged values and update warm-start cache
    for (let i = 0; i < m; i++) {
      const nid = varNameIds[i] as number;
      valuesByStringId[nid] = x[i] as number;
      this.algWarmStart.set(nid, x[i] as number);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Block Evaluation (shared between integrators)
  // ─────────────────────────────────────────────────────────────────────────

  private evaluateBlocks(valuesByStringId: Float64Array): void {
    for (const block of this.executionBlocks) {
      if (block.type === "single") {
        const val = evaluateArenaRuntime(this.arena, block.exprId, valuesByStringId);
        const varNameId = this.arena.getVarNameId(block.varIdx);
        valuesByStringId[varNameId] = val;
      } else if (block.type === "system") {
        this.solveNewtonBlock(block, valuesByStringId);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // When-Clause Event Handling
  // ─────────────────────────────────────────────────────────────────────────

  private processWhenClauses(valuesByStringId: Float64Array): void {
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      const isActive = condVal !== 0;

      // Rising edge detection
      if (isActive && !clause.wasActive) {
        for (const action of clause.actions) {
          const val = evaluateArenaRuntime(this.arena, action.exprId, valuesByStringId);
          valuesByStringId[action.targetNameId] = val;
        }
      }

      clause.wasActive = isActive;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Simulation (RK4 with Forward Euler fallback)
  // ─────────────────────────────────────────────────────────────────────────

  simulate(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: { solver?: "euler" | "rk4" },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;

    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = 0;

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = currentTime;
    this.evaluateBlocks(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }

    for (let s = 0; s <= steps; s++) {
      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocks(valuesByStringId);
      this.processWhenClauses(valuesByStringId);

      // Record output
      const currentState = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        currentState[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      }
      t_out.push(currentTime);
      y_out.push(currentState);

      // Integrate state variables
      if (solver === "rk4") {
        this.rk4Step(step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      } else {
        // Forward Euler
        for (let i = 0; i < n; i++) {
          const stateId = stateStringIds[i] ?? -1;
          const derivId = derivStringIds[i] ?? -1;
          if (derivId !== -1 && stateId !== -1) {
            valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + step * (valuesByStringId[derivId] ?? 0);
          }
        }
      }

      currentTime += step;
    }

    return { t: t_out, y: y_out };
  }

  /**
   * Classical 4th-order Runge-Kutta step.
   * Updates state variables in valuesByStringId in-place.
   */
  private rk4Step(
    h: number,
    vals: Float64Array,
    stateIds: number[],
    derivIds: number[],
    timeId: number,
    t: number,
  ): void {
    const n = stateIds.length;

    // Save initial states
    const y0 = new Float64Array(n);
    for (let i = 0; i < n; i++) y0[i] = vals[stateIds[i] ?? -1] ?? 0;

    // k1 = f(t, y0) — already evaluated by evaluateBlocks
    const k1 = new Float64Array(n);
    for (let i = 0; i < n; i++) k1[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k2 = f(t + h/2, y0 + h/2 * k1)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + 0.5 * h * (k1[i] as number);
    }
    vals[timeId] = t + 0.5 * h;
    this.evaluateBlocks(vals);
    const k2 = new Float64Array(n);
    for (let i = 0; i < n; i++) k2[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k3 = f(t + h/2, y0 + h/2 * k2)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + 0.5 * h * (k2[i] as number);
    }
    this.evaluateBlocks(vals);
    const k3 = new Float64Array(n);
    for (let i = 0; i < n; i++) k3[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k4 = f(t + h, y0 + h * k3)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + h * (k3[i] as number);
    }
    vals[timeId] = t + h;
    this.evaluateBlocks(vals);
    const k4 = new Float64Array(n);
    for (let i = 0; i < n; i++) k4[i] = vals[derivIds[i] ?? -1] ?? 0;

    // y_new = y0 + (h/6) * (k1 + 2*k2 + 2*k3 + k4)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] =
        (y0[i] as number) +
        (h / 6.0) * ((k1[i] as number) + 2 * (k2[i] as number) + 2 * (k3[i] as number) + (k4[i] as number));
    }
  }

  async simulateAsync(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: { signal?: AbortSignal; solver?: "euler" | "rk4" },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;

    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = 0;

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = currentTime;
    this.evaluateBlocks(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }

    for (let s = 0; s <= steps; s++) {
      if (options?.signal?.aborted) {
        throw new Error("Simulation aborted");
      }

      // Yield to the event loop every 100 steps
      if (s % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocks(valuesByStringId);
      this.processWhenClauses(valuesByStringId);

      // Record output
      const currentState = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        currentState[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      }
      t_out.push(currentTime);
      y_out.push(currentState);

      // Integrate state variables
      if (solver === "rk4") {
        this.rk4Step(step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      } else {
        for (let i = 0; i < n; i++) {
          const stateId = stateStringIds[i] ?? -1;
          const derivId = derivStringIds[i] ?? -1;
          if (derivId !== -1 && stateId !== -1) {
            valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + step * (valuesByStringId[derivId] ?? 0);
          }
        }
      }

      currentTime += step;
    }

    return { t: t_out, y: y_out };
  }
}
