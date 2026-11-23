// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChunkedInt32Array, createChunkedInt32Array, atomicChunkAlloc, atomicChunkFree } from "../core/array";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";
import { ArenaStringPool } from "../core/string_pool";

// Re-export all types and constants from the canonical source-of-truth module.
// Consumers can import from either "./dae" or "./dae_types" — both work.
export {
  // SoA Layout Constants
  VAR_STRIDE, VAR_NAME, VAR_TYPE, VAR_VARIABILITY, VAR_CAUSALITY,
  VAR_START_HI, VAR_START_LO, VAR_SHAPE_DIM, VAR_FLAGS,
  FLAG_TEARING_VAR, FLAG_VAR_FLOW, FLAG_VAR_STREAM,
  FLAG_VAR_STATE, FLAG_VAR_STATE_DER, FLAG_VAR_FIXED, FLAG_VAR_REMOVED,
  FLAG_VAR_PROTECTED, FLAG_VAR_FINAL, FLAG_VAR_VIRTUAL, FLAG_VAR_EVALUATE,
  FLAG_VAR_HIDDEN, FLAG_VAR_BINARY,
  FLAG_EQ_INITIAL, FLAG_EQ_OVERCONSTRAINED, FLAG_EQ_STREAM_CONNECT, FLAG_HIGH_INDEX_EQ,
  FLAG_EQ_REMOVED, FLAG_EQ_BOUNDARY,
  PROBLEM_ODE, PROBLEM_DAE, PROBLEM_OPTIMIZATION, PROBLEM_SDE, PROBLEM_DDE,
  PROBLEM_BVP, PROBLEM_JUMP, PROBLEM_UNCERTAIN, PROBLEM_REACHABILITY, PROBLEM_HYBRID,
  EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS, EQ_AUX,
  EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT,
  STMT_STRIDE, STMT_KIND, STMT_DATA1, STMT_LEFT, STMT_RIGHT,
  VAR_ATTR_STRIDE, CLOCK_STRIDE, WHEN_STRIDE, FOR_STRIDE, IF_STRIDE,
  SM_STRIDE, STATE_STRIDE, TRANSITION_STRIDE,
  FLAG_TRANSITION_IMMEDIATE, FLAG_TRANSITION_RESET, FLAG_TRANSITION_SYNCHRONIZE,
  OBJ_STRIDE, OBJ_MAYER_EXPR, OBJ_LAGRANGE_EXPR, OBJ_SENSE, OBJ_FLAGS,
  FLAG_OBJ_MAYER, FLAG_OBJ_LAGRANGE,
  CON_STRIDE, CON_EXPR, CON_LB_HI, CON_LB_LO, CON_UB_HI, CON_UB_LO, CON_KIND_FLAGS,
  CONE_STRIDE, CONE_KIND, CONE_MEMBER_START, CONE_MEMBER_COUNT, CONE_DIM,
  DIFF_STRIDE, DIFF_STATE_VAR, DIFF_NOISE_CH, DIFF_EXPR, DIFF_FLAGS,
  DELAY_STRIDE, DELAY_TARGET_EXPR, DELAY_TAU_EXPR, DELAY_HISTORY_EXPR, DELAY_HISTORY_DERIV_EXPR, DELAY_FLAGS,
  FLAG_DELAY_CONSTANT, FLAG_DELAY_TIME_DEP, FLAG_DELAY_STATE_DEP, FLAG_DELAY_NEUTRAL,
  JUMP_STRIDE, JUMP_PROPENSITY_EXPR, JUMP_AFFECT_START, JUMP_AFFECT_COUNT, JUMP_FLAGS,
  AFFECT_STRIDE, AFFECT_VAR, AFFECT_EXPR, AFFECT_MODE,
  UNC_STRIDE, UNC_VAR, UNC_DIST_KIND, UNC_P1_HI, UNC_P1_LO, UNC_P2_HI, UNC_P2_LO,
  STL_STRIDE, STL_OP, STL_LEFT, STL_RIGHT, STL_TLO_HI, STL_TLO_LO, STL_THI_HI, STL_THI_LO, STL_FLAGS,
  INV_STRIDE, INV_STATE, INV_VAR, INV_LO_HI, INV_LO_LO, INV_HI_HI, INV_HI_LO,
  NULL_ID,
  // Enums
  VarType, Variability, Causality,
  EqKind, ExprKind, BinOp, UnaryOp, StmtKind, VarAttrKind, BuiltinMathFunc,
  ObjectiveSense, ConstraintKind, SdeNoiseType, SdeCalculus, BvpMethod,
  JumpRateKind, JumpAffectMode, UncertaintyDistKind, StlOp,
} from "./types";

// Local imports for use within this file
import {
  VAR_STRIDE, VAR_NAME, VAR_TYPE, VAR_VARIABILITY, VAR_CAUSALITY,
  VAR_START_HI, VAR_START_LO, VAR_SHAPE_DIM, VAR_FLAGS,
  FLAG_TEARING_VAR, FLAG_VAR_FLOW, FLAG_VAR_STREAM, FLAG_VAR_FIXED, FLAG_VAR_REMOVED, FLAG_VAR_VIRTUAL,
  FLAG_EQ_INITIAL, FLAG_EQ_REMOVED, FLAG_EQ_BOUNDARY,
  PROBLEM_ODE, PROBLEM_DAE, PROBLEM_OPTIMIZATION, PROBLEM_SDE, PROBLEM_DDE,
  PROBLEM_BVP, PROBLEM_JUMP, PROBLEM_UNCERTAIN, PROBLEM_REACHABILITY, PROBLEM_HYBRID,
  EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS, EQ_AUX,
  EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT,
  STMT_STRIDE, STMT_KIND, STMT_DATA1, STMT_LEFT, STMT_RIGHT,
  VAR_ATTR_STRIDE, CLOCK_STRIDE, WHEN_STRIDE, FOR_STRIDE, IF_STRIDE,
  SM_STRIDE, STATE_STRIDE, TRANSITION_STRIDE,
  OBJ_STRIDE, OBJ_MAYER_EXPR, OBJ_LAGRANGE_EXPR, OBJ_SENSE, OBJ_FLAGS,
  FLAG_OBJ_MAYER, FLAG_OBJ_LAGRANGE,
  CON_STRIDE, CON_EXPR, CON_LB_HI, CON_LB_LO, CON_UB_HI, CON_UB_LO, CON_KIND_FLAGS,
  CONE_STRIDE, CONE_KIND, CONE_MEMBER_START, CONE_MEMBER_COUNT, CONE_DIM,
  DIFF_STRIDE, DIFF_STATE_VAR, DIFF_NOISE_CH, DIFF_EXPR, DIFF_FLAGS,
  DELAY_STRIDE, DELAY_TARGET_EXPR, DELAY_TAU_EXPR, DELAY_HISTORY_EXPR, DELAY_HISTORY_DERIV_EXPR, DELAY_FLAGS,
  JUMP_STRIDE, JUMP_PROPENSITY_EXPR, JUMP_AFFECT_START, JUMP_AFFECT_COUNT, JUMP_FLAGS,
  AFFECT_STRIDE, AFFECT_VAR, AFFECT_EXPR, AFFECT_MODE,
  UNC_STRIDE, UNC_VAR, UNC_DIST_KIND, UNC_P1_HI, UNC_P1_LO, UNC_P2_HI, UNC_P2_LO,
  STL_STRIDE, STL_OP, STL_LEFT, STL_RIGHT, STL_TLO_HI, STL_TLO_LO, STL_THI_HI, STL_THI_LO, STL_FLAGS,
  INV_STRIDE, INV_STATE, INV_VAR, INV_LO_HI, INV_LO_LO, INV_HI_HI, INV_HI_LO,
  NULL_ID,
  ExprKind, EqKind, VarType, Variability, ObjectiveSense,
} from "./types";

// Re-export accessor types for convenient access
export { VarAccessor, ExprAccessor, EqAccessor, StmtAccessor } from "./accessors";

/**
 * Struct-of-Arrays (SoA) Builder for flat Differential Algebraic Equations (DAE).
 * Enables zero-GC memory efficiency when constructing and solving large systems of equations.
 */
@unmanaged
export class DaeBuilder {
  // Core SoA
  varData: ChunkedInt32Array;
  varCount: u32;

  eqData: ChunkedInt32Array;
  eqCount: u32;

  exprData: ChunkedInt32Array;
  exprCount: u32;

  stmtData: ChunkedInt32Array;
  stmtCount: u32;

  // Secondary Indices & Maps
  nameIndex: UnmanagedMap64;
  aliasData: ChunkedInt32Array;
  stringPool: ArenaStringPool;

  // Attributes & Shapes
  varAttrData: ChunkedInt32Array;
  varShapes: ChunkedInt32Array;
  varSymbolicShapes: ChunkedInt32Array;

  // Clocks (§16)
  clocksData: ChunkedInt32Array;
  clockCount: u32;
  varClockMap: ChunkedInt32Array;
  eqClockMap: ChunkedInt32Array;

  // Compound Equation Side-Tables
  whenMeta: ChunkedInt32Array;
  whenCount: u32;
  whenBodyEqs: ChunkedInt32Array;
  whenBodyEqCount: u32;

  forMeta: ChunkedInt32Array;
  forCount: u32;
  forBodyEqs: ChunkedInt32Array;
  forBodyEqCount: u32;

  ifMeta: ChunkedInt32Array;
  ifCount: u32;
  ifBranchEqs: ChunkedInt32Array;
  ifBranchEqCount: u32;

  // State Machines (§17)
  stateMachines: ChunkedInt32Array;
  smCount: u32;
  stateData: ChunkedInt32Array;
  stateCount: u32;
  stateEqs: ChunkedInt32Array;
  stateEqCount: u32;
  stateVars: ChunkedInt32Array;
  stateVarCount: u32;
  transitions: ChunkedInt32Array;
  transitionCount: u32;

  // Event Indicators & Optimization
  eventIndicators: ChunkedInt32Array;
  eventIndicatorCount: u32;
  objectiveExprId: u32;
  objectiveIntegrandExprId: u32;
  startTimeExprId: u32;
  finalTimeExprId: u32;

  // Problem Class Bitmask
  problemFlags: u32;

  // 1. Multi-Objective & Constraint Optimization Side-Tables (Lazy)
  objectivesData: ChunkedInt32Array;
  objectiveCount: u32;
  constraintsData: ChunkedInt32Array;
  constraintCount: u32;
  coneData: ChunkedInt32Array;
  coneCount: u32;
  coneMembers: ChunkedInt32Array;
  coneMemberCount: u32;

  // 2. Stochastic Differential Equation (SDE) Side-Table (Lazy)
  diffusionData: ChunkedInt32Array;
  diffusionCount: u32;
  sdeNoiseType: i32;
  sdeCalculus: i32;
  sdeBrownianDim: u32;
  sdeSeed: u32;
  sdeEnsemblePaths: u32;

  // 3. Boundary Value Problem (BVP) Config & Boundary Points (Lazy)
  bvpMethod: i32;
  bvpIntervals: u32;
  bvpBoundaryPoints: ChunkedInt32Array;
  bvpBoundaryPointCount: u32;

  // 4. Delay Differential Equation (DDE / NDDE) Side-Table (Lazy)
  delayData: ChunkedInt32Array;
  delayCount: u32;

  // 5. Jump Process / Hybrid Kinetics (SSA) Side-Tables (Lazy)
  jumpData: ChunkedInt32Array;
  jumpCount: u32;
  jumpAffects: ChunkedInt32Array;
  jumpAffectCount: u32;

  // 6. Uncertainty, Reachability & STL Verification Side-Tables (Lazy)
  uncertaintyData: ChunkedInt32Array;
  uncertaintyCount: u32;
  stlData: ChunkedInt32Array;
  stlCount: u32;
  stateInvariants: ChunkedInt32Array;
  stateInvariantCount: u32;

  // Snapshots
  snapshotVarCount: u32;
  snapshotEqCount: u32;
  snapshotExprCount: u32;
  snapshotStmtCount: u32;
  snapshotClockCount: u32;
  snapshotWhenCount: u32;
  snapshotWhenBodyEqCount: u32;
  snapshotForCount: u32;
  snapshotForBodyEqCount: u32;
  snapshotIfCount: u32;
  snapshotIfBranchEqCount: u32;
  snapshotSmCount: u32;
  snapshotStateCount: u32;
  snapshotStateEqCount: u32;
  snapshotStateVarCount: u32;
  snapshotTransitionCount: u32;
  snapshotEventIndicatorCount: u32;
  snapshotProblemFlags: u32;
  snapshotObjectiveCount: u32;
  snapshotConstraintCount: u32;
  snapshotConeCount: u32;
  snapshotConeMemberCount: u32;
  snapshotDiffusionCount: u32;
  snapshotBvpBoundaryPointCount: u32;
  snapshotDelayCount: u32;
  snapshotJumpCount: u32;
  snapshotJumpAffectCount: u32;
  snapshotUncertaintyCount: u32;
  snapshotStlCount: u32;
  snapshotStateInvariantCount: u32;

