import type { ArenaStateMachine, DAEBuilder } from "../../index.js";

export interface SimulationResult {
  /** Time vector */
  t: number[];
  /** State matrix [time_step][state_index] */
  y: number[][];
  /** Names of the states/variables corresponding to the columns of y */
  states: string[];
  /** Optional parameter info passed back from the simulator */
  parameters?: { name: string; value: number | string | boolean }[];
}

/** Describes a single action inside a when-clause body. */
export interface ArenaWhenAction {
  type: "reinit" | "assign";
  /** StringId of the target variable. */
  targetNameId: number;
  /** ExprId of the right-hand side expression. */
  exprId: number;
}

/** An arena when-clause ready for evaluation during simulation. */
export interface ArenaWhenClause {
  /** ExprId of the condition expression. */
  conditionExprId: number;
  /** Actions to execute when the clause fires (rising edge). */
  actions: ArenaWhenAction[];
  /** Whether the condition was active at the previous time step. */
  wasActive: boolean;
}

/** An arena assertion extracted from EqKind.FunctionCall assert(cond, msg). */
export interface ArenaAssertion {
  /** ExprId of the condition expression. */
  conditionExprId: number;
  /** ExprId of the message expression (or -1 if none). */
  messageExprId: number;
}

/** An arena event indicator for zero-crossing detection. */
export interface ArenaEventIndicator {
  /** ExprId of the zero-crossing function g(t, y). */
  exprId: number;
  /** Previous value of g() for sign-change detection. */
  prevValue: number;
  /**
   * Crossing direction to trigger the event:
   *  -1 = positive→negative only (e.g., h <= 0 triggers when h crosses zero downward)
   *  +1 = negative→positive only (e.g., h >= 0)
   *   0 = both directions
   */
  direction: -1 | 0 | 1;
}

/** Runtime state for a single state machine during arena simulation. */
export interface ArenaStateMachineRuntime {
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

/** Debugger hook interface for step-through simulation inspection. */
export interface SimulationDebugger {
  /** Called on each arena algorithm statement execution. */
  onArenaStatement?(arena: DAEBuilder, stmtIdx: number, values: Float64Array): Promise<void> | void;
  /** Called on each simulation step. */
  onStep?(time: number, env: Float64Array): void;
}
