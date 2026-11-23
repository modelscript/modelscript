// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Polyglot Language-to-Algorithm Integration Bridges.
 *
 * Connects ModelScript's polyglot language frontends (`touchstone`, `comtrade`, `sysml2`,
 * `sbml`/`bngl`, `optical`) directly to Phases 1–8 numerical & formal engines.
 */

import {
  BddFaultTreeEngine,
  PassivityTheoryOracle,
  ProbabilisticModelCheckingOracle,
  type CtmcModel,
  type FaultTreeNode,
} from "@modelscript/runtime";
import { designButterworth, filtfilt } from "../dsp/filters.js";
import { pronyRingdownAnalysis, welchPsd, type RingdownMode } from "../dsp/spectral.js";
import { runGillespieSsa, solveFluxBalanceAnalysis } from "../solvers/bio/systems-biology.js";
import { computeAbcdSystem, traceParaxialRay, type OpticalElement } from "../solvers/em/electromagnetics.js";
import { vectorFit, type VectorFitResult } from "../sysid/vector-fitting.js";

/** Touchstone S-parameter table -> Passive Vector-Fitted State-Space + PassivityTheoryOracle certification. */
export function touchstoneToPassiveMacromodel(
  modelId: string,
  frequenciesHz: readonly number[],
  sReal: readonly number[],
  sImag: readonly number[],
  order = 4,
): { fit: VectorFitResult; oracleCertifiedPassive: boolean; conflictReason?: string | undefined } {
  const fit = vectorFit(frequenciesHz, sReal, sImag, { order, enforcePassivity: true });
  const oracle = new PassivityTheoryOracle();
  oracle.registerMacromodel({
    id: modelId,
    kind: "scattering",
    frequenciesHz,
    values: frequenciesHz.map(() => fit.maxMagnitude),
  });
  const sat = oracle.checkSat();
  return {
    fit,
    oracleCertifiedPassive: sat.isSat,
    conflictReason: sat.conflict?.explanation,
  };
}

/** COMTRADE fault-record waveform -> Anti-alias filter + Welch PSD + Prony oscillation damping modes. */
export function comtradeWaveformDiagnostics(
  samples: Readonly<Float64Array | number[]>,
  sampleRateHz: number,
  opts?: { lowpassCutoffHz?: number | undefined; pronyOrder?: number | undefined },
): {
  dominantFrequencyHz: number;
  ringdownModes: RingdownMode[];
  poorlyDampedModes: RingdownMode[];
} {
  const processed = opts?.lowpassCutoffHz
    ? filtfilt(samples, designButterworth(4, opts.lowpassCutoffHz, sampleRateHz, "lowpass"))
    : Float64Array.from(samples);
  const psd = welchPsd(processed, sampleRateHz, { segmentLength: Math.min(256, processed.length) });
  let peakIdx = 0;
  for (let i = 1; i < psd.psd.length; i++) {
    if (psd.psd[i]! > psd.psd[peakIdx]!) peakIdx = i;
  }
  const prony = pronyRingdownAnalysis(processed, sampleRateHz, opts?.pronyOrder ?? 4);
  const poorlyDampedModes = prony.modes.filter((m) => m.dampingRatio < 0.05 && m.frequencyHz > 0.1);
  return {
    dominantFrequencyHz: psd.frequenciesHz[peakIdx] ?? 0,
    ringdownModes: prony.modes,
    poorlyDampedModes,
  };
}

/** SysML2 / Safety-Case reliability verification via ROBDD Fault Tree + CTMC + PMC Oracle. */
export function verifySafetyCaseReliability(spec: {
  id: string;
  faultTree?: { tree: FaultTreeNode; maxFailureProb: number } | undefined;
  ctmc?: { model: CtmcModel; horizon: number; maxFailureProb: number } | undefined;
}): {
  certifiedSafe: boolean;
  conflictReason?: string | undefined;
  minimalCutSets?: string[][] | undefined;
  topEventProbability?: number | undefined;
} {
  const oracle = new ProbabilisticModelCheckingOracle();
  let minimalCutSets: string[][] | undefined;
  let topEventProbability: number | undefined;

  if (spec.faultTree) {
    const ft = new BddFaultTreeEngine().analyze(spec.faultTree.tree);
    minimalCutSets = ft.minimalCutSets;
    topEventProbability = ft.topEventProbability;
    oracle.registerCheck({
      kind: "fault-tree",
      id: `${spec.id}:ft`,
      tree: spec.faultTree.tree,
      maxFailureProb: spec.faultTree.maxFailureProb,
    });
  }
  if (spec.ctmc) {
    oracle.registerCheck({
      kind: "ctmc",
      id: `${spec.id}:ctmc`,
      model: spec.ctmc.model,
      horizon: spec.ctmc.horizon,
      maxFailureProb: spec.ctmc.maxFailureProb,
    });
  }
  const sat = oracle.checkSat();
  return {
    certifiedSafe: sat.isSat,
    conflictReason: sat.conflict?.explanation,
    minimalCutSets,
    topEventProbability,
  };
}

/** SBML/BNGL reaction network bridge to both stochastic SSA and steady-state FBA. */
export function analyzeReactionNetwork(spec: {
  initialCounts: readonly number[];
  stoichiometry: readonly (readonly number[])[];
  propensities: (counts: readonly number[]) => number[];
  tEnd: number;
  fbaLowerBounds?: readonly number[] | undefined;
  fbaUpperBounds?: readonly number[] | undefined;
  fbaObjective?: readonly number[] | undefined;
  seed?: number | undefined;
}) {
  const ssa = runGillespieSsa(spec.initialCounts, spec.stoichiometry, spec.propensities, spec.tEnd, {
    seed: spec.seed,
  });
  let fba = undefined;
  if (spec.fbaLowerBounds && spec.fbaUpperBounds && spec.fbaObjective) {
    // Transpose rxn x species -> species x rxn for S*v = 0
    const numRxns = spec.stoichiometry.length;
    const numSpecies = spec.initialCounts.length;
    const S: number[][] = Array.from({ length: numSpecies }, (_, s) =>
      Array.from({ length: numRxns }, (_, r) => spec.stoichiometry[r]![s]!),
    );
    fba = solveFluxBalanceAnalysis(S, spec.fbaLowerBounds, spec.fbaUpperBounds, spec.fbaObjective);
  }
  return { ssa, fba };
}

/** Optical bench prescription -> ABCD ray trace + resonator stability check (|A + D| <= 2). */
export function analyzeOpticalBench(
  elements: readonly OpticalElement[],
  y0 = 1.0,
  theta0 = 0.0,
): { y: number; theta: number; resonatorStable: boolean; traceAD: number } {
  const abcd = computeAbcdSystem(elements);
  const traced = traceParaxialRay(y0, theta0, elements);
  const traceAD = abcd.A + abcd.D;
  return {
    y: traced.y,
    theta: traced.theta,
    resonatorStable: Math.abs(traceAD) <= 2.0 + 1e-9,
    traceAD,
  };
}
