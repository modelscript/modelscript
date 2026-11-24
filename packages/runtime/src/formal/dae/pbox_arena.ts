// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Direct DAEBuilder Arena → Rigorous P-Box Flowpipe Bridge.
 *
 * Compiles a flattened DAEBuilder arena via {@link compileArenaToDae} (using outward-rounded
 * interval expression evaluation) and propagates parameter and initial-state P-boxes through
 * validated Picard–Lindelöf interval flowpipes, producing time-varying state P-boxes and
 * mathematically sound all-time {@link ProbabilisticVerdict}s.
 */

import { RigorousKrawczyk, hasValidatedHooks } from "../../analysis/dae_flowpipe.js";
import { Interval } from "../../analysis/wasm_interval.js";
import {
  PBox,
  propagatePBoxFlowpipe,
  type FocalElement,
  type PBoxComparisonOp,
  type PBoxFlowpipeRequirement,
} from "../../analysis/wasm_pbox.js";
import type { DAEBuilder } from "../../dae/wasm_dae.js";
import { probabilisticVerdictFromBounds, type ProbabilisticVerdict, type VerdictRigor } from "../verdict.js";
import { compileArenaToDae } from "./arena_dae_compiler.js";

export interface PBoxArenaRequirement {
  /** Target differential state name. */
  state: string;
  /** Unsafe event comparison: `state operator threshold`. */
  operator: PBoxComparisonOp;
  threshold: number;
  maxAllowedProbability: number;
}

export interface PBoxArenaOptions {
  /** Uncertain parameter P-boxes keyed by parameter name. */
  parameterPBoxes?: Map<string, PBox> | undefined;
  /** Uncertain initial-state P-boxes keyed by state name (defaults to point mass at start value). */
  initialStatePBoxes?: Map<string, PBox> | undefined;
  /** Integration time span [t0, tEnd]. */
  tSpan: [number, number];
  /** Integration step size dt. */
  dt: number;
  /** All-time probabilistic safety requirements over [t0, tEnd]. */
  requirements?: PBoxArenaRequirement[] | undefined;
  /** Maximum focal elements retained per output P-box (default: 64). */
  maxBins?: number | undefined;
  /** Maximum Picard enclosure iterations per step (default: 12). */
  maxPicardIter?: number | undefined;
}

export interface PBoxArenaResult {
  ok: true;
  times: number[];
  stateNames: string[];
  /** Time-varying P-box trajectories keyed by state name. */
  statePBoxes: Map<string, PBox[]>;
  /** Final-time P-boxes keyed by state name. */
  finalPBoxes: Map<string, PBox>;
  /** All-time probabilistic safety verdicts over [t0, tEnd]. */
  verdicts: Map<string, ProbabilisticVerdict>;
  numFocalTrajectories: number;
  allPicardValidated: boolean;
  rigor: VerdictRigor;
}

export type PBoxArenaOutcome = PBoxArenaResult | { ok: false; reason: string };

/**
 * Propagates parameter and initial-state P-boxes directly through a flattened
 * `DAEBuilder` ODE arena using outward-rounded Picard–Lindelöf interval flowpipes.
 */
