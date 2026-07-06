import { ChunkedInt32Array, ChunkedUint8Array, createChunkedInt32Array, createChunkedUint8Array } from "./array";
import { DaeBuilder, ExprKind, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT, EQ_STRIDE, EQ_LHS, EQ_RHS } from "./dae";
import { atomicChunkAlloc } from "./arena";
import { simplifyAst } from "./parser";

@unmanaged
export class BltEngine {
  dae: DaeBuilder;

  // CSR Dependency Graph
  eqDepPtrs: ChunkedInt32Array;
  eqDepVars: ChunkedInt32Array;

  // Matching
  matchVarToEq: ChunkedInt32Array;
  matchEqToVar: ChunkedInt32Array;
  visitedVar: ChunkedUint8Array;

  // Tarjan SCC
  indexMap: ChunkedInt32Array;
  lowlinkMap: ChunkedInt32Array;
  onStack: ChunkedUint8Array;
  stack: ChunkedInt32Array;
  sccBlockPtrs: ChunkedInt32Array;
  sccBlockEqs: ChunkedInt32Array;

  init(dae: DaeBuilder): void {
    this.dae = dae;

    this.eqDepPtrs = createChunkedInt32Array(1024);
    this.eqDepVars = createChunkedInt32Array(4096);

    this.matchVarToEq = createChunkedInt32Array(1024);
    this.matchEqToVar = createChunkedInt32Array(1024);
    this.visitedVar = createChunkedUint8Array(1024);

    this.indexMap = createChunkedInt32Array(1024);
    this.lowlinkMap = createChunkedInt32Array(1024);
    this.onStack = createChunkedUint8Array(1024);
    this.stack = createChunkedInt32Array(1024);
    
    this.sccBlockPtrs = createChunkedInt32Array(1024);
    this.sccBlockEqs = createChunkedInt32Array(1024);
    
    // Initialize matches to -1
    for (let i: u32 = 0; i < 1024; i++) {
      this.matchVarToEq.push(-1);
      this.matchEqToVar.push(-1);
    }
  }

  /**
   * Called to invalidate matching state for rolled-back equations and variables.
   * This enables the $O(E)$ incremental warm-start!
   */
  @inline
  rollback(snapshotEqCount: u32, snapshotVarCount: u32): void {
    // 1. Clear var -> eq matches if the matched equation was deleted
    let currentVarCount = this.matchVarToEq.length;
    for (let i: u32 = 0; i < currentVarCount; i++) {
      let matchedEq = this.matchVarToEq.get(i);
      if (matchedEq >= (snapshotEqCount as i32)) {
        this.matchVarToEq.set(i, -1);
      }
    }
    
    // 2. Clear eq -> var matches for deleted equations
    for (let i: u32 = snapshotEqCount; i < this.matchEqToVar.length; i++) {
      this.matchEqToVar.set(i, -1);
    }
  }

  /**
   * Phase 1: Build the Compressed Sparse Row (CSR) dependency graph
   * Iterates through expressions in O(1) linear memory without recursion.
   */
  @inline
  buildDependencies(): void {
    let eqCount = this.dae.eqCount;
    this.eqDepPtrs.clear();
    this.eqDepVars.clear();

    // Ensure eqDepPtrs has capacity
    for (let i: u32 = 0; i <= eqCount; i++) {
      this.eqDepPtrs.push(0);
    }

    let exprStack = createChunkedInt32Array(256);
    let seenVars = createChunkedUint8Array(this.dae.varCount);
    for (let i: u32 = 0; i < this.dae.varCount; i++) {
      seenVars.push(0);
    }

    for (let i: u32 = 0; i < eqCount; i++) {
      this.eqDepPtrs.set(i, this.eqDepVars.length);
      
      let offset = i * EQ_STRIDE;
      let lhsId = this.dae.eqData.get(offset + EQ_LHS);
      let rhsId = this.dae.eqData.get(offset + EQ_RHS);

      exprStack.clear();
      if (lhsId != 0xffffffff) exprStack.push(lhsId);
      if (rhsId != 0xffffffff) exprStack.push(rhsId);

      // Iterative DFS of expression tree
      while (exprStack.length > 0) {
        let exprId = exprStack.pop();
        if (exprId == 0xffffffff) continue;

        let exprOffset = exprId * EXPR_STRIDE;
        let kind = this.dae.exprData.get(exprOffset + EXPR_KIND);

        if (kind == ExprKind.Name) {
          let varId = this.dae.exprData.get(exprOffset + EXPR_DATA1);
          if ((varId as u32) < this.dae.varCount && seenVars.get(varId) == 0) {
            // Is it an unknown? We should only add variables that need solving.
            // For now, we add all variables. A filter for constants/parameters can be added here.
            seenVars.set(varId, 1);
            this.eqDepVars.push(varId);
          }
        }

        let left = this.dae.exprData.get(exprOffset + EXPR_LEFT);
        let right = this.dae.exprData.get(exprOffset + EXPR_RIGHT);

        if (left != 0xffffffff) exprStack.push(left);
        if (right != 0xffffffff) exprStack.push(right);
      }

      // Reset seenVars for next equation
      let startVars = this.eqDepPtrs.get(i);
      let endVars = this.eqDepVars.length;
      for (let j: u32 = startVars; j < endVars; j++) {
        seenVars.set(this.eqDepVars.get(j), 0);
      }
    }
    
    // Set final pointer
    this.eqDepPtrs.set(eqCount, this.eqDepVars.length);
  }

