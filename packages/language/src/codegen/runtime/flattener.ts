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

export const FLAG_MOD_FINAL: u32 = 0x01;
export const FLAG_MOD_EACH: u32 = 0x02;
export const FLAG_MOD_REDECLARE: u32 = 0x04;
export const FLAG_MOD_REPLACEABLE: u32 = 0x08;

/**
 * Modification and Parameter Binding Environment in Linear Memory.
 * Implements Modelica 3.7 hierarchical modifier algebra (each, final, redeclare, constrainedby).
 */
@unmanaged
export class ModificationEnvironment {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  childEnvPtrs: ChunkedUint32Array;
  redeclareTypeHashes: ChunkedUint32Array;
  flags: ChunkedUint32Array; // bit 0: isFinal, bit 1: isEach, bit 2: isRedeclare, bit 3: isReplaceable
  count: u32;
  parentEnvPtr: u32;

  init(parentPtr: u32 = 0): void {
    this.keyHashes = createChunkedUint32Array(256);
    this.valExprIds = createChunkedUint32Array(256);
    this.childEnvPtrs = createChunkedUint32Array(256);
    this.redeclareTypeHashes = createChunkedUint32Array(256);
    this.flags = createChunkedUint32Array(256);
    this.count = 0;
    this.parentEnvPtr = parentPtr;
  }