export function propagatePBoxArena(arena: DAEBuilder, options: PBoxArenaOptions): PBoxArenaOutcome {
  const compiledRes = compileArenaToDae(arena, { isolateImplicitDer: true });
  if (!compiledRes.ok) {
    return { ok: false, reason: compiledRes.reason };
  }

  const { compiled } = compiledRes;
  const hasAlg = compiled.dae.numAlgStates > 0;
  if (hasAlg && !hasValidatedHooks(compiled.dae)) {
    return {
      ok: false,
      reason: "Compiled index-1 DAE lacks validated interval hooks (fInterval, gInterval, jacobianGzInterval).",
    };
  }
  if (!compiled.dae.fInterval) {
    return { ok: false, reason: "Compiled DAE lacks outward-rounded fInterval extension." };
  }

  const fInterval = compiled.dae.fInterval;
  const stateNames = compiled.stateNames;
  const algNames = compiled.algebraicNames;
  const nS = stateNames.length;
  const maxBins = options.maxBins ?? 64;
  const requirements = options.requirements ?? [];

  // Build initial algebraic guess intervals from arena start values (used to seed RigorousKrawczyk)
  const initialAlgGuess: Interval[] = algNames.map((name) => {
    const varIdx = arena.getVarIdxByName(name);
    const startVal = varIdx >= 0 ? arena.getVarStartValue(varIdx) : 0;
    const v = Number.isFinite(startVal) ? startVal : 0;
    return new Interval(v - 1e-3, v + 1e-3);
  });

  // Build initial-state P-boxes (override or point mass from arena start value)
  const initialPBoxes: PBox[] = stateNames.map((name) => {
    const override = options.initialStatePBoxes?.get(name);
    if (override) return override;
    const varIdx = arena.getVarIdxByName(name);
    const startVal = varIdx >= 0 ? arena.getVarStartValue(varIdx) : 0;
    return PBox.fromPoint(Number.isFinite(startVal) ? startVal : 0);
  });

  // Map named requirements to state indices
  const indexedReqs: PBoxFlowpipeRequirement[] = [];
  const reqKeys: string[] = [];
  for (const req of requirements) {
    const idx = stateNames.indexOf(req.state);
    if (idx < 0) continue;
    indexedReqs.push({
      stateIndex: idx,
      operator: req.operator,
      threshold: req.threshold,
      maxAllowedProbability: req.maxAllowedProbability,
    });
    reqKeys.push(`${req.state} ${req.operator} ${req.threshold} <= ${req.maxAllowedProbability}`);
  }

  const paramEntries = options.parameterPBoxes ? Array.from(options.parameterPBoxes.entries()) : [];
  const numParams = paramEntries.length;

  // Save original fixed bounds to restore after sweep
  const savedFixed = new Map<string, Interval>();
  for (const [name] of paramEntries) {
    const orig = compiled.fixedBounds.get(name);
    if (orig) savedFixed.set(name, orig);
  }

  let times: number[] = [];
  let aggregatedStepFocals: FocalElement[][][] | null = null;
  const totalReqPMin = new Array<number>(indexedReqs.length).fill(0);
  const totalReqPMax = new Array<number>(indexedReqs.length).fill(0);
  let totalTrajectories = 0;
  let allPicardValidated = true;
  let allAlgebraicCertified = true;

  const runForCurrentParams = (paramMass: number): void => {
    let zGuess = initialAlgGuess.map((iv) => new Interval(iv.lo, iv.hi));
    const validatedDae = hasAlg && hasValidatedHooks(compiled.dae) ? compiled.dae : null;

    const wrappedFInterval = (t: Interval, x: Interval[]): Interval[] => {
      if (!validatedDae) {
        return fInterval(t, x, []);
      }
      const zEnc = RigorousKrawczyk.enclose(validatedDae, x, zGuess);
      if (!zEnc) {
        allAlgebraicCertified = false;
        return Array.from({ length: nS }, () => new Interval(-Infinity, Infinity));
      }
      zGuess = zEnc;
      return validatedDae.fInterval(t, x, zEnc);
    };

    const fp = propagatePBoxFlowpipe({
      fInterval: wrappedFInterval,
      initialPBoxes,
      tSpan: options.tSpan,
      dt: options.dt,
      requirements: indexedReqs,
      maxBins,
      maxPicardIter: options.maxPicardIter,
    });

    totalTrajectories += fp.numFocalTrajectories;
    if (!fp.allPicardValidated) allPicardValidated = false;

    if (!aggregatedStepFocals) {
      times = fp.times;
      aggregatedStepFocals = Array.from({ length: fp.times.length }, () => Array.from({ length: nS }, () => []));
    }

    for (let ti = 0; ti < fp.times.length; ti++) {
      for (let si = 0; si < nS; si++) {
        const pb = fp.statePBoxes[ti]![si]!;
        const target = aggregatedStepFocals[ti]![si]!;
        for (const f of pb.focals) {
          target.push({ lo: f.lo, hi: f.hi, mass: f.mass * paramMass });
        }
      }
    }

    for (let r = 0; r < indexedReqs.length; r++) {
      const v = fp.verdicts[r]!;
      const bounds = v.probabilityBounds ?? [0, 1];
      totalReqPMin[r]! += bounds[0] * paramMass;
      totalReqPMax[r]! += bounds[1] * paramMass;
    }
  };

  try {
    if (numParams === 0) {
      runForCurrentParams(1.0);
    } else {
      const recurseParams = (axis: number, massAcc: number): void => {
        if (axis === numParams) {
          runForCurrentParams(massAcc);
          return;
        }
        const [pName, pBox] = paramEntries[axis]!;
        for (const f of pBox.focals) {
          compiled.setFixedBound?.(pName, new Interval(f.lo, f.hi));
          recurseParams(axis + 1, massAcc * f.mass);
        }
      };
      recurseParams(0, 1.0);
    }
  } finally {
    for (const [name, orig] of savedFixed) {
      compiled.setFixedBound?.(name, orig);
    }
  }

  const rigor: VerdictRigor = allPicardValidated && allAlgebraicCertified ? "rigorous" : "heuristic";
  const statePBoxes = new Map<string, PBox[]>();
  const finalPBoxes = new Map<string, PBox>();

  for (let si = 0; si < nS; si++) {
    const name = stateNames[si]!;
    const series = (aggregatedStepFocals ?? []).map((stepArr) => new PBox(stepArr[si]!).condense(maxBins));
    statePBoxes.set(name, series);
    if (series.length > 0) {
      finalPBoxes.set(name, series[series.length - 1]!);
    }
  }

  const verdicts = new Map<string, ProbabilisticVerdict>();
  for (let r = 0; r < indexedReqs.length; r++) {
    const key = reqKeys[r]!;
    const req = indexedReqs[r]!;
    const bounds: [number, number] = [
      Math.max(0, Math.min(1, totalReqPMin[r]!)),
      Math.max(0, Math.min(1, totalReqPMax[r]!)),
    ];
    verdicts.set(
      key,
      probabilisticVerdictFromBounds(
        bounds,
        req.maxAllowedProbability,
        rigor,
        `All-time arena P-box flowpipe over [${options.tSpan[0]}, ${options.tSpan[1]}]: P in [${bounds[0].toFixed(6)}, ${bounds[1].toFixed(6)}]`,
      ),
    );
  }

  return {
    ok: true,
    times,
    stateNames,
    statePBoxes,
    finalPBoxes,
    verdicts,
    numFocalTrajectories: totalTrajectories,
    allPicardValidated,
    rigor,
  };
}
