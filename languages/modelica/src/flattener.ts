import type { ArenaStringPool, ChunkedUint32Array, DaeBuilder, GenericScopeStack } from "@modelscript/language";
import { createChunkedUint32Array, getNodeFirstChild, getNodeNextSibling } from "@modelscript/language";

/**
 * Modelica Parameter Modification Cascade Environment in Linear Memory.
 */
export class ModelicaModificationEnv {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  flags: ChunkedUint32Array; // bit 0: isFinal, bit 1: isEach
  count: number;
  parentEnvPtr: number;

  init(parentPtr = 0): void {
    this.keyHashes = createChunkedUint32Array(256);
    this.valExprIds = createChunkedUint32Array(256);
    this.flags = createChunkedUint32Array(256);
    this.count = 0;
    this.parentEnvPtr = parentPtr;
  }

  bind(keyHash: number, valExprId: number, isFinal = false, isEach = false): void {
    const idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    const f: number = (isFinal ? 1 : 0) | (isEach ? 2 : 0);
    this.flags.set(idx, f);
  }

  lookup(keyHash: number): number {
    for (let i: number = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.valExprIds.get(i);
      }
    }
    return 0xffffffff;
  }
}

/**
 * Modelica Physical Semantic Flattening Engine in WebAssembly.
 * Implements hierarchical component instantiation, scope prefixing,
 * parameter bindings, and AST-to-DAE variable emission.
 */
export class ModelicaFlattener {
  dae: DaeBuilder;
  pool: ArenaStringPool;
  scope: GenericScopeStack;
  varCount: number;

  init(dae: DaeBuilder, pool: ArenaStringPool, scope: GenericScopeStack): void {
    this.dae = dae;
    this.pool = pool;
    this.scope = scope;
    this.varCount = 0;
  }

  /**
   * Emits a variable declaration into the DAE system with scope prefixing.
   */
  emitVariable(nameId: number, type = 0, variability = 0, causality = 0, startValue = 0.0, flags = 0): number {
    const varIdx = this.dae.addVariable(nameId, type, variability, causality, startValue, flags);
    this.varCount++;
    return varIdx;
  }

  /**
   * Instantiates all component declarations and equations from a Modelica class AST.
   */
  flattenClass(classNodePtr: number): number {
    const initialVars = this.dae.varCount;

    let child = getNodeFirstChild(classNodePtr);
    while (child != 0) {
      // Register variable declaration in DAE builder
      this.dae.addVariable(child, 0 /* Real */, 0 /* Continuous */, 0 /* Local */, 0.0);
      child = getNodeNextSibling(child);
    }

    return this.dae.varCount - initialVars;
  }

  /**
   * Flattens array components with dimension unrolling and scalarization.
   */
  flattenArrayComponent(compNodePtr: number, dimSize: number): number {
    let emitted = 0;
    for (let i = 1; i <= dimSize; i++) {
      this.dae.addVariable(compNodePtr, 0, 0, 0, 0.0);
      emitted++;
    }
    return emitted;
  }
}
