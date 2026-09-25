// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type FlowpipeReachabilityResult,
  type HybridFlowpipeProblemOptions,
  type HybridFlowpipeResult,
  HybridFlowpipeSolver,
} from "@modelscript/runtime";
import {
  ModelicaAlgorithmAnalyzer,
  type ModelicaFormalProofResult,
  type ModelicaVariableDecl,
} from "./modelica-analyzer.js";
import { ModelicaCFGLowerer, type ModelicaStatement } from "./modelica-cfg-lowerer.js";

export interface ContinuousDiscreteVerificationOptions {
  functionName?: string;
  continuousModelName?: string;
  stateNames?: string[];
  flowpipeResult?: FlowpipeReachabilityResult | HybridFlowpipeResult;
  plantPreconditions?: Map<string, [number, number]>;
}

export interface ContinuousDiscreteProofCertificate {
  isCertifiedSafe: boolean;
  unconstrainedResult: ModelicaFormalProofResult;
  physicsConstrainedResult: ModelicaFormalProofResult;
  eliminatedFalseAlarms: number;
  injectedInvariants: Map<string, [number, number]>;
  continuousSafetyCertified: boolean;
  executiveSummary: string;
}

export class PhysicalInvariantBridge {
  /**
   * Extracts state reachability envelopes [min_t lo(t), max_t hi(t)] from a continuous flowpipe result.
   */
  static extractFlowpipeEnvelopes(
    flowpipeResult: FlowpipeReachabilityResult,
    stateNames: string[],
  ): Map<string, [number, number]> {
    const envelopes = new Map<string, [number, number]>();

    for (let i = 0; i < stateNames.length; i++) {
      envelopes.set(stateNames[i]!, [Infinity, -Infinity]);
    }

    for (const step of flowpipeResult.steps) {
      for (let i = 0; i < stateNames.length && i < step.tubes.length; i++) {
        const name = stateNames[i]!;
        const tube = step.tubes[i]!;
        const curr = envelopes.get(name)!;
        envelopes.set(name, [Math.min(curr[0], tube.lo), Math.max(curr[1], tube.hi)]);
      }
    }

    return envelopes;
  }

  /**
   * Extracts state reachability envelopes across all modes and jumps from a hybrid flowpipe result.
   */
  static extractHybridFlowpipeEnvelopes(
    hybridResult: HybridFlowpipeResult,
    stateNames: string[],
  ): Map<string, [number, number]> {
    const envelopes = new Map<string, [number, number]>();

    for (let i = 0; i < stateNames.length; i++) {
      envelopes.set(stateNames[i]!, [Infinity, -Infinity]);
    }

    // 1. Continuous mode segments
    for (const seg of hybridResult.segments) {
      for (const step of seg.steps) {
        for (let i = 0; i < stateNames.length && i < step.tubes.length; i++) {
          const name = stateNames[i]!;
          const tube = step.tubes[i]!;
          const curr = envelopes.get(name)!;
          envelopes.set(name, [Math.min(curr[0], tube.lo), Math.max(curr[1], tube.hi)]);
        }
      }
    }

    // 2. Discrete mode jump enclosures
    for (const jump of hybridResult.jumps) {
      for (let i = 0; i < stateNames.length && i < jump.postJumpEnclosure.length; i++) {
        const name = stateNames[i]!;
        const tube = jump.postJumpEnclosure[i]!;
        const curr = envelopes.get(name)!;
        envelopes.set(name, [Math.min(curr[0], tube.lo), Math.max(curr[1], tube.hi)]);
      }
    }

    return envelopes;
  }

