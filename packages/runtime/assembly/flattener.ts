// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChunkedInt32Array,
  ChunkedUint32Array,
  atomicChunkAlloc,
  createChunkedInt32Array,
  createChunkedUint32Array,
} from "../src/wasm/core/array";
import { VarAccessor } from "../src/wasm/dae/accessors";
import { DaeBuilder } from "../src/wasm/dae/builder";
import {
  BinOp,
  Causality,
  EqKind,
  ExprKind,
  FLAG_EQ_STREAM_CONNECT,
  FLAG_VAR_FLOW,
  VarType,
  Variability,
} from "../src/wasm/dae/types";

const FLAG_MOD_FINAL: u32 = 0x01;
const FLAG_MOD_EACH: u32 = 0x02;

@unmanaged
class ModificationEnvironment {
  parentEnvPtr: u32;
  count: u32;
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  childEnvPtrs: ChunkedUint32Array;
  redeclareTypeHashes: ChunkedUint32Array;
  flags: ChunkedUint32Array;

  static create(parentPtr: u32 = 0): u32 {
    const ptr = atomicChunkAlloc(offsetof<ModificationEnvironment>());
    const env = changetype<ModificationEnvironment>(ptr);
    env.init(parentPtr);
    return ptr as u32;
  }

  init(parentPtr: u32 = 0): void {
    this.parentEnvPtr = parentPtr;
    this.count = 0;
    this.keyHashes = createChunkedUint32Array(32);
    this.valExprIds = createChunkedUint32Array(32);
    this.childEnvPtrs = createChunkedUint32Array(32);
    this.redeclareTypeHashes = createChunkedUint32Array(32);
    this.flags = createChunkedUint32Array(32);
  }

