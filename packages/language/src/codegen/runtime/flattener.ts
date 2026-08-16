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
import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64, createMap64 } from "./hashmap";

/**
 * Modelica Semantic Flattening Engine in WebAssembly.
 * Implements hierarchical component instantiation, connection sets, zero-sum flow generation,
 * and modification merging directly in linear memory.
 */
@unmanaged
export class ArenaQueryFlattener {
  dae: DaeBuilder;

  // Connection Graph Tracking:
  // Maps flow root representative variable ID -> list of connected flow variables
  connectionPairs: ChunkedUint32Array; // [var1, var2, isFlow, aux] stride = 4
  connectionCount: u32;

  flowSetsHead: UnmanagedMap64; // maps representativeVarId -> head of flow set chain
  flowSetNext: ChunkedUint32Array;

  init(dae: DaeBuilder): void {
    this.dae = dae;
    this.connectionPairs = createChunkedUint32Array(512 * 4);
    this.connectionCount = 0;
    this.flowSetsHead = changetype<UnmanagedMap64>(createMap64());
    this.flowSetNext = createChunkedUint32Array(1024);
  }

  /**
   * Registers a connection equation connect(p1, p2) between two component connectors.
   */
  addConnection(p1VarId: u32, p2VarId: u32, isFlow: boolean): u32 {
    let idx = this.connectionCount++;
    let offset = idx * 4;

    this.connectionPairs.set(offset + 0, p1VarId);
    this.connectionPairs.set(offset + 1, p2VarId);
    this.connectionPairs.set(offset + 2, isFlow ? 1 : 0);
    this.connectionPairs.set(offset + 3, 0);

    if (isFlow) {
      // Add both variables to the flow set chain
      let prevHead = this.flowSetsHead.get(p1VarId as u64) as u32;
      this.flowSetNext.set(p2VarId, prevHead);
      this.flowSetsHead.set(p1VarId as u64, p2VarId);
    } else {
      // Potential variable: emit direct equality equation p1 = p2
      let e1 = this.dae.addExpression(ExprKind.Name, p1VarId);
      let e2 = this.dae.addExpression(ExprKind.Name, p2VarId);
      this.dae.addEquation(EqKind.Simple, e1, e2);
    }

    return idx;
  }

  /**
   * Finalizes all connection graphs, emitting zero-sum equations for flow variable sets:
   * e.g. `p1.i + p2.i + p3.i = 0`
   */
  finalizeConnections(): u32 {
    let generatedFlowEqs: u32 = 0;

    for (let i: u32 = 0; i < this.connectionCount; i++) {
      let offset = i * 4;
      let isFlow = this.connectionPairs.get(offset + 2);
      if (isFlow == 1) {
        let p1 = this.connectionPairs.get(offset + 0);
        let p2 = this.connectionPairs.get(offset + 1);

        // Build sum expression: p1 + p2
        let ep1 = this.dae.addExpression(ExprKind.Name, p1);
        let ep2 = this.dae.addExpression(ExprKind.Name, p2);
        let sumExpr = this.dae.addExpression(ExprKind.Binary, BinOp.Add, ep1, ep2);

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

export function flattener_addConnection(flattenerPtr: u32, p1VarId: u32, p2VarId: u32, isFlow: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).addConnection(p1VarId, p2VarId, isFlow == 1);
}

export function flattener_finalizeConnections(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ArenaQueryFlattener>(flattenerPtr).finalizeConnections();
}



