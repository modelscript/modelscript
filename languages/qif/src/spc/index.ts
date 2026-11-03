// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Statistical Process Control (SPC), Metrology Capability, and DAE Lowering.
 *
 * Computes ASME Y14.5 effective tolerance (with MMC/LMC bonus tolerance), mean (μ),
 * standard deviation (σ), Cp, Cpk, Pp, Ppk, Test Uncertainty Ratio (TUR), pass rate,
 * Monte Carlo parameter distribution descriptors, and lowers QIF models into
 * ModelScript's linear-memory DAEBuilder arena.
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
import { evaluateActualCompliance } from "../lints/rules.js";
import type { QifDocument, QifFeature, QifMeasurementDevice } from "../types.js";

export interface QifActualSpcEntry {
  actualId: string;
  partSerialNumber: string;
  measuredValue: number;
  actualFeatureSize?: number | undefined;
  baseTolerance: number;
  bonusTolerance: number;
  effectiveTolerance: number;
  lowerLimit: number;
  upperLimit: number;
  isWithinSpec: boolean;
  status: "PASS" | "FAIL" | "REWORK";
}

export interface QifCharacteristicSpcReport {
  characteristicId: string;
  characteristicName: string;
  gdtType: string;
  sampleCount: number;
  baseTolerance: number;
  meanBonusTolerance: number;
  effectiveTolerance: number;
  lsl: number;
  usl: number;
  mean: number;
  stdDev: number;
  populationStdDev: number;
  cp: number;
  cpk: number;
  cpu: number;
  cpl: number;
  pp: number;
  ppk: number;
  tur?: number | undefined;
  passCount: number;
  failCount: number;
  passRate: number;
  actualEvaluations: QifActualSpcEntry[];
}

export interface QifMonteCarloDescriptor {
  parameterName: string;
  characteristicId: string;
  featureId?: string | undefined;
  distributionType: "normal" | "truncatedNormal" | "rayleigh" | "uniform";
  nominal: number;
  mean: number;
  stdDev: number;
  lsl: number;
  usl: number;
  effectiveTolerance: number;
}

export interface QifSpcSummary {
  documentQpId: string;
  totalCharacteristics: number;
  totalActuals: number;
  overallPassRate: number;
  characteristics: QifCharacteristicSpcReport[];
  monteCarloDescriptors: QifMonteCarloDescriptor[];
}

