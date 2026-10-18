// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-implied-eval */

import {
  BinOp,
  DAEBuilder,
  EqKind,
  ExprKind,
  UnaryOp,
  VarAttrKind,
  Variability,
  causalizeVectorArena,
  convertArenaToMicroModelica,
  eliminateVectorArenaAliases,
  evaluateArenaExpression,
  expandSetBasedConnectionsArena,
  hasArrayEquations,
  isolateSymbolicallyArena,
  pantelidesIndexReductionArena,
  performBltTransformationArena,
  scalarizeArena,
  tryOptimizeLoopWithGroebner,
  type ArenaStateMachine,
} from "@modelscript/runtime";
import { bdf } from "@modelscript/runtime/wasm_bdf.js";
import { dopri5 } from "@modelscript/runtime/wasm_dopri5.js";
import {
  Dual,
  evaluateArenaDualExpression,
  evaluateArenaDualFlat,
  evaluateArenaRuntime,
} from "@modelscript/runtime/wasm_evaluator.js";
import { type FmuSubsystem, type FmuSubsystemRegistry } from "@modelscript/runtime/wasm_fmu_subsystem.js";
import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";
import { solveInitialEquationsArena } from "@modelscript/runtime/wasm_init.js";
import { executeArenaStatements, executeArenaStatementsAsync } from "@modelscript/runtime/wasm_statement_executor.js";
import { buildAdJacobian } from "@modelscript/runtime/wasm_tape.js";
import { qssSolve } from "../solvers/qss-solver.js";
import { rodas4p } from "../solvers/rodas4p.js";
import { trbdf2 } from "../solvers/trbdf2.js";
import { tsit5 } from "../solvers/tsit5.js";
import {
  type ArenaAssertion,
  type ArenaEventIndicator,
  type ArenaStateMachineRuntime,
  type ArenaWhenAction,
  type ArenaWhenClause,
  type SimulationDebugger,
} from "./simulation.js";
import { OnlineSTLMonitor, type STLStepResult } from "./stl_monitor.js";

/** Maximum Newton iterations for algebraic loop solving. */
const NEWTON_MAX_ITER = 20;
/** Newton convergence tolerance. */
const NEWTON_TOL = 1e-10;
/** Square root of machine epsilon for finite-difference perturbation. */
const SQRT_EPS = 1.4901161193847656e-8;

/**
 * Cached 1D lookup table data extracted from a Modelica `CombiTimeTable` or `CombiTable1D` block.
 */
interface CachedTable1D {
  /** 2D array of table rows `[time_or_u, col_1, col_2, ...]`. */
  table: number[][];
  /** 1-based column indices to interpolate from `table`. */
  columns: number[];
  /** Time offset subtracted from simulation time before lookup (`s`). */
  shiftTime: number;
  /** Time scaling factor applied to shifted simulation time. */
  timeScale: number;
  /** Activation start time for the table block (`s`). */
  startTime: number;
}

/**
 * Recursively extracts a numeric scalar or nested array literal from a DAE arena expression node.
 *
 * @param arena - DAE arena instance.
 * @param exprId - Expression node index in the arena.
 * @returns Numeric scalar, nested array of numbers, or `null` if not a literal expression.
 */
function extractSimArrayLiteral(arena: any, exprId: number): any {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.ArrayCtor) {
    const count = arena.getExprData1(exprId);
    const elems: any[] = [];
    elems.push(extractSimArrayLiteral(arena, arena.getExprLeft(exprId)));
    for (let i = 1; i < count; i++) {
      elems.push(extractSimArrayLiteral(arena, arena.getExprLeft(exprId + i)));
    }
    return elems;
  }
  return null;
}

/**
 * Performs piecewise linear 1D interpolation with constant clamping outside the table domain.
 *
 * @param table - 2D array of sorted rows where column `0` is the abscissa (`u`).
 * @param colIdx - Zero-based column index of the ordinate (`y`) to interpolate.
 * @param u - Query abscissa value.
 * @returns Interpolated ordinate value at `u`.
 */
