// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChunkedInt32Array, ChunkedUint8Array, createChunkedInt32Array, createChunkedUint8Array } from "../core/array";
import { DaeBuilder, ExprKind, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT, EQ_STRIDE, EQ_LHS, EQ_RHS, VAR_STRIDE, VAR_FLAGS, FLAG_TEARING_VAR } from "../dae/builder";
import { atomicChunkAlloc, debugLog } from "../arena";
import { simplifyAst } from "../parser";
import { isolateSymbolically, isTargetVar } from "../optimization/isolation";

/**
 * Block Lower Triangular (BLT) Transformation Engine.
 *
 * Transforms flat Differential-Algebraic Equation (DAE) systems into block lower
 * triangular form using bipartite matching and strongly connected components (SCC).
 *
 * Academic Citations:
 *   - Tarjan, R. E. (1972). "Depth-first search and linear graph algorithms."
 *     SIAM Journal on Computing, 1(2), pp. 146–160. DOI: 10.1137/0201010. (SCC Decomposition)
 *   - Hopcroft, J. E., & Karp, R. M. (1973). "An n^(5/2) algorithm for maximum matchings in bipartite graphs."
 *     SIAM Journal on Computing, 2(4), pp. 225–231. DOI: 10.1137/0202019.
 *   - Dulmage, A. L., & Mendelsohn, N. S. (1958). "Coverings of bipartite graphs."
 *     Canadian Journal of Mathematics, 10, pp. 517–534. DOI: 10.4153/CJM-1958-052-0. (Bipartite Structure)
 *   - Cellier, F. E., & Kofman, E. (2006). Continuous System Simulation. Springer.
 *     ISBN: 978-0-387-26102-7. (BLT Partitioning for Physical Systems)
 *
 * ModelScript Architectural Rationale:
 *   Flattened Modelica and cyber-physical models produce large-scale systems of coupled differential
 *   and algebraic equations. Solving a monolithic system of size N is computationally prohibitive (O(N^3)).
 *   BLT partitions the equation-variable dependency graph into a topological sequence of minimal
 *   strongly connected components (scalar assignments and small algebraic loops). This enables
 *   ModelScript's solvers to execute sequential forward evaluations interspersed with localized
 *   Newton-Raphson or Gröbner solves on isolated subproblems.
 *
 * Modifications:
 *   - Implemented entirely within WebAssembly linear memory (`@unmanaged`) with zero GC overhead.
 *   - Bipartite incidence graph is maintained in Compressed Sparse Row (CSR) format using `ChunkedInt32Array`.
 *   - Augmenting path matching and Tarjan's SCC stack operate directly on 32-bit arena node identifiers.
 *   - SCC block outputs feed directly into downstream tearing (`TornBlock`) and integrator stages.
 */
@unmanaged
export class BltEngine {
  /** Target DAE arena containing equations, variables, and AST expressions. */
  dae: DaeBuilder;

  // CSR Dependency Graph
  /** CSR row pointer array mapping each equation to its slice in `eqDepVars` and `eqDepWeights`. */
  eqDepPtrs: ChunkedInt32Array;
  /** CSR column index array storing variable IDs referenced by each equation. */
  eqDepVars: ChunkedInt32Array;
  /** CSR edge weights recording solvability classification (`SOLV_ANALYTIC`, `SOLV_LINEAR`, `SOLV_NONLINEAR`) per dependency. */
  eqDepWeights: ChunkedUint8Array;

  // Matching
  /** Maps each variable ID to its matched equation index (-1 if unmatched). */
  matchVarToEq: ChunkedInt32Array;
  /** Maps each equation index to its matched variable ID (-1 if unmatched). */
  matchEqToVar: ChunkedInt32Array;
  /** Visited marker array for variables during DFS augmenting-path bipartite matching. */
  visitedVar: ChunkedUint8Array;

  // Tarjan SCC
  /** Discovery timestamp index for each variable in Tarjan's SCC depth-first traversal. */
  indexMap: ChunkedInt32Array;
  /** Lowest reachable discovery index (`lowlink`) for each variable in Tarjan's SCC algorithm. */
  lowlinkMap: ChunkedInt32Array;
  /** Boolean flags indicating whether each variable is currently on the active Tarjan SCC recursion stack. */
  onStack: ChunkedUint8Array;
  /** Explicit recursion stack of variable IDs for Tarjan's SCC decomposition. */
  stack: ChunkedInt32Array;
  /** CSR-style block pointer offsets into `sccBlockEqs` delineating each topological SCC block. */
  sccBlockPtrs: ChunkedInt32Array;
  /** Flattened array of equation indices ordered by topological SCC blocks. */
  sccBlockEqs: ChunkedInt32Array;