export function evaluateQifSpc(doc: QifDocument): QifSpcSummary {
  const featureById = new Map<string, QifFeature>();
  for (const f of doc.features) {
    featureById.set(f.id, f);
    if (f.qpId) featureById.set(f.qpId, f);
  }

  const deviceById = new Map<string, QifMeasurementDevice>();
  for (const d of doc.devices) {
    deviceById.set(d.id, d);
    if (d.qpId) deviceById.set(d.qpId, d);
  }

  // Also map characteristic -> device from planSteps if not directly on characteristic
  const charDeviceMap = new Map<string, QifMeasurementDevice>();
  for (const c of doc.characteristics) {
    if (c.deviceId) {
      const dev = deviceById.get(c.deviceId);
      if (dev) charDeviceMap.set(c.id, dev);
    }
  }
  for (const step of doc.planSteps) {
    const dev = deviceById.get(step.deviceId);
    if (!dev) continue;
    if (step.characteristicId && !charDeviceMap.has(step.characteristicId)) {
      charDeviceMap.set(step.characteristicId, dev);
    } else if (step.featureId) {
      for (const c of doc.characteristics) {
        if (c.featureIds.includes(step.featureId) && !charDeviceMap.has(c.id)) {
          charDeviceMap.set(c.id, dev);
        }
      }
    }
  }

  const charReports: QifCharacteristicSpcReport[] = [];
  const mcDescriptors: QifMonteCarloDescriptor[] = [];
  let totalPass = 0;
  let totalEval = 0;

  for (const char of doc.characteristics) {
    const actuals = doc.actuals.filter(
      (a) => a.characteristicId === char.id || (char.qpId && a.characteristicId === char.qpId),
    );
    const firstFeatureId = char.featureIds[0];
    const primaryFeature = firstFeatureId !== undefined ? featureById.get(firstFeatureId) : undefined;

    const actualEvaluations: QifActualSpcEntry[] = [];
    let bonusSum = 0;
    let passCount = 0;
    let failCount = 0;

    for (const act of actuals) {
      const ev = evaluateActualCompliance(char, primaryFeature, act);
      bonusSum += ev.bonusTolerance;
      if (ev.isWithinSpec) {
        passCount++;
        totalPass++;
      } else {
        failCount++;
      }
      totalEval++;

      const entry: QifActualSpcEntry = {
        actualId: act.id,
        partSerialNumber: act.partSerialNumber,
        measuredValue: act.measuredValue,
        baseTolerance: ev.baseTolerance,
        bonusTolerance: ev.bonusTolerance,
        effectiveTolerance: ev.effectiveTolerance,
        lowerLimit: ev.lowerLimit,
        upperLimit: ev.upperLimit,
        isWithinSpec: ev.isWithinSpec,
        status: act.status,
      };
      if (act.actualFeatureSize !== undefined) {
        entry.actualFeatureSize = act.actualFeatureSize;
      }
      actualEvaluations.push(entry);
    }

    const n = actuals.length;
    const meanBonus = n > 0 ? Math.round((bonusSum / n) * 1e9) / 1e9 : 0;
    const effectiveTolerance = Math.round((char.toleranceZone + meanBonus) * 1e9) / 1e9;

    const isDimensional = char.gdtType === "DimensionalSize" || char.gdtType === "DimensionalDistance";

    let lsl = 0;
    let usl = effectiveTolerance;
    if (
      char.nominalValue !== undefined &&
      (isDimensional ||
        char.upperTolerance !== undefined ||
        char.lowerTolerance !== undefined ||
        char.nominalValue !== 0)
    ) {
      const nom = char.nominalValue;
      if (char.upperTolerance !== undefined || char.lowerTolerance !== undefined) {
        const up = char.upperTolerance ?? char.toleranceZone / 2;
        const rawLow = char.lowerTolerance ?? -char.toleranceZone / 2;
        const low = rawLow > 0 && rawLow === up ? -rawLow : rawLow;
        lsl = Math.round((nom + low - meanBonus / 2) * 1e9) / 1e9;
        usl = Math.round((nom + up + meanBonus / 2) * 1e9) / 1e9;
      } else {
        const half = effectiveTolerance / 2;
        lsl = Math.round((nom - half) * 1e9) / 1e9;
        usl = Math.round((nom + half) * 1e9) / 1e9;
      }
    }

    const values = actuals.map((a) => a.measuredValue);
    const mean = n > 0 ? values.reduce((acc, v) => acc + v, 0) / n : (char.nominalValue ?? 0);

    let varianceSample = 0;
    let variancePop = 0;
    if (n > 1) {
      const sumSq = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
      varianceSample = sumSq / (n - 1);
      variancePop = sumSq / n;
    } else if (n === 1) {
      // Fallback nominal six-sigma assumption when only 1 sample is present
      const defaultSigma = (usl - lsl) / 6;
      varianceSample = defaultSigma * defaultSigma;
      variancePop = varianceSample;
    } else {
      const defaultSigma = (usl - lsl) / 6;
      varianceSample = defaultSigma * defaultSigma;
      variancePop = varianceSample;
    }

    const stdDev = Math.sqrt(varianceSample);
    const populationStdDev = Math.sqrt(variancePop);

    const tolRange = usl - lsl;
    const cp = stdDev > 0 ? tolRange / (6 * stdDev) : 0;
    const cpu = stdDev > 0 ? (usl - mean) / (3 * stdDev) : 0;
    const cpl = stdDev > 0 ? (mean - lsl) / (3 * stdDev) : 0;
    const cpk = Math.min(cpu, cpl);

    const pp = populationStdDev > 0 ? tolRange / (6 * populationStdDev) : 0;
    const ppu = populationStdDev > 0 ? (usl - mean) / (3 * populationStdDev) : 0;
    const ppl = populationStdDev > 0 ? (mean - lsl) / (3 * populationStdDev) : 0;
    const ppk = Math.min(ppu, ppl);

    const dev = charDeviceMap.get(char.id);
    let tur: number | undefined;
    if (dev && dev.calibrationUncertainty > 0) {
      const band = tolRange > 0 ? tolRange : char.toleranceZone;
      tur = band / (2 * dev.calibrationUncertainty);
    }

    const passRate = n > 0 ? passCount / n : 1.0;

    const report: QifCharacteristicSpcReport = {
      characteristicId: char.id,
      characteristicName: char.name,
      gdtType: char.gdtType,
      sampleCount: n,
      baseTolerance: char.toleranceZone,
      meanBonusTolerance: meanBonus,
      effectiveTolerance,
      lsl,
      usl,
      mean,
      stdDev,
      populationStdDev,
      cp,
      cpk,
      cpu,
      cpl,
      pp,
      ppk,
      passCount,
      failCount,
      passRate,
      actualEvaluations,
    };
    if (tur !== undefined) {
      report.tur = tur;
    }
    charReports.push(report);

    const distType: QifMonteCarloDescriptor["distributionType"] =
      char.gdtType === "Position" || char.gdtType === "CircularRunout" || char.gdtType === "Cylindricity"
        ? "rayleigh"
        : isDimensional
          ? "normal"
          : "truncatedNormal";

    const mc: QifMonteCarloDescriptor = {
      parameterName: sanitizeIdentifier(char.name),
      characteristicId: char.id,
      distributionType: distType,
      nominal: char.nominalValue ?? primaryFeature?.nominalSize ?? 0,
      mean,
      stdDev: stdDev > 0 ? stdDev : effectiveTolerance / 6,
      lsl,
      usl,
      effectiveTolerance,
    };
    if (firstFeatureId !== undefined) {
      mc.featureId = firstFeatureId;
    }
    mcDescriptors.push(mc);
  }

  return {
    documentQpId: doc.qpId,
    totalCharacteristics: doc.characteristics.length,
    totalActuals: doc.actuals.length,
    overallPassRate: totalEval > 0 ? totalPass / totalEval : 1.0,
    characteristics: charReports,
    monteCarloDescriptors: mcDescriptors,
  };
}