  // Method Accessors for backwards compatibility
  @inline getVarData(): ChunkedInt32Array { return this.varData; }
  @inline getEqData(): ChunkedInt32Array { return this.eqData; }
  @inline getExprData(): ChunkedInt32Array { return this.exprData; }
  @inline getStmtData(): ChunkedInt32Array { return this.stmtData; }
  @inline getNameIndex(): UnmanagedMap64 { return this.nameIndex; }
  @inline getAliasData(): ChunkedInt32Array { return this.aliasData; }
  @inline getStringPool(): ArenaStringPool { return this.stringPool; }
  @inline getVarAttrData(): ChunkedInt32Array { return this.varAttrData; }
  @inline getVarShapes(): ChunkedInt32Array { return this.varShapes; }
  @inline getVarSymbolicShapes(): ChunkedInt32Array { return this.varSymbolicShapes; }
  @inline getClocksData(): ChunkedInt32Array {
    if (changetype<usize>(this.clocksData) == 0) this.clocksData = createChunkedInt32Array(32 * CLOCK_STRIDE);
    return this.clocksData;
  }
  @inline getVarClockMap(): ChunkedInt32Array { return this.varClockMap; }
  @inline getEqClockMap(): ChunkedInt32Array { return this.eqClockMap; }
  @inline getWhenMeta(): ChunkedInt32Array {
    if (changetype<usize>(this.whenMeta) == 0) this.whenMeta = createChunkedInt32Array(128 * WHEN_STRIDE);
    return this.whenMeta;
  }
  @inline getWhenBodyEqs(): ChunkedInt32Array {
    if (changetype<usize>(this.whenBodyEqs) == 0) this.whenBodyEqs = createChunkedInt32Array(256 * EQ_STRIDE);
    return this.whenBodyEqs;
  }
  @inline getForMeta(): ChunkedInt32Array {
    if (changetype<usize>(this.forMeta) == 0) this.forMeta = createChunkedInt32Array(128 * FOR_STRIDE);
    return this.forMeta;
  }
  @inline getForBodyEqs(): ChunkedInt32Array {
    if (changetype<usize>(this.forBodyEqs) == 0) this.forBodyEqs = createChunkedInt32Array(256 * EQ_STRIDE);
    return this.forBodyEqs;
  }
  @inline getIfMeta(): ChunkedInt32Array {
    if (changetype<usize>(this.ifMeta) == 0) this.ifMeta = createChunkedInt32Array(128 * IF_STRIDE);
    return this.ifMeta;
  }
  @inline getIfBranchEqs(): ChunkedInt32Array {
    if (changetype<usize>(this.ifBranchEqs) == 0) this.ifBranchEqs = createChunkedInt32Array(256 * EQ_STRIDE);
    return this.ifBranchEqs;
  }
  @inline getStateMachines(): ChunkedInt32Array {
    if (changetype<usize>(this.stateMachines) == 0) this.stateMachines = createChunkedInt32Array(16 * SM_STRIDE);
    return this.stateMachines;
  }
  @inline getStateData(): ChunkedInt32Array {
    if (changetype<usize>(this.stateData) == 0) this.stateData = createChunkedInt32Array(64 * STATE_STRIDE);
    return this.stateData;
  }
  @inline getStateEqs(): ChunkedInt32Array {
    if (changetype<usize>(this.stateEqs) == 0) this.stateEqs = createChunkedInt32Array(128 * 4);
    return this.stateEqs;
  }
  @inline getStateVars(): ChunkedInt32Array {
    if (changetype<usize>(this.stateVars) == 0) this.stateVars = createChunkedInt32Array(128 * 4);
    return this.stateVars;
  }
  @inline getTransitions(): ChunkedInt32Array {
    if (changetype<usize>(this.transitions) == 0) this.transitions = createChunkedInt32Array(64 * TRANSITION_STRIDE);
    return this.transitions;
  }
  @inline getEventIndicators(): ChunkedInt32Array {
    if (changetype<usize>(this.eventIndicators) == 0) this.eventIndicators = createChunkedInt32Array(128);
    return this.eventIndicators;
  }
  @inline getObjectivesData(): ChunkedInt32Array {
    if (changetype<usize>(this.objectivesData) == 0) this.objectivesData = createChunkedInt32Array(16 * OBJ_STRIDE);
    return this.objectivesData;
  }
  @inline getConstraintsData(): ChunkedInt32Array {
    if (changetype<usize>(this.constraintsData) == 0) this.constraintsData = createChunkedInt32Array(128 * CON_STRIDE);
    return this.constraintsData;
  }
  @inline getConeData(): ChunkedInt32Array {
    if (changetype<usize>(this.coneData) == 0) this.coneData = createChunkedInt32Array(32 * CONE_STRIDE);
    return this.coneData;
  }
  @inline getConeMembers(): ChunkedInt32Array {
    if (changetype<usize>(this.coneMembers) == 0) this.coneMembers = createChunkedInt32Array(128);
    return this.coneMembers;
  }
  @inline getDiffusionData(): ChunkedInt32Array {
    if (changetype<usize>(this.diffusionData) == 0) this.diffusionData = createChunkedInt32Array(64 * DIFF_STRIDE);
    return this.diffusionData;
  }
  @inline getBvpBoundaryPoints(): ChunkedInt32Array {
    if (changetype<usize>(this.bvpBoundaryPoints) == 0) this.bvpBoundaryPoints = createChunkedInt32Array(16);
    return this.bvpBoundaryPoints;
  }
  @inline getDelayData(): ChunkedInt32Array {
    if (changetype<usize>(this.delayData) == 0) this.delayData = createChunkedInt32Array(32 * DELAY_STRIDE);
    return this.delayData;
  }
  @inline getJumpData(): ChunkedInt32Array {
    if (changetype<usize>(this.jumpData) == 0) this.jumpData = createChunkedInt32Array(64 * JUMP_STRIDE);
    return this.jumpData;
  }
  @inline getJumpAffects(): ChunkedInt32Array {
    if (changetype<usize>(this.jumpAffects) == 0) this.jumpAffects = createChunkedInt32Array(128 * AFFECT_STRIDE);
    return this.jumpAffects;
  }
  @inline getUncertaintyData(): ChunkedInt32Array {
    if (changetype<usize>(this.uncertaintyData) == 0) this.uncertaintyData = createChunkedInt32Array(64 * UNC_STRIDE);
    return this.uncertaintyData;
  }
  @inline getStlData(): ChunkedInt32Array {
    if (changetype<usize>(this.stlData) == 0) this.stlData = createChunkedInt32Array(64 * STL_STRIDE);
    return this.stlData;
  }
  @inline getStateInvariants(): ChunkedInt32Array {
    if (changetype<usize>(this.stateInvariants) == 0) this.stateInvariants = createChunkedInt32Array(64 * INV_STRIDE);
    return this.stateInvariants;
  }

  /**
   * Initializes chunked memory arrays and hash structures.
   */
  init(): void {
    this.varData = createChunkedInt32Array(512 * VAR_STRIDE);
    this.varCount = 0;

    this.eqData = createChunkedInt32Array(1024 * EQ_STRIDE);
    this.eqCount = 0;

    this.exprData = createChunkedInt32Array(4096 * EXPR_STRIDE);
    this.exprCount = 0;

    this.stmtData = createChunkedInt32Array(256 * STMT_STRIDE);
    this.stmtCount = 0;

    this.nameIndex = changetype<UnmanagedMap64>(createMap64());
    this.nameIndex.init(512);
    this.aliasData = createChunkedInt32Array(512);

    let spPtr = atomicChunkAlloc(offsetof<ArenaStringPool>() as u32);
    this.stringPool = changetype<ArenaStringPool>(spPtr);
    this.stringPool.init();

    this.varAttrData = createChunkedInt32Array(512 * VAR_ATTR_STRIDE);
    this.varShapes = createChunkedInt32Array(512 * 4);
    this.varSymbolicShapes = createChunkedInt32Array(512 * 4);

    // Optional side-tables are lazily allocated on first use in their `get*()` accessors
    this.clocksData = changetype<ChunkedInt32Array>(0);
    this.clockCount = 0;
    this.varClockMap = createChunkedInt32Array(512);
    this.eqClockMap = createChunkedInt32Array(1024);

    this.whenMeta = changetype<ChunkedInt32Array>(0);
    this.whenCount = 0;
    this.whenBodyEqs = changetype<ChunkedInt32Array>(0);
    this.whenBodyEqCount = 0;

    this.forMeta = changetype<ChunkedInt32Array>(0);
    this.forCount = 0;
    this.forBodyEqs = changetype<ChunkedInt32Array>(0);
    this.forBodyEqCount = 0;

    this.ifMeta = changetype<ChunkedInt32Array>(0);
    this.ifCount = 0;
    this.ifBranchEqs = changetype<ChunkedInt32Array>(0);
    this.ifBranchEqCount = 0;

    this.stateMachines = changetype<ChunkedInt32Array>(0);
    this.smCount = 0;
    this.stateData = changetype<ChunkedInt32Array>(0);
    this.stateCount = 0;
    this.stateEqs = changetype<ChunkedInt32Array>(0);
    this.stateEqCount = 0;
    this.stateVars = changetype<ChunkedInt32Array>(0);
    this.stateVarCount = 0;
    this.transitions = changetype<ChunkedInt32Array>(0);
    this.transitionCount = 0;

    this.eventIndicators = changetype<ChunkedInt32Array>(0);
    this.eventIndicatorCount = 0;
    this.objectiveExprId = 0xffffffff;
    this.objectiveIntegrandExprId = 0xffffffff;
    this.startTimeExprId = 0xffffffff;
    this.finalTimeExprId = 0xffffffff;

    this.problemFlags = 0;

    // Lazy multi-problem side-tables (zero memory cost when unused)
    this.objectivesData = changetype<ChunkedInt32Array>(0);
    this.objectiveCount = 0;
    this.constraintsData = changetype<ChunkedInt32Array>(0);
    this.constraintCount = 0;
    this.coneData = changetype<ChunkedInt32Array>(0);
    this.coneCount = 0;
    this.coneMembers = changetype<ChunkedInt32Array>(0);
    this.coneMemberCount = 0;

    this.diffusionData = changetype<ChunkedInt32Array>(0);
    this.diffusionCount = 0;
    this.sdeNoiseType = 0;
    this.sdeCalculus = 0;
    this.sdeBrownianDim = 0;
    this.sdeSeed = 0;
    this.sdeEnsemblePaths = 1;

    this.bvpMethod = 0;
    this.bvpIntervals = 20;
    this.bvpBoundaryPoints = changetype<ChunkedInt32Array>(0);
    this.bvpBoundaryPointCount = 0;

    this.delayData = changetype<ChunkedInt32Array>(0);
    this.delayCount = 0;

    this.jumpData = changetype<ChunkedInt32Array>(0);
    this.jumpCount = 0;
    this.jumpAffects = changetype<ChunkedInt32Array>(0);
    this.jumpAffectCount = 0;

    this.uncertaintyData = changetype<ChunkedInt32Array>(0);
    this.uncertaintyCount = 0;
    this.stlData = changetype<ChunkedInt32Array>(0);
    this.stlCount = 0;
    this.stateInvariants = changetype<ChunkedInt32Array>(0);
    this.stateInvariantCount = 0;

    this.snapshotVarCount = 0;
    this.snapshotEqCount = 0;
    this.snapshotExprCount = 0;
    this.snapshotStmtCount = 0;
    this.snapshotClockCount = 0;
    this.snapshotWhenCount = 0;
    this.snapshotWhenBodyEqCount = 0;
    this.snapshotForCount = 0;
    this.snapshotForBodyEqCount = 0;
    this.snapshotIfCount = 0;
    this.snapshotIfBranchEqCount = 0;
    this.snapshotSmCount = 0;
    this.snapshotStateCount = 0;
    this.snapshotStateEqCount = 0;
    this.snapshotStateVarCount = 0;
    this.snapshotTransitionCount = 0;
    this.snapshotEventIndicatorCount = 0;
    this.snapshotProblemFlags = 0;
    this.snapshotObjectiveCount = 0;
    this.snapshotConstraintCount = 0;
    this.snapshotConeCount = 0;
    this.snapshotConeMemberCount = 0;
    this.snapshotDiffusionCount = 0;
    this.snapshotBvpBoundaryPointCount = 0;
    this.snapshotDelayCount = 0;
    this.snapshotJumpCount = 0;
    this.snapshotJumpAffectCount = 0;
    this.snapshotUncertaintyCount = 0;
    this.snapshotStlCount = 0;
    this.snapshotStateInvariantCount = 0;
  }

  /**
   * Resets all equation, variable, expression, and metadata counters.
   */
  reset(): void {
    this.varCount = 0;
    this.eqCount = 0;
    this.exprCount = 0;
    this.stmtCount = 0;
    this.clockCount = 0;
    this.whenCount = 0;
    this.whenBodyEqCount = 0;
    this.forCount = 0;
    this.forBodyEqCount = 0;
    this.ifCount = 0;
    this.ifBranchEqCount = 0;
    this.smCount = 0;
    this.stateCount = 0;
    this.stateEqCount = 0;
    this.stateVarCount = 0;
    this.transitionCount = 0;
    this.eventIndicatorCount = 0;
    this.objectiveExprId = 0xffffffff;
    this.objectiveIntegrandExprId = 0xffffffff;
    this.startTimeExprId = 0xffffffff;
    this.finalTimeExprId = 0xffffffff;
    this.problemFlags = 0;
    this.objectiveCount = 0;
    this.constraintCount = 0;
    this.coneCount = 0;
    this.coneMemberCount = 0;
    this.diffusionCount = 0;
    this.bvpBoundaryPointCount = 0;
    this.delayCount = 0;
    this.jumpCount = 0;
    this.jumpAffectCount = 0;
    this.uncertaintyCount = 0;
    this.stlCount = 0;
    this.stateInvariantCount = 0;
    if (changetype<usize>(this.nameIndex) != 0) {
      this.getNameIndex().clear();
    }
    if (changetype<usize>(this.stringPool) != 0) {
      this.stringPool.reset();
    }
  }

  /**
   * Releases all unmanaged chunked arrays, hash tables, and string pool buffers.
   */
  dispose(): void {
    let freeChunked = (arr: ChunkedInt32Array): void => {
      let ptr = changetype<usize>(arr);
      if (ptr != 0) {
        arr.dispose();
        atomicChunkFree(ptr);
      }
    };
    freeChunked(this.varData);
    freeChunked(this.eqData);
    freeChunked(this.exprData);
    freeChunked(this.stmtData);
    freeChunked(this.aliasData);
    freeChunked(this.varAttrData);
    freeChunked(this.varShapes);
    freeChunked(this.varSymbolicShapes);
    freeChunked(this.clocksData);
    freeChunked(this.varClockMap);
    freeChunked(this.eqClockMap);
    freeChunked(this.whenMeta);
    freeChunked(this.whenBodyEqs);
    freeChunked(this.forMeta);
    freeChunked(this.forBodyEqs);
    freeChunked(this.ifMeta);
    freeChunked(this.ifBranchEqs);
    freeChunked(this.stateMachines);
    freeChunked(this.stateData);
    freeChunked(this.stateEqs);
    freeChunked(this.stateVars);
    freeChunked(this.transitions);
    freeChunked(this.eventIndicators);
    freeChunked(this.objectivesData);
    freeChunked(this.constraintsData);
    freeChunked(this.coneData);
    freeChunked(this.coneMembers);
    freeChunked(this.diffusionData);
    freeChunked(this.bvpBoundaryPoints);
    freeChunked(this.delayData);
    freeChunked(this.jumpData);
    freeChunked(this.jumpAffects);
    freeChunked(this.uncertaintyData);
    freeChunked(this.stlData);
    freeChunked(this.stateInvariants);

    if (changetype<usize>(this.nameIndex) != 0) {
      this.nameIndex.release();
    }
    let spPtr = changetype<usize>(this.stringPool);
    if (spPtr != 0) {
      this.stringPool.dispose();
      atomicChunkFree(spPtr);
      this.stringPool = changetype<ArenaStringPool>(0);
    }
  }

