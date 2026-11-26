// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Set-Based Pretraining & Post-Training Certification Pipeline across Modalities:
 *   - Code / DAE (`modelica`, `sysml2`, `spice`, `pscad`, etc.)
 *   - CAD / Geometry (`scad`, `step`, `urdf`, `stl`) with `ConstrainedZonotope` GD&T tolerance cones
 *   - World Action Models (`wam`, trajectories) with STL safety monitoring & energy/passivity bounds
 *   - Physical-equivalence canonical fingerprinting (unit-scale & variable-renaming invariant)
 */

import { ConstrainedZonotope } from "../analysis/wasm_constrained_zonotope.js";
import { StlMonitor, type StlFormula, type TrajectoryTrace } from "../formal/stl_monitor.js";
import { extractNumericParameters } from "./dataset-geometry.js";
import { compileRelationalHypergraph, fnv1a32 } from "./hypergraph-compiler.js";
import type { FormalCertificateSummary } from "./schemas.js";

export type CertificationModality = "code" | "cad" | "wam";

export interface GdtToleranceConstraintSpec {
  id: string;
  /** Parameter index or name matching extracted numeric parameters. */
  paramName: string;
  min?: number | undefined;
  max?: number | undefined;
  halfWidth?: number | undefined;
}

export interface WamTrajectoryCertificationInput {
  time: number[];
  signals: Record<string, number[]>;
  /** Optional STL safety formula evaluated over the trajectory. */
  stlFormula?: StlFormula | undefined;
  /** Maximum allowable energy growth ratio across rollout steps (passivity guard). */
  maxEnergyGrowthFactor?: number | undefined;
  /** Optional kinetic/potential energy signal name for passivity validation. */
  energySignalName?: string | undefined;
}

export interface ModalityCertificationInput {
  source: string;
  uri: string;
  dialect: string;
  modality?: CertificationModality | undefined;
  gdtConstraints?: GdtToleranceConstraintSpec[] | undefined;
  wamTrajectory?: WamTrajectoryCertificationInput | undefined;
}

export interface ModalityCertificationResult {
  modality: CertificationModality;
  passed: boolean;
  formalCert: FormalCertificateSummary;
  physicalFingerprint: string;
  gdtFeasible?: boolean | undefined;
  gdtVolumeRetention?: number | undefined;
  stlRobustness?: number | undefined;
  passivityViolated?: boolean | undefined;
  reasons: string[];
}

export function inferCertificationModality(dialect: string): CertificationModality {
  const d = dialect.trim().toLowerCase();
  if (["scad", "step", "stl", "obj", "iges", "dxf", "qif", "usd", "three-mf"].includes(d)) {
    return "cad";
  }
  if (["wam", "urdf", "adams", "simpack", "gensys", "openscenario", "opendrive"].includes(d)) {
    return "wam";
  }
  return "code";
}

/**
 * Computes a physical-equivalence canonical fingerprint that is invariant to:
 *   - Identifier renaming (`R_load` vs `res1`)
 *   - Whitespace & comment formatting
 *   - Uniform numeric/unit rescaling (ratios between consecutive numeric literals preserved via log-ratio quantization)
 *
 * Used alongside 4-gram Jaccard decontamination to catch physically identical engineering
 * systems disguised by different variable names or unit scales (e.g., mm vs m, kOhm vs Ohm).
 */
