import {
  ArenaDAEBuilder,
  EqKind,
  ExprKind,
  Variability,
  evaluateArenaExpression,
  isolateSymbolicallyArena,
  pantelidesIndexReductionArena,
  performBltTransformationArena,
  type ArenaStateMachine,
} from "@modelscript/compiler";
import { evaluateArenaDualExpression } from "./arena-dual-evaluator.js";
import { evaluateArenaRuntime } from "./arena-eval-runtime.js";
import { bdf } from "./bdf.js";
import { dopri5 } from "./dopri5.js";
import { Dual } from "./dual.js";
import { type FmuSubsystem, type FmuSubsystemRegistry } from "./fmu-subsystem.js";
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

/** An arena assertion extracted from EqKind.FunctionCall assert(cond, msg). */
interface ArenaAssertion {
  /** ExprId of the condition expression. */
  conditionExprId: number;
  /** ExprId of the message expression (or -1 if none). */
  messageExprId: number;
}

/** An arena event indicator for zero-crossing detection. */
interface ArenaEventIndicator {
  /** ExprId of the zero-crossing function g(t, y). */
  exprId: number;
  /** Previous value of g() for sign-change detection. */
  prevValue: number;
}

/** Runtime state for a single state machine during arena simulation. */
interface ArenaStateMachineRuntime {
  /** Reference to the source definition. */
  def: ArenaStateMachine;
  /** Name of the currently active state. */
  activeState: string;
  /** Name of the previously active state (for `activeState()` intrinsic). */
  previousState: string;
  /** Number of simulation ticks spent in the current state. */
  ticksInState: number;
  /** Real-valued time spent in the current state (seconds). */
  timeInState: number;
  /**
   * Deferred transition conditions: tracks which transition conditions were true at
   * the *previous* event instant. Deferred transitions (immediate=false) only fire
   * when the condition was true at the end of the previous event iteration, not the
   * current one. Key = transition index in def.transitions, value = previous condition.
   */
  deferredConditions: boolean[];
  /** State name → ordinal mapping for activeState() intrinsic (0-indexed). */
  stateOrdinals: Map<string, number>;
  /** Child state machine runtimes for hierarchical composition. */
  children: ArenaStateMachineRuntime[];
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

  /** Extracted assertion equations for runtime checking. */
  public assertions: ArenaAssertion[] = [];

  /** Event indicator functions for zero-crossing detection. */
  public eventIndicators: ArenaEventIndicator[] = [];

  /** State machine runtimes. */
  public stateMachineRuntimes: ArenaStateMachineRuntime[] = [];

  /**
   * Optional registry of FMU co-simulation subsystems.
   * When set, the simulator delegates input/step/output for matched variable
   * prefixes to the corresponding FmuSubsystem during each integration step.
   */
  public fmuRegistry?: FmuSubsystemRegistry;

  /** Warm-start cache for algebraic loop variables (varNameId → value). */
  private algWarmStart = new Map<number, number>();

  /** Cached FMU prefix → subsystem mapping (built once in prepare). */
  private fmuMappings: { prefix: string; subsystem: FmuSubsystem; inputIds: number[]; outputIds: number[] }[] = [];

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
    this.extractAssertions();
    this.extractEventIndicators();
    this.extractStateMachines();
    this.prepareFmuMappings();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FMU Co-Simulation Bridge
  //
  // When fmuRegistry is set, identified FMU-prefixed variables are delegated
  // to external FmuSubsystem participants during each integration step.
  // ─────────────────────────────────────────────────────────────────────────

  /** Build the prefix→subsystem mappings from the FMU registry. */
  private prepareFmuMappings(): void {
    this.fmuMappings = [];
    if (!this.fmuRegistry) return;

    for (const [prefix, subsystem] of this.fmuRegistry.entries()) {
      const inputIds = subsystem.inputNames.map((n) => this.arena.interner.intern(`${prefix}.${n}`));
      const outputIds = subsystem.outputNames.map((n) => this.arena.interner.intern(`${prefix}.${n}`));
      this.fmuMappings.push({ prefix, subsystem, inputIds, outputIds });
    }
  }

