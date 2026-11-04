// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Bethe-Bloch / Bortfeld Analytical Bragg Peak Depth-Dose Engine
 * and Linear-Memory DAEBuilder Lowering.
 *
 * Implements:
 * - Power-law Bragg-Kleeman range-energy relation in water: R_0 = alpha * E_0^p
 *   (alpha = 0.0022 cm * MeV^-p = 0.022 mm * MeV^-p, p = 1.77 for protons)
 * - Range straggling sigma_R combining Bohr/Gaussian monoenergetic straggling and beam energy spread
 * - Bortfeld (1997) analytical depth-dose curve D(z), distal R_80, R_20, FWHM, and LET_d(z)
 * - Linear-memory DAEBuilder lowering for geometry volumes, beam energetics, and Bragg peak telemetry
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import type { TopasDocument } from "../types.js";

export interface BraggPeakDepthPoint {
  depthMm: number;
  doseNormalized: number;
  stoppingPowerMeVPerMm: number;
  letKeVPerUm: number;
}

export interface BraggPeakOptions {
  energyMeV?: number | undefined;
  energySpreadPercent?: number | undefined;
  particle?: string | undefined;
  stepMm?: number | undefined;
  maxDepthMm?: number | undefined;
}

export interface BraggPeakResult {
  particle: string;
  initialEnergyMeV: number;
  energySpreadPercent: number;
  alphaMm: number;
  exponentP: number;
  projectedRangeMm: number;
  projectedRangeCm: number;
  rangeStragglingMm: number;
  braggPeakDepthMm: number;
  peakToEntranceRatio: number;
  distal80DepthMm: number;
  distal20DepthMm: number;
  fwhmMm: number;
  depthProfile: BraggPeakDepthPoint[];
}

function isTopasDocument(val: unknown): val is TopasDocument {
  return typeof val === "object" && val !== null && "components" in val && "sources" in val;
}

/**
 * Computes the analytical Bethe-Bloch / Bortfeld Bragg peak depth-dose curve in liquid water (G4_WATER).
 *
 * Range-energy law: $R_0 = \alpha E_0^p$ where $\alpha = 0.022\text{ mm}\cdot\text{MeV}^{-1.77}$ and $p = 1.77$ for protons.
 */
