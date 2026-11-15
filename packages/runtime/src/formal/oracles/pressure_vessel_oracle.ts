// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — ASME BPVC Section VIII Pressure Vessel Theory Oracle.
 *
 * Implements a Nelson-Oppen / DPLL(T) formal theory oracle for pressure vessel
 * mechanical integrity and code compliance:
 *   - ASME BPVC Section VIII Div 1 UG-27: Cylindrical shells under internal pressure
 *     (circumferential and longitudinal stress formulas, joint efficiency E, corrosion allowance).
 *   - ASME BPVC Section VIII Div 1 UG-32: Formed heads under internal pressure
 *     (hemispherical UG-32(f), 2:1 ellipsoidal UG-32(d), torispherical F&D UG-32(e)).
 *   - ASME BPVC Section VIII Div 1 UG-99: Standard hydrostatic test pressure ratio & stress check.
 *   - ASME BPVC Section VIII Div 1 UG-125 / UG-134: Overpressure protection (set pressure & accumulation).
 *   - ASME BPVC Section VIII Div 2 Part 5.2: Elastic stress linearization limits (Pm, PL, PL+Pb, PL+Pb+Q).
 *
 * Integrates with {@link globalLibraryRegistry} so allowable stresses `S` can be resolved
 * dynamically from mounted standard-pack lookup tables or WASM calculators.
 */

import { globalLibraryRegistry } from "../../workspace/library-manifest.js";
import type {
  ConflictClause,
  SharedEquality,
  TheoryDomain,
  TheoryLiteral,
  TheoryOracle,
} from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";

export type VesselHeadType = "hemispherical" | "ellipsoidal" | "torispherical";

export interface Ug27CylinderCheckSpec {
  kind: "ug27_cylinder";
  checkId: string;
  vesselName?: string | undefined;
  /** Internal design pressure P (MPa or psi consistent with S). */
  P: number;
  /** Corroded or inside radius R (mm or in consistent with t). */
  R: number;
  /** Nominal wall thickness t (mm or in). */
  t: number;
  /** Allowable stress S at design temperature (if omitted, resolved via materialSpec + designTempF). */
  S?: number | undefined;
  /** Weld joint efficiency E in (0, 1] (default 1.0). */
  E?: number | undefined;
  /** Corrosion allowance CA deducted from t and added to R (default 0). */
  CA?: number | undefined;
  /** Circumferential vs longitudinal formula or both (default "both"). */
  direction?: "circumferential" | "longitudinal" | "both" | undefined;
  materialSpec?: string | undefined;
  designTempF?: number | undefined;
  calculatorName?: string | undefined;
  sysmlRequirementId?: string | undefined;
}

export interface Ug32HeadCheckSpec {
  kind: "ug32_head";
  checkId: string;
  vesselName?: string | undefined;
  headType: VesselHeadType;
  P: number;
  /** Inside diameter D (optional if R is given via cylindrical shell or L). */
  D: number;
  /** Nominal head thickness t. */
  t: number;
  S?: number | undefined;
  E?: number | undefined;
  CA?: number | undefined;
  /** Inside crown radius L (for torispherical/hemispherical). */
  L?: number | undefined;
  /** Inside knuckle radius r (for torispherical; defaults to 0.06 * L). */
  r?: number | undefined;
  /** Ellipsoidal factor K (default 1.0 for 2:1 ellipsoidal head). */
  K?: number | undefined;
  /** Ellipsoidal minor depth h (used to compute K if provided). */
  h?: number | undefined;
  /** Torispherical M factor (optional; computed from L/r if provided). */
  M?: number | undefined;
  materialSpec?: string | undefined;
  designTempF?: number | undefined;
  calculatorName?: string | undefined;
  sysmlRequirementId?: string | undefined;
}

