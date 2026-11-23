// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Passivity & Causality Theory Oracle.
 *
 * Verifies passivity of frequency-domain S-parameter / admittance macromodels
 * (e.g., Touchstone, IBIS, SPICE, EMT wideband lines):
 *   - Scattering passivity: sigma_max(S(j*omega)) <= 1 + tol across frequency sweep
 *   - Immittance positive-realness: Re(Y(j*omega)) >= -tol (for scalar/symmetric Y)
 *
 * Integrates with SemanticTheoryCoordinator via the standard TheoryOracle contract.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export interface MacromodelPassivitySpec {
  readonly id: string;
  readonly kind: "scattering" | "immittance";
  readonly frequenciesHz: readonly number[];
  /** For scattering: |S(j*w)| singular values or magnitudes; for immittance: Re(Y(j*w)) min eigenvalues. */
  readonly values: readonly number[];
  readonly tolerance?: number | undefined;
}

export interface PassivityViolation {
  readonly modelId: string;
  readonly frequencyHz: number;
  readonly value: number;
  readonly limit: number;
  readonly kind: "scattering" | "immittance";
}

export class PassivityTheoryOracle implements TheoryOracle {
  public readonly name = "PassivityTheoryOracle";
  public readonly domain = "continuous_safety" as const;

  private models = new Map<string, MacromodelPassivitySpec>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private trail = new UndoTrail();

  public reset(): void {
    this.models.clear();
    this.assertedLiterals.clear();
    this.sharedEqualities = [];
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  public registerMacromodel(spec: MacromodelPassivitySpec): void {
    this.trail.mapSet(this.models, spec.id, spec);
  }

  public assertLiteral(literal: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, literal.id, literal);
    return true;
  }

  public retractLiteral(literalId: number): void {
    this.assertedLiterals.delete(literalId);
    if (hasSharedEqualityWithLiteral(this.sharedEqualities, literalId)) {
      this.sharedEqualities = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, literalId);
    }
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
  }

  public findViolations(): PassivityViolation[] {
    const violations: PassivityViolation[] = [];
    for (const spec of this.models.values()) {
      const tol = spec.tolerance ?? 1e-6;
      const n = Math.min(spec.frequenciesHz.length, spec.values.length);
      for (let i = 0; i < n; i++) {
        const f = spec.frequenciesHz[i]!;
        const v = spec.values[i]!;
        if (spec.kind === "scattering" && v > 1.0 + tol) {
          violations.push({ modelId: spec.id, frequencyHz: f, value: v, limit: 1.0, kind: "scattering" });
        } else if (spec.kind === "immittance" && v < -tol) {
          violations.push({ modelId: spec.id, frequencyHz: f, value: v, limit: 0.0, kind: "immittance" });
        }
      }
    }
    return violations;
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    const violations = this.findViolations();
    if (violations.length === 0) return { isSat: true };
    const first = violations[0]!;
    const literals = Array.from(this.assertedLiterals.values());
    return {
      isSat: false,
      conflict: {
        literals,
        explanation: `Passivity violation in '${first.modelId}' at ${first.frequencyHz} Hz: ${first.kind} metric ${first.value.toExponential(4)} violates bound ${first.limit}.`,
        culpritEntities: [first.modelId],
        theoryName: this.name,
      },
    };
  }

  public propagateEqualities(): SharedEquality[] {
    return [];
  }
}