  /**
   * Registers a variable declaration in the DAE system and populates the secondary name index.
   */
  addVariable(
    nameId: u32,
    type: i32,
    variability: i32,
    causality: i32,
    startValue: f64,
    flags: i32 = 0
  ): u32 {
    let idx = this.varCount++;
    let offset = idx * VAR_STRIDE;

    let startBits = i64.reinterpret_f64(startValue) as u64;
    let startHi = (startBits >> 32) as i32;
    let startLo = (startBits & 0xffffffff) as i32;

    this.getVarData().set(offset + VAR_NAME, nameId as i32);
    this.getVarData().set(offset + VAR_TYPE, type);
    this.getVarData().set(offset + VAR_VARIABILITY, variability);
    this.getVarData().set(offset + VAR_CAUSALITY, causality);
    this.getVarData().set(offset + VAR_START_HI, startHi);
    this.getVarData().set(offset + VAR_START_LO, startLo);
    this.getVarData().set(offset + VAR_SHAPE_DIM, 0);
    this.getVarData().set(offset + VAR_FLAGS, flags);

    // Clear shape dimensions to prevent stale data leakage across reset() calls
    let shapeBase = idx * 4;
    this.getVarShapes().set(shapeBase, 0);
    this.getVarShapes().set(shapeBase + 1, 0);
    this.getVarShapes().set(shapeBase + 2, 0);
    this.getVarShapes().set(shapeBase + 3, 0);

    // Default alias is self (or -1)
    this.getAliasData().set(idx, -1);
    this.getVarClockMap().set(idx, 0);

    // Attribute slot zero-initialization
    let attrOffset = idx * VAR_ATTR_STRIDE;
    for (let a: u32 = 0; a < VAR_ATTR_STRIDE; a++) {
      this.getVarAttrData().set(attrOffset + a, 0xffffffff);
    }

    // Populate O(1) name index
    if (nameId != 0 && changetype<usize>(this.nameIndex) != 0) {
      this.getNameIndex().set(nameId as u64, (idx + 1) as u32);
    }

    return idx;
  }

  /**
   * O(1) Variable Lookup by interned Name StringId.
   * Returns variable index or -1 if not found.
   */
  lookupVariableByName(nameId: u32): i32 {
    if (nameId == 0 || changetype<usize>(this.nameIndex) == 0) return -1;
    let val = this.getNameIndex().get(nameId as u64);
    return val > 0 ? ((val - 1) as i32) : -1;
  }

  /**
   * Registers an alias relationship (e.g. `varIdx` is an alias for `targetNameId`).
   */
  addAlias(varIdx: u32, targetNameId: u32): void {
    if (varIdx >= this.varCount) return;
    this.getAliasData().set(varIdx, targetNameId as i32);
  }

  /**
   * Gets the alias target Name StringId for a variable, with path compression.
   */
  getAlias(varIdx: u32): u32 {
    if (varIdx >= this.varCount) return 0;
    let target = this.getAliasData().get(varIdx);
    return target >= 0 ? (target as u32) : (this.getVarData().get(varIdx * VAR_STRIDE + VAR_NAME) as u32);
  }

  /**
   * Sets an attribute expression (e.g. min, max, unit, start, fixed) for a variable.
   */
  setVarAttrExpr(varIdx: u32, attrKind: u32, exprId: u32): void {
    if (varIdx >= this.varCount || attrKind >= VAR_ATTR_STRIDE) return;
    this.getVarAttrData().set(varIdx * VAR_ATTR_STRIDE + attrKind, exprId as i32);
  }

  /**
   * Gets an attribute expression for a variable.
   */
  getVarAttrExpr(varIdx: u32, attrKind: u32): u32 {
    if (varIdx >= this.varCount || attrKind >= VAR_ATTR_STRIDE) return 0xffffffff;
    return this.getVarAttrData().get(varIdx * VAR_ATTR_STRIDE + attrKind) as u32;
  }

  /**
   * Sets concrete shape dimension for a variable.
   */
  setVarShapeDim(varIdx: u32, dimIdx: u32, size: i32): void {
    if (varIdx >= this.varCount || dimIdx >= 4) return;
    this.getVarShapes().set(varIdx * 4 + dimIdx, size);
    let currDim = this.getVarData().get(varIdx * VAR_STRIDE + VAR_SHAPE_DIM);
    if ((dimIdx + 1) > (currDim as u32)) {
      this.getVarData().set(varIdx * VAR_STRIDE + VAR_SHAPE_DIM, (dimIdx + 1) as i32);
    }
  }

  /**
   * Gets concrete shape dimension for a variable.
   */
  getVarShapeDim(varIdx: u32, dimIdx: u32): i32 {
    if (varIdx >= this.varCount || dimIdx >= 4) return 0;
    return this.getVarShapes().get(varIdx * 4 + dimIdx);
  }

  /**
   * Sets symbolic shape dimension expression for a variable.
   */
  setVarSymbolicShapeExpr(varIdx: u32, dimIdx: u32, exprId: u32): void {
    if (varIdx >= this.varCount || dimIdx >= 4) return;
    this.getVarSymbolicShapes().set(varIdx * 4 + dimIdx, exprId as i32);
  }

  /**
   * Gets symbolic shape dimension expression for a variable.
   */
  getVarSymbolicShapeExpr(varIdx: u32, dimIdx: u32): u32 {
    if (varIdx >= this.varCount || dimIdx >= 4) return 0xffffffff;
    return this.getVarSymbolicShapes().get(varIdx * 4 + dimIdx) as u32;
  }

  /**
   * Registers a discrete clock domain (Modelica 3.7 §16).
   */
  addClock(intervalExprId: u32, resolutionExprId: u32 = 0xffffffff, shiftExprId: u32 = 0xffffffff): u32 {
    let id = ++this.clockCount;
    let offset = (id - 1) * CLOCK_STRIDE;
    this.getClocksData().set(offset + 0, intervalExprId as i32);
    this.getClocksData().set(offset + 1, resolutionExprId as i32);
    this.getClocksData().set(offset + 2, shiftExprId as i32);
    this.getClocksData().set(offset + 3, 0);
    return id;
  }

  setVarClock(varIdx: u32, clockId: u32): void {
    if (varIdx >= this.varCount) return;
    this.getVarClockMap().set(varIdx, clockId as i32);
  }

  getVarClock(varIdx: u32): u32 {
    if (varIdx >= this.varCount) return 0;
    return this.getVarClockMap().get(varIdx) as u32;
  }

  setEqClock(eqIdx: u32, clockId: u32): void {
    if (eqIdx >= this.eqCount) return;
    this.getEqClockMap().set(eqIdx, clockId as i32);
  }

  getEqClock(eqIdx: u32): u32 {
    if (eqIdx >= this.eqCount) return 0;
    return this.getEqClockMap().get(eqIdx) as u32;
  }

  /**
   * Adds a compound when-equation block (keeps body out of root BLT count).
   */
  addWhenEquation(conditionExprId: u32): u32 {
    let idx = this.whenCount++;
    let offset = idx * WHEN_STRIDE;
    this.getWhenMeta().set(offset + 0, conditionExprId as i32);
    this.getWhenMeta().set(offset + 1, this.whenBodyEqCount as i32); // bodyOffset
    this.getWhenMeta().set(offset + 2, 0); // bodyCount
    this.getWhenMeta().set(offset + 3, 0xffffffff); // elseWhenOffset
    return idx;
  }

  addWhenBodyEquation(whenIdx: u32, kind: i32, lhsId: u32, rhsId: u32): u32 {
    if (whenIdx >= this.whenCount) return 0;
    let bIdx = this.whenBodyEqCount++;
    let offset = bIdx * EQ_STRIDE;
    this.getWhenBodyEqs().set(offset + EQ_KIND, kind);
    this.getWhenBodyEqs().set(offset + EQ_LHS, lhsId as i32);
    this.getWhenBodyEqs().set(offset + EQ_RHS, rhsId as i32);
    this.getWhenBodyEqs().set(offset + EQ_AUX, 0);

    let mOffset = whenIdx * WHEN_STRIDE;
    let currCount = this.getWhenMeta().get(mOffset + 2);
    this.getWhenMeta().set(mOffset + 2, currCount + 1);
    return bIdx;
  }

  /**
   * Adds a compound for-equation block.
   */
  addForEquation(indexNameId: u32, rangeExprId: u32): u32 {
    let idx = this.forCount++;
    let offset = idx * FOR_STRIDE;
    this.getForMeta().set(offset + 0, indexNameId as i32);
    this.getForMeta().set(offset + 1, rangeExprId as i32);
    this.getForMeta().set(offset + 2, this.forBodyEqCount as i32); // bodyOffset
    this.getForMeta().set(offset + 3, 0); // bodyCount
    return idx;
  }

  addForBodyEquation(forIdx: u32, kind: i32, lhsId: u32, rhsId: u32): u32 {
    if (forIdx >= this.forCount) return 0;
    let bIdx = this.forBodyEqCount++;
    let offset = bIdx * EQ_STRIDE;
    this.getForBodyEqs().set(offset + EQ_KIND, kind);
    this.getForBodyEqs().set(offset + EQ_LHS, lhsId as i32);
    this.getForBodyEqs().set(offset + EQ_RHS, rhsId as i32);
    this.getForBodyEqs().set(offset + EQ_AUX, 0);

    let mOffset = forIdx * FOR_STRIDE;
    let currCount = this.getForMeta().get(mOffset + 3);
    this.getForMeta().set(mOffset + 3, currCount + 1);
    return bIdx;
  }

  /**
   * Adds a compound if-equation block.
   */
  addIfEquation(conditionExprId: u32): u32 {
    let idx = this.ifCount++;
    let offset = idx * IF_STRIDE;
    this.getIfMeta().set(offset + 0, conditionExprId as i32);
    this.getIfMeta().set(offset + 1, this.ifBranchEqCount as i32); // thenOffset
    this.getIfMeta().set(offset + 2, 0); // thenCount
    this.getIfMeta().set(offset + 3, 0xffffffff); // elseIfOffset
    this.getIfMeta().set(offset + 4, 0); // elseIfCount
    this.getIfMeta().set(offset + 5, 0xffffffff); // elseOffset
    return idx;
  }

  addIfThenEquation(ifIdx: u32, kind: i32, lhsId: u32, rhsId: u32): u32 {
    if (ifIdx >= this.ifCount) return 0;
    let bIdx = this.ifBranchEqCount++;
    let offset = bIdx * EQ_STRIDE;
    this.getIfBranchEqs().set(offset + EQ_KIND, kind);
    this.getIfBranchEqs().set(offset + EQ_LHS, lhsId as i32);
    this.getIfBranchEqs().set(offset + EQ_RHS, rhsId as i32);
    this.getIfBranchEqs().set(offset + EQ_AUX, 0);

    let mOffset = ifIdx * IF_STRIDE;
    let currCount = this.getIfMeta().get(mOffset + 2);
    this.getIfMeta().set(mOffset + 2, currCount + 1);
    return bIdx;
  }

  /**
   * Adds a state machine container (Modelica 3.7 §17).
   */
  addStateMachine(nameId: u32, initialStateId: u32): u32 {
    let idx = this.smCount++;
    let offset = idx * SM_STRIDE;
    this.getStateMachines().set(offset + 0, nameId as i32);
    this.getStateMachines().set(offset + 1, initialStateId as i32);
    this.getStateMachines().set(offset + 2, this.stateCount as i32);
    this.getStateMachines().set(offset + 3, 0);
    return idx;
  }

  addState(smId: u32, nameId: u32): u32 {
    if (smId >= this.smCount) return 0;
    let idx = this.stateCount++;
    let offset = idx * STATE_STRIDE;
    this.getStateData().set(offset + 0, nameId as i32);
    this.getStateData().set(offset + 1, this.stateEqCount as i32);
    this.getStateData().set(offset + 2, 0);
    this.getStateData().set(offset + 3, this.stateVarCount as i32);
    this.getStateData().set(offset + 4, 0);
    this.getStateData().set(offset + 5, this.transitionCount as i32);

    let smOffset = smId * SM_STRIDE;
    let currCount = this.getStateMachines().get(smOffset + 3);
    this.getStateMachines().set(smOffset + 3, currCount + 1);
    return idx;
  }

  addStateEquation(smId: u32, stateId: u32, targetNameId: u32, exprId: u32, isDerivative: boolean): u32 {
    if (stateId >= this.stateCount) return 0;
    let idx = this.stateEqCount++;
    let offset = idx * 4;
    this.getStateEqs().set(offset + 0, targetNameId as i32);
    this.getStateEqs().set(offset + 1, exprId as i32);
    this.getStateEqs().set(offset + 2, isDerivative ? 1 : 0);
    this.getStateEqs().set(offset + 3, 0);

    let sOffset = stateId * STATE_STRIDE;
    let currCount = this.getStateData().get(sOffset + 2);
    this.getStateData().set(sOffset + 2, currCount + 1);
    return idx;
  }

  addTransition(
    smId: u32,
    fromStateId: u32,
    toStateId: u32,
    conditionExprId: u32,
    flags: i32 = 0,
    priority: i32 = 0
  ): u32 {
    let idx = this.transitionCount++;
    let offset = idx * TRANSITION_STRIDE;
    this.getTransitions().set(offset + 0, fromStateId as i32);
    this.getTransitions().set(offset + 1, toStateId as i32);
    this.getTransitions().set(offset + 2, conditionExprId as i32);
    this.getTransitions().set(offset + 3, priority);
    this.getTransitions().set(offset + 4, flags);
    this.getTransitions().set(offset + 5, 0);
    return idx;
  }

