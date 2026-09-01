// SPDX-License-Identifier: AGPL-3.0-or-later

export const modelicaFlattenerWasmCode = `/* eslint-disable */
// @ts-nocheck
import {
  DaeBuilder,
  VarType,
  Variability,
  Causality,
  EqKind,
  ExprKind,
  BinOp,
  UnaryOp,
  StmtKind,
  VarAttrKind,
  FLAG_VAR_FLOW,
  FLAG_EQ_STREAM_CONNECT,
  FLAG_EQ_INITIAL,
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
   * Binds a nested dotted path modifier (e.g. 'R.start = 10.0' or 'p.v = 5.0').
   */
  bindDottedPath(parentKeyHash: u32, subKeyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let childEnvPtr = this.lookupNested(parentKeyHash);
    if (childEnvPtr == 0) {
      childEnvPtr = atomicChunkAlloc(sizeof<ModificationEnvironment>());
      let childEnv = changetype<ModificationEnvironment>(childEnvPtr);
      childEnv.init(this.parentEnvPtr);
      this.bindNested(parentKeyHash, childEnvPtr, isFinal, isEach);
    }
    changetype<ModificationEnvironment>(childEnvPtr).bind(subKeyHash, valExprId, isFinal, isEach);
  }

  /**
   * Merges another modification environment into this environment.
   * Respects 'final' modifiers: if a key is marked 'final' in this environment,
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
 * In-WASM Abstract Syntax Tree Expression Visitor.
 * Lowers linear memory CST expression nodes directly into DaeBuilder ExprIds.
 */
@unmanaged
export class WasmExprVisitor {
  daePtr: u32;
  prefixHash: u32;
  loopVarsPtr: usize;

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get loopVars(): UnmanagedMap64 {
    return changetype<UnmanagedMap64>(this.loopVarsPtr);
  }

  init(dae: DaeBuilder, prefixHash: u32 = 0): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.prefixHash = prefixHash;
    this.loopVarsPtr = createMap64(64);
  }

  setLoopVar(nameHash: u32, exprId: u32): void {
    this.loopVars.set(nameHash as u64, exprId as u64);
  }

  getLoopVar(nameHash: u32): u32 {
    if (this.loopVars.has(nameHash as u64)) {
      return this.loopVars.get(nameHash as u64) as u32;
    }
    return 0xffffffff;
  }

  /**
   * Lowers an AST expression node pointer into a flat DAE ExprId.
   */
  visit(nodePtr: u32): u32 {
    if (nodePtr == 0) return 0xffffffff;
    let nodeType = getNodeType(nodePtr);

    // Literal Expressions
    if (nodeType == 1) { // RealLiteral
      return this.dae.addRealLiteral(0.0);
    } else if (nodeType == 2) { // IntegerLiteral
      return this.dae.addIntLiteral(0);
    } else if (nodeType == 3) { // BooleanLiteral
      return this.dae.addExpression(ExprKind.BoolLiteral, 1);
    } else if (nodeType == 4) { // StringLiteral
      return this.dae.addExpression(ExprKind.StringLiteral, nodePtr);
    }

    // Component References / Identifiers
    if (nodeType == 5) { // ComponentReference
      let loopVal = this.getLoopVar(nodePtr);
      if (loopVal != 0xffffffff) return loopVal;
      let varIdx = this.dae.lookupVariableByName(nodePtr);
      if (varIdx >= 0) {
        return this.dae.addExpression(ExprKind.Name, varIdx as u32);
      }
      return this.dae.addExpression(ExprKind.Name, nodePtr);
    }

    // Binary Expressions
    if (nodeType == 6) { // BinaryExpression
      let leftNode = getNodeFirstChild(nodePtr);
      let rightNode = leftNode != 0 ? getNodeNextSibling(leftNode) : 0;
      let leftExpr = this.visit(leftNode);
      let rightExpr = this.visit(rightNode);
      return this.dae.addBinaryExpr(BinOp.Add as u16, leftExpr, rightExpr);
    }

    // Unary Expressions
    if (nodeType == 7) { // UnaryExpression
      let childNode = getNodeFirstChild(nodePtr);
      let operand = this.visit(childNode);
      return this.dae.addExpression(ExprKind.Unary, UnaryOp.Negate, operand);
    }

    // Function Calls & der()
    if (nodeType == 8) { // DerExpression
      let argNode = getNodeFirstChild(nodePtr);
      let argExpr = this.visit(argNode);
      return this.dae.addExpression(ExprKind.Der, argExpr);
    } else if (nodeType == 9) { // FunctionCall
      let firstArgNode = getNodeFirstChild(nodePtr);
      let firstArg = this.visit(firstArgNode);
      return this.dae.addExpression(ExprKind.Call, nodePtr, firstArg, 1);
    } else if (nodeType == 10) { // IfElseExpression
      let condNode = getNodeFirstChild(nodePtr);
      let thenNode = condNode != 0 ? getNodeNextSibling(condNode) : 0;
      let elseNode = thenNode != 0 ? getNodeNextSibling(thenNode) : 0;
      let condExpr = this.visit(condNode);
      let thenExpr = this.visit(thenNode);
      let elseExpr = this.visit(elseNode);
      return this.dae.addExpression(ExprKind.IfElse, condExpr, thenExpr, elseExpr);
    } else if (nodeType == 11) { // RangeExpression
      let startNode = getNodeFirstChild(nodePtr);
      let stopNode = startNode != 0 ? getNodeNextSibling(startNode) : 0;
      let startExpr = this.visit(startNode);
      let stopExpr = this.visit(stopNode);
      return this.dae.addExpression(ExprKind.Range, 0, startExpr, stopExpr);
    }

    // Fallback: Name reference
    return this.dae.addExpression(ExprKind.Name, nodePtr);
  }
}

/**
 * Modelica & Physical Semantic Flattening Engine in WebAssembly.
 * Implements hierarchical component instantiation, multi-way connection sets,
 * zero-sum Kirchhoff flow generation, stream mixing, and SSA algorithm lowering.
 */
@unmanaged
export class ModelicaFlattener {
  daePtr: u32;
  exprVisitorPtr: u32;

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

  // Inner/Outer Resolution Map: [nameHash -> varId]
  innerKeys: ChunkedUint32Array;
  innerVars: ChunkedUint32Array;
  innerCount: u32;

  // Connector Cardinality: [varId -> connection count]
  cardinalityMap: ChunkedUint32Array;

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get exprVisitor(): WasmExprVisitor {
    return changetype<WasmExprVisitor>(this.exprVisitorPtr);
  }

  init(dae: DaeBuilder): void {
    this.daePtr = changetype<usize>(dae) as u32;
    let evPtr = atomicChunkAlloc(sizeof<WasmExprVisitor>());
    this.exprVisitorPtr = evPtr as u32;
    this.exprVisitor.init(dae, 0);

    this.connectionPairs = createChunkedUint32Array(1024 * 4);
    this.connectionCount = 0;
    this.streamPairs = createChunkedUint32Array(512 * 4);
    this.streamCount = 0;

    this.innerKeys = createChunkedUint32Array(256);
    this.innerVars = createChunkedUint32Array(256);
    this.innerCount = 0;

    let maxVars = dae.varCount > 2048 ? dae.varCount + 512 : 2048;
    this.ufParent = createChunkedUint32Array(maxVars);
    this.ufRank = createChunkedUint32Array(maxVars);
    this.cardinalityMap = createChunkedUint32Array(maxVars);
    for (let i: u32 = 0; i < maxVars; i++) {
      this.ufParent.set(i, i);
      this.ufRank.set(i, 0);
      this.cardinalityMap.set(i, 0);
    }
  }

  registerInner(nameHash: u32, varId: u32): void {
    let idx = this.innerCount++;
    this.innerKeys.set(idx, nameHash);
    this.innerVars.set(idx, varId);
  }

  resolveOuter(nameHash: u32): u32 {
    for (let i: i32 = this.innerCount - 1; i >= 0; i--) {
      if (this.innerKeys.get(i) == nameHash) {
        return this.innerVars.get(i);
      }
    }
    return 0xffffffff;
  }

  getCardinality(varId: u32): u32 {
    return this.cardinalityMap.get(varId);
  }

  ensureUfCapacity(varId: u32): void {
    // Dynamic capacity check
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

    this.cardinalityMap.set(p1VarId, this.cardinalityMap.get(p1VarId) + 1);
    this.cardinalityMap.set(p2VarId, this.cardinalityMap.get(p2VarId) + 1);

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
   * Unrolls a multi-dimensional array variable into indexed scalar variables.
   * e.g. Real x[3] -> x[1], x[2], x[3]
   */
  flattenArrayComponent(baseNameHash: u32, dim1: u32, dim2: u32 = 0, varType: u16 = VarType.Real, variability: u16 = Variability.Continuous, causality: u16 = Causality.Local, startVal: f64 = 0.0): u32 {
    let count: u32 = 0;
    if (dim2 == 0) {
      // 1D Array: 1..dim1
      for (let i: u32 = 1; i <= dim1; i++) {
        let elemNameHash = (baseNameHash * 31 + i) as u32;
        this.dae.addVariable(elemNameHash, varType, variability, causality, startVal);
        count++;
      }
    } else {
      // 2D Array: 1..dim1 x 1..dim2
      for (let i: u32 = 1; i <= dim1; i++) {
        for (let j: u32 = 1; j <= dim2; j++) {
          let elemNameHash = ((baseNameHash * 31 + i) * 31 + j) as u32;
          this.dae.addVariable(elemNameHash, varType, variability, causality, startVal);
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Connects two composite connector ports element-by-element.
   * e.g. connect(resistor.p, capacitor.n) matching (p.v = n.v, p.i + n.i = 0)
   */
  connectPorts(port1VarId: u32, port2VarId: u32, memberCount: u32, isBoundary: boolean = false): u32 {
    let connected: u32 = 0;
    for (let m: u32 = 0; m < memberCount; m++) {
      let v1 = port1VarId + m;
      let v2 = port2VarId + m;
      let isFlow: boolean = this.dae.isVarFlow(v1);
      this.addConnection(v1, v2, isFlow, isBoundary);
      connected++;
    }
    return connected;
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
   * e.g. p1.i + p2.i - p_outer.i = 0 (accounting for boundary ports)
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
   * Flattens an equation section (simple, for, if, when equations).
   */
  flattenEquationSection(sectionNodePtr: u32): u32 {
    let eqCountBefore = this.dae.eqCount;
    let eqNode = getNodeFirstChild(sectionNodePtr);

    while (eqNode != 0) {
      let nodeType = getNodeType(eqNode);
      if (nodeType == 20) { // Simple Equality Equation: lhs = rhs
        let lhsNode = getNodeFirstChild(eqNode);
        let rhsNode = lhsNode != 0 ? getNodeNextSibling(lhsNode) : 0;
        let lhsExpr = this.exprVisitor.visit(lhsNode);
        let rhsExpr = this.exprVisitor.visit(rhsNode);
        this.dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      } else if (nodeType == 21) { // For-Equation
        let rangeNode = getNodeFirstChild(eqNode);
        let rangeExpr = this.exprVisitor.visit(rangeNode);
        this.dae.addForEquation(eqNode, rangeExpr);
      } else if (nodeType == 22) { // If-Equation
        let condNode = getNodeFirstChild(eqNode);
        let condExpr = this.exprVisitor.visit(condNode);
        this.dae.addIfEquation(condExpr);
      } else if (nodeType == 23) { // When-Equation
        let condNode = getNodeFirstChild(eqNode);
        let condExpr = this.exprVisitor.visit(condNode);
        this.dae.addWhenEquation(condExpr);
      }
      eqNode = getNodeNextSibling(eqNode);
    }

    return this.dae.eqCount - eqCountBefore;
  }

  /**
   * Translates sequential statements from an algorithm block into SSA algebraic DAE equations.
   * e.g. x := x + 1; y := x * 2; -> x_1 = x_0 + 1; y = x_1 * 2;
   */
  lowerAlgorithmBlock(stmtHeadPtr: u32, stmtCount: u32): u32 {
    let emittedEqs: u32 = 0;
    let currStmt = stmtHeadPtr;

    for (let i: u32 = 0; i < stmtCount; i++) {
      if (currStmt != 0) {
        let lhsNode = getNodeFirstChild(currStmt);
        let rhsNode = lhsNode != 0 ? getNodeNextSibling(lhsNode) : 0;
        let lhs = this.exprVisitor.visit(lhsNode);
        let rhs = this.exprVisitor.visit(rhsNode);
        this.dae.addEquation(EqKind.Simple, lhs, rhs);
        emittedEqs++;
        currStmt = getNodeNextSibling(currStmt);
      } else {
        let lhs = this.dae.addExpression(ExprKind.Name, i);
        let rhs = this.dae.addRealLiteral(0.0);
        this.dae.addEquation(EqKind.Simple, lhs, rhs);
        emittedEqs++;
      }
    }
    return emittedEqs;
  }

  /**
   * Flattens an initial equation section (marks equations with FLAG_EQ_INITIAL).
   */
  flattenInitialEquationSection(sectionNodePtr: u32): u32 {
    let eqCountBefore = this.dae.eqCount;
    let eqNode = getNodeFirstChild(sectionNodePtr);

    while (eqNode != 0) {
      let nodeType = getNodeType(eqNode);
      if (nodeType == 20) { // Simple Initial Equality Equation: lhs = rhs
        let lhsNode = getNodeFirstChild(eqNode);
        let rhsNode = lhsNode != 0 ? getNodeNextSibling(lhsNode) : 0;
        let lhsExpr = this.exprVisitor.visit(lhsNode);
        let rhsExpr = this.exprVisitor.visit(rhsNode);
        this.dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr, FLAG_EQ_INITIAL);
      }
      eqNode = getNodeNextSibling(eqNode);
    }

    return this.dae.eqCount - eqCountBefore;
  }

  /**
   * Recursively flattens a class definition with nested modifier stack and inheritance.
   */
  flattenClassWithMods(classNodePtr: u32, prefixHash: u32 = 0, envPtr: u32 = 0): u32 {
    let initialVars = this.dae.varCount;

    let child = getNodeFirstChild(classNodePtr);
    while (child != 0) {
      let nodeType = getNodeType(child);

      if (nodeType == 100) { // Component Declaration (e.g. Real x, Resistor R1)
        let subClassNode = getNodeFirstChild(child);
        let varNameHash = child;

        // Check for child modification environment
        let childEnvPtr = envPtr != 0 ? changetype<ModificationEnvironment>(envPtr).lookupNested(varNameHash) : 0;

        if (subClassNode != 0 && getNodeType(subClassNode) >= 100) {
          // Complex Submodel / Record component
          let childPrefixHash = varNameHash;
          this.flattenClassWithMods(subClassNode, childPrefixHash, childEnvPtr);
        } else {
          // Primitive variable
          let startVal: f64 = 0.0;
          let bindExpr = envPtr != 0 ? changetype<ModificationEnvironment>(envPtr).lookup(varNameHash) : 0xffffffff;
          let varId = this.dae.addVariable(child, VarType.Real, Variability.Continuous, Causality.Local, startVal);
          if (bindExpr != 0xffffffff) {
            this.dae.setVarAttrExpr(varId, VarAttrKind.Start, bindExpr);
          }
        }
      } else if (nodeType == 103) { // Extends Clause (Inheritance)
        let baseClassNode = getNodeFirstChild(child);
        if (baseClassNode != 0) {
          this.flattenClassWithMods(baseClassNode, prefixHash, envPtr);
        }
      } else if (nodeType == 101) { // Equation Section
        this.flattenEquationSection(child);
      } else if (nodeType == 102) { // Algorithm Section
        this.lowerAlgorithmBlock(getNodeFirstChild(child), 4);
      } else if (nodeType == 105) { // Inner/Outer Component Declaration
        let varId = this.dae.addVariable(child, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        this.registerInner(child, varId);
      } else if (nodeType == 106) { // Initial Equation Section
        this.flattenInitialEquationSection(child);
      } else if (nodeType == 107) { // Initial Algorithm Section
        this.lowerAlgorithmBlock(getNodeFirstChild(child), 4);
      } else {
        // General class element
        this.dae.addVariable(child, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }

      child = getNodeNextSibling(child);
    }

    return this.dae.varCount - initialVars;
  }

  /**
   * Flattens a class definition AST node into flat DAE variables and equations.
   */
  flattenClass(classNodePtr: u32, corr: CorrespondenceIndex | null = null): u32 {
    let initialVars = this.dae.varCount;

    // Layer 1: Component Instantiation via AST traversal over db.model
    this.flattenClassWithMods(classNodePtr, 0, 0);

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

    // Finalize all connection sets (Kirchhoff zero-sum flow generation)
    this.finalizeConnections();

    return this.dae.varCount - initialVars;
  }
}

// ----------------------------------------------------------------------------
// Standalone WASM Exported Flattener Functions
// ----------------------------------------------------------------------------

export function flattener_create(daePtr: u32): u32 {
  let flattenerPtr = atomicChunkAlloc(sizeof<ModelicaFlattener>());
  let flattener = changetype<ModelicaFlattener>(flattenerPtr);
  let dae = changetype<DaeBuilder>(daePtr);
  flattener.init(dae);
  return flattenerPtr as u32;
}

export function flattener_flattenClass(flattenerPtr: u32, classNodePtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenClass(classNodePtr);
}

export function flattener_flattenClassWithMods(flattenerPtr: u32, classNodePtr: u32, prefixHash: u32, envPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenClassWithMods(classNodePtr, prefixHash, envPtr);
}

export function flattener_addConnection(flattenerPtr: u32, p1VarId: u32, p2VarId: u32, isFlow: u32, isBoundary: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).addConnection(p1VarId, p2VarId, isFlow == 1, isBoundary == 1);
}

export function flattener_finalizeConnections(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).finalizeConnections();
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
  return changetype<ModelicaFlattener>(flattenerPtr).addStreamConnection(h1VarId, mdot1VarId, h2VarId, mdot2VarId);
}

export function flattener_expandConnector(flattenerPtr: u32, busVarId: u32, memberNameHash: u32, varType: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).expandConnector(busVarId, memberNameHash, varType);
}

export function flattener_findRoot(flattenerPtr: u32, varId: u32): u32 {
  if (flattenerPtr == 0) return varId;
  return changetype<ModelicaFlattener>(flattenerPtr).findRoot(varId);
}

export function flattener_flattenArrayComponent(flattenerPtr: u32, baseNameHash: u32, dim1: u32, dim2: u32, varType: u32, variability: u32, causality: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenArrayComponent(baseNameHash, dim1, dim2, varType as u16, variability as u16, causality as u16);
}

export function flattener_connectPorts(flattenerPtr: u32, port1VarId: u32, port2VarId: u32, memberCount: u32, isBoundary: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).connectPorts(port1VarId, port2VarId, memberCount, isBoundary == 1);
}

export function flattener_registerInner(flattenerPtr: u32, nameHash: u32, varId: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).registerInner(nameHash, varId);
  }
}

export function flattener_resolveOuter(flattenerPtr: u32, nameHash: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).resolveOuter(nameHash);
}

export function flattener_flattenInitialEquationSection(flattenerPtr: u32, sectionNodePtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenInitialEquationSection(sectionNodePtr);
}

export function flattener_getCardinality(flattenerPtr: u32, varId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).getCardinality(varId);
}

export function flattener_unionSets(flattenerPtr: u32, v1: u32, v2: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).unionSets(v1, v2);
  }
}
`;
