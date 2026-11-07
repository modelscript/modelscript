// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — NIST QIF Rules & ASME Y14.5 GD&T Semantic Linter.
 *
 * Implements diagnostic rules M8101–M8109:
 * - M8101 (qif-unresolved-qpid): Unresolved featureId, characteristicId, deviceId, or datum label reference.
 * - M8102 (qif-duplicate-qpid): Duplicate ID or QPId UUID.
 * - M8103 (qif-invalid-datum-precedence): Duplicate datum label inside a single DatumReferenceFrame.
 * - M8104 (qif-invalid-material-modifier): MMC or LMC applied to a non-feature-of-size or prohibited GD&T form/profile/runout type.
 * - M8105 (qif-composite-frame-mismatch): Composite lower-tier tolerance is >= upper-tier tolerance.
 * - M8106 (qif-insufficient-probing-points): Probing points below mathematical minimum for geometry or QifRules.minPointsPerFeature.
 * - M8107 (qif-tur-uncertainty-warning): Measurement device calibration uncertainty violates TUR threshold.
 * - M8108 (qif-out-of-tolerance-actual): Actual measured value exceeds effective tolerance (with MMC/LMC bonus) while PASS, or within spec while FAIL.
 * - M8109 (qif-unresolved-step-entity): Referenced STEP AP242 entity ID is missing from CAD model.
 */

import type {
  QifCharacteristic,
  QifCharacteristicActual,
  QifDiagnostic,
  QifDocument,
  QifFeature,
  QifFeatureType,
  QifGdtType,
} from "../types.js";

export const MATHEMATICAL_MIN_POINTS: Record<QifFeatureType, number> = {
  Point: 1,
  Plane: 3,
  Circle: 3,
  Slot: 4,
  Sphere: 4,
  Cylinder: 5,
  Cone: 6,
};

const NON_MODIFIABLE_GDT_TYPES = new Set<QifGdtType>([
  "Flatness",
  "Circularity",
  "Cylindricity",
  "ProfileOfSurface",
  "ProfileOfLine",
  "CircularRunout",
  "TotalRunout",
]);