  /**
   * Registers a zero-crossing event indicator expression for continuous integration.
   */
  addEventIndicator(exprId: u32): u32 {
    let idx = this.eventIndicatorCount++;
    this.getEventIndicators().set(idx, exprId as i32);
    return idx;
  }

  getEventIndicatorCount(): u32 {
    return this.eventIndicatorCount;
  }

  getEventIndicatorExprId(idx: u32): u32 {
    if (idx >= this.eventIndicatorCount) return 0xffffffff;
    return this.getEventIndicators().get(idx) as u32;
  }

  /**
   * Sets optimization objective expressions.
   */
  setOptimizationObjective(objExpr: u32, integrandExpr: u32, startExpr: u32, finalExpr: u32): void {
    this.objectiveExprId = objExpr;
    this.objectiveIntegrandExprId = integrandExpr;
    this.startTimeExprId = startExpr;
    this.finalTimeExprId = finalExpr;
  }

  /**
   * Adds an expression node to the DAE system.
   */
  addExpression(kind: i32, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.exprCount++;
    let offset = idx * EXPR_STRIDE;

    this.getExprData().set(offset + EXPR_KIND, kind);
    this.getExprData().set(offset + EXPR_DATA1, data1);
    this.getExprData().set(offset + EXPR_LEFT, left);
    this.getExprData().set(offset + EXPR_RIGHT, right);
    return idx;
  }

  addName(varId: u32): u32 {
    return this.addExpression(ExprKind.Name, varId);
  }

  addIntLiteral(value: i32): u32 {
    return this.addExpression(ExprKind.IntLiteral, value as u32);
  }

  addBoolLiteral(value: bool): u32 {
    return this.addExpression(ExprKind.BoolLiteral, value ? 1 : 0);
  }

  addRealLiteral(value: f64): u32 {
    let bits = i64.reinterpret_f64(value) as u64;
    let lo = (bits & 0xffffffff) as u32;
    let hi = (bits >> 32) as u32;
    return this.addExpression(ExprKind.RealLiteral, lo, hi);
  }

  getExprRealValue(exprId: u32): f64 {
    let lo = (this.getExprData().get(exprId * 4 + 1) as u64) & 0xffffffff;
    let hi = (this.getExprData().get(exprId * 4 + 2) as u64) << 32;
    let bits = hi | lo;
    return f64.reinterpret_i64(bits as i64);
  }

  addBinaryExpr(op: u16, left: u32, right: u32): u32 {
    return this.addExpression(ExprKind.Binary, op as u32, left, right);
  }

  addUnaryExpr(op: u32, left: u32): u32 {
    return this.addExpression(ExprKind.Unary, op, left, 0xffffffff);
  }

  addDer(varId: u32): u32 {
    return this.addExpression(ExprKind.Der, varId);
  }

  addDerExpr(operand: u32): u32 {
    return this.addExpression(ExprKind.Der, operand);
  }

  addPreExpr(operand: u32): u32 {
    return this.addExpression(ExprKind.Pre, operand);
  }

  addIfElse(condExpr: u32, trueExpr: u32, falseExpr: u32): u32 {
    return this.addExpression(ExprKind.IfElse, condExpr, trueExpr, falseExpr);
  }

  addCall(funcId: i32, firstArg: u32, argCount: u32): u32 {
    return this.addExpression(ExprKind.Call, funcId as u32, firstArg, argCount);
  }

  getExprKind(exprId: u32): i32 {
    return this.getExprData().get(exprId * 4 + 0);
  }

  getExprData1(exprId: u32): u32 {
    return this.getExprData().get(exprId * 4 + 1) as u32;
  }

  getExprLeft(exprId: u32): u32 {
    return this.getExprData().get(exprId * 4 + 2) as u32;
  }

  getExprRight(exprId: u32): u32 {
    return this.getExprData().get(exprId * 4 + 3) as u32;
  }

  /**
   * Resolves an expression payload (`EXPR_DATA1` of `Name` or `Der`) that stores
   * a 0-based `varIdx`, or falls back to looking up by interned `StringId`.
   */
  resolveExprVarId(nameOrVarId: u32): i32 {
    if (nameOrVarId == 0xffffffff) return -1;
    if (changetype<usize>(this.stringPool) != 0 && this.stringPool.isTime(nameOrVarId)) return -1;
    if (nameOrVarId < this.varCount) return nameOrVarId as i32;
    return this.lookupVariableByName(nameOrVarId);
  }

  /**
   * Resolves the expression ID of argument `argIdx` (0-based) for a `Call` expression,
   * supporting both the canonical `addCallExpr` layout (`Tuple` slots at `callExprId + argIdx`
   * with `EXPR_LEFT = argExprId`) and legacy binary/contiguous layouts.
   */
  getCallArgExprId(callExprId: u32, argIdx: u32): u32 {
    if (callExprId >= this.exprCount) return 0xffffffff;
    let firstArg = this.getExprLeft(callExprId);
    if (argIdx == 0) return firstArg;
    let slotIdx = callExprId + argIdx;
    if (slotIdx < this.exprCount && this.getExprKind(slotIdx) == ExprKind.Tuple) {
      return this.getExprLeft(slotIdx);
    }
    let right = this.getExprRight(callExprId);
    if (right < this.exprCount && right != callExprId && this.getExprKind(right) == ExprKind.Tuple) {
      if (argIdx == 1) {
        let tLeft = this.getExprLeft(right);
        return tLeft != 0xffffffff ? tLeft : this.getExprData1(right);
      }
    }
    if (argIdx == 1 && right != 2 && right != 3 && right < this.exprCount && right != callExprId) {
      return right;
    }
    if (firstArg != 0xffffffff && firstArg + argIdx < this.exprCount) {
      return firstArg + argIdx;
    }
    return 0xffffffff;
  }

  getVarCount(): i32 {
    return this.varCount as i32;
  }

  getVarNameId(varIdx: u32): u32 {
    if (varIdx >= this.varCount) return 0;
    return this.getVarData().get(varIdx * VAR_STRIDE + VAR_NAME) as u32;
  }

