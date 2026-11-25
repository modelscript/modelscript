// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  ExprKind,
  VarType,
  analyzeLinearSccBlock,
  isolateSymbolicallyArena,
  solveLinearSccBlockDirect,
  type ArenaExecutionBlock,
  type LinearSccPlan,
} from "@modelscript/runtime";
import {
  Dual,
  evaluateArenaDualExpression,
  evaluateArenaDualFlat,
  evaluateArenaRuntime,
} from "@modelscript/runtime/wasm_evaluator.js";
import { luFactorFlat, luSolveFlat, type LUFactorizationFlat } from "@modelscript/runtime/wasm_gaussian.js";
import { compileArenaTornPlan } from "./arena-block-compiler.js";
import {
  NEWTON_MAX_ITER,
  NEWTON_TOL,
  SQRT_EPS,
  TORN_LINE_ALPHAS,
  type SystemExecutionBlock,
  type TornExecutionPlan,
} from "./arena-sim-types.js";

export interface ArenaAlgebraicSolverHost {
  arena: DAEBuilder;
  preValuesByStringId: Float64Array;
  getDiscreteEventEpoch(): number;
  isInAdaptiveTrialStage(): boolean;
  markAlgebraicDivergedInTrialStage(): void;
}

/**
 * Zero-allocation algebraic loop solver for simultaneous BLT `system` blocks.
 *
 * Owns pre-allocated typed-array scratch buffers and an L1-friendly warm-start cache
 * indexed directly by interned StringId. Supports:
 * - Kron/Cellier tearing with JIT-compiled forward causal chains and Chord-Newton reuse
 * - Direct linear SCC fast-path solving (`solveLinearSccBlockDirect`)
 * - Damped Newton-Raphson with flat forward-mode AD (`evaluateArenaDualFlat`), epoch-cached LU
 *   (`luFactorFlat`/`luSolveFlat`), Armijo line search, and mixed Boolean/Real systems
 * - Implicit Function Theorem forward-mode dual sensitivity propagation (`propagateSystemBlockDual`)
 */
export class ArenaAlgebraicSolver {
  /** Flat L1-friendly warm-start cache for algebraic loop variables indexed directly by interned StringId. */
  public algWarmStartVals = new Float64Array(4096);
  public algWarmStartValid = new Uint8Array(4096);

  // ── Pre-allocated zero-allocation scratch buffers for Newton algebraic loops ──
  /** Scratch vector for current algebraic iterate $x_k$. */
  private newtonScratchX = new Float64Array(32);
  /** Scratch vector for best finite algebraic iterate $x_{\text{best}}$. */
  private newtonScratchBestX = new Float64Array(32);
  /** Scratch vector for residual evaluation $r(x_k)$. */
  private newtonScratchR = new Float64Array(32);
  /** Scratch vector for negated residual $-r(x_k)$ (overwritten with Newton step $\Delta x$). */
  private newtonScratchNegR = new Float64Array(32);
  /** Scratch vector for Armijo line-search / Chord trial iterate $x_{\text{trial}}$. */
  private newtonScratchTrialX = new Float64Array(32);
  /** Scratch vector for Armijo line-search / Chord trial residual $r(x_{\text{trial}})$. */
  private newtonScratchTrialR = new Float64Array(32);
  /** Scratch array mapping block variable indices to interned string IDs. */
  private newtonScratchVarIds = new Int32Array(32);
  /** Scratch flat row-major buffer for the $m \times m$ block Jacobian matrix $J$. */
  private newtonScratchMat = new Float64Array(32 * 32);
  /** Scratch pivot index array for LU decomposition with partial pivoting. */
  private newtonScratchPiv = new Int32Array(32);
  /** Scratch row-scaling array for implicit equilibration in LU factorization. */
  private newtonScratchScale = new Float64Array(32);
  /** Scratch stack for forward-mode dual-number automatic differentiation (`[val, der]` pairs). */
  public readonly newtonScratchDualStack = new Float64Array(128);

  constructor(private readonly host: ArenaAlgebraicSolverHost) {}

  public resetWarmStart(): void {
    this.algWarmStartValid.fill(0);
  }

  public ensureWarmStartCapacity(minLen: number): void {
    if (this.algWarmStartVals.length < minLen) {
      let cap = this.algWarmStartVals.length * 2;
      if (cap < minLen) cap = minLen + 256;
      const nextVals = new Float64Array(cap);
      nextVals.set(this.algWarmStartVals);
      const nextValid = new Uint8Array(cap);
      nextValid.set(this.algWarmStartValid);
      this.algWarmStartVals = nextVals;
      this.algWarmStartValid = nextValid;
    }
  }

  public restoreWarmStart(vals: Float64Array, valid: Uint8Array): void {
    this.ensureWarmStartCapacity(vals.length);
    this.algWarmStartVals.fill(0);
    this.algWarmStartValid.fill(0);
    this.algWarmStartVals.set(vals);
    this.algWarmStartValid.set(valid);
  }

  /**
   * Ensures pre-allocated Newton-Raphson scratch buffers have capacity for an $m \times m$ algebraic block.
   *
   * @param m - Number of algebraic unknowns in the block.
   */
  public ensureNewtonCapacity(m: number): void {
    if (this.newtonScratchX.length < m) {
      const cap = Math.max(m, this.newtonScratchX.length * 2);
      this.newtonScratchX = new Float64Array(cap);
      this.newtonScratchBestX = new Float64Array(cap);
      this.newtonScratchR = new Float64Array(cap);
      this.newtonScratchNegR = new Float64Array(cap);
      this.newtonScratchTrialX = new Float64Array(cap);
      this.newtonScratchTrialR = new Float64Array(cap);
      this.newtonScratchVarIds = new Int32Array(cap);
      this.newtonScratchMat = new Float64Array(cap * cap);
      this.newtonScratchPiv = new Int32Array(cap);
      this.newtonScratchScale = new Float64Array(cap);
    }
  }

