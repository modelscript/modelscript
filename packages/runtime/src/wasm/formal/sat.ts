// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Flat-Buffer CDCL SAT Solver Core (AssemblyScript / WebAssembly)
 *
 * Implements a modern Conflict-Driven Clause Learning (CDCL) Boolean satisfiability solver
 * in WebAssembly linear memory with:
 *   - Two-Watched-Literals (2WL) scheme for O(1) BCP
 *   - 1-UIP (First Unique Implication Point) conflict analysis & non-chronological backjumping
 *   - VSIDS decision heuristic with binary max-heap priority queue and phase saving
 *   - Periodic activity rescaling (1e-100) to prevent IEEE 754 infinity overflow
 *   - Incremental solving under temporary assumption vectors with UNSAT core extraction
 */

export const SAT_RESULT_UNKNOWN: i32 = 0;
export const SAT_RESULT_SAT: i32     = 1;
export const SAT_RESULT_UNSAT: i32   = 2;

@inline
export function satLitToVar(lit: i32): i32 {
  return lit < 0 ? -lit : lit;
}

@inline
export function satLitSign(lit: i32): bool {
  return lit > 0;
}

@inline
export function satLitToIndex(lit: i32): i32 {
  return lit > 0 ? (lit << 1) : (((-lit) << 1) | 1);
}

@inline
export function satIndexToLit(idx: i32): i32 {
  let v = idx >> 1;
  return (idx & 1) == 0 ? v : -v;
}

@inline
export function satNegateLit(lit: i32): i32 {
  return -lit;
}

export class WasmCdclSolver {
  public numVars: i32;

  // Clause database: each clause is an Array<i32> of signed literals
  public clauses: Array<Array<i32>>;

  // Two-Watched-Literals: watches[litIndex] -> list of clause indices
  public watches: Array<Array<i32>>;

  // Variable assignments: 0 = unassigned, 1 = true, -1 = false
  public assigns: Int8Array;

  // Decision level at which each variable was assigned
  public level: Int32Array;

  // Implicating clause index for each variable (-1 for decisions / assumptions)
  public reason: Int32Array;

  // Assignment history trail (signed literals in assignment order)
  public trail: Array<i32>;

  // Trail limits (start index in trail for each decision level)
  public trailLim: Array<i32>;

  // Activity scores for VSIDS
  public activity: Float64Array;
  public varInc: f64;
  public readonly varDecay: f64;

  // Binary max-heap for O(1) branch variable selection
  public orderHeap: Array<i32>;
  public heapPos: Int32Array;

  // Phase saving: last assigned polarity (1 or -1)
  public savedPhase: Int8Array;

  // Solver search state
  public currentLevel: i32;
  public isRootUnsat: bool;

  // Buffer for seen variables during conflict analysis (zero-allocation)
  public seen: Uint8Array;

  // Assumptions and UNSAT core
  public assumptionLevel: i32;
  public unsatCore: Array<i32>;