export function computePhysicalEquivalenceFingerprint(source: string, dialect: string): string {
  const hg = compileRelationalHypergraph({
    source,
    uri: `fingerprint://canonical.${dialect}`,
    dialect,
  });

  // Canonicalize token stream by replacing variable-grouped tokens with relational role signatures
  const groupOrdinal = new Map<number, number>();
  let nextOrd = 1;
  const canonicalTokens: string[] = [];
  for (let i = 0; i < hg.spans.length; i++) {
    const span = hg.spans[i]!;
    if (span.groupId > 0) {
      let ord = groupOrdinal.get(span.groupId);
      if (ord === undefined) {
        ord = nextOrd++;
        groupOrdinal.set(span.groupId, ord);
      }
      canonicalTokens.push(`G${ord}:R${span.relTypeId}:S${span.relSign}`);
    } else if (/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(span.text)) {
      canonicalTokens.push("NUM");
    } else {
      canonicalTokens.push(span.text.toLowerCase());
    }
  }

  // Compute scale-invariant dimensionless log-ratios of consecutive positive numeric parameters
  const params = extractNumericParameters(source, hg.spans).filter((p) => Number.isFinite(p.value) && p.value > 0);
  const ratioTokens: string[] = [];
  for (let i = 1; i < params.length; i++) {
    const ratio = params[i]!.value / params[i - 1]!.value;
    const quantizedLog = Math.round(Math.log10(Math.max(1e-12, ratio)) * 10);
    ratioTokens.push(`LR:${quantizedLog}`);
  }

  const signature = `${dialect.toLowerCase()}|m=${hg.mInit}|${canonicalTokens.join(" ")}|${ratioTokens.join(",")}`;
  const h1 = fnv1a32(signature).toString(16).padStart(8, "0");
  const h2 = fnv1a32(`${signature}#2`).toString(16).padStart(8, "0");
  return `phys_${h1}${h2}`;
}

/**
 * Certifies a pretraining or post-training example using set-based formal methods
 * (`ConstrainedZonotope` GD&T feasibility, STL trajectory robustness, and passivity checks).
 */