  /**
   * Initializes BLT engine data structures with the given DAE builder instance.
   */
  init(dae: DaeBuilder): void {
    this.dae = dae;

    this.eqDepPtrs = createChunkedInt32Array(1024);
    this.eqDepVars = createChunkedInt32Array(4096);
    this.eqDepWeights = createChunkedUint8Array(4096);

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
   * Invalidates matching state for rolled-back equations and variables.
   * Enables an O(E) incremental warm-start when re-evaluating modified AST branches.
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
   * Iterates through expressions in O(1) linear memory without recursion and classifies edge isolatability.
   */
  @inline
  buildDependencies(): void {
    let eqCount = this.dae.eqCount;
    this.eqDepPtrs.clear();
    this.eqDepVars.clear();
    this.eqDepWeights.clear();

    // Ensure eqDepPtrs has capacity
    for (let i: u32 = 0; i <= eqCount; i++) {
      this.eqDepPtrs.push(0);
    }

    let exprStack = createChunkedInt32Array(256);
    let sideStack = createChunkedUint8Array(256); // 0 = LHS, 1 = RHS
    let seenVars = createChunkedUint8Array(this.dae.varCount);
    for (let i: u32 = 0; i < this.dae.varCount; i++) {
      seenVars.push(0);
    }

    for (let i: u32 = 0; i < eqCount; i++) {
      this.eqDepPtrs.set(i, this.eqDepVars.length);
      if (this.dae.isEqInitial(i) || this.dae.isEqRemoved(i)) continue;
      
      let offset = i * EQ_STRIDE;
      let lhsId = this.dae.getEqData().get(offset + EQ_LHS);
      let rhsId = this.dae.getEqData().get(offset + EQ_RHS);

      exprStack.clear();
      sideStack.clear();
      if (lhsId != 0xffffffff) {
        exprStack.push(lhsId);
        sideStack.push(0);
      }
      if (rhsId != 0xffffffff) {
        exprStack.push(rhsId);
        sideStack.push(1);
      }

      let lhsIsName = lhsId != 0xffffffff && (this.dae.getExprData().get(lhsId * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name);

      // Iterative DFS of expression tree
      while (exprStack.length > 0) {
        let exprId = exprStack.pop() as u32;
        let side = sideStack.pop();
        if (exprId == 0xffffffff || exprId >= this.dae.exprCount) continue;

        let exprOffset = exprId * EXPR_STRIDE;
        let kind = this.dae.getExprData().get(exprOffset + EXPR_KIND);

        if (kind == ExprKind.Name) {
          let rawId = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let varId: i32 = this.dae.resolveExprVarId(rawId);
          if (varId >= 0 && (varId as u32) < this.dae.varCount && seenVars.get(varId) == 0) {
            seenVars.set(varId, 1);
            this.eqDepVars.push(varId);

            // Compute Isolatability Priority Weight:
            // 0: Explicit/Linear (LHS single variable or simple linear occurrence)
            // 1: Symbolically Isolatable (single elementary function/transcendental)
            // 2: Non-isolatable fallback
            let priority: u8 = 2;
            if (side == 0 && lhsIsName && exprId == (lhsId as u32)) {
              priority = 0; // LHS explicit assignment: x = ...
            } else if (lhsIsName) {
              priority = 0; // RHS variable in simple LHS assignment
            } else {
              priority = 1; // Generic expression
            }
            this.eqDepWeights.push(priority);
          }
          continue;
        }

        if (
          kind == ExprKind.IntLiteral ||
          kind == ExprKind.RealLiteral ||
          kind == ExprKind.BoolLiteral ||
          kind == ExprKind.StringLiteral ||
          kind == ExprKind.EnumLiteral ||
          kind == ExprKind.Colon
        ) {
          continue;
        }

        if (kind == ExprKind.Der || kind == ExprKind.Pre) {
          let inner = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (inner != 0xffffffff && inner < this.dae.exprCount) {
            exprStack.push(inner as i32);
            sideStack.push(side);
          }
          if (left != 0xffffffff && left < this.dae.exprCount) {
            exprStack.push(left as i32);
            sideStack.push(side);
          }
          continue;
        }

        if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (left != 0xffffffff) {
            exprStack.push(left as i32);
            sideStack.push(side);
          }
          continue;
        }

        if (kind == ExprKind.Binary) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (left != 0xffffffff) {
            exprStack.push(left as i32);
            sideStack.push(side);
          }
          if (right != 0xffffffff) {
            exprStack.push(right as i32);
            sideStack.push(side);
          }
          continue;
        }

        if (kind == ExprKind.IfElse || kind == ExprKind.Range) {
          let data1 = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (data1 != 0xffffffff) {
            exprStack.push(data1 as i32);
            sideStack.push(side);
          }
          if (left != 0xffffffff) {
            exprStack.push(left as i32);
            sideStack.push(side);
          }
          if (right != 0xffffffff) {
            exprStack.push(right as i32);
            sideStack.push(side);
          }
          continue;
        }

        if (kind == ExprKind.Subscript || kind == ExprKind.Call || kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
          if (kind == ExprKind.Subscript) {
            let baseExpr = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
            if (baseExpr != 0xffffffff) {
              exprStack.push(baseExpr as i32);
              sideStack.push(side);
            }
          }
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let rightVal = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          let data1Val = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let count: u32 =
            kind == ExprKind.Call || kind == ExprKind.Subscript
              ? rightVal
              : rightVal > 0 && rightVal != 0xffffffff
                ? rightVal
                : data1Val;
          if (count > 0 && count != 0xffffffff && left != 0xffffffff) {
            exprStack.push(left as i32);
            sideStack.push(side);
            for (let a: u32 = 1; a < count; a++) {
              let argExpr = this.dae.getCallArgExprId(exprId, a);
              if (argExpr != 0xffffffff && argExpr < this.dae.exprCount) {
                exprStack.push(argExpr as i32);
                sideStack.push(side);
              }
            }
          }
          continue;
        }
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
   * Performs DFS augmenting path search for bipartite matching up to a maximum priority weight.
   */
  private dfsMatch(eqIdx: u32, maxPriority: u8): boolean {
    let start = this.eqDepPtrs.get(eqIdx);
    let end = this.eqDepPtrs.get(eqIdx + 1);

    for (let i: u32 = start as u32; i < (end as u32); i++) {
      let varIdx = this.eqDepVars.get(i);
      let priority = this.eqDepWeights.length > i ? this.eqDepWeights.get(i) : (0 as u8);
      if (priority > maxPriority) continue;

      if (this.visitedVar.get(varIdx) == 0) {
        this.visitedVar.set(varIdx, 1);
        let prevEq = this.matchVarToEq.get(varIdx);
        
        if (prevEq == -1 || this.dfsMatch(prevEq as u32, maxPriority)) {
          this.matchVarToEq.set(varIdx, eqIdx);
          this.matchEqToVar.set(eqIdx, varIdx);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Phase 2: Maximum Isolatability-Aware Bipartite Matching (Multi-pass DFS with warm-start).
   */
  @inline
  computeMatching(): void {
    let eqCount = this.dae.eqCount;
    let varCount = this.dae.varCount;

    // Ensure matching arrays are large enough
    while (this.matchVarToEq.length < varCount) this.matchVarToEq.push(-1);
    while (this.matchEqToVar.length < eqCount) this.matchEqToVar.push(-1);
    while (this.visitedVar.length < varCount) this.visitedVar.push(0);

    // Multi-pass isolatability-aware matching:
    // Pass 0: Priority 0 (Explicit / Linear)
    // Pass 1: Priority <= 1 (Symbolically Isolatable)
    // Pass 2: Priority <= 2 (Fallback / Non-isolatable)
    for (let priorityPass: u8 = 0; priorityPass <= 2; priorityPass++) {
      for (let i: u32 = 0; i < eqCount; i++) {
        // Warm start: skip equations that are already matched!
        if (this.matchEqToVar.get(i) != -1) continue;

        // Clear visited array
        for (let v: u32 = 0; v < varCount; v++) {
          this.visitedVar.set(v, 0);
        }

        this.dfsMatch(i, priorityPass);
      }
    }
  }

  /** Running DFS discovery counter used during Tarjan's SCC traversal. */
  private indexCounter: i32;
  /** Total number of strongly connected components (SCCs) discovered in the equation system. */
  private sccCount: u32;

  /**
   * Recursive Tarjan SCC helper for strongly connected component decomposition.
   */
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
        if (this.matchVarToEq.get(w) < 0) continue; // skip unmatched variables

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
      let blockStart = this.sccBlockEqs.length;

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

      if (blockSize > 0) {
        this.sccBlockPtrs.push(this.sccBlockEqs.length);
        this.sccCount++;

        // Phase 3: 1x1 Scalar Equation Block
        if (blockSize == 1) {
          // 1x1 scalar block is matched to varIdx; equations remain in original form
        } else if (blockSize > 1) {
          // Phase 4: Algebraic Loop Tearing for non-linear coupled systems
          this.tearAlgebraicLoop(blockStart, blockSize);
        }
      }
    }
  }

  /**
   * Symbolically isolates a single variable in a 1x1 equation block.
   */
  @inline
  isolateEquation(eqId: u32, targetVarId: u32): void {
    if (eqId >= this.dae.eqCount || targetVarId >= this.dae.varCount) return;
    let isolatedRhs = isolateSymbolically(this.dae, eqId, targetVarId);
    if (isolatedRhs != 0xffffffff) {
      let offset = eqId * EQ_STRIDE;
      let curLhs = this.dae.getEqData().get(offset + EQ_LHS) as u32;
      let curRhs = this.dae.getEqData().get(offset + EQ_RHS) as u32;
      let targetExpr: u32;
      if (isTargetVar(this.dae, curLhs, targetVarId)) {
        targetExpr = curLhs;
      } else if (isTargetVar(this.dae, curRhs, targetVarId)) {
        targetExpr = curRhs;
      } else {
        targetExpr = this.dae.addName(targetVarId);
      }
      this.dae.getEqData().set(offset + EQ_LHS, targetExpr as i32);
      this.dae.getEqData().set(offset + EQ_RHS, isolatedRhs as i32);
    }
  }

  /**
   * Helper: checks if equation `eqIdx` depends on `varIdx`.
   */
  @inline
  private eqDependsOnVar(eqIdx: i32, varIdx: i32): boolean {
    if (eqIdx < 0 || varIdx < 0) return false;
    let start = this.eqDepPtrs.get(eqIdx as u32);
    let end = this.eqDepPtrs.get((eqIdx as u32) + 1);
    for (let k: i32 = start; k < end; k++) {
      if (this.eqDepVars.get(k as u32) == varIdx) return true;
    }
    return false;
  }

  /**
   * Applies algebraic loop tearing to strongly connected components larger than 1x1.
   * Partitions the block into Tearing Variables, Inner System, and Residual Equations
   * by greedily tearing variables with maximum cycle incidence until the remaining
   * inner equations form an acyclic DAG.
   */
  @inline
  tearAlgebraicLoop(blockOffset: i32, blockSize: i32): void {
    if (blockSize <= 1) return;

    let tornMask = createChunkedUint8Array(blockSize as u32);
    let inDegree = createChunkedInt32Array(blockSize as u32);
    let visited = createChunkedUint8Array(blockSize as u32);
    let queue = createChunkedInt32Array(blockSize as u32);

    for (let i: i32 = 0; i < blockSize; i++) {
      tornMask.push(0);
      inDegree.push(0);
      visited.push(0);
    }

    let tornCount: i32 = 0;
    while (tornCount < blockSize - 1) {
      // Check if remaining untorn equations/variables form an acyclic DAG via Kahn's algorithm
      let untornTotal: i32 = 0;
      queue.clear();
      for (let i: i32 = 0; i < blockSize; i++) {
        visited.set(i as u32, 0);
        if (tornMask.get(i as u32) != 0) {
          inDegree.set(i as u32, -1);
          continue;
        }
        untornTotal++;
        let eqI = this.sccBlockEqs.get((blockOffset + i) as u32);
        let deg: i32 = 0;
        for (let j: i32 = 0; j < blockSize; j++) {
          if (i == j || tornMask.get(j as u32) != 0) continue;
          let varJ = this.matchEqToVar.get(this.sccBlockEqs.get((blockOffset + j) as u32) as u32);
          if (this.eqDependsOnVar(eqI, varJ)) {
            deg++;
          }
        }
        inDegree.set(i as u32, deg);
        if (deg == 0) {
          queue.push(i);
        }
      }

      let resolvedCount: i32 = 0;
      let qHead: u32 = 0;
      while (qHead < queue.length) {
        let u = queue.get(qHead++);
        visited.set(u as u32, 1);
        resolvedCount++;
        let varU = this.matchEqToVar.get(this.sccBlockEqs.get((blockOffset + u) as u32) as u32);
        for (let i: i32 = 0; i < blockSize; i++) {
          if (i == u || tornMask.get(i as u32) != 0 || visited.get(i as u32) != 0) continue;
          let eqI = this.sccBlockEqs.get((blockOffset + i) as u32);
          if (this.eqDependsOnVar(eqI, varU)) {
            let nextDeg = inDegree.get(i as u32) - 1;
            inDegree.set(i as u32, nextDeg);
            if (nextDeg == 0) {
              queue.push(i);
            }
          }
        }
      }

      if (resolvedCount == untornTotal) {
        // Remaining untorn equations form a causal DAG!
        break;
      }

      // Select best tearing candidate among unvisited (cycle-participating) untorn variables:
      // Prefer the variable that breaks the most dependencies in other cycle equations,
      // with tie-breaking by lowest total dependency count in its matched residual equation.
      let bestIdx: i32 = -1;
      let bestScore: i32 = -0x7fffffff;

      for (let j: i32 = 0; j < blockSize; j++) {
        if (tornMask.get(j as u32) != 0 || visited.get(j as u32) != 0) continue;
        let eqJ = this.sccBlockEqs.get((blockOffset + j) as u32);
        let varJ = this.matchEqToVar.get(eqJ as u32);
        if (varJ == -1) continue;

        let outCycleIncidence: i32 = 0;
        for (let i: i32 = 0; i < blockSize; i++) {
          if (i == j || tornMask.get(i as u32) != 0 || visited.get(i as u32) != 0) continue;
          let eqI = this.sccBlockEqs.get((blockOffset + i) as u32);
          if (this.eqDependsOnVar(eqI, varJ)) {
            outCycleIncidence++;
          }
        }

        let start = this.eqDepPtrs.get(eqJ as u32);
        let end = this.eqDepPtrs.get((eqJ as u32) + 1);
        let eqDegree = end - start;
        let score = outCycleIncidence * 1024 - eqDegree;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }

      if (bestIdx == -1) {
        for (let j: i32 = 0; j < blockSize; j++) {
          if (tornMask.get(j as u32) == 0) {
            bestIdx = j;
            break;
          }
        }
      }

      if (bestIdx == -1) break;

      tornMask.set(bestIdx as u32, 1);
      tornCount++;
      let tearEq = this.sccBlockEqs.get((blockOffset + bestIdx) as u32);
      let tearVar = this.matchEqToVar.get(tearEq as u32);
      if (tearVar != -1) {
        let offset = (tearVar as u32) * VAR_STRIDE;
        let curFlags = this.dae.getVarData().get(offset + VAR_FLAGS);
        this.dae.getVarData().set(offset + VAR_FLAGS, curFlags | FLAG_TEARING_VAR);
      }
    }
  }


  /**
   * Phase 3: Tarjan Strongly Connected Components (SCC) computation.
   */
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
  }

  /**
   * Executes full BLT pipeline: buildDependencies -> computeMatching -> computeSCC.
   */
  @inline
  computeBLT(): void {
    this.buildDependencies();
    this.computeMatching();
    this.computeSCC();
  }
}

/**
 * Creates and initializes a new BltEngine instance in linear memory.
 */
export function blt_createEngine(daePtr: u32): u32 {
  let ptr = atomicChunkAlloc(256);
  let engine = changetype<BltEngine>(ptr);
  engine.init(changetype<DaeBuilder>(daePtr));
  return ptr as u32;
}

/**
 * Computes BLT block partitioning on the target engine instance.
 */
export function blt_compute(enginePtr: u32): void {
  changetype<BltEngine>(enginePtr).computeBLT();
}

/**
 * Rolls back the BLT engine matching state to a previous snapshot.
 */
export function blt_rollback(enginePtr: u32, snapshotEqCount: u32, snapshotVarCount: u32): void {
  changetype<BltEngine>(enginePtr).rollback(snapshotEqCount, snapshotVarCount);
}

/**
 * Returns the total number of topological SCC blocks computed by the BLT engine.
 */
export function blt_getSccCount(enginePtr: u32): u32 {
  if (enginePtr == 0) return 0;
  return changetype<BltEngine>(enginePtr).sccCount;
}

/**
 * Returns the number of equations in the `sccIdx`-th SCC block.
 */
export function blt_getSccBlockSize(enginePtr: u32, sccIdx: u32): u32 {
  if (enginePtr == 0) return 0;
  let engine = changetype<BltEngine>(enginePtr);
  if (sccIdx >= engine.sccCount) return 0;
  let start = engine.sccBlockPtrs.get(sccIdx);
  let end = engine.sccBlockPtrs.get(sccIdx + 1);
  return (end - start) as u32;
}

/**
 * Returns the equation index at `eqOffset` within the `sccIdx`-th SCC block, or -1 if out of bounds.
 */
export function blt_getSccBlockEq(enginePtr: u32, sccIdx: u32, eqOffset: u32): i32 {
  if (enginePtr == 0) return -1;
  let engine = changetype<BltEngine>(enginePtr);
  if (sccIdx >= engine.sccCount) return -1;
  let start = engine.sccBlockPtrs.get(sccIdx);
  let end = engine.sccBlockPtrs.get(sccIdx + 1);
  if (start + (eqOffset as i32) >= end) return -1;
  return engine.sccBlockEqs.get(start + (eqOffset as i32));
}

/**
 * Returns the equation index matched to variable `varId`, or -1 if unmatched.
 */
export function blt_getMatchVarToEq(enginePtr: u32, varId: u32): i32 {
  if (enginePtr == 0) return -1;
  let engine = changetype<BltEngine>(enginePtr);
  if (varId >= (engine.matchVarToEq.length as u32)) return -1;
  return engine.matchVarToEq.get(varId);
}

/**
 * Returns the variable ID matched to equation `eqId`, or -1 if unmatched.
 */
export function blt_getMatchEqToVar(enginePtr: u32, eqId: u32): i32 {
  if (enginePtr == 0) return -1;
  let engine = changetype<BltEngine>(enginePtr);
  if (eqId >= (engine.matchEqToVar.length as u32)) return -1;
  return engine.matchEqToVar.get(eqId);
}

/**
 * Modular BLT Composition: Combines boundary connections with pre-computed component BLTs.
 * Warm-starts global matching from component matchings, runs global SCC & tearing, and
 * optionally writes the combined topological equation order to `outCombinedOrderPtr`.
 */
export function dae_composeModularBlt(
  globalEnginePtr: u32,
  nComponents: u32,
  compEnginesPtr: u32,
  outCombinedOrderPtr: u32 = 0
): u32 {
  if (globalEnginePtr == 0) return 0;
  let globalEngine = changetype<BltEngine>(globalEnginePtr);
  let globalEqCount = globalEngine.dae.eqCount;
  let globalVarCount = globalEngine.dae.varCount;

  while (globalEngine.matchVarToEq.length < globalVarCount) globalEngine.matchVarToEq.push(-1);
  while (globalEngine.matchEqToVar.length < globalEqCount) globalEngine.matchEqToVar.push(-1);

  // 1. Seed warm-start matchings from pre-computed component BLTs when provided
  if (nComponents > 0 && compEnginesPtr != 0) {
    for (let c: u32 = 0; c < nComponents; c++) {
      let compPtr = load<u32>((compEnginesPtr + c * 4) as usize);
      if (compPtr == 0) continue;
      let compEngine = changetype<BltEngine>(compPtr);
      let compVarLen = compEngine.matchVarToEq.length;
      for (let v: u32 = 0; v < compVarLen && v < globalVarCount; v++) {
        let mEq = compEngine.matchVarToEq.get(v);
        if (mEq >= 0 && (mEq as u32) < globalEqCount) {
          if (globalEngine.matchVarToEq.get(v) == -1 && globalEngine.matchEqToVar.get(mEq as u32) == -1) {
            globalEngine.matchVarToEq.set(v, mEq);
            globalEngine.matchEqToVar.set(mEq as u32, v as i32);
          }
        }
      }
    }
  }

  // 2. Run global dependency construction, incremental augmenting-path matching, and SCC + tearing
  globalEngine.computeBLT();

  // 3. Write combined topological equation schedule into outCombinedOrderPtr if provided
  if (outCombinedOrderPtr != 0) {
    let totalEqs = globalEngine.sccBlockEqs.length;
    for (let i: u32 = 0; i < totalEqs; i++) {
      store<i32>((outCombinedOrderPtr + i * 4) as usize, globalEngine.sccBlockEqs.get(i));
    }
  }

  return globalEngine.sccCount;
}