/**
 * Lowers QIF nominal dimensions, tolerances, ASME Y14.5 bonus tolerances, and
 * measured deviations directly into ModelScript's linear-memory DAEBuilder arena.
 */
export function lowerQifToDae(doc: QifDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? doc.header.partName ?? `QIF_${doc.qpId}`;
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const spc = evaluateQifSpc(doc);
  const spcByCharId = new Map<string, QifCharacteristicSpcReport>();
  for (const r of spc.characteristics) {
    spcByCharId.set(r.characteristicId, r);
  }

  // 1. Lower Features as nominal parameters
  for (const feat of doc.features) {
    const baseName = sanitizeIdentifier(feat.name || feat.id);
    const nomVarName = `${baseName}_nominal`;
    const nomNameId = interner.intern(nomVarName);
    arena.addVariable(nomVarName, VarType.Real, Variability.Parameter, Causality.Local);
    const nomExprId = arena.addExpression(ExprKind.Name, nomNameId);
    const nomValId = arena.addRealLiteral(feat.nominalSize ?? 0.0);
    arena.addEquation(EqKind.InitialSimple, nomExprId, nomValId);
  }

  // 2. Lower Characteristics: nominal, base tolerance, bonus tolerance, effective tolerance, deviation
  for (const char of doc.characteristics) {
    const baseName = sanitizeIdentifier(char.name || char.id);
    const report = spcByCharId.get(char.id);

    // Nominal parameter
    const nomVar = `${baseName}_nominal`;
    const nomId = interner.intern(nomVar);
    arena.addVariable(nomVar, VarType.Real, Variability.Parameter, Causality.Local);
    const nomExpr = arena.addExpression(ExprKind.Name, nomId);
    arena.addEquation(EqKind.InitialSimple, nomExpr, arena.addRealLiteral(char.nominalValue ?? 0.0));

    // Base tolerance parameter
    const tolVar = `${baseName}_tolerance`;
    const tolId = interner.intern(tolVar);
    arena.addVariable(tolVar, VarType.Real, Variability.Parameter, Causality.Local);
    const tolExpr = arena.addExpression(ExprKind.Name, tolId);
    arena.addEquation(EqKind.InitialSimple, tolExpr, arena.addRealLiteral(char.toleranceZone));

    // Bonus tolerance variable
    const bonusVar = `${baseName}_bonus`;
    const bonusId = interner.intern(bonusVar);
    arena.addVariable(bonusVar, VarType.Real, Variability.Continuous, Causality.Local);
    const bonusExpr = arena.addExpression(ExprKind.Name, bonusId);
    arena.addEquation(EqKind.Simple, bonusExpr, arena.addRealLiteral(report?.meanBonusTolerance ?? 0.0));

    // Effective tolerance equation: effective_tol = tolerance + bonus
    const effVar = `${baseName}_effective_tol`;
    const effId = interner.intern(effVar);
    arena.addVariable(effVar, VarType.Real, Variability.Continuous, Causality.Output);
    const effExpr = arena.addExpression(ExprKind.Name, effId);
    const sumExpr = arena.addBinaryExpr(BinOp.Add, tolExpr, bonusExpr);
    arena.addEquation(EqKind.Simple, effExpr, sumExpr);

    // Measured deviation variable
    const devVar = `${baseName}_deviation`;
    const devId = interner.intern(devVar);
    arena.addVariable(devVar, VarType.Real, Variability.Continuous, Causality.Output);
    const devExpr = arena.addExpression(ExprKind.Name, devId);
    arena.addEquation(EqKind.Simple, devExpr, arena.addRealLiteral(report?.mean ?? 0.0));
  }

  return arena;
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