  isVarRemoved(varIdx: u32): bool {
    if (varIdx >= this.varCount) return true;
    return (this.getVarData().get(varIdx * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_REMOVED) != 0;
  }

  setVarRemoved(varIdx: u32, removed: bool = true): void {
    if (varIdx >= this.varCount) return;
    let offset = varIdx * VAR_STRIDE + VAR_FLAGS;
    let flags = this.getVarData().get(offset);
    if (removed) {
      this.getVarData().set(offset, flags | FLAG_VAR_REMOVED);
    } else {
      this.getVarData().set(offset, flags & ~FLAG_VAR_REMOVED);
    }
  }

  isEqInitial(eqIdx: u32): bool {
    if (eqIdx >= this.eqCount) return false;
    let offset = eqIdx * EQ_STRIDE;
    let k = this.getEqData().get(offset + EQ_KIND);
    if (k == EqKind.InitialSimple || k == EqKind.InitialFor || k == EqKind.InitialFunctionCall) return true;
    let aux = this.getEqData().get(offset + EQ_AUX);
    return aux != -1 && (aux & FLAG_EQ_INITIAL) != 0;
  }

  isEqRemoved(eqIdx: u32): bool {
    if (eqIdx >= this.eqCount) return true;
    let aux = this.getEqData().get(eqIdx * EQ_STRIDE + EQ_AUX);
    return aux != -1 && (aux & FLAG_EQ_REMOVED) != 0;
  }

  setEqRemoved(eqIdx: u32, removed: bool = true): void {
    if (eqIdx >= this.eqCount) return;
    let offset = eqIdx * EQ_STRIDE + EQ_AUX;
    let aux = this.getEqData().get(offset);
    if (aux == -1) aux = 0;
    if (removed) {
      this.getEqData().set(offset, aux | FLAG_EQ_REMOVED);
    } else {
      this.getEqData().set(offset, aux & ~FLAG_EQ_REMOVED);
    }
  }

  getVarType(varIdx: u32): i32 {
    if (varIdx >= this.varCount) return -1;
    return this.getVarData().get(varIdx * VAR_STRIDE + VAR_TYPE);
  }

  getVarStartValue(varId: u32): f64 {
    if (varId >= this.varCount) return 0.0;
    let hi = (this.getVarData().get(varId * VAR_STRIDE + VAR_START_HI) as u64) << 32;
    let lo = (this.getVarData().get(varId * VAR_STRIDE + VAR_START_LO) as u64) & 0xffffffff;
    return f64.reinterpret_i64((hi | lo) as i64);
  }

  setVarStartValue(varId: u32, val: f64): void {
    if (varId >= this.varCount) return;
    let bits = i64.reinterpret_f64(val) as u64;
    let hi = (bits >> 32) as u32;
    let lo = (bits & 0xffffffff) as u32;
    this.getVarData().set(varId * VAR_STRIDE + VAR_START_HI, hi);
    this.getVarData().set(varId * VAR_STRIDE + VAR_START_LO, lo);
  }

  getWarmStartValue(varId: u32): f64 {
    return this.getVarStartValue(varId);
  }

  setWarmStartValue(varId: u32, val: f64): void {
    this.setVarStartValue(varId, val);
  }

  isVarFlow(varIdx: u32): boolean {
    if (varIdx >= this.varCount) return false;
    return (this.getVarData().get(varIdx * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_FLOW) != 0;
  }

  setVarFlow(varIdx: u32, isFlow: bool): void {
    if (varIdx >= this.varCount) return;
    let offset = varIdx * VAR_STRIDE + VAR_FLAGS;
    let flags = this.getVarData().get(offset);
    if (isFlow) {
      this.getVarData().set(offset, flags | FLAG_VAR_FLOW);
    } else {
      this.getVarData().set(offset, flags & ~FLAG_VAR_FLOW);
    }
  }

  isVarStream(varIdx: u32): boolean {
    if (varIdx >= this.varCount) return false;
    return (this.getVarData().get(varIdx * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_STREAM) != 0;
  }

  setVarStream(varIdx: u32, isStream: bool): void {
    if (varIdx >= this.varCount) return;
    let offset = varIdx * VAR_STRIDE + VAR_FLAGS;
    let flags = this.getVarData().get(offset);
    if (isStream) {
      this.getVarData().set(offset, flags | FLAG_VAR_STREAM);
    } else {
      this.getVarData().set(offset, flags & ~FLAG_VAR_STREAM);
    }
  }

  isVarFixed(varIdx: u32): boolean {
    if (varIdx >= this.varCount) return false;
    return (this.getVarData().get(varIdx * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_FIXED) != 0;
  }

  setVarFixed(varIdx: u32, isFixed: bool): void {
    if (varIdx >= this.varCount) return;
    let offset = varIdx * VAR_STRIDE + VAR_FLAGS;
    let flags = this.getVarData().get(offset);
    if (isFixed) {
      this.getVarData().set(offset, flags | FLAG_VAR_FIXED);
    } else {
      this.getVarData().set(offset, flags & ~FLAG_VAR_FIXED);
    }
  }

  removeVariable(varIdx: u32): void {
    if (varIdx >= this.varCount) return;
    let offset = varIdx * VAR_STRIDE + VAR_FLAGS;
    let flags = this.getVarData().get(offset);
    this.getVarData().set(offset, flags | FLAG_VAR_REMOVED);
  }

  /**
   * Adds an equation to the DAE system (e.g. `lhs = rhs`).
   */
  addEquation(kind: i32, lhsId: u32, rhsId: u32, auxId: u32 = 0xffffffff): u32 {
    let idx = this.eqCount++;
    let offset = idx * EQ_STRIDE;

    this.getEqData().set(offset + EQ_KIND, kind);
    this.getEqData().set(offset + EQ_LHS, lhsId);
    this.getEqData().set(offset + EQ_RHS, rhsId);
    this.getEqData().set(offset + EQ_AUX, auxId);

    return idx;
  }

  /**
   * Adds an algorithm statement to the DAE system.
   */
  addStatement(kind: i32, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.stmtCount++;
    let offset = idx * STMT_STRIDE;

    this.getStmtData().set(offset + STMT_KIND, kind);
    this.getStmtData().set(offset + STMT_DATA1, data1);
    this.getStmtData().set(offset + STMT_LEFT, left);
    this.getStmtData().set(offset + STMT_RIGHT, right);

    return idx;
  }

  setVarFlag(varId: u32, flag: i32): void {
    if (varId >= this.varCount) return;
    let offset = varId * VAR_STRIDE + VAR_FLAGS;
    let curr = this.getVarData().get(offset);
    this.getVarData().set(offset, curr | flag);
  }

  hasVarFlag(varId: u32, flag: i32): boolean {
    if (varId >= this.varCount) return false;
    let offset = varId * VAR_STRIDE + VAR_FLAGS;
    return (this.getVarData().get(offset) & flag) != 0;
  }

  exportDaeBinary(targetBuf: usize): u32 {
    if (targetBuf == 0) return 0;
    store<u32>(targetBuf, this.varCount);
    store<u32>(targetBuf + 4, this.eqCount);
    store<u32>(targetBuf + 8, this.exprCount);
    store<u32>(targetBuf + 12, this.stmtCount);
    store<u32>(targetBuf + 16, this.clockCount);
    store<u32>(targetBuf + 20, this.smCount);
    store<u32>(targetBuf + 24, this.eventIndicatorCount);
    return 28;
  }

  /**
   * Returns the problem class bitmask flags.
   */
  getProblemFlags(): u32 {
    return this.problemFlags;
  }

  setProblemFlag(flag: u32): void {
    this.problemFlags |= flag;
  }

  clearProblemFlag(flag: u32): void {
    this.problemFlags &= ~flag;
  }

  // ── 1. Optimization Side-Table Methods ──

  addObjective(mayerExprId: u32, lagrangeExprId: u32, sense: i32, flags: i32): u32 {
    let idx = this.objectiveCount++;
    let offset = idx * OBJ_STRIDE;
    let tbl = this.getObjectivesData();
    tbl.set(offset + OBJ_MAYER_EXPR, mayerExprId as i32);
    tbl.set(offset + OBJ_LAGRANGE_EXPR, lagrangeExprId as i32);
    tbl.set(offset + OBJ_SENSE, sense);
    tbl.set(offset + OBJ_FLAGS, flags);
    if (idx == 0) {
      this.objectiveExprId = mayerExprId;
      this.objectiveIntegrandExprId = lagrangeExprId;
    }
    this.problemFlags |= PROBLEM_OPTIMIZATION;
    return idx;
  }

  addConstraint(exprId: u32, lb: f64, ub: f64, kindAndFlags: i32): u32 {
    let idx = this.constraintCount++;
    let offset = idx * CON_STRIDE;
    let lbBits = i64.reinterpret_f64(lb) as u64;
    let ubBits = i64.reinterpret_f64(ub) as u64;
    let tbl = this.getConstraintsData();
    tbl.set(offset + CON_EXPR, exprId as i32);
    tbl.set(offset + CON_LB_HI, (lbBits >> 32) as i32);
    tbl.set(offset + CON_LB_LO, (lbBits & 0xffffffff) as i32);
    tbl.set(offset + CON_UB_HI, (ubBits >> 32) as i32);
    tbl.set(offset + CON_UB_LO, (ubBits & 0xffffffff) as i32);
    tbl.set(offset + CON_KIND_FLAGS, kindAndFlags);
    this.problemFlags |= PROBLEM_OPTIMIZATION;
    return idx;
  }

  addConeConstraint(kind: i32, dim: u32): u32 {
    let idx = this.coneCount++;
    let offset = idx * CONE_STRIDE;
    let tbl = this.getConeData();
    tbl.set(offset + CONE_KIND, kind);
    tbl.set(offset + CONE_MEMBER_START, this.coneMemberCount as i32);
    tbl.set(offset + CONE_MEMBER_COUNT, 0);
    tbl.set(offset + CONE_DIM, dim as i32);
    this.problemFlags |= PROBLEM_OPTIMIZATION;
    return idx;
  }

  addConeMember(coneIdx: u32, exprId: u32): u32 {
    let mIdx = this.coneMemberCount++;
    this.getConeMembers().set(mIdx, exprId as i32);
    let countOffset = coneIdx * CONE_STRIDE + CONE_MEMBER_COUNT;
    let c = this.getConeData().get(countOffset);
    this.getConeData().set(countOffset, c + 1);
    return mIdx;
  }

  // ── 2. SDE Side-Table Methods ──

  addDiffusion(stateVarId: u32, noiseChannelId: u32, exprId: u32, flags: i32 = 0): u32 {
    let idx = this.diffusionCount++;
    let offset = idx * DIFF_STRIDE;
    let tbl = this.getDiffusionData();
    tbl.set(offset + DIFF_STATE_VAR, stateVarId as i32);
    tbl.set(offset + DIFF_NOISE_CH, noiseChannelId as i32);
    tbl.set(offset + DIFF_EXPR, exprId as i32);
    tbl.set(offset + DIFF_FLAGS, flags);
    if (noiseChannelId + 1 > this.sdeBrownianDim) {
      this.sdeBrownianDim = noiseChannelId + 1;
    }
    this.problemFlags |= PROBLEM_SDE;
    return idx;
  }

  setSdeConfig(noiseType: i32, calculus: i32, brownianDim: u32, seed: u32, ensemblePaths: u32): void {
    this.sdeNoiseType = noiseType;
    this.sdeCalculus = calculus;
    if (brownianDim > 0) this.sdeBrownianDim = brownianDim;
    this.sdeSeed = seed;
    if (ensemblePaths > 0) this.sdeEnsemblePaths = ensemblePaths;
    this.problemFlags |= PROBLEM_SDE;
  }

  // ── 3. BVP Side-Table Methods ──

  addBoundaryEquation(lhsId: u32, rhsId: u32, flags: i32 = 0): u32 {
    this.problemFlags |= PROBLEM_BVP;
    return this.addEquation(EqKind.Boundary, lhsId, rhsId, (flags | FLAG_EQ_BOUNDARY) as u32);
  }

  addAtBoundaryExpr(varId: u32, boundaryPointIdx: u32): u32 {
    this.problemFlags |= PROBLEM_BVP;
    return this.addExpression(ExprKind.AtBoundary, varId, boundaryPointIdx, NULL_ID);
  }

  setBvpConfig(method: i32, intervals: u32): void {
    this.bvpMethod = method;
    if (intervals > 0) this.bvpIntervals = intervals;
    this.problemFlags |= PROBLEM_BVP;
  }

  addBvpBoundaryPoint(tVal: f64): u32 {
    let idx = this.bvpBoundaryPointCount++;
    let bits = i64.reinterpret_f64(tVal) as u64;
    let tbl = this.getBvpBoundaryPoints();
    tbl.set(idx * 2, (bits >> 32) as i32);
    tbl.set(idx * 2 + 1, (bits & 0xffffffff) as i32);
    this.problemFlags |= PROBLEM_BVP;
    return idx;
  }

  // ── 4. DDE / NDDE Side-Table Methods ──

  addDelayChannel(targetExprId: u32, tauExprId: u32, historyExprId: u32, historyDerivExprId: u32, flags: i32): u32 {
    let idx = this.delayCount++;
    let offset = idx * DELAY_STRIDE;
    let tbl = this.getDelayData();
    tbl.set(offset + DELAY_TARGET_EXPR, targetExprId as i32);
    tbl.set(offset + DELAY_TAU_EXPR, tauExprId as i32);
    tbl.set(offset + DELAY_HISTORY_EXPR, historyExprId as i32);
    tbl.set(offset + DELAY_HISTORY_DERIV_EXPR, historyDerivExprId as i32);
    tbl.set(offset + DELAY_FLAGS, flags);
    this.problemFlags |= PROBLEM_DDE;
    return idx;
  }

  addDelayExpr(delayChannelIdx: u32, targetExprId: u32, tauExprId: u32): u32 {
    this.problemFlags |= PROBLEM_DDE;
    return this.addExpression(ExprKind.Delay, delayChannelIdx, targetExprId, tauExprId);
  }

  // ── 5. Jump Process / SSA Side-Table Methods ──

  addJump(propensityExprId: u32, flags: i32 = 0): u32 {
    let idx = this.jumpCount++;
    let offset = idx * JUMP_STRIDE;
    let tbl = this.getJumpData();
    tbl.set(offset + JUMP_PROPENSITY_EXPR, propensityExprId as i32);
    tbl.set(offset + JUMP_AFFECT_START, this.jumpAffectCount as i32);
    tbl.set(offset + JUMP_AFFECT_COUNT, 0);
    tbl.set(offset + JUMP_FLAGS, flags);
    this.problemFlags |= PROBLEM_JUMP;
    return idx;
  }

  addJumpAffect(jumpIdx: u32, targetVarId: u32, deltaExprId: u32, mode: i32 = 0): u32 {
    let aIdx = this.jumpAffectCount++;
    let aOff = aIdx * AFFECT_STRIDE;
    let tbl = this.getJumpAffects();
    tbl.set(aOff + AFFECT_VAR, targetVarId as i32);
    tbl.set(aOff + AFFECT_EXPR, deltaExprId as i32);
    tbl.set(aOff + AFFECT_MODE, mode);
    let cntOff = jumpIdx * JUMP_STRIDE + JUMP_AFFECT_COUNT;
    let c = this.getJumpData().get(cntOff);
    this.getJumpData().set(cntOff, c + 1);
    return aIdx;
  }

  // ── 6. Uncertainty, Reachability & STL Side-Table Methods ──

  addVarUncertainty(varId: u32, distKind: i32, p1: f64, p2: f64): u32 {
    let idx = this.uncertaintyCount++;
    let offset = idx * UNC_STRIDE;
    let p1Bits = i64.reinterpret_f64(p1) as u64;
    let p2Bits = i64.reinterpret_f64(p2) as u64;
    let tbl = this.getUncertaintyData();
    tbl.set(offset + UNC_VAR, varId as i32);
    tbl.set(offset + UNC_DIST_KIND, distKind);
    tbl.set(offset + UNC_P1_HI, (p1Bits >> 32) as i32);
    tbl.set(offset + UNC_P1_LO, (p1Bits & 0xffffffff) as i32);
    tbl.set(offset + UNC_P2_HI, (p2Bits >> 32) as i32);
    tbl.set(offset + UNC_P2_LO, (p2Bits & 0xffffffff) as i32);
    this.problemFlags |= PROBLEM_UNCERTAIN;
    return idx;
  }

  addStlNode(op: i32, leftId: u32, rightId: u32, tLo: f64, tHi: f64, flags: i32 = 0): u32 {
    let idx = this.stlCount++;
    let offset = idx * STL_STRIDE;
    let tLoBits = i64.reinterpret_f64(tLo) as u64;
    let tHiBits = i64.reinterpret_f64(tHi) as u64;
    let tbl = this.getStlData();
    tbl.set(offset + STL_OP, op);
    tbl.set(offset + STL_LEFT, leftId as i32);
    tbl.set(offset + STL_RIGHT, rightId as i32);
    tbl.set(offset + STL_TLO_HI, (tLoBits >> 32) as i32);
    tbl.set(offset + STL_TLO_LO, (tLoBits & 0xffffffff) as i32);
    tbl.set(offset + STL_THI_HI, (tHiBits >> 32) as i32);
    tbl.set(offset + STL_THI_LO, (tHiBits & 0xffffffff) as i32);
    tbl.set(offset + STL_FLAGS, flags);
    this.problemFlags |= PROBLEM_REACHABILITY;
    return idx;
  }

  addStateInvariant(stateId: u32, varId: u32, lo: f64, hi: f64): u32 {
    let idx = this.stateInvariantCount++;
    let offset = idx * INV_STRIDE;
    let loBits = i64.reinterpret_f64(lo) as u64;
    let hiBits = i64.reinterpret_f64(hi) as u64;
    let tbl = this.getStateInvariants();
    tbl.set(offset + INV_STATE, stateId as i32);
    tbl.set(offset + INV_VAR, varId as i32);
    tbl.set(offset + INV_LO_HI, (loBits >> 32) as i32);
    tbl.set(offset + INV_LO_LO, (loBits & 0xffffffff) as i32);
    tbl.set(offset + INV_HI_HI, (hiBits >> 32) as i32);
    tbl.set(offset + INV_HI_LO, (hiBits & 0xffffffff) as i32);
    this.problemFlags |= (PROBLEM_REACHABILITY | PROBLEM_HYBRID);
    return idx;
  }

  /**
   * Deep-copies all core and lazy side-tables into `dst`.
   */
  cloneTo(dst: DaeBuilder): void {
    let copyArr = (srcArr: ChunkedInt32Array, dstArr: ChunkedInt32Array, count: u32): void => {
      for (let i: u32 = 0; i < count; i++) {
        dstArr.set(i, srcArr.get(i));
      }
      dstArr.length = count;
    };

    dst.varCount = this.varCount;
    copyArr(this.varData, dst.varData, this.varCount * VAR_STRIDE);
    copyArr(this.aliasData, dst.aliasData, this.varCount);
    copyArr(this.varAttrData, dst.varAttrData, this.varCount * VAR_ATTR_STRIDE);
    copyArr(this.varShapes, dst.varShapes, this.varCount * 4);
    copyArr(this.varSymbolicShapes, dst.varSymbolicShapes, this.varCount * 4);
    copyArr(this.varClockMap, dst.varClockMap, this.varCount);

    // Rebuild nameIndex in dst
    const dstIdx = dst.getNameIndex();
    dstIdx.clear();
    for (let i: u32 = 0; i < this.varCount; i++) {
      const nameId = this.varData.get(i * VAR_STRIDE + VAR_NAME);
      dstIdx.set(nameId, i + 1);
    }

    dst.eqCount = this.eqCount;
    copyArr(this.eqData, dst.eqData, this.eqCount * EQ_STRIDE);
    copyArr(this.eqClockMap, dst.eqClockMap, this.eqCount);

    dst.exprCount = this.exprCount;
    copyArr(this.exprData, dst.exprData, this.exprCount * EXPR_STRIDE);

    dst.stmtCount = this.stmtCount;
    copyArr(this.stmtData, dst.stmtData, this.stmtCount * STMT_STRIDE);

    dst.objectiveExprId = this.objectiveExprId;
    dst.objectiveIntegrandExprId = this.objectiveIntegrandExprId;
    dst.startTimeExprId = this.startTimeExprId;
    dst.finalTimeExprId = this.finalTimeExprId;
    dst.problemFlags = this.problemFlags;

    if (this.clockCount > 0 && changetype<usize>(this.clocksData) != 0) {
      dst.clockCount = this.clockCount;
      copyArr(this.clocksData, dst.getClocksData(), this.clockCount * CLOCK_STRIDE);
    }
    if (this.whenCount > 0 && changetype<usize>(this.whenMeta) != 0) {
      dst.whenCount = this.whenCount;
      copyArr(this.whenMeta, dst.getWhenMeta(), this.whenCount * WHEN_STRIDE);
    }
    if (this.whenBodyEqCount > 0 && changetype<usize>(this.whenBodyEqs) != 0) {
      dst.whenBodyEqCount = this.whenBodyEqCount;
      copyArr(this.whenBodyEqs, dst.getWhenBodyEqs(), this.whenBodyEqCount * EQ_STRIDE);
    }
    if (this.forCount > 0 && changetype<usize>(this.forMeta) != 0) {
      dst.forCount = this.forCount;
      copyArr(this.forMeta, dst.getForMeta(), this.forCount * FOR_STRIDE);
    }
    if (this.forBodyEqCount > 0 && changetype<usize>(this.forBodyEqs) != 0) {
      dst.forBodyEqCount = this.forBodyEqCount;
      copyArr(this.forBodyEqs, dst.getForBodyEqs(), this.forBodyEqCount * EQ_STRIDE);
    }
    if (this.ifCount > 0 && changetype<usize>(this.ifMeta) != 0) {
      dst.ifCount = this.ifCount;
      copyArr(this.ifMeta, dst.getIfMeta(), this.ifCount * IF_STRIDE);
    }
    if (this.ifBranchEqCount > 0 && changetype<usize>(this.ifBranchEqs) != 0) {
      dst.ifBranchEqCount = this.ifBranchEqCount;
      copyArr(this.ifBranchEqs, dst.getIfBranchEqs(), this.ifBranchEqCount * EQ_STRIDE);
    }
    if (this.smCount > 0 && changetype<usize>(this.stateMachines) != 0) {
      dst.smCount = this.smCount;
      copyArr(this.stateMachines, dst.getStateMachines(), this.smCount * SM_STRIDE);
    }
    if (this.stateCount > 0 && changetype<usize>(this.stateData) != 0) {
      dst.stateCount = this.stateCount;
      copyArr(this.stateData, dst.getStateData(), this.stateCount * STATE_STRIDE);
    }
    if (this.stateEqCount > 0 && changetype<usize>(this.stateEqs) != 0) {
      dst.stateEqCount = this.stateEqCount;
      copyArr(this.stateEqs, dst.getStateEqs(), this.stateEqCount * 4);
    }
    if (this.stateVarCount > 0 && changetype<usize>(this.stateVars) != 0) {
      dst.stateVarCount = this.stateVarCount;
      copyArr(this.stateVars, dst.getStateVars(), this.stateVarCount * 4);
    }
    if (this.transitionCount > 0 && changetype<usize>(this.transitions) != 0) {
      dst.transitionCount = this.transitionCount;
      copyArr(this.transitions, dst.getTransitions(), this.transitionCount * TRANSITION_STRIDE);
    }
    if (this.eventIndicatorCount > 0 && changetype<usize>(this.eventIndicators) != 0) {
      dst.eventIndicatorCount = this.eventIndicatorCount;
      copyArr(this.eventIndicators, dst.getEventIndicators(), this.eventIndicatorCount);
    }
    if (this.objectiveCount > 0 && changetype<usize>(this.objectivesData) != 0) {
      dst.objectiveCount = this.objectiveCount;
      copyArr(this.objectivesData, dst.getObjectivesData(), this.objectiveCount * OBJ_STRIDE);
    }
    if (this.constraintCount > 0 && changetype<usize>(this.constraintsData) != 0) {
      dst.constraintCount = this.constraintCount;
      copyArr(this.constraintsData, dst.getConstraintsData(), this.constraintCount * CON_STRIDE);
    }
    if (this.coneCount > 0 && changetype<usize>(this.coneData) != 0) {
      dst.coneCount = this.coneCount;
      copyArr(this.coneData, dst.getConeData(), this.coneCount * CONE_STRIDE);
    }
    if (this.coneMemberCount > 0 && changetype<usize>(this.coneMembers) != 0) {
      dst.coneMemberCount = this.coneMemberCount;
      copyArr(this.coneMembers, dst.getConeMembers(), this.coneMemberCount);
    }
    dst.sdeNoiseType = this.sdeNoiseType;
    dst.sdeCalculus = this.sdeCalculus;
    dst.sdeBrownianDim = this.sdeBrownianDim;
    dst.sdeSeed = this.sdeSeed;
    dst.sdeEnsemblePaths = this.sdeEnsemblePaths;
    if (this.diffusionCount > 0 && changetype<usize>(this.diffusionData) != 0) {
      dst.diffusionCount = this.diffusionCount;
      copyArr(this.diffusionData, dst.getDiffusionData(), this.diffusionCount * DIFF_STRIDE);
    }
    dst.bvpMethod = this.bvpMethod;
    dst.bvpIntervals = this.bvpIntervals;
    if (this.bvpBoundaryPointCount > 0 && changetype<usize>(this.bvpBoundaryPoints) != 0) {
      dst.bvpBoundaryPointCount = this.bvpBoundaryPointCount;
      copyArr(this.bvpBoundaryPoints, dst.getBvpBoundaryPoints(), this.bvpBoundaryPointCount * 2);
    }
    if (this.delayCount > 0 && changetype<usize>(this.delayData) != 0) {
      dst.delayCount = this.delayCount;
      copyArr(this.delayData, dst.getDelayData(), this.delayCount * DELAY_STRIDE);
    }
    if (this.jumpCount > 0 && changetype<usize>(this.jumpData) != 0) {
      dst.jumpCount = this.jumpCount;
      copyArr(this.jumpData, dst.getJumpData(), this.jumpCount * JUMP_STRIDE);
    }
    if (this.jumpAffectCount > 0 && changetype<usize>(this.jumpAffects) != 0) {
      dst.jumpAffectCount = this.jumpAffectCount;
      copyArr(this.jumpAffects, dst.getJumpAffects(), this.jumpAffectCount * AFFECT_STRIDE);
    }
    if (this.uncertaintyCount > 0 && changetype<usize>(this.uncertaintyData) != 0) {
      dst.uncertaintyCount = this.uncertaintyCount;
      copyArr(this.uncertaintyData, dst.getUncertaintyData(), this.uncertaintyCount * UNC_STRIDE);
    }
    if (this.stlCount > 0 && changetype<usize>(this.stlData) != 0) {
      dst.stlCount = this.stlCount;
      copyArr(this.stlData, dst.getStlData(), this.stlCount * STL_STRIDE);
    }
    if (this.stateInvariantCount > 0 && changetype<usize>(this.stateInvariants) != 0) {
      dst.stateInvariantCount = this.stateInvariantCount;
      copyArr(this.stateInvariants, dst.getStateInvariants(), this.stateInvariantCount * INV_STRIDE);
    }
  }

  /**
   * Captures a snapshot checkpoint of all variable, equation, and metadata counts.
   */
  snapshot(): void {
    this.snapshotVarCount = this.varCount;
    this.snapshotEqCount = this.eqCount;
    this.snapshotExprCount = this.exprCount;
    this.snapshotStmtCount = this.stmtCount;
    this.snapshotClockCount = this.clockCount;
    this.snapshotWhenCount = this.whenCount;
    this.snapshotWhenBodyEqCount = this.whenBodyEqCount;
    this.snapshotForCount = this.forCount;
    this.snapshotForBodyEqCount = this.forBodyEqCount;
    this.snapshotIfCount = this.ifCount;
    this.snapshotIfBranchEqCount = this.ifBranchEqCount;
    this.snapshotSmCount = this.smCount;
    this.snapshotStateCount = this.stateCount;
    this.snapshotStateEqCount = this.stateEqCount;
    this.snapshotStateVarCount = this.stateVarCount;
    this.snapshotTransitionCount = this.transitionCount;
    this.snapshotEventIndicatorCount = this.eventIndicatorCount;
    this.snapshotProblemFlags = this.problemFlags;
    this.snapshotObjectiveCount = this.objectiveCount;
    this.snapshotConstraintCount = this.constraintCount;
    this.snapshotConeCount = this.coneCount;
    this.snapshotConeMemberCount = this.coneMemberCount;
    this.snapshotDiffusionCount = this.diffusionCount;
    this.snapshotBvpBoundaryPointCount = this.bvpBoundaryPointCount;
    this.snapshotDelayCount = this.delayCount;
    this.snapshotJumpCount = this.jumpCount;
    this.snapshotJumpAffectCount = this.jumpAffectCount;
    this.snapshotUncertaintyCount = this.uncertaintyCount;
    this.snapshotStlCount = this.stlCount;
    this.snapshotStateInvariantCount = this.stateInvariantCount;
  }

  /**
   * Restores the DAE system state back to the previous snapshot checkpoint.
   */
  rollback(): void {
    const oldVarCount = this.varCount;
    this.varCount = this.snapshotVarCount;
    this.getVarData().length = this.varCount * VAR_STRIDE;
    this.getAliasData().length = this.varCount;
    this.getVarAttrData().length = this.varCount * VAR_ATTR_STRIDE;
    this.getVarShapes().length = this.varCount * 4;
    this.getVarSymbolicShapes().length = this.varCount * 4;
    this.getVarClockMap().length = this.varCount;

    if (this.varCount < oldVarCount) {
      const idxMap = this.getNameIndex();
      idxMap.clear();
      const vData = this.getVarData();
      for (let i: u32 = 0; i < this.varCount; i++) {
        const nameId = vData.get(i * VAR_STRIDE + VAR_NAME);
        idxMap.set(nameId, i + 1);
      }
    }

    this.eqCount = this.snapshotEqCount;
    this.getEqData().length = this.eqCount * EQ_STRIDE;
    this.getEqClockMap().length = this.eqCount;

    this.exprCount = this.snapshotExprCount;
    this.getExprData().length = this.exprCount * EXPR_STRIDE;

    this.stmtCount = this.snapshotStmtCount;
    this.getStmtData().length = this.stmtCount * STMT_STRIDE;

    this.clockCount = this.snapshotClockCount;
    if (changetype<usize>(this.clocksData) != 0) this.clocksData.length = this.clockCount * CLOCK_STRIDE;

    this.whenCount = this.snapshotWhenCount;
    if (changetype<usize>(this.whenMeta) != 0) this.whenMeta.length = this.whenCount * WHEN_STRIDE;
    this.whenBodyEqCount = this.snapshotWhenBodyEqCount;
    if (changetype<usize>(this.whenBodyEqs) != 0) this.whenBodyEqs.length = this.whenBodyEqCount * EQ_STRIDE;

    this.forCount = this.snapshotForCount;
    if (changetype<usize>(this.forMeta) != 0) this.forMeta.length = this.forCount * FOR_STRIDE;
    this.forBodyEqCount = this.snapshotForBodyEqCount;
    if (changetype<usize>(this.forBodyEqs) != 0) this.forBodyEqs.length = this.forBodyEqCount * EQ_STRIDE;

    this.ifCount = this.snapshotIfCount;
    if (changetype<usize>(this.ifMeta) != 0) this.ifMeta.length = this.ifCount * IF_STRIDE;
    this.ifBranchEqCount = this.snapshotIfBranchEqCount;
    if (changetype<usize>(this.ifBranchEqs) != 0) this.ifBranchEqs.length = this.ifBranchEqCount * EQ_STRIDE;

    this.smCount = this.snapshotSmCount;
    if (changetype<usize>(this.stateMachines) != 0) this.stateMachines.length = this.smCount * SM_STRIDE;
    this.stateCount = this.snapshotStateCount;
    if (changetype<usize>(this.stateData) != 0) this.stateData.length = this.stateCount * STATE_STRIDE;
    this.stateEqCount = this.snapshotStateEqCount;
    if (changetype<usize>(this.stateEqs) != 0) this.stateEqs.length = this.stateEqCount * 4;
    this.stateVarCount = this.snapshotStateVarCount;
    if (changetype<usize>(this.stateVars) != 0) this.stateVars.length = this.stateVarCount;
    this.transitionCount = this.snapshotTransitionCount;
    if (changetype<usize>(this.transitions) != 0) this.transitions.length = this.transitionCount * TRANSITION_STRIDE;

    this.eventIndicatorCount = this.snapshotEventIndicatorCount;
    if (changetype<usize>(this.eventIndicators) != 0) this.eventIndicators.length = this.eventIndicatorCount;

    this.problemFlags = this.snapshotProblemFlags;
    this.objectiveCount = this.snapshotObjectiveCount;
    if (changetype<usize>(this.objectivesData) != 0) this.objectivesData.length = this.objectiveCount * OBJ_STRIDE;
    this.constraintCount = this.snapshotConstraintCount;
    if (changetype<usize>(this.constraintsData) != 0) this.constraintsData.length = this.constraintCount * CON_STRIDE;
    this.coneCount = this.snapshotConeCount;
    if (changetype<usize>(this.coneData) != 0) this.coneData.length = this.coneCount * CONE_STRIDE;
    this.coneMemberCount = this.snapshotConeMemberCount;
    if (changetype<usize>(this.coneMembers) != 0) this.coneMembers.length = this.coneMemberCount;
    this.diffusionCount = this.snapshotDiffusionCount;
    if (changetype<usize>(this.diffusionData) != 0) this.diffusionData.length = this.diffusionCount * DIFF_STRIDE;
    this.bvpBoundaryPointCount = this.snapshotBvpBoundaryPointCount;
    if (changetype<usize>(this.bvpBoundaryPoints) != 0) this.bvpBoundaryPoints.length = this.bvpBoundaryPointCount * 2;
    this.delayCount = this.snapshotDelayCount;
    if (changetype<usize>(this.delayData) != 0) this.delayData.length = this.delayCount * DELAY_STRIDE;
    this.jumpCount = this.snapshotJumpCount;
    if (changetype<usize>(this.jumpData) != 0) this.jumpData.length = this.jumpCount * JUMP_STRIDE;
    this.jumpAffectCount = this.snapshotJumpAffectCount;
    if (changetype<usize>(this.jumpAffects) != 0) this.jumpAffects.length = this.jumpAffectCount * AFFECT_STRIDE;
    this.uncertaintyCount = this.snapshotUncertaintyCount;
    if (changetype<usize>(this.uncertaintyData) != 0) this.uncertaintyData.length = this.uncertaintyCount * UNC_STRIDE;
    this.stlCount = this.snapshotStlCount;
    if (changetype<usize>(this.stlData) != 0) this.stlData.length = this.stlCount * STL_STRIDE;
    this.stateInvariantCount = this.snapshotStateInvariantCount;
    if (changetype<usize>(this.stateInvariants) != 0) this.stateInvariants.length = this.stateInvariantCount * INV_STRIDE;
  }

  resolveBuiltinMathFunc(funcId: i32): i32 {
    if (changetype<usize>(this.stringPool) != 0) {
      return this.stringPool.resolveBuiltinMathFunc(funcId);
    }
    if (funcId >= 56 && funcId <= 81) return funcId - 56;
    return (funcId >= 0 && funcId <= 25) ? funcId : -1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

const DAE_BUILDER_SIZE: u32 = offsetof<DaeBuilder>() > 1024 ? (offsetof<DaeBuilder>() as u32) : 1024;

export function dae_createBuilder(): u32 {
  let ptr = atomicChunkAlloc(DAE_BUILDER_SIZE);
  let builder = changetype<DaeBuilder>(ptr);
  builder.init();
  return ptr as u32;
}

export function dae_clone(srcPtr: u32): u32 {
  if (srcPtr == 0) return 0;
  let dstPtr = dae_createBuilder();
  changetype<DaeBuilder>(srcPtr).cloneTo(changetype<DaeBuilder>(dstPtr));
  return dstPtr;
}

export function dae_getStringPool(ptr: u32): usize {
  if (ptr == 0) return 0;
  return changetype<usize>(changetype<DaeBuilder>(ptr).stringPool);
}

export function dae_alloc(size: u32): u32 {
  return atomicChunkAlloc(size) as u32;
}

export function dae_allocInt32Array(length: u32): usize {
  let arr = new Int32Array(length);
  return changetype<usize>(arr.dataStart);
}

export function dae_setInt32(ptr: usize, index: u32, value: i32): void {
  store<i32>(ptr + (index << 2), value);
}

export function dae_getInt32(ptr: usize, index: u32): i32 {
  return load<i32>(ptr + (index << 2));
}

export function dae_free(ptr: u32): void {
  if (ptr == 0) return;
  changetype<DaeBuilder>(ptr).dispose();
  atomicChunkFree(ptr);
}

export function dae_snapshot(ptr: u32): void {
  changetype<DaeBuilder>(ptr).snapshot();
}

export function dae_rollback(ptr: u32): void {
  changetype<DaeBuilder>(ptr).rollback();
}

export function dae_addVariable(ptr: u32, nameId: u32, type: i32, variability: i32, causality: i32, startValue: f64, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addVariable(nameId, type, variability, causality, startValue, flags);
}

export function dae_lookupVariable(ptr: u32, nameId: u32): i32 {
  return changetype<DaeBuilder>(ptr).lookupVariableByName(nameId);
}

export function dae_addAlias(ptr: u32, varIdx: u32, targetNameId: u32): void {
  changetype<DaeBuilder>(ptr).addAlias(varIdx, targetNameId);
}

export function dae_getAlias(ptr: u32, varIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getAlias(varIdx);
}

export function dae_setVarAttrExpr(ptr: u32, varIdx: u32, attrKind: u32, exprId: u32): void {
  changetype<DaeBuilder>(ptr).setVarAttrExpr(varIdx, attrKind, exprId);
}

export function dae_getVarAttrExpr(ptr: u32, varIdx: u32, attrKind: u32): u32 {
  return changetype<DaeBuilder>(ptr).getVarAttrExpr(varIdx, attrKind);
}

export function dae_setVarShapeDim(ptr: u32, varIdx: u32, dimIdx: u32, size: i32): void {
  changetype<DaeBuilder>(ptr).setVarShapeDim(varIdx, dimIdx, size);
}

export function dae_getVarShapeDim(ptr: u32, varIdx: u32, dimIdx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getVarShapeDim(varIdx, dimIdx);
}

export function dae_setVarSymbolicShapeExpr(ptr: u32, varIdx: u32, dimIdx: u32, exprId: u32): void {
  changetype<DaeBuilder>(ptr).setVarSymbolicShapeExpr(varIdx, dimIdx, exprId);
}

export function dae_getVarSymbolicShapeExpr(ptr: u32, varIdx: u32, dimIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getVarSymbolicShapeExpr(varIdx, dimIdx);
}

export function dae_addClock(ptr: u32, intervalExprId: u32, resolutionExprId: u32, shiftExprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addClock(intervalExprId, resolutionExprId, shiftExprId);
}

export function dae_setVarClock(ptr: u32, varIdx: u32, clockId: u32): void {
  changetype<DaeBuilder>(ptr).setVarClock(varIdx, clockId);
}

export function dae_getVarClock(ptr: u32, varIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getVarClock(varIdx);
}

export function dae_setEqClock(ptr: u32, eqIdx: u32, clockId: u32): void {
  changetype<DaeBuilder>(ptr).setEqClock(eqIdx, clockId);
}

export function dae_getEqClock(ptr: u32, eqIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqClock(eqIdx);
}

export function dae_getPointers(ptr: u32): u32 {
  let b = changetype<DaeBuilder>(ptr);
  return (changetype<u32>(b.clocksData) & 0xffff) | ((changetype<u32>(b.varClockMap) & 0xffff) << 16);
}

export function dae_getOffsets(): u32 {
  let varOffset = offsetof<DaeBuilder>("varCount");
  let clockOffset = offsetof<DaeBuilder>("clockCount");
  return ((varOffset as u32) << 16) | ((clockOffset as u32) & 0xffff);
}

export function dae_getClockCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).clockCount;
}

export function dae_addWhenEquation(ptr: u32, conditionExprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addWhenEquation(conditionExprId);
}

export function dae_addWhenBodyEquation(ptr: u32, whenIdx: u32, kind: i32, lhsId: u32, rhsId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addWhenBodyEquation(whenIdx, kind, lhsId, rhsId);
}

export function dae_addForEquation(ptr: u32, indexNameId: u32, rangeExprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addForEquation(indexNameId, rangeExprId);
}

export function dae_addForBodyEquation(ptr: u32, forIdx: u32, kind: i32, lhsId: u32, rhsId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addForBodyEquation(forIdx, kind, lhsId, rhsId);
}

export function dae_addIfEquation(ptr: u32, conditionExprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addIfEquation(conditionExprId);
}

export function dae_addIfThenEquation(ptr: u32, ifIdx: u32, kind: i32, lhsId: u32, rhsId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addIfThenEquation(ifIdx, kind, lhsId, rhsId);
}

export function dae_addStateMachine(ptr: u32, nameId: u32, initialStateId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addStateMachine(nameId, initialStateId);
}

export function dae_addState(ptr: u32, smId: u32, nameId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addState(smId, nameId);
}

export function dae_addStateEquation(ptr: u32, smId: u32, stateId: u32, targetNameId: u32, exprId: u32, isDerivative: boolean): u32 {
  return changetype<DaeBuilder>(ptr).addStateEquation(smId, stateId, targetNameId, exprId, isDerivative);
}

export function dae_addTransition(ptr: u32, smId: u32, fromStateId: u32, toStateId: u32, conditionExprId: u32, flags: i32, priority: i32): u32 {
  return changetype<DaeBuilder>(ptr).addTransition(smId, fromStateId, toStateId, conditionExprId, flags, priority);
}

export function dae_addEventIndicator(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addEventIndicator(exprId);
}

export function dae_getEventIndicatorCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEventIndicatorCount();
}

export function dae_getEventIndicatorExprId(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEventIndicatorExprId(idx);
}

export function dae_setOptimizationObjective(ptr: u32, objExpr: u32, integrandExpr: u32, startExpr: u32, finalExpr: u32): void {
  changetype<DaeBuilder>(ptr).setOptimizationObjective(objExpr, integrandExpr, startExpr, finalExpr);
}

export function dae_addExpression(ptr: u32, kind: i32, data1: u32, left: u32, right: u32): u32 {
  return changetype<DaeBuilder>(ptr).addExpression(kind, data1, left, right);
}

export function dae_addStatement(ptr: u32, kind: i32, data1: u32, left: u32, right: u32): u32 {
  return changetype<DaeBuilder>(ptr).addStatement(kind, data1, left, right);
}

export function dae_addDer(ptr: u32, varId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addDer(varId);
}

export function dae_addIfElse(ptr: u32, condExpr: u32, trueExpr: u32, falseExpr: u32): u32 {
  return changetype<DaeBuilder>(ptr).addIfElse(condExpr, trueExpr, falseExpr);
}

export function dae_addCall(ptr: u32, funcId: i32, firstArg: u32, argCount: u32): u32 {
  return changetype<DaeBuilder>(ptr).addCall(funcId, firstArg, argCount);
}

export function dae_addName(ptr: u32, varId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addName(varId);
}

export function dae_addBinaryExpr(ptr: u32, op: i32, left: u32, right: u32): u32 {
  return changetype<DaeBuilder>(ptr).addBinaryExpr(op as u16, left, right);
}

export function dae_addUnaryExpr(ptr: u32, op: u32, left: u32): u32 {
  return changetype<DaeBuilder>(ptr).addUnaryExpr(op, left);
}

export function dae_addDerExpr(ptr: u32, operand: u32): u32 {
  return changetype<DaeBuilder>(ptr).addDerExpr(operand);
}

export function dae_addPreExpr(ptr: u32, operand: u32): u32 {
  return changetype<DaeBuilder>(ptr).addPreExpr(operand);
}

export function dae_addRealLiteral(ptr: u32, value: f64): u32 {
  return changetype<DaeBuilder>(ptr).addRealLiteral(value);
}

export function dae_addIntLiteral(ptr: u32, value: i32): u32 {
  return changetype<DaeBuilder>(ptr).addIntLiteral(value);
}

export function dae_addBoolLiteral(ptr: u32, value: bool): u32 {
  return changetype<DaeBuilder>(ptr).addBoolLiteral(value);
}

export function dae_addEquation(ptr: u32, kind: i32, lhsId: u32, rhsId: u32, auxId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addEquation(kind, lhsId, rhsId, auxId);
}

export function dae_setVarFlag(ptr: u32, varId: u32, flag: i32): void {
  changetype<DaeBuilder>(ptr).setVarFlag(varId, flag);
}

export function dae_setVarFlags(ptr: u32, varId: u32, flags: i32): void {
  changetype<DaeBuilder>(ptr).getVarData().set(varId * VAR_STRIDE + VAR_FLAGS, flags);
}

export function dae_setVarStartValue(ptr: u32, varId: u32, val: f64): void {
  changetype<DaeBuilder>(ptr).setVarStartValue(varId, val);
}

export function dae_getEqCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).eqCount;
}

export function dae_getVarCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).varCount;
}

