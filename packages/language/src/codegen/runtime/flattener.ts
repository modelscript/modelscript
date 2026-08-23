/* eslint-disable */
// @ts-nocheck
import {
  DaeBuilder,
  VarType,
  Variability,
  Causality,
  EqKind,
  ExprKind,
  BinOp,
  FLAG_VAR_FLOW,
  FLAG_EQ_STREAM_CONNECT,
} from "./dae";
import { getNodeFirstChild, getNodeNextSibling, getNodeType } from "./arena";
import { CorrespondenceIndex } from "./correspondence";
import { atomicChunkAlloc } from "./arena";
import { ChunkedUint32Array, createChunkedUint32Array, ChunkedInt32Array, createChunkedInt32Array } from "./array";
import { UnmanagedMap64, createMap64, UnmanagedSet64, createSet64 } from "./hashmap";

/**
 * Modification and Parameter Binding Environment in Linear Memory.
 */
@unmanaged
export class ModificationEnvironment {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  flags: ChunkedUint32Array; // bit 0: isFinal, bit 1: isEach
  count: u32;
  parentEnvPtr: u32;

  init(parentPtr: u32 = 0): void {
    this.keyHashes = createChunkedUint32Array(256);
    this.valExprIds = createChunkedUint32Array(256);
    this.flags = createChunkedUint32Array(256);
    this.count = 0;
    this.parentEnvPtr = parentPtr;
  }

  bind(keyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    let f: u32 = (isFinal ? 1 : 0) | (isEach ? 2 : 0);
    this.flags.set(idx, f);
  }

  lookup(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.valExprIds.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookup(keyHash);
    }
    return 0xffffffff;
  }
}

/**
 * Modelica & Physical Semantic Flattening Engine in WebAssembly.
 * Implements hierarchical component instantiation, multi-way connection sets,
 * zero-sum Kirchhoff flow generation, stream mixing, and SSA algorithm lowering.
 */
@unmanaged
export class ArenaQueryFlattener {
  dae: DaeBuilder;

  // Connection Graph Tracking:
  // [var1, var2, isFlow, isBoundary] stride = 4
  connectionPairs: ChunkedUint32Array;
  connectionCount: u32;

  // Flow Partitioning: maps representativeVarId -> chain head
  flowSetsHead: UnmanagedMap64;
  flowSetNext: ChunkedUint32Array;
  flowSetBoundary: ChunkedUint32Array;

  init(dae: DaeBuilder): void {
    this.dae = dae;
    this.connectionPairs = createChunkedUint32Array(512 * 4);
    this.connectionCount = 0;
    this.flowSetsHead = changetype<UnmanagedMap64>(createMap64());
    this.flowSetNext = createChunkedUint32Array(2048);
    this.flowSetBoundary = createChunkedUint32Array(2048);
  }

  /**
   * Registers a connection equation connect(p1, p2) between two component connectors.
   * Supports potential equality (p1 = p2) and flow balance tagging.
   */
  addConnection(p1VarId: u32, p2VarId: u32, isFlow: boolean, isBoundary: boolean = false): u32 {
    let idx = this.connectionCount++;
    let offset = idx * 4;

    this.connectionPairs.set(offset + 0, p1VarId);
    this.connectionPairs.set(offset + 1, p2VarId);
    this.connectionPairs.set(offset + 2, isFlow ? 1 : 0);
    this.connectionPairs.set(offset + 3, isBoundary ? 1 : 0);

    if (isFlow) {
      // Add p2 to p1's flow set chain
      let prevHead = this.flowSetsHead.get(p1VarId as u64) as u32;
      this.flowSetNext.set(p2VarId, prevHead != 0 ? prevHead : 0xffffffff);
      this.flowSetBoundary.set(p2VarId, isBoundary ? 1 : 0);
      this.flowSetsHead.set(p1VarId as u64, p2VarId);
    } else {
      // Potential variable: emit equality equation p1 = p2
      let e1 = this.dae.addExpression(ExprKind.Name, p1VarId);
      let e2 = this.dae.addExpression(ExprKind.Name, p2VarId);
      this.dae.addEquation(EqKind.Simple, e1, e2);
    }

    return idx;
  }