  bind(keyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    const existingFlags = this.lookupFlags(keyHash);
    if ((existingFlags & FLAG_MOD_FINAL) != 0) return;

    const idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, 0);
    let f: u32 = 0;
    if (isFinal) f |= FLAG_MOD_FINAL;
    if (isEach) f |= FLAG_MOD_EACH;
    this.flags.set(idx, f);
  }

  lookup(keyHash: u32): u32 {
    for (let i: i32 = (this.count as i32) - 1; i >= 0; i--) {
      if (this.keyHashes.get(i as u32) == keyHash) {
        const val = this.valExprIds.get(i as u32);
        if (val != 0xffffffff) return val;
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookup(keyHash);
    }
    return 0xffffffff;
  }

  lookupFlags(keyHash: u32): u32 {
    for (let i: i32 = (this.count as i32) - 1; i >= 0; i--) {
      if (this.keyHashes.get(i as u32) == keyHash) {
        return this.flags.get(i as u32);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupFlags(keyHash);
    }
    return 0;
  }

  merge(otherEnvPtr: u32): void {
    if (otherEnvPtr == 0) return;
    const other = changetype<ModificationEnvironment>(otherEnvPtr);
    for (let i: u32 = 0; i < other.count; i++) {
      const key = other.keyHashes.get(i);
      const existingFlags = this.lookupFlags(key);
      if ((existingFlags & FLAG_MOD_FINAL) != 0) continue;

      const idx = this.count++;
      this.keyHashes.set(idx, key);
      this.valExprIds.set(idx, other.valExprIds.get(i));
      this.childEnvPtrs.set(idx, other.childEnvPtrs.get(i));
      this.redeclareTypeHashes.set(idx, other.redeclareTypeHashes.get(i));
      this.flags.set(idx, other.flags.get(i));
    }
  }
}

@unmanaged
class DisjointSet {
  parent: ChunkedUint32Array;
  rank: ChunkedUint32Array;
  cardinality: ChunkedUint32Array;
  capacity: u32;

  static create(initialCapacity: u32 = 256): DisjointSet {
    const ptr = atomicChunkAlloc(offsetof<DisjointSet>());
    const ds = changetype<DisjointSet>(ptr);
    ds.init(initialCapacity);
    return ds;
  }

  init(initialCapacity: u32 = 256): void {
    this.capacity = initialCapacity;
    this.parent = createChunkedUint32Array(initialCapacity);
    this.rank = createChunkedUint32Array(initialCapacity);
    this.cardinality = createChunkedUint32Array(initialCapacity);
    for (let i: u32 = 0; i < initialCapacity; i++) {
      this.parent.set(i, i);
      this.rank.set(i, 0);
      this.cardinality.set(i, 0);
    }
  }

  ensureCapacity(varId: u32): void {
    if (varId >= this.capacity) {
      const newCap = (varId + 1) * 2;
      for (let i = this.capacity; i < newCap; i++) {
        this.parent.set(i, i);
        this.rank.set(i, 0);
        this.cardinality.set(i, 0);
      }
      this.capacity = newCap;
    }
  }

  find(v: u32): u32 {
    this.ensureCapacity(v);
    let p = this.parent.get(v);
    if (p != v) {
      p = this.find(p);
      this.parent.set(v, p);
    }
    return p;
  }

  union(v1: u32, v2: u32): void {
    const r1 = this.find(v1);
    const r2 = this.find(v2);
    if (r1 == r2) return;
    const rk1 = this.rank.get(r1);
    const rk2 = this.rank.get(r2);
    if (rk1 < rk2) {
      this.parent.set(r1, r2);
    } else if (rk1 > rk2) {
      this.parent.set(r2, r1);
    } else {
      this.parent.set(r2, r1);
      this.rank.set(r1, rk1 + 1);
    }
  }

  getCardinality(v: u32): u32 {
    this.ensureCapacity(v);
    return this.cardinality.get(v);
  }

  incrementCardinality(v: u32): void {
    this.ensureCapacity(v);
    this.cardinality.set(v, this.cardinality.get(v) + 1);
  }
}

@unmanaged
class RuntimeFlattener {
  daePtr: u32;
  disjointSetPtr: u32;
  connectionCount: u32;
  streamCount: u32;
  innerKeys: ChunkedUint32Array;
  innerVars: ChunkedUint32Array;
  innerCount: u32;

  static create(dae: DaeBuilder): RuntimeFlattener {
    const ptr = atomicChunkAlloc(offsetof<RuntimeFlattener>());
    const obj = changetype<RuntimeFlattener>(ptr);
    obj.init(dae);
    return obj;
  }

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get disjointSet(): DisjointSet {
    return changetype<DisjointSet>(this.disjointSetPtr);
  }

  init(dae: DaeBuilder): void {
    this.daePtr = changetype<usize>(dae) as u32;
    const maxVars: u32 = dae.varCount > 2048 ? dae.varCount + 512 : 2048;
    const ds = DisjointSet.create(maxVars);
    this.disjointSetPtr = changetype<usize>(ds) as u32;
    this.connectionCount = 0;
    this.streamCount = 0;
    this.innerKeys = createChunkedUint32Array(256);
    this.innerVars = createChunkedUint32Array(256);
    this.innerCount = 0;
  }

  addConnection(p1VarId: u32, p2VarId: u32, isFlow: boolean, _isBoundary: boolean = false): u32 {
    const idx = this.connectionCount++;
    if (isFlow) {
      if (p1VarId < this.dae.varCount) this.dae.setVarFlag(p1VarId, FLAG_VAR_FLOW);
      if (p2VarId < this.dae.varCount) this.dae.setVarFlag(p2VarId, FLAG_VAR_FLOW);
    }
    this.disjointSet.incrementCardinality(p1VarId);
    this.disjointSet.incrementCardinality(p2VarId);
    this.disjointSet.union(p1VarId, p2VarId);
    return idx;
  }

  addStreamConnection(h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
    const idx = this.streamCount++;
    const eh1 = this.dae.addExpression(ExprKind.Name, h1VarId);
    const eh2 = this.dae.addExpression(ExprKind.Name, h2VarId);
    const emdot1 = this.dae.addExpression(ExprKind.Name, mdot1VarId);
    const zeroReal = this.dae.addRealLiteral(0.0);
    const cond1 = this.dae.addExpression(ExprKind.Binary, BinOp.Gt as u32, emdot1, zeroReal);
    const ifExpr1 = this.dae.addExpression(ExprKind.IfElse, cond1, eh2, eh1);
    this.dae.addEquation(EqKind.Simple, eh1, ifExpr1, FLAG_EQ_STREAM_CONNECT as u32);

    if (mdot2VarId != mdot1VarId && h2VarId != h1VarId) {
      const emdot2 = this.dae.addExpression(ExprKind.Name, mdot2VarId);
      const cond2 = this.dae.addExpression(ExprKind.Binary, BinOp.Gt as u32, emdot2, zeroReal);
      const ifExpr2 = this.dae.addExpression(ExprKind.IfElse, cond2, eh1, eh2);
      this.dae.addEquation(EqKind.Simple, eh2, ifExpr2, FLAG_EQ_STREAM_CONNECT as u32);
    }
    return idx;
  }

  flattenArrayComponent(
    baseNameHash: u32,
    dim1: u32,
    dim2: u32 = 0,
    varType: u16 = VarType.Real,
    variability: u16 = Variability.Continuous,
    causality: u16 = Causality.Local,
    startVal: f64 = 0.0,
  ): u32 {
    let count: u32 = 0;
    if (dim2 == 0) {
      for (let i: u32 = 1; i <= dim1; i++) {
        const elemNameHash = (baseNameHash * 31 + i) as u32;
        this.dae.addVariable(elemNameHash, varType, variability, causality, startVal);
        count++;
      }
    } else {
      for (let i: u32 = 1; i <= dim1; i++) {
        for (let j: u32 = 1; j <= dim2; j++) {
          const elemNameHash = ((baseNameHash * 31 + i) * 31 + j) as u32;
          this.dae.addVariable(elemNameHash, varType, variability, causality, startVal);
          count++;
        }
      }
    }
    return count;
  }

  connectPorts(port1VarId: u32, port2VarId: u32, memberCount: u32, isBoundary: boolean = false): u32 {
    let connected: u32 = 0;
    for (let m: u32 = 0; m < memberCount; m++) {
      const v1 = port1VarId + m;
      const v2 = port2VarId + m;
      const isFlow: boolean = this.dae.isVarFlow(v1);
      this.addConnection(v1, v2, isFlow, isBoundary);
      connected++;
    }
    return connected;
  }

  expandConnector(_busVarId: u32, memberNameHash: u32, varType: u32 = 0): u32 {
    const newVarId = this.dae.addVariable(memberNameHash, varType as u16, Variability.Continuous, Causality.Local, 0.0);
    this.disjointSet.ensureCapacity(newVarId);
    return newVarId;
  }

  registerInner(nameHash: u32, varId: u32): void {
    const idx = this.innerCount++;
    this.innerKeys.set(idx, nameHash);
    this.innerVars.set(idx, varId);
  }

  resolveOuter(nameHash: u32): u32 {
    for (let i: i32 = (this.innerCount as i32) - 1; i >= 0; i--) {
      if (this.innerKeys.get(i as u32) == nameHash) {
        return this.innerVars.get(i as u32);
      }
    }
    return 0xffffffff;
  }

  @inline isVarStream(varIdx: u32): boolean {
    if (varIdx >= this.dae.varCount) return false;
    return VarAccessor.at(this.dae.getVarData(), varIdx).isStream;
  }

  finalizeConnections(): u32 {
    const varCount = this.dae.varCount;
    if (varCount == 0) return 0;

    const head: ChunkedInt32Array = createChunkedInt32Array(varCount);
    const next: ChunkedInt32Array = createChunkedInt32Array(varCount);
    const groupSize: ChunkedUint32Array = createChunkedUint32Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) {
      head.set(i, -1);
      next.set(i, -1);
      groupSize.set(i, 0);
    }

    for (let v: u32 = 0; v < varCount; v++) {
      if (this.dae.isVarRemoved(v)) continue;
      const root = this.disjointSet.find(v);
      const prevHead = head.get(root);
      next.set(v, prevHead);
      head.set(root, v as i32);
      groupSize.set(root, groupSize.get(root) + 1);
    }

    let generatedEqs: u32 = 0;
    const zeroExpr = this.dae.addRealLiteral(0.0);

    for (let r: u32 = 0; r < varCount; r++) {
      if (this.dae.isVarRemoved(r)) continue;
      const size = groupSize.get(r);
      if (size == 0) continue;

      const isStream = this.isVarStream(r);
      const isFlow = this.dae.isVarFlow(r) && !isStream;

      if (isFlow) {
        if (size == 1) {
          const vIdx = head.get(r) as u32;
          const vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(vIdx));
          this.dae.addEquation(EqKind.Simple, vExpr, zeroExpr);
          generatedEqs++;
        } else {
          let sumExpr: u32 = 0;
          let count: u32 = 0;
          let curr = head.get(r);
          while (curr >= 0) {
            const vIdx = curr as u32;
            const vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(vIdx));
            if (count == 0) {
              sumExpr = vExpr;
            } else {
              sumExpr = this.dae.addBinaryExpr(BinOp.Add as u16, sumExpr, vExpr);
            }
            count++;
            curr = next.get(vIdx);
          }
          this.dae.addEquation(EqKind.Simple, sumExpr, zeroExpr);
          generatedEqs++;
        }
      } else if (!isStream) {
        if (size > 1) {
          const rootVar = r;
          const rootExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(rootVar));
          let curr = head.get(r);
          while (curr >= 0) {
            const vIdx = curr as u32;
            if (vIdx != rootVar) {
              const vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(vIdx));
              this.dae.addEquation(EqKind.Simple, rootExpr, vExpr);
              generatedEqs++;
            }
            curr = next.get(vIdx);
          }
        }
      }
    }

    return generatedEqs;
  }
}

