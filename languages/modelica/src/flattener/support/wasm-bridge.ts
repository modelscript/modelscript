// SPDX-License-Identifier: AGPL-3.0-or-later

export interface WasmFlattenerExports {
  flattener_envCreate?(parentEnvPtr: number): number;
  flattener_envBind?(envPtr: number, keyHash: number, exprId: number, isFinal: number, isEach: number): void;
  flattener_envBindPath?(
    flattenerPtr: number,
    envPtr: number,
    pathId: number,
    exprId: number,
    isFinal: number,
    isEach: number,
  ): void;
  flattener_envBindNested?(envPtr: number, keyHash: number, childEnvPtr: number, isFinal: number, isEach: number): void;
  flattener_envBindRedeclare?(
    envPtr: number,
    keyHash: number,
    newTypeHash: number,
    valExprId: number,
    isFinal: number,
    isEach: number,
  ): void;
  flattener_envBindRedeclarePath?(
    flattenerPtr: number,
    envPtr: number,
    pathId: number,
    newTypeHash: number,
    valExprId: number,
    isFinal: number,
    isEach: number,
  ): void;
  flattener_envLookup?(envPtr: number, keyHash: number): number;
  flattener_envLookupPath?(flattenerPtr: number, envPtr: number, pathId: number): number;
  flattener_envLookupNested?(envPtr: number, keyHash: number): number;
  flattener_envLookupNestedPath?(flattenerPtr: number, envPtr: number, pathId: number): number;
  flattener_envLookupRedeclare?(envPtr: number, keyHash: number): number;
  flattener_envLookupRedeclarePath?(flattenerPtr: number, envPtr: number, pathId: number): number;
  flattener_envLookupFlags?(envPtr: number, keyHash: number): number;
  flattener_envLookupWithEach?(envPtr: number, baseNameHash: number, elementKeyHash: number): number;
  flattener_envLookupNestedWithEach?(envPtr: number, baseNameHash: number, elementKeyHash: number): number;
  flattener_envMerge?(envPtr: number, otherEnvPtr: number): void;
}

export class ModelicaModificationEnv {
  readonly wasmExports: WasmFlattenerExports | undefined;
  readonly envPtr: number;

  constructor(wasmExports: WasmFlattenerExports | object | null | undefined, parentEnvPtr: number = 0) {
    const typedExports = (wasmExports ?? undefined) as WasmFlattenerExports | undefined;
    this.wasmExports = typedExports;
    this.envPtr =
      typeof typedExports?.flattener_envCreate === "function" ? typedExports.flattener_envCreate(parentEnvPtr) : 0;
  }

  set(keyHash: number, exprId: number, flag = 0): void {
    if (this.wasmExports?.flattener_envBind) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBind(this.envPtr, keyHash, exprId, isFinal, isEach);
    }
  }

  setPath(flattenerPtr: number, pathId: number, exprId: number, flag = 0): void {
    if (this.wasmExports?.flattener_envBindPath && flattenerPtr !== 0) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindPath(flattenerPtr, this.envPtr, pathId, exprId, isFinal, isEach);
    } else {
      this.set(pathId, exprId, flag);
    }
  }

  bindNested(keyHash: number, childEnv: ModelicaModificationEnv, flag = 0): void {
    if (this.wasmExports?.flattener_envBindNested && childEnv) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindNested(this.envPtr, keyHash, childEnv.envPtr, isFinal, isEach);
    }
  }

  bindRedeclare(keyHash: number, newTypeHash: number, valExprId = 0xffffffff, flag = 0): void {
    if (this.wasmExports?.flattener_envBindRedeclare) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindRedeclare(this.envPtr, keyHash, newTypeHash, valExprId, isFinal, isEach);
    }
  }

  bindRedeclarePath(flattenerPtr: number, pathId: number, newTypeHash: number, valExprId = 0xffffffff, flag = 0): void {
    if (this.wasmExports?.flattener_envBindRedeclarePath && flattenerPtr !== 0) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindRedeclarePath(
        flattenerPtr,
        this.envPtr,
        pathId,
        newTypeHash,
        valExprId,
        isFinal,
        isEach,
      );
    } else {
      this.bindRedeclare(pathId, newTypeHash, valExprId, flag);
    }
  }

  lookup(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookup) return 0xffffffff;
    return this.wasmExports.flattener_envLookup(this.envPtr, keyHash);
  }

  lookupPath(flattenerPtr: number, pathId: number): number {
    if (this.wasmExports?.flattener_envLookupPath && flattenerPtr !== 0) {
      return this.wasmExports.flattener_envLookupPath(flattenerPtr, this.envPtr, pathId);
    }
    return this.lookup(pathId);
  }

  lookupNested(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookupNested) return 0;
    return this.wasmExports.flattener_envLookupNested(this.envPtr, keyHash);
  }

  lookupNestedPath(flattenerPtr: number, pathId: number): number {
    if (this.wasmExports?.flattener_envLookupNestedPath && flattenerPtr !== 0) {
      return this.wasmExports.flattener_envLookupNestedPath(flattenerPtr, this.envPtr, pathId);
    }
    return this.lookupNested(pathId);
  }

  lookupRedeclare(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookupRedeclare) return 0;
    return this.wasmExports.flattener_envLookupRedeclare(this.envPtr, keyHash);
  }

  lookupRedeclarePath(flattenerPtr: number, pathId: number): number {
    if (this.wasmExports?.flattener_envLookupRedeclarePath && flattenerPtr !== 0) {
      return this.wasmExports.flattener_envLookupRedeclarePath(flattenerPtr, this.envPtr, pathId);
    }
    return this.lookupRedeclare(pathId);
  }

  lookupFlags(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookupFlags) return 0;
    return this.wasmExports.flattener_envLookupFlags(this.envPtr, keyHash);
  }

  lookupWithEach(baseNameHash: number, elementKeyHash: number): number {
    if (this.wasmExports?.flattener_envLookupWithEach) {
      return this.wasmExports.flattener_envLookupWithEach(this.envPtr, baseNameHash, elementKeyHash);
    }
    const direct = this.lookup(elementKeyHash);
    if (direct !== 0xffffffff) return direct;
    if ((this.lookupFlags(baseNameHash) & 2) !== 0) {
      return this.lookup(baseNameHash);
    }
    return 0xffffffff;
  }

  lookupNestedWithEach(baseNameHash: number, elementKeyHash: number): number {
    if (this.wasmExports?.flattener_envLookupNestedWithEach) {
      return this.wasmExports.flattener_envLookupNestedWithEach(this.envPtr, baseNameHash, elementKeyHash);
    }
    const direct = this.lookupNested(elementKeyHash);
    if (direct !== 0) return direct;
    if ((this.lookupFlags(baseNameHash) & 2) !== 0) {
      return this.lookupNested(baseNameHash);
    }
    return 0;
  }

  merge(other: ModelicaModificationEnv): void {
    if (this.wasmExports?.flattener_envMerge && other && other.envPtr !== 0) {
      this.wasmExports.flattener_envMerge(this.envPtr, other.envPtr);
    }
  }
}