export function computeBraggPeakDepthDose(
  input?: TopasDocument | BraggPeakOptions | number,
  spreadOrOpts?: number | BraggPeakOptions,
  particleArg?: string,
): BraggPeakResult {
  let energyMeV = 150.0;
  let energySpreadPercent = 0.5;
  let particle = "proton";
  let stepMm = 1.0;
  let maxDepthMm: number | undefined;

  if (typeof input === "number") {
    energyMeV = input;
    if (typeof spreadOrOpts === "number") {
      energySpreadPercent = spreadOrOpts;
    } else if (spreadOrOpts) {
      if (spreadOrOpts.energySpreadPercent !== undefined) energySpreadPercent = spreadOrOpts.energySpreadPercent;
      if (spreadOrOpts.particle !== undefined) particle = spreadOrOpts.particle;
      if (spreadOrOpts.stepMm !== undefined) stepMm = spreadOrOpts.stepMm;
      if (spreadOrOpts.maxDepthMm !== undefined) maxDepthMm = spreadOrOpts.maxDepthMm;
    }
    if (particleArg !== undefined) particle = particleArg;
  } else if (isTopasDocument(input)) {
    const primarySource = input.sources[0];
    if (primarySource) {
      if (primarySource.beamEnergy !== undefined && primarySource.beamEnergy > 0) {
        energyMeV = primarySource.beamEnergy;
      }
      if (primarySource.beamEnergySpread !== undefined && primarySource.beamEnergySpread >= 0) {
        energySpreadPercent = primarySource.beamEnergySpread;
      }
      if (primarySource.beamParticle) {
        particle = primarySource.beamParticle;
      }
    }
    if (typeof spreadOrOpts === "object" && spreadOrOpts !== null) {
      if (spreadOrOpts.energyMeV !== undefined) energyMeV = spreadOrOpts.energyMeV;
      if (spreadOrOpts.energySpreadPercent !== undefined) energySpreadPercent = spreadOrOpts.energySpreadPercent;
      if (spreadOrOpts.particle !== undefined) particle = spreadOrOpts.particle;
      if (spreadOrOpts.stepMm !== undefined) stepMm = spreadOrOpts.stepMm;
      if (spreadOrOpts.maxDepthMm !== undefined) maxDepthMm = spreadOrOpts.maxDepthMm;
    }
  } else if (typeof input === "object" && input !== null) {
    if (input.energyMeV !== undefined) energyMeV = input.energyMeV;
    if (input.energySpreadPercent !== undefined) energySpreadPercent = input.energySpreadPercent;
    if (input.particle !== undefined) particle = input.particle;
    if (input.stepMm !== undefined) stepMm = input.stepMm;
    if (input.maxDepthMm !== undefined) maxDepthMm = input.maxDepthMm;
  }

  const safeEnergy = Math.max(1.0, energyMeV);
  const safeSpread = Math.max(0.0, energySpreadPercent);
  const isCarbon = particle.toLowerCase().includes("carbon") || particle.includes("12");

  // Bortfeld range-energy parameters in water (mm, MeV)
  const exponentP = 1.77;
  // For carbon-12 where energyMeV is given as MeV/u or total MeV:
  // Standard proton alpha = 0.0022 cm * MeV^-1.77 = 0.022 mm * MeV^-1.77
  const alphaMm = isCarbon ? 0.00733 : 0.022;
  const projectedRangeMm = alphaMm * Math.pow(safeEnergy, exponentP);
  const projectedRangeCm = projectedRangeMm / 10.0;

  // Range straggling sigma_R (mm): monoenergetic straggling + spectral spread contribution
  const sigmaMonoMm = 0.012 * Math.pow(projectedRangeMm, 0.935);
  const sigmaSpectralMm = (safeSpread / 100.0) * exponentP * projectedRangeMm;
  const rangeStragglingMm = Math.max(0.25, Math.sqrt(sigmaMonoMm * sigmaMonoMm + sigmaSpectralMm * sigmaSpectralMm));

  const gridMaxDepth = maxDepthMm ?? Math.ceil(projectedRangeMm * 1.25 + 10);
  const dtStep = Math.max(0.1, stepMm);

  const rawPoints: Array<{ z: number; rawDose: number; letVal: number }> = [];
  let maxRawDose = 0;
  let peakDepth = projectedRangeMm;

  for (let z = 0; z <= gridMaxDepth + 1e-9; z += dtStep) {
    const depth = Math.round(z * 1e4) / 1e4;
    // Gaussian-convolved Bortfeld depth-dose approximation around R_0
    const u = (projectedRangeMm - depth) / rangeStragglingMm;
    let rawDose = 0;

    if (depth <= projectedRangeMm) {
      const residualRange = Math.max(0.2 * rangeStragglingMm, projectedRangeMm - depth);
      // Bethe-Bloch inverse power rise D(z) ~ (R_0 - z)^(1/p - 1) smoothed by straggling
      const powerTerm = Math.pow(residualRange / projectedRangeMm, 1.0 / exponentP - 1.0);
      const attenuation = 1.0 - 0.0006 * depth; // nuclear inelastic attenuation along entrance
      const straggleEnvelope = 0.5 * (1.0 + erf(u / Math.SQRT2));
      rawDose = Math.max(0.1, attenuation * powerTerm * straggleEnvelope);
    } else {
      // Distal fall-off beyond R_0
      const peakAmp = Math.pow((0.2 * rangeStragglingMm) / projectedRangeMm, 1.0 / exponentP - 1.0) * 0.5;
      const gaussFalloff = peakAmp * Math.exp(-0.5 * u * u);
      const fragmentTail = isCarbon ? 0.06 * peakAmp * Math.exp((projectedRangeMm - depth) / 40.0) : 0.0;
      rawDose = gaussFalloff + fragmentTail;
    }

    if (rawDose > maxRawDose) {
      maxRawDose = rawDose;
      peakDepth = depth;
    }

    // Dose-averaged LET (keV/um) increases sharply in the Bragg peak region
    const baseLet = isCarbon ? 12.0 : 0.5;
    const peakLet = isCarbon ? 85.0 : 8.5;
    const letProximity = Math.exp(
      -0.5 * Math.pow((depth - (projectedRangeMm + 0.3 * rangeStragglingMm)) / (1.8 * rangeStragglingMm), 2),
    );
    const letVal =
      depth <= projectedRangeMm + 3 * rangeStragglingMm ? baseLet + (peakLet - baseLet) * letProximity : baseLet * 0.2;

    rawPoints.push({ z: depth, rawDose, letVal });
  }

  const normFactor = maxRawDose > 0 ? maxRawDose : 1.0;
  const depthProfile: BraggPeakDepthPoint[] = rawPoints.map((pt) => {
    const doseNormalized = Math.round((pt.rawDose / normFactor) * 1e6) / 1e6;
    const stoppingPowerMeVPerMm = Math.round(pt.letVal * 1e4) / 1e4; // 1 keV/um == 1 MeV/mm in unit-density water
    return {
      depthMm: pt.z,
      doseNormalized,
      stoppingPowerMeVPerMm,
      letKeVPerUm: stoppingPowerMeVPerMm,
    };
  });

  const entranceDose = depthProfile[0]?.doseNormalized ?? 0.25;
  const peakToEntranceRatio = entranceDose > 0 ? Math.round((1.0 / entranceDose) * 1000) / 1000 : 4.0;

  // Interpolate distal 80%, distal 20%, and proximal 50% / distal 50% for FWHM
  const distal80DepthMm = interpolateDistalCrossing(depthProfile, peakDepth, 0.8) ?? projectedRangeMm;
  const distal20DepthMm =
    interpolateDistalCrossing(depthProfile, peakDepth, 0.2) ?? projectedRangeMm + 1.5 * rangeStragglingMm;
  const distal50 =
    interpolateDistalCrossing(depthProfile, peakDepth, 0.5) ?? projectedRangeMm + 0.8 * rangeStragglingMm;
  const proximal50 =
    interpolateProximalCrossing(depthProfile, peakDepth, 0.5) ??
    Math.max(0, projectedRangeMm - 2.5 * rangeStragglingMm);
  const fwhmMm = Math.max(0.5, Math.round((distal50 - proximal50) * 1000) / 1000);

  return {
    particle,
    initialEnergyMeV: safeEnergy,
    energySpreadPercent: safeSpread,
    alphaMm,
    exponentP,
    projectedRangeMm: Math.round(projectedRangeMm * 1000) / 1000,
    projectedRangeCm: Math.round(projectedRangeCm * 10000) / 10000,
    rangeStragglingMm: Math.round(rangeStragglingMm * 1000) / 1000,
    braggPeakDepthMm: Math.round(peakDepth * 1000) / 1000,
    peakToEntranceRatio,
    distal80DepthMm: Math.round(distal80DepthMm * 1000) / 1000,
    distal20DepthMm: Math.round(distal20DepthMm * 1000) / 1000,
    fwhmMm,
    depthProfile,
  };
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function interpolateDistalCrossing(
  profile: BraggPeakDepthPoint[],
  peakDepth: number,
  targetDose: number,
): number | undefined {
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[i]!;
    const p1 = profile[i + 1]!;
    if (p0.depthMm >= peakDepth && p0.doseNormalized >= targetDose && p1.doseNormalized <= targetDose) {
      const denom = p0.doseNormalized - p1.doseNormalized;
      if (denom <= 1e-9) return p0.depthMm;
      const frac = (p0.doseNormalized - targetDose) / denom;
      return p0.depthMm + frac * (p1.depthMm - p0.depthMm);
    }
  }
  return undefined;
}

