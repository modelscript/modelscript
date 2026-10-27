// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Marine Mooring & Hydrodynamics Theory Oracle.
 *
 * Implements a First-Order Logic (FOL) decision procedure for the Generalized
 * Nelson-Oppen SemanticTheoryCoordinator. Verifies:
 *   1. DNV-OS-E301 (Position Mooring) & DNV-ST-0119 (Floating Wind) safety factors:
 *      - Intact condition safety factor (SF >= 1.67 for Class 2, SF >= 1.50 for Class 1).
 *      - Damaged / single-line-broken condition (SF >= 1.25 for Class 2, SF >= 1.10 for Class 1).
 *   2. Line tension allowable limits (T_actual <= MBL / SF_req).
 *   3. Anchor uplift angle criteria (theta_anchor <= 0 deg for drag-embedment anchors).
 *   4. Floating platform horizontal/vertical excursion envelope (Offset <= MaxOffset).
 *
 * Participates in Nelson-Oppen equality exchange and multi-domain requirement entailment.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export interface MooringLineSpec {
  lineId: string;
  lineName?: string | undefined;
  mbl: number; // Minimum Breaking Load (N)
  tensionIntact: number; // Maximum fairlead tension intact (N)
  safetyFactorIntact: number; // SF = MBL / tensionIntact
  passedIntact: boolean; // SF >= reqSfIntact
  tensionDamaged?: number | undefined;
  safetyFactorDamaged?: number | undefined;
  passedDamaged?: boolean | undefined;
  anchorUpliftDeg?: number | undefined;
  anchorUpliftPassed?: boolean | undefined;
  consequenceClass?: 1 | 2 | undefined;
}

export interface FloaterExcursionSpec {
  floaterId: string;
  actualOffsetMeters: number;
  maxAllowableOffsetMeters: number;
  heaveMeters?: number | undefined;
  pitchDeg?: number | undefined;
  rollDeg?: number | undefined;
}

export class MarineMooringTheoryOracle implements TheoryOracle {
  public readonly name = "MarineMooringTheoryOracle";
  public readonly domain = "spatial_physics" as const;

  private lines = new Map<string, MooringLineSpec>();
  private floaters = new Map<string, FloaterExcursionSpec>();
  private externalBounds = new Map<string, [number, number]>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private nextLitId = 50000;

  private sharedEqualities: SharedEquality[] = [];