export function flattener_create(daePtr: u32): u32 {
  const flattener = RuntimeFlattener.create(changetype<DaeBuilder>(daePtr));
  return changetype<usize>(flattener) as u32;
}

export function flattener_destroy(_flattenerPtr: u32): void {}

export function flattener_createEnv(parentPtr: u32): u32 {
  return ModificationEnvironment.create(parentPtr);
}

export function flattener_envCreate(parentPtr: u32): u32 {
  return ModificationEnvironment.create(parentPtr);
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

export function flattener_envMerge(targetEnvPtr: u32, otherEnvPtr: u32): void {
  if (targetEnvPtr != 0 && otherEnvPtr != 0) {
    changetype<ModificationEnvironment>(targetEnvPtr).merge(otherEnvPtr);
  }
}

export function flattener_addConnection(
  flattenerPtr: u32,
  p1VarId: u32,
  p2VarId: u32,
  isFlow: u32,
  isBoundary: u32,
): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).addConnection(p1VarId, p2VarId, isFlow == 1, isBoundary == 1);
}

export function flattener_addStreamConnection(
  flattenerPtr: u32,
  h1VarId: u32,
  mdot1VarId: u32,
  h2VarId: u32,
  mdot2VarId: u32,
): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).addStreamConnection(h1VarId, mdot1VarId, h2VarId, mdot2VarId);
}