function interpolateProximalCrossing(
  profile: BraggPeakDepthPoint[],
  peakDepth: number,
  targetDose: number,
): number | undefined {
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[i]!;
    const p1 = profile[i + 1]!;
    if (p1.depthMm <= peakDepth && p0.doseNormalized <= targetDose && p1.doseNormalized >= targetDose) {
      const denom = p1.doseNormalized - p0.doseNormalized;
      if (denom <= 1e-9) return p0.depthMm;
      const frac = (targetDose - p0.doseNormalized) / denom;
      return p0.depthMm + frac * (p1.depthMm - p0.depthMm);
    }
  }
  return undefined;
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Lowers a TOPAS / GATE document into ModelScript's linear-memory DAEBuilder arena.
 */
export function lowerTopasToDae(doc: TopasDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? "TOPAS_Hadrontherapy";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  // 1. Lower Geometry Components (half-lengths and computed bounding volumes in mm^3)
  for (const comp of doc.components) {
    const base = sanitizeIdentifier(comp.name);
    const hlxVal = comp.hlx ?? comp.rMax ?? 10.0;
    const hlyVal = comp.hly ?? comp.rMax ?? 10.0;
    const hlzVal = comp.hlz ?? comp.hl ?? comp.rMax ?? 10.0;

    const hlxVar = `${base}_HLX_mm`;
    const hlxId = interner.intern(hlxVar);
    arena.addVariable(hlxVar, VarType.Real, Variability.Parameter, Causality.Local);
    const hlxExpr = arena.addExpression(ExprKind.Name, hlxId);
    arena.addEquation(EqKind.InitialSimple, hlxExpr, arena.addRealLiteral(hlxVal));

    const hlzVar = `${base}_HLZ_mm`;
    const hlzId = interner.intern(hlzVar);
    arena.addVariable(hlzVar, VarType.Real, Variability.Parameter, Causality.Local);
    const hlzExpr = arena.addExpression(ExprKind.Name, hlzId);
    arena.addEquation(EqKind.InitialSimple, hlzExpr, arena.addRealLiteral(hlzVal));

    // Full Z length = 2 * HLZ
    const fullZVar = `${base}_LengthZ_mm`;
    const fullZId = interner.intern(fullZVar);
    arena.addVariable(fullZVar, VarType.Real, Variability.Continuous, Causality.Output);
    const fullZExpr = arena.addExpression(ExprKind.Name, fullZId);
    const twoExpr = arena.addRealLiteral(2.0);
    arena.addEquation(EqKind.Simple, fullZExpr, arena.addBinaryExpr(BinOp.Mul, twoExpr, hlzExpr));

    // Volume in mm^3
    let volMm3 = 8.0 * hlxVal * hlyVal * hlzVal;
    if (comp.type.toLowerCase().includes("cylinder") && comp.rMax !== undefined && comp.hl !== undefined) {
      const rMin = comp.rMin ?? 0;
      volMm3 = Math.PI * (comp.rMax * comp.rMax - rMin * rMin) * (2.0 * comp.hl);
    } else if (comp.type.toLowerCase().includes("sphere") && comp.rMax !== undefined) {
      const rMin = comp.rMin ?? 0;
      volMm3 = (4.0 / 3.0) * Math.PI * (Math.pow(comp.rMax, 3) - Math.pow(rMin, 3));
    }

    const volVar = `${base}_Volume_mm3`;
    const volId = interner.intern(volVar);
    arena.addVariable(volVar, VarType.Real, Variability.Continuous, Causality.Output);
    const volExpr = arena.addExpression(ExprKind.Name, volId);
    arena.addEquation(EqKind.Simple, volExpr, arena.addRealLiteral(volMm3));
  }

  // 2. Lower Particle Sources & Bragg Peak Physics
  const sourcesToLower =
    doc.sources.length > 0
      ? doc.sources
      : [
          {
            name: "DefaultProtonBeam",
            type: "Beam",
            beamParticle: "proton",
            beamEnergy: 150.0,
            beamEnergySpread: 0.5,
            range: doc.range,
          },
        ];

  for (const src of sourcesToLower) {
    const base = sanitizeIdentifier(src.name);
    const energy = src.beamEnergy ?? 150.0;
    const spread = src.beamEnergySpread ?? 0.5;
    const bragg = computeBraggPeakDepthDose({
      energyMeV: energy > 0 ? energy : 150.0,
      energySpreadPercent: spread >= 0 ? spread : 0.5,
      particle: src.beamParticle,
    });

    const eVar = `${base}_BeamEnergy_MeV`;
    const eId = interner.intern(eVar);
    arena.addVariable(eVar, VarType.Real, Variability.Parameter, Causality.Input);
    const eExpr = arena.addExpression(ExprKind.Name, eId);
    arena.addEquation(EqKind.InitialSimple, eExpr, arena.addRealLiteral(energy));

    const r0Var = `${base}_BraggRange_mm`;
    const r0Id = interner.intern(r0Var);
    arena.addVariable(r0Var, VarType.Real, Variability.Continuous, Causality.Output);
    const r0Expr = arena.addExpression(ExprKind.Name, r0Id);
    arena.addEquation(EqKind.Simple, r0Expr, arena.addRealLiteral(bragg.projectedRangeMm));

    const r80Var = `${base}_DistalR80_mm`;
    const r80Id = interner.intern(r80Var);
    arena.addVariable(r80Var, VarType.Real, Variability.Continuous, Causality.Output);
    const r80Expr = arena.addExpression(ExprKind.Name, r80Id);
    arena.addEquation(EqKind.Simple, r80Expr, arena.addRealLiteral(bragg.distal80DepthMm));

    const ratioVar = `${base}_PeakToEntranceRatio`;
    const ratioId = interner.intern(ratioVar);
    arena.addVariable(ratioVar, VarType.Real, Variability.Continuous, Causality.Output);
    const ratioExpr = arena.addExpression(ExprKind.Name, ratioId);
    arena.addEquation(EqKind.Simple, ratioExpr, arena.addRealLiteral(bragg.peakToEntranceRatio));
  }

  return arena;
}