  constructor(numVars: i32) {
    this.numVars = numVars;
    let varSlots = numVars + 1;
    let litSlots = varSlots * 2;

    this.clauses = new Array<Array<i32>>();
    this.assigns = new Int8Array(varSlots);
    this.level = new Int32Array(varSlots);

    let reasonArr = new Int32Array(varSlots);
    for (let i = 0; i < varSlots; i++) {
      reasonArr[i] = -1;
    }
    this.reason = reasonArr;

    this.trail = new Array<i32>();
    this.trailLim = new Array<i32>();

    this.activity = new Float64Array(varSlots);
    this.varInc = 1.0;
    this.varDecay = 0.95;

    this.orderHeap = new Array<i32>();

    let heapPosArr = new Int32Array(varSlots);
    for (let i = 0; i < varSlots; i++) {
      heapPosArr[i] = -1;
    }
    this.heapPos = heapPosArr;

    this.savedPhase = new Int8Array(varSlots);
    this.seen = new Uint8Array(varSlots);

    this.currentLevel = 0;
    this.isRootUnsat = false;
    this.assumptionLevel = 0;
    this.unsatCore = new Array<i32>();

    let watchesArr = new Array<Array<i32>>(litSlots);
    for (let i = 0; i < litSlots; i++) {
      watchesArr[i] = new Array<i32>();
    }
    this.watches = watchesArr;

    // Initialize all variables into the order heap
    for (let v = 1; v <= numVars; v++) {
      this.insertVarOrder(v);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Binary Max-Heap Operations
  // ───────────────────────────────────────────────────────────────────────────

  @inline
  private inHeap(v: i32): bool {
    return this.heapPos[v] != -1;
  }

  @inline
  private heapLess(i: i32, j: i32): bool {
    let vi = this.orderHeap[i];
    let vj = this.orderHeap[j];
    return this.activity[vi] < this.activity[vj];
  }

  @inline
  private swapHeap(i: i32, j: i32): void {
    let vi = this.orderHeap[i];
    let vj = this.orderHeap[j];
    this.orderHeap[i] = vj;
    this.orderHeap[j] = vi;
    this.heapPos[vi] = j;
    this.heapPos[vj] = i;
  }

  private siftUp(i: i32): void {
    while (i > 0) {
      let parent = (i - 1) >> 1;
      if (this.heapLess(parent, i)) {
        this.swapHeap(parent, i);
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(i: i32): void {
    let n = this.orderHeap.length;
    while (true) {
      let largest = i;
      let left = (i << 1) + 1;
      let right = left + 1;
      if (left < n && this.heapLess(largest, left)) {
        largest = left;
      }
      if (right < n && this.heapLess(largest, right)) {
        largest = right;
      }
      if (largest != i) {
        this.swapHeap(i, largest);
        i = largest;
      } else {
        break;
      }
    }
  }

  public insertVarOrder(v: i32): void {
    if (!this.inHeap(v) && this.assigns[v] == 0) {
      let idx = this.orderHeap.length;
      this.orderHeap.push(v);
      this.heapPos[v] = idx;
      this.siftUp(idx);
    }
  }

  public updateVarOrder(v: i32): void {
    let pos = this.heapPos[v];
    if (pos != -1) {
      this.siftUp(pos);
    }
  }

  public bumpVarActivity(v: i32): void {
    let act = this.activity[v] + this.varInc;
    this.activity[v] = act;
    if (act > 1e100) {
      this.rescaleVarActivities();
    }
    this.updateVarOrder(v);
  }

  private rescaleVarActivities(): void {
    for (let v = 1; v <= this.numVars; v++) {
      this.activity[v] *= 1e-100;
    }
    this.varInc *= 1e-100;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Literals & Variable Values
  // ───────────────────────────────────────────────────────────────────────────

  @inline
  public litValue(lit: i32): i32 {
    let v = satLitToVar(lit);
    let a = this.assigns[v];
    if (a == 0) return 0;
    return lit > 0 ? (a as i32) : (-(a as i32));
  }

  @inline
  public getValue(v: i32): i32 {
    if (v < 1 || v > this.numVars) return 0;
    return this.assigns[v] as i32;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Trail & Enqueue Operations
  // ───────────────────────────────────────────────────────────────────────────

  public enqueue(lit: i32, reasonClause: i32 = -1): bool {
    let val = this.litValue(lit);
    if (val == 1) return true;  // already satisfied
    if (val == -1) return false; // conflict!

    let v = satLitToVar(lit);
    let signVal: i8 = lit > 0 ? 1 : -1;
    this.assigns[v] = signVal;
    this.level[v] = this.currentLevel;
    this.reason[v] = reasonClause;
    this.savedPhase[v] = signVal;
    this.trail.push(lit);
    return true;
  }

  public backtrack(targetLevel: i32): void {
    if (this.currentLevel <= targetLevel) return;

    let targetTrailLim: i32 = 0;
    if (targetLevel == 0) {
      targetTrailLim = this.trailLim.length > 0 ? this.trailLim[0] : 0;
    } else if (targetLevel < this.trailLim.length) {
      targetTrailLim = this.trailLim[targetLevel];
    } else {
      targetTrailLim = this.trail.length;
    }

    while (this.trail.length > targetTrailLim) {
      let lit = this.trail.pop();
      let v = satLitToVar(lit);
      this.assigns[v] = 0;
      this.level[v] = 0;
      this.reason[v] = -1;
      this.insertVarOrder(v);
    }

    this.trailLim.length = targetLevel;
    this.currentLevel = targetLevel;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Clause Addition & Watching
  // ───────────────────────────────────────────────────────────────────────────

  private addWatcher(lit: i32, cIdx: i32): void {
    let idx = satLitToIndex(lit);
    this.watches[idx].push(cIdx);
  }

  public addClause(lits: Array<i32>): bool {
    if (this.isRootUnsat) return false;
    if (this.currentLevel > 0) {
      this.backtrack(0);
    }

    // Simplify: check tautologies and duplicates
    let simplified = new Array<i32>();
    for (let i = 0; i < lits.length; i++) {
      let lit = lits[i];
      let v = satLitToVar(lit);
      if (v > this.numVars) continue;

      let duplicate = false;
      let tautology = false;
      for (let j = 0; j < simplified.length; j++) {
        if (simplified[j] == lit) {
          duplicate = true;
          break;
        }
        if (simplified[j] == -lit) {
          tautology = true;
          break;
        }
      }
      if (tautology) return true; // Tautology clause is always satisfied
      if (!duplicate) {
        simplified.push(lit);
      }
    }

    if (simplified.length == 0) {
      this.isRootUnsat = true;
      return false;
    }

    if (simplified.length == 1) {
      let lit = simplified[0];
      this.clauses.push(simplified);
      let cIdx = this.clauses.length - 1;
      if (!this.enqueue(lit, cIdx)) {
        this.isRootUnsat = true;
        return false;
      }
      return true;
    }

    let cIdx = this.clauses.length;
    this.clauses.push(simplified);

    // Watch the first two literals
    this.addWatcher(simplified[0], cIdx);
    this.addWatcher(simplified[1], cIdx);
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Boolean Constraint Propagation (BCP) with Two-Watched-Literals
  // ───────────────────────────────────────────────────────────────────────────

  public propagate(): i32 {
    let head = 0;
    if (this.currentLevel > 0 && this.trailLim.length > 0) {
      head = this.trailLim[this.trailLim.length - 1];
    }

    let pIdx = head;
    while (pIdx < this.trail.length) {
      let lit = this.trail[pIdx++];
      let falseLit = -lit;
      let watchIdx = satLitToIndex(falseLit);
      let watchList = this.watches[watchIdx];

      let remainingWatches = new Array<i32>();

      for (let i = 0; i < watchList.length; i++) {
        let cIdx = watchList[i];
        let clause = this.clauses[cIdx];

        // Ensure falseLit is at index 1
        if (clause[0] == falseLit) {
          clause[0] = clause[1];
          clause[1] = falseLit;
        }

        let firstLit = clause[0];
        let firstVal = this.litValue(firstLit);

        // If first watcher is already satisfied, keep watching
        if (firstVal == 1) {
          remainingWatches.push(cIdx);
          continue;
        }

        // Search for replacement watcher in clause[2..end]
        let foundNewWatcher = false;
        for (let j = 2; j < clause.length; j++) {
          if (this.litValue(clause[j]) != -1) {
            clause[1] = clause[j];
            clause[j] = falseLit;
            this.addWatcher(clause[1], cIdx);
            foundNewWatcher = true;
            break;
          }
        }

        if (foundNewWatcher) continue;

        // No alternative watcher found: clause is either unit or conflicting
        remainingWatches.push(cIdx);

        if (firstVal == -1) {
          // Conflict detected!
          for (let k = i + 1; k < watchList.length; k++) {
            remainingWatches.push(watchList[k]);
          }
          this.watches[watchIdx] = remainingWatches;
          return cIdx;
        } else {
          // Unit propagation
          if (!this.enqueue(firstLit, cIdx)) {
            for (let k = i + 1; k < watchList.length; k++) {
              remainingWatches.push(watchList[k]);
            }
            this.watches[watchIdx] = remainingWatches;
            return cIdx;
          }
        }
      }

      this.watches[watchIdx] = remainingWatches;
    }

    return -1; // No conflict
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1-UIP Conflict Analysis & Non-Chronological Backjumping
  // ───────────────────────────────────────────────────────────────────────────

  private analyzeConflict(conflictCIdx: i32, outLearned: Array<i32>): i32 {
    outLearned.length = 0;
    let pathCount = 0;
    let pLit: i32 = 0;

    let trailIdx = this.trail.length - 1;
    let currentClause = this.clauses[conflictCIdx];

    let otherLits = new Array<i32>();

    do {
      for (let i = 0; i < currentClause.length; i++) {
        let lit = currentClause[i];
        let v = satLitToVar(lit);
        let lvl = this.level[v];

        if (this.seen[v] == 0 && lvl > 0) {
          this.seen[v] = 1;
          this.bumpVarActivity(v);

          if (lvl == this.currentLevel) {
            pathCount++;
          } else {
            otherLits.push(lit);
          }
        }
      }

      // Trace backward along trail to find next marked variable at currentLevel
      while (trailIdx >= 0) {
        let nextLit = this.trail[trailIdx--];
        let nextVar = satLitToVar(nextLit);

        if (this.seen[nextVar] != 0 && this.level[nextVar] == this.currentLevel) {
          pLit = nextLit;
          break;
        }
      }

      pathCount--;
      if (pathCount > 0) {
        let rIdx = this.reason[satLitToVar(pLit)];
        if (rIdx >= 0) {
          currentClause = this.clauses[rIdx];
        } else {
          break;
        }
      }
    } while (pathCount > 0);

    // 1-UIP asserting literal is -pLit
    outLearned.push(-pLit);

    // Decay variable activities
    this.varInc *= (1.0 / this.varDecay);

    // Compute backjump level and find the literal with the highest decision level
    let backjumpLevel = 0;
    let maxIdx = -1;

    for (let i = 0; i < otherLits.length; i++) {
      let lvl = this.level[satLitToVar(otherLits[i])];
      if (lvl > backjumpLevel) {
        backjumpLevel = lvl;
        maxIdx = i;
      }
    }

    if (maxIdx > 0) {
      let tmp = otherLits[0];
      otherLits[0] = otherLits[maxIdx];
      otherLits[maxIdx] = tmp;
    }

    for (let i = 0; i < otherLits.length; i++) {
      outLearned.push(otherLits[i]);
    }

    // Clean up seen flags
    for (let i = 0; i < outLearned.length; i++) {
      let v = satLitToVar(outLearned[i]);
      this.seen[v] = 0;
    }

    return backjumpLevel;
  }

  private analyzeFinalConflict(conflictClause: Array<i32>, assumptions: Array<i32>): void {
    this.unsatCore.length = 0;
    let seenVars = new Uint8Array(this.numVars + 1);

    for (let i = 0; i < conflictClause.length; i++) {
      let v = satLitToVar(conflictClause[i]);
      if (v <= this.numVars) {
        seenVars[v] = 1;
      }
    }

    for (let i = this.trail.length - 1; i >= 0; i--) {
      let lit = this.trail[i];
      let v = satLitToVar(lit);

      if (seenVars[v] != 0) {
        seenVars[v] = 0;
        let rIdx = this.reason[v];

        if (rIdx < 0) {
          // Decision or assumption
          for (let a = 0; a < assumptions.length; a++) {
            if (assumptions[a] == lit || assumptions[a] == -lit) {
              let alreadyInCore = false;
              for (let c = 0; c < this.unsatCore.length; c++) {
                if (this.unsatCore[c] == assumptions[a]) {
                  alreadyInCore = true;
                  break;
                }
              }
              if (!alreadyInCore) {
                this.unsatCore.push(assumptions[a]);
              }
              break;
            }
          }
        } else {
          let rClause = this.clauses[rIdx];
          for (let j = 0; j < rClause.length; j++) {
            let antVar = satLitToVar(rClause[j]);
            if (antVar != v && antVar <= this.numVars) {
              if (this.level[antVar] > 0) {
                seenVars[antVar] = 1;
              }
            }
          }
        }
      }
    }

    if (this.unsatCore.length == 0) {
      for (let a = 0; a < assumptions.length; a++) {
        this.unsatCore.push(assumptions[a]);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Main CDCL Solve Loop (with Assumptions & UNSAT Core Extraction)
  // ───────────────────────────────────────────────────────────────────────────

  public solve(assumptions: Array<i32>): i32 {
    if (this.isRootUnsat) return SAT_RESULT_UNSAT;

    this.backtrack(0);
    this.unsatCore.length = 0;

    // Propagate level 0
    let conflict = this.propagate();
    if (conflict != -1) {
      this.isRootUnsat = true;
      return SAT_RESULT_UNSAT;
    }

    // Enqueue assumptions at successive decision levels
    this.assumptionLevel = assumptions.length;
    for (let i = 0; i < assumptions.length; i++) {
      let lit = assumptions[i];
      let val = this.litValue(lit);

      if (val == 1) {
        continue; // Already holds
      }
      if (val == -1) {
        // Assumption contradicts previous assignment on trail: trace back reason
        let confl = new Array<i32>(1);
        confl[0] = -lit;
        this.analyzeFinalConflict(confl, assumptions);
        let alreadyIn = false;
        for (let k = 0; k < this.unsatCore.length; k++) {
          if (this.unsatCore[k] == lit) {
            alreadyIn = true;
            break;
          }
        }
        if (!alreadyIn) {
          this.unsatCore.push(lit);
        }
        this.backtrack(0);
        return SAT_RESULT_UNSAT;
      }

      this.currentLevel++;
      this.trailLim.push(this.trail.length);
      this.enqueue(lit, -1);

      conflict = this.propagate();
      if (conflict != -1) {
        // Conflict under assumption
        this.analyzeFinalConflict(this.clauses[conflict], assumptions);
        this.backtrack(0);
        return SAT_RESULT_UNSAT;
      }
    }

    // ── CDCL Main Search Loop ──
    let learned = new Array<i32>();

    while (true) {
      conflict = this.propagate();

      if (conflict != -1) {
        if (this.currentLevel == 0) {
          this.isRootUnsat = true;
          return SAT_RESULT_UNSAT;
        }

        let btLevel = this.analyzeConflict(conflict, learned);

        if (btLevel < this.assumptionLevel) {
          // Conflict reaches assumption levels: extract minimal conflicting core
          this.analyzeFinalConflict(this.clauses[conflict], assumptions);
          this.backtrack(0);
          return SAT_RESULT_UNSAT;
        }

        this.backtrack(btLevel);

        if (learned.length == 1) {
          this.clauses.push(learned);
          let cIdx = this.clauses.length - 1;
          this.enqueue(learned[0], cIdx);
        } else {
          let cIdx = this.clauses.length;
          let newClause = new Array<i32>(learned.length);
          for (let k = 0; k < learned.length; k++) {
            newClause[k] = learned[k];
          }
          this.clauses.push(newClause);
          this.addWatcher(newClause[0], cIdx);
          this.addWatcher(newClause[1], cIdx);
          this.enqueue(newClause[0], cIdx);
        }
      } else {
        // Find next decision variable
        let nextVar = 0;
        while (this.orderHeap.length > 0) {
          let v = this.orderHeap[0];
          // Pop root
          let last = this.orderHeap.pop();
          this.heapPos[v] = -1;
          if (this.orderHeap.length > 0) {
            this.orderHeap[0] = last;
            this.heapPos[last] = 0;
            this.siftDown(0);
          }
          if (this.assigns[v] == 0) {
            nextVar = v;
            break;
          }
        }

        if (nextVar == 0) {
          // All variables are assigned without conflict -> SAT!
          return SAT_RESULT_SAT;
        }

        // Phase saving decision
        let sign = this.savedPhase[nextVar];
        if (sign == 0) sign = 1;
        let decLit = sign > 0 ? nextVar : -nextVar;

        this.currentLevel++;
        this.trailLim.push(this.trail.length);
        this.enqueue(decLit, -1);
      }
    }

    return SAT_RESULT_UNKNOWN;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C-ABI / WebAssembly Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new WasmCdclSolver instance in WASM linear memory.
 */
export function sat_create(numVars: i32): usize {
  let solver = new WasmCdclSolver(numVars);
  return changetype<usize>(solver);
}

/**
 * Adds a clause to the solver.
 * `litsPtr` points to an array of 32-bit signed integers.
 */
export function sat_addClause(satPtr: usize, litsPtr: usize, litCount: i32): bool {
  if (satPtr == 0) return false;
  let solver = changetype<WasmCdclSolver>(satPtr);

  let lits = new Array<i32>(litCount);
  for (let i = 0; i < litCount; i++) {
    lits[i] = load<i32>(litsPtr + (i << 2));
  }
  return solver.addClause(lits);
}

/**
 * Solves the Boolean formula under optional assumptions.
 * Returns 1 for SAT, 2 for UNSAT, 0 for UNKNOWN.
 */
export function sat_solve(satPtr: usize, assumptionsPtr: usize, assumptionCount: i32): i32 {
  if (satPtr == 0) return SAT_RESULT_UNKNOWN;
  let solver = changetype<WasmCdclSolver>(satPtr);

  let assumptions = new Array<i32>(assumptionCount);
  for (let i = 0; i < assumptionCount; i++) {
    assumptions[i] = load<i32>(assumptionsPtr + (i << 2));
  }
  return solver.solve(assumptions);
}

/**
 * Gets the truth assignment of a variable in the SAT model:
 * Returns 1 for true, -1 for false, 0 for unassigned.
 */
export function sat_getValue(satPtr: usize, varId: i32): i32 {
  if (satPtr == 0) return 0;
  let solver = changetype<WasmCdclSolver>(satPtr);
  return solver.getValue(varId);
}

/**
 * Copies the UNSAT core literals into outCorePtr (an array of 32-bit ints).
 * Returns the number of literals in the UNSAT core.
 */
export function sat_getUnsatCore(satPtr: usize, outCorePtr: usize): i32 {
  if (satPtr == 0) return 0;
  let solver = changetype<WasmCdclSolver>(satPtr);
  let core = solver.unsatCore;
  let len = core.length;
  if (outCorePtr != 0) {
    for (let i = 0; i < len; i++) {
      store<i32>(outCorePtr + (i << 2), core[i]);
    }
  }
  return len;
}

/**
 * Destroys/dereferences the solver instance.
 */
export function sat_destroy(satPtr: usize): void {
  // In AssemblyScript, unreferencing allows the GC/runtime to reclaim memory
}