  /**
   * Drive all registered FMU subsystems for one communication step.
   *
   * 1. Read current input values from the arena buffer → set on FMU
   * 2. Advance the FMU by stepSize
   * 3. Read FMU output values → write back into the arena buffer
   */
  private stepFmuSubsystems(valuesByStringId: Float64Array, currentTime: number, stepSize: number): void {
    for (const mapping of this.fmuMappings) {
      // Gather inputs from the arena buffer
      const inputs = new Map<string, number>();
      for (let i = 0; i < mapping.subsystem.inputNames.length; i++) {
        const nameId = mapping.inputIds[i];
        if (nameId !== undefined) {
          inputs.set(mapping.subsystem.inputNames[i] ?? "", valuesByStringId[nameId] ?? 0);
        }
      }

      // Feed inputs, step, and collect outputs
      mapping.subsystem.setInputs(inputs);
      mapping.subsystem.doStep(currentTime, stepSize);
      const outputs = mapping.subsystem.getOutputs();

      // Write outputs back into the arena buffer
      for (let i = 0; i < mapping.subsystem.outputNames.length; i++) {
        const nameId = mapping.outputIds[i];
        const outName = mapping.subsystem.outputNames[i] ?? "";
        if (nameId !== undefined) {
          valuesByStringId[nameId] = outputs.get(outName) ?? 0;
        }
      }
    }
  }

  /**
   * Initialize all registered FMU subsystems. Should be called once before
   * the integration loop begins (after prepare() and before simulate()).
   */
  public initializeFmuSubsystems(startTime: number, stopTime: number, stepSize: number): void {
    this.fmuRegistry?.initializeAll(startTime, stopTime, stepSize);
  }