  /**
   * Phase 2: Maximum Cardinality Bipartite Matching (DFS-based)
   */
  @inline
  private dfsMatch(eqIdx: u32): boolean {
    let start = this.eqDepPtrs.get(eqIdx);
    let end = this.eqDepPtrs.get(eqIdx + 1);

    for (let i: u32 = start as u32; i < (end as u32); i++) {
      let varIdx = this.eqDepVars.get(i);
      if (this.visitedVar.get(varIdx) == 0) {
        this.visitedVar.set(varIdx, 1);
        let prevEq = this.matchVarToEq.get(varIdx);
        
        if (prevEq == -1 || this.dfsMatch(prevEq as u32)) {
          this.matchVarToEq.set(varIdx, eqIdx);
          this.matchEqToVar.set(eqIdx, varIdx);
          return true;
        }
      }
    }
    return false;
  }

  @inline
  computeMatching(): void {
    let eqCount = this.dae.eqCount;
    let varCount = this.dae.varCount;

    // Ensure matching arrays are large enough
    while (this.matchVarToEq.length < varCount) this.matchVarToEq.push(-1);
    while (this.matchEqToVar.length < eqCount) this.matchEqToVar.push(-1);
    while (this.visitedVar.length < varCount) this.visitedVar.push(0);

    for (let i: u32 = 0; i < eqCount; i++) {
      // Warm start: skip equations that are already matched!
      if (this.matchEqToVar.get(i) != -1) continue;

      // Clear visited array
      for (let v: u32 = 0; v < varCount; v++) {
        this.visitedVar.set(v, 0);
      }

      this.dfsMatch(i);
    }
  }

  /**
   * Phase 3: Tarjan SCC
   */
  private indexCounter: i32;
  private sccCount: u32;

  @inline
  private strongConnect(varIdx: u32): void {
    this.indexMap.set(varIdx, this.indexCounter);
    this.lowlinkMap.set(varIdx, this.indexCounter);
    this.indexCounter++;
    this.stack.push(varIdx);
    this.onStack.set(varIdx, 1);

    let eqIdx = this.matchVarToEq.get(varIdx);
    if (eqIdx != -1) {
      let start = this.eqDepPtrs.get(eqIdx as u32);
      let end = this.eqDepPtrs.get((eqIdx as u32) + 1);

      for (let i: u32 = start as u32; i < (end as u32); i++) {
        let w = this.eqDepVars.get(i);
        if (w == (varIdx as i32)) continue; // ignore self-dependency in graph traversal

        if (this.indexMap.get(w) == -1) {
          this.strongConnect(w);
          let currentLowV = this.lowlinkMap.get(varIdx);
          let lowW = this.lowlinkMap.get(w);
          this.lowlinkMap.set(varIdx, Math.min(currentLowV, lowW) as i32);
        } else if (this.onStack.get(w) == 1) {
          let currentLowV = this.lowlinkMap.get(varIdx);
          let indexW = this.indexMap.get(w);
          this.lowlinkMap.set(varIdx, Math.min(currentLowV, indexW) as i32);
        }
      }
    }

    if (this.lowlinkMap.get(varIdx) == this.indexMap.get(varIdx)) {
      this.sccBlockPtrs.push(this.sccBlockEqs.length);
      
      let w: i32;
      let blockSize = 0;
      do {
        w = this.stack.pop();
        this.onStack.set(w, 0);
        let matchedEq = this.matchVarToEq.get(w);
        if (matchedEq != -1) {
          this.sccBlockEqs.push(matchedEq);
          blockSize++;
        }
      } while (w != (varIdx as i32));
      
      this.sccCount++;

      // Phase 3: Inline Algebraic Inversion (Symbolic Isolation)
      if (blockSize == 1) {
        let eqId = this.matchVarToEq.get(varIdx as i32);
        if (eqId != -1) {
          this.isolateEquation(eqId as u32, varIdx);
        }
      }
    }
  }