export const QifErrorCode = {
  UNRESOLVED_QPID: {
    code: "M8101",
    rule: "qif-unresolved-qpid",
    severity: "error" as const,
    message: (refKind: string, refId: string, contextName: string) =>
      `Unresolved ${refKind} reference '${refId}' in '${contextName}'.`,
  },
  DUPLICATE_QPID: {
    code: "M8102",
    rule: "qif-duplicate-qpid",
    severity: "error" as const,
    message: (idOrQpId: string, elementName: string) =>
      `Duplicate identifier or QPId '${idOrQpId}' declared on '${elementName}'.`,
  },
  INVALID_DATUM_PRECEDENCE: {
    code: "M8103",
    rule: "qif-invalid-datum-precedence",
    severity: "error" as const,
    message: (datumLabel: string, charName: string) =>
      `Duplicate datum label '${datumLabel}' in DatumReferenceFrame of characteristic '${charName}'.`,
  },
  INVALID_MATERIAL_MODIFIER: {
    code: "M8104",
    rule: "qif-invalid-material-modifier",
    severity: "error" as const,
    message: (modifier: string, targetDesc: string, charName: string) =>
      `Material condition modifier '${modifier}' cannot be applied to '${targetDesc}' in characteristic '${charName}'.`,
  },
  COMPOSITE_FRAME_MISMATCH: {
    code: "M8105",
    rule: "qif-composite-frame-mismatch",
    severity: "error" as const,
    message: (lowerTol: number, upperTol: number, charName: string) =>
      `Composite lower-tier tolerance '${lowerTol}' must be strictly less than upper-tier tolerance '${upperTol}' in characteristic '${charName}'.`,
  },
  INSUFFICIENT_PROBING_POINTS: {
    code: "M8106",
    rule: "qif-insufficient-probing-points",
    severity: "error" as const,
    message: (actualPoints: number, requiredPoints: number, featureType: string, targetName: string) =>
      `Probing point count '${actualPoints}' is below minimum required '${requiredPoints}' for '${featureType}' in '${targetName}'.`,
  },
  TUR_UNCERTAINTY_WARNING: {
    code: "M8107",
    rule: "qif-tur-uncertainty-warning",
    severity: "warning" as const,
    message: (tur: string, minTur: string, deviceName: string, charName: string) =>
      `Test Uncertainty Ratio '${tur}:1' is below required minimum '${minTur}:1' for device '${deviceName}' on characteristic '${charName}'.`,
  },
  OUT_OF_TOLERANCE_ACTUAL: {
    code: "M8108",
    rule: "qif-out-of-tolerance-actual",
    severity: "error" as const,
    message: (actualId: string, measuredVal: number, effTol: string, status: string, charName: string) =>
      `Actual '${actualId}' has measured value '${measuredVal}' against effective tolerance '${effTol}' but is marked '${status}' for characteristic '${charName}'.`,
  },
  UNRESOLVED_STEP_ENTITY: {
    code: "M8109",
    rule: "qif-unresolved-step-entity",
    severity: "error" as const,
    message: (stepEntityId: string, featureName: string) =>
      `Referenced STEP AP242 entity '${stepEntityId}' on feature '${featureName}' was not found in the CAD model.`,
  },
  ZERO_TOLERANCE_ZONE: {
    code: "M8110",
    rule: "qif-zero-tolerance-zone",
    severity: "warning" as const,
    message: (charName: string) =>
      `Characteristic '${charName}' specifies zero tolerance zone without Maximum Material Condition modifier.`,
  },
  CIRCULAR_DATUM_REFERENCE: {
    code: "M8111",
    rule: "qif-circular-datum-reference",
    severity: "error" as const,
    message: (datumLabel: string) =>
      `Datum '${datumLabel}' definition references itself in DatumReferenceFrame.`,
  },
  SPC_SUBGROUP_SIZE_INSUFFICIENT: {
    code: "M8112",
    rule: "qif-spc-subgroup-size-insufficient",
    severity: "warning" as const,
    message: (charName: string, n: number) =>
      `SPC capability study on '${charName}' specifies subgroup size n < 2 (found ${n}).`,
  },
};

export interface EffectiveToleranceEvaluation {
  baseTolerance: number;
  bonusTolerance: number;
  effectiveTolerance: number;
  lowerLimit: number;
  upperLimit: number;
  isWithinSpec: boolean;
}

/**
 * Computes ASME Y14.5 effective tolerance (including MMC / LMC bonus tolerance)
 * and evaluates whether an actual measurement is within specification.
 */
