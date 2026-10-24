// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Flow Assurance Requirements & Safety Verifier.
 *
 * Checks continuous multiphase simulation trajectories against formal
 * flow assurance constraints (hydrate subcooling, slug surge, MAOP),
 * and verifies operational procedure state machines.
 */

import { simulateDriftFlux } from "../solver/drift-flux-dae.js";
import { computeHydrateEquilibriumTemp } from "../solver/zuber-findlay.js";
import type {
  FlowAssuranceLimits,
  FlowAssuranceVerificationResult,
  OlgaModel,
  OlgaSimulationResult,
} from "../types.js";

export interface TransitionDescriptor {
  id?: string | undefined;
  name?: string | undefined;
  source: string;
  target: string;
  guardText?: string | undefined;
}

export interface StateDeterminismDiagnostic {
  type: "nondeterminism" | "deadlock";
  stateName: string;
  transitionA?: string | undefined;
  transitionB?: string | undefined;
  message: string;
}

export interface StateDeterminismResult {
  isDeterministic: boolean;
  isComplete: boolean;
  diagnostics: StateDeterminismDiagnostic[];
}

export const DEFAULT_FLOW_ASSURANCE_LIMITS: FlowAssuranceLimits = {
  maop: 220.0e5, // 220 bar
  hydrateMarginKelvin: 3.0, // 3 K margin
  slugCatcherLiquidCapacity: 150.0, // 150 m^3
  minGasVelocity: 2.5, // 2.5 m/s
};

/**
 * Verifies simulation trajectory against formal flow assurance limits.
 */
export function verifyFlowAssuranceTrajectory(
  trajectory: OlgaSimulationResult,
  limits: FlowAssuranceLimits = DEFAULT_FLOW_ASSURANCE_LIMITS,
): FlowAssuranceVerificationResult {
  let minMarginObserved = Infinity;
  let criticalLocation = 0;
  let peakPressureObserved = -Infinity;
  let minVelocityObserved = Infinity;

  for (const snapshot of trajectory.profiles) {
    const count = snapshot.x.length;
    for (let i = 0; i < count; i++) {
      const p = snapshot.pressure[i]!;
      const t = snapshot.temperature[i]!;
      const ug = snapshot.gasVelocity[i]!;
      const loc = snapshot.x[i]!;

      // 1. Hydrate margin check
      const tHyd = computeHydrateEquilibriumTemp(p);
      const margin = t - tHyd;
      if (margin < minMarginObserved) {
        minMarginObserved = margin;
        criticalLocation = loc;
      }

      // 2. MAOP check
      if (p > peakPressureObserved) {
        peakPressureObserved = p;
      }

      // 3. Turndown velocity check
      if (ug < minVelocityObserved) {
        minVelocityObserved = ug;
      }
    }
  }

  const peakLiquidSurge = trajectory.trends.peakLiquidSurgeVolume;
  const slugCapacityLimit = 0.85 * limits.slugCatcherLiquidCapacity;

  const hydratePassed = minMarginObserved >= limits.hydrateMarginKelvin;
  const slugPassed = peakLiquidSurge <= slugCapacityLimit;
  const maopPassed = peakPressureObserved <= limits.maop;
  const turndownPassed = minVelocityObserved >= limits.minGasVelocity;

  const passed = hydratePassed && slugPassed && maopPassed && turndownPassed;

  return {
    passed,
    checks: {
      hydrateAvoidance: {
        passed: hydratePassed,
        minMarginObserved,
        requiredMargin: limits.hydrateMarginKelvin,
        criticalLocation,
      },
      slugCatcherSurge: {
        passed: slugPassed,
        peakArrivalLiquidVolume: peakLiquidSurge,
        capacityLimit: slugCapacityLimit,
      },
      maopOverpressure: {
        passed: maopPassed,
        peakPressureObserved,
        maopLimit: limits.maop,
      },
      turndownVelocity: {
        passed: turndownPassed,
        minVelocityObserved,
        requiredVelocity: limits.minGasVelocity,
      },
    },
  };
}

/**
 * Formally verifies operational procedure state machine transitions for determinism and completeness.
 */
export function verifyOperatingProcedureStateTransitions(
  stateName: string,
  transitions: TransitionDescriptor[],
): StateDeterminismResult {
  const diagnostics: StateDeterminismDiagnostic[] = [];
  let isDeterministic = true;
  let isComplete = true;

  // Pairwise guard overlap check
  for (let i = 0; i < transitions.length; i++) {
    for (let j = i + 1; j < transitions.length; j++) {
      const tA = transitions[i]!;
      const tB = transitions[j]!;
      const gA = (tA.guardText || "").trim();
      const gB = (tB.guardText || "").trim();

      // If both are unguarded, non-deterministic conflict
      if (!gA && !gB) {
        isDeterministic = false;
        diagnostics.push({
          type: "nondeterminism",
          stateName,
          transitionA: tA.name,
          transitionB: tB.name,
          message: `Multiple unguarded transitions from state '${stateName}'.`,
        });
      } else if (gA && gB) {
        // Complementary comparisons e.g. (> 18.0 and <= 18.0)
        const isComplementary =
          (gA.includes(">") && gB.includes("<=")) ||
          (gA.includes("<=") && gB.includes(">")) ||
          (gA.includes("<") && gB.includes(">=")) ||
          (gA.includes(">=") && gB.includes("<"));

        if (!isComplementary && gA === gB) {
          isDeterministic = false;
          diagnostics.push({
            type: "nondeterminism",
            stateName,
            transitionA: tA.name,
            transitionB: tB.name,
            message: `Overlapping guards '${gA}' and '${gB}' from state '${stateName}'.`,
          });
        }
      }
    }
  }

  // Completeness check
  const hasUnguarded = transitions.some((t) => !(t.guardText || "").trim());
  const guards = transitions.map((t) => (t.guardText || "").trim()).filter(Boolean);
  if (!hasUnguarded && guards.length > 0) {
    const coversUpper = guards.some((g) => g.includes(">") || g.includes(">="));
    const coversLower = guards.some((g) => g.includes("<") || g.includes("<="));
    if (!coversUpper || !coversLower) {
      isComplete = false;
      diagnostics.push({
        type: "deadlock",
        stateName,
        message: `Guard conditions do not completely partition the operating domain in state '${stateName}'.`,
      });
    }
  }

  return {
    isDeterministic,
    isComplete,
    diagnostics,
  };
}

/**
 * Runs a transient simulation of the OlgaModel and verifies compliance with flow assurance limits.
 */
export function verifyFlowAssuranceLimits(
  model: OlgaModel,
  limits: FlowAssuranceLimits = DEFAULT_FLOW_ASSURANCE_LIMITS,
): FlowAssuranceVerificationResult {
  const simResult = simulateDriftFlux(model, {
    durationSeconds: Math.min(model.endTime - model.startTime, 3600),
    timeStepSeconds: model.maxDt,
  });
  return verifyFlowAssuranceTrajectory(simResult, limits);
}