  /** Terminate all registered FMU subsystems (cleanup). */
  public terminateFmuSubsystems(): void {
    this.fmuRegistry?.terminateAll();
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
  // Assertion Extraction
  // ─────────────────────────────────────────────────────────────────────────

  private extractAssertions() {
    this.assertions = [];
    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      if (this.arena.getEqKind(eqIdx) !== EqKind.FunctionCall) continue;

      // FunctionCall equations store the call ExprId in lhs
      const callExprId = this.arena.getEqLhs(eqIdx);
      if (this.arena.getExprKind(callExprId) !== ExprKind.Call) continue;

      const funcNameId = this.arena.getExprData1(callExprId);
      const funcName = this.arena.interner.resolve(funcNameId);
      if (funcName !== "assert") continue;

      // assert(condition, message): first arg = condition, second = message
      const firstArg = callExprId + 1; // condition ExprId
      const secondArg = callExprId + 2; // message ExprId (may not exist)
      const argCount = this.arena.getExprRight(callExprId);

      this.assertions.push({
        conditionExprId: firstArg,
        messageExprId: argCount >= 2 ? secondArg : -1,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Indicator Extraction
  // ─────────────────────────────────────────────────────────────────────────

  private extractEventIndicators() {
    this.eventIndicators = [];
    // Event indicators from the DAE builder
    for (const exprId of this.arena.eventIndicatorExprIds) {
      this.eventIndicators.push({ exprId, prevValue: 0 });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Machine Extraction
  // ─────────────────────────────────────────────────────────────────────────

  private extractStateMachines() {
    this.stateMachineRuntimes = [];
    for (const sm of this.arena.stateMachines) {
      this.stateMachineRuntimes.push(this.buildStateMachineRuntime(sm));
    }
  }

  /** Recursively build a runtime for a state machine and any nested sub-state machines. */
  private buildStateMachineRuntime(sm: ArenaStateMachine): ArenaStateMachineRuntime {
    const stateOrdinals = new Map<string, number>();
    for (let i = 0; i < sm.states.length; i++) {
      const state = sm.states[i];
      if (state) stateOrdinals.set(state.name, i);
    }

    // Recursively build children for each state that has sub-state machines
    const children: ArenaStateMachineRuntime[] = [];
    for (const state of sm.states) {
      if (state.stateMachines) {
        for (const childSm of state.stateMachines) {
          children.push(this.buildStateMachineRuntime(childSm));
        }
      }
    }

    return {
      def: sm,
      activeState: sm.initialState,
      previousState: sm.initialState,
      ticksInState: 0,
      timeInState: 0,
      deferredConditions: new Array(sm.transitions.length).fill(false),
      stateOrdinals,
      children,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Machine Execution (Modelica 3.3 §17)
  //
  // Transition semantics:
  //   immediate=true  → fires at the CURRENT event instant when condition becomes true
  //   immediate=false → fires at the NEXT event instant after condition was true (deferred)
  //
  // synchronize=true → transition only fires when ALL sub-state machines
  //                    of the source state have reached a final state
  // ─────────────────────────────────────────────────────────────────────────

  private executeStateMachines(valuesByStringId: Float64Array): void {
    for (const rt of this.stateMachineRuntimes) {
      this.executeSingleStateMachine(rt, valuesByStringId);
    }
  }

  /** Get the simulation step size from the time variable delta (or a default). */
  private getStepSize(valuesByStringId: Float64Array): number {
    const timeId = this.arena.interner.intern("time");
    const t = valuesByStringId[timeId] ?? 0;
    // Use a stored previous time to compute dt; fallback to 0.001
    const prevTimeId = this.arena.interner.intern("$__prevTime");
    const prevT = valuesByStringId[prevTimeId] ?? t;
    const dt = t - prevT;
    valuesByStringId[prevTimeId] = t;
    return dt > 0 ? dt : 0;
  }

  private executeSingleStateMachine(rt: ArenaStateMachineRuntime, valuesByStringId: Float64Array): void {
    const dt = this.getStepSize(valuesByStringId);

    // ── Phase 1: Evaluate transitions from the current active state (priority-ordered) ──
    let transitioned = false;
    for (let ti = 0; ti < rt.def.transitions.length; ti++) {
      const tr = rt.def.transitions[ti];
      if (!tr) continue;
      if (tr.fromState !== rt.activeState) continue;

      const condVal = evaluateArenaRuntime(this.arena, tr.conditionExprId, valuesByStringId);
      const condTrue = condVal !== 0;

      // Synchronize guard: if synchronize=true, only fire when all child state
      // machines in the current state have reached a final state (no outgoing transitions)
      if (condTrue && tr.synchronize && rt.children.length > 0) {
        const allFinal = rt.children.every((child) => {
          // A child SM is in a "final" state when no transitions can fire from its active state
          return !child.def.transitions.some((ct) => ct.fromState === child.activeState);
        });
        if (!allFinal) continue; // Not ready — skip this transition
      }

      let shouldFire: boolean;
      if (tr.immediate) {
        // Immediate: fires at the current event instant
        shouldFire = condTrue;
      } else {
        // Deferred: fires only if the condition was true at the *previous* event instant
        shouldFire = rt.deferredConditions[ti] ?? false;
      }

      // Update deferred condition tracking for next iteration
      rt.deferredConditions[ti] = condTrue;

      if (shouldFire) {
        // Transition fires
        rt.previousState = rt.activeState;
        rt.activeState = tr.toState;
        rt.ticksInState = 0;
        rt.timeInState = 0;

        // Apply reset: initialize variables of the destination state
        if (tr.reset) {
          const destState = rt.def.states.find((s) => s.name === tr.toState);
          if (destState) {
            for (const v of destState.variables) {
              valuesByStringId[v.nameId] = v.startValue;
            }
            // Also reset child state machines within the destination state
            if (destState.stateMachines) {
              for (const childSm of destState.stateMachines) {
                const childRt = rt.children.find((c) => c.def.name === childSm.name);
                if (childRt) {
                  childRt.activeState = childSm.initialState;
                  childRt.previousState = childSm.initialState;
                  childRt.ticksInState = 0;
                  childRt.timeInState = 0;
                  childRt.deferredConditions.fill(false);
                }
              }
            }
          }
        }

        transitioned = true;
        break; // Only one transition per tick (highest priority wins)
      }
    }

    if (!transitioned) {
      rt.ticksInState++;
      rt.timeInState += dt;
    }

    // ── Phase 2: Activate equations for the current state ──
    const activeStateDef = rt.def.states.find((s) => s.name === rt.activeState);
    if (activeStateDef) {
      for (const eq of activeStateDef.equations) {
        const val = evaluateArenaRuntime(this.arena, eq.exprId, valuesByStringId);
        if (eq.isDerivative) {
          // For derivative equations: write to der(varName)
          const varName = this.arena.interner.resolve(eq.targetNameId);
          const derNameId = this.arena.interner.intern(`der(${varName})`);
          valuesByStringId[derNameId] = isFinite(val) ? val : 0;
        } else {
          valuesByStringId[eq.targetNameId] = isFinite(val) ? val : 0;
        }
      }
    }

    // ── Phase 3: Recursively execute child state machines of the active state ──
    if (activeStateDef?.stateMachines) {
      for (const childSm of activeStateDef.stateMachines) {
        const childRt = rt.children.find((c) => c.def.name === childSm.name);
        if (childRt) {
          this.executeSingleStateMachine(childRt, valuesByStringId);
        }
      }
    }

    // ── Phase 4: Expose state machine intrinsics ──
    // activeState(sm) → ordinal of current active state (0-indexed)
    const activeStateIntrinsicId = this.arena.interner.intern(`$activeState(${rt.def.name})`);
    valuesByStringId[activeStateIntrinsicId] = rt.stateOrdinals.get(rt.activeState) ?? 0;

    // ticksInState(sm) → integer tick count
    const ticksIntrinsicId = this.arena.interner.intern(`$ticksInState(${rt.def.name})`);
    valuesByStringId[ticksIntrinsicId] = rt.ticksInState;

    // timeInState(sm) → real-valued time spent in current state
    const timeInStateId = this.arena.interner.intern(`$timeInState(${rt.def.name})`);
    valuesByStringId[timeInStateId] = rt.timeInState;

    // previousState(sm) → ordinal of previously active state
    const prevStateId = this.arena.interner.intern(`$previousState(${rt.def.name})`);
    valuesByStringId[prevStateId] = rt.stateOrdinals.get(rt.previousState) ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Assertion Checking
  // ─────────────────────────────────────────────────────────────────────────

  private checkAssertions(valuesByStringId: Float64Array, t: number): void {
    for (const assertion of this.assertions) {
      const condVal = evaluateArenaRuntime(this.arena, assertion.conditionExprId, valuesByStringId);
      if (condVal === 0) {
        let msg = `Assertion failed at t=${t}`;
        if (assertion.messageExprId !== -1) {
          const msgVal = evaluateArenaRuntime(this.arena, assertion.messageExprId, valuesByStringId);
          msg = `Assertion failed at t=${t}: ${msgVal}`;
        }
        throw new Error(msg);
      }
    }
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
  // RHS Bridge: builds a (t, y) => dy/dt callback for Dopri5/BDF
  // ─────────────────────────────────────────────────────────────────────────

  private buildRhsFunction(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
  ): (t: number, y: number[]) => number[] {
    const n = stateStringIds.length;
    return (t: number, y: number[]): number[] => {
      // Write state into the environment
      valuesByStringId[timeId] = t;
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
      }
      // Evaluate all blocks
      this.evaluateBlocks(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, t, 0);
      this.checkAssertions(valuesByStringId, t);

      // Read derivatives
      const dydt = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        dydt[i] = valuesByStringId[derivStringIds[i] ?? -1] ?? 0;
      }
      return dydt;
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Functions Bridge: builds g_i(t, y) functions for zero-crossing
  // ─────────────────────────────────────────────────────────────────────────

  private buildEventFunctions(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    timeId: number,
  ): ((t: number, y: number[]) => number)[] {
    if (this.eventIndicators.length === 0) return [];
    const n = stateStringIds.length;

    return this.eventIndicators.map((ei) => {
      return (t: number, y: number[]): number => {
        valuesByStringId[timeId] = t;
        for (let i = 0; i < n; i++) {
          valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
        }
        return evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Callback: handles zero-crossing events (reinit, discrete updates)
  // ─────────────────────────────────────────────────────────────────────────

  private buildEventCallback(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    timeId: number,
  ): (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[] {
    const n = stateStringIds.length;
    return (t: number, y: number[]): number[] => {
      // Write state at event time
      valuesByStringId[timeId] = t;
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
      }
      // Process when-clauses at event time (may reinit state variables)
      this.evaluateBlocks(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, t, 0);

      // Read back possibly-modified state
      const yAfter = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        yAfter[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      }
      return yAfter;
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Simulation (multi-solver: Euler, RK4, Dopri5, BDF)
  // ─────────────────────────────────────────────────────────────────────────

  simulate(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      solver?: "euler" | "rk4" | "dopri5" | "bdf" | "auto";
      atol?: number;
      rtol?: number;
    },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = startTime;
    this.evaluateBlocks(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }
    // Initialize event indicator previous values
    for (const ei of this.eventIndicators) {
      ei.prevValue = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
    }

    // ── Adaptive solvers (Dopri5, BDF) ──
    if (solver === "dopri5" || solver === "bdf" || solver === "auto") {
      return this.simulateAdaptive(
        solver,
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        options,
      );
    }

    // ── Fixed-step solvers (RK4, Euler) ──
    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = startTime;

    for (let s = 0; s <= steps; s++) {
      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocks(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, step);
      this.checkAssertions(valuesByStringId, currentTime);

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
   * Run simulation using an adaptive solver (Dopri5 or BDF).
   * Bridges the arena evaluation into the standalone solver modules.
   */
  private simulateAdaptive(
    solver: "dopri5" | "bdf" | "auto",
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
    options?: { atol?: number; rtol?: number },
  ) {
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;
    const stopTime = startTime + steps * step;
    const atol = options?.atol ?? 1e-6;
    const rtol = options?.rtol ?? 1e-6;

    // Build output times
    const outputTimes: number[] = [];
    for (let i = 0; i <= steps; i++) {
      outputTimes.push(startTime + i * step);
    }

    // Extract initial state
    const y0: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      y0[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
    }

    // Build RHS function
    const rhsFn = this.buildRhsFunction(valuesByStringId, stateStringIds, derivStringIds, timeId);

    // Build event functions and callback
    const eventFns = this.buildEventFunctions(valuesByStringId, stateStringIds, timeId);
    const eventCb = eventFns.length > 0 ? this.buildEventCallback(valuesByStringId, stateStringIds, timeId) : undefined;

    let rawResult: { times: number[]; states: number[][] };

    if (solver === "bdf") {
      rawResult = bdf(
        rhsFn,
        startTime,
        y0,
        stopTime,
        outputTimes,
        { atol, rtol },
        eventFns.length > 0 ? eventFns : undefined,
        eventCb,
      );
    } else {
      // dopri5 or auto
      rawResult = dopri5(
        rhsFn,
        startTime,
        y0,
        stopTime,
        outputTimes,
        { atol, rtol },
        eventFns.length > 0 ? eventFns : undefined,
        eventCb,
      );
    }

    // Convert to Float64Array output format
    const t_out = rawResult.times;
    const y_out: Float64Array[] = rawResult.states.map((row) => {
      const fa = new Float64Array(n);
      for (let i = 0; i < n; i++) fa[i] = row[i] ?? 0;
      return fa;
    });

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
    options?: {
      signal?: AbortSignal;
      solver?: "euler" | "rk4" | "dopri5" | "bdf" | "auto";
      atol?: number;
      rtol?: number;
    },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = startTime;
    this.evaluateBlocks(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }
    for (const ei of this.eventIndicators) {
      ei.prevValue = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
    }

    // Adaptive solvers run synchronously (they're CPU-bound; yielding inside would break solver state)
    if (solver === "dopri5" || solver === "bdf" || solver === "auto") {
      if (options?.signal?.aborted) throw new Error("Simulation aborted");
      return this.simulateAdaptive(
        solver,
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        options,
      );
    }

    // Fixed-step with async yielding
    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = startTime;

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
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, step);
      this.checkAssertions(valuesByStringId, currentTime);

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