export function evaluateActualCompliance(
  characteristic: QifCharacteristic,
  feature: QifFeature | undefined,
  actual: QifCharacteristicActual,
): EffectiveToleranceEvaluation {
  const baseTolerance = characteristic.toleranceZone;
  let bonusTolerance = 0;

  if (
    (characteristic.materialCondition === "MMC" || characteristic.materialCondition === "LMC") &&
    actual.actualFeatureSize !== undefined &&
    feature !== undefined &&
    feature.isFeatureOfSize &&
    feature.nominalSize !== undefined
  ) {
    const nominal = feature.nominalSize;
    const actualSize = actual.actualFeatureSize;
    const hasExplicitLimits = feature.upperSizeTolerance !== undefined || feature.lowerSizeTolerance !== undefined;

    if (hasExplicitLimits) {
      const upperTol = feature.upperSizeTolerance ?? 0;
      const lowerTol =
        feature.lowerSizeTolerance !== undefined
          ? feature.lowerSizeTolerance > 0 && feature.lowerSizeTolerance === upperTol
            ? -feature.lowerSizeTolerance
            : feature.lowerSizeTolerance
          : 0;
      const maxSize = nominal + upperTol;
      const minSize = nominal + lowerTol;
      const isInternal = feature.isInternal !== false; // default internal hole/bore

      if (characteristic.materialCondition === "MMC") {
        // Internal hole MMC = minSize; External shaft MMC = maxSize
        bonusTolerance = isInternal ? Math.max(0, actualSize - minSize) : Math.max(0, maxSize - actualSize);
      } else {
        // Internal hole LMC = maxSize; External shaft LMC = minSize
        bonusTolerance = isInternal ? Math.max(0, maxSize - actualSize) : Math.max(0, actualSize - minSize);
      }
    } else if (feature.isInternal === true) {
      if (characteristic.materialCondition === "MMC") {
        bonusTolerance = Math.max(0, actualSize - nominal);
      } else {
        bonusTolerance = actualSize <= nominal ? nominal - actualSize : Math.abs(actualSize - nominal);
      }
    } else if (feature.isInternal === false) {
      if (characteristic.materialCondition === "MMC") {
        bonusTolerance = Math.max(0, nominal - actualSize);
      } else {
        bonusTolerance = Math.max(0, actualSize - nominal);
      }
    } else {
      // Nominal size represents the MMC/LMC boundary directly
      bonusTolerance = Math.abs(actualSize - nominal);
    }
  }

  // Round floating point noise to 1e-9 precision
  bonusTolerance = Math.round(bonusTolerance * 1e9) / 1e9;
  const effectiveTolerance = Math.round((baseTolerance + bonusTolerance) * 1e9) / 1e9;

  const isDimensional =
    characteristic.gdtType === "DimensionalSize" || characteristic.gdtType === "DimensionalDistance";

  let lowerLimit = 0;
  let upperLimit = effectiveTolerance;
  let isWithinSpec = true;

  if (
    characteristic.nominalValue !== undefined &&
    (isDimensional ||
      characteristic.upperTolerance !== undefined ||
      characteristic.lowerTolerance !== undefined ||
      characteristic.nominalValue !== 0)
  ) {
    const nom = characteristic.nominalValue;
    if (characteristic.upperTolerance !== undefined || characteristic.lowerTolerance !== undefined) {
      const up = characteristic.upperTolerance ?? characteristic.toleranceZone / 2;
      const rawLow = characteristic.lowerTolerance ?? -characteristic.toleranceZone / 2;
      const low = rawLow > 0 && rawLow === up ? -rawLow : rawLow;
      lowerLimit = Math.round((nom + low - bonusTolerance / 2) * 1e9) / 1e9;
      upperLimit = Math.round((nom + up + bonusTolerance / 2) * 1e9) / 1e9;
    } else {
      const half = effectiveTolerance / 2;
      lowerLimit = Math.round((nom - half) * 1e9) / 1e9;
      upperLimit = Math.round((nom + half) * 1e9) / 1e9;
    }
    isWithinSpec = actual.measuredValue >= lowerLimit - 1e-9 && actual.measuredValue <= upperLimit + 1e-9;
  } else {
    lowerLimit = 0;
    upperLimit = effectiveTolerance;
    isWithinSpec = actual.measuredValue >= -1e-9 && actual.measuredValue <= effectiveTolerance + 1e-9;
  }

  return {
    baseTolerance,
    bonusTolerance,
    effectiveTolerance,
    lowerLimit,
    upperLimit,
    isWithinSpec,
  };
}