  /**
   * Attempts to solve an algebraic loop block using Kron/Cellier tearing.
   * Partitions the block into $k$ tearing variables iterated by Newton-Raphson,
   * an explicit forward assignment causal chain ($m-k$ variables), and $k$ residuals.
   * Employs compiled forward chain execution, Jacobian reuse (Chord Newton), and flat LU factorization.
   * Returns true if the torn solve succeeded, or false to fall back to untorn Newton.
   */
  public trySolveTornBlock(sysBlock: SystemExecutionBlock, valuesByStringId: Float64Array): boolean {
    if (sysBlock._tornPlan === null) {
      return false;
    }
    const arena = this.host.arena;
    const tearing = sysBlock.tearing;
    const m = sysBlock.vars.length;
    if (!tearing || m <= 2 || tearing.tearingVars.length === 0 || tearing.tearingVars.length >= m) {
      return false;
    }
    if (sysBlock._isJacInvariantBetweenEvents === true && tearing.tearingVars.length > 2) {
      return false;
    }
    if (sysBlock._compiledJacobian !== undefined && tearing.tearingVars.length * 4 > m * 3) {
      sysBlock._tornPlan = null;
      return false;
    }

    if (sysBlock._tornPlan === undefined) {
      let canTear = true;
      const causalPlan: Array<{
        eqIdx: number;
        solvedVarIdx: number;
        solvedVarNameId: number;
        isolatedExprId: number;
      }> = [];
      for (const step of tearing.causalChain) {
        const isoId = isolateSymbolicallyArena(arena, step.eqIdx, step.solvedVar);
        if (isoId < 0) {
          canTear = false;
          break;
        }
        causalPlan.push({
          eqIdx: step.eqIdx,
          solvedVarIdx: step.solvedVar,
          solvedVarNameId: arena.getVarNameId(step.solvedVar),
          isolatedExprId: isoId,
        });
      }
      if (!canTear) {
        sysBlock._tornPlan = null;
        return false;
      }
      const k = tearing.tearingVars.length;
      const tearVarNameIds = new Int32Array(k);
      const tearVarIndices = new Int32Array(k);
      for (let i = 0; i < k; i++) {
        tearVarIndices[i] = tearing.tearingVars[i]!;
        tearVarNameIds[i] = arena.getVarNameId(tearing.tearingVars[i]!);
      }
      const resExprIds = new Int32Array(k);
      for (let i = 0; i < k; i++) {
        const eqIdx = tearing.residualEqs[i]!;
        const lhs = arena.getEqLhs(eqIdx);
        const rhs = arena.getEqRhs(eqIdx);
        resExprIds[i] = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);
      }
      const plan: TornExecutionPlan = {
        k,
        tearingVarIndices: tearVarIndices,
        tearingVarNameIds: tearVarNameIds,
        residualExprIds: resExprIds,
        causalChain: causalPlan,
        fallbackCount: 0,
        scratchXTear: new Float64Array(k),
        scratchR: new Float64Array(k),
        scratchRPert: new Float64Array(k),
        scratchDeltaX: new Float64Array(k),
        scratchXTrial: new Float64Array(k),
        scratchBestXTear: new Float64Array(k),
        scratchOrigVals: new Float64Array(k + causalPlan.length),
      };
      compileArenaTornPlan(this.host, plan);
      if (!plan.compiledResiduals) {
        plan.compiledResiduals = (env: Float64Array, xT: Float64Array, R_out: Float64Array): number => {
          for (let i = 0; i < k; i++) {
            env[plan.tearingVarNameIds[i]!] = xT[i]!;
          }
          for (let c = 0; c < plan.causalChain.length; c++) {
            const step = plan.causalChain[c]!;
            const val = evaluateArenaRuntime(this.host.arena, step.isolatedExprId, env, this.host.preValuesByStringId);
            env[step.solvedVarNameId] = Number.isFinite(val) ? val : 0;
          }
          let maxR = 0;
          for (let j = 0; j < k; j++) {
            const r = evaluateArenaRuntime(
              this.host.arena,
              plan.residualExprIds[j]!,
              env,
              this.host.preValuesByStringId,
            );
            const ar = Math.abs(r);
            R_out[j] = Number.isFinite(r) ? r : 1e10;
            if (ar > maxR) maxR = ar;
          }
          return maxR;
        };
      }
      sysBlock._tornPlan = plan;
    }

    if (sysBlock._tornPlan === null) return false;

    this.ensureWarmStartCapacity(valuesByStringId.length);
    const wsVals = this.algWarmStartVals;
    const wsValid = this.algWarmStartValid;
    const discreteEventEpoch = this.host.getDiscreteEventEpoch();

    const plan = sysBlock._tornPlan;
    const k = plan.k;
    const xTear = plan.scratchXTear ?? (plan.scratchXTear = new Float64Array(k));
    const origVals = plan.scratchOrigVals ?? (plan.scratchOrigVals = new Float64Array(k + plan.causalChain.length));
    for (let i = 0; i < k; i++) {
      const nid = plan.tearingVarNameIds[i]!;
      const envVal = valuesByStringId[nid] ?? 0;
      origVals[i] = envVal;
      const v = wsValid[nid] === 1 ? wsVals[nid]! : envVal;
      xTear[i] = Number.isFinite(v) ? v : 0;
    }
    for (let c = 0; c < plan.causalChain.length; c++) {
      origVals[k + c] = valuesByStringId[plan.causalChain[c]!.solvedVarNameId] ?? 0;
    }

