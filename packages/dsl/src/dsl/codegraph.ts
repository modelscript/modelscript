/**
 * Arena-native CodeGraph API bridging TypeScript to WASM.
 * Exposes methods to query AST nodes, allocate memory, and interact with the Semantic Reasoner.
 */

import type { f32, f64, i16, i32, i64, TensorHandle, TensorType, u16, u32, u64, u8 } from "./primitives.js";

export interface Cursor extends Iterable<u32> {
  hasNext(): boolean;
  next(): u32;
  release(): void;
  [Symbol.iterator](): Iterator<u32>;
}

export interface TensorAPI {
  create1D(type: TensorType, size: u32): TensorHandle;
  create2D(type: TensorType, rows: u32, cols: u32): TensorHandle;
  create3D(type: TensorType, d0: u32, d1: u32, d2: u32): TensorHandle;

  setFloat(handle: TensorHandle, flatIndex: u32, val: f64): void;
  getFloat(handle: TensorHandle, flatIndex: u32): f64;
  setFloat32(handle: TensorHandle, flatIndex: u32, val: f32): void;
  getFloat32(handle: TensorHandle, flatIndex: u32): f32;
  setFloat16Raw(handle: TensorHandle, flatIndex: u32, val: u16): void;
  getFloat16Raw(handle: TensorHandle, flatIndex: u32): u16;

  setInt(handle: TensorHandle, flatIndex: u32, val: i32): void;
  getInt(handle: TensorHandle, flatIndex: u32): i32;
  setInt64(handle: TensorHandle, flatIndex: u32, val: i64): void;
  getInt64(handle: TensorHandle, flatIndex: u32): i64;
  setInt16(handle: TensorHandle, flatIndex: u32, val: i16): void;
  getInt16(handle: TensorHandle, flatIndex: u32): i16;

  setBool(handle: TensorHandle, flatIndex: u32, val: boolean): void;
  getBool(handle: TensorHandle, flatIndex: u32): boolean;
}

/**
 * Hierarchical Scope and FQN Stack API for zero-GC prefix management.
 */
export interface ScopeAPI {
  enter(prefix: string | u32, fn: () => void): void;
  push(prefix: string | u32): void;
  pop(): void;
  reset(): void;
  currentFqn(): u32;
  currentPrefix(): u32;
  resolve(localName: string | u32): u32;
  internNode(nodeId: u32): u32;
  concatPrefix(prefixId: u32, suffixId: u32): u32;
  equals(id1: u32, id2: u32): boolean;
  hasPrefix(id: u32, prefixId: u32): boolean;
  getSuffixAfterPrefix(id: u32, prefixId: u32): u32;
  pool: any;
}

/**
 * Cascading Parameter and Modification Environment API.
 */
export interface EnvAPI {
  create(): u32;
  bind(envId: u32, keyHash: u32, valExprId: u32): void;
  lookup(envId: u32, keyHash: u32): u32;
  enterMod(envId: u32, modNodeId: u32): u32;
}

/**
 * Acausal Connection Graph and Zero-Sum Flow/Stream Partitioning API.
 */
export interface ConnectorAPI {
  add(p1VarId: u32, p2VarId: u32, isFlow?: boolean, isBoundary?: boolean): u32;
  finalize(): u32;
  connect(lhsConnectorId: u32, rhsConnectorId: u32): u32;
}

/**
 * Single Static Assignment (SSA) Lowering API.
 */
export interface SsaAPI {
  lowerToDAE(blockNodeId: u32, assignmentOp?: string): u32;
}

/**
 * Declarative physical connector schema definition.
 */
export interface ConnectorDefinition {
  potential?: string[];
  flow?: string[];
  stream?: string[];
}

/**
 * Fast Set API.
 */
export interface SetAPI {
  create(): u32;
  add(setId: u32, val: u32 | u64): void;
  has(setId: u32, val: u32 | u64): boolean;
  release(setId: u32): void;
}

/**
 * Open-addressing Hash Set API.
 */
export interface HashSetAPI {
  create(): u32;
  add(setId: u32, hash: u64): void;
  has(setId: u32, hash: u64): boolean;
  release(setId: u32): void;
}

/**
 * Methods for querying the Abstract Syntax Tree inside the WASM Arena.
 * Nodes are represented by their `u32` pointer offsets.
 */
export interface AstAPI<RuleName extends string, FieldName extends string = string> {
  getChildByFieldId(nodeId: u32, fieldId: FieldName | (string & {}) | i32): u32;
  getChildrenByFieldId(nodeId: u32, fieldId: FieldName | (string & {}) | i32): Cursor;

  getAncestors(nodeId: u32, stopAtType?: Extract<RuleName, string> | (string & {}) | u16, rootNode?: u32): Cursor;
  getDescendants(nodeId: u32, filterType?: Extract<RuleName, string> | (string & {}) | u16): Cursor;
  getPathTokens(nodeId: u32): Cursor;

  textEqualsNode(nodeA: u32, nodeB: u32): boolean;
  textEquals(nodeId: u32, literal: string): boolean;
  startsWith(nodeId: u32, prefix: string): boolean;

  getType(nodeId: u32): u16;
  getFirstChild(nodeId: u32): u32;
  getNextSibling(nodeId: u32): u32;
  getChildCount(nodeId: u32): u32;
  getByteLength(nodeId: u32): u32;
  parseInteger(nodeId: u32): i32;
  parseReal(nodeId: u32): f64;
  getBinaryOp(leftNode: u32, rightNode: u32): u16;

