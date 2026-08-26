import { ChunkedInt32Array, createChunkedInt32Array } from "./array";
import { atomicChunkAlloc } from "./arena";
import { UnmanagedMap64, createMap64 } from "./hashmap";

export enum VarType {
  Real = 0,
  Integer = 1,
  Boolean = 2,
  String = 3,
  Enumeration = 4,
  Clock = 5,
}

export enum Variability {
  Continuous = 0,
  Discrete = 1,
  Parameter = 2,
  Constant = 3,
}

export enum Causality {
  Local = 0,
  Input = 1,
  Output = 2,
}

export enum EqKind {
  Simple = 0,
  Array = 1,
  For = 2,
  If = 3,
  When = 4,
  FunctionCall = 5,
  Connect = 6,
  InitialSimple = 7,
  InitialFor = 8,
}

export enum ExprKind {
  Name = 0,
  IntLiteral = 1,
  RealLiteral = 2,
  BoolLiteral = 3,
  StringLiteral = 4,
  Binary = 5,
  Unary = 6,
  Call = 7,
  Subscript = 8,
  ArrayCtor = 9,
  Range = 10,
  IfElse = 11,
  Der = 12,
  Pre = 13,
  Negate = 14,
  Tuple = 15,
  Colon = 16,
  EnumLiteral = 17,
  Comprehension = 18,
  PartialFunc = 19,
  Object = 20,
}

export enum BinOp {
  Add = 0,
  Sub = 1,
  Mul = 2,
  Div = 3,
  Pow = 4,
  ElemAdd = 5,
  ElemSub = 6,
  ElemMul = 7,
  ElemDiv = 8,
  ElemPow = 9,
  And = 10,
  Or = 11,
  Eq = 12,
  Neq = 13,
  Lt = 14,
  Gt = 15,
  Lte = 16,
  Gte = 17,
}

export enum UnaryOp {
  Negate = 0,
  Not = 1,
}

export enum StmtKind {
  Assignment = 0,
  For = 1,
  While = 2,
  If = 3,
  When = 4,
  Return = 5,
  Break = 6,
  ProcedureCall = 7,
  ComplexAssignment = 8,
  Block = 9,
}

export enum VarAttrKind {
  Min = 0,
  Max = 1,
  Unit = 2,
  DisplayUnit = 3,
  Nominal = 4,
  Start = 5,
  Fixed = 6,
}

// Strides & Flags
export const VAR_STRIDE: u32 = 8;
export const VAR_NAME: u32 = 0;
export const VAR_TYPE: u32 = 1;
export const VAR_VARIABILITY: u32 = 2;
export const VAR_CAUSALITY: u32 = 3;
export const VAR_START_HI: u32 = 4;
export const VAR_START_LO: u32 = 5;
export const VAR_SHAPE_DIM: u32 = 6;
export const VAR_FLAGS: u32 = 7;
export const FLAG_TEARING_VAR: i32 = 1 << 0;
export const FLAG_VAR_FLOW: i32 = 1 << 1;
export const FLAG_VAR_STREAM: i32 = 1 << 2;
export const FLAG_VAR_STATE: i32 = 1 << 3;
export const FLAG_VAR_STATE_DER: i32 = 1 << 4;
export const FLAG_VAR_FIXED: i32 = 1 << 5;

export const FLAG_EQ_INITIAL: i32 = 1 << 0;
export const FLAG_EQ_OVERCONSTRAINED: i32 = 1 << 1;
export const FLAG_EQ_STREAM_CONNECT: i32 = 1 << 2;

export const EQ_STRIDE: u32 = 4;
export const EQ_KIND: u32 = 0;
export const EQ_LHS: u32 = 1;
export const EQ_RHS: u32 = 2;
export const EQ_AUX: u32 = 3;

export const EXPR_STRIDE: u32 = 4;
export const EXPR_KIND: u32 = 0;
export const EXPR_DATA1: u32 = 1;
export const EXPR_LEFT: u32 = 2;
export const EXPR_RIGHT: u32 = 3;

