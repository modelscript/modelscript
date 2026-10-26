// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ibis — Pre-Flight Signal Integrity & Buffer Linter (Codes M8303, M8305, M8316–M8325).
 */

import { IbisErrorCode } from "../errors.js";
import type { IbisDeck, TableRow } from "../types.js";

export interface IbisRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface IbisDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: IbisRange;
}

export function lintIbis(deck: IbisDeck): IbisDiagnostic[] {
  const diags: IbisDiagnostic[] = [];

  // 1. M8322: No models defined
  if (deck.models.size === 0) {
    diags.push({
      code: IbisErrorCode.NO_MODELS_DEFINED.code,
      rule: IbisErrorCode.NO_MODELS_DEFINED.rule,
      severity: IbisErrorCode.NO_MODELS_DEFINED.severity,
      message: IbisErrorCode.NO_MODELS_DEFINED.message(),
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
  }

  // 2. Component and Pin Checks
  for (const [, comp] of deck.components) {
    if (comp.pins.size === 0) {
      diags.push({
        code: IbisErrorCode.MISSING_COMPONENT_PINS.code,
        rule: IbisErrorCode.MISSING_COMPONENT_PINS.rule,
        severity: IbisErrorCode.MISSING_COMPONENT_PINS.severity,
        message: IbisErrorCode.MISSING_COMPONENT_PINS.message(comp.name),
        range: { startLine: comp.line, startCol: 1, endLine: comp.line, endCol: 20 },
      });
    }

    // Check package parasitics
    if (comp.package.rPkg.typ < 0) {
      diags.push({
        code: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.code,
        rule: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.rule,
        severity: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.severity,
        message: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.message(comp.name, "R_pkg", String(comp.package.rPkg.typ)),
        range: { startLine: comp.line, startCol: 1, endLine: comp.line, endCol: 20 },
      });
    }
    if (comp.package.lPkg.typ < 0) {
      diags.push({
        code: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.code,
        rule: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.rule,
        severity: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.severity,
        message: IbisErrorCode.NEGATIVE_PACKAGE_PARASITIC.message(comp.name, "L_pkg", String(comp.package.lPkg.typ)),
        range: { startLine: comp.line, startCol: 1, endLine: comp.line, endCol: 20 },
      });
    }

    // Check Pin Model bindings
    for (const [, pin] of comp.pins) {
      const mName = pin.modelName;
      // Skip standard power/gnd pins
      if (mName.toUpperCase() !== "POWER" && mName.toUpperCase() !== "GND" && mName.toUpperCase() !== "NC") {
        if (!deck.models.has(mName)) {
          diags.push({
            code: IbisErrorCode.MISSING_PIN_MODEL_BINDING.code,
            rule: IbisErrorCode.MISSING_PIN_MODEL_BINDING.rule,
            severity: IbisErrorCode.MISSING_PIN_MODEL_BINDING.severity,
            message: IbisErrorCode.MISSING_PIN_MODEL_BINDING.message(pin.pinName, mName),
            range: { startLine: pin.line, startCol: 1, endLine: pin.line, endCol: 20 },
          });
        }
      }
    }
  }

  // 3. Model Checks
  for (const [, mod] of deck.models) {
    // Voltage Range
    if (mod.voltageRange.min > mod.voltageRange.max) {
      diags.push({
        code: IbisErrorCode.INVALID_VOLTAGE_RANGE.code,
        rule: IbisErrorCode.INVALID_VOLTAGE_RANGE.rule,
        severity: IbisErrorCode.INVALID_VOLTAGE_RANGE.severity,
        message: IbisErrorCode.INVALID_VOLTAGE_RANGE.message(mod.name, mod.voltageRange.min, mod.voltageRange.max),
        range: { startLine: mod.line, startCol: 1, endLine: mod.line, endCol: 20 },
      });
    }

    // C_comp
    if (mod.cComp.typ <= 0) {
      diags.push({
        code: IbisErrorCode.NEGATIVE_DIE_CAPACITANCE.code,
        rule: IbisErrorCode.NEGATIVE_DIE_CAPACITANCE.rule,
        severity: IbisErrorCode.NEGATIVE_DIE_CAPACITANCE.severity,
        message: IbisErrorCode.NEGATIVE_DIE_CAPACITANCE.message(mod.name, String(mod.cComp.typ)),
        range: { startLine: mod.line, startCol: 1, endLine: mod.line, endCol: 20 },
      });
    }

    // Missing Pullup/Pulldown on drivers
    const isDriver = mod.modelType === "Output" || mod.modelType === "I/O" || mod.modelType === "3-state";
    if (isDriver) {
      const hasTables = (mod.pullup && mod.pullup.length > 0) || (mod.pulldown && mod.pulldown.length > 0);
      if (!hasTables && !mod.ramp) {
        diags.push({
          code: IbisErrorCode.MISSING_PULLUP_PULLDOWN.code,
          rule: IbisErrorCode.MISSING_PULLUP_PULLDOWN.rule,
          severity: IbisErrorCode.MISSING_PULLUP_PULLDOWN.severity,
          message: IbisErrorCode.MISSING_PULLUP_PULLDOWN.message(mod.name, mod.modelType),
          range: { startLine: mod.line, startCol: 1, endLine: mod.line, endCol: 20 },
        });
      }
    }

    // Check monotonic slope on pulldown table
    checkMonotonicTable(diags, mod.name, "Pulldown", mod.pulldown, mod.line);
    checkMonotonicTable(diags, mod.name, "GND Clamp", mod.gndClamp, mod.line);
  }

  return diags;
}

function checkMonotonicTable(
  diags: IbisDiagnostic[],
  modelName: string,
  tableName: string,
  table: TableRow[] | undefined,
  line: number,
): void {
  if (!table || table.length < 2) return;

  for (let i = 0; i < table.length - 1; i++) {
    const p0 = table[i]!;
    const p1 = table[i + 1]!;
    // In pulldown and ground clamp, current should monotonically increase with voltage
    if (p1.vOrT > p0.vOrT && p1.typ < p0.typ - 1e-4) {
      diags.push({
        code: IbisErrorCode.NON_MONOTONIC_IV_CURVE.code,
        rule: IbisErrorCode.NON_MONOTONIC_IV_CURVE.rule,
        severity: IbisErrorCode.NON_MONOTONIC_IV_CURVE.severity,
        message: IbisErrorCode.NON_MONOTONIC_IV_CURVE.message(modelName, tableName, p0.vOrT, p1.vOrT),
        range: { startLine: line, startCol: 1, endLine: line, endCol: 20 },
      });
      break; // Only report once per table
    }
  }
}