    const evalRes = plan.compiledResiduals!;
    const R = plan.scratchR ?? (plan.scratchR = new Float64Array(k));
    const R_pert = plan.scratchRPert ?? (plan.scratchRPert = new Float64Array(k));
    const deltaX = plan.scratchDeltaX ?? (plan.scratchDeltaX = new Float64Array(k));
    const xTrial = plan.scratchXTrial ?? (plan.scratchXTrial = new Float64Array(k));

    const tearTol = 1e-10;
    let currentMaxR = evalRes(valuesByStringId, xTear, R);
    if (currentMaxR < tearTol) {
      plan.fallbackCount = 0;
      for (let i = 0; i < k; i++) {
        const nid = plan.tearingVarNameIds[i]!;
        wsVals[nid] = xTear[i]!;
        wsValid[nid] = 1;
      }
      return true;
    }

    let bestMaxR = currentMaxR;
    const bestXTear = plan.scratchBestXTear ?? (plan.scratchBestXTear = new Float64Array(k));
    bestXTear.set(xTear);

    if (!plan.cachedPiv) plan.cachedPiv = new Int32Array(k);
    if (!plan.cachedScale) plan.cachedScale = new Float64Array(k);
    if (!plan.cachedJ) plan.cachedJ = new Float64Array(k * k);
    if (!plan.cachedFactJ) plan.cachedFactJ = new Float64Array(k * k);

    const piv = plan.cachedPiv;
    const scale = plan.cachedScale;
    const J = plan.cachedJ;
    const factJ = plan.cachedFactJ;

    let haveFact = plan.cachedFact !== undefined && plan.luEpoch === discreteEventEpoch;
    let chordSteps = 0;

    for (let iter = 0; iter < 25; iter++) {
      const prevMaxR = currentMaxR;
      let solvedStep = false;

      // ── Try full Chord Step (alpha = 1) if we have a valid factored Jacobian near the root ──
      if (haveFact && chordSteps < 4 && currentMaxR < 1e-2) {
        for (let i = 0; i < k; i++) deltaX[i] = -R[i]!;
        luSolveFlat(plan.cachedFact!, deltaX);
        let stepFinite = true;
        for (let i = 0; i < k; i++) {
          if (!Number.isFinite(deltaX[i]!)) {
            stepFinite = false;
            break;
          }
        }
        if (stepFinite) {
          for (let i = 0; i < k; i++) xTrial[i] = xTear[i]! + deltaX[i]!;
          const trialR = evalRes(valuesByStringId, xTrial, R_pert);
          if (trialR < currentMaxR * 0.5 || trialR < tearTol) {
            for (let i = 0; i < k; i++) {
              xTear[i] = xTrial[i]!;
              R[i] = R_pert[i]!;
            }
            currentMaxR = trialR;
            if (currentMaxR < bestMaxR) {
              bestMaxR = currentMaxR;
              bestXTear.set(xTear);
            }
            solvedStep = true;
            chordSteps++;
          }
        }
      }

      // If Chord step did not succeed, recompute Jacobian & factorize
      if (!solvedStep) {
        chordSteps = 0;
        if (k === 1) {
          const origX = xTear[0]!;
          const eps = SQRT_EPS * Math.max(1.0, Math.abs(origX));
          xTear[0] = origX + eps;
          evalRes(valuesByStringId, xTear, R_pert);
          let diag = (R_pert[0]! - R[0]!) / eps;
          if (Math.abs(diag) < 1e-14) {
            // Probe opposite direction in case origX + eps stepped into a min/max saturation plateau
            xTear[0] = origX - eps;
            evalRes(valuesByStringId, xTear, R_pert);
            diag = (R[0]! - R_pert[0]!) / eps;
          }
          xTear[0] = origX;
          if (Math.abs(diag) < 1e-14) break;
          deltaX[0] = -R[0]! / diag;
        } else if (k === 2) {
          for (let j = 0; j < 2; j++) {
            const origXj = xTear[j]!;
            const eps = SQRT_EPS * Math.max(1.0, Math.abs(origXj));
            xTear[j] = origXj + eps;
            evalRes(valuesByStringId, xTear, R_pert);
            const invEps = 1.0 / eps;
            let d0 = (R_pert[0]! - R[0]!) * invEps;
            let d1 = (R_pert[1]! - R[1]!) * invEps;
            if (Math.abs(d0) < 1e-14 && Math.abs(d1) < 1e-14) {
              xTear[j] = origXj - eps;
              evalRes(valuesByStringId, xTear, R_pert);
              d0 = (R[0]! - R_pert[0]!) * invEps;
              d1 = (R[1]! - R_pert[1]!) * invEps;
            }
            xTear[j] = origXj;
            J[0 * 2 + j] = d0;
            J[1 * 2 + j] = d1;
          }
          const j00 = J[0]!,
            j01 = J[1]!,
            j10 = J[2]!,
            j11 = J[3]!;
          const det = j00 * j11 - j01 * j10;
          if (Math.abs(det) < 1e-14) break;
          const invDet = 1.0 / det;
          deltaX[0] = (-R[0]! * j11 + R[1]! * j01) * invDet;
          deltaX[1] = (-R[1]! * j00 + R[0]! * j10) * invDet;
        } else {
          for (let j = 0; j < k; j++) {
            const origXj = xTear[j]!;
            const eps = SQRT_EPS * Math.max(1.0, Math.abs(origXj));
            xTear[j] = origXj + eps;
            evalRes(valuesByStringId, xTear, R_pert);
            const invEps = 1.0 / eps;
            let colMax = 0;
            for (let i = 0; i < k; i++) {
              const d = (R_pert[i]! - R[i]!) * invEps;
              J[i * k + j] = d;
              const ad = Math.abs(d);
              if (ad > colMax) colMax = ad;
            }
            if (colMax < 1e-14) {
              xTear[j] = origXj - eps;
              evalRes(valuesByStringId, xTear, R_pert);
              for (let i = 0; i < k; i++) {
                J[i * k + j] = (R[i]! - R_pert[i]!) * invEps;
              }
            }
            xTear[j] = origXj;
          }

          try {
            factJ.set(J);
            plan.cachedFact = luFactorFlat(factJ, k, piv, scale);
            plan.luEpoch = discreteEventEpoch;
            haveFact = true;
            for (let i = 0; i < k; i++) deltaX[i] = -R[i]!;
            luSolveFlat(plan.cachedFact, deltaX);
            let stepFinite = true;
            for (let i = 0; i < k; i++) {
              if (!Number.isFinite(deltaX[i]!)) {
                stepFinite = false;
                break;
              }
            }
            if (!stepFinite) break;
          } catch {
            plan.cachedFact = undefined;
            haveFact = false;
            break;
          }
        }

        let stepAccepted = false;
        for (let aIdx = 0; aIdx < TORN_LINE_ALPHAS.length; aIdx++) {
          const alpha = TORN_LINE_ALPHAS[aIdx]!;
          for (let i = 0; i < k; i++) xTrial[i] = xTear[i]! + alpha * deltaX[i]!;
          const trialR = evalRes(valuesByStringId, xTrial, R_pert);
          if (trialR < currentMaxR) {
            for (let i = 0; i < k; i++) {
              xTear[i] = xTrial[i]!;
              R[i] = R_pert[i]!;
            }
            currentMaxR = trialR;
            if (currentMaxR < bestMaxR) {
              bestMaxR = currentMaxR;
              bestXTear.set(xTear);
            }
            stepAccepted = true;
            break;
          }
        }

        if (!stepAccepted) {
          for (let i = 0; i < k; i++) xTear[i] = xTear[i]! + deltaX[i]!;
          currentMaxR = evalRes(valuesByStringId, xTear, R);
          if (currentMaxR < bestMaxR) {
            bestMaxR = currentMaxR;
            bestXTear.set(xTear);
          }
        }
      }

      if (currentMaxR < tearTol) {
        plan.fallbackCount = 0;
        for (let i = 0; i < k; i++) {
          const nid = plan.tearingVarNameIds[i]!;
          wsVals[nid] = xTear[i]!;
          wsValid[nid] = 1;
        }
        return true;
      }

      // Stagnation check on non-smooth / finite-difference-limited blocks: bail out to analytical Newton
      if (iter >= 12 && currentMaxR >= prevMaxR * 0.99) {
        break;
      }
    }