export const STMT_STRIDE: u32 = 4;
export const STMT_KIND: u32 = 0;
export const STMT_DATA1: u32 = 1;
export const STMT_LEFT: u32 = 2;
export const STMT_RIGHT: u32 = 3;

export const VAR_ATTR_STRIDE: u32 = 8;
export const CLOCK_STRIDE: u32 = 4;
export const WHEN_STRIDE: u32 = 4;
export const FOR_STRIDE: u32 = 4;
export const IF_STRIDE: u32 = 6;
export const SM_STRIDE: u32 = 4;
export const STATE_STRIDE: u32 = 6;
export const TRANSITION_STRIDE: u32 = 6;

export const FLAG_TRANSITION_IMMEDIATE: i32 = 1 << 0;
export const FLAG_TRANSITION_RESET: i32 = 1 << 1;
export const FLAG_TRANSITION_SYNCHRONIZE: i32 = 1 << 2;

/**
 * Struct-of-Arrays (SoA) Builder for flat Differential Algebraic Equations (DAE).
 * Enables zero-GC memory efficiency when constructing and solving large systems of equations.
 */
@unmanaged
export class DaeBuilder {
  // Core SoA
  varDataPtr: usize;
  varCount: u32;

  eqDataPtr: usize;
  eqCount: u32;

  exprDataPtr: usize;
  exprCount: u32;

  stmtDataPtr: usize;
  stmtCount: u32;

  // Secondary Indices & Maps
  nameIndexPtr: usize;
  aliasDataPtr: usize;

  // Attributes & Shapes
  varAttrDataPtr: usize;
  varShapesPtr: usize;
  varSymbolicShapesPtr: usize;

  // Clocks (§16)
  clocksDataPtr: usize;
  clockCount: u32;
  varClockMapPtr: usize;
  eqClockMapPtr: usize;

  // Compound Equation Side-Tables
  whenMetaPtr: usize;
  whenCount: u32;
  whenBodyEqsPtr: usize;
  whenBodyEqCount: u32;

  forMetaPtr: usize;
  forCount: u32;
  forBodyEqsPtr: usize;
  forBodyEqCount: u32;

  ifMetaPtr: usize;
  ifCount: u32;
  ifBranchEqsPtr: usize;
  ifBranchEqCount: u32;

  // State Machines (§17)
  stateMachinesPtr: usize;
  smCount: u32;
  stateDataPtr: usize;
  stateCount: u32;
  stateEqsPtr: usize;
  stateEqCount: u32;
  stateVarsPtr: usize;
  stateVarCount: u32;
  transitionsPtr: usize;
  transitionCount: u32;

  // Event Indicators & Optimization
  eventIndicatorsPtr: usize;
  eventIndicatorCount: u32;
  objectiveExprId: u32;
  objectiveIntegrandExprId: u32;
  startTimeExprId: u32;
  finalTimeExprId: u32;

  // Snapshots
  snapshotVarCount: u32;
  snapshotEqCount: u32;
  snapshotExprCount: u32;
  snapshotStmtCount: u32;
  snapshotClockCount: u32;
  snapshotWhenCount: u32;
  snapshotForCount: u32;
  snapshotIfCount: u32;
  snapshotSmCount: u32;
  snapshotEventIndicatorCount: u32;

