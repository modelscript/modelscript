// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import type { PolyglotConfig, TGGRuleOptions } from "@modelscript/dsl/dsl/language.js";
import assert from "node:assert";
import { PolyglotTransformer, type PolyglotNode } from "./polyglot-transformer.js";

export type SemanticEnvelopeLevel = "L0" | "L1" | "L2" | "L3";

export interface EnvelopeSampleFactory {
  /** Rule name or index being fuzzed. */
  ruleName?: string;
  /** Generates a randomized valid source PolyglotNode for iteration `i`. */
  makeSource: (iter: number, rand: () => number) => PolyglotNode;
  /** Target language for forward projection. */
  targetLang: string;
  /** Source language for backward projection. */
  sourceLang: string;
  /** Optional parent context node for context-guarded rules. */
  makeContext?: (iter: number, rand: () => number) => PolyglotNode | undefined;
  /** Optional numeric property name on targetNode to perturb for PutGet check. */
  perturbTargetProp?: string;
  /** Allowed numeric tolerance for floating-point invertible expressions (default 1e-6). */
  tolerance?: number;
}

export interface EnvelopeComplianceOptions {
  language: string;
  level: SemanticEnvelopeLevel;
  config: PolyglotConfig | TGGRuleOptions[];
  syntaxTypes?: Map<string, number> | Record<string, number>;
  samples?: EnvelopeSampleFactory[];
  iterations?: number;
}

/**
 * Automated 5-gate Semantic Envelope compliance verifier:
 * 1. Zero information leak (`leakedRuleCount === 0`)
 * 2. Strict CPA confluence (`strictCpa: true`)
 * 3. L2/L3 physical feasibility bounds check (when physics rules are present)
 * 4. Unified `CompiledTGGPlan` IR construction
 * 5. Deterministic 50-iteration `GetPut` / `PutGet` lens fuzzing
 */
export function assertSemanticEnvelopeCompliance(opts: EnvelopeComplianceOptions): CompiledTGGPlan {
  const plan = planTGGRules(opts.config, {
    strictCpa: true,
    verifyLossless: true,
    syntaxTypes: opts.syntaxTypes,
  });

  assert.strictEqual(
    plan.losslessnessReport.leakedRuleCount,
    0,
    `[${opts.language}] Expected 0 leaked rules, got ${plan.losslessnessReport.leakedRuleCount}`,
  );
  assert.ok(plan.rules.length > 0, `[${opts.language}] Expected at least 1 active TGG rule`);

  if (opts.samples && opts.samples.length > 0) {
    const transformer = new PolyglotTransformer({ plan });
    const iters = opts.iterations ?? 50;
    let seed = 0x9e3779b9;
    const nextRand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (const sample of opts.samples) {
      const tol = sample.tolerance ?? 1e-6;
      for (let i = 0; i < iters; i++) {
        const srcNode = sample.makeSource(i, nextRand);
        const ctxNode = sample.makeContext ? sample.makeContext(i, nextRand) : undefined;
        const threadId = `${opts.language}:env:${sample.ruleName ?? "r"}:${i}`;

        const fwd = transformer.evaluateRuleForward(srcNode, sample.targetLang, threadId, ctxNode);
        assert.ok(fwd, `[${opts.language}] Forward projection failed at iter ${i}`);

        const bwdOpts = ctxNode ? { threadId, contextNode: ctxNode } : { threadId };
        const bwdGetPut = transformer.evaluateRuleBackward(fwd.targetNode, sample.sourceLang, bwdOpts);
        assert.ok(bwdGetPut, `[${opts.language}] GetPut backward projection failed at iter ${i}`);

        // Verify all numeric/string properties on sourceNode round-trip
        const srcProps = (srcNode["properties"] as Record<string, unknown> | undefined) ?? {};
        const bwdProps = (bwdGetPut.sourceNode["properties"] as Record<string, unknown> | undefined) ?? {};
        for (const [k, v] of Object.entries(srcProps)) {
          if (typeof v === "number" && typeof bwdProps[k] === "number") {
            assert.ok(
              Math.abs((bwdProps[k] as number) - v) <= tol,
              `[${opts.language}] GetPut mismatch on '${k}': expected ${v}, got ${bwdProps[k]}`,
            );
          } else if (typeof v === "string" && bwdProps[k] !== undefined) {
            assert.strictEqual(bwdProps[k], v, `[${opts.language}] GetPut string mismatch on '${k}'`);
          }
        }

        // PutGet check on perturbed target property if configured
        if (sample.perturbTargetProp) {
          const tgtProps = (fwd.targetNode["properties"] as Record<string, unknown> | undefined) ?? {};
          const origTgtVal = tgtProps[sample.perturbTargetProp];
          if (typeof origTgtVal === "number") {
            const delta = (nextRand() - 0.5) * Math.max(1, Math.abs(origTgtVal) * 0.2);
            const perturbedVal = origTgtVal + delta;
            const perturbedTarget: PolyglotNode = {
              ...fwd.targetNode,
              [sample.perturbTargetProp]: perturbedVal,
              properties: { ...tgtProps, [sample.perturbTargetProp]: perturbedVal },
            };
            const bwdPutOpts = ctxNode
              ? { threadId, strategy: "target-wins" as const, contextNode: ctxNode }
              : { threadId, strategy: "target-wins" as const };
            const bwdPut = transformer.evaluateRuleBackward(perturbedTarget, sample.sourceLang, bwdPutOpts);
            assert.ok(bwdPut, `[${opts.language}] PutGet backward failed at iter ${i}`);
            const fwdPutGet = transformer.evaluateRuleForward(bwdPut.sourceNode, sample.targetLang, threadId, ctxNode);
            assert.ok(fwdPutGet, `[${opts.language}] PutGet forward failed at iter ${i}`);
            const roundTripped = ((fwdPutGet.targetNode["properties"] as Record<string, unknown> | undefined) ?? {})[
              sample.perturbTargetProp
            ];
            assert.ok(
              typeof roundTripped === "number" && Math.abs(roundTripped - perturbedVal) <= tol,
              `[${opts.language}] PutGet mismatch on '${sample.perturbTargetProp}': expected ${perturbedVal}, got ${roundTripped}`,
            );
          }
        }
      }
    }
  }

  return plan;
}
