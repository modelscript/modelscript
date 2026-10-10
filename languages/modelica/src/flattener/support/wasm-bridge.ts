// SPDX-License-Identifier: AGPL-3.0-or-later

export class ModelicaModificationEnv {
  readonly wasmExports: any;
  readonly envPtr: number;

  constructor(wasmExports: any, parentEnvPtr: number = 0) {
    this.wasmExports = wasmExports;
    this.envPtr =
      typeof wasmExports?.flattener_envCreate === "function" ? wasmExports.flattener_envCreate(parentEnvPtr) : 0;
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

  bindRedeclare(keyHash: number, newTypeHash: number, valExprId = 0, flag = 0): void {
    if (this.wasmExports?.flattener_envBindRedeclare) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindRedeclare(this.envPtr, keyHash, newTypeHash, valExprId, isFinal, isEach);
    }
  }

  bindRedeclarePath(flattenerPtr: number, pathId: number, newTypeHash: number, valExprId = 0, flag = 0): void {
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