  getTextSpan(nodeId: u32, absoluteStart?: u32): u64;
  getRootNode(): u32;
  getCachedEnclosingClass(root: u32): u32;
  setCachedEnclosingClass(root: u32, cls: u32): void;
  getCachedHasUnits(classNode: u32): i32;
  setCachedHasUnits(classNode: u32, hasUnits: boolean): void;
  getCachedHasInnerClass(classNode: u32): i32;
  setCachedHasInnerClass(classNode: u32, hasInner: boolean): void;
  hashSpan(span: u64): u32;
}

/**
 * DJB2 Hashing API for fast symbol and string interning in WASM.
 */
export interface HashAPI {
  init(): u32;
  span(currentHash: u32, span: u64): u32;
  byte(currentHash: u32, byte: u8): u32;
  span64(span: u64): u64;
}

/**
 * Differential Algebraic Equation (DAE) Builder API for the Modelica flattener.
 */
export interface DaeAPI {
  addVariable(nameId: u32, type: u8, variability: u8, causality: u8, startValue: f64, flags?: i32): u32;
  addExpression(kind: u8, data1: u32, left?: u32, right?: u32): u32;
  addRealLiteral(val: f64): u32;
  addBinaryExpr(op: u16, left: u32, right: u32): u32;
  addEquation(kind: u8, lhsId: u32, rhsId: u32, auxId?: u32): u32;
  addStatement(kind: u8, data1: u32, left?: u32, right?: u32): u32;
  varCount: u32;
  getVarCount(): i32;
  getVarNameId(varIdx: u32): u32;
  getVarType(varIdx: u32): i32;
  isVarFlow(varIdx: u32): boolean;
  setVarShapeDim(varIdx: u32, dimIdx: u32, size: i32): void;
  getVarShapeDim(varIdx: u32, dimIdx: u32): i32;
  extractEquations(rootId: u32): void;
  reset(): void;
  exprData: any;
  lookupVariableByName(nameId: u32): i32;
  getExprKind(exprId: u32): i32;
  getExprData1(exprId: u32): u32;
  getExprLeft(exprId: u32): u32;
  getExprRight(exprId: u32): u32;
  addCall(funcId: i32, firstArg: u32, argCount: u32): u32;
}

/**
 * Block Lower Triangular (BLT) Transformation API.
 */
export interface BltAPI {
  computeBLT(): void;
  rollback(snapshotEqCount: u32, snapshotVarCount: u32): void;
  buildDependencies(): void;
  computeMatching(): void;
}

/**
 * Open-addressing Hash Map API.
 */
export interface MapAPI {
  create(): u32;
  set(mapId: u32, hash: u64, valueId: u32): void;
  get(mapId: u32, hash: u64): u32;
  release(mapId: u32): void;
}

/**
 * API for instantiating and mutating logical entities and objects in the typed model graph.
 */
export interface ModelAPI<
  ModelAttrs extends Record<string, Record<string, any>> = Record<string, Record<string, any>>,
> {
  create(type: Extract<keyof ModelAttrs, string> | (string & {}) | u16): u32;
  clone(nodeId: u32, deep: boolean): u32;

  compute<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    attrName: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): u32;

  getProperty<RetType = number, T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    propName: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): RetType;

  setProperty<ValType = number, T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    propName: Extract<keyof ModelAttrs[T], string> | (string & {}),
    value: ValType,
  ): void;

  bind(scopeNodeId: u32, nameNodeId: u32, targetId: u32): void;
  resolve(scopeNodeId: u32, nameNodeId: u32): u32;

  bindHash(scopeNodeId: u32, nameHash: u32, targetId: u32): void;
  resolveHash(scopeNodeId: u32, nameHash: u32): u32;

  setFlag<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    flag: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): void;
  clearFlag<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    flag: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): void;
  hasFlag<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    flag: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): boolean;

  appendChild(parentId: u32, childId: u32): void;
  insertSibling(targetId: u32, siblingId: u32): void;
  setFirstChild(parentId: u32, childId: u32): void;
  setNextSibling(nodeId: u32, siblingId: u32): void;
  replaceChild(parentId: u32, oldChildId: u32, newChildId: u32): void;
  removeChild(parentId: u32, childId: u32): void;

  getSemanticChildren(nodeId: u32): Cursor;
}

/**
 * The core Arena-Native CodeGraph API bridging TypeScript to WASM.
 * Exposes methods to query AST nodes, allocate memory, and interact with the Semantic Reasoner.
 */
export interface CodeGraph<
  ModelAttrs extends Record<string, Record<string, any>> = any,
  RuleName extends string = any,
  FieldName extends string = string,
  QueryName extends string = string,
> {
  tensor: TensorAPI;
  hash: HashAPI;
  ast: AstAPI<RuleName, FieldName>;
  model: ModelAPI<ModelAttrs>;
  map: MapAPI;
  set: SetAPI;
  dae: DaeAPI;
  blt: BltAPI;
  scope: ScopeAPI;
  env: EnvAPI;
  connectors: ConnectorAPI;
  ssa: SsaAPI;

  unroll(iterVar: string, start: i32, end: i32, fn: (idx: i32) => void): void;
  error(message: string): void;
  runQuery(queryId: QueryName | (string & {}) | u32, queryArg?: u32, queryArg2?: u32): u32;
  runHostQuery(queryId: string, arg1?: u32, arg2?: u32, arg3?: u32): u32;
  diagnostic(
    targetNode: u32,
    arg0?: u32 | i32 | number,
    arg1?: u32 | i32 | number,
    arg2?: u32 | i32 | number,
    arg3?: u32 | i32 | number,
  ): void;
}