function interpolate1DSim(table: number[][], colIdx: number, u: number): number {
  if (!table || table.length === 0) return 0.0;
  const n = table.length;
  if (n === 1) return table[0]![colIdx] ?? 0.0;

  if (u <= table[0]![0]!) return table[0]![colIdx] ?? 0.0;
  if (u >= table[n - 1]![0]!) return table[n - 1]![colIdx] ?? 0.0;

  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]![0]! <= u) lo = mid;
    else hi = mid;
  }

  while (hi < n - 1 && table[hi]![0]! <= u) {
    lo = hi;
    hi++;
  }

  const x0 = table[lo]![0]!;
  const x1 = table[hi]![0]!;
  const y0 = table[lo]![colIdx] ?? 0.0;
  const y1 = table[hi]![colIdx] ?? 0.0;

  if (Math.abs(x1 - x0) < 1e-15) return y1;
  const t = (u - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * Retrieves or builds a cached 1D lookup table (`CachedTable1D`) for a `CombiTimeTable` block in the arena.
 *
 * @param arena - DAE arena instance.
 * @param tableVarNameId - Interned string ID of the `.tableID` variable.
 * @returns Cached table descriptor, or `null` if no table data could be resolved.
 */
function getOrCreateSimCachedTable(arena: any, tableVarNameId: number): CachedTable1D | null {
  if (!arena._cachedTables) {
    arena._cachedTables = new Map<number, CachedTable1D>();
  }
  const cachedMap: Map<number, CachedTable1D> = arena._cachedTables;
  if (cachedMap.has(tableVarNameId)) {
    return cachedMap.get(tableVarNameId)!;
  }

  const tableVarName = arena.interner.resolve(tableVarNameId) ?? "";
  const prefix = tableVarName.replace(/\.tableID$/, "");

  let tableData: number[][] | null = null;
  const tableIdx = arena.getVarIdxByName(`${prefix}.table`);
  if (tableIdx >= 0) {
    const tableExpr = arena.getVarExpression(tableIdx);
    const data = extractSimArrayLiteral(arena, tableExpr);
    if (Array.isArray(data)) tableData = data;
  }
  if (!tableData) {
    if (arena.getVarIdxByName(`${prefix}.table[1,1]`) >= 0) {
      tableData = [];
      let r = 1;
      while (true) {
        if (arena.getVarIdxByName(`${prefix}.table[${r},1]`) < 0) break;
        const row: number[] = [];
        let c = 1;
        while (true) {
          const vIdx = arena.getVarIdxByName(`${prefix}.table[${r},${c}]`);
          if (vIdx < 0) break;
          const exprId = arena.getVarExpression(vIdx);
          const val =
            (exprId >= 0
              ? arena.getExprKind(exprId) === ExprKind.IntLiteral
                ? arena.getExprData1(exprId)
                : arena.getExprRealValue(exprId)
              : arena.getVarStartValue(vIdx)) ?? 0;
          row.push(val);
          c++;
        }
        if (row.length === 0) break;
        tableData.push(row);
        r++;
      }
    }
  }
  if (!tableData || tableData.length === 0) return null;

  let columns: number[] = [1];
  const colsIdx = arena.getVarIdxByName(`${prefix}.columns`);
  if (colsIdx >= 0) {
    const colsExpr = arena.getVarExpression(colsIdx);
    const colsData = extractSimArrayLiteral(arena, colsExpr);
    if (Array.isArray(colsData)) {
      columns = colsData.map(Number);
    }
  } else if (arena.getVarIdxByName(`${prefix}.columns[1]`) >= 0) {
    columns = [];
    let i = 1;
    while (true) {
      const vIdx = arena.getVarIdxByName(`${prefix}.columns[${i}]`);
      if (vIdx < 0) break;
      const exprId = arena.getVarExpression(vIdx);
      const val =
        (exprId >= 0
          ? arena.getExprKind(exprId) === ExprKind.IntLiteral
            ? arena.getExprData1(exprId)
            : arena.getExprRealValue(exprId)
          : arena.getVarStartValue(vIdx)) ?? i;
      columns.push(Math.round(val));
      i++;
    }
  }

  const shiftIdx = arena.getVarIdxByName(`${prefix}.shiftTime`);
  let shiftTime = 0.0;
  if (shiftIdx >= 0) {
    const shiftExpr = arena.getVarExpression(shiftIdx);
    const val = extractSimArrayLiteral(arena, shiftExpr);
    if (typeof val === "number") shiftTime = val;
  }

  const scaleIdx = arena.getVarIdxByName(`${prefix}.timeScale`);
  let timeScale = 1.0;
  if (scaleIdx >= 0) {
    const scaleExpr = arena.getVarExpression(scaleIdx);
    const val = extractSimArrayLiteral(arena, scaleExpr);
    if (typeof val === "number") timeScale = val;
  }

  const startIdx = arena.getVarIdxByName(`${prefix}.startTime`);
  let startTime = 0.0;
  if (startIdx >= 0) {
    const startExpr = arena.getVarExpression(startIdx);
    const val = extractSimArrayLiteral(arena, startExpr);
    if (typeof val === "number") startTime = val;
  }

  const record: CachedTable1D = {
    table: tableData,
    columns,
    shiftTime,
    timeScale,
    startTime,
  };
  cachedMap.set(tableVarNameId, record);
  return record;
}

/**
 * Evaluates a `Modelica.Blocks.Tables.CombiTimeTable` output column at a given simulation time.
 *
 * @param cached - Cached table descriptor.
 * @param icol - 1-based output port index (`y[icol]`).
 * @param timeIn - Current simulation time (`s`).
 * @returns Interpolated table output value.
 */
function evalSimTimeTableValue(cached: CachedTable1D | null, icol: number, timeIn: number): number {
  if (!cached || !cached.table || cached.table.length === 0) return 0.0;
  const table = cached.table;
  const effTime = (timeIn - cached.shiftTime) / (cached.timeScale || 1.0);
  const colInTable = cached.columns && cached.columns.length >= icol ? cached.columns[icol - 1]! - 1 : icol;
  return interpolate1DSim(table, colInTable, effTime);
}

/**
 * Arena-native DAE/ODE simulation engine operating directly on linear-memory `DAEBuilder` structures.
 *
 * Handles parameter evaluation, Pantelides index reduction, Tarjan BLT causalization,
 * JIT block compilation, hybrid zero-crossing event handling, state machines, and integration
 * via RK4, DOPRI5, BDF, RadauIIA, Symplectic Euler, and SUNDIALS CVODE/IDA WASM.
 */
export class ArenaSimulator {
  /** Resolved parameter and constant values keyed by variable name. */
  public parameters = new Map<string, number>();
  /** Optional interactive debugger hook invoked during equation evaluation and step transitions. */
  public debuggerHook?: SimulationDebugger | undefined;

  /** Recorded safety barrier violations during simulation. */
  public safetyViolations: {
    t: number;
    monitorName?: string | undefined;
    robustness: number;
    details?: string | undefined;
  }[] = [];

  /** Recorded interval / DAE singularity issues. */
  public intervalIssues: string[] = [];

  // Sets of VarIdx for fast arena-native processing
  /** Set of arena variable indices classified as parameters or constants. */
  public parameterVars = new Set<number>();
  /** Set of arena variable indices classified as continuous ODE states ($x$). */
  public stateVars = new Set<number>();
  /** Set of arena variable indices representing state derivatives ($\dot{x}$). */
  public derivativeVars = new Set<number>();

  /** Topologically sorted equation indices produced by BLT transformation. */
  public sortedEquations: number[] = [];
  /** Strongly connected components (algebraic/causal blocks) produced by Tarjan BLT analysis. */
  public blocks: { eqIdxs: number[]; vars: number[] }[] = [];
  /** Set of arena variable indices demoted to algebraic dummy derivatives during Pantelides index reduction. */
  public dummyDerivatives = new Set<number>();
  /** Prepared execution blocks (explicit single assignments and implicit algebraic systems). */
  public executionBlocks: import("@modelscript/runtime").ArenaExecutionBlock[] = [];
  /** Optional JIT-compiled fast-path evaluator for causal execution blocks. */
  public compiledBlocks: ((env: Float64Array) => void) | null = null;

  /** Extracted when-clauses for event handling. */
  public whenClauses: ArenaWhenClause[] = [];

  /** Extracted assertion equations for runtime checking. */
  public assertions: ArenaAssertion[] = [];

  /** Event indicator functions for zero-crossing detection. */
  public eventIndicators: ArenaEventIndicator[] = [];

  /** Extracted derivative equations: der(x) = expr. */
  // derivativeEquations removed

  /** State machine runtimes. */
  public stateMachineRuntimes: ArenaStateMachineRuntime[] = [];

  /**
   * Optional registry of FMU co-simulation subsystems.
   * When set, the simulator delegates input/step/output for matched variable
   * prefixes to the corresponding FmuSubsystem during each integration step.
   */
  public fmuRegistry?: FmuSubsystemRegistry | undefined;

  /** Warm-start cache for algebraic loop variables (varNameId → value). */
  private algWarmStart = new Map<number, number>();

  /** Cached FMU prefix → subsystem mapping (built once in prepare). */
  private fmuMappings: { prefix: string; subsystem: FmuSubsystem; inputIds: number[]; outputIds: number[] }[] = [];

  // ── Pre-allocated zero-allocation scratch buffers for Newton algebraic loops ──
  /** Scratch vector for current algebraic iterate $x_k$. */
  private newtonScratchX = new Float64Array(32);
  /** Scratch vector for residual evaluation $r(x_k)$. */
  private newtonScratchR = new Float64Array(32);
  /** Scratch vector for negated residual $-r(x_k)$ (overwritten with Newton step $\Delta x$). */
  private newtonScratchNegR = new Float64Array(32);
  /** Scratch array mapping block variable indices to interned string IDs. */
  private newtonScratchVarIds = new Int32Array(32);
  /** Scratch flat row-major buffer for the $m \times m$ block Jacobian matrix $J$. */
  private newtonScratchMat = new Float64Array(32 * 32);
  /** Scratch pivot index array for LU decomposition with partial pivoting. */
  private newtonScratchPiv = new Int32Array(32);
  /** Scratch row-scaling array for implicit equilibration in LU factorization. */
  private newtonScratchScale = new Float64Array(32);
  /** Scratch stack for forward-mode dual-number automatic differentiation (`[val, der]` pairs). */
  private newtonScratchDualStack = new Float64Array(128);

  /**
   * Ensures pre-allocated Newton-Raphson scratch buffers have capacity for an $m \times m$ algebraic block.
   *
   * @param m - Number of algebraic unknowns in the block.
   */
  private ensureNewtonCapacity(m: number): void {
    if (this.newtonScratchX.length < m) {
      const cap = Math.max(m, this.newtonScratchX.length * 2);
      this.newtonScratchX = new Float64Array(cap);
      this.newtonScratchR = new Float64Array(cap);
      this.newtonScratchNegR = new Float64Array(cap);
      this.newtonScratchVarIds = new Int32Array(cap);
      this.newtonScratchMat = new Float64Array(cap * cap);
      this.newtonScratchPiv = new Int32Array(cap);
      this.newtonScratchScale = new Float64Array(cap);
    }
  }

  /** Previous-step variable value buffer indexed by interned string ID (for `pre(v)` and edge detection). */
  public preValuesByStringId!: Float64Array;

  /**
   * Creates a new `ArenaSimulator` bound to a flattened `DAEBuilder` arena.
   *
   * @param arena - Flattened DAE arena containing variables, equations, and expressions.
   */
  constructor(public arena: DAEBuilder) {}

  /**
   * Prepares the DAE arena for numerical integration: scalarizes array equations, resolves parameters,
   * reduces high-index constraints (Pantelides + affine/kinematic reduction), performs Tarjan BLT
   * causalization, compiles execution blocks, and extracts hybrid events, assertions, and state machines.
   */
  prepare() {
    let hasPreservedArrays = hasArrayEquations(this.arena);
    if (!hasPreservedArrays) {
      for (let i = 0; i < this.arena.varCount; i++) {
        if (!this.arena.isVarRemoved(i) && this.arena.getVarShape(i).length > 0) {
          hasPreservedArrays = true;
          break;
        }
      }
    }
    if (hasPreservedArrays) {
      this.arena = (scalarizeArena as (arena: DAEBuilder, forceFullScalarize?: boolean) => DAEBuilder)(
        this.arena,
        true,
      );
    }

    const cachedPrep = (this.arena as any)._cachedSimPrep;
    if (cachedPrep) {
      this.parameters = new Map(cachedPrep.parameters);
      this.parameterVars = new Set(cachedPrep.parameterVars);
      for (const i of this.parameterVars) {
        if (this.arena.isVarRemoved(i)) continue;
        const name = this.arena.getVarName(i);
        const exprId = (this.arena as any).getVarExpression ? (this.arena as any).getVarExpression(i) : undefined;
        let val: number | null = null;
        if (typeof exprId === "number" && exprId !== -1) {
          const rawVal = evaluateArenaExpression(this.arena, exprId, this.parameters);
          if (typeof rawVal === "number" && isFinite(rawVal)) {
            val = rawVal;
          }
        }
        if (val === null || typeof val !== "number" || !isFinite(val)) {
          val = this.arena.getVarStartValue(i);
        }
        this.parameters.set(name, val);
      }
      this.stateVars = new Set(cachedPrep.stateVars);
      this.derivativeVars = new Set(cachedPrep.derivativeVars);
      this.dummyDerivatives = new Set(cachedPrep.dummyDerivatives);
      this.sortedEquations = cachedPrep.sortedEquations;
      this.blocks = cachedPrep.blocks;
      this.executionBlocks = cachedPrep.executionBlocks;
      this.preValuesByStringId = new Float64Array(this.arena.interner.size);
      (this.arena as any)._delayHistory = new Map();
      this.compiledBlocks = this.compileBlocks();
      this.extractWhenClauses();
      this.extractAssertions();
      this.extractEventIndicators();
      this.extractStateMachines();
      this.prepareFmuMappings();
      return;
    }

    (this.arena as any)._mutatedBySim = true;
    (this.arena as any)._delayHistory = new Map();
    this.preValuesByStringId = new Float64Array(this.arena.interner.size);
    this.resolveParameters();
    this.resolveKinematicVelocities();
    this.reduceAffineStateConstraints();
    this.identifyDerivatives();
    this.eliminateAliases();

    // Arena-Native Pantelides Index Reduction
    const pantelidesRes = pantelidesIndexReductionArena(
      this.arena,
      this.stateVars,
      this.derivativeVars,
      this.parameterVars,
    );
    this.dummyDerivatives = pantelidesRes.dummyDerivatives;

    // Arena-Native BLT / Bipartite Matching
    const bltRes = performBltTransformationArena(this.arena, this.stateVars, this.dummyDerivatives, this.parameterVars);
    this.sortedEquations = bltRes.sortedEquations;
    this.blocks = bltRes.blocks;

    this.buildExecutionBlocks();
    (this.arena as any)._cachedSimPrep = {
      parameters: new Map(this.parameters),
      parameterVars: new Set(this.parameterVars),
      stateVars: new Set(this.stateVars),
      derivativeVars: new Set(this.derivativeVars),
      dummyDerivatives: new Set(this.dummyDerivatives),
      sortedEquations: this.sortedEquations,
      blocks: this.blocks,
      executionBlocks: this.executionBlocks,
    };

    this.compiledBlocks = this.compileBlocks();
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

  /**
   * Converts BLT blocks into executable `ArenaExecutionBlock` entries by attempting symbolic
   * isolation (`isolateSymbolicallyArena`) for $1 \times 1$ blocks and Groebner-basis triangularization
   * (`tryOptimizeLoopWithGroebner`) for multi-equation algebraic loops.
   */
  private buildExecutionBlocks() {
    for (const block of this.blocks) {
      // Skip blocks with no equations — these are unmatched state variables
      // managed by the ODE integrator, not algebraic unknowns.
      if (block.eqIdxs.length === 0) continue;

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
        const optimized = tryOptimizeLoopWithGroebner(this.arena, block.eqIdxs, block.vars);
        if (optimized) {
          this.executionBlocks.push(...optimized);
        } else {
          this.executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: block.vars });
        }
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

  /**
   * Identifies parameter and constant variables in the arena, evaluates their binding expressions
   * or start attributes, and populates `this.parameterVars` and `this.parameters`.
   */
  private resolveParameters() {
    const exprReferencesContinuous = (exprId: number): boolean => {
      if (exprId < 0) return false;
      const k = this.arena.getExprKind(exprId);
      if (k === ExprKind.Name) {
        const nameId = this.arena.getExprData1(exprId);
        const name = this.arena.interner.resolve(nameId);
        if (name === "time") return true;
        const vIdx = this.arena.lookupVariable(nameId);
        if (vIdx >= 0) {
          const v = this.arena.getVarVariability(vIdx);
          return v !== Variability.Parameter && v !== Variability.Constant;
        }
        return false;
      }
      if (k === ExprKind.Der || k === ExprKind.Pre) return true;
      if (k === ExprKind.Unary || k === ExprKind.Negate) {
        return exprReferencesContinuous(this.arena.getExprLeft(exprId));
      }
      if (k === ExprKind.Binary) {
        return (
          exprReferencesContinuous(this.arena.getExprLeft(exprId)) ||
          exprReferencesContinuous(this.arena.getExprRight(exprId))
        );
      }
      if (k === ExprKind.IfElse) {
        return (
          exprReferencesContinuous(this.arena.getExprData1(exprId)) ||
          exprReferencesContinuous(this.arena.getExprLeft(exprId)) ||
          exprReferencesContinuous(this.arena.getExprRight(exprId))
        );
      }
      if (k === ExprKind.Call) {
        const argc = this.arena.getExprRight(exprId);
        const firstArg = this.arena.getExprLeft(exprId);
        for (let a = 0; a < argc; a++) {
          const argId = a === 0 ? firstArg : this.arena.getExprLeft(exprId + a);
          if (exprReferencesContinuous(argId)) return true;
        }
      }
      return false;
    };

    for (let i = 0; i < this.arena.varCount; i++) {
      if (this.arena.isVarRemoved(i)) continue;
      const variability = this.arena.getVarVariability(i);
      const isParam = variability === Variability.Parameter || variability === Variability.Constant;
      const hasExplicitExpr = (this.arena as any).hasExplicitVarExpression?.(i);
      const isNotState = !this.stateVars.has(i);

      if (!isParam && !(hasExplicitExpr && isNotState)) continue;

      const exprId = (this.arena as any).getVarExpression ? (this.arena as any).getVarExpression(i) : undefined;
      if (!isParam && typeof exprId === "number" && exprId >= 0 && exprReferencesContinuous(exprId)) {
        // Continuous/discrete variable with a continuous binding expression (e.g. from omcCompatibility: true).
        // Ensure its binding equation is present in the DAE arena rather than treating it as a static parameter.
        let hasEq = false;
        const varNameId = this.arena.getVarNameId(i);
        for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
          if (this.arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
          const lhs = this.arena.getEqLhs(eqIdx);
          const rhs = this.arena.getEqRhs(eqIdx);
          if (
            rhs === exprId &&
            lhs >= 0 &&
            this.arena.getExprKind(lhs) === ExprKind.Name &&
            this.arena.getExprData1(lhs) === varNameId
          ) {
            hasEq = true;
            break;
          }
        }
        if (!hasEq) {
          const lhsExprId = this.arena.addExpression(ExprKind.Name, varNameId);
          this.arena.addEquation(EqKind.Simple, lhsExprId, exprId);
        }
        continue;
      }

      this.parameterVars.add(i);

      const name = this.arena.getVarName(i);
      let val: number | null = null;
      if (typeof exprId === "number" && exprId !== -1) {
        const rawVal = evaluateArenaExpression(this.arena, exprId, this.parameters);
        if (typeof rawVal === "number" && isFinite(rawVal)) {
          val = rawVal;
        }
      }
      if (val === null || typeof val !== "number" || !isFinite(val)) {
        val = this.arena.getVarStartValue(i);
      }
      this.parameters.set(name, val);
    }
  }

  /**
   * No-op stub retained for pipeline compatibility; linear alias elimination is performed
   * during flattening via `eliminateArenaAliases()`.
   */
  private eliminateAliases() {
    // Alias elimination was moved to the flattener via eliminateArenaAliases()
    // in O(N) time. The simulator no longer needs to do it!
  }

  /**
   * Resolves translational (`v = der(s)`) and rotational (`w = der(phi)`) kinematic velocity couplings
   * across rigid mechanical components to prevent redundant index-2 velocity state constraints.
   */
  private resolveKinematicVelocities() {
    // 1. Identify all differential pairs v = der(p) (and second-order a = der(v)) in the DAE
    const derVarOf = new Map<number, number>(); // pIdx -> vIdx
    const derEqOf = new Map<number, number>(); // pIdx -> eqIdx
    const isDerTarget = new Set<number>();
    const flowCoupledVars = new Set<number>();

    for (let v = 0; v < this.arena.varCount; v++) {
      if (!this.arena.isVarRemoved(v) && this.arena.isVarFlow(v)) {
        flowCoupledVars.add(v);
      }
    }

    for (let i = 0; i < this.arena.eqCount; i++) {
      if (this.arena.getEqKind(i) !== EqKind.Simple) continue;
      const lhs = this.arena.getEqLhs(i);
      const rhs = this.arena.getEqRhs(i);
      if (this.arena.getExprKind(rhs) === ExprKind.Der && this.arena.getExprKind(lhs) === ExprKind.Name) {
        const derArg = this.arena.getExprData1(rhs);
        if (this.arena.getExprKind(derArg) === ExprKind.Name) {
          const vIdx = this.arena.lookupVariable(this.arena.getExprData1(lhs));
          const pIdx = this.arena.lookupVariable(this.arena.getExprData1(derArg));
          if (vIdx >= 0 && pIdx >= 0 && !flowCoupledVars.has(vIdx)) {
            derVarOf.set(pIdx, vIdx);
            derEqOf.set(pIdx, i);
            isDerTarget.add(vIdx);
          }
        }
      }
    }

    if (derVarOf.size === 0) return;

    // Helper: check if an expression references a specific variable index or any flow-coupled variable
    const exprRefsVar = (exprId: number, targetVarIdx: number): boolean => {
      if (exprId < 0) return false;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Name) {
        return this.arena.lookupVariable(this.arena.getExprData1(exprId)) === targetVarIdx;
      }
      if (kind === ExprKind.Binary) {
        return (
          exprRefsVar(this.arena.getExprLeft(exprId), targetVarIdx) ||
          exprRefsVar(this.arena.getExprRight(exprId), targetVarIdx)
        );
      }
      if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
        return exprRefsVar(this.arena.getExprLeft(exprId), targetVarIdx);
      }
      if (kind === ExprKind.IfElse) {
        return (
          exprRefsVar(this.arena.getExprData1(exprId), targetVarIdx) ||
          exprRefsVar(this.arena.getExprLeft(exprId), targetVarIdx) ||
          exprRefsVar(this.arena.getExprRight(exprId), targetVarIdx)
        );
      }
      return false;
    };

    const exprHasDer = (exprId: number): boolean => {
      if (exprId < 0) return false;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Der) return true;
      if (kind === ExprKind.Binary) {
        return exprHasDer(this.arena.getExprLeft(exprId)) || exprHasDer(this.arena.getExprRight(exprId));
      }
      if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
        return exprHasDer(this.arena.getExprLeft(exprId));
      }
      if (kind === ExprKind.IfElse) {
        return (
          exprHasDer(this.arena.getExprData1(exprId)) ||
          exprHasDer(this.arena.getExprLeft(exprId)) ||
          exprHasDer(this.arena.getExprRight(exprId))
        );
      }
      return false;
    };

    // Determine generalized inertia for a differential pair (pIdx, vIdx):
    // > 0 if backed by positive mass/inertia or non-derivative kinematic source equation;
    // === 0 if degenerate zero-mass/inertia; < 0 if massless kinematic sensor/element.
    const getGeneralizedInertiaStatus = (pIdx: number, vIdx: number): "positive" | "zero" | "kinematic" => {
      const aIdx = derVarOf.get(vIdx) ?? -1;
      const vName = this.arena.getVarName(vIdx);
      const dotPos = vName.lastIndexOf(".");
      const prefix = dotPos >= 0 ? vName.substring(0, dotPos) : "";

      if (prefix) {
        // Check any mass/inertia parameter in the same component scope multiplying acceleration
        for (const suffix of ["m", "J"]) {
          const paramIdx = this.arena.getVarIdxByName(`${prefix}.${suffix}`);
          if (paramIdx >= 0 && this.parameterVars.has(paramIdx)) {
            const pVal = this.parameters.get(`${prefix}.${suffix}`) ?? this.arena.getVarStartValue(paramIdx);
            return pVal > 0 ? "positive" : "zero";
          }
        }
      }

      // Structural check on dynamic equation involving acceleration `aIdx` and flow variables
      if (aIdx >= 0) {
        for (let k = 0; k < this.arena.eqCount; k++) {
          if (this.arena.getEqKind(k) !== EqKind.Simple || k === derEqOf.get(vIdx)) continue;
          const kLhs = this.arena.getEqLhs(k);
          const kRhs = this.arena.getEqRhs(k);
          if (exprRefsVar(kLhs, aIdx) || exprRefsVar(kRhs, aIdx)) {
            for (const fVar of flowCoupledVars) {
              if (exprRefsVar(kLhs, fVar) || exprRefsVar(kRhs, fVar)) {
                return "positive";
              }
            }
          }
        }
      }

      // Structural check for kinematic position source equation (pIdx defined by non-derivative, non-flow equation)
      for (let k = 0; k < this.arena.eqCount; k++) {
        if (this.arena.getEqKind(k) !== EqKind.Simple || k === derEqOf.get(pIdx)) continue;
        const kLhs = this.arena.getEqLhs(k);
        const kRhs = this.arena.getEqRhs(k);
        if (
          this.arena.getExprKind(kLhs) === ExprKind.Name &&
          this.arena.lookupVariable(this.arena.getExprData1(kLhs)) === pIdx &&
          !exprHasDer(kRhs)
        ) {
          return "positive";
        }
      }

      return "kinematic";
    };

    const velOfPos = new Map<number, number>();
    const inertiaStatusOfPos = new Map<number, "positive" | "zero" | "kinematic">();

    for (const [pIdx, vIdx] of derVarOf) {
      if (isDerTarget.has(pIdx)) continue; // Skip second-order (v, a) pairs
      const status = getGeneralizedInertiaStatus(pIdx, vIdx);
      inertiaStatusOfPos.set(pIdx, status);
      if (status === "positive") {
        velOfPos.set(pIdx, vIdx);
        // Also seed same-component connector positions connected by constant geometry offset
        const pName = this.arena.getVarName(pIdx);
        const dotIdx = pName.lastIndexOf(".");
        if (dotIdx >= 0) {
          const prefix = pName.substring(0, dotIdx);
          const leaf = pName.substring(dotIdx + 1);
          for (const port of ["flange_a", "flange_b", "flange"]) {
            const portVarIdx = this.arena.getVarIdxByName(`${prefix}.${port}.${leaf}`);
            if (portVarIdx >= 0) velOfPos.set(portVarIdx, vIdx);
          }
        }
      }
    }

    const coupledMasses = new Map<number, number>();

    // 2. Propagate driving velocities across position equality and constant-offset equations
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < this.arena.eqCount; i++) {
        if (this.arena.getEqKind(i) !== EqKind.Simple && this.arena.getEqKind(i) !== EqKind.Connect) continue;
        const lhs = this.arena.getEqLhs(i);
        const rhs = this.arena.getEqRhs(i);
        if (this.arena.getExprKind(lhs) === ExprKind.Name && this.arena.getExprKind(rhs) === ExprKind.Name) {
          const id1 = this.arena.lookupVariable(this.arena.getExprData1(lhs));
          const id2 = this.arena.lookupVariable(this.arena.getExprData1(rhs));
          if (id1 >= 0 && id2 >= 0) {
            const v1 = velOfPos.get(id1);
            const v2 = velOfPos.get(id2);
            if (v1 !== undefined && v2 === undefined) {
              velOfPos.set(id2, v1);
              changed = true;
            } else if (v2 !== undefined && v1 === undefined) {
              velOfPos.set(id1, v2);
              changed = true;
            } else if (v1 !== undefined && v2 !== undefined && v1 !== v2) {
              const primary = Math.min(v1, v2);
              const secondary = Math.max(v1, v2);
              coupledMasses.set(secondary, primary);
            }
          }
        }
      }
    }

    // 3. Rewrite dependent kinematic velocity (and coupled acceleration) equations
    for (const [sIdx, vIdx] of derVarOf) {
      if (isDerTarget.has(sIdx)) continue;
      const eqIdx = derEqOf.get(sIdx)!;

      if (coupledMasses.has(vIdx)) {
        const primaryV = coupledMasses.get(vIdx)!;
        const vExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(primaryV));
        this.arena.setEqRhs(eqIdx, vExpr);
        const aIdx = derVarOf.get(vIdx) ?? -1;
        const primaryAIdx = derVarOf.get(primaryV) ?? -1;
        if (aIdx >= 0 && primaryAIdx >= 0) {
          const aEqIdx = derEqOf.get(vIdx);
          if (aEqIdx !== undefined) {
            const aExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(primaryAIdx));
            this.arena.setEqRhs(aEqIdx, aExpr);
          }
        }
        continue;
      }

      const status = inertiaStatusOfPos.get(sIdx);
      if (status === "positive" || status === "zero") continue;

      let resolvedV = velOfPos.get(sIdx);
      if (resolvedV === undefined) {
        const sName = this.arena.getVarName(sIdx);
        const dotIdx = sName.lastIndexOf(".");
        if (dotIdx >= 0) {
          const prefix = sName.substring(0, dotIdx);
          const leaf = sName.substring(dotIdx + 1).replace(/_rel$/, "");
          for (const port of ["flange", "flange_b", "flange_a"]) {
            const portIdx = this.arena.getVarIdxByName(`${prefix}.${port}.${leaf}`);
            if (portIdx >= 0 && velOfPos.has(portIdx)) {
              resolvedV = velOfPos.get(portIdx);
              break;
            }
          }
        }
      }

      if (resolvedV !== undefined && resolvedV !== vIdx) {
        const vExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(resolvedV));
        this.arena.setEqRhs(eqIdx, vExpr);
      }
    }

    // 4. Structural kinematic ratio resolution for zero-inertia chains coupled to positive-inertia chains
    //    via linear transformer/rolling-wheel constraints (e.g. `(phi_R - phi_0) * radius = s_T - s_0`)
    for (const [pZeroIdx, vZeroIdx] of derVarOf) {
      if (inertiaStatusOfPos.get(pZeroIdx) !== "zero") continue;
      const aZeroIdx = derVarOf.get(vZeroIdx) ?? -1;
      const zeroPrefix = this.arena.getVarName(pZeroIdx).split(".").slice(0, -2).join(".");

      // Find a positive-inertia chain in the same subsystem coupled via a positive ratio parameter
      for (const [pPosIdx, vPosIdx] of derVarOf) {
        if (inertiaStatusOfPos.get(pPosIdx) !== "positive" || pPosIdx === pZeroIdx) continue;
        const posPrefix = this.arena.getVarName(pPosIdx).split(".").slice(0, -2).join(".");
        if (zeroPrefix !== posPrefix) continue;

        // Locate positive kinematic conversion ratio parameter (e.g. rolling radius / gear ratio) in the subsystem
        let ratioVal = 0;
        for (const pVarIdx of this.parameterVars) {
          const pVarName = this.arena.getVarName(pVarIdx);
          const matchesScope = zeroPrefix ? pVarName.startsWith(zeroPrefix + ".") : !pVarName.includes(".");
          if (matchesScope && (pVarName.endsWith(".radius") || pVarName.endsWith(".R"))) {
            const val = this.parameters.get(pVarName) ?? this.arena.getVarStartValue(pVarIdx);
            if (val > 0) {
              ratioVal = val;
              break;
            }
          }
        }

        if (ratioVal > 0) {
          const vZeroEq = derEqOf.get(pZeroIdx);
          if (vZeroEq !== undefined) {
            const vExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(vPosIdx));
            const rExpr = this.arena.addRealLiteral(ratioVal);
            this.arena.setEqRhs(vZeroEq, this.arena.addBinaryExpr(BinOp.Div, vExpr, rExpr));
          }
          const aPosIdx = derVarOf.get(vPosIdx) ?? -1;
          const aZeroEq = derEqOf.get(vZeroIdx);
          if (aZeroIdx >= 0 && aPosIdx >= 0 && aZeroEq !== undefined) {
            const aExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(aPosIdx));
            const rExpr = this.arena.addRealLiteral(ratioVal);
            this.arena.setEqRhs(aZeroEq, this.arena.addBinaryExpr(BinOp.Div, aExpr, rExpr));
          }
          break;
        }
      }
    }
  }

  /**
   * Performs symbolic index-reduction on affine constraints among differentiated states
   * (e.g., Rigidly connected rotational inertias `phi1 = phi2 + c` or translational masses `s1 = s2`).
   *
   * 1. Scans all `EqKind.Simple` equations to identify candidate state variables (`allDerVars`) and
   *    first-order derivative aliases (`w = der(x)`).
   * 2. Evaluates equations symbolically into affine combinations (`constant + sum_i coeff_i * x_i`).
   * 3. Uses `stateSelect` priority attributes (`never` > `avoid` > `default` > `prefer` > `always`)
   *    and `fixed` flags to select dependent states for elimination.
   * 4. Rewrites `der(sDep)` (and second-order `der(wDep)`) into linear combinations of independent state derivatives.
   */
  private reduceAffineStateConstraints() {
    const allDerVars = new Set<number>();
    const derAliasOf = new Map<number, number>();
    const isDerAliasTarget = new Set<number>();

    // Helper: ignore degenerate zero-inertia or zero-mass mechanical states
    const isZeroMassOrInertia = (varIdx: number): boolean => {
      const name = this.arena.getVarName(varIdx);
      const dotIdx = name.lastIndexOf(".");
      if (dotIdx < 0) return false;
      const prefix = name.substring(0, dotIdx);
      for (const paramSuffix of ["J", "m"]) {
        const pIdx = this.arena.getVarIdxByName(`${prefix}.${paramSuffix}`);
        if (pIdx >= 0 && this.parameterVars.has(pIdx)) {
          const pVal = this.parameters.get(`${prefix}.${paramSuffix}`) ?? this.arena.getVarStartValue(pIdx);
          if (pVal === 0) return true;
        }
      }
      return false;
    };

    // 1. Recursively scan arena expressions to collect all variables appearing inside `der(x)`
    const scanDerExpr = (exprId: number) => {
      if (exprId < 0) return;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Der) {
        const argId = this.arena.getExprData1(exprId);
        if (this.arena.getExprKind(argId) === ExprKind.Name) {
          const vIdx = this.arena.lookupVariable(this.arena.getExprData1(argId));
          if (vIdx >= 0 && !isZeroMassOrInertia(vIdx)) {
            allDerVars.add(vIdx);
          }
        }
        return;
      }
      switch (kind) {
        case ExprKind.Binary:
          scanDerExpr(this.arena.getExprLeft(exprId));
          scanDerExpr(this.arena.getExprRight(exprId));
          break;
        case ExprKind.Unary:
        case ExprKind.Negate:
          scanDerExpr(this.arena.getExprLeft(exprId));
          break;
        case ExprKind.IfElse:
          scanDerExpr(this.arena.getExprData1(exprId));
          scanDerExpr(this.arena.getExprLeft(exprId));
          scanDerExpr(this.arena.getExprRight(exprId));
          break;
        case ExprKind.Call: {
          const argCount = this.arena.getExprRight(exprId);
          if (argCount > 0) {
            const firstArg = this.arena.getExprLeft(exprId);
            for (let a = 0; a < argCount; a++) {
              scanDerExpr(a === 0 ? firstArg : this.arena.getExprLeft(exprId + a));
            }
          }
          break;
        }
        case ExprKind.Tuple:
        case ExprKind.ArrayCtor: {
          const count = this.arena.getExprData1(exprId);
          if (count > 0) {
            const firstElem = this.arena.getExprLeft(exprId);
            for (let e = 0; e < count; e++) {
              scanDerExpr(e === 0 ? firstElem : this.arena.getExprLeft(exprId + e));
            }
          }
          break;
        }
      }
    };

    // Also record direct velocity/angular-velocity alias equations `w = der(x)`
    for (let i = 0; i < this.arena.eqCount; i++) {
      if (this.arena.getEqKind(i) !== EqKind.Simple) continue;
      const lhs = this.arena.getEqLhs(i);
      const rhs = this.arena.getEqRhs(i);
      scanDerExpr(lhs);
      scanDerExpr(rhs);

      if (this.arena.getExprKind(lhs) === ExprKind.Name && this.arena.getExprKind(rhs) === ExprKind.Der) {
        const derArg = this.arena.getExprData1(rhs);
        if (this.arena.getExprKind(derArg) === ExprKind.Name) {
          const wIdx = this.arena.lookupVariable(this.arena.getExprData1(lhs));
          const xIdx = this.arena.lookupVariable(this.arena.getExprData1(derArg));
          if (wIdx >= 0 && xIdx >= 0 && !isZeroMassOrInertia(xIdx)) {
            derAliasOf.set(xIdx, wIdx);
            isDerAliasTarget.add(wIdx);
          }
        }
      } else if (this.arena.getExprKind(rhs) === ExprKind.Name && this.arena.getExprKind(lhs) === ExprKind.Der) {
        const derArg = this.arena.getExprData1(lhs);
        if (this.arena.getExprKind(derArg) === ExprKind.Name) {
          const wIdx = this.arena.lookupVariable(this.arena.getExprData1(rhs));
          const xIdx = this.arena.lookupVariable(this.arena.getExprData1(derArg));
          if (wIdx >= 0 && xIdx >= 0 && !isZeroMassOrInertia(xIdx)) {
            derAliasOf.set(xIdx, wIdx);
            isDerAliasTarget.add(wIdx);
          }
        }
      }
    }

    if (allDerVars.size === 0) return;

    // Identify flow-coupled generalized force/torque variables structurally from connector flow flags
    const flowCoupledVars = new Set<number>();
    for (let v = 0; v < this.arena.varCount; v++) {
      if (!this.arena.isVarRemoved(v) && this.arena.isVarFlow(v)) {
        flowCoupledVars.add(v);
      }
    }
    let flowChanged = true;
    while (flowChanged) {
      flowChanged = false;
      for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
        if (this.arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
        const lhs = this.arena.getEqLhs(eqIdx);
        const rhs = this.arena.getEqRhs(eqIdx);
        const unwrapSignedVar = (exprId: number): number => {
          if (exprId < 0) return -1;
          const k = this.arena.getExprKind(exprId);
          if (k === ExprKind.Name) return this.arena.lookupVariable(this.arena.getExprData1(exprId));
          if (k === ExprKind.Negate || (k === ExprKind.Unary && this.arena.getExprData1(exprId) === UnaryOp.Negate)) {
            return unwrapSignedVar(this.arena.getExprLeft(exprId));
          }
          return -1;
        };
        const vL = unwrapSignedVar(lhs);
        const vR = unwrapSignedVar(rhs);
        if (vL >= 0 && vR >= 0 && !allDerVars.has(vL) && !allDerVars.has(vR)) {
          if (flowCoupledVars.has(vL) && !flowCoupledVars.has(vR)) {
            flowCoupledVars.add(vR);
            flowChanged = true;
          } else if (flowCoupledVars.has(vR) && !flowCoupledVars.has(vL)) {
            flowCoupledVars.add(vL);
            flowChanged = true;
          }
        }
      }
    }

    // 2. Seed primary candidate states (excluding derivative alias targets `w` where `w = der(phi)`)
    const activeCandidateStates = new Set<number>();
    for (const v of allDerVars) {
      if (!isDerAliasTarget.has(v)) {
        activeCandidateStates.add(v);
      }
    }
    if (activeCandidateStates.size === 0) return;

    interface AffineComb {
      constant: number;
      coeffs: Map<number, number>;
    }

    const stateComb = new Map<number, AffineComb>();
    for (const s of activeCandidateStates) {
      stateComb.set(s, { constant: 0, coeffs: new Map([[s, 1.0]]) });
    }

    const cloneComb = (c: AffineComb): AffineComb => ({
      constant: c.constant,
      coeffs: new Map(c.coeffs),
    });

    const addComb = (a: AffineComb, b: AffineComb, signB: number): AffineComb => {
      const coeffs = new Map(a.coeffs);
      for (const [k, v] of b.coeffs) {
        const next = (coeffs.get(k) ?? 0) + signB * v;
        if (Math.abs(next) < 1e-14) {
          coeffs.delete(k);
        } else {
          coeffs.set(k, next);
        }
      }
      return { constant: a.constant + signB * b.constant, coeffs };
    };

    const scaleComb = (a: AffineComb, factor: number): AffineComb => {
      if (Math.abs(factor) < 1e-15) {
        return { constant: 0, coeffs: new Map() };
      }
      const coeffs = new Map<number, number>();
      for (const [k, v] of a.coeffs) {
        const next = v * factor;
        if (Math.abs(next) >= 1e-14) {
          coeffs.set(k, next);
        }
      }
      return { constant: a.constant * factor, coeffs };
    };

    // 3. Symbolically evaluate an arena expression into an AffineComb if it is purely linear/affine
    const evalAffine = (exprId: number): AffineComb | null => {
      if (exprId < 0) return null;
      const kind = this.arena.getExprKind(exprId);
      switch (kind) {
        case ExprKind.RealLiteral:
          return { constant: this.arena.getExprRealValue(exprId), coeffs: new Map() };
        case ExprKind.IntLiteral:
        case ExprKind.BoolLiteral:
        case ExprKind.EnumLiteral:
          return { constant: this.arena.getExprData1(exprId), coeffs: new Map() };
        case ExprKind.Name: {
          const nameId = this.arena.getExprData1(exprId);
          const vIdx = this.arena.lookupVariable(nameId);
          if (vIdx < 0) {
            const name = this.arena.interner.resolve(nameId);
            if (name && this.parameters.has(name)) {
              return { constant: this.parameters.get(name)!, coeffs: new Map() };
            }
            return null;
          }
          if (this.parameterVars.has(vIdx)) {
            const name = this.arena.getVarName(vIdx);
            const val = this.parameters.get(name) ?? this.arena.getVarStartValue(vIdx);
            return { constant: val, coeffs: new Map() };
          }
          if (isDerAliasTarget.has(vIdx) || flowCoupledVars.has(vIdx)) {
            return null;
          }
          const vName = this.arena.getVarName(vIdx);
          if (vName.endsWith(".tau") || vName.endsWith(".f") || vName.endsWith(".tau_c") || vName.endsWith(".tau_d")) {
            return null;
          }
          const existing = stateComb.get(vIdx);
          if (existing) {
            return cloneComb(existing);
          }
          return { constant: 0, coeffs: new Map([[vIdx, 1.0]]) };
        }
        case ExprKind.Negate: {
          const sub = evalAffine(this.arena.getExprLeft(exprId));
          return sub ? scaleComb(sub, -1.0) : null;
        }
        case ExprKind.Unary: {
          const op = this.arena.getExprData1(exprId);
          const sub = evalAffine(this.arena.getExprLeft(exprId));
          if (!sub) return null;
          if (op === UnaryOp.Negate) return scaleComb(sub, -1.0);
          return null;
        }
        case ExprKind.Binary: {
          const op = this.arena.getExprData1(exprId);
          const left = evalAffine(this.arena.getExprLeft(exprId));
          if (!left) return null;
          const right = evalAffine(this.arena.getExprRight(exprId));
          if (!right) return null;
          if (op === BinOp.Add) return addComb(left, right, 1.0);
          if (op === BinOp.Sub) return addComb(left, right, -1.0);
          if (op === BinOp.Mul) {
            if (left.coeffs.size === 0) return scaleComb(right, left.constant);
            if (right.coeffs.size === 0) return scaleComb(left, right.constant);
            return null;
          }
          if (op === BinOp.Div) {
            if (right.coeffs.size === 0 && Math.abs(right.constant) > 1e-15) {
              return scaleComb(left, 1.0 / right.constant);
            }
            return null;
          }
          return null;
        }
        default:
          return null;
      }
    };

    const usedEqs = new Set<number>();
    const eliminatedStates: number[] = [];

    // 4. Fixed-point Gaussian elimination over affine algebraic equations
    let changed = true;
    while (changed) {
      changed = false;
      for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
        if (usedEqs.has(eqIdx)) continue;
        if (this.arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
        const lhs = this.arena.getEqLhs(eqIdx);
        const rhs = this.arena.getEqRhs(eqIdx);
        const lComb = evalAffine(lhs);
        if (!lComb) continue;
        const rComb = evalAffine(rhs);
        if (!rComb) continue;
        const diff = addComb(lComb, rComb, -1.0);

        const unknownNonStates: number[] = [];
        for (const k of diff.coeffs.keys()) {
          if (!activeCandidateStates.has(k)) {
            unknownNonStates.push(k);
          }
        }

        if (unknownNonStates.length === 1) {
          // Case A: Equation defines a single algebraic kinematic variable `u` in terms of states
          const u = unknownNonStates[0]!;
          const cu = diff.coeffs.get(u)!;
          if (Math.abs(cu) > 1e-12) {
            const coeffsU = new Map<number, number>();
            for (const [k, v] of diff.coeffs) {
              if (k === u) continue;
              const c = -v / cu;
              if (Math.abs(c) >= 1e-14) coeffsU.set(k, c);
            }
            stateComb.set(u, { constant: -diff.constant / cu, coeffs: coeffsU });
            usedEqs.add(eqIdx);
            changed = true;
          }
        } else if (unknownNonStates.length === 0) {
          // Case B: Pure affine constraint among candidate states — score and eliminate one dependent state `bestS`
          usedEqs.add(eqIdx);
          if (diff.coeffs.size >= 1) {
            const lhsVarIdx =
              this.arena.getExprKind(lhs) === ExprKind.Name
                ? this.arena.lookupVariable(this.arena.getExprData1(lhs))
                : -1;
            let bestS = -1;
            let bestScore = -Infinity;
            for (const [s, cs] of diff.coeffs) {
              if (Math.abs(cs) <= 1e-12) continue;
              const sName = this.arena.getVarName(s);
              let score = 0;
              const ssAttr = this.arena.getVarAttr(s, "stateSelect");
              if (ssAttr !== undefined && ssAttr >= 0) {
                const ssKind = this.arena.getExprKind(ssAttr);
                if (ssKind === ExprKind.IntLiteral) {
                  const ssVal = this.arena.getExprData1(ssAttr);
                  // 1=never, 2=avoid, 3=default, 4=prefer, 5=always
                  if (ssVal === 1) score += 2000;
                  else if (ssVal === 2) score += 1000;
                  else if (ssVal === 4) score -= 1000;
                  else if (ssVal === 5) score -= 2000;
                } else if (ssKind === ExprKind.Name || ssKind === ExprKind.EnumLiteral) {
                  const ssText = this.arena.interner.resolve(this.arena.getExprData1(ssAttr)) ?? "";
                  if (ssText.endsWith(".never") || ssText === "never") score += 2000;
                  else if (ssText.endsWith(".avoid") || ssText === "avoid") score += 1000;
                  else if (ssText.endsWith(".prefer") || ssText === "prefer") score -= 1000;
                  else if (ssText.endsWith(".always") || ssText === "always") score -= 2000;
                }
              }
              const isRelativeCoordinate = (s === lhsVarIdx && diff.coeffs.size >= 3) || sName.endsWith("_rel");
              if (isRelativeCoordinate) {
                score += 1000;
              }
              score += !this.arena.isVarFixed(s) ? 500 : -500;
              if (s === lhsVarIdx) score += 50;
              score += s * 1e-4;
              if (score > bestScore) {
                bestScore = score;
                bestS = s;
              }
            }

            if (bestS >= 0) {
              const cDep = diff.coeffs.get(bestS)!;
              const coeffsDep = new Map<number, number>();
              for (const [s, cs] of diff.coeffs) {
                if (s === bestS) continue;
                const c = -cs / cDep;
                if (Math.abs(c) >= 1e-14) coeffsDep.set(s, c);
              }
              const combDep: AffineComb = {
                constant: -diff.constant / cDep,
                coeffs: coeffsDep,
              };
              activeCandidateStates.delete(bestS);
              eliminatedStates.push(bestS);

              // Substitute bestS -> combDep in all existing stateComb entries
              for (const [vKey, vComb] of stateComb) {
                void vKey;
                const coeffInV = vComb.coeffs.get(bestS);
                if (coeffInV !== undefined) {
                  vComb.coeffs.delete(bestS);
                  vComb.constant += coeffInV * combDep.constant;
                  for (const [sRem, cRem] of combDep.coeffs) {
                    const next = (vComb.coeffs.get(sRem) ?? 0) + coeffInV * cRem;
                    if (Math.abs(next) < 1e-14) {
                      vComb.coeffs.delete(sRem);
                    } else {
                      vComb.coeffs.set(sRem, next);
                    }
                  }
                }
              }
              stateComb.set(bestS, combDep);
              changed = true;
            }
          }
        }
      }
    }

    if (eliminatedStates.length === 0) return;

    // 5. Differentiate the affine state relation `sDep = c_0 + sum c_i * s_i` to synthesize
    //    `der(sDep) = sum c_i * der(s_i)` (order 1) and `der(wDep) = sum c_i * der(w_i)` (order 2)
    const buildLinearDerComboExpr = (coeffs: Map<number, number>, order: 1 | 2): number => {
      let sumExpr = -1;
      for (const [s, c] of coeffs) {
        if (Math.abs(c) < 1e-14) continue;
        let baseDerExpr: number;
        if (order === 1) {
          const wIdx = derAliasOf.get(s);
          if (wIdx !== undefined && allDerVars.has(wIdx)) {
            baseDerExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(wIdx));
          } else {
            const sNameExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(s));
            baseDerExpr = this.arena.addDerExpr(sNameExpr);
          }
        } else {
          const wIdx = derAliasOf.get(s);
          const targetIdx = wIdx !== undefined ? wIdx : s;
          const targetNameExpr = this.arena.addExpression(ExprKind.Name, this.arena.getVarNameId(targetIdx));
          baseDerExpr = this.arena.addDerExpr(targetNameExpr);
        }

        let termExpr: number;
        const absC = Math.abs(c);
        const isNeg = c < 0;
        if (Math.abs(absC - 1.0) < 1e-12) {
          termExpr = baseDerExpr;
        } else {
          const cLit = this.arena.addRealLiteral(absC);
          termExpr = this.arena.addBinaryExpr(BinOp.Mul, cLit, baseDerExpr);
        }

        if (sumExpr === -1) {
          sumExpr = isNeg ? this.arena.addNegateExpr(termExpr) : termExpr;
        } else {
          sumExpr = this.arena.addBinaryExpr(isNeg ? BinOp.Sub : BinOp.Add, sumExpr, termExpr);
        }
      }
      if (sumExpr === -1) {
        sumExpr = this.arena.addRealLiteral(0.0);
      }
      return sumExpr;
    };

    const replaceDerInExpr = (exprId: number, targetVarIdx: number, replacementExprId: number): number => {
      if (exprId < 0) return exprId;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Der) {
        const argId = this.arena.getExprData1(exprId);
        if (this.arena.getExprKind(argId) === ExprKind.Name) {
          const vIdx = this.arena.lookupVariable(this.arena.getExprData1(argId));
          if (vIdx === targetVarIdx) {
            return replacementExprId;
          }
        }
        return exprId;
      }
      switch (kind) {
        case ExprKind.Binary: {
          const l = this.arena.getExprLeft(exprId);
          const r = this.arena.getExprRight(exprId);
          const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
          const nr = replaceDerInExpr(r, targetVarIdx, replacementExprId);
          if (nl !== l || nr !== r) {
            return this.arena.addBinaryExpr(this.arena.getExprData1(exprId), nl, nr);
          }
          return exprId;
        }
        case ExprKind.Negate: {
          const l = this.arena.getExprLeft(exprId);
          const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
          if (nl !== l) {
            return this.arena.addNegateExpr(nl);
          }
          return exprId;
        }
        case ExprKind.Unary: {
          const l = this.arena.getExprLeft(exprId);
          const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
          if (nl !== l) {
            return this.arena.addUnaryExpr(this.arena.getExprData1(exprId), nl);
          }
          return exprId;
        }
        case ExprKind.IfElse: {
          const cond = this.arena.getExprData1(exprId);
          const l = this.arena.getExprLeft(exprId);
          const r = this.arena.getExprRight(exprId);
          const nCond = replaceDerInExpr(cond, targetVarIdx, replacementExprId);
          const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
          const nr = replaceDerInExpr(r, targetVarIdx, replacementExprId);
          if (nCond !== cond || nl !== l || nr !== r) {
            return this.arena.addExpression(ExprKind.IfElse, nCond, nl, nr);
          }
          return exprId;
        }
        default:
          return exprId;
      }
    };

    // 6. Rewrite all occurrences of `der(sDep)` and `der(wDep)` across the DAE equation arena
    for (const sDep of eliminatedStates) {
      const finalComb = stateComb.get(sDep);
      if (!finalComb) continue;
      const derExpr1 = buildLinearDerComboExpr(finalComb.coeffs, 1);
      for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
        if (this.arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
        const lhs = this.arena.getEqLhs(eqIdx);
        const rhs = this.arena.getEqRhs(eqIdx);
        const nLhs = replaceDerInExpr(lhs, sDep, derExpr1);
        const nRhs = replaceDerInExpr(rhs, sDep, derExpr1);
        if (nLhs !== lhs) this.arena.setEqLhs(eqIdx, nLhs);
        if (nRhs !== rhs) this.arena.setEqRhs(eqIdx, nRhs);
      }

      const wDep = derAliasOf.get(sDep);
      if (wDep !== undefined && allDerVars.has(wDep)) {
        const derExpr2 = buildLinearDerComboExpr(finalComb.coeffs, 2);
        for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
          if (this.arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
          const lhs = this.arena.getEqLhs(eqIdx);
          const rhs = this.arena.getEqRhs(eqIdx);
          const nLhs = replaceDerInExpr(lhs, wDep, derExpr2);
          const nRhs = replaceDerInExpr(rhs, wDep, derExpr2);
          if (nLhs !== lhs) this.arena.setEqLhs(eqIdx, nLhs);
          if (nRhs !== rhs) this.arena.setEqRhs(eqIdx, nRhs);
        }
      }
    }
  }

  /**
   * Scans all DAE arena equations for `ExprKind.Der` nodes, registers their inner variables
   * in `stateVars` (filtering out zero-mass/zero-inertia mechanical bodies), and ensures a
   * corresponding `der(x)` variable exists in `derivativeVars`.
   */
  private identifyDerivatives() {
    const scanExpr = (exprId: number) => {
      if (exprId < 0) return;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Der) {
        const argId = this.arena.getExprData1(exprId);
        if (this.arena.getExprKind(argId) === ExprKind.Name) {
          const nameId = this.arena.getExprData1(argId);
          // O(1): resolve StringId → name → VarIdx via name index
          const name = this.arena.interner.resolve(nameId);
          if (name) {
            const varIdx = this.arena.getVarIdxByName(name);
            if (varIdx !== -1) {
              // Filter out massless/zero-inertia bodies:
              if (name.endsWith(".phi") || name.endsWith(".w")) {
                const prefix = name.substring(0, name.lastIndexOf("."));
                const jIdx = this.arena.getVarIdxByName(`${prefix}.J`);
                if (jIdx >= 0) {
                  const jVal = this.parameters.get(`${prefix}.J`) ?? this.arena.getVarStartValue(jIdx);
                  if (jVal === 0) return;
                }
              }
              if (name.endsWith(".s") || name.endsWith(".v")) {
                const prefix = name.substring(0, name.lastIndexOf("."));
                const mIdx = this.arena.getVarIdxByName(`${prefix}.m`);
                if (mIdx >= 0) {
                  const mVal = this.parameters.get(`${prefix}.m`) ?? this.arena.getVarStartValue(mIdx);
                  if (mVal === 0) return;
                }
              }

              this.stateVars.add(varIdx);
              // O(1): look up derivative variable, or create it if it doesn't exist
              const derName = `der(${name})`;
              let derVarIdx = this.arena.getVarIdxByName(derName);
              if (derVarIdx === -1) {
                const baseVarType = this.arena.getVarType(varIdx);
                const baseVarVariability = this.arena.getVarVariability(varIdx);
                // The derivative variable inherits continuous variability and base causality/type.
                derVarIdx = this.arena.addVariable(
                  derName,
                  baseVarType,
                  baseVarVariability,
                  this.arena.getVarCausality(varIdx),
                  0.0,
                );
              }
              this.derivativeVars.add(derVarIdx);
            }
          }
        }
        return;
      }
      switch (kind) {
        case ExprKind.Binary:
          scanExpr(this.arena.getExprLeft(exprId));
          scanExpr(this.arena.getExprRight(exprId));
          break;
        case ExprKind.Unary:
        case ExprKind.Negate:
          scanExpr(this.arena.getExprLeft(exprId));
          break;
        case ExprKind.IfElse:
          scanExpr(this.arena.getExprData1(exprId));
          scanExpr(this.arena.getExprLeft(exprId));
          scanExpr(this.arena.getExprRight(exprId));
          break;
        case ExprKind.Call: {
          const argCount = this.arena.getExprRight(exprId);
          if (argCount > 0) {
            const firstArg = this.arena.getExprLeft(exprId);
            for (let a = 0; a < argCount; a++) {
              scanExpr(a === 0 ? firstArg : this.arena.getExprLeft(exprId + a));
            }
          }
          break;
        }
        case ExprKind.Tuple:
        case ExprKind.ArrayCtor: {
          const count = this.arena.getExprData1(exprId);
          if (count > 0) {
            const firstElem = this.arena.getExprLeft(exprId);
            for (let e = 0; e < count; e++) {
              scanExpr(e === 0 ? firstElem : this.arena.getExprLeft(exprId + e));
            }
          }
          break;
        }
      }
    };

    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      scanExpr(this.arena.getEqLhs(eqIdx));
      scanExpr(this.arena.getEqRhs(eqIdx));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derivative Equation Extraction
  //
  // Equations of the form `der(x) = rhs` are NOT handled by the BLT
  // (the BLT intentionally excludes der() dependencies). Instead, they
  // are explicitly evaluated each RHS call to populate der(x) in the
  // environment so the ODE integrator can read dy/dt.
  // ─────────────────────────────────────────────────────────────────────────

  // extractDerivativeEquations removed

  /**
   * Placeholder hook for evaluating explicit derivative equations (now scheduled
   * directly inside the topological BLT execution blocks).
   */
  public evaluateDerivativeEquations(_valuesByStringId: Float64Array): void {
    // Handled by BLT
  }

  // ─────────────────────────────────────────────────────────────────────────
  // When-Clause Extraction
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extracts all `EqKind.When` equations and their `elsewhen` branches from the DAE arena
   * side-table into `this.whenClauses`.
   */
  private extractWhenClauses() {
    this.whenClauses = [];
    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      if (this.arena.getEqKind(eqIdx) !== EqKind.When) continue;

      // Read compound metadata from the side-table
      const meta = this.arena.getWhenEquationMeta(eqIdx);
      if (!meta) continue;

      // Main when-clause
      const actions = this.extractWhenActionsFromMeta(meta.bodyEquations);
      if (actions.length > 0) {
        this.whenClauses.push({ conditionExprId: meta.conditionExprId, actions, wasActive: false });
      }

      // Else-when clauses
      for (const ew of meta.elseWhenClauses) {
        const ewActions = this.extractWhenActionsFromMeta(ew.bodyEquations);
        if (ewActions.length > 0) {
          this.whenClauses.push({ conditionExprId: ew.conditionExprId, actions: ewActions, wasActive: false });
        }
      }
    }
  }

  /**
   * Converts the body equations of a `when` or `elsewhen` clause into executable
   * discrete `reinit(var, expr)` and `assign` actions.
   */
  private extractWhenActionsFromMeta(
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
  ): ArenaWhenAction[] {
    const actions: ArenaWhenAction[] = [];
    for (const body of bodyEquations) {
      if (body.kind === EqKind.FunctionCall) {
        // Function call — check for reinit(var, expr)
        const callExprId = body.lhsExprId;
        if (this.arena.getExprKind(callExprId) === ExprKind.Call) {
          const funcNameId = this.arena.getExprData1(callExprId);
          const funcName = this.arena.interner.resolve(funcNameId);
          if (funcName === "reinit") {
            const argCount = this.arena.getExprRight(callExprId);
            if (argCount >= 2) {
              const firstArgId = this.arena.getExprLeft(callExprId);
              // Second arg stored in the Tuple at callExprId+1
              const secondArgId = this.arena.getExprLeft(callExprId + 1);
              if (this.arena.getExprKind(firstArgId) === ExprKind.Name) {
                const targetNameId = this.arena.getExprData1(firstArgId);
                actions.push({ type: "reinit", targetNameId, exprId: secondArgId });
              }
            }
          }
        }
      } else if (body.kind === EqKind.Simple) {
        // Regular assignment: lhs = rhs
        const lhs = body.lhsExprId;
        const rhs = body.rhsExprId;
        // Check if RHS is a reinit() call
        if (this.arena.getExprKind(rhs) === ExprKind.Call) {
          const funcNameId = this.arena.getExprData1(rhs);
          const funcName = this.arena.interner.resolve(funcNameId);
          if (funcName === "reinit" && this.arena.getExprKind(lhs) === ExprKind.Name) {
            const targetNameId = this.arena.getExprData1(lhs);
            // reinit stored as simple eq: lhs=target, rhs=reinit(target, newValue)
            // The actual new value is the second argument of the call
            const argCount = this.arena.getExprRight(rhs);
            if (argCount >= 2) {
              const valueExprId = this.arena.getExprLeft(rhs + 1); // second arg in Tuple at rhs+1
              actions.push({ type: "reinit", targetNameId, exprId: valueExprId });
            }
            continue;
          }
        }
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

  /**
   * Scans the DAE arena for `assert(condition, message)` function-call equations
   * and populates `this.assertions` for runtime verification.
   */
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
      const argCount = this.arena.getExprRight(callExprId);
      const firstArg = this.arena.getExprLeft(callExprId); // condition ExprId
      const secondArg = argCount >= 2 ? this.arena.getExprLeft(callExprId + 1) : -1; // message ExprId

      this.assertions.push({
        conditionExprId: firstArg,
        messageExprId: secondArg,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Indicator Extraction
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Collects all continuous zero-crossing event indicators from `when` conditions,
   * `if` equations, and `if-then-else` expressions (excluding sub-expressions wrapped in `noEvent()`).
   */
  private extractEventIndicators() {
    this.eventIndicators = [];
    for (let cIdx = 0; cIdx < this.whenClauses.length; cIdx++) {
      const clause = this.whenClauses[cIdx]!;
      const indicators = this.collectEventIndicators(clause.conditionExprId);
      for (const ind of indicators) {
        let existing = this.eventIndicators.find((e) => e.exprId === ind.exprId && e.direction === ind.direction);
        if (!existing) {
          existing = { exprId: ind.exprId, prevValue: 0, direction: ind.direction };
          (existing as any).clauseIndices = [];
          this.eventIndicators.push(existing);
        }
        const clauseIndices: number[] = (existing as any).clauseIndices ?? ((existing as any).clauseIndices = []);
        if (!clauseIndices.includes(cIdx)) {
          clauseIndices.push(cIdx);
        }
      }
    }

    const addIfIndicator = (condId: number): void => {
      if (condId < 0) return;
      for (const ind of this.collectEventIndicators(condId)) {
        let existing = this.eventIndicators.find((e) => e.exprId === ind.exprId && e.direction === ind.direction);
        if (!existing) {
          existing = { exprId: ind.exprId, prevValue: 0, direction: ind.direction };
          (existing as any).clauseIndices = [];
          this.eventIndicators.push(existing);
        }
      }
    };

    const scanIfElseExpr = (exprId: number): void => {
      if (exprId < 0) return;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Call) {
        const fnName = this.arena.interner.resolve(this.arena.getExprData1(exprId));
        if (fnName === "noEvent") return;
        const argc = this.arena.getExprRight(exprId);
        const firstArg = this.arena.getExprLeft(exprId);
        for (let a = 0; a < argc; a++) {
          scanIfElseExpr(a === 0 ? firstArg : this.arena.getExprLeft(exprId + a));
        }
        return;
      }
      if (kind === ExprKind.IfElse) {
        addIfIndicator(this.arena.getExprData1(exprId));
        scanIfElseExpr(this.arena.getExprLeft(exprId));
        scanIfElseExpr(this.arena.getExprRight(exprId));
        return;
      }
      if (kind === ExprKind.Binary) {
        scanIfElseExpr(this.arena.getExprLeft(exprId));
        scanIfElseExpr(this.arena.getExprRight(exprId));
      } else if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
        scanIfElseExpr(this.arena.getExprLeft(exprId));
      }
    };

    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      const eqKind = this.arena.getEqKind(eqIdx);
      if (eqKind === EqKind.Simple) {
        scanIfElseExpr(this.arena.getEqLhs(eqIdx));
        scanIfElseExpr(this.arena.getEqRhs(eqIdx));
      } else if (eqKind === EqKind.If) {
        const meta = (this.arena as any).getIfEquationMeta?.(eqIdx);
        if (meta?.branches) {
          for (const branch of meta.branches) {
            if (typeof branch.conditionExprId === "number" && branch.conditionExprId >= 0) {
              addIfIndicator(branch.conditionExprId);
            }
          }
        }
      }
    }
  }

  /**
   * Recursively collect continuous zero-crossing indicators from a condition expression.
   *
   * Handles relational expressions (Lt, Lte, Gt, Gte, Eq, Neq) by creating `lhs - rhs`
   * synthetic subtraction expressions with appropriate crossing directions.
   * Decomposes logical expressions (And, Or, Not) so that every continuous boundary
   * participating in a compound when-condition is registered as a zero-crossing indicator.
   */
  private collectEventIndicators(condExprId: number, inverted = false): { exprId: number; direction: -1 | 0 | 1 }[] {
    const kind = this.arena.getExprKind(condExprId);
    if (kind === ExprKind.Binary) {
      const op = this.arena.getExprData1(condExprId) as BinOp;
      if (op === BinOp.And || op === BinOp.Or) {
        const lhsId = this.arena.getExprLeft(condExprId);
        const rhsId = this.arena.getExprRight(condExprId);
        return [...this.collectEventIndicators(lhsId, inverted), ...this.collectEventIndicators(rhsId, inverted)];
      }
      if (
        op === BinOp.Lt ||
        op === BinOp.Lte ||
        op === BinOp.Gt ||
        op === BinOp.Gte ||
        op === BinOp.Eq ||
        op === BinOp.Neq
      ) {
        const lhsId = this.arena.getExprLeft(condExprId);
        const rhsId = this.arena.getExprRight(condExprId);
        const exprId = this.arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
        let direction: -1 | 0 | 1 = 0;
        if (op === BinOp.Lt || op === BinOp.Lte) {
          direction = inverted ? 1 : -1;
        } else if (op === BinOp.Gt || op === BinOp.Gte) {
          direction = inverted ? -1 : 1;
        }
        return [{ exprId, direction }];
      }
    } else if (kind === ExprKind.Unary) {
      const op = this.arena.getExprData1(condExprId) as UnaryOp;
      if (op === UnaryOp.Not) {
        const argId = this.arena.getExprLeft(condExprId);
        return this.collectEventIndicators(argId, !inverted);
      }
    }
    return [{ exprId: condExprId, direction: 0 }];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Machine Extraction
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initializes runtime state-machine hierarchies (`this.stateMachineRuntimes`)
   * from the Modelica 3.3 synchronous state machines registered in the DAE arena.
   */
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

  /** Executes one tick of all top-level synchronous state machine runtimes. */
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

  /**
   * Evaluates priority-ordered transitions, active-state equations, nested sub-automata,
   * and Modelica 3.3 state machine intrinsics (`activeState`, `ticksInState`, `timeInState`, `previousState`)
   * for a single state machine runtime.
   */
  private executeSingleStateMachine(rt: ArenaStateMachineRuntime, valuesByStringId: Float64Array): void {
    const dt = this.getStepSize(valuesByStringId);

    // ── Phase 1: Evaluate transitions from the current active state (priority-ordered) ──
    let transitioned = false;
    for (let ti = 0; ti < rt.def.transitions.length; ti++) {
      const tr = rt.def.transitions[ti];
      if (!tr) continue;
      if (tr.fromState !== rt.activeState) continue;

      const condVal = evaluateArenaRuntime(this.arena, tr.conditionExprId, valuesByStringId, this.preValuesByStringId);
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
        const val = evaluateArenaRuntime(this.arena, eq.exprId, valuesByStringId, this.preValuesByStringId);
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

  /**
   * Evaluates all extracted Modelica `assert(condition, message)` clauses at time `t`
   * and throws an error if any assertion condition evaluates to false (`0`).
   */
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

  /**
   * Solves a simultaneous algebraic loop (`type: "system"`) using damped Newton-Raphson
   * with pre-allocated scratch buffers, forward-mode AD / JIT-compiled Jacobians,
   * flat LU factorization (`luFactorFlat`), and warm-starting across time steps.
   */
  private solveNewtonBlock(
    block: Extract<import("@modelscript/runtime").ArenaExecutionBlock, { type: "system" }>,
    valuesByStringId: Float64Array,
  ): void {
    const m = block.vars.length;
    if (m === 0) return;

    this.ensureNewtonCapacity(m);

    const x = this.newtonScratchX;
    const R = this.newtonScratchR;
    const negR = this.newtonScratchNegR;
    const varNameIds = this.newtonScratchVarIds;
    const J = this.newtonScratchMat;
    const piv = this.newtonScratchPiv;
    const scale = this.newtonScratchScale;
    const dualStack = this.newtonScratchDualStack;

    const blockAny = block as any;
    let cachedVarIds: Int32Array | undefined = blockAny._varNameIds;
    let cachedResIds: Int32Array | undefined = blockAny._resExprIds;
    if (!cachedVarIds || !cachedResIds) {
      cachedVarIds = new Int32Array(m);
      cachedResIds = new Int32Array(m);
      for (let i = 0; i < m; i++) {
        cachedVarIds[i] = this.arena.getVarNameId(block.vars[i] as number);
        const eqIdx = block.eqIdxs[i] as number;
        const lhsId = this.arena.getEqLhs(eqIdx);
        const rhsId = this.arena.getEqRhs(eqIdx);
        cachedResIds[i] = this.arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
      }
      blockAny._varNameIds = cachedVarIds;
      blockAny._resExprIds = cachedResIds;
    }

    // Collect variable name StringIds
    for (let i = 0; i < m; i++) {
      const nid = cachedVarIds[i] as number;
      varNameIds[i] = nid;
      // Initialize from warm-start cache or current environment
      x[i] = this.algWarmStart.get(nid) ?? valuesByStringId[nid] ?? 0;
    }

    const compiledRes: ((env: Float64Array, x: Float64Array, R: Float64Array) => number) | undefined =
      blockAny._compiledResiduals;
    const compiledJac: ((env: Float64Array, x: Float64Array, R: Float64Array, J: Float64Array) => void) | undefined =
      blockAny._compiledJacobian;
    const isLinearSystem = blockAny._isLinearSystem === true;

    let converged = false;

    for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
      // Set current values into the environment
      for (let i = 0; i < m; i++) valuesByStringId[varNameIds[i] as number] = x[i] as number;

      // Evaluate residuals: R_i = lhs_i - rhs_i
      let maxR = 0;
      if (compiledRes) {
        maxR = compiledRes(valuesByStringId, x, R);
      } else {
        for (let i = 0; i < m; i++) {
          const resId = cachedResIds[i] as number;
          const exprVal = evaluateArenaRuntime(this.arena, resId, valuesByStringId);
          const rVal = isFinite(exprVal) ? exprVal : 0;
          R[i] = rVal;
          const absR = Math.abs(rVal);
          if (absR > maxR) maxR = absR;
        }
      }

      if (maxR < NEWTON_TOL) {
        converged = true;
        break;
      }

      // Compute Jacobian
      if (compiledJac) {
        compiledJac(valuesByStringId, x, R, J);
      } else {
        for (let j = 0; j < m; j++) {
          const nid = varNameIds[j] as number;

          for (let i = 0; i < m; i++) {
            const resId = cachedResIds[i] as number;
            const ok = evaluateArenaDualFlat(this.arena, resId, valuesByStringId, nid, dualStack, 0);
            if (ok) {
              // J[i][j] = d(res_i)/dx_j
              J[i * m + j] = dualStack[1] as number;
            } else {
              // AD failed — fall back to finite differences
              const xj = x[j] as number;
              const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
              valuesByStringId[nid] = xj + eps;
              const perturbedVal = evaluateArenaRuntime(this.arena, resId, valuesByStringId);
              const R_perturbed = isFinite(perturbedVal) ? perturbedVal : 0;
              J[i * m + j] = (R_perturbed - (R[i] as number)) / eps;
              valuesByStringId[nid] = xj;
            }
          }
        }
      }

      // Solve J · Δx = -R via zero-allocation flat LU factorization
      try {
        const fact = luFactorFlat(J, m, piv, scale);
        for (let i = 0; i < m; i++) negR[i] = -(R[i] as number);
        luSolveFlat(fact, negR);
        for (let i = 0; i < m; i++) {
          const nx = (x[i] as number) + (negR[i] as number);
          x[i] = nx;
          valuesByStringId[varNameIds[i] as number] = nx;
        }
        if (isLinearSystem) {
          converged = true;
          break;
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

  /**
   * JIT-compiles topological BLT execution blocks (`single` scalar assignments and `system` algebraic loops)
   * into specialized JavaScript closures (`new Function("env", "helpers", ...)`).
   *
   * - Lowers arena expression trees (`exprToJs`) and forward-mode symbolic partial derivatives (`dualToJs`)
   *   directly into inline JavaScript arithmetic over `env: Float64Array`.
   * - Precompiles residual and analytical Jacobian evaluators for simultaneous algebraic systems (`m <= 64`).
   * - Splits large models into chunks of at most 4,000 statements per closure to stay within V8 TurboFan optimization limits.
   */
  private compileBlocks(): ((env: Float64Array) => void) | null {
    try {
      const arena = this.arena;
      if (this.executionBlocks.length === 0) return () => {};

      const systemBlocks: Extract<import("@modelscript/runtime").ArenaExecutionBlock, { type: "system" }>[] = [];

      // 1. Runtime helper table passed into compiled closures for external tables, fallback expressions, and Newton blocks
      const helpers = {
        getTimeTableValue: (tableIdStrId: number, icol: number, timeIn: number) => {
          const cached = getOrCreateSimCachedTable(arena, tableIdStrId);
          return evalSimTimeTableValue(cached, icol, timeIn);
        },
        getTimeTableTmin: (tableIdStrId: number) => {
          const cached = getOrCreateSimCachedTable(arena, tableIdStrId);
          return cached && cached.table.length > 0
            ? (cached.table[0]![0]! + cached.shiftTime) * (cached.timeScale || 1.0)
            : 0;
        },
        getTimeTableTmax: (tableIdStrId: number) => {
          const cached = getOrCreateSimCachedTable(arena, tableIdStrId);
          return cached && cached.table.length > 0
            ? (cached.table[cached.table.length - 1]![0]! + cached.shiftTime) * (cached.timeScale || 1.0)
            : 0;
        },
        getNextTimeEvent: (_tableIdStrId: number, _timeIn: number) => {
          return 1e100;
        },
        evalExpr: (exprId: number, env: Float64Array) => {
          return evaluateArenaRuntime(arena, exprId, env, this.preValuesByStringId);
        },
        // Evaluates partial derivative d(resId)/d(nid) via flat dual-number AD, falling back to finite differences
        evalDual: (
          resId: number,
          nid: number,
          env: Float64Array,
          x: Float64Array,
          R: Float64Array,
          i: number,
          j: number,
        ) => {
          const dualStack = this.newtonScratchDualStack;
          const ok = evaluateArenaDualFlat(arena, resId, env, nid, dualStack, 0);
          if (ok) {
            return dualStack[1] as number;
          }
          const xj = x[j] as number;
          const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
          env[nid] = xj + eps;
          const perturbedVal = evaluateArenaRuntime(arena, resId, env);
          const R_perturbed = isFinite(perturbedVal) ? perturbedVal : 0;
          env[nid] = xj;
          return (R_perturbed - (R[i] as number)) / eps;
        },
        solveSystem: (sysIdx: number, env: Float64Array) => {
          const blk = systemBlocks[sysIdx];
          if (blk) this.solveNewtonBlock(blk, env);
        },
      };

      // 2. Recursively lower an arena expression (`exprId`) into a JavaScript expression string reading `env[nameId]`
      function exprToJs(exprId: number): string {
        if (exprId < 0) return "0";
        const kind = arena.getExprKind(exprId);
        switch (kind) {
          case ExprKind.RealLiteral:
            return arena.getExprRealValue(exprId).toString();
          case ExprKind.IntLiteral:
          case ExprKind.BoolLiteral:
          case ExprKind.EnumLiteral:
            return arena.getExprData1(exprId).toString();
          case ExprKind.Name: {
            const nameId = arena.getExprData1(exprId);
            return `env[${nameId}]`;
          }
          case ExprKind.Der: {
            const innerExprId = arena.getExprData1(exprId);
            if (arena.getExprKind(innerExprId) === ExprKind.Name) {
              const innerNameId = arena.getExprData1(innerExprId);
              const innerName = arena.interner.resolve(innerNameId);
              if (innerName) {
                const derId = arena.interner.intern(`der(${innerName})`);
                return `env[${derId}]`;
              }
            }
            return `helpers.evalExpr(${exprId}, env)`;
          }
          case ExprKind.Negate: {
            return `(-(${exprToJs(arena.getExprLeft(exprId))}))`;
          }
          case ExprKind.Unary: {
            const op = arena.getExprData1(exprId);
            const operand = exprToJs(arena.getExprLeft(exprId));
            if (op === UnaryOp.Negate) return `(-(${operand}))`;
            if (op === UnaryOp.Not) return `((${operand}) === 0 ? 1 : 0)`;
            return `helpers.evalExpr(${exprId}, env)`;
          }
          case ExprKind.Binary: {
            const op = arena.getExprData1(exprId);
            const left = exprToJs(arena.getExprLeft(exprId));
            const right = exprToJs(arena.getExprRight(exprId));
            switch (op) {
              case BinOp.Add:
              case BinOp.ElemAdd:
                return `((${left}) + (${right}))`;
              case BinOp.Sub:
              case BinOp.ElemSub:
                return `((${left}) - (${right}))`;
              case BinOp.Mul:
              case BinOp.ElemMul:
                return `((${left}) * (${right}))`;
              case BinOp.Div:
              case BinOp.ElemDiv:
                return `((${left}) / (${right}))`;
              case BinOp.Pow:
              case BinOp.ElemPow:
                return `Math.pow(${left}, ${right})`;
              case BinOp.And:
                return `(((${left}) !== 0 && (${right}) !== 0) ? 1 : 0)`;
              case BinOp.Or:
                return `(((${left}) !== 0 || (${right}) !== 0) ? 1 : 0)`;
              case BinOp.Lt:
                return `((${left}) < (${right}) ? 1 : 0)`;
              case BinOp.Lte:
                return `((${left}) <= (${right}) ? 1 : 0)`;
              case BinOp.Gt:
                return `((${left}) > (${right}) ? 1 : 0)`;
              case BinOp.Gte:
                return `((${left}) >= (${right}) ? 1 : 0)`;
              case BinOp.Eq:
                return `((${left}) === (${right}) ? 1 : 0)`;
              case BinOp.Neq:
                return `((${left}) !== (${right}) ? 1 : 0)`;
              default:
                return `helpers.evalExpr(${exprId}, env)`;
            }
          }
          case ExprKind.IfElse: {
            const cond = exprToJs(arena.getExprData1(exprId));
            const thenVal = exprToJs(arena.getExprLeft(exprId));
            const elseVal = exprToJs(arena.getExprRight(exprId));
            return `((${cond}) !== 0 ? (${thenVal}) : (${elseVal}))`;
          }
          case ExprKind.Call: {
            const fnName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
            const cleanFn = fnName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
            const argCount = arena.getExprRight(exprId);
            const firstArg = arena.getExprLeft(exprId);

            // Event-generating or stateful operators delegate to runtime evaluator
            if (
              cleanFn === "edge" ||
              cleanFn === "change" ||
              cleanFn === "sample" ||
              cleanFn === "initial" ||
              cleanFn === "terminal" ||
              cleanFn === "pre" ||
              cleanFn === "delay"
            ) {
              return `helpers.evalExpr(${exprId}, env)`;
            }

            if (cleanFn === "der" && argCount === 1 && arena.getExprKind(firstArg) === ExprKind.Name) {
              const innerName = arena.interner.resolve(arena.getExprData1(firstArg));
              if (innerName) {
                const derId = arena.interner.intern(`der(${innerName})`);
                return `env[${derId}]`;
              }
            }

            if (cleanFn === "smooth") {
              if (argCount > 1) {
                return `(${exprToJs(arena.getExprLeft(exprId + 1))})`;
              }
              return argCount > 0 ? `(${exprToJs(firstArg)})` : "0";
            }

            const arg = exprToJs(firstArg);

            if (cleanFn === "sin") return `Math.sin(${arg})`;
            if (cleanFn === "cos") return `Math.cos(${arg})`;
            if (cleanFn === "tan") return `Math.tan(${arg})`;
            if (cleanFn === "asin") return `Math.asin(${arg})`;
            if (cleanFn === "acos") return `Math.acos(${arg})`;
            if (cleanFn === "atan") return `Math.atan(${arg})`;
            if (cleanFn === "sinh") return `Math.sinh(${arg})`;
            if (cleanFn === "cosh") return `Math.cosh(${arg})`;
            if (cleanFn === "tanh") return `Math.tanh(${arg})`;
            if (cleanFn === "exp") return `Math.exp(${arg})`;
            if (cleanFn === "log") return `Math.log(${arg})`;
            if (cleanFn === "log10") return `Math.log10(${arg})`;
            if (cleanFn === "sqrt") return `Math.sqrt(${arg})`;
            if (cleanFn === "abs") return `Math.abs(${arg})`;
            if (cleanFn === "sign") return `Math.sign(${arg})`;
            if (cleanFn === "ceil") return `Math.ceil(${arg})`;
            if (cleanFn === "floor" || cleanFn === "integer") return `Math.floor(${arg})`;
            if (
              cleanFn === "noEvent" ||
              cleanFn === "homotopy" ||
              cleanFn === "/*Real*/" ||
              cleanFn === "/*Integer*/" ||
              cleanFn === "/*Boolean*/"
            )
              return `(${arg})`;

            if (argCount === 2) {
              const arg1 = exprToJs(arena.getExprLeft(exprId + 1));
              if (cleanFn === "atan2") return `Math.atan2(${arg}, ${arg1})`;
              if (cleanFn === "max") return `Math.max(${arg}, ${arg1})`;
              if (cleanFn === "min") return `Math.min(${arg}, ${arg1})`;
            }

            if (
              fnName.includes("getTimeTableValue") ||
              fnName.includes("CombiTimeTable_getValue") ||
              fnName.includes("getTable1DValue")
            ) {
              const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
              const icolJs = exprToJs(arena.getExprLeft(exprId + 1));
              const timeJs = exprToJs(arena.getExprLeft(exprId + 2));
              return `helpers.getTimeTableValue(${tableVarNameId}, ${icolJs}, ${timeJs})`;
            }

            if (fnName.includes("getTimeTableTmin")) {
              const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
              return `helpers.getTimeTableTmin(${tableVarNameId})`;
            }

            if (fnName.includes("getTimeTableTmax")) {
              const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
              return `helpers.getTimeTableTmax(${tableVarNameId})`;
            }

            if (fnName.includes("getNextTimeEvent")) {
              const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
              const timeJs = exprToJs(arena.getExprLeft(exprId + 1));
              return `helpers.getNextTimeEvent(${tableVarNameId}, ${timeJs})`;
            }

            return `helpers.evalExpr(${exprId}, env)`;
          }
          default:
            return `helpers.evalExpr(${exprId}, env)`;
        }
      }

      // 3. Symbolically differentiate `exprId` with respect to `seedNameId` into a JS expression string
      //    (returns "0" for constants/unrelated variables, or `null` if non-differentiable)
      function dualToJs(exprId: number, seedNameId: number): string | null {
        if (exprId < 0) return "0";
        const kind = arena.getExprKind(exprId);
        switch (kind) {
          case ExprKind.RealLiteral:
          case ExprKind.IntLiteral:
          case ExprKind.BoolLiteral:
          case ExprKind.EnumLiteral:
            return "0";
          case ExprKind.Name:
            return arena.getExprData1(exprId) === seedNameId ? "1" : "0";
          case ExprKind.Der: {
            const innerExprId = arena.getExprData1(exprId);
            if (arena.getExprKind(innerExprId) === ExprKind.Name) {
              const innerName = arena.interner.resolve(arena.getExprData1(innerExprId));
              if (innerName) {
                const derId = arena.interner.intern(`der(${innerName})`);
                return derId === seedNameId ? "1" : "0";
              }
            }
            return null;
          }
          case ExprKind.Negate: {
            const dL = dualToJs(arena.getExprLeft(exprId), seedNameId);
            if (dL === null) return null;
            if (dL === "0") return "0";
            return `(-(${dL}))`;
          }
          case ExprKind.Unary: {
            const op = arena.getExprData1(exprId);
            if (op === UnaryOp.Negate) {
              const dL = dualToJs(arena.getExprLeft(exprId), seedNameId);
              if (dL === null) return null;
              if (dL === "0") return "0";
              return `(-(${dL}))`;
            }
            if (op === UnaryOp.Not) return "0";
            return null;
          }
          case ExprKind.Binary: {
            const op = arena.getExprData1(exprId);
            if (
              op === BinOp.Lt ||
              op === BinOp.Lte ||
              op === BinOp.Gt ||
              op === BinOp.Gte ||
              op === BinOp.Eq ||
              op === BinOp.Neq ||
              op === BinOp.And ||
              op === BinOp.Or
            ) {
              return "0";
            }
            const lId = arena.getExprLeft(exprId);
            const rId = arena.getExprRight(exprId);
            const dL = dualToJs(lId, seedNameId);
            const dR = dualToJs(rId, seedNameId);
            if (dL === null || dR === null) return null;
            if (dL === "0" && dR === "0") return "0";
            switch (op) {
              case BinOp.Add:
              case BinOp.ElemAdd:
                if (dL === "0") return dR;
                if (dR === "0") return dL;
                return `((${dL}) + (${dR}))`;
              case BinOp.Sub:
              case BinOp.ElemSub:
                if (dL === "0") return `(-(${dR}))`;
                if (dR === "0") return dL;
                return `((${dL}) - (${dR}))`;
              case BinOp.Mul:
              case BinOp.ElemMul: {
                // Product rule: d(u * v) = du * v + u * dv
                const vL = exprToJs(lId);
                const vR = exprToJs(rId);
                if (dL === "0") return `((${vL}) * (${dR}))`;
                if (dR === "0") return `((${dL}) * (${vR}))`;
                return `((${dL}) * (${vR}) + (${vL}) * (${dR}))`;
              }
              case BinOp.Div:
              case BinOp.ElemDiv: {
                // Quotient rule: d(u / v) = (du * v - u * dv) / (v * v)
                const vL = exprToJs(lId);
                const vR = exprToJs(rId);
                if (dR === "0") return `((${dL}) / (${vR}))`;
                if (dL === "0") return `(-((${vL}) * (${dR})) / ((${vR}) * (${vR})))`;
                if (dR !== "0") return `(((${dL}) * (${vR}) - (${vL}) * (${dR})) / ((${vR}) * (${vR})))`;
                return null;
              }
              case BinOp.Pow:
              case BinOp.ElemPow: {
                // Power rule: d(u^v) = v * u^(v-1) * du + u^v * ln(u) * dv
                const vL = exprToJs(lId);
                const vR = exprToJs(rId);
                if (dR === "0") {
                  return `((${vR}) * Math.pow(${vL}, (${vR}) - 1) * (${dL}))`;
                }
                if (dL === "0") {
                  return `(Math.pow(${vL}, ${vR}) * Math.log(${vL}) * (${dR}))`;
                }
                return `(Math.pow(${vL}, (${vR}) - 1) * ((${vR}) * (${dL}) + (${vL}) * Math.log(${vL}) * (${dR})))`;
              }
              default:
                return null;
            }
          }
          case ExprKind.IfElse: {
            const condId = arena.getExprData1(exprId);
            const tId = arena.getExprLeft(exprId);
            const eId = arena.getExprRight(exprId);
            const dT = dualToJs(tId, seedNameId);
            const dE = dualToJs(eId, seedNameId);
            if (dT === null || dE === null) return null;
            if (dT === "0" && dE === "0") return "0";
            const condJs = exprToJs(condId);
            return `((${condJs}) !== 0 ? (${dT}) : (${dE}))`;
          }
          case ExprKind.Call: {
            const fnName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
            const cleanFn = fnName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
            const argCount = arena.getExprRight(exprId);
            const firstArg = arena.getExprLeft(exprId);
            if (cleanFn === "der" && argCount === 1 && arena.getExprKind(firstArg) === ExprKind.Name) {
              const innerName = arena.interner.resolve(arena.getExprData1(firstArg));
              if (innerName) {
                const derId = arena.interner.intern(`der(${innerName})`);
                return derId === seedNameId ? "1" : "0";
              }
            }
            if (
              cleanFn === "noEvent" ||
              cleanFn === "homotopy" ||
              cleanFn === "/*Real*/" ||
              cleanFn === "/*Integer*/" ||
              cleanFn === "/*Boolean*/"
            ) {
              return argCount > 0 ? dualToJs(firstArg, seedNameId) : "0";
            }
            if (cleanFn === "smooth") {
              if (argCount > 1) return dualToJs(arena.getExprLeft(exprId + 1), seedNameId);
              return argCount > 0 ? dualToJs(firstArg, seedNameId) : "0";
            }
            if (argCount === 1) {
              const dArg = dualToJs(firstArg, seedNameId);
              if (dArg === null) return null;
              if (dArg === "0") return "0";
              const vArg = exprToJs(firstArg);
              if (cleanFn === "sin") return `(Math.cos(${vArg}) * (${dArg}))`;
              if (cleanFn === "cos") return `(-Math.sin(${vArg}) * (${dArg}))`;
              if (cleanFn === "tan") return `((${dArg}) / (Math.cos(${vArg}) * Math.cos(${vArg})))`;
              if (cleanFn === "asin") return `((${dArg}) / Math.sqrt(1 - (${vArg}) * (${vArg})))`;
              if (cleanFn === "acos") return `(-(${dArg}) / Math.sqrt(1 - (${vArg}) * (${vArg})))`;
              if (cleanFn === "atan") return `((${dArg}) / (1 + (${vArg}) * (${vArg})))`;
              if (cleanFn === "sinh") return `(Math.cosh(${vArg}) * (${dArg}))`;
              if (cleanFn === "cosh") return `(Math.sinh(${vArg}) * (${dArg}))`;
              if (cleanFn === "tanh") return `((1 - Math.tanh(${vArg}) * Math.tanh(${vArg})) * (${dArg}))`;
              if (cleanFn === "exp") return `(Math.exp(${vArg}) * (${dArg}))`;
              if (cleanFn === "log") return `((${dArg}) / (${vArg}))`;
              if (cleanFn === "log10") return `((${dArg}) / ((${vArg}) * Math.LN10))`;
              if (cleanFn === "sqrt") return `((${dArg}) / (2 * Math.sqrt(${vArg})))`;
              if (cleanFn === "abs") return `(((${vArg}) >= 0 ? 1 : -1) * (${dArg}))`;
              if (cleanFn === "sign" || cleanFn === "ceil" || cleanFn === "floor" || cleanFn === "integer") {
                return "0";
              }
            }
            if (argCount === 2) {
              const secondArg = arena.getExprLeft(exprId + 1);
              const d0 = dualToJs(firstArg, seedNameId);
              const d1 = dualToJs(secondArg, seedNameId);
              if (d0 === null || d1 === null) return null;
              if (d0 === "0" && d1 === "0") return "0";
              const v0 = exprToJs(firstArg);
              const v1 = exprToJs(secondArg);
              if (cleanFn === "atan2") {
                return `(((${v1}) * (${d0}) - (${v0}) * (${d1})) / ((${v0}) * (${v0}) + (${v1}) * (${v1})))`;
              }
              if (cleanFn === "max") {
                return `((${v0}) >= (${v1}) ? (${d0}) : (${d1}))`;
              }
              if (cleanFn === "min") {
                return `((${v0}) <= (${v1}) ? (${d0}) : (${d1}))`;
              }
            }
            return null;
          }
          default:
            return null;
        }
      }

      // 4. Chunk into functions of at most 4,000 statements to stay within V8 JIT limits
      const CHUNK_SIZE = 4000;
      const chunks: ((env: Float64Array) => void)[] = [];
      let currentLines: string[] = [];

      for (const block of this.executionBlocks) {
        if (block.type === "single") {
          const varNameId = arena.getVarNameId(block.varIdx);
          const exprJs = exprToJs(block.exprId);
          currentLines.push(`env[${varNameId}] = ${exprJs};`);
          if (currentLines.length >= CHUNK_SIZE) {
            chunks.push(new Function("env", "helpers", currentLines.join("\n")) as any);
            currentLines = [];
          }
        } else if (block.type === "system" && block.vars.length > 0) {
          // 5. For simultaneous algebraic systems (`m` variables), construct residual expressions `lhs - rhs`
          //    and compile dedicated residual (`_compiledResiduals`) and Jacobian (`_compiledJacobian`) closures
          const m = block.vars.length;
          const blockAny = block as any;
          const varIds = new Int32Array(m);
          const resIds = new Int32Array(m);
          for (let i = 0; i < m; i++) {
            varIds[i] = arena.getVarNameId(block.vars[i] as number);
            const eqIdx = block.eqIdxs[i] as number;
            const lhsId = arena.getEqLhs(eqIdx);
            const rhsId = arena.getEqRhs(eqIdx);
            resIds[i] = arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
          }
          blockAny._varNameIds = varIds;
          blockAny._resExprIds = resIds;

          if (m <= 64) {
            // Detect whether the system is purely linear (constant Jacobian entries wrt block unknowns)
            let isLinearSystem = true;
            const varEnvTokens: string[] = [];
            for (let k = 0; k < m; k++) varEnvTokens.push(`env[${varIds[k]}]`);

            const resLines: string[] = ["let maxR = 0;"];
            for (let i = 0; i < m; i++) {
              const resJs = exprToJs(resIds[i] as number);
              if (resJs.includes("?") || resJs.includes("Math.") || resJs.includes("helpers.")) {
                isLinearSystem = false;
              }
              resLines.push(
                `{ const v = ${resJs}; const r = Number.isFinite(v) ? v : 0; R[${i}] = r; const ar = Math.abs(r); if (ar > maxR) maxR = ar; }`,
              );
            }
            resLines.push("return maxR;");
            const rawResFn = new Function("env", "x", "R", "helpers", resLines.join("\n")) as any;
            blockAny._compiledResiduals = (env: Float64Array, x: Float64Array, R: Float64Array) =>
              rawResFn(env, x, R, helpers);

            const jacLines: string[] = [];
            for (let j = 0; j < m; j++) {
              const nid = varIds[j] as number;
              for (let i = 0; i < m; i++) {
                const resId = resIds[i] as number;
                const dJs = dualToJs(resId, nid);
                const idx = i * m + j;
                if (dJs === "0") {
                  jacLines.push(`J[${idx}] = 0.0;`);
                } else if (dJs !== null) {
                  if (isLinearSystem) {
                    for (let k = 0; k < m; k++) {
                      if (dJs.includes(varEnvTokens[k]!)) {
                        isLinearSystem = false;
                        break;
                      }
                    }
                  }
                  jacLines.push(
                    `{ const d = ${dJs}; J[${idx}] = Number.isFinite(d) ? d : helpers.evalDual(${resId}, ${nid}, env, x, R, ${i}, ${j}); }`,
                  );
                } else {
                  isLinearSystem = false;
                  jacLines.push(`J[${idx}] = helpers.evalDual(${resId}, ${nid}, env, x, R, ${i}, ${j});`);
                }
              }
            }
            const rawJacFn = new Function("env", "x", "R", "J", "helpers", jacLines.join("\n")) as any;
            blockAny._compiledJacobian = (env: Float64Array, x: Float64Array, R: Float64Array, J: Float64Array) =>
              rawJacFn(env, x, R, J, helpers);
            blockAny._isLinearSystem = isLinearSystem;
          }

          const sysIdx = systemBlocks.length;
          systemBlocks.push(block);
          currentLines.push(`helpers.solveSystem(${sysIdx}, env);`);
          if (currentLines.length >= CHUNK_SIZE) {
            chunks.push(new Function("env", "helpers", currentLines.join("\n")) as any);
            currentLines = [];
          }
        }
      }

      if (currentLines.length > 0) {
        chunks.push(new Function("env", "helpers", currentLines.join("\n")) as any);
      }

      if (chunks.length === 1) {
        const c0 = chunks[0]!;
        return (env: Float64Array) => (c0 as any)(env, helpers);
      }
      return (env: Float64Array) => {
        for (const chunk of chunks) (chunk as any)(env, helpers);
      };
    } catch {
      return null;
    }
  }

  /**
   * Evaluates all topological BLT execution blocks (`single` assignments and `system` algebraic loops)
   * in causal order, updating `valuesByStringId` in-place via the JIT-compiled closure when available.
   */
  public evaluateBlocks(valuesByStringId: Float64Array): void {
    if (this.compiledBlocks) {
      this.compiledBlocks(valuesByStringId);
      return;
    }
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

  /**
   * Processes discrete `when` and `elsewhen` clauses using rising-edge detection
   * (`isActive && !clause.wasActive`) with bounded fixed-point event iteration.
   */
  private processWhenClauses(valuesByStringId: Float64Array): void {
    if (this.whenClauses.length === 0) return;
    for (let iter = 0; iter < 10; iter++) {
      let anyFired = false;
      for (const clause of this.whenClauses) {
        const condVal = evaluateArenaRuntime(
          this.arena,
          clause.conditionExprId,
          valuesByStringId,
          this.preValuesByStringId,
        );
        const isActive = condVal !== 0;

        // Rising edge detection
        if (isActive && !clause.wasActive) {
          anyFired = true;
          for (const action of clause.actions) {
            const val = evaluateArenaRuntime(this.arena, action.exprId, valuesByStringId, this.preValuesByStringId);
            valuesByStringId[action.targetNameId] = val;
          }
          const postCondVal = evaluateArenaRuntime(
            this.arena,
            clause.conditionExprId,
            valuesByStringId,
            this.preValuesByStringId,
          );
          clause.wasActive = postCondVal !== 0;
        } else {
          clause.wasActive = isActive;
        }
      }
      if (!anyFired) break;
      this.evaluateBlocks(valuesByStringId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RHS Bridge: builds a (t, y) => dy/dt callback for Dopri5/BDF
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Constructs a pure ODE right-hand side closure `(t, y) => dy/dt` for adaptive
   * integrators (Dopri5, Tsit5, BDF, Rodas4P, TR-BDF2).
   */
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
      // Evaluate all blocks and derivative equations.
      // NOTE: When-clauses and state machines are NOT evaluated here because
      // they have memory (wasActive, activeState) that would be corrupted by
      // the intermediate trial-point evaluations of adaptive RK stages.
      // They are processed exclusively in the event callback.
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
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

  /**
   * Constructs scalar zero-crossing indicator callbacks $g_i(t, y)$ for all extracted
   * relational and `sample(start, interval)` event indicators.
   */
  private buildEventFunctions(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    timeId: number,
  ): ((t: number, y: number[]) => number)[] {
    if (this.eventIndicators.length === 0) return [];
    const n = stateStringIds.length;

    return this.eventIndicators.map((ei) => {
      const kind = this.arena.getExprKind(ei.exprId);
      const isSampleCall =
        kind === ExprKind.Call &&
        this.arena.interner.resolve(this.arena.getExprData1(ei.exprId)) === "sample" &&
        this.arena.getExprRight(ei.exprId) >= 2;
      const sampleStartExprId = isSampleCall ? this.arena.getExprLeft(ei.exprId) : -1;
      const sampleIntervalExprId = isSampleCall ? this.arena.getExprLeft(ei.exprId + 1) : -1;

      return (t: number, y: number[]): number => {
        valuesByStringId[timeId] = t;
        for (let i = 0; i < n; i++) {
          valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
        }
        if (isSampleCall) {
          const start = evaluateArenaRuntime(this.arena, sampleStartExprId, valuesByStringId);
          const interval = evaluateArenaRuntime(this.arena, sampleIntervalExprId, valuesByStringId);
          if (interval <= 0) return -1;
          const u = (t - start) / interval;
          return u < 0 ? u : Math.sin(Math.PI * u);
        }
        return evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId, this.preValuesByStringId);
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Callback: handles zero-crossing events (reinit, discrete updates)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Constructs the event-handling callback invoked by adaptive solvers when a zero-crossing
   * root is located, executing state machines, `when`-clause `reinit`/assignment actions,
   * and zero-crossing surface projection.
   */
  private buildEventCallback(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    timeId: number,
  ): (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[] {
    const n = stateStringIds.length;
    return (t: number, y: number[], eventIdx: number): number[] => {
      // Write state at event time
      valuesByStringId[timeId] = t;
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
      }
      // Evaluate blocks and derivative equations at the event state
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
      if (this.preValuesByStringId && this.preValuesByStringId.length === valuesByStringId.length) {
        this.preValuesByStringId.set(valuesByStringId);
      }
      this.executeStateMachines(valuesByStringId);

      // Project state onto the zero-crossing surface BEFORE evaluating when-clauses.
      // The bisection locates events to ~1e-12 precision, but the residual non-zero
      // value can cause strict inequalities (e.g. h < 0) to evaluate to false.
      //
      // We nudge the projected value slightly PAST the surface in the crossing
      // direction so that both strict (h < 0) and non-strict (h <= 0) conditions
      // evaluate to true at the event instant. The nudge magnitude (1e-10) is
      // large enough to flip the boolean but small enough to be physically
      // negligible (well within solver tolerance).
      let triggeredClauseIndices: number[] | undefined;
      if (eventIdx >= 0 && eventIdx < this.eventIndicators.length) {
        const ei = this.eventIndicators[eventIdx];
        if (ei) {
          triggeredClauseIndices = (ei as any).clauseIndices;
          const eiKind = this.arena.getExprKind(ei.exprId);

          let targetStateNameId = -1;
          let rhsVal = 0;

          if (eiKind === ExprKind.Name) {
            targetStateNameId = this.arena.getExprData1(ei.exprId);
            rhsVal = 0; // It was simplified from `x - 0`
          } else if (eiKind === ExprKind.Binary) {
            const op = this.arena.getExprData1(ei.exprId) as BinOp;
            if (op === BinOp.Sub) {
              const lhsId = this.arena.getExprLeft(ei.exprId);
              if (this.arena.getExprKind(lhsId) === ExprKind.Name) {
                targetStateNameId = this.arena.getExprData1(lhsId);
                rhsVal = evaluateArenaRuntime(this.arena, this.arena.getExprRight(ei.exprId), valuesByStringId);
              }
            }
          }

          if (targetStateNameId !== -1) {
            for (let i = 0; i < n; i++) {
              if (stateStringIds[i] === targetStateNameId) {
                // Nudge past the surface
                let nudge = 0;
                if (ei.direction === -1) {
                  nudge = -1e-10;
                } else if (ei.direction === 1) {
                  nudge = 1e-10;
                } else {
                  const gCurrent = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
                  nudge = gCurrent >= 0 ? -1e-10 : 1e-10;
                }
                valuesByStringId[targetStateNameId] = rhsVal + nudge;
                break;
              }
            }
          }
        }
      }

      // Reset wasActive flags for clauses participating in the triggered zero-crossing
      // (or all clauses if no clause indices array was attached to the event).
      if (Array.isArray(triggeredClauseIndices)) {
        for (const cIdx of triggeredClauseIndices) {
          const clause = this.whenClauses[cIdx];
          if (clause) clause.wasActive = false;
        }
      } else {
        for (const clause of this.whenClauses) {
          clause.wasActive = false;
        }
      }

      // Process all when-clauses with bounded discrete event iteration.
      // We evaluate their boolean conditions at the precise event state to detect rising edges,
      // and record any state variables modified by reinit/assign actions so post-event surface
      // projection does not clobber them.
      const modifiedByWhen = new Set<number>();
      for (let iter = 0; iter < 10; iter++) {
        let anyFired = false;
        for (const clause of this.whenClauses) {
          const condVal = evaluateArenaRuntime(
            this.arena,
            clause.conditionExprId,
            valuesByStringId,
            this.preValuesByStringId,
          );
          const isActive = condVal !== 0;

          if (isActive && !clause.wasActive) {
            anyFired = true;
            for (const action of clause.actions) {
              const val = evaluateArenaRuntime(this.arena, action.exprId, valuesByStringId, this.preValuesByStringId);
              valuesByStringId[action.targetNameId] = val;
              modifiedByWhen.add(action.targetNameId);
            }
            // Re-evaluate the condition after actions (e.g. reinit) to properly set the edge-detection
            // state for the next step, preventing immediate spurious re-triggering.
            const postCondVal = evaluateArenaRuntime(
              this.arena,
              clause.conditionExprId,
              valuesByStringId,
              this.preValuesByStringId,
            );
            clause.wasActive = postCondVal !== 0;
          } else {
            clause.wasActive = isActive;
          }
        }
        if (!anyFired) break;
        this.evaluateBlocks(valuesByStringId);
      }

      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, t, 0);

      // Read back possibly-modified state
      const yAfter = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        yAfter[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      }

      // Project state onto the zero-crossing surface to prevent chattering,
      // unless the state variable was explicitly reinitialized by a when-action.
      if (eventIdx >= 0 && eventIdx < this.eventIndicators.length) {
        const ei = this.eventIndicators[eventIdx];
        if (ei) {
          const eiKind = this.arena.getExprKind(ei.exprId);
          if (eiKind === ExprKind.Binary) {
            const op = this.arena.getExprData1(ei.exprId) as BinOp;
            if (op === BinOp.Sub) {
              const lhsId = this.arena.getExprLeft(ei.exprId);
              if (this.arena.getExprKind(lhsId) === ExprKind.Name) {
                const nameId = this.arena.getExprData1(lhsId);
                if (!modifiedByWhen.has(nameId)) {
                  for (let i = 0; i < n; i++) {
                    if (stateStringIds[i] === nameId) {
                      const rhsVal = evaluateArenaRuntime(
                        this.arena,
                        this.arena.getExprRight(ei.exprId),
                        valuesByStringId,
                      );
                      yAfter[i] = rhsVal;
                      valuesByStringId[nameId] = rhsVal;
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }

      return yAfter;
    };
  }

  /**
   * Checks numerical variables against interval bounds, min/max attributes, and domain singularities.
   */
  public checkIntervalSafetyBarriers(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    currentTime: number,
  ): void {
    // Check state variables for NaN/Infinity
    for (const sid of stateStringIds) {
      const val = valuesByStringId[sid] ?? 0;
      if (!Number.isFinite(val)) {
        const name = this.arena.interner.resolve(sid) ?? `var_${sid}`;
        this.intervalIssues.push(
          `Numerical singularity at t=${currentTime.toFixed(4)}s: variable '${name}' is ${isNaN(val) ? "NaN" : "Infinity"}`,
        );
      }
    }

    // Check variable min/max attribute bounds
    for (let i = 0; i < this.arena.varCount; i++) {
      if (this.arena.isVarRemoved(i)) continue;
      const minExpr = this.arena.getVarAttrExprId(i, "min");
      const maxExpr = this.arena.getVarAttrExprId(i, "max");
      if (minExpr === undefined && maxExpr === undefined) continue;

      const nameId = this.arena.getVarNameId(i);
      const val = valuesByStringId[nameId];
      if (val === undefined || !Number.isFinite(val)) continue;

      let minVal = -Infinity;
      let maxVal = Infinity;
      if (minExpr !== undefined) {
        minVal = evaluateArenaRuntime(this.arena, minExpr, valuesByStringId);
      }
      if (maxExpr !== undefined) {
        maxVal = evaluateArenaRuntime(this.arena, maxExpr, valuesByStringId);
      }

      if (typeof this.arena.exports?.dae_checkVarBounds === "function") {
        const mask = this.arena.exports.dae_checkVarBounds(i, val, val, minVal, maxVal);
        const MIN_BOUND_VIOLATION = 1 << 8;
        const MAX_BOUND_VIOLATION = 1 << 9;
        if ((mask & MIN_BOUND_VIOLATION) !== 0) {
          const varName = this.arena.getVarName(i);
          this.intervalIssues.push(
            `Variable '${varName}' breached minimum bound ${minVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
          );
        }
        if ((mask & MAX_BOUND_VIOLATION) !== 0) {
          const varName = this.arena.getVarName(i);
          this.intervalIssues.push(
            `Variable '${varName}' breached maximum bound ${maxVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
          );
        }
      } else {
        if (minVal > -Infinity && val < minVal) {
          const varName = this.arena.getVarName(i);
          this.intervalIssues.push(
            `Variable '${varName}' breached minimum bound ${minVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
          );
        }
        if (maxVal < Infinity && val > maxVal) {
          const varName = this.arena.getVarName(i);
          this.intervalIssues.push(
            `Variable '${varName}' breached maximum bound ${maxVal} (value=${val.toFixed(4)}) at t=${currentTime.toFixed(4)}s`,
          );
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Simulation (multi-solver: Euler, RK4, Dopri5, BDF)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Synchronously integrates the prepared DAE system over `steps` output intervals of width `step`,
   * supporting fixed-step (`"euler"`, `"rk4"`) and adaptive (`"dopri5"`, `"tsit5"`, `"bdf"`,
   * `"rodas4p"`, `"trbdf2"`, `"auto"`) solvers, online STL safety barrier monitors, and interval checks.
   */
  simulate(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      solver?:
        | "euler"
        | "rk4"
        | "dopri5"
        | "tsit5"
        | "bdf"
        | "rodas4p"
        | "trbdf2"
        | "qss1"
        | "qss2"
        | "qss3"
        | "liqss2"
        | "auto"
        | "cvode"
        | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
      stlMonitors?: OnlineSTLMonitor[] | undefined;
      earlyTerminateOnViolation?: boolean | undefined;
      intervalBarrierCheck?: boolean | undefined;
      onStepViolation?:
        | ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void)
        | undefined;
    },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;

    this.preValuesByStringId = new Float64Array(valuesByStringId.length);
    this.preValuesByStringId.set(valuesByStringId);

    // Execute initial algorithm sections
    for (const sec of this.arena.initialAlgorithmSections) {
      executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
    }

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = startTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }
    // Initialize event indicator previous values
    for (const ei of this.eventIndicators) {
      ei.prevValue = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
    }

    // ── Adaptive & Quantized-State solvers (Tsit5, Dopri5, BDF, Rodas4P, TRBDF2, QSS1/2/3, LIQSS2) ──
    if (
      solver === "dopri5" ||
      solver === "tsit5" ||
      solver === "bdf" ||
      solver === "rodas4p" ||
      solver === "trbdf2" ||
      solver === "qss1" ||
      solver === "qss2" ||
      solver === "qss3" ||
      solver === "liqss2" ||
      solver === "auto"
    ) {
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
    if (solver === "cvode") {
      throw new Error("CVODE solver requires simulateAsync instead of simulate");
    }

    // ── Fixed-step solvers (RK4, Euler) ──
    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = startTime;

    this.safetyViolations = [];
    this.intervalIssues = [];
    const stlMonitors = options?.stlMonitors ?? [];
    for (const m of stlMonitors) m.reset();
    let terminatedEarly = false;

    for (let s = 0; s <= steps; s++) {
      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
      this.preValuesByStringId.set(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, step);
      this.checkAssertions(valuesByStringId, currentTime);

      // Run regular algorithm sections
      for (const sec of this.arena.algorithmSections) {
        executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
      }

      // Record output
      const outIds = options?.outputStringIds ?? stateStringIds;
      const currentState = new Float64Array(outIds.length);
      for (let i = 0; i < outIds.length; i++) {
        currentState[i] = valuesByStringId[outIds[i] ?? -1] ?? 0;
      }
      t_out.push(currentTime);
      y_out.push(currentState);

      // ── Safety barrier monitoring (STL) ──
      if (stlMonitors.length > 0) {
        for (const mon of stlMonitors) {
          const stepRes = mon.step(currentTime, currentState);
          if (stepRes.isViolated) {
            this.safetyViolations.push({
              t: currentTime,
              monitorName: mon.options.requirementName ?? "STL Safety Barrier",
              robustness: stepRes.robustness,
              details: `Safety barrier breached at t=${currentTime.toFixed(4)}s: rho=${stepRes.robustness.toFixed(4)} < 0`,
            });
            if (options?.onStepViolation) {
              options.onStepViolation(currentTime, currentState, mon, stepRes);
            }
            if (stepRes.shouldTerminate || options?.earlyTerminateOnViolation) {
              terminatedEarly = true;
              break;
            }
          }
        }
        if (terminatedEarly) break;
      }

      // ── Interval / singularity barrier check ──
      if (options?.intervalBarrierCheck) {
        this.checkIntervalSafetyBarriers(valuesByStringId, stateStringIds, currentTime);
        if (this.intervalIssues.length > 0 && options?.earlyTerminateOnViolation) {
          terminatedEarly = true;
          break;
        }
      }

      if (s === steps) break;

      // Integrate state variables
      if (solver === "rk4") {
        this.rk4Step(step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      } else {
        // Forward Euler
        const y0Euler = new Float64Array(n);
        for (let i = 0; i < n; i++) y0Euler[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
        for (let i = 0; i < n; i++) {
          const stateId = stateStringIds[i] ?? -1;
          const derivId = derivStringIds[i] ?? -1;
          if (derivId !== -1 && stateId !== -1) {
            valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + step * (valuesByStringId[derivId] ?? 0);
          }
        }
        this.projectFrictionRestStates(y0Euler, valuesByStringId, stateStringIds);
      }

      currentTime += step;
    }

    return {
      t: t_out,
      y: y_out,
      terminatedEarly,
      safetyViolations: this.safetyViolations,
      intervalIssues: this.intervalIssues,
    };
  }

  /**
   * Advances the DAE simulation by a single time step (dt).
   *
   * Evaluates algebraic blocks, event indicators, when clauses,
   * advances states using RK4 or Euler, and updates time to t + dt.
   */
  public step(
    dt: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      solver?: "euler" | "rk4" | undefined;
    },
  ): void {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const currentTime = valuesByStringId[timeId] ?? 0;
    const n = stateStringIds.length;

    if (!this.preValuesByStringId || this.preValuesByStringId.length !== valuesByStringId.length) {
      this.preValuesByStringId = new Float64Array(valuesByStringId.length);
      this.preValuesByStringId.set(valuesByStringId);
    }

    // Evaluate at current time
    valuesByStringId[timeId] = currentTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    this.preValuesByStringId.set(valuesByStringId);
    this.executeStateMachines(valuesByStringId);
    this.processWhenClauses(valuesByStringId);
    if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, dt);
    this.checkAssertions(valuesByStringId, currentTime);

    // Run regular algorithm sections
    for (const sec of this.arena.algorithmSections) {
      executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
    }

    // Integrate state variables
    if (solver === "rk4") {
      this.rk4Step(dt, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
    } else {
      const y0Euler = new Float64Array(n);
      for (let i = 0; i < n; i++) y0Euler[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      for (let i = 0; i < n; i++) {
        const stateId = stateStringIds[i] ?? -1;
        const derivId = derivStringIds[i] ?? -1;
        if (derivId !== -1 && stateId !== -1) {
          valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + dt * (valuesByStringId[derivId] ?? 0);
        }
      }
      this.projectFrictionRestStates(y0Euler, valuesByStringId, stateStringIds);
    }

    const nextTime = currentTime + dt;
    valuesByStringId[timeId] = nextTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
  }

  /**
   * Run simulation using an adaptive or Quantized-State solver (Dopri5, Tsit5, BDF, Rodas4P, TRBDF2, QSS1/2/3, LIQSS2).
   * Bridges the arena evaluation into the standalone solver modules.
   */
  private simulateAdaptive(
    solver: "dopri5" | "tsit5" | "bdf" | "rodas4p" | "trbdf2" | "qss1" | "qss2" | "qss3" | "liqss2" | "auto",
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
    options?: {
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
      stlMonitors?: OnlineSTLMonitor[] | undefined;
      earlyTerminateOnViolation?: boolean | undefined;
      intervalBarrierCheck?: boolean | undefined;
      onStepViolation?:
        | ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void)
        | undefined;
    },
  ) {
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;
    const stopTime = startTime + steps * step;
    const atol = options?.atol ?? 1e-7;
    const rtol = options?.rtol ?? 1e-7;

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

    // Build event functions, callback, and crossing directions
    const eventFns = this.buildEventFunctions(valuesByStringId, stateStringIds, timeId);
    const eventCb = eventFns.length > 0 ? this.buildEventCallback(valuesByStringId, stateStringIds, timeId) : undefined;
    const eventDirs = this.eventIndicators.map((ei) => ei.direction);

    let rawResult: { times: number[]; states: number[][] };

    if (solver === "bdf") {
      // Build analytical Jacobian via reverse-mode AD (if available).
      // This avoids O(n) finite-difference RHS evaluations per Jacobian update.
      const adJacobian = buildAdJacobian(this.arena);
      rawResult = bdf(
        rhsFn,
        startTime,
        y0,
        stopTime,
        outputTimes,
        { atol, rtol, ...(adJacobian ? { jacobian: adJacobian } : {}) },
        eventFns.length > 0 ? eventFns : undefined,
        eventCb,
      );
    } else if (solver === "tsit5") {
      rawResult = tsit5(rhsFn, startTime, y0, stopTime, outputTimes, {
        atol,
        rtol,
        initialStep: step,
        maxStep: Math.min(Math.abs(stopTime - startTime), step * 2),
        eventFunctions: eventFns.length > 0 ? eventFns : undefined,
        eventCallback: eventCb,
        eventDirections: eventDirs as any,
      });
    } else if (solver === "rodas4p") {
      rawResult = rodas4p(rhsFn, startTime, y0, stopTime, outputTimes, {
        atol,
        rtol,
        initialStep: step,
        maxStep: Math.min(Math.abs(stopTime - startTime), step * 2),
      });
    } else if (solver === "trbdf2") {
      rawResult = trbdf2(rhsFn, startTime, y0, stopTime, outputTimes, {
        atol,
        rtol,
        initialStep: step,
        maxStep: Math.min(Math.abs(stopTime - startTime), step * 2),
      });
    } else if (solver === "qss1" || solver === "qss2" || solver === "qss3" || solver === "liqss2") {
      rawResult = qssSolve(rhsFn, startTime, y0, stopTime, outputTimes, {
        method: solver,
        atol: options?.atol,
        rtol: options?.rtol,
        eventFunctions: eventFns.length > 0 ? eventFns : undefined,
        eventCallback: eventCb,
        eventDirections: eventDirs as any,
      });
    } else {
      // dopri5 or auto
      rawResult = dopri5(
        rhsFn,
        startTime,
        y0,
        stopTime,
        outputTimes,
        {
          atol,
          rtol,
          initialStep: step,
          maxStep: Math.min(Math.abs(stopTime - startTime), step * 2),
        },
        eventFns.length > 0 ? eventFns : undefined,
        eventCb,
        eventDirs,
      );
    }

    // Convert to Float64Array output format
    const outIds = options?.outputStringIds ?? stateStringIds;
    const t_out = rawResult.times;
    const y_out: Float64Array[] = rawResult.states.map((row, rowIdx) => {
      // First, load the states into the environment
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = row[i] ?? 0;
      }
      // Set current sample time
      valuesByStringId[timeId] = t_out[rowIdx] ?? startTime;

      // Re-evaluate algebraic variables for the recorded state
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);

      const fa = new Float64Array(outIds.length);
      for (let i = 0; i < outIds.length; i++) {
        fa[i] = valuesByStringId[outIds[i] ?? -1] ?? 0;
      }
      return fa;
    });

    this.safetyViolations = [];
    this.intervalIssues = [];
    const stlMonitors = options?.stlMonitors ?? [];
    for (const m of stlMonitors) m.reset();
    let terminatedEarly = false;
    let cutIdx = t_out.length;

    if (stlMonitors.length > 0 || options?.intervalBarrierCheck) {
      for (let k = 0; k < t_out.length; k++) {
        const tCurr = t_out[k]!;
        const yCurr = y_out[k]!;

        if (stlMonitors.length > 0) {
          for (const mon of stlMonitors) {
            const stepRes = mon.step(tCurr, yCurr);
            if (stepRes.isViolated) {
              this.safetyViolations.push({
                t: tCurr,
                monitorName: mon.options.requirementName ?? "STL Safety Barrier",
                robustness: stepRes.robustness,
                details: `Safety barrier breached at t=${tCurr.toFixed(4)}s: rho=${stepRes.robustness.toFixed(4)} < 0`,
              });
              if (options?.onStepViolation) {
                options.onStepViolation(tCurr, yCurr, mon, stepRes);
              }
              if (stepRes.shouldTerminate || options?.earlyTerminateOnViolation) {
                terminatedEarly = true;
                cutIdx = k + 1;
                break;
              }
            }
          }
          if (terminatedEarly) break;
        }

        if (options?.intervalBarrierCheck) {
          for (let i = 0; i < n; i++) {
            valuesByStringId[stateStringIds[i] ?? -1] = rawResult.states[k]?.[i] ?? 0;
          }
          this.checkIntervalSafetyBarriers(valuesByStringId, stateStringIds, tCurr);
          if (this.intervalIssues.length > 0 && options?.earlyTerminateOnViolation) {
            terminatedEarly = true;
            cutIdx = k + 1;
            break;
          }
        }
      }
    }

    const finalT = terminatedEarly ? t_out.slice(0, cutIdx) : t_out;
    const finalY = terminatedEarly ? y_out.slice(0, cutIdx) : y_out;

    return {
      t: finalT,
      y: finalY,
      terminatedEarly,
      safetyViolations: this.safetyViolations,
      intervalIssues: this.intervalIssues,
    };
  }

  /**
   * Projects velocity states of components with dry/rolling friction to rest (0)
   * when the velocity crosses zero or is within regularized friction boundary
   * without an active driving force/torque.
   */
  private projectFrictionRestStates(y0: Float64Array | number[], vals: Float64Array, stateIds: number[]): void {
    const n = stateIds.length;
    for (let i = 0; i < n; i++) {
      const sId = stateIds[i] ?? -1;
      if (sId < 0) continue;
      const name = this.arena.interner.resolve(sId);
      if (!name) continue;
      const dotIdx = name.lastIndexOf(".");
      if (dotIdx < 0) continue;
      const v0 = (y0 as any)[i] ?? 0;
      const v1 = vals[sId] ?? 0;
      const crossedZero = (v0 > 1e-9 && v1 <= 0) || (v0 < -1e-9 && v1 >= 0);
      const deceleratingIntoStiction =
        Math.abs(v0) > Math.abs(v1) && ((v0 > 0 && v1 <= 0.005) || (v0 < 0 && v1 >= -0.005) || Math.abs(v1) <= 1e-4);
      if (!crossedZero && !deceleratingIntoStiction) continue;

      const prefix = name.substring(0, dotIdx);
      // Verify the component has a connector flow variable with negligible net driving force/torque
      let flowVarNameId = -1;
      for (let vIdx = 0; vIdx < this.arena.varCount; vIdx++) {
        if (this.arena.isVarRemoved(vIdx) || !this.arena.isVarFlow(vIdx)) continue;
        const vName = this.arena.getVarName(vIdx);
        if (vName.startsWith(prefix + ".")) {
          flowVarNameId = this.arena.getVarNameId(vIdx);
          break;
        }
      }
      if (flowVarNameId < 0) {
        const faIdx = this.arena.getVarIdxByName(`${prefix}.flange_a.f`);
        const faPhiIdx = this.arena.getVarIdxByName(`${prefix}.flange_a.tau`);
        if (faIdx >= 0) flowVarNameId = this.arena.getVarNameId(faIdx);
        else if (faPhiIdx >= 0) flowVarNameId = this.arena.getVarNameId(faPhiIdx);
      }
      if (flowVarNameId < 0) continue;
      const flowVal = vals[flowVarNameId] ?? 0;
      if (Math.abs(flowVal) < 1e-3) {
        vals[sId] = 0;
      }
    }
  }

  /**
   * Classical 4th-order Runge-Kutta step.
   * Updates state variables in valuesByStringId in-place.
   */
  public rk4Step(
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

    // k1 = f(t, y0) — already evaluated by evaluateBlocks + evaluateDerivativeEquations
    const k1 = new Float64Array(n);
    for (let i = 0; i < n; i++) k1[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k2 = f(t + h/2, y0 + h/2 * k1)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + 0.5 * h * (k1[i] as number);
    }
    vals[timeId] = t + 0.5 * h;
    this.evaluateBlocks(vals);
    this.evaluateDerivativeEquations(vals);
    const k2 = new Float64Array(n);
    for (let i = 0; i < n; i++) k2[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k3 = f(t + h/2, y0 + h/2 * k2)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + 0.5 * h * (k2[i] as number);
    }
    this.evaluateBlocks(vals);
    this.evaluateDerivativeEquations(vals);
    const k3 = new Float64Array(n);
    for (let i = 0; i < n; i++) k3[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k4 = f(t + h, y0 + h * k3)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + h * (k3[i] as number);
    }
    vals[timeId] = t + h;
    this.evaluateBlocks(vals);
    this.evaluateDerivativeEquations(vals);
    const k4 = new Float64Array(n);
    for (let i = 0; i < n; i++) k4[i] = vals[derivIds[i] ?? -1] ?? 0;

    // y_new = y0 + (h/6) * (k1 + 2*k2 + 2*k3 + k4)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] =
        (y0[i] as number) +
        (h / 6.0) * ((k1[i] as number) + 2 * (k2[i] as number) + 2 * (k3[i] as number) + (k4[i] as number));
    }
    this.projectFrictionRestStates(y0, vals, stateIds);
  }

  /**
   * Computes the structural upper (`mu`) and lower (`ml`) bandwidths of the ODE state Jacobian
   * by propagating state dependencies through `this.executionBlocks`.
   */
  private computeStateJacobianBandwidth(
    stateStringIds: number[],
    derivStringIds: number[],
  ): { mu: number; ml: number } {
    const n = stateStringIds.length;
    if (n <= 1) return { mu: 0, ml: 0 };

    const stateDeps = new Map<number, Set<number>>();
    for (let j = 0; j < n; j++) {
      stateDeps.set(stateStringIds[j] as number, new Set([j]));
    }

    const collectExprDeps = (exprId: number, out: Set<number>): void => {
      if (exprId < 0) return;
      const kind = this.arena.getExprKind(exprId);
      if (kind === ExprKind.Name) {
        const nid = this.arena.getExprData1(exprId);
        const deps = stateDeps.get(nid);
        if (deps) {
          for (const s of deps) out.add(s);
        }
        return;
      }
      if (kind === ExprKind.Der) {
        const inner = this.arena.getExprData1(exprId);
        if (this.arena.getExprKind(inner) === ExprKind.Name) {
          const innerName = this.arena.interner.resolve(this.arena.getExprData1(inner));
          if (innerName) {
            const derId = this.arena.interner.intern(`der(${innerName})`);
            const deps = stateDeps.get(derId);
            if (deps) {
              for (const s of deps) out.add(s);
            }
          }
        }
        return;
      }
      if (kind === ExprKind.Binary) {
        collectExprDeps(this.arena.getExprLeft(exprId), out);
        collectExprDeps(this.arena.getExprRight(exprId), out);
        return;
      }
      if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
        collectExprDeps(this.arena.getExprLeft(exprId), out);
        return;
      }
      if (kind === ExprKind.IfElse) {
        collectExprDeps(this.arena.getExprData1(exprId), out);
        collectExprDeps(this.arena.getExprLeft(exprId), out);
        collectExprDeps(this.arena.getExprRight(exprId), out);
        return;
      }
      if (kind === ExprKind.Call) {
        const argc = this.arena.getExprRight(exprId);
        const firstArg = this.arena.getExprLeft(exprId);
        for (let a = 0; a < argc; a++) {
          collectExprDeps(a === 0 ? firstArg : this.arena.getExprLeft(exprId + a), out);
        }
      }
    };

    for (const block of this.executionBlocks) {
      if (block.type === "single") {
        const deps = new Set<number>();
        collectExprDeps(block.exprId, deps);
        stateDeps.set(this.arena.getVarNameId(block.varIdx), deps);
      } else if (block.type === "system") {
        const deps = new Set<number>();
        for (const eqIdx of block.eqIdxs) {
          collectExprDeps(this.arena.getEqLhs(eqIdx), deps);
          collectExprDeps(this.arena.getEqRhs(eqIdx), deps);
        }
        for (const vIdx of block.vars) {
          stateDeps.set(this.arena.getVarNameId(vIdx), deps);
        }
      }
    }

    let mu = 0;
    let ml = 0;
    for (let i = 0; i < n; i++) {
      const dDeps = stateDeps.get(derivStringIds[i] as number);
      if (!dDeps) continue;
      for (const j of dDeps) {
        if (j > i && j - i > mu) mu = j - i;
        if (i > j && i - j > ml) ml = i - j;
      }
    }
    return { mu, ml };
  }

  /**
   * Executes the simulation using the LLNL SUNDIALS CVODE WebAssembly BDF integrator,
   * handling zero-crossing rootfinding (`CV_ROOT_RETURN`), discrete `when`-clause updates,
   * state machine transitions, and solver reinitialization.
   */
  private async simulateCvodeWasm(
    wasmMod: any,
    CvodeSolverClass: any,
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
    options?: {
      signal?: AbortSignal | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
    },
  ): Promise<{ t: number[]; y: number[][] }> {
    this.preValuesByStringId = new Float64Array(valuesByStringId.length);
    this.preValuesByStringId.set(valuesByStringId);
    const t = valuesByStringId[timeId] ?? 0;
    const n = stateStringIds.length;
    const outIds = options?.outputStringIds ?? stateStringIds;
    const outN = outIds.length;

    if (n === 0) {
      const resultT = new Float64Array(steps + 1);
      const resultY: Float64Array[] = new Array(steps + 1);
      let currentT = t;
      resultT[0] = currentT;
      resultY[0] = new Float64Array(outN);
      for (let i = 0; i < outN; i++) resultY[0][i] = valuesByStringId[outIds[i] as number] ?? 0;

      for (let s = 1; s <= steps; s++) {
        currentT += step;
        valuesByStringId[timeId] = currentT;
        this.evaluateBlocks(valuesByStringId);
        this.preValuesByStringId.set(valuesByStringId);
        this.processWhenClauses(valuesByStringId);
        resultT[s] = currentT;
        resultY[s] = new Float64Array(outN);
        for (let i = 0; i < outN; i++) resultY[s]![i] = valuesByStringId[outIds[i] as number] ?? 0;
      }
      return { t: Array.from(resultT), y: resultY.map((arr) => Array.from(arr)) };
    }

    const y0 = new Array(n);
    for (let i = 0; i < n; i++) y0[i] = valuesByStringId[stateStringIds[i] as number] ?? 0;

    const rhsFn = (t_eval: number, y: Float64Array, ydot: Float64Array) => {
      valuesByStringId[timeId] = t_eval;
      for (let i = 0; i < n; i++) valuesByStringId[stateStringIds[i] as number] = y[i] ?? 0;
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
      for (let i = 0; i < n; i++) ydot[i] = valuesByStringId[derivStringIds[i] as number] ?? 0;
      return 0;
    };

    const nEvents = this.eventIndicators.length;
    let eventFn: any;
    if (nEvents > 0) {
      eventFn = (t_eval: number, y: Float64Array, gout: Float64Array) => {
        valuesByStringId[timeId] = t_eval;
        for (let i = 0; i < n; i++) valuesByStringId[stateStringIds[i] as number] = y[i] ?? 0;
        this.evaluateBlocks(valuesByStringId);
        this.evaluateDerivativeEquations(valuesByStringId);
        for (let i = 0; i < nEvents; i++) {
          const ei = this.eventIndicators[i] as any;
          let val = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
          if (ei.direction === 0) {
            val = val ? 1 : -1;
          }
          gout[i] = val;
        }
        return 0;
      };
    }

    const { mu: structuralMu, ml: structuralMl } = this.computeStateJacobianBandwidth(stateStringIds, derivStringIds);
    const isBanded = n > 50 && structuralMu + structuralMl > 0 && structuralMu + structuralMl < Math.floor(n / 3);
    const chosenLinearSolver = (options as any)?.linearSolver ?? (isBanded ? "band" : "auto");

    const solver = new CvodeSolverClass(wasmMod, n, t, y0, rhsFn, nEvents, eventFn, {
      atol: options?.atol,
      rtol: options?.rtol,
      linearSolver: chosenLinearSolver,
      mu: (options as any)?.mu ?? structuralMu,
      ml: (options as any)?.ml ?? structuralMl,
      nnz: (options as any)?.nnz,
    });

    let resultT = new Float64Array(steps + 1);
    let resultY: Float64Array[] = new Array(steps + 1);

    resultT[0] = t;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    const y0_out = new Float64Array(outN);
    for (let i = 0; i < outN; i++) {
      y0_out[i] = valuesByStringId[outIds[i] as number] ?? 0;
    }
    resultY[0] = y0_out;

    let outIdx = 1;
    let currentT = t;
    for (let stepIdx = 1; stepIdx <= steps; stepIdx++) {
      const targetT = t + stepIdx * step;
      let reachedTarget = false;

      let stepCount = 0;
      while (!reachedTarget) {
        if (options?.signal?.aborted) {
          solver.dispose();
          throw new Error("Simulation aborted");
        }

        const stepResult = solver.step(targetT);
        const flag = stepResult.flag;
        currentT = stepResult.t;

        stepCount++;
        if (stepCount > 1000) {
          throw new Error(`Infinite loop detected at targetT=${targetT}, currentT=${currentT}, flag=${flag}`);
        }

        for (let i = 0; i < n; i++) {
          valuesByStringId[stateStringIds[i] as number] = stepResult.y[i] ?? 0;
        }
        valuesByStringId[timeId] = currentT;

        if (flag === 2) {
          // CV_ROOT_RETURN
          this.preValuesByStringId.set(valuesByStringId);
          for (let i = 0; i < nEvents; i++) {
            const ei = this.eventIndicators[i] as any;
            const val = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
            ei.prevValue = val;
          }
          this.processWhenClauses(valuesByStringId);
          this.executeStateMachines(valuesByStringId);
          this.evaluateBlocks(valuesByStringId);
          this.evaluateDerivativeEquations(valuesByStringId);

          const y_new = new Array(n);
          for (let i = 0; i < n; i++) y_new[i] = valuesByStringId[stateStringIds[i] as number] ?? 0;
          solver.reinit(currentT, y_new);
        }

        if (flag < 0) {
          solver.dispose();
          throw new Error(`CVODE solver failed with flag ${flag} at t=${currentT}`);
        }

        if (currentT >= targetT - 1e-12) {
          reachedTarget = true;
        }
      }

      if (outIdx >= resultT.length) {
        const newSize = resultT.length * 2;
        const newT = new Float64Array(newSize);
        newT.set(resultT);
        resultT = newT;

        const newY = new Array(newSize);
        for (let i = 0; i < resultY.length; i++) newY[i] = resultY[i];
        resultY = newY;
      }

      resultT[outIdx] = currentT;

      // We must re-evaluate algebraic variables for the recorded state because
      // the solver may have last evaluated the RHS at an intermediate or extrapolated time!
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);

      const step_y = new Float64Array(outN);
      for (let i = 0; i < outN; i++) {
        step_y[i] = valuesByStringId[outIds[i] as number] ?? 0;
      }
      resultY[outIdx] = step_y;
      outIdx++;
    }

    solver.dispose();

    return {
      t: Array.from(resultT.subarray(0, outIdx)),
      y: resultY.slice(0, outIdx).map((arr) => Array.from(arr)),
    };
  }

  /**
   * Asynchronously integrates the prepared DAE system over `steps` intervals of size `step`,
   * supporting SUNDIALS CVODE WASM (`solver: "cvode"`), interactive DAP debugger hooks,
   * cooperative event-loop yielding, and `AbortSignal` cancellation.
   */
  async simulateAsync(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      signal?: AbortSignal | undefined;
      solver?:
        | "euler"
        | "rk4"
        | "dopri5"
        | "tsit5"
        | "bdf"
        | "rodas4p"
        | "trbdf2"
        | "qss1"
        | "qss2"
        | "qss3"
        | "liqss2"
        | "auto"
        | "cvode"
        | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
    },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;

    // Execute initial algorithm sections
    for (const sec of this.arena.initialAlgorithmSections) {
      if (this.debuggerHook) {
        await executeArenaStatementsAsync(
          this.arena,
          sec.start,
          sec.count,
          valuesByStringId,
          undefined,
          this.debuggerHook,
        );
      } else {
        executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
      }
    }

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = startTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }
    for (const ei of this.eventIndicators) {
      ei.prevValue = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
    }

    if (solver === "cvode") {
      if (options?.signal?.aborted) throw new Error("Simulation aborted");
      const { loadSundialsWasm, CvodeSolver } = await import("../solvers/sundials-wasm.js");
      const wasmMod = await loadSundialsWasm();
      return this.simulateCvodeWasm(
        wasmMod,
        CvodeSolver,
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        options,
      );
    }

    // Adaptive & Quantized-State solvers run synchronously (they're CPU-bound; yielding inside would break solver state)
    if (
      solver === "dopri5" ||
      solver === "tsit5" ||
      solver === "bdf" ||
      solver === "rodas4p" ||
      solver === "trbdf2" ||
      solver === "qss1" ||
      solver === "qss2" ||
      solver === "qss3" ||
      solver === "liqss2" ||
      solver === "auto"
    ) {
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
      this.evaluateDerivativeEquations(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, step);
      this.checkAssertions(valuesByStringId, currentTime);

      // Run regular algorithm sections
      for (const sec of this.arena.algorithmSections) {
        if (this.debuggerHook) {
          await executeArenaStatementsAsync(
            this.arena,
            sec.start,
            sec.count,
            valuesByStringId,
            undefined,
            this.debuggerHook,
          );
        } else {
          executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
        }
      }

      // Record output
      const outIds = options?.outputStringIds ?? stateStringIds;
      const currentState = new Float64Array(outIds.length);
      for (let i = 0; i < outIds.length; i++) {
        currentState[i] = valuesByStringId[outIds[i] ?? -1] ?? 0;
      }
      t_out.push(currentTime);
      y_out.push(currentState);

      // Integrate state variables
      if (solver === "rk4") {
        this.rk4Step(step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      } else {
        const y0Euler = new Float64Array(n);
        for (let i = 0; i < n; i++) y0Euler[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
        for (let i = 0; i < n; i++) {
          const stateId = stateStringIds[i] ?? -1;
          const derivId = derivStringIds[i] ?? -1;
          if (derivId !== -1 && stateId !== -1) {
            valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + step * (valuesByStringId[derivId] ?? 0);
          }
        }
        this.projectFrictionRestStates(y0Euler, valuesByStringId, stateStringIds);
      }

      currentTime += step;
    }

    return { t: t_out, y: y_out };
  }

  /**
   * Evaluate the RHS (derivatives) of the ODE system at a given point.
   *
   * @param time          Current time
   * @param stateValues   Current state variable values
   * @param controlValues Current control variable values (overrides parameters)
   * @returns Map from state name to derivative value (dx/dt)
   */
  public evaluateRHS(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
  ): Map<string, number> {
    const envSize = Math.max(this.arena.interner.size + 256, 4096);
    const valuesByStringId = new Float64Array(envSize);

    // Load parameters
    for (const [name, val] of this.parameters) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }

    // Load states
    for (const [name, val] of stateValues) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }

    // Load controls
    if (controlValues) {
      for (const [name, val] of controlValues) {
        valuesByStringId[this.arena.interner.intern(name)] = val;
      }
    }

    const timeId = this.arena.interner.intern("time");
    valuesByStringId[timeId] = time;

    // Evaluate blocks and derivatives
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);

    const f = new Map<string, number>();
    for (const varIdx of this.stateVars) {
      const name = this.arena.getVarName(varIdx);
      const derId = this.arena.interner.intern(`der(${name})`);
      f.set(name, valuesByStringId[derId] ?? 0);
    }
    return f;
  }

  /**
   * Evaluate the RHS and its Jacobian w.r.t a set of seed variables using forward-mode AD.
   *
   * @param time          Current time
   * @param stateValues   Current state variable values
   * @param controlValues Current control variable values
   * @param seedVars      Variables to compute derivatives with respect to
   * @returns { f: Map<stateName, dx/dt>, J: Map<stateName, Map<seedVar, ∂f/∂seedVar>> }
   */
  public evaluateRHSWithJacobian(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
    seedVars?: string[],
  ): { f: Map<string, number>; J: Map<string, Map<string, number>> } {
    const allSeedVars = seedVars ?? [
      ...Array.from(stateValues.keys()),
      ...(controlValues ? Array.from(controlValues.keys()) : []),
    ];

    // Compute base values using evaluateRHS
    const envSize = Math.max(this.arena.interner.size + 256, 4096);
    const valuesByStringId = new Float64Array(envSize);

    for (const [name, val] of this.parameters) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }
    for (const [name, val] of stateValues) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }
    if (controlValues) {
      for (const [name, val] of controlValues) {
        valuesByStringId[this.arena.interner.intern(name)] = val;
      }
    }
    const timeId = this.arena.interner.intern("time");
    valuesByStringId[timeId] = time;

    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);

    const f = new Map<string, number>();
    for (const varIdx of this.stateVars) {
      const name = this.arena.getVarName(varIdx);
      const derId = this.arena.interner.intern(`der(${name})`);
      f.set(name, valuesByStringId[derId] ?? 0);
    }

    const J = new Map<string, Map<string, number>>();
    for (const varIdx of this.stateVars) {
      J.set(this.arena.getVarName(varIdx), new Map());
    }

    // Propagate dual numbers for each seed variable
    for (const seedVar of allSeedVars) {
      const dualEnv = new Array<Dual>(envSize);

      // Load all variables into the dual env from our base evaluation
      for (let sid = 0; sid < envSize; sid++) {
        const val = valuesByStringId[sid] ?? 0;
        dualEnv[sid] = Dual.constant(val);
      }

      // Perturb the seed variable with dot = 1.0
      const seedNameId = this.arena.interner.intern(seedVar);
      if (seedNameId < envSize) {
        const val = valuesByStringId[seedNameId] ?? 0;
        dualEnv[seedNameId] = new Dual(val, 1.0);
      }

      // Propagate dual numbers through blocks in execution order
      for (const block of this.executionBlocks) {
        if (block.type === "single") {
          const val = evaluateArenaDualExpression(this.arena, block.exprId, dualEnv);
          if (val !== null) {
            const varNameId = this.arena.getVarNameId(block.varIdx);
            dualEnv[varNameId] = val;
          }
        } else if (block.type === "system") {
          this.propagateSystemBlockDual(block, valuesByStringId, dualEnv);
        }
      }

      // Derivative equations are now part of execution blocks, so they are already propagated above.

      // Read sensitivities for each state
      for (const varIdx of this.stateVars) {
        const name = this.arena.getVarName(varIdx);
        const derId = this.arena.interner.intern(`der(${name})`);
        const dualDerVal = dualEnv[derId];
        const sensitivity = dualDerVal ? dualDerVal.dot : 0;
        J.get(name)!.set(seedVar, sensitivity);
      }
    }

    return { f, J };
  }

  /**
   * Propagates forward-mode dual sensitivities through a coupled algebraic system block
   * $F(z, y(s), s) = \text{lhs} - \text{rhs} = 0$ via the Implicit Function Theorem:
   * $$J_{\text{alg}} \dot{z} = -\left.\frac{\partial F}{\partial s}\right|_{\dot{z}=0}$$
   */
  public propagateSystemBlockDual(
    block: Extract<import("@modelscript/runtime").ArenaExecutionBlock, { type: "system" }>,
    valuesByStringId: Float64Array,
    dualEnv: Dual[],
  ): void {
    const m = block.vars.length;
    if (m === 0) return;

    this.ensureNewtonCapacity(m);

    const J = this.newtonScratchMat;
    const rhsVec = this.newtonScratchNegR;
    const piv = this.newtonScratchPiv;
    const scale = this.newtonScratchScale;
    const dualStack = this.newtonScratchDualStack;

    const blockAny = block as any;
    let cachedVarIds: Int32Array | undefined = blockAny._varNameIds;
    let cachedResIds: Int32Array | undefined = blockAny._resExprIds;
    if (!cachedVarIds || !cachedResIds) {
      cachedVarIds = new Int32Array(m);
      cachedResIds = new Int32Array(m);
      for (let i = 0; i < m; i++) {
        cachedVarIds[i] = this.arena.getVarNameId(block.vars[i] as number);
        const eqIdx = block.eqIdxs[i] as number;
        const lhsId = this.arena.getEqLhs(eqIdx);
        const rhsId = this.arena.getEqRhs(eqIdx);
        cachedResIds[i] = this.arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
      }
      blockAny._varNameIds = cachedVarIds;
      blockAny._resExprIds = cachedResIds;
    }

    // 1. Freeze block unknown dual derivatives to 0 to evaluate partial derivative wrt upstream variables/seed
    for (let j = 0; j < m; j++) {
      const nid = cachedVarIds[j] as number;
      dualEnv[nid] = Dual.constant(valuesByStringId[nid] ?? 0);
    }

    for (let i = 0; i < m; i++) {
      const resId = cachedResIds[i] as number;
      const resDual = evaluateArenaDualExpression(this.arena, resId, dualEnv);
      rhsVec[i] = -(resDual ? resDual.dot : 0);
    }

    // 2. Assemble block Jacobian J[i, j] = d(lhs_i - rhs_i) / d(z_j)
    for (let j = 0; j < m; j++) {
      const nid = cachedVarIds[j] as number;
      const xj = valuesByStringId[nid] ?? 0;
      for (let i = 0; i < m; i++) {
        const resId = cachedResIds[i] as number;
        const ok = evaluateArenaDualFlat(this.arena, resId, valuesByStringId, nid, dualStack, 0);
        if (ok) {
          J[i * m + j] = dualStack[1] as number;
        } else {
          const baseVal = evaluateArenaRuntime(this.arena, resId, valuesByStringId);
          const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
          valuesByStringId[nid] = xj + eps;
          const pertVal = evaluateArenaRuntime(this.arena, resId, valuesByStringId);
          valuesByStringId[nid] = xj;
          J[i * m + j] = ((isFinite(pertVal) ? pertVal : 0) - (isFinite(baseVal) ? baseVal : 0)) / eps;
        }
      }
    }

    // 3. Solve J * z_dot = -dF/ds
    try {
      const fact = luFactorFlat(J, m, piv, scale);
      luSolveFlat(fact, rhsVec);
      for (let j = 0; j < m; j++) {
        const nid = cachedVarIds[j] as number;
        const dotVal = rhsVec[j] as number;
        dualEnv[nid] = new Dual(valuesByStringId[nid] ?? 0, isFinite(dotVal) ? dotVal : 0);
      }
    } catch {
      // Fallback if block Jacobian is singular: fixed-point dual propagation on RHS
      for (let iter = 0; iter < 5; iter++) {
        for (let i = 0; i < m; i++) {
          const varIdx = block.vars[i]!;
          const eqIdx = block.eqIdxs[i]!;
          const rhsId = this.arena.getEqRhs(eqIdx);
          const val = evaluateArenaDualExpression(this.arena, rhsId, dualEnv);
          if (val !== null) {
            const varNameId = this.arena.getVarNameId(varIdx);
            dualEnv[varNameId] = val;
          }
        }
      }
    }
  }
}

/**
 * Initializes the simulation environment Float64Array with parameter bindings,
 * evaluated start values, and solved initial equations. Returns the initialized
 * state vector, state IDs, derivative IDs, and variable names.
 */
export function initializeArenaEnvironment(
  arena: DAEBuilder,
  sim: ArenaSimulator,
  options?: {
    startTime?: number | undefined;
    parameterOverrides?: Map<string, number> | undefined;
    initialStateOverrides?: Map<string, number> | undefined;
  },
): {
  valuesByStringId: Float64Array;
  stateStringIds: number[];
  derivStringIds: number[];
  stateNames: string[];
} {
  const startTime = options?.startTime ?? arena.experiment.startTime ?? 0;
  const envSize = Math.max(arena.interner.size + 256, 4096);
  const valuesByStringId = new Float64Array(envSize);

  // Set time
  const timeId = arena.interner.intern("time");
  valuesByStringId[timeId] = startTime;

  // Set parameters from the simulator's resolved parameters and arena start values
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      const name = arena.getVarName(i);
      const nameId = arena.getVarNameId(i);
      const val = sim.parameters.get(name) ?? arena.getVarStartValue(i);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }
  for (const [name, val] of sim.parameters) {
    const nameId = arena.interner.intern(name);
    valuesByStringId[nameId] = val;
  }

  // Apply parameter overrides
  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }

  // Set start values for all non-parameter variables
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant || sim.parameterVars.has(i)) continue;

    const nameId = arena.getVarNameId(i);
    const startVal = arena.getVarStartValue(i);
    if (startVal !== 0 || valuesByStringId[nameId] === 0) {
      valuesByStringId[nameId] = startVal;
    }

    // Evaluate start expression or start attribute if present
    const exprId = arena.getVarExpression(i) as number | undefined;
    if (typeof exprId === "number" && exprId !== -1) {
      const val = evaluateArenaExpression(arena, exprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startAttrId = arena.getVarAttrExprId(i, "start");
    if (typeof startAttrId === "number" && startAttrId !== -1) {
      const val = evaluateArenaExpression(arena, startAttrId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startWasmExprId = arena.getVarAttrExpr(i, VarAttrKind.Start);
    if (typeof startWasmExprId === "number" && startWasmExprId > 0) {
      const val = evaluateArenaExpression(arena, startWasmExprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
  }

  // Solve initial equations
  const initResult = solveInitialEquationsArena(arena, valuesByStringId);
  valuesByStringId.set(initResult.valuesByStringId);

  // Apply initial state overrides (for MHE, Kalman filtering, or state re-initialization)
  if (options?.initialStateOverrides) {
    for (const [name, val] of options.initialStateOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
    }
  }

  // Identify state/derivative StringIds
  const stateNameIds: number[] = [];
  const derivNameIds: number[] = [];
  const stateNames: string[] = [];

  for (const varIdx of sim.stateVars) {
    const name = arena.getVarName(varIdx);
    const nameId = arena.getVarNameId(varIdx);
    const derName = `der(${name})`;
    const derNameId = arena.interner.intern(derName);

    stateNameIds.push(nameId);
    derivNameIds.push(derNameId);
    stateNames.push(name);
  }

  return { valuesByStringId, stateStringIds: stateNameIds, derivStringIds: derivNameIds, stateNames };
}

/** Result of an arena-path simulation. */
export interface ArenaSimulationResult {
  /** Time points. */
  t: number[];
  /** State variable values at each time point (row-major: y[timeIdx][varIdx]). */
  y: number[][];
  /** Names of state variables (column headers for y). */
  states: string[];
  /** Whether simulation was terminated early by safety barrier monitor. */
  terminatedEarly?: boolean | undefined;
  /** Recorded safety barrier violations. */
  safetyViolations?:
    | {
        t: number;
        monitorName?: string | undefined;
        robustness: number;
        details?: string | undefined;
      }[]
    | undefined;
  /** Recorded interval domain and singularity issues. */
  intervalIssues?: string[] | undefined;
}

/** Options for `simulateArena()`. */
export interface ArenaSimulateOptions {
  /** Simulation start time $t_0$ (defaults to `experiment(StartTime)` or `0`). */
  startTime?: number | undefined;
  /** Simulation stop time $t_{\text{end}}$ (defaults to `experiment(StopTime)` or `10`). */
  stopTime?: number | undefined;
  /** Output interval (step size). */
  step?: number | undefined;
  /** Number of output intervals (used if `step` is not given). */
  numberOfIntervals?: number | undefined;
  /** ODE/DAE solver selection. */
  solver?:
    | "euler"
    | "rk4"
    | "dopri5"
    | "tsit5"
    | "bdf"
    | "rodas4p"
    | "trbdf2"
    | "qss1"
    | "qss2"
    | "qss3"
    | "liqss2"
    | "auto"
    | "webgpu"
    | "cvode"
    | undefined;
  /** Absolute tolerance for adaptive solvers (default: 1e-6). */
  atol?: number | undefined;
  /** Relative tolerance for adaptive solvers (default: 1e-6). */
  rtol?: number | undefined;
  /** Custom output string IDs for subsetting result traces. */
  outputStringIds?: number[] | undefined;
  /** Parameter overrides (name → value). */
  parameterOverrides?: Map<string, number> | undefined;
  /** Initial state overrides (name → value) at startTime. */
  initialStateOverrides?: Map<string, number> | undefined;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal | undefined;
  /** Optional FMU co-simulation subsystem registry for hybrid simulation. */
  fmuRegistry?: FmuSubsystemRegistry | undefined;
  /** Optional debugger hook for step-by-step statement execution. */
  debuggerHook?: SimulationDebugger | undefined;
  /** When true, preserves internal variables tagged with HideResult. */
  debug?: boolean | undefined;
  /** When true, only solves the steady-state initial equilibrium and returns immediately at startTime. */
  steadyStateOnly?: boolean | undefined;
  /** Real-time STL safety barrier monitors to evaluate during integration. */
  stlMonitors?: OnlineSTLMonitor[] | undefined;
  /** Immediately halt integration if an STL monitor detects safety violation (rho < 0). */
  earlyTerminateOnViolation?: boolean | undefined;
  /** Check variable min/max bounds and DAE singularities at each step. */
  intervalBarrierCheck?: boolean | undefined;
  /** Callback invoked on safety violation. */
  onStepViolation?:
    | ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void)
    | undefined;
  /** When true, runs set-based connector expansion, loop alias elimination, and vector causalization before scalarization. */
  vectorCausalize?: boolean | undefined;
  /** When true, lowers discontinuous expressions (abs, sign, min, max, if-else) to μ-Modelica discrete variables and When zero-crossings. */
  microModelica?: boolean | undefined;
}

/**
 * Run a complete simulation using the arena-only pipeline.
 *
 * Steps:
 *   1. Build the ArenaSimulator and run `prepare()` (Pantelides, BLT, isolation)
 *   2. Initialize the Float64Array environment with parameters and start values
 *   3. Run the arena init solver (Newton-Raphson + homotopy)
 *   4. Execute the simulation (RK4 or Euler)
 *   5. Transform output into the standard `{ t, y, states }` format
 */
export function simulateArena(arena: DAEBuilder, options?: ArenaSimulateOptions): ArenaSimulationResult {
  if (options?.vectorCausalize) {
    expandSetBasedConnectionsArena(arena);
    eliminateVectorArenaAliases(arena);
    causalizeVectorArena(arena);
  }
  if (options?.microModelica) {
    convertArenaToMicroModelica(arena);
  }
  // ── Step 1: Prepare the simulator ──
  const sim = new ArenaSimulator(arena);
  if (options?.fmuRegistry) {
    sim.fmuRegistry = options.fmuRegistry;
  }
  if (options?.debuggerHook) {
    sim.debuggerHook = options.debuggerHook;
  }
  sim.prepare();
  arena = sim.arena;

  // ── Step 2: Resolve experiment annotation defaults ──
  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const numIntervals = options?.numberOfIntervals ?? exp.numberOfIntervals;
  const step =
    options?.step ??
    (numIntervals ? (stopTime - startTime) / numIntervals : (exp.interval ?? (stopTime - startTime) / 500));

  // ── Step 3: Build the environment (Float64Array indexed by StringId) ──
  const envSize = Math.max(arena.interner.size + 256, 4096);
  const valuesByStringId = new Float64Array(envSize);

  // Set time
  const timeId = arena.interner.intern("time");
  valuesByStringId[timeId] = startTime;

  // Set parameters from the simulator's resolved parameters and arena start values
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      const name = arena.getVarName(i);
      const nameId = arena.getVarNameId(i);
      const val = sim.parameters.get(name) ?? arena.getVarStartValue(i);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }
  for (const [name, val] of sim.parameters) {
    const nameId = arena.interner.intern(name);
    valuesByStringId[nameId] = val;
  }

  // Apply parameter overrides
  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }

  // Set start values for all non-parameter variables
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant || sim.parameterVars.has(i)) continue;

    const nameId = arena.getVarNameId(i);
    const startVal = arena.getVarStartValue(i);
    if (startVal !== 0 || valuesByStringId[nameId] === 0) {
      valuesByStringId[nameId] = startVal;
    }

    // Evaluate start expression or start attribute if present
    const exprId = arena.getVarExpression(i) as number | undefined;
    if (typeof exprId === "number" && exprId !== -1) {
      const val = evaluateArenaExpression(arena, exprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startAttrId = arena.getVarAttrExprId(i, "start");
    if (typeof startAttrId === "number" && startAttrId !== -1) {
      const val = evaluateArenaExpression(arena, startAttrId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startWasmExprId = arena.getVarAttrExpr(i, VarAttrKind.Start);
    if (typeof startWasmExprId === "number" && startWasmExprId > 0) {
      const val = evaluateArenaExpression(arena, startWasmExprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
  }

  // ── Step 4: Solve initial equations ──
  const initResult = solveInitialEquationsArena(arena, valuesByStringId);
  // Copy initial solution back
  valuesByStringId.set(initResult.valuesByStringId);

  // Apply initial state overrides
  if (options?.initialStateOverrides) {
    for (const [name, val] of options.initialStateOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
    }
  }

  // ── Step 5: Identify state/derivative StringIds ──
  const stateNameIds: number[] = [];
  const derivNameIds: number[] = [];
  const stateNames: string[] = [];

  for (const varIdx of sim.stateVars) {
    const name = arena.getVarName(varIdx);
    const nameId = arena.getVarNameId(varIdx);
    const derName = `der(${name})`;
    const derNameId = arena.interner.intern(derName);

    stateNameIds.push(nameId);
    derivNameIds.push(derNameId);
    stateNames.push(name);
  }

  // ── Step 6: Run simulation ──
  if (options?.steadyStateOnly) {
    const t = [startTime];
    const initialRow: number[] = [];
    for (const nameId of stateNameIds) {
      initialRow.push(valuesByStringId[nameId] ?? 0);
    }
    let outNames = stateNames;
    let outY = [initialRow];
    if (options?.outputStringIds) {
      outNames = options.outputStringIds.map((id) => sim.arena.interner.resolve(id) ?? "unknown");
      outY = [options.outputStringIds.map((id) => valuesByStringId[id] ?? 0)];
    }
    return { t, y: outY, states: outNames };
  }

  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);

  // ── Step 5.5: Initialize FMU subsystems (if any) ──
  sim.initializeFmuSubsystems(startTime, stopTime, step);

  const defaultSolver = (exp.algorithm as any) ?? "rk4";
  const chosenSolver =
    options?.solver === "webgpu"
      ? "rk4"
      : options?.solver && options.solver !== "auto"
        ? options.solver
        : defaultSolver;

  const rawResult = sim.simulate(steps, step, valuesByStringId, stateNameIds, derivNameIds, {
    solver: chosenSolver,
    atol: options?.atol ?? exp.tolerance,
    rtol: options?.rtol ?? exp.tolerance,
    ...(options?.outputStringIds !== undefined && { outputStringIds: options.outputStringIds }),
    ...(options?.stlMonitors !== undefined && { stlMonitors: options.stlMonitors }),
    ...(options?.earlyTerminateOnViolation !== undefined && {
      earlyTerminateOnViolation: options.earlyTerminateOnViolation,
    }),
    ...(options?.intervalBarrierCheck !== undefined && { intervalBarrierCheck: options.intervalBarrierCheck }),
    ...(options?.onStepViolation !== undefined && { onStepViolation: options.onStepViolation }),
  });

  // ── Step 7.5: Terminate FMU subsystems ──
  sim.terminateFmuSubsystems();

  // ── Step 7: Transform to row-major output ──
  const t = rawResult.t;
  const y: number[][] = rawResult.y.map((row) => Array.from(row));

  let outNames = stateNames;
  let outY = y;
  if (options?.outputStringIds) {
    outNames = options.outputStringIds.map((id) => sim.arena.interner.resolve(id) ?? "unknown");
  } else if (arena.hiddenVarIndices && arena.hiddenVarIndices.size > 0 && !options?.debug) {
    const keepIndices: number[] = [];
    const filteredNames: string[] = [];
    for (let idx = 0; idx < stateNames.length; idx++) {
      const varIdx = Array.from(sim.stateVars)[idx];
      if (varIdx === undefined || !arena.hiddenVarIndices.has(varIdx)) {
        keepIndices.push(idx);
        filteredNames.push(stateNames[idx]!);
      }
    }
    if (keepIndices.length < stateNames.length) {
      outNames = filteredNames;
      outY = y.map((row) => keepIndices.map((idx) => row[idx]!));
    }
  }

  return {
    t,
    y: outY,
    states: outNames,
    ...(rawResult.terminatedEarly ? { terminatedEarly: true } : {}),
    ...(rawResult.safetyViolations && rawResult.safetyViolations.length > 0
      ? { safetyViolations: rawResult.safetyViolations }
      : {}),
    ...(rawResult.intervalIssues && rawResult.intervalIssues.length > 0
      ? { intervalIssues: rawResult.intervalIssues }
      : {}),
  };
}

/**
 * Async variant of `simulateArena()` with cooperative yielding and abort support.
 */
export async function simulateArenaAsync(
  arena: DAEBuilder,
  options?: ArenaSimulateOptions,
): Promise<ArenaSimulationResult> {
  if (options?.vectorCausalize) {
    expandSetBasedConnectionsArena(arena);
    eliminateVectorArenaAliases(arena);
    causalizeVectorArena(arena);
  }
  if (options?.microModelica) {
    convertArenaToMicroModelica(arena);
  }
  const sim = new ArenaSimulator(arena);
  if (options?.fmuRegistry) {
    sim.fmuRegistry = options.fmuRegistry;
  }
  if (options?.debuggerHook) {
    sim.debuggerHook = options.debuggerHook;
  }
  sim.prepare();
  arena = sim.arena;

  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const numIntervals = options?.numberOfIntervals ?? exp.numberOfIntervals;
  const step =
    options?.step ??
    (numIntervals ? (stopTime - startTime) / numIntervals : (exp.interval ?? (stopTime - startTime) / 500));

  const envSize = Math.max(arena.interner.size + 256, 4096);
  const valuesByStringId = new Float64Array(envSize);

  const timeId = arena.interner.intern("time");
  valuesByStringId[timeId] = startTime;

  // Set parameters from the simulator's resolved parameters and arena start values
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      const name = arena.getVarName(i);
      const nameId = arena.getVarNameId(i);
      const val = sim.parameters.get(name) ?? arena.getVarStartValue(i);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }
  for (const [name, val] of sim.parameters) {
    const nameId = arena.interner.intern(name);
    valuesByStringId[nameId] = val;
  }

  if (options?.parameterOverrides) {
    for (const [name, val] of options.parameterOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
      sim.parameters.set(name, val);
    }
  }

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant || sim.parameterVars.has(i)) continue;

    const nameId = arena.getVarNameId(i);
    const startVal = arena.getVarStartValue(i);
    if (startVal !== 0 || valuesByStringId[nameId] === 0) {
      valuesByStringId[nameId] = startVal;
    }

    const exprId = arena.getVarExpression(i) as number | undefined;
    if (typeof exprId === "number" && exprId !== -1) {
      const val = evaluateArenaExpression(arena, exprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startAttrId = arena.getVarAttrExprId(i, "start");
    if (typeof startAttrId === "number" && startAttrId !== -1) {
      const val = evaluateArenaExpression(arena, startAttrId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
    const startWasmExprId = arena.getVarAttrExpr(i, VarAttrKind.Start);
    if (typeof startWasmExprId === "number" && startWasmExprId > 0) {
      const val = evaluateArenaExpression(arena, startWasmExprId, sim.parameters);
      if (val !== null && typeof val === "number" && isFinite(val)) {
        valuesByStringId[nameId] = val;
      }
    }
  }

  const initResult = solveInitialEquationsArena(arena, valuesByStringId);
  valuesByStringId.set(initResult.valuesByStringId);

  if (options?.initialStateOverrides) {
    for (const [name, val] of options.initialStateOverrides) {
      const nameId = arena.interner.intern(name);
      valuesByStringId[nameId] = val;
    }
  }

  const stateNameIds: number[] = [];
  const derivNameIds: number[] = [];
  const stateNames: string[] = [];

  for (const varIdx of sim.stateVars) {
    const name = arena.getVarName(varIdx);
    const nameId = arena.getVarNameId(varIdx);
    const derName = `der(${name})`;
    const derNameId = arena.interner.intern(derName);

    stateNameIds.push(nameId);
    derivNameIds.push(derNameId);
    stateNames.push(name);
  }

  if (options?.steadyStateOnly) {
    const t = [startTime];
    const initialRow: number[] = [];
    for (const nameId of stateNameIds) {
      initialRow.push(valuesByStringId[nameId] ?? 0);
    }
    let outNames = stateNames;
    let outY = [initialRow];
    if (options?.outputStringIds) {
      outNames = options.outputStringIds.map((id) => sim.arena.interner.resolve(id) ?? "unknown");
      outY = [options.outputStringIds.map((id) => valuesByStringId[id] ?? 0)];
    }
    return { t, y: outY, states: outNames };
  }

  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);

  sim.initializeFmuSubsystems(startTime, stopTime, step);

  if (options?.solver === "webgpu") {
    // ── Phase 5: WebGPU Execution with Fallback ──
    const { serializeArenaForGPU } = await import("./gpu-buffers.js");
    const { WebGPUSimulationRunner } = await import("./webgpu-simulation-runner.js");

    // Create the BLT result shape expected by serializeArenaForGPU
    const bltResult = {
      blocks: sim.blocks,
      sortedEquations: sim.sortedEquations,
    };

    const buffers = serializeArenaForGPU(arena, bltResult, sim.stateVars);
    const varOffsets = buffers.varOffsets ?? arena.getVarOffsets?.();

    // Copy the initialized values into the GPU state buffer using double-single [hi, lo] stride-2 packing
    for (let i = 0; i < arena.varCount; i++) {
      const nameId = arena.getVarNameId(i);
      const val = valuesByStringId[nameId] ?? 0;
      const offset = varOffsets ? (varOffsets[i] ?? i) : i;
      const hi = Math.fround(val);
      const lo = Math.fround(val - hi);
      buffers.stateBuffer[offset * 2] = hi;
      buffers.stateBuffer[offset * 2 + 1] = lo;
    }

    const runner = new WebGPUSimulationRunner(arena, buffers);
    const initialized = await runner.initialize();

    if (initialized) {
      console.log("WebGPU simulation backend initialized successfully.");
      // If tolerances are provided, use the adaptive DOPRI5 orchestrator
      const isAdaptive = options?.atol !== undefined || options?.rtol !== undefined;

      let t: number[];
      let y: number[][];

      if (isAdaptive) {
        const outputTimes: number[] = [];
        for (let s = 0; s <= steps; s++) {
          outputTimes.push(startTime + s * step);
        }

        const stateVarsArr = Array.from(sim.stateVars);
        const y0 = new Float32Array(stateVarsArr.length);
        for (let i = 0; i < stateVarsArr.length; i++) {
          const varIdx = stateVarsArr[i] ?? -1;
          const offset = varIdx !== -1 ? (varOffsets ? (varOffsets[varIdx] ?? varIdx) : varIdx) : -1;
          y0[i] =
            offset !== -1 ? (buffers.stateBuffer[offset * 2] ?? 0) + (buffers.stateBuffer[offset * 2 + 1] ?? 0) : 0;
        }

        const result = await runner.runSimulationAdaptive(startTime, y0, stopTime, outputTimes, {
          atol: options?.atol,
          rtol: options?.rtol,
        });

        t = result.t;
        y = new Array(result.t.length);
        for (let s = 0; s < result.t.length; s++) {
          const row = new Array(stateNames.length);
          for (let j = 0; j < stateNames.length; j++) {
            row[j] = result.y[s]?.[j] ?? 0;
          }
          y[s] = row;
        }
      } else {
        const gpuResultBuffer = await runner.runSimulation(steps, step, startTime);
        t = new Array(steps + 1);
        y = new Array(steps + 1);

        for (let s = 0; s <= steps; s++) {
          t[s] = startTime + s * step;
          const row = new Array(stateNames.length);
          for (let j = 0; j < stateNames.length; j++) {
            const varIdx = Array.from(sim.stateVars)[j] ?? -1;
            const offset = varIdx !== -1 ? (varOffsets ? (varOffsets[varIdx] ?? varIdx) : varIdx) : -1;
            row[j] = offset !== -1 ? (gpuResultBuffer[s * buffers.varCount + offset] ?? 0) : 0;
          }
          y[s] = row;
        }
      }

      sim.terminateFmuSubsystems();
      return { t, y, states: stateNames };
    } else {
      console.warn("WebGPU initialization failed. Falling back to CPU simulation.");
    }
  }

  const defaultSolver = (exp.algorithm as any) ?? "tsit5";
  const chosenSolver =
    options?.solver === "webgpu"
      ? "rk4"
      : options?.solver && options.solver !== "auto"
        ? options.solver
        : defaultSolver;

  const rawResult = await sim.simulateAsync(steps, step, valuesByStringId, stateNameIds, derivNameIds, {
    solver: chosenSolver,
    ...(options?.signal !== undefined && { signal: options.signal }),
    atol: options?.atol ?? exp.tolerance,
    rtol: options?.rtol ?? exp.tolerance,
    ...(options?.outputStringIds !== undefined && { outputStringIds: options.outputStringIds }),
  });

  sim.terminateFmuSubsystems();

  const t = rawResult.t;
  const y: number[][] = rawResult.y.map((row) => Array.from(row as ArrayLike<number>));

  let outNames = stateNames;
  let outY = y;
  if (options?.outputStringIds) {
    outNames = options.outputStringIds.map((id) => sim.arena.interner.resolve(id) ?? "unknown");
  } else if (arena.hiddenVarIndices && arena.hiddenVarIndices.size > 0 && !options?.debug) {
    const keepIndices: number[] = [];
    const filteredNames: string[] = [];
    for (let idx = 0; idx < stateNames.length; idx++) {
      const varIdx = Array.from(sim.stateVars)[idx];
      if (varIdx === undefined || !arena.hiddenVarIndices.has(varIdx)) {
        keepIndices.push(idx);
        filteredNames.push(stateNames[idx]!);
      }
    }
    if (keepIndices.length < stateNames.length) {
      outNames = filteredNames;
      outY = y.map((row) => keepIndices.map((idx) => row[idx]!));
    }
  }
  return { t, y: outY, states: outNames };
}