export function flattener_connectPorts(
  flattenerPtr: u32,
  port1VarId: u32,
  port2VarId: u32,
  memberCount: u32,
  isBoundary: u32,
): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).connectPorts(
    port1VarId,
    port2VarId,
    memberCount,
    isBoundary == 1,
  );
}

export function flattener_finalizeConnections(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).finalizeConnections();
}

export function flattener_getCardinality(flattenerPtr: u32, varId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).disjointSet.getCardinality(varId);
}

export function flattener_expandConnector(flattenerPtr: u32, busVarId: u32, memberNameHash: u32, varType: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).expandConnector(busVarId, memberNameHash, varType);
}

export function flattener_flattenArrayComponent(
  flattenerPtr: u32,
  baseNameHash: u32,
  dim1: u32,
  dim2: u32,
  varType: u32,
  variability: u32,
  causality: u32,
): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<RuntimeFlattener>(flattenerPtr).flattenArrayComponent(
    baseNameHash,
    dim1,
    dim2,
    varType as u16,
    variability as u16,
    causality as u16,
  );
}

export function flattener_registerInner(flattenerPtr: u32, nameHash: u32, varId: u32): void {
  if (flattenerPtr != 0) {
    changetype<RuntimeFlattener>(flattenerPtr).registerInner(nameHash, varId);
  }
}

export function flattener_resolveOuter(flattenerPtr: u32, nameHash: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<RuntimeFlattener>(flattenerPtr).resolveOuter(nameHash);
}

export function flattener_flattenClass(_flattenerPtr: u32, _classNodePtr: u32): u32 {
  return 0;
}

export function flattener_flattenClassWithMods(
  _flattenerPtr: u32,
  _classNodePtr: u32,
  _prefixPathId: u32,
  _envPtr: u32,
): u32 {
  return 0;
}