    if (bestMaxR < 1e-8) {
      plan.fallbackCount = 0;
      evalRes(valuesByStringId, bestXTear, R);
      for (let i = 0; i < k; i++) {
        const nid = plan.tearingVarNameIds[i]!;
        wsVals[nid] = bestXTear[i]!;
        wsValid[nid] = 1;
      }
      return true;
    }

    // Restore pre-tear environment values and disable torn plan only if it fails 8 times consecutively
    for (let i = 0; i < k; i++) {
      valuesByStringId[plan.tearingVarNameIds[i]!] = origVals[i]!;
    }
    for (let c = 0; c < plan.causalChain.length; c++) {
      valuesByStringId[plan.causalChain[c]!.solvedVarNameId] = origVals[k + c]!;
    }
    const fbCount = (plan.fallbackCount ?? 0) + 1;
    plan.fallbackCount = fbCount;
    if (fbCount >= 8) {
      sysBlock._tornPlan = null;
    }
    return false;
  }

  /**
   * Solves a simultaneous algebraic loop (`type: "system"`) using damped Newton-Raphson
   * with pre-allocated scratch buffers, forward-mode AD / JIT-compiled Jacobians,
   * epoch-cached flat LU factorization (`luFactorFlat`), Chord-Newton reuse, and warm-starting.
   */
  public solveNewtonBlock(
    block: Extract<ArenaExecutionBlock, { type: "system" }>,
    valuesByStringId: Float64Array,
  ): void {
    const m = block.vars.length;
    if (m === 0) return;

    const arena = this.host.arena;
    const sysBlock = block as SystemExecutionBlock & { _linearSccPlan?: LinearSccPlan | null };
    if (this.trySolveTornBlock(sysBlock, valuesByStringId)) {
      return;
    }
    if (m <= 16) {
      if (sysBlock._linearSccPlan === undefined) {
        const plan = analyzeLinearSccBlock(arena, block.eqIdxs as number[], block.vars as number[]);
        sysBlock._linearSccPlan = plan.isLinear ? plan : null;
      }
      if (
        sysBlock._linearSccPlan &&
        solveLinearSccBlockDirect(arena, sysBlock._linearSccPlan, valuesByStringId).solved
      ) {
        return;
      }
    }

    this.ensureNewtonCapacity(m);
    this.ensureWarmStartCapacity(valuesByStringId.length);
    const wsVals = this.algWarmStartVals;
    const wsValid = this.algWarmStartValid;
    const discreteEventEpoch = this.host.getDiscreteEventEpoch();

    const x = this.newtonScratchX;
    const bestX = this.newtonScratchBestX;
    const R = this.newtonScratchR;
    const negR = this.newtonScratchNegR;
    const trialX = this.newtonScratchTrialX;
    const trialR = this.newtonScratchTrialR;
    const varNameIds = this.newtonScratchVarIds;
    const J = this.newtonScratchMat;
    const piv = this.newtonScratchPiv;
    const scale = this.newtonScratchScale;
    const dualStack = this.newtonScratchDualStack;

    let cachedVarIds: Int32Array | undefined = sysBlock._varNameIds;
    let cachedResIds: Int32Array | undefined = sysBlock._resExprIds;
    if (!cachedVarIds || !cachedResIds) {
      cachedVarIds = new Int32Array(m);
      cachedResIds = new Int32Array(m);
      for (let i = 0; i < m; i++) {
        cachedVarIds[i] = arena.getVarNameId(block.vars[i] as number);
        const eqIdx = block.eqIdxs[i] as number;
        const lhsId = arena.getEqLhs(eqIdx);
        const rhsId = arena.getEqRhs(eqIdx);
        cachedResIds[i] = arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
      }
      sysBlock._varNameIds = cachedVarIds;
      sysBlock._resExprIds = cachedResIds;
    }

    let cachedIsBoolVar: Uint8Array | undefined = sysBlock._isBoolVar;
    let cachedIsBoolEq: Uint8Array | undefined = sysBlock._isBoolEq;
    let hasBoolVars: boolean | undefined = sysBlock._hasBoolVars;
    if (!cachedIsBoolVar || !cachedIsBoolEq || hasBoolVars === undefined) {
      cachedIsBoolVar = new Uint8Array(m);
      cachedIsBoolEq = new Uint8Array(m);
      hasBoolVars = false;
      const boolNameIds = new Set<number>();
      for (let i = 0; i < m; i++) {
        if (arena.getVarType(block.vars[i] as number) === VarType.Boolean) {
          cachedIsBoolVar[i] = 1;
          hasBoolVars = true;
          boolNameIds.add(cachedVarIds[i] as number);
        }
      }
      if (hasBoolVars) {
        for (let i = 0; i < m; i++) {
          const eqIdx = block.eqIdxs[i] as number;
          const lhsId = arena.getEqLhs(eqIdx);
          const rhsId = arena.getEqRhs(eqIdx);
          const lhsIsBool = arena.getExprKind(lhsId) === ExprKind.Name && boolNameIds.has(arena.getExprData1(lhsId));
          const rhsIsBool = arena.getExprKind(rhsId) === ExprKind.Name && boolNameIds.has(arena.getExprData1(rhsId));
          if (lhsIsBool || rhsIsBool) {
            cachedIsBoolEq[i] = 1;
          }
        }
      }
      sysBlock._isBoolVar = cachedIsBoolVar;
      sysBlock._isBoolEq = cachedIsBoolEq;
      sysBlock._hasBoolVars = hasBoolVars;
    }

    // Collect variable name StringIds & warm-start iterate
    for (let i = 0; i < m; i++) {
      const nid = cachedVarIds[i] as number;
      varNameIds[i] = nid;
      const initVal = wsValid[nid] === 1 ? wsVals[nid]! : (valuesByStringId[nid] ?? 0);
      x[i] = Number.isFinite(initVal) ? initVal : 0;
    }

    const compiledRes = sysBlock._compiledResiduals;
    const compiledJac = sysBlock._compiledJacobian;
    const isLinearSystem = sysBlock._isLinearSystem === true && !hasBoolVars;

    const evalBlockResiduals = (xVec: Float64Array, RVec: Float64Array): number => {
      for (let i = 0; i < m; i++) valuesByStringId[varNameIds[i] as number] = xVec[i] as number;
      if (compiledRes) {
        return compiledRes(valuesByStringId, xVec, RVec);
      }
      let mr = 0;
      for (let i = 0; i < m; i++) {
        const resId = cachedResIds![i] as number;
        const exprVal = evaluateArenaRuntime(arena, resId, valuesByStringId, this.host.preValuesByStringId);
        if (Number.isFinite(exprVal)) {
          RVec[i] = exprVal;
          const absR = Math.abs(exprVal);
          if (absR > mr) mr = absR;
        } else {
          RVec[i] = 1e10;
          mr = Infinity;
        }
      }
      return mr;
    };

    // Fast path for affine linear blocks whose Jacobian is invariant between discrete events:
    // Reuse pre-factored LU in O(m^2) without recomputing J or running O(m^3) LU decomposition.
    if (
      isLinearSystem &&
      sysBlock._isJacInvariantBetweenEvents === true &&
      sysBlock._cachedLuFact !== undefined &&
      sysBlock._luEpoch === discreteEventEpoch
    ) {
      const initMaxR = evalBlockResiduals(x, R);
      if (initMaxR < NEWTON_TOL) {
        for (let i = 0; i < m; i++) {
          const nid = varNameIds[i] as number;
          wsVals[nid] = x[i] as number;
          wsValid[nid] = 1;
        }
        return;
      }
      if (Number.isFinite(initMaxR)) {
        for (let i = 0; i < m; i++) negR[i] = -(R[i] as number);
        luSolveFlat(sysBlock._cachedLuFact, negR);
        let stepFinite = true;
        for (let i = 0; i < m; i++) {
          if (!Number.isFinite(negR[i] as number)) {
            stepFinite = false;
            break;
          }
        }
        if (stepFinite) {
          for (let i = 0; i < m; i++) {
            const nid = varNameIds[i] as number;
            const nx = (x[i] as number) + (negR[i] as number);
            valuesByStringId[nid] = nx;
            wsVals[nid] = nx;
            wsValid[nid] = 1;
          }
          return;
        }
      }
    }

    for (let i = 0; i < m; i++) bestX[i] = x[i]!;
    let bestMaxR = Infinity;
    let bestBoolConsistent = false;

    let converged = false;
    let haveResidual = false;
    let maxR = 0;
    let chordSteps = 0;
    const chordSkip = sysBlock._chordSkipRemaining ?? 0;
    if (chordSkip > 0) {
      sysBlock._chordSkipRemaining = chordSkip - 1;
    }

    for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
      if (!haveResidual) {
        maxR = evalBlockResiduals(x, R);
      } else {
        for (let i = 0; i < m; i++) valuesByStringId[varNameIds[i] as number] = x[i] as number;
        haveResidual = false;
      }

      let maxContR = maxR;
      let maxBoolR = 0;
      if (hasBoolVars) {
        maxContR = 0;
        for (let i = 0; i < m; i++) {
          const absR = Math.abs(R[i] as number);
          if (cachedIsBoolEq[i] === 1) {
            if (absR > maxBoolR) maxBoolR = absR;
          } else {
            if (absR > maxContR) maxContR = absR;
          }
        }
      }

      const boolConsistent = !hasBoolVars || maxBoolR < 0.5;
      if (
        Number.isFinite(maxR) &&
        ((boolConsistent && !bestBoolConsistent) || (boolConsistent === bestBoolConsistent && maxR < bestMaxR))
      ) {
        bestMaxR = maxR;
        bestBoolConsistent = boolConsistent;
        for (let i = 0; i < m; i++) bestX[i] = x[i] as number;
      }

      const isSystemConverged = hasBoolVars ? maxContR < NEWTON_TOL && maxBoolR < 0.5 : maxR < NEWTON_TOL;
      if (isSystemConverged) {
        converged = true;
        break;
      }

      if (!Number.isFinite(maxR)) {
        for (let i = 0; i < m; i++) {
          x[i] = bestX[i]!;
          valuesByStringId[varNameIds[i] as number] = bestX[i]!;
        }
        break;
      }

      // Chord-Newton reuse for smooth nonlinear blocks (O(m^2) triangular solve)
      if (
        !hasBoolVars &&
        !isLinearSystem &&
        (chordSteps > 0 || chordSkip === 0) &&
        chordSteps < 3 &&
        maxR < 1e-2 &&
        sysBlock._cachedLuFact !== undefined &&
        sysBlock._luEpoch === discreteEventEpoch
      ) {
        for (let i = 0; i < m; i++) negR[i] = -(R[i] as number);
        luSolveFlat(sysBlock._cachedLuFact, negR);
        let chordFinite = true;
        for (let i = 0; i < m; i++) {
          if (!Number.isFinite(negR[i] as number)) {
            chordFinite = false;
            break;
          }
        }
        if (chordFinite) {
          for (let i = 0; i < m; i++) trialX[i] = (x[i] as number) + (negR[i] as number);
          const trialMaxR = evalBlockResiduals(trialX, trialR);
          if (trialMaxR < NEWTON_TOL) {
            for (let i = 0; i < m; i++) {
              x[i] = trialX[i]!;
              bestX[i] = trialX[i]!;
            }
            if (chordSteps === 0) sysBlock._chordFailStreak = 0;
            converged = true;
            break;
          }
          if (trialMaxR < 0.25 * maxR) {
            for (let i = 0; i < m; i++) {
              x[i] = trialX[i]!;
              R[i] = trialR[i]!;
            }
            if (trialMaxR < bestMaxR) {
              bestMaxR = trialMaxR;
              for (let i = 0; i < m; i++) bestX[i] = trialX[i]!;
            }
            maxR = trialMaxR;
            haveResidual = true;
            if (chordSteps === 0) sysBlock._chordFailStreak = 0;
            chordSteps++;
            continue;
          }
        }
        if (chordSteps === 0) {
          const streak = (sysBlock._chordFailStreak ?? 0) + 1;
          if (streak >= 2) {
            sysBlock._chordSkipRemaining = 12;
            sysBlock._chordFailStreak = 0;
          } else {
            sysBlock._chordFailStreak = streak;
          }
        }
        for (let i = 0; i < m; i++) valuesByStringId[varNameIds[i] as number] = x[i] as number;
      }

      chordSteps = 0;

      // Compute Jacobian
      if (compiledJac) {
        compiledJac(valuesByStringId, x, R, J);
      } else {
        for (let j = 0; j < m; j++) {
          const nid = varNameIds[j] as number;

          for (let i = 0; i < m; i++) {
            const resId = cachedResIds[i] as number;
            const ok = evaluateArenaDualFlat(arena, resId, valuesByStringId, nid, dualStack, 0);
            if (ok && Number.isFinite(dualStack[1] as number)) {
              J[i * m + j] = dualStack[1] as number;
            } else {
              const xj = x[j] as number;
              const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
              valuesByStringId[nid] = xj + eps;
              const perturbedVal = evaluateArenaRuntime(arena, resId, valuesByStringId, this.host.preValuesByStringId);
              const R_perturbed = Number.isFinite(perturbedVal) ? perturbedVal : (R[i] as number);
              J[i * m + j] = (R_perturbed - (R[i] as number)) / eps;
              valuesByStringId[nid] = xj;
            }
          }
        }
      }

      // Solve J · Δx = -R via closed-form 1x1 / 2x2 or flat LU factorization
      try {
        if (m === 1 && !hasBoolVars && sysBlock._isJacInvariantBetweenEvents !== true) {
          const d0 = J[0] as number;
          if (!Number.isFinite(d0) || Math.abs(d0) < 1e-15) throw new Error("Singular 1x1");
          negR[0] = -(R[0] as number) / d0;
        } else if (m === 2 && !hasBoolVars && sysBlock._isJacInvariantBetweenEvents !== true) {
          const j00 = J[0] as number,
            j01 = J[1] as number,
            j10 = J[2] as number,
            j11 = J[3] as number;
          const det = j00 * j11 - j01 * j10;
          if (!Number.isFinite(det) || Math.abs(det) < 1e-15) throw new Error("Singular 2x2");
          const invDet = 1.0 / det;
          const r0 = R[0] as number,
            r1 = R[1] as number;
          negR[0] = (-r0 * j11 + r1 * j01) * invDet;
          negR[1] = (-r1 * j00 + r0 * j10) * invDet;
        } else {
          let fact: LUFactorizationFlat;
          if (!hasBoolVars) {
            if (!sysBlock._cachedFactJ || sysBlock._cachedFactJ.length !== m * m) {
              sysBlock._cachedFactJ = new Float64Array(m * m);
              sysBlock._cachedPiv = new Int32Array(m);
              sysBlock._cachedScale = new Float64Array(m);
            }
            const factJ = sysBlock._cachedFactJ;
            for (let k = 0; k < m * m; k++) factJ[k] = J[k] as number;
            fact = luFactorFlat(factJ, m, sysBlock._cachedPiv!, sysBlock._cachedScale!);
            sysBlock._cachedLuFact = fact;
            sysBlock._luEpoch = discreteEventEpoch;
          } else {
            fact = luFactorFlat(J, m, piv, scale);
          }

          for (let i = 0; i < m; i++) negR[i] = -(R[i] as number);
          luSolveFlat(fact, negR);
        }
        let stepFinite = true;
        for (let i = 0; i < m; i++) {
          if (!Number.isFinite(negR[i] as number)) {
            stepFinite = false;
            break;
          }
        }
        if (!stepFinite) {
          for (let i = 0; i < m; i++) {
            x[i] = bestX[i]!;
            valuesByStringId[varNameIds[i] as number] = bestX[i]!;
          }
          break;
        }
        if (hasBoolVars) {
          if (maxContR > NEWTON_TOL) {
            for (let i = 0; i < m; i++) {
              if (cachedIsBoolVar[i] === 0) {
                let nx = (x[i] as number) + (negR[i] as number);
                if (Math.abs(nx) < 1e-13) nx = 0;
                x[i] = nx;
                valuesByStringId[varNameIds[i] as number] = nx;
              }
            }
          } else {
            let anyBoolChanged = false;
            for (let i = 0; i < m; i++) {
              if (cachedIsBoolVar[i] === 1) {
                const raw = (x[i] as number) + (negR[i] as number);
                const nx = Math.abs(raw) >= 0.5 ? 1 : 0;
                if (nx !== (x[i] as number)) {
                  anyBoolChanged = true;
                  x[i] = nx;
                  valuesByStringId[varNameIds[i] as number] = nx;
                }
              }
            }
            if (!anyBoolChanged && maxContR < NEWTON_TOL) {
              converged = true;
              for (let i = 0; i < m; i++) bestX[i] = x[i] as number;
              break;
            }
          }
        } else if (isLinearSystem) {
          for (let i = 0; i < m; i++) {
            const nx = (x[i] as number) + (negR[i] as number);
            x[i] = nx;
            bestX[i] = nx;
            valuesByStringId[varNameIds[i] as number] = nx;
          }
          converged = true;
          break;
        } else {
          // Armijo backtracking line search (reuses trialR on next iter so alpha=1 costs 0 extra evals)
          let accepted = false;
          let fullStepFinite = false;
          for (let alpha = 1.0; alpha >= 0.125; alpha *= 0.5) {
            for (let i = 0; i < m; i++) {
              trialX[i] = (x[i] as number) + alpha * (negR[i] as number);
            }
            const trialMaxR = evalBlockResiduals(trialX, trialR);
            if (alpha === 1.0 && Number.isFinite(trialMaxR)) {
              fullStepFinite = true;
            }
            if (trialMaxR < NEWTON_TOL) {
              for (let i = 0; i < m; i++) {
                x[i] = trialX[i]!;
                bestX[i] = trialX[i]!;
              }
              converged = true;
              accepted = true;
              break;
            }
            if (trialMaxR < (1 - 1e-4 * alpha) * maxR) {
              for (let i = 0; i < m; i++) {
                x[i] = trialX[i]!;
                R[i] = trialR[i]!;
              }
              if (trialMaxR < bestMaxR) {
                bestMaxR = trialMaxR;
                for (let i = 0; i < m; i++) bestX[i] = trialX[i]!;
              }
              maxR = trialMaxR;
              haveResidual = true;
              accepted = true;
              break;
            }
          }
          if (converged) break;
          if (!accepted) {
            if (fullStepFinite) {
              for (let i = 0; i < m; i++) {
                const nx = (x[i] as number) + (negR[i] as number);
                x[i] = nx;
                valuesByStringId[varNameIds[i] as number] = nx;
              }
            } else {
              for (let i = 0; i < m; i++) {
                x[i] = bestX[i]!;
                valuesByStringId[varNameIds[i] as number] = bestX[i]!;
              }
              break;
            }
          }
        }
      } catch {
        sysBlock._cachedLuFact = undefined;
        // Singular Jacobian — restore best finite iterate
        for (let i = 0; i < m; i++) {
          x[i] = bestX[i]!;
          valuesByStringId[varNameIds[i] as number] = bestX[i]!;
        }
        break;
      }
    }

    if (!converged) {
      for (let i = 0; i < m; i++) {
        x[i] = bestX[i]!;
      }
      if (this.host.isInAdaptiveTrialStage() && bestMaxR > 1e-2) {
        this.host.markAlgebraicDivergedInTrialStage();
      }
    }

    // Write converged/best finite values and update warm-start cache
    for (let i = 0; i < m; i++) {
      const nid = varNameIds[i] as number;
      const finalVal = Number.isFinite(x[i] as number) ? (x[i] as number) : (bestX[i] ?? 0);
      valuesByStringId[nid] = finalVal;
      wsVals[nid] = finalVal;
      wsValid[nid] = 1;
    }
  }

  /**
   * Propagates forward-mode dual sensitivities through a coupled algebraic system block
   * $F(z, y(s), s) = \text{lhs} - \text{rhs} = 0$ via the Implicit Function Theorem:
   * $$J_{\text{alg}} \dot{z} = -\left.\frac{\partial F}{\partial s}\right|_{\dot{z}=0}$$
   */
  public propagateSystemBlockDual(
    block: Extract<ArenaExecutionBlock, { type: "system" }>,
    valuesByStringId: Float64Array,
    dualEnv: Dual[],
  ): void {
    const m = block.vars.length;
    if (m === 0) return;

    const arena = this.host.arena;
    this.ensureNewtonCapacity(m);

    const J = this.newtonScratchMat;
    const rhsVec = this.newtonScratchNegR;
    const piv = this.newtonScratchPiv;
    const scale = this.newtonScratchScale;
    const dualStack = this.newtonScratchDualStack;

    const sysBlock = block as SystemExecutionBlock;
    let cachedVarIds: Int32Array | undefined = sysBlock._varNameIds;
    let cachedResIds: Int32Array | undefined = sysBlock._resExprIds;
    if (!cachedVarIds || !cachedResIds) {
      cachedVarIds = new Int32Array(m);
      cachedResIds = new Int32Array(m);
      for (let i = 0; i < m; i++) {
        cachedVarIds[i] = arena.getVarNameId(block.vars[i] as number);
        const eqIdx = block.eqIdxs[i] as number;
        const lhsId = arena.getEqLhs(eqIdx);
        const rhsId = arena.getEqRhs(eqIdx);
        cachedResIds[i] = arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
      }
      sysBlock._varNameIds = cachedVarIds;
      sysBlock._resExprIds = cachedResIds;
    }

    // 1. Freeze block unknown dual derivatives to 0 to evaluate partial derivative wrt upstream variables/seed
    for (let j = 0; j < m; j++) {
      const nid = cachedVarIds[j] as number;
      dualEnv[nid] = Dual.constant(valuesByStringId[nid] ?? 0);
    }

    for (let i = 0; i < m; i++) {
      const resId = cachedResIds[i] as number;
      const resDual = evaluateArenaDualExpression(arena, resId, dualEnv);
      rhsVec[i] = -(resDual ? resDual.dot : 0);
    }

    // 2. Assemble block Jacobian J[i, j] = d(lhs_i - rhs_i) / d(z_j)
    for (let j = 0; j < m; j++) {
      const nid = cachedVarIds[j] as number;
      const xj = valuesByStringId[nid] ?? 0;
      for (let i = 0; i < m; i++) {
        const resId = cachedResIds[i] as number;
        const ok = evaluateArenaDualFlat(arena, resId, valuesByStringId, nid, dualStack, 0);
        if (ok) {
          J[i * m + j] = dualStack[1] as number;
        } else {
          const baseVal = evaluateArenaRuntime(arena, resId, valuesByStringId);
          const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
          valuesByStringId[nid] = xj + eps;
          const pertVal = evaluateArenaRuntime(arena, resId, valuesByStringId);
          valuesByStringId[nid] = xj;
          J[i * m + j] = ((isFinite(pertVal) ? pertVal : 0) - (isFinite(baseVal) ? baseVal : 0)) / eps;
        }
      }
    }

    // 3. Solve J * z_dot = -dF/ds
    try {
      const fact = luFactorFlat(J, m, piv, scale);
      luSolveFlat(fact, rhsVec);
      for (let j = 0; j < m; j++) {
        const nid = cachedVarIds[j] as number;
        const dotVal = rhsVec[j] as number;
        dualEnv[nid] = new Dual(valuesByStringId[nid] ?? 0, isFinite(dotVal) ? dotVal : 0);
      }
    } catch {
      // Fallback if block Jacobian is singular: fixed-point dual propagation on RHS
      for (let iter = 0; iter < 5; iter++) {
        for (let i = 0; i < m; i++) {
          const varIdx = block.vars[i]!;
          const eqIdx = block.eqIdxs[i]!;
          const rhsId = arena.getEqRhs(eqIdx);
          const val = evaluateArenaDualExpression(arena, rhsId, dualEnv);
          if (val !== null) {
            const varNameId = arena.getVarNameId(varIdx);
            dualEnv[varNameId] = val;
          }
        }
      }
    }
  }
}
