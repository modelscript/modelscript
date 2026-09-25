// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Nelson-Oppen Tolerance Stack-Up Theory Oracle.
 *
 * Evaluates 1D/3D tolerance chains from STEP AP242 Semantic GD&T specifications
 * using Worst-Case (WC), Root-Sum-Square (RSS), and Six-Sigma C_pk statistical models.
 * Propagates assembly clearance bounds to other theory oracles and detects interference / excessive play conflicts.
 */

import type { GdtToleranceSpecification, ToleranceChainSpec, ToleranceStackResult } from "../../interop/gdt_schema.js";
import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export class ToleranceStackOracle implements TheoryOracle {
  public readonly name = "ToleranceStackOracle";
  public readonly domain = "spatial_physics" as const;

  private toleranceSpecs = new Map<string, GdtToleranceSpecification>();
  private chains = new Map<string, ToleranceChainSpec>();
  private clearanceConstraints = new Map<string, { min: number; max: number }>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();

  private levelStack: {
    specs: Map<string, GdtToleranceSpecification>;
    chains: Map<string, ToleranceChainSpec>;
    constraints: Map<string, { min: number; max: number }>;
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.toleranceSpecs.clear();
    this.chains.clear();
    this.clearanceConstraints.clear();
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      specs: new Map(this.toleranceSpecs),
      chains: new Map(this.chains),
      constraints: new Map(this.clearanceConstraints),
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.toleranceSpecs = top.specs;
    this.chains = top.chains;
    this.clearanceConstraints = top.constraints;
    for (const litId of top.assertedLitIds) {
      this.assertedLiterals.delete(litId);
    }
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1].assertedLitIds.push(lit.id);
    }

    if (lit.predicate === "gdtTolerance") {
      const spec = lit.args[0] as GdtToleranceSpecification;
      if (spec && spec.id) {
        this.toleranceSpecs.set(spec.id, spec);
        return true;
      }
    } else if (lit.predicate === "toleranceChain") {
      const chain = lit.args[0] as ToleranceChainSpec;
      if (chain && chain.chainId) {
        this.chains.set(chain.chainId, chain);
        return true;
      }
    } else if (lit.predicate === "clearanceConstraint") {
      const chainId = String(lit.args[0]);
      const min = Number(lit.args[1]);
      const max = Number(lit.args[2]);
      if (!isNaN(min) && !isNaN(max)) {
        this.clearanceConstraints.set(chainId, { min, max });
        return true;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    const lit = this.assertedLiterals.get(litId);
    if (!lit) return;
    this.assertedLiterals.delete(litId);

    if (lit.predicate === "gdtTolerance") {
      const spec = lit.args[0] as GdtToleranceSpecification;
      if (spec?.id) this.toleranceSpecs.delete(spec.id);
    } else if (lit.predicate === "toleranceChain") {
      const chain = lit.args[0] as ToleranceChainSpec;
      if (chain?.chainId) this.chains.delete(chain.chainId);
    } else if (lit.predicate === "clearanceConstraint") {
      const chainId = String(lit.args[0]);
      this.clearanceConstraints.delete(chainId);
    }
  }

  public calculateChain(chain: ToleranceChainSpec): ToleranceStackResult {
    let nominalClearance = 0;
    const method = chain.method || "worst_case";

    for (const c of chain.contributors) {
      nominalClearance += c.direction * c.nominal;
    }

    let variation = 0;
    const varianceItems: { partId: string; featureName: string; tolerance: number; contributionWeight: number }[] = [];

    if (method === "worst_case") {
      for (const c of chain.contributors) {
        const tol = Math.abs(c.tolerance);
        variation += tol;
        varianceItems.push({
          partId: c.partId,
          featureName: c.featureName,
          tolerance: tol,
          contributionWeight: tol,
        });
      }
    } else if (method === "rss") {
      let sumSquares = 0;
      for (const c of chain.contributors) {
        const tolSq = c.tolerance * c.tolerance;
        sumSquares += tolSq;
        varianceItems.push({
          partId: c.partId,
          featureName: c.featureName,
          tolerance: Math.abs(c.tolerance),
          contributionWeight: tolSq,
        });
      }
      variation = Math.sqrt(sumSquares);
    } else if (method === "six_sigma") {
      let sumVar = 0;
      for (const c of chain.contributors) {
        const cpk = c.cpk || 1.33;
        const sigma = Math.abs(c.tolerance) / (3 * cpk);
        const varSq = sigma * sigma;
        sumVar += varSq;
        varianceItems.push({
          partId: c.partId,
          featureName: c.featureName,
          tolerance: Math.abs(c.tolerance),
          contributionWeight: varSq,
        });
      }
      variation = 3 * Math.sqrt(sumVar);
    }

    nominalClearance = parseFloat(nominalClearance.toFixed(6));
    variation = parseFloat(variation.toFixed(6));
    const minClearance = parseFloat((nominalClearance - variation).toFixed(6));
    const maxClearance = parseFloat((nominalClearance + variation).toFixed(6));

    const totalWeight = varianceItems.reduce((acc, v) => acc + v.contributionWeight, 0) || 1;
    const topContributors = varianceItems
      .map((item) => ({
        partId: item.partId,
        featureName: item.featureName,
        tolerance: item.tolerance,
        percentContribution: (item.contributionWeight / totalWeight) * 100,
      }))
      .sort((a, b) => b.percentContribution - a.percentContribution);

    const override = this.clearanceConstraints.get(chain.chainId);
    const targetMin = override ? override.min : chain.targetClearance.min;
    const targetMax = override ? override.max : chain.targetClearance.max;

    let isSatisfied = true;
    let violation: "interference" | "excessive_play" | undefined;

    if (minClearance < targetMin) {
      isSatisfied = false;
      violation = "interference";
    } else if (maxClearance > targetMax) {
      isSatisfied = false;
      violation = "excessive_play";
    }

    return {
      chainId: chain.chainId,
      nominalClearance,
      variation,
      minClearance,
      maxClearance,
      isSatisfied,
      violation,
      method,
      topContributors,
    };
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    for (const [chainId, chain] of this.chains.entries()) {
      const res = this.calculateChain(chain);
      if (!res.isSatisfied) {
        const top = res.topContributors[0] || { partId: "unknown", featureName: "", percentContribution: 0 };
        const override = this.clearanceConstraints.get(chainId);
        const targetMin = override ? override.min : chain.targetClearance.min;
        const targetMax = override ? override.max : chain.targetClearance.max;

        let explanation = "";
        if (res.violation === "interference") {
          explanation = `Tolerance Stack Interference: Chain '${chainId}' (${res.method}) min clearance ${res.minClearance.toFixed(
            4,
          )} mm breaches required minimum ${targetMin.toFixed(
            4,
          )} mm. Risk of mechanical seizure. Primary contributor: Part '${top.partId}' (${
            top.featureName
          }) contributing ${top.percentContribution.toFixed(1)}% of total variance.`;
        } else {
          explanation = `Tolerance Stack Excessive Play: Chain '${chainId}' (${res.method}) max clearance ${res.maxClearance.toFixed(
            4,
          )} mm exceeds allowed maximum ${targetMax.toFixed(
            4,
          )} mm. Risk of leakage or acoustic vibration. Primary contributor: Part '${top.partId}' (${
            top.featureName
          }) contributing ${top.percentContribution.toFixed(1)}% of total variance.`;
        }

        const conflictLits = Array.from(this.assertedLiterals.values()).filter(
          (l) =>
            (l.predicate === "toleranceChain" && (l.args[0] as ToleranceChainSpec)?.chainId === chainId) ||
            (l.predicate === "clearanceConstraint" && String(l.args[0]) === chainId),
        );

        return {
          isSat: false,
          conflict: {
            literals: conflictLits,
            explanation,
            culpritEntities: [top.partId, chainId],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];

    for (const [chainId, chain] of this.chains.entries()) {
      const res = this.calculateChain(chain);
      const varKey = `clearance_${chainId}`;
      if (!this.propagatedEqualities.has(varKey)) {
        this.propagatedEqualities.add(varKey);
        equalities.push({
          varA: varKey,
          varB: varKey,
          domain: "interval",
          bounds: [res.minClearance, res.maxClearance],
          explanation: `GD&T Tolerance Stack ${res.method}: nominal ${res.nominalClearance.toFixed(
            4,
          )} ± ${res.variation.toFixed(4)} mm`,
          sourceOracle: this.name,
        });
      }
    }

    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (eq.domain === "interval" && eq.bounds && eq.varA.startsWith("clearance_")) {
      const chainId = eq.varA.replace(/^clearance_/, "");
      if (this.chains.has(chainId)) {
        const [sharedMin, sharedMax] = eq.bounds;
        const current = this.clearanceConstraints.get(chainId) || this.chains.get(chainId)!.targetClearance;
        const tightenedMin = Math.max(current.min, sharedMin);
        const tightenedMax = Math.min(current.max, sharedMax);
        this.clearanceConstraints.set(chainId, { min: tightenedMin, max: tightenedMax });
      }
    }
  }

  public getModel(): Record<string, any> {
    const model: Record<string, any> = {};
    for (const [chainId, chain] of this.chains.entries()) {
      model[chainId] = this.calculateChain(chain);
    }
    return model;
  }
}
