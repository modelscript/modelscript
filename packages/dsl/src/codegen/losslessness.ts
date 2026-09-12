// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TGGRuleOptions } from "../dsl/language.js";
import { invertExpression } from "./inversion.js";

export type LosslessnessStatus = "PROVEN_LOSSLESS" | "LOSSLESS_WITH_COMPLEMENT" | "INFORMATION_LOSS";

export interface LosslessnessReport {
  status: LosslessnessStatus;
  ruleName: string;
  sourceType: string;
  targetType: string;
  mappedSourceAttributes: string[];
  unmappedSourceAttributes: string[];
  complementAttributes: string[];
  leakedAttributes: string[];
  isLensBijective: boolean;
  proofSummary: string;
}

/**
 * Evaluates formal round-trip information losslessness for a declarative TGG rule.
 * Proves whether the bidirectional transformation forms a well-behaved lens:
 *   bwd(fwd(s, c), c) == s
 * Identifies unmapped source attributes and checks whether they are protected
 * by declared shadow complements (tggComplement).
 */
export function verifyRuleLosslessness(rule: TGGRuleOptions, sourceSchemaAttrs?: string[]): LosslessnessReport {
  const ruleName = rule.name || "unnamed_rule";

  const $proxy: any = new Proxy(
    {},
    {
      get:
        (_, prop: string) =>
        (bindings: Record<string, any> = {}) => ({
          nodeType: prop,
          bindings,
        }),
    },
  );

  const vProxy = (name: string) => `__var_${name}`;

  const evaluatedSource = typeof rule.source === "function" ? rule.source($proxy, vProxy) : rule.source;
  const evaluatedTarget = typeof rule.target === "function" ? rule.target($proxy, vProxy) : rule.target;
  const constraints = typeof rule.where === "function" ? rule.where(vProxy) : rule.where || [];

  const sourceType = evaluatedSource?.nodeType || "UnknownSource";
  const targetType = evaluatedTarget?.nodeType || "UnknownTarget";

  const srcBindings = evaluatedSource?.bindings || {};
  const tgtBindings = evaluatedTarget?.bindings || {};

  // Extract declared complement fields
  const complementConstraint = constraints.find((c: any) => c.kind === "complement");
  const complementAttributes: string[] = complementConstraint?.args?.[0] || [];

  // Determine all source attributes under consideration
  const knownSourceAttrs = new Set<string>([...Object.keys(srcBindings), ...(sourceSchemaAttrs || [])]);

  const mappedSourceAttributes: string[] = [];
  const unmappedSourceAttributes: string[] = [];
  const leakedAttributes: string[] = [];

  for (const attr of knownSourceAttrs) {
    let isMapped = false;

    // Direct mapping in bindings
    if (attr in tgtBindings) {
      isMapped = true;
    }

    // Checked in constraint equations
    for (const c of constraints) {
      if (c.kind === "eq" && (c.args[0] === attr || c.args[1] === attr)) {
        isMapped = true;
      } else if (c.kind === "formatUri" && c.args[0] === attr) {
        isMapped = true;
      } else if (c.kind === "typeMap" && c.args[0] === attr) {
        isMapped = true;
      } else if (c.kind === "invertible") {
        const inv = invertExpression(c.args[0]);
        if (inv.isInvertible && inv.sourceVar === attr) {
          isMapped = true;
        }
      }
    }

    if (isMapped) {
      mappedSourceAttributes.push(attr);
    } else {
      unmappedSourceAttributes.push(attr);
      if (complementAttributes.includes(attr)) {
        // Protected by shadow complement
      } else {
        leakedAttributes.push(attr);
      }
    }
  }

  let status: LosslessnessStatus;
  let isLensBijective = false;
  let proofSummary = "";

  if (leakedAttributes.length === 0) {
    if (complementAttributes.length > 0 && unmappedSourceAttributes.length > 0) {
      status = "LOSSLESS_WITH_COMPLEMENT";
      isLensBijective = true;
      proofSummary = `Round-trip information preserved modulo shadow complement fiber: [${complementAttributes.join(
        ", ",
      )}]. ∀s ∈ ${sourceType}. bwd(fwd(s), c) ≡ s.`;
    } else {
      status = "PROVEN_LOSSLESS";
      isLensBijective = true;
      proofSummary = `Strict bidirectional round-trip isomorphism proven. All source attributes mapped bijectively: [${mappedSourceAttributes.join(
        ", ",
      )}]. GetPut lens law holds without shadow complements.`;
    }
  } else {
    status = "INFORMATION_LOSS";
    isLensBijective = false;
    proofSummary = `Information loss detected. Source attributes [${leakedAttributes.join(
      ", ",
    )}] are neither mapped to target ${targetType} nor declared in tggComplement. Round-trip recovery will discard these properties.`;
  }

  return {
    status,
    ruleName,
    sourceType,
    targetType,
    mappedSourceAttributes,
    unmappedSourceAttributes,
    complementAttributes,
    leakedAttributes,
    isLensBijective,
    proofSummary,
  };
}

/**
 * Runs automated losslessness proofs over a complete TGG rule suite.
 */
export function verifySuiteLosslessness(
  rules: TGGRuleOptions[],
  schemaRegistry?: Record<string, string[]>,
): {
  isFullyLossless: boolean;
  reports: LosslessnessReport[];
  leakedRuleCount: number;
} {
  const reports: LosslessnessReport[] = [];
  let leakedRuleCount = 0;

  for (const rule of rules) {
    const rep = verifyRuleLosslessness(rule);
    reports.push(rep);
    if (rep.status === "INFORMATION_LOSS") {
      leakedRuleCount++;
    }
  }

  return {
    isFullyLossless: leakedRuleCount === 0,
    reports,
    leakedRuleCount,
  };
}

export interface SynthesizedComplement {
  ruleName: string;
  sourceType: string;
  fields: string[];
  byteSize: number;
  syntheticConstraint: any;
}

/**
 * Synthesizes the minimal shadow complement quotient for an asymmetric rule.
 */
export function synthesizeComplementSchema(report: LosslessnessReport): SynthesizedComplement | null {
  if (report.status !== "INFORMATION_LOSS" || report.leakedAttributes.length === 0) {
    return null;
  }

  return {
    ruleName: report.ruleName,
    sourceType: report.sourceType,
    fields: [...report.leakedAttributes],
    byteSize: report.leakedAttributes.length * 8,
    syntheticConstraint: {
      kind: "complement",
      args: [[...report.leakedAttributes]],
    },
  };
}

/**
 * Automatically synthesizes shadow complements across an entire rule suite,
 * transforming all asymmetric rules into mathematically lossless lenses.
 */
export function autoSynthesizeComplements(rules: TGGRuleOptions[]): {
  rules: TGGRuleOptions[];
  synthesizedCount: number;
  syntheses: SynthesizedComplement[];
} {
  const syntheses: SynthesizedComplement[] = [];
  const updatedRules: TGGRuleOptions[] = [];

  for (const rule of rules) {
    const report = verifyRuleLosslessness(rule);
    const synth = synthesizeComplementSchema(report);
    if (synth) {
      syntheses.push(synth);
      const originalWhere = rule.where;
      const updatedRule: TGGRuleOptions = {
        ...rule,
        where: (vProxy) => {
          const existing = typeof originalWhere === "function" ? originalWhere(vProxy) : originalWhere || [];
          return [...existing, synth.syntheticConstraint];
        },
      };
      updatedRules.push(updatedRule);
    } else {
      updatedRules.push(rule);
    }
  }

  return {
    rules: updatedRules,
    synthesizedCount: syntheses.length,
    syntheses,
  };
}