export interface Ug99HydrostaticCheckSpec {
  kind: "ug99_hydrostatic";
  checkId: string;
  vesselName?: string | undefined;
  mawp: number;
  testPressure: number;
  /** Hydrotest factor (1.3 for modern VIII-1, 1.5 for pre-1999). Default 1.3. */
  factor?: number | undefined;
  /** Allowable stress at test temperature S_test. */
  S_test?: number | undefined;
  /** Allowable stress at design temperature S_design. */
  S_design?: number | undefined;
  materialSpec?: string | undefined;
  designTempF?: number | undefined;
  testTempF?: number | undefined;
  calculatorName?: string | undefined;
  sysmlRequirementId?: string | undefined;
}

export interface Ug125ReliefCheckSpec {
  kind: "ug125_relief";
  checkId: string;
  vesselName?: string | undefined;
  mawp: number;
  setPressure: number;
  /** Peak relieving / accumulated pressure (if provided). */
  relievingPressure?: number | undefined;
  /** Accumulation contingency: "single" (1.10), "multiple" (1.16), or "fire" (1.21). Default "single". */
  contingency?: "single" | "multiple" | "fire" | undefined;
  /** Custom accumulation factor overriding contingency table. */
  accumulationFactor?: number | undefined;
  requiredCapacity?: number | undefined;
  ratedCapacity?: number | undefined;
  sysmlRequirementId?: string | undefined;
}

export interface Viii2StressLinearizationSpec {
  kind: "viii2_stress_linearization";
  checkId: string;
  vesselName?: string | undefined;
  /** General primary membrane stress intensity Pm. */
  Pm: number;
  /** Local primary membrane stress intensity PL (defaults to Pm if omitted). */
  PL?: number | undefined;
  /** Primary bending stress intensity Pb (default 0). */
  Pb?: number | undefined;
  /** Secondary membrane + bending stress intensity Q (optional). */
  Q?: number | undefined;
  /** Allowable stress intensity S (or resolved via materialSpec + designTempF). */
  S?: number | undefined;
  /** Yield strength Sy at design temperature (used for 3S vs 2Sy primary+secondary check). */
  Sy?: number | undefined;
  materialSpec?: string | undefined;
  designTempF?: number | undefined;
  calculatorName?: string | undefined;
  sysmlRequirementId?: string | undefined;
}

export type PressureVesselCheckSpec =
  | Ug27CylinderCheckSpec
  | Ug32HeadCheckSpec
  | Ug99HydrostaticCheckSpec
  | Ug125ReliefCheckSpec
  | Viii2StressLinearizationSpec;

export interface PressureVesselCheckResult {
  checkId: string;
  clauseId: string;
  standard: string;
  vesselName: string;
  isSatisfied: boolean;
  actualValue: number;
  requiredLimit: number;
  margin: number;
  allowableStress?: number | undefined;
  explanation: string;
}

const ACCUMULATION_FACTORS: Record<"single" | "multiple" | "fire", number> = {
  single: 1.1,
  multiple: 1.16,
  fire: 1.21,
};

function resolveAllowableStress(params: {
  explicitS?: number | undefined;
  materialSpec?: string | undefined;
  tempF?: number | undefined;
  calculatorName?: string | undefined;
}): number | undefined {
  if (params.explicitS !== undefined && Number.isFinite(params.explicitS)) {
    return params.explicitS;
  }
  if (params.materialSpec !== undefined && params.tempF !== undefined) {
    const calc = params.calculatorName ?? "AllowableStress";
    const lookedUp = globalLibraryRegistry.invokeCalculator(calc, [params.materialSpec, params.tempF]);
    if (typeof lookedUp === "number" && Number.isFinite(lookedUp)) {
      return lookedUp;
    }
  }
  return undefined;
}

function intersectBoundMap(map: Map<string, [number, number]>, varName: string, bounds: [number, number]): void {
  const prev = map.get(varName);
  if (prev) {
    map.set(varName, [Math.max(prev[0], bounds[0]), Math.min(prev[1], bounds[1])]);
  } else {
    map.set(varName, [bounds[0], bounds[1]]);
  }
}