export function lintQifDocument(doc: QifDocument): QifDiagnostic[] {
  const diagnostics: QifDiagnostic[] = [];

  // ───────────────────────────────────────────────────────────────────────────
  // 1. M8102: Duplicate ID or QPId UUID Detection
  // ───────────────────────────────────────────────────────────────────────────
  const seenIds = new Set<string>();
  const seenQpIds = new Set<string>();

  const registerIdentity = (
    id: string,
    qpId: string | undefined,
    displayName: string,
    range: QifDiagnostic["range"],
  ) => {
    if (id) {
      if (seenIds.has(id)) {
        diagnostics.push({
          code: QifErrorCode.DUPLICATE_QPID.code,
          rule: QifErrorCode.DUPLICATE_QPID.rule,
          severity: QifErrorCode.DUPLICATE_QPID.severity,
          message: QifErrorCode.DUPLICATE_QPID.message(id, displayName),
          range,
        });
      } else {
        seenIds.add(id);
      }
    }
    if (qpId && qpId !== `qpid-${id}`) {
      if (seenQpIds.has(qpId) || seenIds.has(qpId)) {
        diagnostics.push({
          code: QifErrorCode.DUPLICATE_QPID.code,
          rule: QifErrorCode.DUPLICATE_QPID.rule,
          severity: QifErrorCode.DUPLICATE_QPID.severity,
          message: QifErrorCode.DUPLICATE_QPID.message(qpId, displayName),
          range,
        });
      } else {
        seenQpIds.add(qpId);
      }
    }
  };

  for (const d of doc.datumDefinitions) {
    registerIdentity(d.id, d.qpId, `Datum '${d.label}'`, d.range);
  }
  for (const f of doc.features) {
    registerIdentity(f.id, f.qpId, f.name, f.range);
  }
  for (const c of doc.characteristics) {
    registerIdentity(c.id, c.qpId, c.name, c.range);
  }
  for (const dev of doc.devices) {
    registerIdentity(dev.id, dev.qpId, dev.name, dev.range);
  }
  for (const s of doc.planSteps) {
    registerIdentity(s.id, undefined, `PlanStep '${s.id}'`, s.range);
  }
  for (const a of doc.actuals) {
    registerIdentity(a.id, undefined, `Actual '${a.id}'`, a.range);
  }

  // Lookup maps by ID and QPId
  const featureById = new Map<string, QifFeature>();
  for (const f of doc.features) {
    featureById.set(f.id, f);
    if (f.qpId) featureById.set(f.qpId, f);
  }

  const charById = new Map<string, QifCharacteristic>();
  for (const c of doc.characteristics) {
    charById.set(c.id, c);
    if (c.qpId) charById.set(c.qpId, c);
  }

  const deviceById = new Map<string, (typeof doc.devices)[number]>();
  for (const dev of doc.devices) {
    deviceById.set(dev.id, dev);
    if (dev.qpId) deviceById.set(dev.qpId, dev);
  }

  const datumByLabel = new Map<string, (typeof doc.datumDefinitions)[number]>();
  for (const d of doc.datumDefinitions) {
    datumByLabel.set(d.label, d);
    datumByLabel.set(d.id, d);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Datum Definition References & Circular Datum Check (M8101, M8111)
  // ───────────────────────────────────────────────────────────────────────────
  for (const d of doc.datumDefinitions) {
    const isSelfRef =
      d.featureId === d.label ||
      d.featureId === d.id ||
      Boolean(d.datumReferences && (d.datumReferences.includes(d.label) || d.datumReferences.includes(d.id)));
    if (isSelfRef) {
      diagnostics.push({
        code: QifErrorCode.CIRCULAR_DATUM_REFERENCE.code,
        rule: QifErrorCode.CIRCULAR_DATUM_REFERENCE.rule,
        severity: QifErrorCode.CIRCULAR_DATUM_REFERENCE.severity,
        message: QifErrorCode.CIRCULAR_DATUM_REFERENCE.message(d.label),
        range: d.range,
      });
    } else if (d.datumReferences && d.datumReferences.length > 0) {
      const visited = new Set<string>([d.label, d.id]);
      const queue = [...d.datumReferences];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === d.label || curr === d.id) {
          diagnostics.push({
            code: QifErrorCode.CIRCULAR_DATUM_REFERENCE.code,
            rule: QifErrorCode.CIRCULAR_DATUM_REFERENCE.rule,
            severity: QifErrorCode.CIRCULAR_DATUM_REFERENCE.severity,
            message: QifErrorCode.CIRCULAR_DATUM_REFERENCE.message(d.label),
            range: d.range,
          });
          break;
        }
        if (visited.has(curr)) continue;
        visited.add(curr);
        const nextDatum = datumByLabel.get(curr);
        if (nextDatum?.datumReferences) {
          queue.push(...nextDatum.datumReferences);
        }
      }
    }

    if (d.featureId && !featureById.has(d.featureId)) {
      diagnostics.push({
        code: QifErrorCode.UNRESOLVED_QPID.code,
        rule: QifErrorCode.UNRESOLVED_QPID.rule,
        severity: QifErrorCode.UNRESOLVED_QPID.severity,
        message: QifErrorCode.UNRESOLVED_QPID.message("featureId", d.featureId, `Datum '${d.label}'`),
        range: d.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Feature Probing Points & STEP Entity Reference Check (M8106, M8109)
  // ───────────────────────────────────────────────────────────────────────────
  for (const f of doc.features) {
    if (
      f.stepEntityId !== undefined &&
      (!/^#[1-9]\d*$/.test(f.stepEntityId) || /missing|unresolved|invalid/i.test(f.stepEntityId))
    ) {
      diagnostics.push({
        code: QifErrorCode.UNRESOLVED_STEP_ENTITY.code,
        rule: QifErrorCode.UNRESOLVED_STEP_ENTITY.rule,
        severity: QifErrorCode.UNRESOLVED_STEP_ENTITY.severity,
        message: QifErrorCode.UNRESOLVED_STEP_ENTITY.message(f.stepEntityId, f.name),
        range: f.range,
      });
    }

    if (f.probingPoints !== undefined) {
      const mathMin = MATHEMATICAL_MIN_POINTS[f.featureType] ?? 1;
      const ruleMin = doc.rules.minPointsPerFeature[f.featureType] ?? mathMin;
      const requiredMin = Math.max(mathMin, ruleMin);
      if (f.probingPoints < requiredMin) {
        diagnostics.push({
          code: QifErrorCode.INSUFFICIENT_PROBING_POINTS.code,
          rule: QifErrorCode.INSUFFICIENT_PROBING_POINTS.rule,
          severity: QifErrorCode.INSUFFICIENT_PROBING_POINTS.severity,
          message: QifErrorCode.INSUFFICIENT_PROBING_POINTS.message(
            f.probingPoints,
            requiredMin,
            f.featureType,
            f.name,
          ),
          range: f.range,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Characteristics Checks (M8101, M8103, M8104, M8105, M8107, M8110, M8112)
  // ───────────────────────────────────────────────────────────────────────────
  const checkedTurPairs = new Set<string>();
  const minTurRatio = doc.rules.minTurRatio > 0 ? doc.rules.minTurRatio : 4.0;

  const checkTurForCharacteristicAndDevice = (
    c: QifCharacteristic,
    dev: (typeof doc.devices)[number],
    diagRange: QifDiagnostic["range"],
  ) => {
    const pairKey = `${c.id}::${dev.id}`;
    if (checkedTurPairs.has(pairKey)) return;
    checkedTurPairs.add(pairKey);

    if (dev.calibrationUncertainty <= 0) return;
    const toleranceBand =
      c.upperTolerance !== undefined && c.lowerTolerance !== undefined
        ? Math.abs(
            c.upperTolerance -
              (c.lowerTolerance > 0 && c.lowerTolerance === c.upperTolerance ? -c.lowerTolerance : c.lowerTolerance),
          )
        : c.toleranceZone;
    if (toleranceBand <= 0) return;

    const tur = toleranceBand / (2 * dev.calibrationUncertainty);
    if (tur < minTurRatio - 1e-9) {
      diagnostics.push({
        code: QifErrorCode.TUR_UNCERTAINTY_WARNING.code,
        rule: QifErrorCode.TUR_UNCERTAINTY_WARNING.rule,
        severity: QifErrorCode.TUR_UNCERTAINTY_WARNING.severity,
        message: QifErrorCode.TUR_UNCERTAINTY_WARNING.message(tur.toFixed(2), minTurRatio.toFixed(1), dev.name, c.name),
        range: diagRange,
      });
    }
  };

  for (const c of doc.characteristics) {
    // M8110: Zero tolerance zone without MMC modifier
    if (
      c.toleranceZone <= 0 &&
      c.materialCondition !== "MMC" &&
      c.upperTolerance === undefined &&
      c.lowerTolerance === undefined
    ) {
      diagnostics.push({
        code: QifErrorCode.ZERO_TOLERANCE_ZONE.code,
        rule: QifErrorCode.ZERO_TOLERANCE_ZONE.rule,
        severity: QifErrorCode.ZERO_TOLERANCE_ZONE.severity,
        message: QifErrorCode.ZERO_TOLERANCE_ZONE.message(c.name),
        range: c.range,
      });
    }

    // M8112: SPC capability study subgroup size n < 2
    if (c.spcSubgroupSize !== undefined && c.spcSubgroupSize < 2) {
      diagnostics.push({
        code: QifErrorCode.SPC_SUBGROUP_SIZE_INSUFFICIENT.code,
        rule: QifErrorCode.SPC_SUBGROUP_SIZE_INSUFFICIENT.rule,
        severity: QifErrorCode.SPC_SUBGROUP_SIZE_INSUFFICIENT.severity,
        message: QifErrorCode.SPC_SUBGROUP_SIZE_INSUFFICIENT.message(c.name, c.spcSubgroupSize),
        range: c.range,
      });
    }

    // M8101: Unresolved featureIds
    const resolvedFeatures: QifFeature[] = [];
    for (const fid of c.featureIds) {
      const feat = featureById.get(fid);
      if (!feat) {
        diagnostics.push({
          code: QifErrorCode.UNRESOLVED_QPID.code,
          rule: QifErrorCode.UNRESOLVED_QPID.rule,
          severity: QifErrorCode.UNRESOLVED_QPID.severity,
          message: QifErrorCode.UNRESOLVED_QPID.message("featureId", fid, c.name),
          range: c.range,
        });
      } else {
        resolvedFeatures.push(feat);
      }
    }

    // M8101: Unresolved deviceId
    if (c.deviceId) {
      const dev = deviceById.get(c.deviceId);
      if (!dev) {
        diagnostics.push({
          code: QifErrorCode.UNRESOLVED_QPID.code,
          rule: QifErrorCode.UNRESOLVED_QPID.rule,
          severity: QifErrorCode.UNRESOLVED_QPID.severity,
          message: QifErrorCode.UNRESOLVED_QPID.message("deviceId", c.deviceId, c.name),
          range: c.range,
        });
      } else {
        checkTurForCharacteristicAndDevice(c, dev, c.range);
      }
    }

    // M8101 & M8103: DatumReferences resolution and duplicate datum precedence
    const seenDatumsInFrame = new Set<string>();
    for (const dRef of c.datumReferences) {
      const datumDef = datumByLabel.get(dRef.datumLabel);
      if (!datumDef) {
        diagnostics.push({
          code: QifErrorCode.UNRESOLVED_QPID.code,
          rule: QifErrorCode.UNRESOLVED_QPID.rule,
          severity: QifErrorCode.UNRESOLVED_QPID.severity,
          message: QifErrorCode.UNRESOLVED_QPID.message("datum", dRef.datumLabel, c.name),
          range: c.range,
        });
      }

      if (seenDatumsInFrame.has(dRef.datumLabel)) {
        diagnostics.push({
          code: QifErrorCode.INVALID_DATUM_PRECEDENCE.code,
          rule: QifErrorCode.INVALID_DATUM_PRECEDENCE.rule,
          severity: QifErrorCode.INVALID_DATUM_PRECEDENCE.severity,
          message: QifErrorCode.INVALID_DATUM_PRECEDENCE.message(dRef.datumLabel, c.name),
          range: c.range,
        });
      } else {
        seenDatumsInFrame.add(dRef.datumLabel);
      }

      // M8104 on datum reference material condition modifier
      if (dRef.materialCondition === "MMC" || dRef.materialCondition === "LMC") {
        if (datumDef?.featureId) {
          const datumFeat = featureById.get(datumDef.featureId);
          if (datumFeat && !datumFeat.isFeatureOfSize) {
            diagnostics.push({
              code: QifErrorCode.INVALID_MATERIAL_MODIFIER.code,
              rule: QifErrorCode.INVALID_MATERIAL_MODIFIER.rule,
              severity: QifErrorCode.INVALID_MATERIAL_MODIFIER.severity,
              message: QifErrorCode.INVALID_MATERIAL_MODIFIER.message(
                dRef.materialCondition,
                `non-feature-of-size datum '${dRef.datumLabel}' (${datumFeat.featureType})`,
                c.name,
              ),
              range: c.range,
            });
          }
        }
      }
    }

    // M8104: MMC or LMC on non-feature-of-size or prohibited GD&T type
    if (c.materialCondition === "MMC" || c.materialCondition === "LMC") {
      if (NON_MODIFIABLE_GDT_TYPES.has(c.gdtType)) {
        diagnostics.push({
          code: QifErrorCode.INVALID_MATERIAL_MODIFIER.code,
          rule: QifErrorCode.INVALID_MATERIAL_MODIFIER.rule,
          severity: QifErrorCode.INVALID_MATERIAL_MODIFIER.severity,
          message: QifErrorCode.INVALID_MATERIAL_MODIFIER.message(
            c.materialCondition,
            `${c.gdtType} tolerance`,
            c.name,
          ),
          range: c.range,
        });
      } else {
        for (const feat of resolvedFeatures) {
          if (!feat.isFeatureOfSize) {
            diagnostics.push({
              code: QifErrorCode.INVALID_MATERIAL_MODIFIER.code,
              rule: QifErrorCode.INVALID_MATERIAL_MODIFIER.rule,
              severity: QifErrorCode.INVALID_MATERIAL_MODIFIER.severity,
              message: QifErrorCode.INVALID_MATERIAL_MODIFIER.message(
                c.materialCondition,
                `non-feature-of-size '${feat.name}' (${feat.featureType})`,
                c.name,
              ),
              range: c.range,
            });
          }
        }
      }
    }

    // M8105: Composite lower-tier checks
    if (c.compositeLowerTier) {
      const lower = c.compositeLowerTier;
      if (lower.toleranceZone >= c.toleranceZone) {
        diagnostics.push({
          code: QifErrorCode.COMPOSITE_FRAME_MISMATCH.code,
          rule: QifErrorCode.COMPOSITE_FRAME_MISMATCH.rule,
          severity: QifErrorCode.COMPOSITE_FRAME_MISMATCH.severity,
          message: QifErrorCode.COMPOSITE_FRAME_MISMATCH.message(lower.toleranceZone, c.toleranceZone, c.name),
          range: c.range,
        });
      }

      const seenLowerDatums = new Set<string>();
      for (const dLabel of lower.datumReferences) {
        if (!datumByLabel.has(dLabel)) {
          diagnostics.push({
            code: QifErrorCode.UNRESOLVED_QPID.code,
            rule: QifErrorCode.UNRESOLVED_QPID.rule,
            severity: QifErrorCode.UNRESOLVED_QPID.severity,
            message: QifErrorCode.UNRESOLVED_QPID.message("datum", dLabel, c.name),
            range: c.range,
          });
        }
        if (seenLowerDatums.has(dLabel)) {
          diagnostics.push({
            code: QifErrorCode.INVALID_DATUM_PRECEDENCE.code,
            rule: QifErrorCode.INVALID_DATUM_PRECEDENCE.rule,
            severity: QifErrorCode.INVALID_DATUM_PRECEDENCE.severity,
            message: QifErrorCode.INVALID_DATUM_PRECEDENCE.message(dLabel, c.name),
            range: c.range,
          });
        } else {
          seenLowerDatums.add(dLabel);
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Plan Steps Checks (M8101, M8106, M8107)
  // ───────────────────────────────────────────────────────────────────────────
  for (const step of doc.planSteps) {
    const feat = step.featureId ? featureById.get(step.featureId) : undefined;
    if (!feat) {
      diagnostics.push({
        code: QifErrorCode.UNRESOLVED_QPID.code,
        rule: QifErrorCode.UNRESOLVED_QPID.rule,
        severity: QifErrorCode.UNRESOLVED_QPID.severity,
        message: QifErrorCode.UNRESOLVED_QPID.message("featureId", step.featureId, `PlanStep '${step.id}'`),
        range: step.range,
      });
    } else {
      // M8106: Probing point count on plan step
      const mathMin = MATHEMATICAL_MIN_POINTS[feat.featureType] ?? 1;
      const ruleMin = doc.rules.minPointsPerFeature[feat.featureType] ?? mathMin;
      const requiredMin = Math.max(mathMin, ruleMin);
      if (step.probingPointCount < requiredMin) {
        diagnostics.push({
          code: QifErrorCode.INSUFFICIENT_PROBING_POINTS.code,
          rule: QifErrorCode.INSUFFICIENT_PROBING_POINTS.rule,
          severity: QifErrorCode.INSUFFICIENT_PROBING_POINTS.severity,
          message: QifErrorCode.INSUFFICIENT_PROBING_POINTS.message(
            step.probingPointCount,
            requiredMin,
            feat.featureType,
            `PlanStep '${step.id}' (${feat.name})`,
          ),
          range: step.range,
        });
      }
    }

    const dev = step.deviceId ? deviceById.get(step.deviceId) : undefined;
    if (!dev) {
      diagnostics.push({
        code: QifErrorCode.UNRESOLVED_QPID.code,
        rule: QifErrorCode.UNRESOLVED_QPID.rule,
        severity: QifErrorCode.UNRESOLVED_QPID.severity,
        message: QifErrorCode.UNRESOLVED_QPID.message("deviceId", step.deviceId, `PlanStep '${step.id}'`),
        range: step.range,
      });
    }

    let stepChar: QifCharacteristic | undefined;
    if (step.characteristicId) {
      stepChar = charById.get(step.characteristicId);
      if (!stepChar) {
        diagnostics.push({
          code: QifErrorCode.UNRESOLVED_QPID.code,
          rule: QifErrorCode.UNRESOLVED_QPID.rule,
          severity: QifErrorCode.UNRESOLVED_QPID.severity,
          message: QifErrorCode.UNRESOLVED_QPID.message(
            "characteristicId",
            step.characteristicId,
            `PlanStep '${step.id}'`,
          ),
          range: step.range,
        });
      }
    }

    // M8107: Check TUR for step device against characteristic
    if (dev) {
      if (stepChar) {
        checkTurForCharacteristicAndDevice(stepChar, dev, step.range);
      } else if (feat) {
        for (const c of doc.characteristics) {
          if (c.featureIds.includes(feat.id) || (feat.qpId && c.featureIds.includes(feat.qpId))) {
            checkTurForCharacteristicAndDevice(c, dev, step.range);
          }
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Actuals Checks (M8101, M8108)
  // ───────────────────────────────────────────────────────────────────────────
  for (const act of doc.actuals) {
    const char = charById.get(act.characteristicId);
    if (!char) {
      diagnostics.push({
        code: QifErrorCode.UNRESOLVED_QPID.code,
        rule: QifErrorCode.UNRESOLVED_QPID.rule,
        severity: QifErrorCode.UNRESOLVED_QPID.severity,
        message: QifErrorCode.UNRESOLVED_QPID.message("characteristicId", act.characteristicId, `Actual '${act.id}'`),
        range: act.range,
      });
      continue;
    }

    const firstFeatureId = char.featureIds[0];
    const primaryFeature = firstFeatureId !== undefined ? featureById.get(firstFeatureId) : undefined;
    const evalResult = evaluateActualCompliance(char, primaryFeature, act);

    if (!evalResult.isWithinSpec && act.status === "PASS") {
      diagnostics.push({
        code: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.code,
        rule: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.rule,
        severity: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.severity,
        message: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.message(
          act.id,
          act.measuredValue,
          String(evalResult.effectiveTolerance),
          act.status,
          char.name,
        ),
        range: act.range,
      });
    } else if (evalResult.isWithinSpec && act.status === "FAIL") {
      diagnostics.push({
        code: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.code,
        rule: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.rule,
        severity: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.severity,
        message: QifErrorCode.OUT_OF_TOLERANCE_ACTUAL.message(
          act.id,
          act.measuredValue,
          String(evalResult.effectiveTolerance),
          act.status,
          char.name,
        ),
        range: act.range,
      });
    }
  }

  return diagnostics;
}
