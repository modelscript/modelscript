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
import { collectCstLeaves, isSysmlIdentLeaf, parseSysmlSource } from "./cst-utils.js";
import { SysML2FumlBridge } from "./fuml-bridge.js";

export interface SysML2ActivityVerificationOptions {
  boundK?: number | undefined;
  useKInduction?: boolean | undefined;
  forbiddenActions?: string[] | undefined;
  mutuallyExclusivePairs?: [string, string][] | undefined;
  maxTokenCapacity?: number | undefined;
}

export interface SysML2ActivityVerificationResult {
  isCertified: boolean;
  method: "bmc" | "k-induction";
  boundExplored: number;
  invariant: ActivitySafetyInvariant;
  bmcResult?: BmcResult | undefined;
  kInductionResult?: KInductionResult | undefined;
  violationTrace?:
    | {
        step: number;
        firedNodes: string[];
        reason: string;
      }[]
    | undefined;
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

  const leaves = collectCstLeaves(parseSysmlSource(sysmlSource));

  for (let i = 0; i < leaves.length; i++) {
    const cur = leaves[i]!;

    // Forbidden action annotation: action <name> ... (#hazard | #error | @hazard | @error)
    if (cur.text === "action" && isSysmlIdentLeaf(leaves[i + 1]?.text)) {
      const actionName = leaves[i + 1]!.text;
      for (let j = i + 2; j < leaves.length; j++) {
        const tok = leaves[j]!.text;
        if (tok === ";" || tok === "{" || tok === "}") break;
        if ((tok === "#" || tok === "@") && (leaves[j + 1]?.text === "hazard" || leaves[j + 1]?.text === "error")) {
          forbidden.add(actionName);
          break;
        }
      }
      continue;
    }

    if (cur.text === "assert") {
      const next = leaves[i + 1]?.text;
      // Assertion: assert not <actionName>
      if (next === "not" && isSysmlIdentLeaf(leaves[i + 2]?.text)) {
        forbidden.add(leaves[i + 2]!.text);
        continue;
      }
      // Mutex assertion: assert mutex(<A>, <B>)
      if (
        next === "mutex" &&
        leaves[i + 2]?.text === "(" &&
        isSysmlIdentLeaf(leaves[i + 3]?.text) &&
        leaves[i + 4]?.text === "," &&
        isSysmlIdentLeaf(leaves[i + 5]?.text) &&
        leaves[i + 6]?.text === ")"
      ) {
        mutexPairs.push([leaves[i + 3]!.text, leaves[i + 5]!.text]);
      }
    }
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