export function certifyModalityExample(input: ModalityCertificationInput): ModalityCertificationResult {
  const modality = input.modality ?? inferCertificationModality(input.dialect);
  const reasons: string[] = [];
  const physicalFingerprint = computePhysicalEquivalenceFingerprint(input.source, input.dialect);

  // Gate 1: Balanced syntax / non-empty structural content
  const trimmed = input.source.trim();
  const hasContent = trimmed.length > 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    if (parenDepth < 0 || braceDepth < 0 || bracketDepth < 0) break;
  }
  const gate1GlrSyntax = hasContent && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
  if (!gate1GlrSyntax) {
    reasons.push("Gate 1 failed: unbalanced delimiters or empty source.");
  }

  // Gate 2: Dimensional / unit hygiene check
  const hasInvalidUnit = /unit\s*=\s*""/i.test(trimmed) || /\bNaN\b|\bInfinity\b/.test(trimmed);
  const gate2QudvUnits = gate1GlrSyntax && !hasInvalidUnit;
  if (!gate2QudvUnits) {
    reasons.push("Gate 2 failed: empty unit string or non-finite numeric literal.");
  }

  // Gate 3: Set-based ConstrainedZonotope feasibility for CAD / parametric bounds
  let gate3SmtFeasibility = gate2QudvUnits;
  let gdtFeasible: boolean | undefined;
  let gdtVolumeRetention: number | undefined;

  if (modality === "cad" || (input.gdtConstraints && input.gdtConstraints.length > 0)) {
    const hg = compileRelationalHypergraph({
      source: trimmed,
      uri: input.uri,
      dialect: input.dialect,
    });
    const extracted = extractNumericParameters(trimmed, hg.spans);
    const paramNames =
      input.gdtConstraints && input.gdtConstraints.length > 0
        ? Array.from(new Set(input.gdtConstraints.map((c) => c.paramName)))
        : extracted.slice(0, 8).map((p) => p.name);

    if (paramNames.length > 0) {
      const n = paramNames.length;
      const center: number[] = new Array<number>(n).fill(0);
      const halfWidths: number[] = new Array<number>(n).fill(0);
      const generators: number[][] = [];
      for (let i = 0; i < n; i++) {
        const match = extracted.find((p) => p.name === paramNames[i]);
        const val = match ? match.value : 1.0;
        const hw = Math.max(1e-3, Math.abs(val) * 0.1);
        center[i] = val;
        halfWidths[i] = hw;
        const col = new Array<number>(n).fill(0);
        col[i] = hw;
        generators.push(col);
      }

      let cz = new ConstrainedZonotope(center, generators);
      if (input.gdtConstraints) {
        for (const c of input.gdtConstraints) {
          const idx = paramNames.indexOf(c.paramName);
          if (idx < 0) continue;
          if (c.max !== undefined) {
            const normal = new Array<number>(n).fill(0);
            normal[idx] = 1;
            cz = cz.intersectHalfspace(normal, c.max);
          }
          if (c.min !== undefined) {
            const normal = new Array<number>(n).fill(0);
            normal[idx] = -1;
            cz = cz.intersectHalfspace(normal, -c.min);
          }
        }
      }

      gdtFeasible = cz.isFeasible();
      if (!gdtFeasible) {
        gate3SmtFeasibility = false;
        gdtVolumeRetention = 0;
        reasons.push("Gate 3 failed: GD&T ConstrainedZonotope tolerance cone is empty/infeasible.");
      } else {
        let retProd = 1;
        for (let i = 0; i < n; i++) {
          const ePos = new Array<number>(n).fill(0);
          ePos[i] = 1;
          const eNeg = new Array<number>(n).fill(0);
          eNeg[i] = -1;
          const hi = cz.supportFunction(ePos);
          const negLo = cz.supportFunction(eNeg);
          const origSpan = Math.max(1e-9, 2 * halfWidths[i]!);
          const newSpan = hi !== null && negLo !== null ? Math.max(0, hi + negLo) : 0;
          retProd *= Math.min(1, newSpan / origSpan);
        }
        gdtVolumeRetention = Number(Math.pow(retProd, 1 / n).toFixed(4));
      }
    }
  }

  // Gate 4: WAM trajectory STL safety & passivity / DAE structural balance
  let gate4DaeBalance = gate3SmtFeasibility;
  let stlRobustness: number | undefined;
  let passivityViolated: boolean | undefined;

  if (input.wamTrajectory) {
    const { time, signals, stlFormula, energySignalName, maxEnergyGrowthFactor } = input.wamTrajectory;
    const allFinite =
      time.length > 0 &&
      time.every((t) => Number.isFinite(t)) &&
      Object.values(signals).every((arr) => arr.length === time.length && arr.every((v) => Number.isFinite(v)));
    if (!allFinite) {
      gate4DaeBalance = false;
      reasons.push("Gate 4 failed: WAM trajectory contains non-finite values or mismatched signal lengths.");
    } else {
      if (stlFormula) {
        const floatSignals: Record<string, Float64Array> = {};
        for (const [k, arr] of Object.entries(signals)) {
          floatSignals[k] = Float64Array.from(arr);
        }
        const trace: TrajectoryTrace = { time: Float64Array.from(time), signals: floatSignals };
        const stlRes = StlMonitor.evaluate(stlFormula, trace);
        stlRobustness = Number(stlRes.robustness.toFixed(6));
        if (!stlRes.isSatisfied) {
          gate4DaeBalance = false;
          reasons.push(`Gate 4 failed: STL safety specification violated (robustness=${stlRobustness}).`);
        }
      }
      if (energySignalName && signals[energySignalName]) {
        const eArr = signals[energySignalName]!;
        const e0 = Math.max(1e-9, Math.abs(eArr[0] ?? 0));
        const eMax = Math.max(...eArr.map((v) => Math.abs(v)));
        const maxFactor = maxEnergyGrowthFactor ?? 1.05;
        passivityViolated = eMax > e0 * maxFactor;
        if (passivityViolated) {
          gate4DaeBalance = false;
          reasons.push(
            `Gate 4 failed: WAM passivity violated (max energy ${eMax.toFixed(4)} > ${maxFactor}x initial ${e0.toFixed(4)}).`,
          );
        }
      }
    }
  }

  const passed = gate1GlrSyntax && gate2QudvUnits && gate3SmtFeasibility && gate4DaeBalance;
  const formalCert: FormalCertificateSummary = {
    gate1GlrSyntax,
    gate2QudvUnits,
    gate3SmtFeasibility,
    gate4DaeBalance,
    ...(gdtFeasible !== undefined ? { cadClearance: gdtFeasible } : {}),
    diagnostics: [...reasons],
    verifiedAtIso: new Date().toISOString(),
  };

  return {
    modality,
    passed,
    formalCert,
    physicalFingerprint,
    ...(gdtFeasible !== undefined ? { gdtFeasible } : {}),
    ...(gdtVolumeRetention !== undefined ? { gdtVolumeRetention } : {}),
    ...(stlRobustness !== undefined ? { stlRobustness } : {}),
    ...(passivityViolated !== undefined ? { passivityViolated } : {}),
    reasons,
  };
}