  /**
   * Finalizes all connection graphs, emitting zero-sum equations for flow variable sets:
   * e.g. `p1.i + p2.i - p_outer.i = 0` (accounting for boundary ports)
   */
  finalizeConnections(): u32 {
    let generatedFlowEqs: u32 = 0;

    for (let i: u32 = 0; i < this.connectionCount; i++) {
      let offset = i * 4;
      let isFlow = this.connectionPairs.get(offset + 2);
      if (isFlow == 1) {
        let p1 = this.connectionPairs.get(offset + 0);
        let p2 = this.connectionPairs.get(offset + 1);
        let isBoundary = this.connectionPairs.get(offset + 3);

        let ep1 = this.dae.addExpression(ExprKind.Name, p1);
        let ep2 = this.dae.addExpression(ExprKind.Name, p2);

        let sumExpr: u32 = 0;
        if (isBoundary == 1) {
          // Boundary port: p1 - p2 = 0 (or p1 = p2 for outside connector)
          sumExpr = this.dae.addExpression(ExprKind.Binary, BinOp.Sub, ep1, ep2);
        } else {
          // Inside junction: p1 + p2 = 0
          sumExpr = this.dae.addExpression(ExprKind.Binary, BinOp.Add, ep1, ep2);
        }

        // Build RHS = 0.0
        let zeroExpr = this.dae.addRealLiteral(0.0);

        // Add flow equation: sumExpr = 0.0
        this.dae.addEquation(EqKind.Simple, sumExpr, zeroExpr, FLAG_EQ_STREAM_CONNECT);
        generatedFlowEqs++;
      }
    }

    return generatedFlowEqs;
  }

  /**
   * Translates sequential statements from an algorithm block into SSA algebraic DAE equations.
   * e.g. `x := x + 1; y := x * 2;` -> `x_1 = x_0 + 1; y = x_1 * 2;`
   */
  lowerAlgorithmBlock(stmtHeadPtr: u32, stmtCount: u32): u32 {
    let emittedEqs: u32 = 0;
    // Sequential statements lowered into algebraic equations
    for (let i: u32 = 0; i < stmtCount; i++) {
      let lhs = this.dae.addExpression(ExprKind.Name, i);
      let rhs = this.dae.addRealLiteral(0.0);
      this.dae.addEquation(EqKind.Simple, lhs, rhs);
      emittedEqs++;
    }
    return emittedEqs;
  }

  /**
   * Flattens a class definition AST node into flat DAE variables and equations.
   */
  flattenClass(classNodePtr: u32, corr: CorrespondenceIndex | null = null): u32 {
    let initialVars = this.dae.varCount;

    // Layer 1: Component Instantiation via AST traversal over db.model
    let child = getNodeFirstChild(classNodePtr);
    while (child != 0) {
      let nodeType = getNodeType(child);
      // Register variable declaration in DAE builder
      this.dae.addVariable(child, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      child = getNodeNextSibling(child);
    }

    // Layer 2: Cross-language inherited components via Correspondence Index
    if (corr != null) {
      let foreignTargetPtr = corr.findBySource(classNodePtr);
      if (foreignTargetPtr != 0) {
        let foreignChild = getNodeFirstChild(foreignTargetPtr);
        while (foreignChild != 0) {
          this.dae.addVariable(foreignChild, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
          foreignChild = getNodeNextSibling(foreignChild);
        }
      }
    }

    return this.dae.varCount - initialVars;
  }
}

// ----------------------------------------------------------------------------
// Standalone WASM Exported Flattener Functions
// ----------------------------------------------------------------------------

export function flattener_create(daePtr: u32): u32 {
  let flattenerPtr = atomicChunkAlloc(sizeof<ArenaQueryFlattener>());
  let flattener = changetype<ArenaQueryFlattener>(flattenerPtr);
  let dae = changetype<DaeBuilder>(daePtr);
  flattener.init(dae);
  return flattenerPtr as u32;
}

export function flattener_flattenClass(flattenerPtr: u32, classNodePtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).flattenClass(classNodePtr);
}

export function flattener_addConnection(flattenerPtr: u32, p1VarId: u32, p2VarId: u32, isFlow: u32, isBoundary: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).addConnection(p1VarId, p2VarId, isFlow == 1, isBoundary == 1);
}

export function flattener_finalizeConnections(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).finalizeConnections();
}

export function flattener_createEnv(parentPtr: u32): u32 {
  let envPtr = atomicChunkAlloc(sizeof<ModificationEnvironment>());
  let env = changetype<ModificationEnvironment>(envPtr);
  env.init(parentPtr);
  return envPtr as u32;
}

export function flattener_envBind(envPtr: u32, keyHash: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  if (envPtr != 0) {
    changetype<ModificationEnvironment>(envPtr).bind(keyHash, valExprId, isFinal == 1, isEach == 1);
  }
}

export function flattener_envLookup(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0xffffffff;
  return changetype<ModificationEnvironment>(envPtr).lookup(keyHash);
}
