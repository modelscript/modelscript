// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Uncertainty Quantification (UQ) & Stochastic Theory Oracle.
 *
 * Evaluates probabilistic requirements over manufacturing tolerances and parameter variations:
 *   assert constraint { p(fuelConsumption > 45.0) <= 0.001 }
 * Uses analytical CDF and WasmMonteCarloEngine sampling to detect stochastic safety margin violations.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export type DistributionSpec =
  | { kind: "normal"; mean: number; stdDev: number }
  | { kind: "uniform"; min: number; max: number };

export interface ProbabilisticRequirement {
  varName: string;
  op: ">" | ">=" | "<" | "<=";
  threshold: number;
  maxProbability: number;
}

function erfc(x: number): number {
  // Abramowitz & Stegun approximation (formula 7.1.26)
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return x >= 0 ? 1.0 - y : 1.0 + y;
}

function normalCdf(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return x >= mean ? 1.0 : 0.0;
  return 0.5 * erfc(-(x - mean) / (stdDev * Math.SQRT2));
}

export class UqTheoryOracle implements TheoryOracle {
  public readonly name = "UqTheoryOracle";
  public readonly domain = "dynamic_simulation" as const;

  private distributions = new Map<string, DistributionSpec>();
  private requirements: ProbabilisticRequirement[] = [];
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private baseDistributions = new Map<string, DistributionSpec>();
  private levelStack: {
    distributions: Map<string, DistributionSpec>;
    requirements: ProbabilisticRequirement[];
    sharedEqualities: SharedEquality[];
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.distributions.clear();
    this.baseDistributions.clear();
    this.requirements = [];
    this.sharedEqualities = [];
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      distributions: new Map(this.distributions),
      requirements: [...this.requirements],
      sharedEqualities: [...this.sharedEqualities],
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.distributions = top.distributions;
    this.requirements = top.requirements;
    this.sharedEqualities = top.sharedEqualities;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  public setDistribution(varName: string, dist: DistributionSpec): void {
    this.baseDistributions.set(varName, dist);
    this.distributions.set(varName, dist);
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }
    const { predicate, args } = lit;

    switch (predicate) {
      case "distribution": {
        const [varName, kind] = args as [string, "normal" | "uniform"];
        if (kind === "normal") {
          const [, , mean, stdDev] = args as [string, string, number, number];
          this.distributions.set(varName, { kind: "normal", mean, stdDev });
        } else if (kind === "uniform") {
          const [, , min, max] = args as [string, string, number, number];
          this.distributions.set(varName, { kind: "uniform", min, max });
        }
        break;
      }
      case "probBound": {
        const [varName, op, threshold, maxProbability] = args as [string, ">" | ">=" | "<" | "<=", number, number];
        this.requirements.push({ varName, op, threshold, maxProbability });
        break;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const savedStack = this.levelStack;
    const savedBase = new Map(this.baseDistributions);
    const remaining = Array.from(this.assertedLiterals.values());
    const remainingSharedEqs = this.sharedEqualities.filter((eq) => {
      const justs = eq.justifications ?? eq.justification ?? [];
      return !justs.includes(litId);
    });
    this.reset();
    this.levelStack = savedStack;
    for (const [k, v] of savedBase) {
      this.setDistribution(k, v);
    }
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of remainingSharedEqs) {
      this.onSharedEquality(eq);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    // Ensure aliased variables share distributions regardless of assertion order
    for (const eq of this.sharedEqualities) {
      if (!eq.varA || !eq.varB || eq.varA === eq.varB) continue;
      const distA = this.distributions.get(eq.varA);
      const distB = this.distributions.get(eq.varB);
      if (distA && !distB) {
        this.distributions.set(eq.varB, distA);
      } else if (distB && !distA) {
        this.distributions.set(eq.varA, distB);
      }
    }

    // Validate distribution parameters
    for (const [varName, dist] of this.distributions.entries()) {
      if (dist.kind === "normal" && dist.stdDev < 0) {
        const culprits = Array.from(this.assertedLiterals.values()).filter((l) => l.args.includes(varName));
        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Uncertainty Quantification (UQ) Conflict: Normal distribution for '${varName}' has negative stdDev (${dist.stdDev}).`,
            culpritEntities: [varName],
            theoryName: this.name,
          },
        };
      }
      if (dist.kind === "uniform" && dist.min > dist.max) {
        const culprits = Array.from(this.assertedLiterals.values()).filter((l) => l.args.includes(varName));
        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Uncertainty Quantification (UQ) Conflict: Uniform distribution for '${varName}' has inverted bounds [${dist.min}, ${dist.max}].`,
            culpritEntities: [varName],
            theoryName: this.name,
          },
        };
      }
    }

    for (const req of this.requirements) {
      const dist = this.distributions.get(req.varName);
      if (!dist) continue;

      let violationProb = 0;

      if (dist.kind === "normal") {
        if (dist.stdDev === 0) {
          if (req.op === ">") violationProb = dist.mean > req.threshold ? 1.0 : 0.0;
          else if (req.op === ">=") violationProb = dist.mean >= req.threshold ? 1.0 : 0.0;
          else if (req.op === "<") violationProb = dist.mean < req.threshold ? 1.0 : 0.0;
          else violationProb = dist.mean <= req.threshold ? 1.0 : 0.0;
        } else if (req.op === ">" || req.op === ">=") {
          // P(X > threshold) = 1 - CDF(threshold)
          violationProb = 1.0 - normalCdf(req.threshold, dist.mean, dist.stdDev);
        } else {
          // P(X < threshold) = CDF(threshold)
          violationProb = normalCdf(req.threshold, dist.mean, dist.stdDev);
        }
      } else if (dist.kind === "uniform") {
        if (dist.min === dist.max) {
          if (req.op === ">") violationProb = dist.min > req.threshold ? 1.0 : 0.0;
          else if (req.op === ">=") violationProb = dist.min >= req.threshold ? 1.0 : 0.0;
          else if (req.op === "<") violationProb = dist.min < req.threshold ? 1.0 : 0.0;
          else violationProb = dist.min <= req.threshold ? 1.0 : 0.0;
        } else if (req.op === ">" || req.op === ">=") {
          if (req.threshold <= dist.min) violationProb = 1.0;
          else if (req.threshold >= dist.max) violationProb = 0.0;
          else violationProb = (dist.max - req.threshold) / (dist.max - dist.min);
        } else {
          if (req.threshold <= dist.min) violationProb = 0.0;
          else if (req.threshold >= dist.max) violationProb = 1.0;
          else violationProb = (req.threshold - dist.min) / (dist.max - dist.min);
        }
      }

      if (violationProb > req.maxProbability + 1e-9) {
        const culprits = Array.from(this.assertedLiterals.values()).filter((l) => l.args.includes(req.varName));
        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Uncertainty Quantification (UQ) Conflict: Probability of '${req.varName} ${req.op} ${req.threshold}' is ${(violationProb * 100).toFixed(3)}%, which breaches the safety requirement margin of <= ${(req.maxProbability * 100).toFixed(3)}%.`,
            culpritEntities: [req.varName],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    return [];
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
    // Merge distribution bounds if aliased
    const distA = this.distributions.get(eq.varA);
    const distB = this.distributions.get(eq.varB);
    if (distA && !distB) {
      this.distributions.set(eq.varB, distA);
    } else if (distB && !distA) {
      this.distributions.set(eq.varA, distB);
    }
  }
}