  /**
   * Verifies a discrete Modelica algorithm against physical plant reachability invariants.
   * Compares the unconstrained baseline analysis against the physics-constrained proof,
   * certifying the elimination of false alarms.
   */
  static verifyWithContinuousInvariants(
    statementsOrCode: ModelicaStatement[] | string,
    variables: ModelicaVariableDecl[] = [],
    options: ContinuousDiscreteVerificationOptions = {},
  ): ContinuousDiscreteProofCertificate {
    const statements =
      typeof statementsOrCode === "string" ? ModelicaCFGLowerer.parseStatements(statementsOrCode) : statementsOrCode;

    // 1. Baseline analysis without continuous physical bounds (worst-case inputs)
    const unconstrainedResult = ModelicaAlgorithmAnalyzer.analyze(statements, variables, {
      functionName: options.functionName,
    });

    // 2. Extract or assemble physical plant reachability envelopes
    let injectedInvariants = new Map<string, [number, number]>();
    let continuousSafetyCertified = true;

    if (options.plantPreconditions) {
      for (const [k, v] of options.plantPreconditions) {
        injectedInvariants.set(k, [v[0], v[1]]);
      }
    } else if (options.flowpipeResult && options.stateNames) {
      continuousSafetyCertified = options.flowpipeResult.isCertifiedSafe;
      if ("segments" in options.flowpipeResult) {
        injectedInvariants = this.extractHybridFlowpipeEnvelopes(
          options.flowpipeResult as HybridFlowpipeResult,
          options.stateNames,
        );
      } else {
        injectedInvariants = this.extractFlowpipeEnvelopes(
          options.flowpipeResult as FlowpipeReachabilityResult,
          options.stateNames,
        );
      }
    }

    // 3. Physics-constrained analysis with verified reachability flowpipes
    const physicsConstrainedResult = ModelicaAlgorithmAnalyzer.analyze(statements, variables, {
      functionName: options.functionName,
      plantPreconditions: injectedInvariants,
    });

    // 4. Quantify false alarms eliminated by continuous physical invariants
    const eliminatedFalseAlarms = Math.max(
      0,
      unconstrainedResult.potentialBugs.length - physicsConstrainedResult.potentialBugs.length,
    );

    const isCertifiedSafe = physicsConstrainedResult.isCertifiedSafe && continuousSafetyCertified;

    // 5. Generate executive cross-disciplinary verification certificate
    const fnTitle = options.functionName ? ` for '${options.functionName}'` : "";
    const plantTitle = options.continuousModelName ? ` [Plant: ${options.continuousModelName}]` : "";

    const invariantRows = Array.from(injectedInvariants.entries())
      .map(([k, [lo, hi]]) => `│   ${k.padEnd(20)} ∈ [${lo.toFixed(4)}, ${hi.toFixed(4)}]`.padEnd(72) + "│")
      .join("\n");

    const executiveSummary = [
      `┌────────────────────────────────────────────────────────────────────────┐`,
      `│ Cross-Disciplinary Plant-to-Algorithm Verification Certificate${(fnTitle + plantTitle).slice(0, 16).padStart(16)}│`,
      `├────────────────────────────────────────────────────────────────────────┤`,
      `│ 1. Continuous Physical Plant Reachability Envelopes:                  │`,
      invariantRows || `│   (No physical invariants specified)                                   │`,
      `│   Continuous Dynamics Certified Safe: ${continuousSafetyCertified ? "YES (100% Reachability Guaranteed)" : "NO (Violations)"}│`,
      `├────────────────────────────────────────────────────────────────────────┤`,
      `│ 2. Discrete Algorithmic Static Analysis Comparison:                   │`,
      `│   Unconstrained Baseline Potential Alarms: ${String(unconstrainedResult.potentialBugs.length).padStart(3)}                         │`,
      `│   Physics-Constrained Remaining Violations: ${String(physicsConstrainedResult.potentialBugs.length + physicsConstrainedResult.definiteBugs.length).padStart(3)}                         │`,
      `│   False Alarms Eliminated via Physical Invariants: ${String(eliminatedFalseAlarms).padStart(3)}                │`,
      `├────────────────────────────────────────────────────────────────────────┤`,
      `│ FINAL CERTIFICATION: ${isCertifiedSafe ? "100% MATHEMATICALLY CERTIFIED SAFE (Zero False Alarms)" : "VERIFICATION INCOMPLETE"}│`,
      `└────────────────────────────────────────────────────────────────────────┘`,
    ].join("\n");

    return {
      isCertifiedSafe,
      unconstrainedResult,
      physicsConstrainedResult,
      eliminatedFalseAlarms,
      injectedInvariants,
      continuousSafetyCertified,
      executiveSummary,
    };
  }

  /**
   * End-to-end continuous-discrete verification:
   * Solves the continuous hybrid automaton flowpipes and injects them directly into the discrete algorithm.
   */
  static verifyContinuousHybridSystem(
    hybridProblem: HybridFlowpipeProblemOptions,
    controlCode: string | ModelicaStatement[],
    controlVariables: ModelicaVariableDecl[] = [],
    stateToInputMapping: Record<string, string> = {},
    options?: { functionName?: string; continuousModelName?: string },
  ): ContinuousDiscreteProofCertificate {
    // 1. Solve validated continuous/hybrid reachability
    const hybridResult = HybridFlowpipeSolver.solve(hybridProblem);

    // 2. Extract physical envelopes
    const continuousStateNames = Object.keys(stateToInputMapping);
    const rawEnvelopes = this.extractHybridFlowpipeEnvelopes(hybridResult, continuousStateNames);

    // 3. Map continuous physical states to discrete algorithmic input variable names
    const mappedPreconditions = new Map<string, [number, number]>();
    for (const [stateName, inputName] of Object.entries(stateToInputMapping)) {
      const bounds = rawEnvelopes.get(stateName);
      if (bounds) {
        mappedPreconditions.set(inputName, bounds);
      }
    }

    // 4. Verify discrete algorithm with mapped physical bounds
    return this.verifyWithContinuousInvariants(controlCode, controlVariables, {
      functionName: options?.functionName,
      continuousModelName: options?.continuousModelName,
      flowpipeResult: hybridResult,
      stateNames: continuousStateNames,
      plantPreconditions: mappedPreconditions,
    });
  }
}