  @inline
  isolateEquation(eqId: u32, targetVarId: u32): void {
    let eqOffset = eqId * EQ_STRIDE;
    let lhsId = this.dae.eqData.get(eqOffset + EQ_LHS);
    let rhsId = this.dae.eqData.get(eqOffset + EQ_RHS);
    
    if (lhsId == 0xffffffff || rhsId == 0xffffffff) return; // Not an equality equation
    
    // 1. Rewrite Equation into 0 = (RHS) - (LHS)
    let subOp = 1; // BinOp.Sub is 1
    let zeroExpr = this.dae.addExpression(ExprKind.RealLiteral, 0); // Implicit zero 
    let residualExpr = this.dae.addExpression(ExprKind.Binary, subOp, rhsId, lhsId);
    
    // 2. Feed the residual into the E-Graph simplifyAst pipeline
    // This will equality-saturate and DP-extract the most simplified/isolated form
    let simplifiedResidual = simplifyAst(residualExpr, this.dae);
    
    // 3. For now, we assume simplifyAst successfully isolates the target variable.
    // So the simplified AST is actually the right hand side.
    // Replace the equation: targetVarId = simplifiedResidual
    let newLhs = this.dae.addExpression(ExprKind.Name, targetVarId);
    
    this.dae.eqData.set(eqOffset + EQ_LHS, newLhs);
    this.dae.eqData.set(eqOffset + EQ_RHS, simplifiedResidual);
  }

  @inline
  computeSCC(): void {
    let varCount = this.dae.varCount;

    while (this.indexMap.length < varCount) this.indexMap.push(-1);
    while (this.lowlinkMap.length < varCount) this.lowlinkMap.push(-1);
    while (this.onStack.length < varCount) this.onStack.push(0);
    
    for (let i: u32 = 0; i < varCount; i++) {
      this.indexMap.set(i, -1);
      this.lowlinkMap.set(i, -1);
      this.onStack.set(i, 0);
    }

    this.stack.clear();
    this.sccBlockPtrs.clear();
    this.sccBlockEqs.clear();
    this.sccBlockPtrs.push(0);

    this.indexCounter = 0;
    this.sccCount = 0;

    for (let i: u32 = 0; i < varCount; i++) {
      // Only visit variables that are matched (part of the solvable system)
      if (this.matchVarToEq.get(i) != -1 && this.indexMap.get(i) == -1) {
        this.strongConnect(i);
      }
    }
    
    this.sccBlockPtrs.set(this.sccCount, this.sccBlockEqs.length);
  }

  @inline
  computeBLT(): void {
    this.buildDependencies();
    this.computeMatching();
    this.computeSCC();
  }
}

export function blt_createEngine(daePtr: u32): u32 {
  let ptr = atomicChunkAlloc(offsetof<BltEngine>());
  let engine = changetype<BltEngine>(ptr);
  engine.init(changetype<DaeBuilder>(daePtr));
  return ptr as u32;
}

export function blt_compute(enginePtr: u32): void {
  changetype<BltEngine>(enginePtr).computeBLT();
}

export function blt_rollback(enginePtr: u32, snapshotEqCount: u32, snapshotVarCount: u32): void {
  changetype<BltEngine>(enginePtr).rollback(snapshotEqCount, snapshotVarCount);
}