  // Accessors with explicit dereference
  @inline getVarData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("varDataPtr"))); }
  @inline getEqData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("eqDataPtr"))); }
  @inline getExprData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("exprDataPtr"))); }
  @inline getStmtData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("stmtDataPtr"))); }
  @inline getNameIndex(): UnmanagedMap64 { return changetype<UnmanagedMap64>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("nameIndexPtr"))); }
  @inline getAliasData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("aliasDataPtr"))); }
  @inline getVarAttrData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("varAttrDataPtr"))); }
  @inline getVarShapes(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("varShapesPtr"))); }
  @inline getVarSymbolicShapes(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("varSymbolicShapesPtr"))); }
  @inline getClocksData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("clocksDataPtr"))); }
  @inline getVarClockMap(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("varClockMapPtr"))); }
  @inline getEqClockMap(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("eqClockMapPtr"))); }
  @inline getWhenMeta(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("whenMetaPtr"))); }
  @inline getWhenBodyEqs(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("whenBodyEqsPtr"))); }
  @inline getForMeta(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("forMetaPtr"))); }
  @inline getForBodyEqs(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("forBodyEqsPtr"))); }
  @inline getIfMeta(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("ifMetaPtr"))); }
  @inline getIfBranchEqs(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("ifBranchEqsPtr"))); }
  @inline getStateMachines(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("stateMachinesPtr"))); }
  @inline getStateData(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("stateDataPtr"))); }
  @inline getStateEqs(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("stateEqsPtr"))); }
  @inline getStateVars(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("stateVarsPtr"))); }
  @inline getTransitions(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("transitionsPtr"))); }
  @inline getEventIndicators(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<DaeBuilder>("eventIndicatorsPtr"))); }

  // Property getters for idiomatic access
  @inline get varData(): ChunkedInt32Array { return this.getVarData(); }
  @inline get eqData(): ChunkedInt32Array { return this.getEqData(); }
  @inline get exprData(): ChunkedInt32Array { return this.getExprData(); }
  @inline get stmtData(): ChunkedInt32Array { return this.getStmtData(); }
  @inline get nameIndex(): UnmanagedMap64 { return this.getNameIndex(); }
  @inline get aliasData(): ChunkedInt32Array { return this.getAliasData(); }
  @inline get varAttrData(): ChunkedInt32Array { return this.getVarAttrData(); }
  @inline get varShapes(): ChunkedInt32Array { return this.getVarShapes(); }
  @inline get varSymbolicShapes(): ChunkedInt32Array { return this.getVarSymbolicShapes(); }
  @inline get clocksData(): ChunkedInt32Array { return this.getClocksData(); }
  @inline get varClockMap(): ChunkedInt32Array { return this.getVarClockMap(); }
  @inline get eqClockMap(): ChunkedInt32Array { return this.getEqClockMap(); }
  @inline get whenMeta(): ChunkedInt32Array { return this.getWhenMeta(); }
  @inline get whenBodyEqs(): ChunkedInt32Array { return this.getWhenBodyEqs(); }
  @inline get forMeta(): ChunkedInt32Array { return this.getForMeta(); }
  @inline get forBodyEqs(): ChunkedInt32Array { return this.getForBodyEqs(); }
  @inline get ifMeta(): ChunkedInt32Array { return this.getIfMeta(); }
  @inline get ifBranchEqs(): ChunkedInt32Array { return this.getIfBranchEqs(); }
  @inline get stateMachines(): ChunkedInt32Array { return this.getStateMachines(); }
  @inline get stateData(): ChunkedInt32Array { return this.getStateData(); }
  @inline get stateEqs(): ChunkedInt32Array { return this.getStateEqs(); }
  @inline get stateVars(): ChunkedInt32Array { return this.getStateVars(); }
  @inline get transitions(): ChunkedInt32Array { return this.getTransitions(); }
  @inline get eventIndicators(): ChunkedInt32Array { return this.getEventIndicators(); }

  /**
   * Initializes chunked memory arrays and hash structures.
   */
  init(): void {
    this.varDataPtr = changetype<usize>(createChunkedInt32Array(512 * VAR_STRIDE));
    this.varCount = 0;

    this.eqDataPtr = changetype<usize>(createChunkedInt32Array(1024 * EQ_STRIDE));
    this.eqCount = 0;

    this.exprDataPtr = changetype<usize>(createChunkedInt32Array(4096 * EXPR_STRIDE));
    this.exprCount = 0;

    this.stmtDataPtr = changetype<usize>(createChunkedInt32Array(256 * STMT_STRIDE));
    this.stmtCount = 0;

    this.nameIndexPtr = createMap64();
    this.getNameIndex().init(512);
    this.aliasDataPtr = changetype<usize>(createChunkedInt32Array(512));

    this.varAttrDataPtr = changetype<usize>(createChunkedInt32Array(512 * VAR_ATTR_STRIDE));
    this.varShapesPtr = changetype<usize>(createChunkedInt32Array(512 * 4));
    this.varSymbolicShapesPtr = changetype<usize>(createChunkedInt32Array(512 * 4));

    this.clocksDataPtr = changetype<usize>(createChunkedInt32Array(32 * CLOCK_STRIDE));
    this.clockCount = 0;
    this.varClockMapPtr = changetype<usize>(createChunkedInt32Array(512));
    this.eqClockMapPtr = changetype<usize>(createChunkedInt32Array(1024));

    this.whenMetaPtr = changetype<usize>(createChunkedInt32Array(128 * WHEN_STRIDE));
    this.whenCount = 0;
    this.whenBodyEqsPtr = changetype<usize>(createChunkedInt32Array(256 * EQ_STRIDE));
    this.whenBodyEqCount = 0;

    this.forMetaPtr = changetype<usize>(createChunkedInt32Array(128 * FOR_STRIDE));
    this.forCount = 0;
    this.forBodyEqsPtr = changetype<usize>(createChunkedInt32Array(256 * EQ_STRIDE));
    this.forBodyEqCount = 0;

    this.ifMetaPtr = changetype<usize>(createChunkedInt32Array(128 * IF_STRIDE));
    this.ifCount = 0;
    this.ifBranchEqsPtr = changetype<usize>(createChunkedInt32Array(256 * EQ_STRIDE));
    this.ifBranchEqCount = 0;

    this.stateMachinesPtr = changetype<usize>(createChunkedInt32Array(16 * SM_STRIDE));
    this.smCount = 0;
    this.stateDataPtr = changetype<usize>(createChunkedInt32Array(64 * STATE_STRIDE));
    this.stateCount = 0;
    this.stateEqsPtr = changetype<usize>(createChunkedInt32Array(128 * 4));
    this.stateEqCount = 0;
    this.stateVarsPtr = changetype<usize>(createChunkedInt32Array(128 * 4));
    this.stateVarCount = 0;
    this.transitionsPtr = changetype<usize>(createChunkedInt32Array(64 * TRANSITION_STRIDE));
    this.transitionCount = 0;

    this.eventIndicatorsPtr = changetype<usize>(createChunkedInt32Array(128));
    this.eventIndicatorCount = 0;
    this.objectiveExprId = 0xffffffff;
    this.objectiveIntegrandExprId = 0xffffffff;
    this.startTimeExprId = 0xffffffff;
    this.finalTimeExprId = 0xffffffff;

    this.snapshotVarCount = 0;
    this.snapshotEqCount = 0;
    this.snapshotExprCount = 0;
    this.snapshotStmtCount = 0;
    this.snapshotClockCount = 0;
    this.snapshotWhenCount = 0;
    this.snapshotForCount = 0;
    this.snapshotIfCount = 0;
    this.snapshotSmCount = 0;
    this.snapshotEventIndicatorCount = 0;
  }

  /**
   * Resets all equation, variable, expression, and metadata counters.
   */
  @inline
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
    if (this.nameIndexPtr != 0) {
      this.getNameIndex().init(512);
    }
  }

  /**
   * Registers a variable declaration in the DAE system and populates the secondary name index.
   */
  @inline
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

    // Default alias is self (or -1)
    this.getAliasData().set(idx, -1);
    this.getVarClockMap().set(idx, 0);

    // Attribute slot zero-initialization
    let attrOffset = idx * VAR_ATTR_STRIDE;
    for (let a: u32 = 0; a < VAR_ATTR_STRIDE; a++) {
      this.getVarAttrData().set(attrOffset + a, 0xffffffff);
    }

    // Populate O(1) name index
    if (nameId != 0 && this.nameIndexPtr != 0) {
      this.getNameIndex().set(nameId as u64, (idx + 1) as u32);
    }

    return idx;
  }

  /**
   * O(1) Variable Lookup by interned Name StringId.
   * Returns variable index or -1 if not found.
   */
  @inline
  lookupVariableByName(nameId: u32): i32 {
    if (nameId == 0 || this.nameIndexPtr == 0) return -1;
    let val = this.getNameIndex().get(nameId as u64);
    return val > 0 ? ((val - 1) as i32) : -1;
  }

  /**
   * Registers an alias relationship (e.g. `varIdx` is an alias for `targetNameId`).
   */
  @inline
  addAlias(varIdx: u32, targetNameId: u32): void {
    if (varIdx >= this.varCount) return;
    this.getAliasData().set(varIdx, targetNameId as i32);
  }

  /**
   * Gets the alias target Name StringId for a variable, with path compression.
   */
  @inline
  getAlias(varIdx: u32): u32 {
    if (varIdx >= this.varCount) return 0;
    let target = this.getAliasData().get(varIdx);
    return target >= 0 ? (target as u32) : (this.getVarData().get(varIdx * VAR_STRIDE + VAR_NAME) as u32);
  }

  /**
   * Sets an attribute expression (e.g. min, max, unit, start, fixed) for a variable.
   */
  @inline
  setVarAttrExpr(varIdx: u32, attrKind: u32, exprId: u32): void {
    if (varIdx >= this.varCount || attrKind >= VAR_ATTR_STRIDE) return;
    this.getVarAttrData().set(varIdx * VAR_ATTR_STRIDE + attrKind, exprId as i32);
  }

  /**
   * Gets an attribute expression for a variable.
   */
  @inline
  getVarAttrExpr(varIdx: u32, attrKind: u32): u32 {
    if (varIdx >= this.varCount || attrKind >= VAR_ATTR_STRIDE) return 0xffffffff;
    return this.getVarAttrData().get(varIdx * VAR_ATTR_STRIDE + attrKind) as u32;
  }

  /**
   * Sets concrete shape dimension for a variable.
   */
  @inline
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
  @inline
  getVarShapeDim(varIdx: u32, dimIdx: u32): i32 {
    if (varIdx >= this.varCount || dimIdx >= 4) return 0;
    return this.getVarShapes().get(varIdx * 4 + dimIdx);
  }

  /**
   * Sets symbolic shape dimension expression for a variable.
   */
  @inline
  setVarSymbolicShapeExpr(varIdx: u32, dimIdx: u32, exprId: u32): void {
    if (varIdx >= this.varCount || dimIdx >= 4) return;
    this.getVarSymbolicShapes().set(varIdx * 4 + dimIdx, exprId as i32);
  }

  /**
   * Gets symbolic shape dimension expression for a variable.
   */
  @inline
  getVarSymbolicShapeExpr(varIdx: u32, dimIdx: u32): u32 {
    if (varIdx >= this.varCount || dimIdx >= 4) return 0xffffffff;
    return this.getVarSymbolicShapes().get(varIdx * 4 + dimIdx) as u32;
  }

  /**
   * Registers a discrete clock domain (Modelica 3.7 §16).
   */
  @inline
  addClock(intervalExprId: u32, resolutionExprId: u32 = 0xffffffff, shiftExprId: u32 = 0xffffffff): u32 {
    let id = ++this.clockCount;
    let offset = (id - 1) * CLOCK_STRIDE;
    this.getClocksData().set(offset + 0, intervalExprId as i32);
    this.getClocksData().set(offset + 1, resolutionExprId as i32);
    this.getClocksData().set(offset + 2, shiftExprId as i32);
    this.getClocksData().set(offset + 3, 0);
    return id;
  }

  @inline
  setVarClock(varIdx: u32, clockId: u32): void {
    if (varIdx >= this.varCount) return;
    this.getVarClockMap().set(varIdx, clockId as i32);
  }

  @inline
  getVarClock(varIdx: u32): u32 {
    if (varIdx >= this.varCount) return 0;
    return this.getVarClockMap().get(varIdx) as u32;
  }

  @inline
  setEqClock(eqIdx: u32, clockId: u32): void {
    if (eqIdx >= this.eqCount) return;
    this.getEqClockMap().set(eqIdx, clockId as i32);
  }

  @inline
  getEqClock(eqIdx: u32): u32 {
    if (eqIdx >= this.eqCount) return 0;
    return this.getEqClockMap().get(eqIdx) as u32;
  }

  /**
   * Adds a compound when-equation block (keeps body out of root BLT count).
   */
  @inline
  addWhenEquation(conditionExprId: u32): u32 {
    let idx = this.whenCount++;
    let offset = idx * WHEN_STRIDE;
    this.getWhenMeta().set(offset + 0, conditionExprId as i32);
    this.getWhenMeta().set(offset + 1, this.whenBodyEqCount as i32); // bodyOffset
    this.getWhenMeta().set(offset + 2, 0); // bodyCount
    this.getWhenMeta().set(offset + 3, 0xffffffff); // elseWhenOffset
    return idx;
  }

  @inline
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
  @inline
  addForEquation(indexNameId: u32, rangeExprId: u32): u32 {
    let idx = this.forCount++;
    let offset = idx * FOR_STRIDE;
    this.getForMeta().set(offset + 0, indexNameId as i32);
    this.getForMeta().set(offset + 1, rangeExprId as i32);
    this.getForMeta().set(offset + 2, this.forBodyEqCount as i32); // bodyOffset
    this.getForMeta().set(offset + 3, 0); // bodyCount
    return idx;
  }

  @inline
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
  @inline
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

  @inline
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
  @inline
  addStateMachine(nameId: u32, initialStateId: u32): u32 {
    let idx = this.smCount++;
    let offset = idx * SM_STRIDE;
    this.getStateMachines().set(offset + 0, nameId as i32);
    this.getStateMachines().set(offset + 1, initialStateId as i32);
    this.getStateMachines().set(offset + 2, this.stateCount as i32);
    this.getStateMachines().set(offset + 3, 0);
    return idx;
  }

  @inline
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

  @inline
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

  @inline
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
  @inline
  addEventIndicator(exprId: u32): u32 {
    let idx = this.eventIndicatorCount++;
    this.getEventIndicators().set(idx, exprId as i32);
    return idx;
  }

  @inline
  getEventIndicatorCount(): u32 {
    return this.eventIndicatorCount;
  }

  @inline
  getEventIndicatorExprId(idx: u32): u32 {
    if (idx >= this.eventIndicatorCount) return 0xffffffff;
    return this.getEventIndicators().get(idx) as u32;
  }

  /**
   * Sets optimization objective expressions.
   */
  @inline
  setOptimizationObjective(objExpr: u32, integrandExpr: u32, startExpr: u32, finalExpr: u32): void {
    this.objectiveExprId = objExpr;
    this.objectiveIntegrandExprId = integrandExpr;
    this.startTimeExprId = startExpr;
    this.finalTimeExprId = finalExpr;
  }

  /**
   * Adds an expression node to the DAE system.
   */
  @inline
  addExpression(kind: i32, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.exprCount++;
    let offset = idx * EXPR_STRIDE;

    this.getExprData().set(offset + EXPR_KIND, kind);
    this.getExprData().set(offset + EXPR_DATA1, data1);
    this.getExprData().set(offset + EXPR_LEFT, left);
    this.getExprData().set(offset + EXPR_RIGHT, right);
    return idx;
  }

  @inline
  addName(varId: u32): u32 {
    return this.addExpression(ExprKind.Name, varId);
  }

  @inline
  addIntLiteral(value: i32): u32 {
    return this.addExpression(ExprKind.IntLiteral, value as u32);
  }

  @inline
  addRealLiteral(value: f64): u32 {
    let bits = i64.reinterpret_f64(value) as u64;
    let lo = (bits & 0xffffffff) as u32;
    let hi = (bits >> 32) as u32;
    return this.addExpression(ExprKind.RealLiteral, lo, hi);
  }

  @inline
  addBinaryExpr(op: u16, left: u32, right: u32): u32 {
    return this.addExpression(ExprKind.Binary, op as u32, left, right);
  }

  @inline
  addDer(varId: u32): u32 {
    return this.addExpression(ExprKind.Der, varId);
  }

  @inline
  addIfElse(condExpr: u32, trueExpr: u32, falseExpr: u32): u32 {
    return this.addExpression(ExprKind.IfElse, condExpr, trueExpr, falseExpr);
  }

  @inline
  addCall(funcId: i32, firstArg: u32, argCount: u32): u32 {
    return this.addExpression(ExprKind.Call, funcId as u32, firstArg, argCount);
  }

  @inline
  getVarCount(): i32 {
    return this.varCount as i32;
  }

  @inline
  getVarNameId(varIdx: u32): u32 {
    if (varIdx >= this.varCount) return 0;
    return this.getVarData().get(varIdx * VAR_STRIDE + VAR_NAME) as u32;
  }

  @inline
  getVarType(varIdx: u32): i32 {
    if (varIdx >= this.varCount) return -1;
    return this.getVarData().get(varIdx * VAR_STRIDE + VAR_TYPE);
  }

  @inline
  getVarStartValue(varId: u32): f64 {
    if (varId >= this.varCount) return 0.0;
    let hi = (this.getVarData().get(varId * VAR_STRIDE + VAR_START_HI) as u64) << 32;
    let lo = (this.getVarData().get(varId * VAR_STRIDE + VAR_START_LO) as u64) & 0xffffffff;
    return f64.reinterpret_i64((hi | lo) as i64);
  }

  @inline
  setVarStartValue(varId: u32, val: f64): void {
    if (varId >= this.varCount) return;
    let bits = i64.reinterpret_f64(val) as u64;
    let hi = (bits >> 32) as u32;
    let lo = (bits & 0xffffffff) as u32;
    this.getVarData().set(varId * VAR_STRIDE + VAR_START_HI, hi);
    this.getVarData().set(varId * VAR_STRIDE + VAR_START_LO, lo);
  }

  @inline
  getWarmStartValue(varId: u32): f64 {
    return this.getVarStartValue(varId);
  }

  @inline
  setWarmStartValue(varId: u32, val: f64): void {
    this.setVarStartValue(varId, val);
  }

  @inline
  isVarFlow(varIdx: u32): boolean {
    if (varIdx >= this.varCount) return false;
    return (this.getVarData().get(varIdx * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_FLOW) != 0;
  }

  /**
   * Adds an equation to the DAE system (e.g. `lhs = rhs`).
   */
  @inline
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
  @inline
  addStatement(kind: i32, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.stmtCount++;
    let offset = idx * STMT_STRIDE;

    this.getStmtData().set(offset + STMT_KIND, kind);
    this.getStmtData().set(offset + STMT_DATA1, data1);
    this.getStmtData().set(offset + STMT_LEFT, left);
    this.getStmtData().set(offset + STMT_RIGHT, right);

    return idx;
  }

  @inline
  setVarFlag(varId: u32, flag: i32): void {
    if (varId >= this.varCount) return;
    let offset = varId * VAR_STRIDE + VAR_FLAGS;
    let curr = this.getVarData().get(offset);
    this.getVarData().set(offset, curr | flag);
  }

  @inline
  hasVarFlag(varId: u32, flag: i32): boolean {
    if (varId >= this.varCount) return false;
    let offset = varId * VAR_STRIDE + VAR_FLAGS;
    return (this.getVarData().get(offset) & flag) != 0;
  }

  @inline
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
   * Captures a snapshot checkpoint of all variable, equation, and metadata counts.
   */
  @inline
  snapshot(): void {
    this.snapshotVarCount = this.varCount;
    this.snapshotEqCount = this.eqCount;
    this.snapshotExprCount = this.exprCount;
    this.snapshotStmtCount = this.stmtCount;
    this.snapshotClockCount = this.clockCount;
    this.snapshotWhenCount = this.whenCount;
    this.snapshotForCount = this.forCount;
    this.snapshotIfCount = this.ifCount;
    this.snapshotSmCount = this.smCount;
    this.snapshotEventIndicatorCount = this.eventIndicatorCount;
  }

  /**
   * Restores the DAE system state back to the previous snapshot checkpoint.
   */
  @inline
  rollback(): void {
    this.varCount = this.snapshotVarCount;
    this.getVarData().length = this.varCount * VAR_STRIDE;
    
    this.eqCount = this.snapshotEqCount;
    this.getEqData().length = this.eqCount * EQ_STRIDE;
    
    this.exprCount = this.snapshotExprCount;
    this.getExprData().length = this.exprCount * EXPR_STRIDE;

    this.stmtCount = this.snapshotStmtCount;
    this.getStmtData().length = this.stmtCount * STMT_STRIDE;

    this.clockCount = this.snapshotClockCount;
    this.whenCount = this.snapshotWhenCount;
    this.forCount = this.snapshotForCount;
    this.ifCount = this.snapshotIfCount;
    this.smCount = this.snapshotSmCount;
    this.eventIndicatorCount = this.snapshotEventIndicatorCount;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

const DAE_BUILDER_SIZE: u32 = 256;

export function dae_createBuilder(): u32 {
  let ptr = atomicChunkAlloc(DAE_BUILDER_SIZE);
  let builder = changetype<DaeBuilder>(ptr);
  builder.init();
  return ptr as u32;
}

export function dae_free(ptr: u32): void {
  if (ptr == 0) return;
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
  return (changetype<u32>(b.clocksDataPtr) & 0xffff) | ((changetype<u32>(b.varClockMapPtr) & 0xffff) << 16);
}

export function dae_getOffsets(): u32 {
  let varOffset = offsetof<DaeBuilder>("varCount");
  let clockOffset = offsetof<DaeBuilder>("clockCount");
  return (varOffset << 16) | (clockOffset & 0xffff);
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

export function dae_addRealLiteral(ptr: u32, value: f64): u32 {
  return changetype<DaeBuilder>(ptr).addRealLiteral(value);
}

export function dae_addIntLiteral(ptr: u32, value: i32): u32 {
  return changetype<DaeBuilder>(ptr).addIntLiteral(value);
}

export function dae_addEquation(ptr: u32, kind: i32, lhsId: u32, rhsId: u32, auxId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addEquation(kind, lhsId, rhsId, auxId);
}

export function dae_setVarFlag(ptr: u32, varId: u32, flag: i32): void {
  changetype<DaeBuilder>(ptr).setVarFlag(varId, flag);
}

export function dae_getEqCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).eqCount;
}

export function dae_getVarCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).varCount;
}

export function dae_getExprCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).exprCount;
}

export function dae_getExprKind(ptr: u32, exprId: u32): i32 {
  return changetype<DaeBuilder>(ptr).getExprData().get(exprId * 4 + 0);
}

export function dae_getExprData1(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getExprData().get(exprId * 4 + 1);
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

export function dae_getEqLhs(ptr: u32, eqId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_LHS) as u32;
}

export function dae_getEqRhs(ptr: u32, eqId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_RHS) as u32;
}

export function dae_getEqAux(ptr: u32, eqId: u32): u32 {
  return changetype<DaeBuilder>(ptr).getEqData().get(eqId * EQ_STRIDE + EQ_AUX) as u32;
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