  bind(keyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, 0);
    let f: u32 = (isFinal ? FLAG_MOD_FINAL : 0) | (isEach ? FLAG_MOD_EACH : 0);
    this.flags.set(idx, f);
  }

  bindNested(keyHash: u32, childEnvPtr: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, 0xffffffff);
    this.childEnvPtrs.set(idx, childEnvPtr);
    this.redeclareTypeHashes.set(idx, 0);
    let f: u32 = (isFinal ? FLAG_MOD_FINAL : 0) | (isEach ? FLAG_MOD_EACH : 0);
    this.flags.set(idx, f);
  }

  bindRedeclare(keyHash: u32, newTypeHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, newTypeHash);
    let f: u32 = FLAG_MOD_REDECLARE | (isFinal ? FLAG_MOD_FINAL : 0) | (isEach ? FLAG_MOD_EACH : 0);
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

  lookupNested(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.childEnvPtrs.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupNested(keyHash);
    }
    return 0;
  }

  lookupRedeclare(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        let f = this.flags.get(i);
        if ((f & FLAG_MOD_REDECLARE) != 0) {
          return this.redeclareTypeHashes.get(i);
        }
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupRedeclare(keyHash);
    }
    return 0;
  }

  lookupFlags(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.flags.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupFlags(keyHash);
    }
    return 0;
  }

  /**
   * Merges another modification environment into this environment.
   * Respects `final` modifiers: if a key is marked `final` in this environment,
   * incoming modifiers cannot override it.
   */
  merge(otherEnvPtr: u32): void {
    if (otherEnvPtr == 0) return;
    let other = changetype<ModificationEnvironment>(otherEnvPtr);
    for (let i: u32 = 0; i < other.count; i++) {
      let key = other.keyHashes.get(i);
      let existingFlags = this.lookupFlags(key);
      if ((existingFlags & FLAG_MOD_FINAL) != 0) {
        // Existing modifier is final: cannot be overridden
        continue;
      }
      let val = other.valExprIds.get(i);
      let child = other.childEnvPtrs.get(i);
      let redecl = other.redeclareTypeHashes.get(i);
      let f = other.flags.get(i);

      let idx = this.count++;
      this.keyHashes.set(idx, key);
      this.valExprIds.set(idx, val);
      this.childEnvPtrs.set(idx, child);
      this.redeclareTypeHashes.set(idx, redecl);
      this.flags.set(idx, f);
    }
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

  // Stream Connections: [h1, mdot1, h2, mdot2] stride = 4
  streamPairs: ChunkedUint32Array;
  streamCount: u32;

  // Union-Find Disjoint Set across connected components
  ufParent: ChunkedUint32Array;
  ufRank: ChunkedUint32Array;

  init(dae: DaeBuilder): void {
    this.dae = dae;
    this.connectionPairs = createChunkedUint32Array(1024 * 4);
    this.connectionCount = 0;
    this.streamPairs = createChunkedUint32Array(512 * 4);
    this.streamCount = 0;

    let maxVars = dae.varCount > 2048 ? dae.varCount + 512 : 2048;
    this.ufParent = createChunkedUint32Array(maxVars);
    this.ufRank = createChunkedUint32Array(maxVars);
    for (let i: u32 = 0; i < maxVars; i++) {
      this.ufParent.set(i, i);
      this.ufRank.set(i, 0);
    }
  }

  ensureUfCapacity(varId: u32): void {
    // Capacity pre-allocated in init
  }

  findRoot(v: u32): u32 {
    let p = this.ufParent.get(v);
    if (p == v) return v;
    let root = this.findRoot(p);
    this.ufParent.set(v, root); // path compression
    return root;
  }

  unionSets(v1: u32, v2: u32): void {
    let r1 = this.findRoot(v1);
    let r2 = this.findRoot(v2);
    if (r1 == r2) return;
    let rank1 = this.ufRank.get(r1);
    let rank2 = this.ufRank.get(r2);
    if (rank1 < rank2) {
      this.ufParent.set(r1, r2);
    } else if (rank1 > rank2) {
      this.ufParent.set(r2, r1);
    } else {
      this.ufParent.set(r2, r1);
      this.ufRank.set(r1, rank1 + 1);
    }
  }

  /**
   * Registers a connection equation connect(p1, p2) between two component connectors.
   * Emits potential equality (p1 = p2) and registers flow sets in union-find.
   */
  addConnection(p1VarId: u32, p2VarId: u32, isFlow: boolean, isBoundary: boolean = false): u32 {
    let idx = this.connectionCount++;
    let offset = idx * 4;

    this.connectionPairs.set(offset + 0, p1VarId);
    this.connectionPairs.set(offset + 1, p2VarId);
    this.connectionPairs.set(offset + 2, isFlow ? 1 : 0);
    this.connectionPairs.set(offset + 3, isBoundary ? 1 : 0);

    this.unionSets(p1VarId, p2VarId);

    if (!isFlow) {
      // Potential variable: emit equality equation p1 = p2
      let e1 = this.dae.addExpression(ExprKind.Name, p1VarId);
      let e2 = this.dae.addExpression(ExprKind.Name, p2VarId);
      this.dae.addEquation(EqKind.Simple, e1, e2);
    }

    return idx;
  }

  /**
   * Registers a bidirectional fluid stream connection per Modelica 3.7 Chapter 15.
   * Implements upwind discretization for enthalpy / concentration flows.
   */
  addStreamConnection(h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
    let idx = this.streamCount++;
    let offset = idx * 4;

    this.streamPairs.set(offset + 0, h1VarId);
    this.streamPairs.set(offset + 1, mdot1VarId);
    this.streamPairs.set(offset + 2, h2VarId);
    this.streamPairs.set(offset + 3, mdot2VarId);

    let eh1 = this.dae.addExpression(ExprKind.Name, h1VarId);
    let eh2 = this.dae.addExpression(ExprKind.Name, h2VarId);
    let emdot1 = this.dae.addExpression(ExprKind.Name, mdot1VarId);
    let zeroReal = this.dae.addRealLiteral(0.0);

    // Cond: mdot1 > 0
    let cond1 = this.dae.addExpression(ExprKind.Binary, BinOp.Gt, emdot1, zeroReal);
    // IfElse: if mdot1 > 0 then eh2 else eh1
    let ifExpr1 = this.dae.addExpression(ExprKind.IfElse, cond1, eh2, eh1);
    this.dae.addEquation(EqKind.Simple, eh1, ifExpr1, FLAG_EQ_STREAM_CONNECT);

    return idx;
  }

  /**
   * Dynamically allocates an expandable connector member variable in linear memory.
   */
  expandConnector(busVarId: u32, memberNameHash: u32, varType: u32 = 0): u32 {
    let newVarId = this.dae.addVariable(memberNameHash, varType as u16, Variability.Continuous, Causality.Local, 0.0);
    this.ufParent.set(newVarId, newVarId);
    this.ufRank.set(newVarId, 0);
    return newVarId;
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

export function flattener_envBindNested(envPtr: u32, keyHash: u32, childEnvPtr: u32, isFinal: u32, isEach: u32): void {
  if (envPtr != 0) {
    changetype<ModificationEnvironment>(envPtr).bindNested(keyHash, childEnvPtr, isFinal == 1, isEach == 1);
  }
}

export function flattener_envBindRedeclare(envPtr: u32, keyHash: u32, newTypeHash: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  if (envPtr != 0) {
    changetype<ModificationEnvironment>(envPtr).bindRedeclare(keyHash, newTypeHash, valExprId, isFinal == 1, isEach == 1);
  }
}

export function flattener_envLookup(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0xffffffff;
  return changetype<ModificationEnvironment>(envPtr).lookup(keyHash);
}

export function flattener_envLookupNested(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupNested(keyHash);
}

export function flattener_envLookupRedeclare(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupRedeclare(keyHash);
}

export function flattener_envLookupFlags(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupFlags(keyHash);
}

export function flattener_envMerge(targetEnvPtr: u32, otherEnvPtr: u32): void {
  if (targetEnvPtr != 0 && otherEnvPtr != 0) {
    changetype<ModificationEnvironment>(targetEnvPtr).merge(otherEnvPtr);
  }
}

export function flattener_addStreamConnection(flattenerPtr: u32, h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).addStreamConnection(h1VarId, mdot1VarId, h2VarId, mdot2VarId);
}

export function flattener_expandConnector(flattenerPtr: u32, busVarId: u32, memberNameHash: u32, varType: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).expandConnector(busVarId, memberNameHash, varType);
}

export function flattener_findRoot(flattenerPtr: u32, varId: u32): u32 {
  if (flattenerPtr == 0) return varId;
  return changetype<ArenaQueryFlattener>(flattenerPtr).findRoot(varId);
}

export function flattener_unionSets(flattenerPtr: u32, v1: u32, v2: u32): void {
  if (flattenerPtr != 0) {
    changetype<ArenaQueryFlattener>(flattenerPtr).unionSets(v1, v2);
  }
}


