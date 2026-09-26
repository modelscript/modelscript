// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Activity Formal Bounded Model Checking (BMC) & k-Induction Bridge.
 *
 * Bridges SysML v2 activity specifications to @modelscript/runtime's ActivityBmcEngine,
 * enabling mathematical verification of discrete token-passing invariants:
 *   - Forbidden states / actions (#hazard, #error)
 *   - Mutual exclusion of concurrent execution paths
 *   - Maximum token buffer capacities
 *   - Extraction of concrete counterexample step traces
 */

import {
  ActivityBmcEngine,
  type ActivitySafetyInvariant,
  type BmcResult,
  type KInductionResult,
  WasmFumlEngine,
} from "@modelscript/runtime";
import { SysML2FumlBridge } from "./fuml-bridge.js";

export interface SysML2ActivityVerificationOptions {
  boundK?: number;
  useKInduction?: boolean;
  forbiddenActions?: string[];
  mutuallyExclusivePairs?: [string, string][];
  maxTokenCapacity?: number;
}

export interface SysML2ActivityVerificationResult {
  isCertified: boolean;
  method: "bmc" | "k-induction";
  boundExplored: number;
  invariant: ActivitySafetyInvariant;
  bmcResult?: BmcResult;
  kInductionResult?: KInductionResult;
  violationTrace?: {
    step: number;
    firedNodes: string[];
    reason: string;
  }[];
  summary: string;
}

/**
 * Extracts safety invariants from SysML v2 source comments and assertions.
 */
export function extractActivityInvariants(
  sysmlSource: string,
  options: SysML2ActivityVerificationOptions = {},
): ActivitySafetyInvariant {
  const forbidden = new Set<string>(options.forbiddenActions || []);
  const mutexPairs: [string, string][] = [...(options.mutuallyExclusivePairs || [])];

  // Regex for forbidden action annotation: action [name] ... #hazard or #error
  const hazardRegex = /\baction\s+([A-Za-z_][A-Za-z0-9_]*)\b[^;{}]*?(?:#hazard|#error|@hazard|@error)/g;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = hazardRegex.exec(sysmlSource)) !== null) {
    forbidden.add(hMatch[1]!);
  }

  // Regex for assertion: assert not [actionName]
  const assertNotRegex = /\bassert\s+not\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let anMatch: RegExpExecArray | null;
  while ((anMatch = assertNotRegex.exec(sysmlSource)) !== null) {
    forbidden.add(anMatch[1]!);
  }

  // Regex for mutex assertion: assert mutex([A], [B])
  const mutexRegex = /\bassert\s+mutex\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = mutexRegex.exec(sysmlSource)) !== null) {
    mutexPairs.push([mMatch[1]!, mMatch[2]!]);
  }

  return {
    name: "SysML2ActivitySafetyInvariant",
    forbiddenNodes: Array.from(forbidden),
    mutuallyExclusiveNodes: mutexPairs,
    maxTokenCapacity: options.maxTokenCapacity,
  };
}

export class SysML2ActivityVerifier {
  /**
   * Formally verifies a SysML v2 activity using Bounded Model Checking or k-Induction.
   */
  public static verify(
    sysmlSource: string,
    options: SysML2ActivityVerificationOptions = {},
  ): SysML2ActivityVerificationResult {
    const engine: WasmFumlEngine = SysML2FumlBridge.compile(sysmlSource);
    engine.init();
    const bmcEngine = new ActivityBmcEngine(engine);
    const invariant = extractActivityInvariants(sysmlSource, options);

    const boundK = options.boundK ?? 20;

    if (options.useKInduction) {
      const kRes = bmcEngine.checkKInduction(invariant, Math.min(boundK, 15));
      const isCertified = kRes.isProvenInvariant;

      let violationTrace: SysML2ActivityVerificationResult["violationTrace"] = undefined;
      if (kRes.counterexample) {
        violationTrace = kRes.counterexample.map((ce) => ({
          step: ce.stepIndex,
          firedNodes: ce.firedNodes,
          reason: "Counterexample to induction",
        }));
      }

      return {
        isCertified,
        method: "k-induction",
        boundExplored: kRes.depth,
        invariant,
        kInductionResult: kRes,
        violationTrace,
        summary: isCertified
          ? `Inductive safety proof certified at depth k=${kRes.depth}. Invariant holds universally.`
          : `k-Induction inconclusive or violated at depth k=${kRes.depth}: ${kRes.message}`,
      };
    } else {
      const bmcRes = bmcEngine.checkBoundedSafety(invariant, boundK);
      const isCertified = bmcRes.satisfied;

      let violationTrace: SysML2ActivityVerificationResult["violationTrace"] = undefined;
      if (bmcRes.violation) {
        violationTrace = bmcRes.violation.trace.map((t) => ({
          step: t.stepIndex,
          firedNodes: t.firedNodes,
          reason: bmcRes.violation!.reason,
        }));
      }

      return {
        isCertified,
        method: "bmc",
        boundExplored: bmcRes.boundReached,
        invariant,
        bmcResult: bmcRes,
        violationTrace,
        summary: isCertified
          ? `Bounded model check passed up to bound K=${boundK}. No invariant violations found.`
          : `Safety violation detected at step ${bmcRes.violation?.step}: ${bmcRes.violation?.reason}`,
      };
    }
  }
}