export function dae_getStmtCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).stmtCount;
}

export function dae_getStmtKind(ptr: u32, stmtId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getStmtData().get(stmtId * STMT_STRIDE + STMT_KIND);
}

export function dae_getStmtData1(ptr: u32, stmtId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStmtData().get(stmtId * STMT_STRIDE + STMT_DATA1) as u32;
}

export function dae_getStmtLeft(ptr: u32, stmtId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStmtData().get(stmtId * STMT_STRIDE + STMT_LEFT) as u32;
}

export function dae_getStmtRight(ptr: u32, stmtId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStmtData().get(stmtId * STMT_STRIDE + STMT_RIGHT) as u32;
}

export function dae_setStmtData1(ptr: u32, stmtId: u32, data1: u32): void {
  changetype<DaeBuilder>(ptr).getStmtData().set(stmtId * STMT_STRIDE + STMT_DATA1, data1 as i32);
}

export function dae_setStmtLeft(ptr: u32, stmtId: u32, left: u32): void {
  changetype<DaeBuilder>(ptr).getStmtData().set(stmtId * STMT_STRIDE + STMT_LEFT, left as i32);
}

export function dae_getExprCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).exprCount;
}

export function dae_getExprRealValue(ptr: u32, exprId: u32): f64 {
  let builder = changetype<DaeBuilder>(ptr);
  let lo = (builder.getExprData().get(exprId * 4 + 1) as u64) & 0xffffffff;
  let hi = (builder.getExprData().get(exprId * 4 + 2) as u64) << 32;
  let bits = hi | lo;
  return f64.reinterpret_i64(bits as i64);
}