export class PressureVesselOracle implements TheoryOracle {
  public readonly name = "PressureVesselOracle";
  public readonly domain: TheoryDomain = "spatial_physics";

  private checks = new Map<string, PressureVesselCheckSpec>();
  private externalBounds = new Map<string, [number, number]>();
  private sharedEqualities: SharedEquality[] = [];
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private nextLiteralId = 60000;

  private levelStack: {
    checks: Map<string, PressureVesselCheckSpec>;
    externalBounds: Map<string, [number, number]>;
    sharedEqualities: SharedEquality[];
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.checks.clear();
    this.externalBounds.clear();
    this.sharedEqualities = [];
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      checks: new Map(this.checks),
      externalBounds: new Map(this.externalBounds),
      sharedEqualities: [...this.sharedEqualities],
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.checks = top.checks;
    this.externalBounds = top.externalBounds;
    this.sharedEqualities = top.sharedEqualities;
    for (const litId of top.assertedLitIds) {
      this.assertedLiterals.delete(litId);
    }
  }

  public assertCheck(spec: PressureVesselCheckSpec): number {
    const litId = this.nextLiteralId++;
    this.assertLiteral({
      id: litId,
      predicate: `pressureVessel:${spec.kind}`,
      args: [spec],
      domain: this.domain,
    });
    return litId;
  }

  public assertUg27Cylinder(spec: Omit<Ug27CylinderCheckSpec, "kind">): number {
    return this.assertCheck({ ...spec, kind: "ug27_cylinder" });
  }

  public assertUg32Head(spec: Omit<Ug32HeadCheckSpec, "kind">): number {
    return this.assertCheck({ ...spec, kind: "ug32_head" });
  }

  public assertUg99Hydrostatic(spec: Omit<Ug99HydrostaticCheckSpec, "kind">): number {
    return this.assertCheck({ ...spec, kind: "ug99_hydrostatic" });
  }

  public assertUg125Relief(spec: Omit<Ug125ReliefCheckSpec, "kind">): number {
    return this.assertCheck({ ...spec, kind: "ug125_relief" });
  }

  public assertViii2StressLinearization(spec: Omit<Viii2StressLinearizationSpec, "kind">): number {
    return this.assertCheck({ ...spec, kind: "viii2_stress_linearization" });
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }

    const arg0 = lit.args?.[0] as PressureVesselCheckSpec | undefined;
    if (arg0 && typeof arg0 === "object" && typeof arg0.checkId === "string" && typeof arg0.kind === "string") {
      this.checks.set(arg0.checkId, { ...arg0 });
    } else if (lit.predicate === "pressureVesselUG27" && arg0) {
      const spec = arg0 as Omit<Ug27CylinderCheckSpec, "kind">;
      this.checks.set(spec.checkId, { ...spec, kind: "ug27_cylinder" });
    } else if (lit.predicate === "pressureVesselUG32" && arg0) {
      const spec = arg0 as Omit<Ug32HeadCheckSpec, "kind">;
      this.checks.set(spec.checkId, { ...spec, kind: "ug32_head" });
    } else if (lit.predicate === "pressureVesselUG99" && arg0) {
      const spec = arg0 as Omit<Ug99HydrostaticCheckSpec, "kind">;
      this.checks.set(spec.checkId, { ...spec, kind: "ug99_hydrostatic" });
    } else if (lit.predicate === "pressureVesselUG125" && arg0) {
      const spec = arg0 as Omit<Ug125ReliefCheckSpec, "kind">;
      this.checks.set(spec.checkId, { ...spec, kind: "ug125_relief" });
    } else if (lit.predicate === "pressureVesselVIII2" && arg0) {
      const spec = arg0 as Omit<Viii2StressLinearizationSpec, "kind">;
      this.checks.set(spec.checkId, { ...spec, kind: "viii2_stress_linearization" });
    }
    return true;
  }

  public retractLiteral(litId: number): void {
    const hasShared = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    if (!this.assertedLiterals.has(litId) && !hasShared) return;
    this.assertedLiterals.delete(litId);
    const savedStack = this.levelStack;
    const remaining = Array.from(this.assertedLiterals.values());
    const remainingSharedEqs = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    this.reset();
    this.levelStack = savedStack;
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of remainingSharedEqs) {
      this.onSharedEquality(eq);
    }
  }

  private evaluateSpec(spec: PressureVesselCheckSpec): PressureVesselCheckResult {
    const vessel = spec.vesselName ?? spec.checkId;

    switch (spec.kind) {
      case "ug27_cylinder": {
        const E = spec.E ?? 1.0;
        const ca = spec.CA ?? 0;
        const S = resolveAllowableStress({
          explicitS: spec.S,
          materialSpec: spec.materialSpec,
          tempF: spec.designTempF,
          calculatorName: spec.calculatorName,
        });
        const R_eff = spec.R + ca;
        const t_eff = spec.t - ca;
        if (S === undefined || S <= 0 || E <= 0 || E > 1) {
          return {
            checkId: spec.checkId,
            clauseId: "UG-27",
            standard: "ASME BPVC VIII-1",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: t_eff,
            requiredLimit: Infinity,
            margin: -Infinity,
            allowableStress: S,
            explanation: `ASME BPVC VIII-1 UG-27 cannot evaluate '${vessel}': invalid or unresolved allowable stress S=${S} or weld efficiency E=${E}.`,
          };
        }

        const extP = this.getExternalValue(vessel, "P", spec.P);
        const circDenom = S * E - 0.6 * extP;
        const longDenom = 2 * S * E + 0.4 * extP;
        if (circDenom <= 0 || longDenom <= 0) {
          return {
            checkId: spec.checkId,
            clauseId: "UG-27(c)(1)",
            standard: "ASME BPVC VIII-1",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: extP,
            requiredLimit: (S * E) / 0.6,
            margin: (S * E) / 0.6 - extP,
            allowableStress: S,
            explanation: `ASME BPVC VIII-1 UG-27(c)(1) denominator non-positive for '${vessel}': S*E - 0.6*P = ${circDenom.toFixed(4)} <= 0 (thin-wall limit P <= 0.385*S*E exceeded).`,
          };
        }

        const tCirc = (extP * R_eff) / circDenom;
        const tLong = (extP * R_eff) / longDenom;
        const tReq =
          spec.direction === "longitudinal"
            ? tLong
            : spec.direction === "circumferential"
              ? tCirc
              : Math.max(tCirc, tLong);
        const clauseId = spec.direction === "longitudinal" ? "UG-27(c)(2)" : "UG-27(c)(1)";
        const margin = t_eff - tReq;
        const ok = margin >= -1e-9;
        return {
          checkId: spec.checkId,
          clauseId,
          standard: "ASME BPVC VIII-1",
          vesselName: vessel,
          isSatisfied: ok,
          actualValue: t_eff,
          requiredLimit: tReq,
          margin,
          allowableStress: S,
          explanation: ok
            ? `ASME BPVC VIII-1 ${clauseId} SATISFIED for '${vessel}': corroded t=${t_eff.toFixed(4)} >= t_req=${tReq.toFixed(4)} (S=${S.toFixed(2)}, margin=+${margin.toFixed(4)}).`
            : `ASME BPVC VIII-1 ${clauseId} VIOLATED for '${vessel}': corroded wall t=${t_eff.toFixed(4)} < t_req=${tReq.toFixed(4)} (S=${S.toFixed(2)}, deficit=${(-margin).toFixed(4)}).`,
        };
      }

      case "ug32_head": {
        const E = spec.E ?? 1.0;
        const ca = spec.CA ?? 0;
        const S = resolveAllowableStress({
          explicitS: spec.S,
          materialSpec: spec.materialSpec,
          tempF: spec.designTempF,
          calculatorName: spec.calculatorName,
        });
        const t_eff = spec.t - ca;
        const D_eff = spec.D + 2 * ca;
        if (S === undefined || S <= 0 || E <= 0 || E > 1) {
          return {
            checkId: spec.checkId,
            clauseId: "UG-32",
            standard: "ASME BPVC VIII-1",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: t_eff,
            requiredLimit: Infinity,
            margin: -Infinity,
            allowableStress: S,
            explanation: `ASME BPVC VIII-1 UG-32 cannot evaluate '${vessel}': invalid or unresolved S=${S} or E=${E}.`,
          };
        }

        const extP = this.getExternalValue(vessel, "P", spec.P);
        let tReq = 0;
        let clauseId = "UG-32";

        if (spec.headType === "hemispherical") {
          clauseId = "UG-32(f)";
          const L_eff = (spec.L ?? spec.D / 2) + ca;
          const denom = 2 * S * E - 0.2 * extP;
          tReq = denom > 0 ? (extP * L_eff) / denom : Infinity;
        } else if (spec.headType === "ellipsoidal") {
          clauseId = "UG-32(d)";
          const K =
            spec.K ?? (spec.h !== undefined && spec.h > 0 ? (2 + Math.pow(D_eff / (2 * (spec.h + ca)), 2)) / 6 : 1.0);
          const denom = 2 * S * E - 0.2 * extP;
          tReq = denom > 0 ? (extP * D_eff * K) / denom : Infinity;
        } else {
          clauseId = "UG-32(e)";
          const L_eff = (spec.L ?? spec.D) + ca;
          const r_eff = spec.r !== undefined ? spec.r + ca : undefined;
          const isStdFd = spec.M === undefined && (r_eff === undefined || Math.abs(r_eff / L_eff - 0.06) < 1e-3);
          if (isStdFd) {
            const denom = S * E - 0.1 * extP;
            tReq = denom > 0 ? (0.885 * extP * L_eff) / denom : Infinity;
          } else {
            const M = spec.M ?? 0.25 * (3 + Math.sqrt(L_eff / (r_eff ?? 0.06 * L_eff)));
            const denom = 2 * S * E - 0.2 * extP;
            tReq = denom > 0 ? (extP * L_eff * M) / denom : Infinity;
          }
        }

        const margin = t_eff - tReq;
        const ok = Number.isFinite(tReq) && margin >= -1e-9;
        return {
          checkId: spec.checkId,
          clauseId,
          standard: "ASME BPVC VIII-1",
          vesselName: vessel,
          isSatisfied: ok,
          actualValue: t_eff,
          requiredLimit: tReq,
          margin,
          allowableStress: S,
          explanation: ok
            ? `ASME BPVC VIII-1 ${clauseId} SATISFIED for ${spec.headType} head '${vessel}': t=${t_eff.toFixed(4)} >= t_req=${tReq.toFixed(4)}.`
            : `ASME BPVC VIII-1 ${clauseId} VIOLATED for ${spec.headType} head '${vessel}': t=${t_eff.toFixed(4)} < t_req=${Number.isFinite(tReq) ? tReq.toFixed(4) : "INF"}.`,
        };
      }

      case "ug99_hydrostatic": {
        const factor = spec.factor ?? 1.3;
        const S_design = resolveAllowableStress({
          explicitS: spec.S_design,
          materialSpec: spec.materialSpec,
          tempF: spec.designTempF,
          calculatorName: spec.calculatorName,
        });
        const S_test =
          resolveAllowableStress({
            explicitS: spec.S_test,
            materialSpec: spec.materialSpec,
            tempF: spec.testTempF ?? 100,
            calculatorName: spec.calculatorName,
          }) ?? S_design;
        const ratio =
          S_design !== undefined && S_test !== undefined && S_design > 0 ? Math.max(1.0, S_test / S_design) : 1.0;
        const pReq = factor * spec.mawp * ratio;
        const margin = spec.testPressure - pReq;
        const ok = margin >= -1e-9;
        return {
          checkId: spec.checkId,
          clauseId: "UG-99(b)",
          standard: "ASME BPVC VIII-1",
          vesselName: vessel,
          isSatisfied: ok,
          actualValue: spec.testPressure,
          requiredLimit: pReq,
          margin,
          allowableStress: S_design,
          explanation: ok
            ? `ASME BPVC VIII-1 UG-99(b) SATISFIED for '${vessel}': P_test=${spec.testPressure.toFixed(4)} >= ${factor}*MAWP*ratio=${pReq.toFixed(4)}.`
            : `ASME BPVC VIII-1 UG-99(b) VIOLATED for '${vessel}': P_test=${spec.testPressure.toFixed(4)} < minimum required ${pReq.toFixed(4)}.`,
        };
      }

      case "ug125_relief": {
        if (spec.setPressure > spec.mawp + 1e-9) {
          const margin = spec.mawp - spec.setPressure;
          return {
            checkId: spec.checkId,
            clauseId: "UG-134(a)",
            standard: "ASME BPVC VIII-1",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: spec.setPressure,
            requiredLimit: spec.mawp,
            margin,
            explanation: `ASME BPVC VIII-1 UG-134(a) VIOLATED for '${vessel}': PRV set pressure ${spec.setPressure.toFixed(4)} exceeds MAWP ${spec.mawp.toFixed(4)}.`,
          };
        }
        const factor = spec.accumulationFactor ?? ACCUMULATION_FACTORS[spec.contingency ?? "single"];
        const maxRelieving = factor * spec.mawp;
        if (spec.relievingPressure !== undefined && spec.relievingPressure > maxRelieving + 1e-9) {
          const margin = maxRelieving - spec.relievingPressure;
          return {
            checkId: spec.checkId,
            clauseId: "UG-125(c)",
            standard: "ASME BPVC VIII-1",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: spec.relievingPressure,
            requiredLimit: maxRelieving,
            margin,
            explanation: `ASME BPVC VIII-1 UG-125(c) VIOLATED for '${vessel}': relieving pressure ${spec.relievingPressure.toFixed(4)} exceeds ${(factor * 100).toFixed(0)}% MAWP limit ${maxRelieving.toFixed(4)}.`,
          };
        }
        if (
          spec.requiredCapacity !== undefined &&
          spec.ratedCapacity !== undefined &&
          spec.ratedCapacity + 1e-9 < spec.requiredCapacity
        ) {
          const margin = spec.ratedCapacity - spec.requiredCapacity;
          return {
            checkId: spec.checkId,
            clauseId: "UG-125(a)",
            standard: "ASME BPVC VIII-1",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: spec.ratedCapacity,
            requiredLimit: spec.requiredCapacity,
            margin,
            explanation: `ASME BPVC VIII-1 UG-125(a) VIOLATED for '${vessel}': PRV rated capacity ${spec.ratedCapacity} < required capacity ${spec.requiredCapacity}.`,
          };
        }
        const actualRelieving = spec.relievingPressure ?? spec.setPressure;
        return {
          checkId: spec.checkId,
          clauseId: "UG-125",
          standard: "ASME BPVC VIII-1",
          vesselName: vessel,
          isSatisfied: true,
          actualValue: actualRelieving,
          requiredLimit: maxRelieving,
          margin: maxRelieving - actualRelieving,
          explanation: `ASME BPVC VIII-1 UG-125 SATISFIED for '${vessel}': set=${spec.setPressure.toFixed(4)} <= MAWP=${spec.mawp.toFixed(4)}, peak=${actualRelieving.toFixed(4)} <= ${maxRelieving.toFixed(4)}.`,
        };
      }

      case "viii2_stress_linearization": {
        const S = resolveAllowableStress({
          explicitS: spec.S,
          materialSpec: spec.materialSpec,
          tempF: spec.designTempF,
          calculatorName: spec.calculatorName,
        });
        const pmExt = this.getExternalValue(vessel, "Pm", spec.Pm);
        const pl = spec.PL ?? pmExt;
        const pb = spec.Pb ?? 0;

        if (S === undefined || S <= 0) {
          return {
            checkId: spec.checkId,
            clauseId: "5.2.2.4",
            standard: "ASME BPVC VIII-2",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: pmExt,
            requiredLimit: 0,
            margin: -Infinity,
            allowableStress: S,
            explanation: `ASME BPVC VIII-2 Part 5.2 cannot evaluate '${vessel}': invalid or unresolved allowable stress S=${S}.`,
          };
        }

        if (pmExt > S + 1e-9) {
          return {
            checkId: spec.checkId,
            clauseId: "Table 5.6 (Pm)",
            standard: "ASME BPVC VIII-2",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: pmExt,
            requiredLimit: S,
            margin: S - pmExt,
            allowableStress: S,
            explanation: `ASME BPVC VIII-2 Table 5.6 VIOLATED for '${vessel}': general primary membrane stress Pm=${pmExt.toFixed(3)} > S=${S.toFixed(3)}.`,
          };
        }

        const plPb = pl + pb;
        const limit15S = 1.5 * S;
        if (pl > limit15S + 1e-9 || plPb > limit15S + 1e-9) {
          const governing = Math.max(pl, plPb);
          return {
            checkId: spec.checkId,
            clauseId: "Table 5.6 (PL + Pb)",
            standard: "ASME BPVC VIII-2",
            vesselName: vessel,
            isSatisfied: false,
            actualValue: governing,
            requiredLimit: limit15S,
            margin: limit15S - governing,
            allowableStress: S,
            explanation: `ASME BPVC VIII-2 Table 5.6 VIOLATED for '${vessel}': PL+Pb=${plPb.toFixed(3)} exceeds 1.5*S=${limit15S.toFixed(3)}.`,
          };
        }

        if (spec.Q !== undefined) {
          const sps = spec.Sy !== undefined ? Math.max(3 * S, 2 * spec.Sy) : 3 * S;
          const totalRange = pl + pb + spec.Q;
          if (totalRange > sps + 1e-9) {
            return {
              checkId: spec.checkId,
              clauseId: "Table 5.6 (PL + Pb + Q)",
              standard: "ASME BPVC VIII-2",
              vesselName: vessel,
              isSatisfied: false,
              actualValue: totalRange,
              requiredLimit: sps,
              margin: sps - totalRange,
              allowableStress: S,
              explanation: `ASME BPVC VIII-2 Table 5.6 VIOLATED for '${vessel}': primary+secondary range PL+Pb+Q=${totalRange.toFixed(3)} exceeds S_PS=${sps.toFixed(3)}.`,
            };
          }
        }

        return {
          checkId: spec.checkId,
          clauseId: "5.2.2",
          standard: "ASME BPVC VIII-2",
          vesselName: vessel,
          isSatisfied: true,
          actualValue: Math.max(pmExt, plPb),
          requiredLimit: pmExt > 0 && plPb === pmExt ? S : limit15S,
          margin: Math.min(S - pmExt, limit15S - plPb),
          allowableStress: S,
          explanation: `ASME BPVC VIII-2 Part 5.2 SATISFIED for '${vessel}': Pm=${pmExt.toFixed(3)} <= ${S.toFixed(3)}, PL+Pb=${plPb.toFixed(3)} <= ${limit15S.toFixed(3)}.`,
        };
      }
    }
  }

  private getExternalValue(vessel: string, metric: string, fallback: number): number {
    const b = this.externalBounds.get(`${vessel}.${metric}`) ?? this.externalBounds.get(metric);
    if (b && b[0] <= b[1]) {
      const boundVal = Number.isFinite(b[1]) ? b[1] : Number.isFinite(b[0]) ? b[0] : fallback;
      return Math.max(fallback, boundVal);
    }
    return fallback;
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    for (const spec of this.checks.values()) {
      const res = this.evaluateSpec(spec);
      if (!res.isSatisfied) {
        const culprits = [spec.checkId];
        if (spec.vesselName) culprits.push(spec.vesselName);
        culprits.push(`${res.standard} ${res.clauseId}`);
        if (spec.sysmlRequirementId) culprits.push(spec.sysmlRequirementId);

        const matchingLits = Array.from(this.assertedLiterals.values()).filter((l) =>
          l.args.some((a) => a && typeof a === "object" && a.checkId === spec.checkId),
        );
        return {
          isSat: false,
          conflict: {
            literals: matchingLits,
            explanation: res.explanation,
            culpritEntities: culprits,
            theoryName: this.name,
          },
        };
      }

      // Cross-theory consistency check for cooperating FEA / spatial bounds (e.g. CAE von_mises_stress vs 1.5*S)
      if (
        res.allowableStress !== undefined &&
        (spec.kind === "ug27_cylinder" || spec.kind === "viii2_stress_linearization")
      ) {
        const vmBound =
          this.externalBounds.get(`${res.vesselName}.von_mises_stress`) ??
          this.externalBounds.get("fea.von_mises_stress");
        const stressCeiling =
          spec.kind === "viii2_stress_linearization" ? 1.5 * res.allowableStress : res.allowableStress;
        if (vmBound && vmBound[1] > stressCeiling + 1e-6) {
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter((l) =>
                l.args.some((a) => a && typeof a === "object" && a.checkId === spec.checkId),
              ),
              explanation: `${res.standard} ${res.clauseId} Cross-Theory Stress Violation on '${res.vesselName}': FEA von_mises_stress upper bound ${vmBound[1].toFixed(3)} exceeds code limit ${stressCeiling.toFixed(3)}.`,
              culpritEntities: [spec.checkId, res.vesselName, "fea.von_mises_stress", res.clauseId],
              theoryName: this.name,
            },
          };
        }
      }
    }
    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const out: SharedEquality[] = [];
    for (const spec of this.checks.values()) {
      const res = this.evaluateSpec(spec);
      const vessel = res.vesselName;
      if (Number.isFinite(res.allowableStress)) {
        const s = res.allowableStress!;
        out.push({
          varA: `${vessel}.S`,
          varB: `${spec.checkId}.S`,
          domain: "interval",
          bounds: [s, s],
          explanation: `${res.standard} ${res.clauseId} allowable stress S = ${s}`,
          sourceOracle: this.name,
        });
      }
      if ((spec.kind === "ug27_cylinder" || spec.kind === "ug32_head") && Number.isFinite(res.requiredLimit)) {
        out.push({
          varA: `${vessel}.t_min`,
          varB: `${spec.checkId}.t_req`,
          domain: "interval",
          bounds: [res.requiredLimit, Infinity],
          explanation: `${res.standard} ${res.clauseId} minimum required thickness >= ${res.requiredLimit.toFixed(4)}`,
          sourceOracle: this.name,
        });
      } else if (spec.kind === "ug99_hydrostatic" && Number.isFinite(res.requiredLimit)) {
        out.push({
          varA: `${vessel}.P_hydro_min`,
          varB: `${spec.checkId}.P_req`,
          domain: "interval",
          bounds: [res.requiredLimit, Infinity],
          explanation: `${res.standard} ${res.clauseId} hydrostatic test pressure >= ${res.requiredLimit.toFixed(4)}`,
          sourceOracle: this.name,
        });
      }
    }
    return out;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
    if (eq.bounds) {
      intersectBoundMap(this.externalBounds, eq.varA, eq.bounds);
      if (eq.varB && eq.varB !== eq.varA) {
        intersectBoundMap(this.externalBounds, eq.varB, eq.bounds);
      }
    }
  }

  public getModel(): Record<string, PressureVesselCheckResult> {
    const model: Record<string, PressureVesselCheckResult> = {};
    for (const spec of this.checks.values()) {
      model[spec.checkId] = this.evaluateSpec(spec);
    }
    return model;
  }
}