  private levelStack: {
    lines: Map<string, MooringLineSpec>;
    floaters: Map<string, FloaterExcursionSpec>;
    externalBounds: Map<string, [number, number]>;
    sharedEqualities: SharedEquality[];
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.lines.clear();
    this.floaters.clear();
    this.externalBounds.clear();
    this.sharedEqualities = [];
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      lines: new Map(this.lines),
      floaters: new Map(this.floaters),
      externalBounds: new Map(this.externalBounds),
      sharedEqualities: [...this.sharedEqualities],
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.lines = top.lines;
    this.floaters = top.floaters;
    this.externalBounds = top.externalBounds;
    this.sharedEqualities = top.sharedEqualities;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  // --- Strongly typed domain ingestion APIs ---

  /**
   * Asserts a mooring line result into the oracle.
   */
  public assertMooringLine(spec: MooringLineSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "mooringLine",
      args: [spec],
      domain: this.domain,
    });
  }

  /**
   * Asserts floating platform excursion/motion envelope.
   */
  public assertFloaterExcursion(spec: FloaterExcursionSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "floaterExcursion",
      args: [spec],
      domain: this.domain,
    });
  }

  /**
   * Bulk-ingests a DNV verification report from @modelscript/sima or equivalent.
   */
  public ingestDnvReport(
    report: {
      standard?: string;
      summary?: { minSafetyFactor?: number; allPassed?: boolean };
      lines?: {
        lineId: string;
        lineName?: string;
        mbl: number;
        tensionIntact: number;
        safetyFactorIntact: number;
        passedIntact: boolean;
        tensionDamaged?: number;
        safetyFactorDamaged?: number;
        passedDamaged?: boolean;
        anchorUpliftDeg?: number;
        anchorUpliftPassed?: boolean;
      }[];
    },
    consequenceClass: 1 | 2 = 2,
  ): void {
    if (report.lines) {
      for (const l of report.lines) {
        this.assertMooringLine({
          lineId: l.lineId,
          lineName: l.lineName,
          mbl: l.mbl,
          tensionIntact: l.tensionIntact,
          safetyFactorIntact: l.safetyFactorIntact,
          passedIntact: l.passedIntact,
          tensionDamaged: l.tensionDamaged,
          safetyFactorDamaged: l.safetyFactorDamaged,
          passedDamaged: l.passedDamaged,
          anchorUpliftDeg: l.anchorUpliftDeg,
          anchorUpliftPassed: l.anchorUpliftPassed,
          consequenceClass,
        });
      }
    }
  }

  // --- TheoryOracle implementation ---

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }

    const { predicate, args } = lit;
    if (predicate === "mooringLine") {
      const spec = args[0] as MooringLineSpec;
      if (spec) this.lines.set(spec.lineId, spec);
    } else if (predicate === "floaterExcursion") {
      const spec = args[0] as FloaterExcursionSpec;
      if (spec) this.floaters.set(spec.floaterId, spec);
    }
    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const savedStack = this.levelStack;
    const remaining = Array.from(this.assertedLiterals.values());
    const remainingSharedEqs = this.sharedEqualities.filter((eq) => {
      const justs = eq.justifications ?? eq.justification ?? [];
      return !justs.includes(litId);
    });
    this.reset();
    this.levelStack = savedStack;
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of remainingSharedEqs) {
      this.onSharedEquality(eq);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    // 1. Check Mooring Line Safety Factors and Tensions
    for (const [id, spec] of this.lines.entries()) {
      const reqSf = spec.consequenceClass === 1 ? 1.5 : 1.67;
      if (!spec.passedIntact || spec.safetyFactorIntact < reqSf) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.lineId === spec.lineId),
            ),
            explanation: `DNV-OS-E301 Mooring Compliance Failure: Line '${spec.lineName || id}' intact safety factor ${spec.safetyFactorIntact.toFixed(2)} is below required minimum ${reqSf} (Tension = ${(spec.tensionIntact / 1e3).toFixed(1)} kN, MBL = ${(spec.mbl / 1e3).toFixed(1)} kN).`,
            culpritEntities: [id, spec.lineName || `Line#${id}`],
            theoryName: this.name,
          },
        };
      }

      const reqSfDamaged = spec.consequenceClass === 1 ? 1.1 : 1.25;
      if (
        spec.passedDamaged === false ||
        (spec.safetyFactorDamaged !== undefined && spec.safetyFactorDamaged < reqSfDamaged)
      ) {
        const sfDmgStr = spec.safetyFactorDamaged !== undefined ? spec.safetyFactorDamaged.toFixed(2) : "N/A";
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.lineId === spec.lineId),
            ),
            explanation: `DNV-OS-E301 Damaged Line Failure: Line '${spec.lineName || id}' single-line-broken safety factor ${sfDmgStr} is below required ${reqSfDamaged}.`,
            culpritEntities: [id, spec.lineName || `Line#${id}`],
            theoryName: this.name,
          },
        };
      }

      if (spec.anchorUpliftPassed === false || (spec.anchorUpliftDeg !== undefined && spec.anchorUpliftDeg > 0.05)) {
        const upliftStr = spec.anchorUpliftDeg !== undefined ? spec.anchorUpliftDeg.toFixed(2) : "non-zero";
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.lineId === spec.lineId),
            ),
            explanation: `DNV Mooring Anchor Uplift Failure: Line '${spec.lineName || id}' exhibits vertical anchor uplift angle of ${upliftStr} deg (must be 0.0 deg for drag-embedment anchors).`,
            culpritEntities: [id, spec.lineName || `Line#${id}`],
            theoryName: this.name,
          },
        };
      }

      // Check external bounds from Nelson-Oppen (e.g. from ReqIF requirement)
      const sfVars = [`mooring.safety_factor.${id}`, `mooring.safety_factor`, "mooring_safety_factor", "safety_factor"];
      for (const sv of sfVars) {
        const ext = this.externalBounds.get(sv);
        if (ext) {
          const [lo] = ext;
          if (spec.safetyFactorIntact < lo - 1e-4) {
            return {
              isSat: false,
              conflict: {
                literals: Array.from(this.assertedLiterals.values()).filter((l) =>
                  l.args.some((a) => a?.lineId === spec.lineId),
                ),
                explanation: `Nelson-Oppen Mooring Requirement Conflict: Line '${spec.lineName || id}' safety factor ${spec.safetyFactorIntact.toFixed(2)} breaches requirement bound >= ${lo}.`,
                culpritEntities: [id, sv],
                theoryName: this.name,
              },
            };
          }
        }
      }

      const tensionVars = [`mooring.tension.${id}`, `mooring.tension`, "line_tension_n", "line_tension"];
      for (const tv of tensionVars) {
        const ext = this.externalBounds.get(tv);
        if (ext) {
          const [, hi] = ext;
          if (spec.tensionIntact > hi + 1e-4) {
            return {
              isSat: false,
              conflict: {
                literals: Array.from(this.assertedLiterals.values()).filter((l) =>
                  l.args.some((a) => a?.lineId === spec.lineId),
                ),
                explanation: `Nelson-Oppen Mooring Tension Conflict: Line '${spec.lineName || id}' tension ${spec.tensionIntact.toFixed(0)} N exceeds allowable bound <= ${hi} N.`,
                culpritEntities: [id, tv],
                theoryName: this.name,
              },
            };
          }
        }
      }
    }

    // 2. Check Floating Platform Excursions
    for (const [id, spec] of this.floaters.entries()) {
      if (spec.actualOffsetMeters > spec.maxAllowableOffsetMeters) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.floaterId === spec.floaterId),
            ),
            explanation: `Marine Hydrodynamics Envelope Violation: Floater '${id}' offset ${spec.actualOffsetMeters.toFixed(2)} m exceeds allowable excursion limit ${spec.maxAllowableOffsetMeters.toFixed(2)} m.`,
            culpritEntities: [id, `Floater#${id}`],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const eqs: SharedEquality[] = [];
    const allLitIds = Array.from(this.assertedLiterals.keys());

    let minSf = Infinity;
    let maxTension = -Infinity;

    for (const [id, spec] of this.lines.entries()) {
      if (spec.safetyFactorIntact < minSf) minSf = spec.safetyFactorIntact;
      if (spec.tensionIntact > maxTension) maxTension = spec.tensionIntact;
      const lineJusts = Array.from(this.assertedLiterals.values())
        .filter((l) => l.args.some((a) => a?.lineId === spec.lineId))
        .map((l) => l.id);

      const sfVar = `mooring.safety_factor.${id}`;
      eqs.push({
        varA: sfVar,
        varB: sfVar,
        domain: "real",
        bounds: [spec.safetyFactorIntact, spec.safetyFactorIntact],
        explanation: `Mooring line ${id} intact safety factor is ${spec.safetyFactorIntact}`,
        sourceOracle: this.name,
        justifications: lineJusts,
        justification: lineJusts,
      });

      const tensionVar = `mooring.tension.${id}`;
      eqs.push({
        varA: tensionVar,
        varB: tensionVar,
        domain: "real",
        bounds: [spec.tensionIntact, spec.tensionIntact],
        explanation: `Mooring line ${id} intact tension is ${spec.tensionIntact} N`,
        sourceOracle: this.name,
        justifications: lineJusts,
        justification: lineJusts,
      });
    }

    if (this.lines.size > 0 && minSf !== Infinity) {
      eqs.push({
        varA: "mooring.min_sf",
        varB: "mooring.min_sf",
        domain: "real",
        bounds: [minSf, minSf],
        explanation: `Critical minimum mooring line safety factor is ${minSf}`,
        sourceOracle: this.name,
        justifications: allLitIds,
        justification: allLitIds,
      });
      eqs.push({
        varA: "mooring.max_tension",
        varB: "mooring.max_tension",
        domain: "real",
        bounds: [maxTension, maxTension],
        explanation: `Maximum fairlead line tension is ${maxTension} N`,
        sourceOracle: this.name,
        justifications: allLitIds,
        justification: allLitIds,
      });
    }

    for (const [id, spec] of this.floaters.entries()) {
      const floaterJusts = Array.from(this.assertedLiterals.values())
        .filter((l) => l.args.some((a) => a?.floaterId === spec.floaterId))
        .map((l) => l.id);
      const offsetVar = `floater.offset.${id}`;
      eqs.push({
        varA: offsetVar,
        varB: offsetVar,
        domain: "real",
        bounds: [spec.actualOffsetMeters, spec.actualOffsetMeters],
        explanation: `Floater ${id} offset excursion is ${spec.actualOffsetMeters} m`,
        sourceOracle: this.name,
        justifications: floaterJusts,
        justification: floaterJusts,
      });
    }

    return eqs;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (!eq.varA) return;
    this.sharedEqualities.push(eq);

    if (eq.bounds) {
      const intersect = (varName: string, b: [number, number]) => {
        const prev = this.externalBounds.get(varName);
        if (prev) {
          this.externalBounds.set(varName, [Math.max(prev[0], b[0]), Math.min(prev[1], b[1])]);
        } else {
          this.externalBounds.set(varName, [b[0], b[1]]);
        }
      };
      intersect(eq.varA, eq.bounds);
      if (eq.varB && eq.varB !== eq.varA && isNaN(Number(eq.varB))) {
        intersect(eq.varB, eq.bounds);
      }
    }
  }
}