export function dae_getExprKind(ptr: u32, exprId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getExprData().get(exprId * 4 + 0);
}

export function dae_getExprData1(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getExprData().get(exprId * 4 + 1);
}

export function dae_setExprData1(ptr: u32, exprId: u32, data1: u32): void {
  changetype<DaeBuilder>(ptr).getExprData().set(exprId * 4 + 1, data1);
}

export function dae_getExprLeft(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getExprData().get(exprId * 4 + 2);
}

export function dae_getExprRight(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getExprData().get(exprId * 4 + 3);
}

export function dae_getVarNameId(ptr: u32, varId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getVarData().get(varId * VAR_STRIDE + VAR_NAME) as u32;
}

export function dae_getVarType(ptr: u32, varId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getVarData().get(varId * VAR_STRIDE + VAR_TYPE);
}

export function dae_getVarVariability(ptr: u32, varId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getVarData().get(varId * VAR_STRIDE + VAR_VARIABILITY);
}

export function dae_getVarCausality(ptr: u32, varId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getVarData().get(varId * VAR_STRIDE + VAR_CAUSALITY);
}

export function dae_getVarFlags(ptr: u32, varId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getVarData().get(varId * VAR_STRIDE + VAR_FLAGS);
}

export function dae_isVarRemoved(ptr: u32, varId: u32): bool {
  return changetype<DaeBuilder>(ptr).isVarRemoved(varId);
}

export function dae_getVarStartValue(ptr: u32, varId: u32): f64 {
  let builder = changetype<DaeBuilder>(ptr);
  let hi = (builder.getVarData().get(varId * VAR_STRIDE + VAR_START_HI) as u64) << 32;
  let lo = (builder.getVarData().get(varId * VAR_STRIDE + VAR_START_LO) as u64) & 0xffffffff;
  let bits = hi | lo;
  return f64.reinterpret_i64(bits as i64);
}

export function dae_getEqKind(ptr: u32, eqId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_KIND);
}

export function dae_setEqKind(ptr: u32, eqId: u32, kind: i32): void {
  changetype<DaeBuilder>(ptr).getEqData().set(eqId * EQ_STRIDE + EQ_KIND, kind);
}

export function dae_getEqLhs(ptr: u32, eqId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_LHS) as u32;
}

export function dae_getEqRhs(ptr: u32, eqId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_RHS) as u32;
}

export function dae_getEqAux(ptr: u32, eqId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_AUX) as u32;
}

export function dae_setEqLhs(ptr: u32, eqId: u32, lhsId: u32): void {
  changetype<DaeBuilder>(ptr).getEqData().set(eqId * EQ_STRIDE + EQ_LHS, lhsId as i32);
}

export function dae_setEqRhs(ptr: u32, eqId: u32, rhsId: u32): void {
  changetype<DaeBuilder>(ptr).getEqData().set(eqId * EQ_STRIDE + EQ_RHS, rhsId as i32);
}

export function dae_setEqRemoved(ptr: u32, eqId: u32, removed: bool): void {
  changetype<DaeBuilder>(ptr).setEqRemoved(eqId, removed);
}

export function dae_isEqRemoved(ptr: u32, eqId: u32): bool {
  return changetype<DaeBuilder>(ptr).isEqRemoved(eqId);
}

export function dae_setMemF64(ptr: u32, val: f64): void {
  store<f64>(ptr, val);
}

export function dae_getMemF64(ptr: u32): f64 {
  return load<f64>(ptr);
}

/**
 * Zero-copy strided array slice view descriptor in WASM linear memory.
 */
@unmanaged
export class ArraySliceView {
  baseVarId: u32;
  offset: u32;
  stride: u32;
  length: u32;

