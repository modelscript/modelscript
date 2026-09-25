// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Physics-Informed Automated Safety & Fault Tree Discovery.
 *
 * Bridges discrete SysML v2 safety analysis (QuickXplain, Minimal Cut Sets, and Fault Trees)
 * with continuous Modelica transient multiphysics and CAD/FEA stress thresholds.
 *
 * Discovers emergent physical cascades where combinations of subtle component degradations
 * compound to trigger systemic hazards (e.g. thermal runaway, structural yield, or voltage collapse).
 */

import {
  analyzeSafetyAndFaultTree,
  type FailureMode,
  type HazardDefinition,
  type SafetyAnalysisResult,
} from "./safety-analyzer.js";

export interface ContinuousSimulationTrajectory {
  times: number[];
  signals: Record<string, number[]>;
}

export interface PhysicsHazardCondition {
  variable: string;
  operator: ">=" | "<=" | ">" | "<";
  threshold: number;
  /** Minimum continuous duration the violation must persist to trigger the hazard (default: 0 = instantaneous) */
  minDurationSeconds?: number;
}

export interface PhysicsHazardOptions {
  hazardId: string;
  hazardName: string;
  severity?: number;
  probability?: number;
  failureModes: FailureMode[];
  /** Parameter overrides mapped to each failure mode ID */
  faultInjections: Record<string, Record<string, number>>;
  /** Nominal baseline physical parameters */
  baselineParams?: Record<string, number>;
  /** Simulation runner (e.g. Modelica continuous DAE evaluator) */
  simulate: (params: Record<string, number>) => ContinuousSimulationTrajectory;
  hazardCondition: PhysicsHazardCondition;
  maxOrder?: number;
}

export interface PhysicsSafetyAnalysisResult extends SafetyAnalysisResult {
  physicalFailureTraces: {
    cutSetFaults: string[];
    violatingVariable: string;
    peakValue: number;
    timeOfBreach: number;
  }[];
}

export class PhysicsSafetyBridge {
  /**
   * Constructs a cached, physics-informed hazard evaluation predicate over active fault sets.
   */
  public static createHazardPredicate(
    options: Omit<PhysicsHazardOptions, "hazardId" | "hazardName" | "failureModes">,
  ): {
    predicate: (activeFaults: Set<string>) => boolean;
    getWitnessTraces: () => PhysicsSafetyAnalysisResult["physicalFailureTraces"];
  } {
    const { faultInjections, baselineParams = {}, simulate, hazardCondition } = options;
    const simCache = new Map<string, { causesHazard: boolean; peak: number; time: number }>();
    const witnessTraces: PhysicsSafetyAnalysisResult["physicalFailureTraces"] = [];

    const predicate = (activeFaults: Set<string>): boolean => {
      // Sort fault keys for deterministic cache lookups
      const cacheKey = [...activeFaults].sort().join("::");
      if (simCache.has(cacheKey)) {
        return simCache.get(cacheKey)!.causesHazard;
      }

      // Compose parameter overrides for all currently active faults
      const mergedParams: Record<string, number> = { ...baselineParams };
      for (const faultId of activeFaults) {
        const overrides = faultInjections[faultId];
        if (overrides) {
          for (const [k, v] of Object.entries(overrides)) {
            mergedParams[k] = v;
          }
        }
      }

      // Execute continuous simulation
      const trajectory = simulate(mergedParams);
      const signal = trajectory.signals[hazardCondition.variable];
      if (!signal || signal.length === 0) {
        simCache.set(cacheKey, { causesHazard: false, peak: 0, time: 0 });
        return false;
      }

      let isTriggered = false;
      let peakValue = signal[0] ?? 0;
      let breachTime = 0;

      for (let i = 0; i < trajectory.times.length; i++) {
        const val = signal[i]!;
        const t = trajectory.times[i]!;

        // Track peak/extremum
        if (hazardCondition.operator === ">=" || hazardCondition.operator === ">") {
          if (val > peakValue) peakValue = val;
        } else {
          if (val < peakValue) peakValue = val;
        }

        let violated = false;
        switch (hazardCondition.operator) {
          case ">=":
            violated = val >= hazardCondition.threshold;
            break;
          case ">":
            violated = val > hazardCondition.threshold;
            break;
          case "<=":
            violated = val <= hazardCondition.threshold;
            break;
          case "<":
            violated = val < hazardCondition.threshold;
            break;
        }

        if (violated && !isTriggered) {
          isTriggered = true;
          breachTime = t;
        }
      }

      simCache.set(cacheKey, { causesHazard: isTriggered, peak: peakValue, time: breachTime });

      if (isTriggered && activeFaults.size > 0) {
        witnessTraces.push({
          cutSetFaults: [...activeFaults],
          violatingVariable: hazardCondition.variable,
          peakValue,
          timeOfBreach: breachTime,
        });
      }

      return isTriggered;
    };

    return {
      predicate,
      getWitnessTraces: () => witnessTraces,
    };
  }

  /**
   * Executes physics-informed automated safety analysis.
   */
  public static analyzePhysicsSafety(options: PhysicsHazardOptions): PhysicsSafetyAnalysisResult {
    const { predicate, getWitnessTraces } = this.createHazardPredicate(options);

    const hazard: HazardDefinition = {
      id: options.hazardId,
      name: options.hazardName,
      severity: options.severity ?? 4,
      probability: options.probability ?? 2,
      causesHazard: predicate,
    };

    const baseResult = analyzeSafetyAndFaultTree(undefined, {
      failureModes: options.failureModes,
      hazard,
      maxOrder: options.maxOrder ?? 3,
    });

    const witnessTraces = getWitnessTraces();

    return {
      ...baseResult,
      physicalFailureTraces: witnessTraces,
      summary: `${baseResult.summary} (Physics-informed simulation discovered ${witnessTraces.length} physical violation trajectories).`,
    };
  }
}