  init(baseVarId: u32, offset: u32, stride: u32, length: u32): void {
    this.baseVarId = baseVarId;
    this.offset = offset;
    this.stride = stride;
    this.length = length;
  }

  getVarId(index: u32): u32 {
    if (index >= this.length) return 0;
    return this.baseVarId + this.offset + index * this.stride;
  }

  getValue(index: u32, varValuesPtr: u32): f64 {
    let vId = this.getVarId(index);
    return load<f64>(varValuesPtr + vId * 8);
  }

  setValue(index: u32, varValuesPtr: u32, val: f64): void {
    let vId = this.getVarId(index);
    store<f64>(varValuesPtr + vId * 8, val);
  }
}

export function dae_createSliceView(baseVarId: u32, offset: u32, stride: u32, length: u32): u32 {
  let ptr = atomicChunkAlloc(32);
  let view = changetype<ArraySliceView>(ptr);
  view.init(baseVarId, offset, stride, length);
  return ptr as u32;
}

export function dae_getSliceVarId(viewPtr: u32, index: u32): u32 {
  if (viewPtr == 0) return 0;
  return changetype<ArraySliceView>(viewPtr).getVarId(index);
}

export function dae_getSliceValue(viewPtr: u32, index: u32, varValuesPtr: u32): f64 {
  if (viewPtr == 0) return 0.0;
  return changetype<ArraySliceView>(viewPtr).getValue(index, varValuesPtr);
}

export function dae_setSliceValue(viewPtr: u32, index: u32, varValuesPtr: u32, val: f64): void {
  if (viewPtr == 0) return;
  changetype<ArraySliceView>(viewPtr).setValue(index, varValuesPtr, val);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported Multi-Problem Side-Table C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

@inline
function unpackF64(hi: i32, lo: i32): f64 {
  let bits = ((hi as u64) << 32) | ((lo as u64) & 0xffffffff);
  return f64.reinterpret_i64(bits as i64);
}

// ── Problem Flags ──

export function dae_getProblemFlags(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).getProblemFlags();
}

export function dae_setProblemFlag(ptr: u32, flag: u32): void {
  changetype<DaeBuilder>(ptr).setProblemFlag(flag);
}

export function dae_clearProblemFlag(ptr: u32, flag: u32): void {
  changetype<DaeBuilder>(ptr).clearProblemFlag(flag);
}

// ── 1. Optimization ──

export function dae_opt_addObjective(ptr: u32, mayerExprId: u32, lagrangeExprId: u32, sense: i32, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addObjective(mayerExprId, lagrangeExprId, sense, flags);
}

export function dae_opt_getObjectiveCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).objectiveCount;
}

export function dae_opt_getObjectiveMayer(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getObjectivesData().get(idx * OBJ_STRIDE + OBJ_MAYER_EXPR) as u32;
}

export function dae_opt_getObjectiveLagrange(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getObjectivesData().get(idx * OBJ_STRIDE + OBJ_LAGRANGE_EXPR) as u32;
}

export function dae_opt_getObjectiveSense(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getObjectivesData().get(idx * OBJ_STRIDE + OBJ_SENSE);
}

export function dae_opt_getObjectiveFlags(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getObjectivesData().get(idx * OBJ_STRIDE + OBJ_FLAGS);
}

export function dae_opt_addConstraint(ptr: u32, exprId: u32, lb: f64, ub: f64, kindAndFlags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addConstraint(exprId, lb, ub, kindAndFlags);
}

export function dae_opt_getConstraintCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).constraintCount;
}

export function dae_opt_getConstraintExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getConstraintsData().get(idx * CON_STRIDE + CON_EXPR) as u32;
}

export function dae_opt_getConstraintLb(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getConstraintsData();
  let off = idx * CON_STRIDE;
  return unpackF64(tbl.get(off + CON_LB_HI), tbl.get(off + CON_LB_LO));
}

export function dae_opt_getConstraintUb(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getConstraintsData();
  let off = idx * CON_STRIDE;
  return unpackF64(tbl.get(off + CON_UB_HI), tbl.get(off + CON_UB_LO));
}

export function dae_opt_getConstraintKind(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getConstraintsData().get(idx * CON_STRIDE + CON_KIND_FLAGS);
}

export function dae_opt_addCone(ptr: u32, kind: i32, dim: u32): u32 {
  return changetype<DaeBuilder>(ptr).addConeConstraint(kind, dim);
}

export function dae_opt_addConeMember(ptr: u32, coneIdx: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addConeMember(coneIdx, exprId);
}

export function dae_opt_getConeCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).coneCount;
}

export function dae_opt_getConeKind(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getConeData().get(idx * CONE_STRIDE + CONE_KIND);
}

export function dae_opt_getConeMemberStart(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getConeData().get(idx * CONE_STRIDE + CONE_MEMBER_START) as u32;
}

export function dae_opt_getConeMemberCount(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getConeData().get(idx * CONE_STRIDE + CONE_MEMBER_COUNT) as u32;
}

export function dae_opt_getConeDim(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getConeData().get(idx * CONE_STRIDE + CONE_DIM) as u32;
}

export function dae_opt_getConeMember(ptr: u32, memberIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getConeMembers().get(memberIdx) as u32;
}

// ── 2. SDE ──

export function dae_sde_addDiffusion(ptr: u32, stateVarId: u32, noiseChannelId: u32, exprId: u32, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addDiffusion(stateVarId, noiseChannelId, exprId, flags);
}

export function dae_sde_getDiffusionCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).diffusionCount;
}

export function dae_sde_getDiffusionStateVar(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDiffusionData().get(idx * DIFF_STRIDE + DIFF_STATE_VAR) as u32;
}

export function dae_sde_getDiffusionNoiseChannel(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDiffusionData().get(idx * DIFF_STRIDE + DIFF_NOISE_CH) as u32;
}

export function dae_sde_getDiffusionExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDiffusionData().get(idx * DIFF_STRIDE + DIFF_EXPR) as u32;
}

export function dae_sde_getDiffusionFlags(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getDiffusionData().get(idx * DIFF_STRIDE + DIFF_FLAGS);
}

export function dae_sde_setConfig(ptr: u32, noiseType: i32, calculus: i32, brownianDim: u32, seed: u32, ensemblePaths: u32): void {
  changetype<DaeBuilder>(ptr).setSdeConfig(noiseType, calculus, brownianDim, seed, ensemblePaths);
}

export function dae_sde_getNoiseType(ptr: u32): i32 {
  return changetype<DaeBuilder>(ptr).sdeNoiseType;
}

export function dae_sde_getCalculus(ptr: u32): i32 {
  return changetype<DaeBuilder>(ptr).sdeCalculus;
}

export function dae_sde_getBrownianDim(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).sdeBrownianDim;
}

export function dae_sde_getSeed(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).sdeSeed;
}

export function dae_sde_getEnsemblePaths(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).sdeEnsemblePaths;
}

// ── 3. BVP ──

export function dae_bvp_addBoundaryEquation(ptr: u32, lhsId: u32, rhsId: u32, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addBoundaryEquation(lhsId, rhsId, flags);
}

export function dae_bvp_addAtBoundaryExpr(ptr: u32, varId: u32, boundaryPointIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).addAtBoundaryExpr(varId, boundaryPointIdx);
}

export function dae_bvp_setConfig(ptr: u32, method: i32, intervals: u32): void {
  changetype<DaeBuilder>(ptr).setBvpConfig(method, intervals);
}

export function dae_bvp_getMethod(ptr: u32): i32 {
  return changetype<DaeBuilder>(ptr).bvpMethod;
}

export function dae_bvp_getIntervals(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).bvpIntervals;
}

export function dae_bvp_addBoundaryPoint(ptr: u32, tVal: f64): u32 {
  return changetype<DaeBuilder>(ptr).addBvpBoundaryPoint(tVal);
}

export function dae_bvp_getBoundaryPointCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).bvpBoundaryPointCount;
}

export function dae_bvp_getBoundaryPoint(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getBvpBoundaryPoints();
  return unpackF64(tbl.get(idx * 2), tbl.get(idx * 2 + 1));
}

// ── 4. DDE / NDDE ──

export function dae_delay_addChannel(ptr: u32, targetExprId: u32, tauExprId: u32, historyExprId: u32, historyDerivExprId: u32, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addDelayChannel(targetExprId, tauExprId, historyExprId, historyDerivExprId, flags);
}

export function dae_delay_addExpr(ptr: u32, delayChannelIdx: u32, targetExprId: u32, tauExprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addDelayExpr(delayChannelIdx, targetExprId, tauExprId);
}

export function dae_delay_getCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).delayCount;
}

export function dae_delay_getTargetExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDelayData().get(idx * DELAY_STRIDE + DELAY_TARGET_EXPR) as u32;
}

export function dae_delay_getTauExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDelayData().get(idx * DELAY_STRIDE + DELAY_TAU_EXPR) as u32;
}

export function dae_delay_getHistoryExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDelayData().get(idx * DELAY_STRIDE + DELAY_HISTORY_EXPR) as u32;
}

export function dae_delay_getHistoryDerivExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getDelayData().get(idx * DELAY_STRIDE + DELAY_HISTORY_DERIV_EXPR) as u32;
}

export function dae_delay_getFlags(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getDelayData().get(idx * DELAY_STRIDE + DELAY_FLAGS);
}

// ── 5. Jump Process / SSA ──

export function dae_jump_add(ptr: u32, propensityExprId: u32, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addJump(propensityExprId, flags);
}

export function dae_jump_addAffect(ptr: u32, jumpIdx: u32, targetVarId: u32, deltaExprId: u32, mode: i32): u32 {
  return changetype<DaeBuilder>(ptr).addJumpAffect(jumpIdx, targetVarId, deltaExprId, mode);
}

export function dae_jump_getCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).jumpCount;
}

export function dae_jump_getPropensityExpr(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getJumpData().get(idx * JUMP_STRIDE + JUMP_PROPENSITY_EXPR) as u32;
}

export function dae_jump_getAffectStart(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getJumpData().get(idx * JUMP_STRIDE + JUMP_AFFECT_START) as u32;
}

export function dae_jump_getAffectCount(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getJumpData().get(idx * JUMP_STRIDE + JUMP_AFFECT_COUNT) as u32;
}

export function dae_jump_getFlags(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getJumpData().get(idx * JUMP_STRIDE + JUMP_FLAGS);
}

export function dae_jump_getAffectVar(ptr: u32, affectIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getJumpAffects().get(affectIdx * AFFECT_STRIDE + AFFECT_VAR) as u32;
}

export function dae_jump_getAffectExpr(ptr: u32, affectIdx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getJumpAffects().get(affectIdx * AFFECT_STRIDE + AFFECT_EXPR) as u32;
}

export function dae_jump_getAffectMode(ptr: u32, affectIdx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getJumpAffects().get(affectIdx * AFFECT_STRIDE + AFFECT_MODE);
}

// ── 6. Uncertainty, Reachability & STL ──

export function dae_unc_addVar(ptr: u32, varId: u32, distKind: i32, p1: f64, p2: f64): u32 {
  return changetype<DaeBuilder>(ptr).addVarUncertainty(varId, distKind, p1, p2);
}

export function dae_unc_getCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).uncertaintyCount;
}

export function dae_unc_getVarId(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getUncertaintyData().get(idx * UNC_STRIDE + UNC_VAR) as u32;
}

export function dae_unc_getDistKind(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getUncertaintyData().get(idx * UNC_STRIDE + UNC_DIST_KIND);
}

export function dae_unc_getP1(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getUncertaintyData();
  let off = idx * UNC_STRIDE;
  return unpackF64(tbl.get(off + UNC_P1_HI), tbl.get(off + UNC_P1_LO));
}

export function dae_unc_getP2(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getUncertaintyData();
  let off = idx * UNC_STRIDE;
  return unpackF64(tbl.get(off + UNC_P2_HI), tbl.get(off + UNC_P2_LO));
}

export function dae_stl_addNode(ptr: u32, op: i32, leftId: u32, rightId: u32, tLo: f64, tHi: f64, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addStlNode(op, leftId, rightId, tLo, tHi, flags);
}

export function dae_stl_getCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).stlCount;
}

export function dae_stl_getOp(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getStlData().get(idx * STL_STRIDE + STL_OP);
}

export function dae_stl_getLeft(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStlData().get(idx * STL_STRIDE + STL_LEFT) as u32;
}

export function dae_stl_getRight(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStlData().get(idx * STL_STRIDE + STL_RIGHT) as u32;
}

export function dae_stl_getTLo(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getStlData();
  let off = idx * STL_STRIDE;
  return unpackF64(tbl.get(off + STL_TLO_HI), tbl.get(off + STL_TLO_LO));
}

export function dae_stl_getTHi(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getStlData();
  let off = idx * STL_STRIDE;
  return unpackF64(tbl.get(off + STL_THI_HI), tbl.get(off + STL_THI_LO));
}

export function dae_stl_getFlags(ptr: u32, idx: u32): i32 {
  return changetype<DaeBuilder>(ptr).getStlData().get(idx * STL_STRIDE + STL_FLAGS);
}

export function dae_inv_addStateInvariant(ptr: u32, stateId: u32, varId: u32, lo: f64, hi: f64): u32 {
  return changetype<DaeBuilder>(ptr).addStateInvariant(stateId, varId, lo, hi);
}

export function dae_inv_getCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).stateInvariantCount;
}

export function dae_inv_getStateId(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStateInvariants().get(idx * INV_STRIDE + INV_STATE) as u32;
}

export function dae_inv_getVarId(ptr: u32, idx: u32): u32 {
  return changetype<DaeBuilder>(ptr).getStateInvariants().get(idx * INV_STRIDE + INV_VAR) as u32;
}

export function dae_inv_getLo(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getStateInvariants();
  let off = idx * INV_STRIDE;
  return unpackF64(tbl.get(off + INV_LO_HI), tbl.get(off + INV_LO_LO));
}

export function dae_inv_getHi(ptr: u32, idx: u32): f64 {
  let tbl = changetype<DaeBuilder>(ptr).getStateInvariants();
  let off = idx * INV_STRIDE;
  return unpackF64(tbl.get(off + INV_HI_HI), tbl.get(off + INV_HI_LO));
}




