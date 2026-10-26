// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — Pre-flight Flight Dynamics Diagnostic Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M8901 - M8910) for JSBSim aircraft models.
 */

import { type DiagnosticItem, JsbsimErrorCode } from "../errors.js";
import type { JsbsimDocument } from "../types.js";

export function lintJsbsim(doc: JsbsimDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const model = doc.model;

  // M8901: Missing aircraft name
  if (!model.name || model.name.trim() === "") {
    diagnostics.push({
      code: JsbsimErrorCode.MISSING_AIRCRAFT_NAME.code,
      rule: JsbsimErrorCode.MISSING_AIRCRAFT_NAME.rule,
      severity: JsbsimErrorCode.MISSING_AIRCRAFT_NAME.severity,
      message: JsbsimErrorCode.MISSING_AIRCRAFT_NAME.message(),
      range: model.range,
    });
  }

  // M8902: Reference wing area validation
  if (model.metrics.wingArea <= 0) {
    diagnostics.push({
      code: JsbsimErrorCode.NON_POSITIVE_REFERENCE_AREA.code,
      rule: JsbsimErrorCode.NON_POSITIVE_REFERENCE_AREA.rule,
      severity: JsbsimErrorCode.NON_POSITIVE_REFERENCE_AREA.severity,
      message: JsbsimErrorCode.NON_POSITIVE_REFERENCE_AREA.message(model.metrics.wingArea),
      range: model.metrics.range,
    });
  }

  // M8903: Wingspan and chord validation
  if (model.metrics.wingspan <= 0) {
    diagnostics.push({
      code: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.code,
      rule: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.rule,
      severity: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.severity,
      message: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.message("wingspan", model.metrics.wingspan),
      range: model.metrics.range,
    });
  }
  if (model.metrics.chord <= 0) {
    diagnostics.push({
      code: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.code,
      rule: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.rule,
      severity: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.severity,
      message: JsbsimErrorCode.NON_POSITIVE_WINGSPAN_CHORD.message("chord", model.metrics.chord),
      range: model.metrics.range,
    });
  }

  // M8904: Empty weight validation
  if (model.massBalance.emptyWeight <= 0) {
    diagnostics.push({
      code: JsbsimErrorCode.NON_POSITIVE_EMPTY_WEIGHT.code,
      rule: JsbsimErrorCode.NON_POSITIVE_EMPTY_WEIGHT.rule,
      severity: JsbsimErrorCode.NON_POSITIVE_EMPTY_WEIGHT.severity,
      message: JsbsimErrorCode.NON_POSITIVE_EMPTY_WEIGHT.message(model.massBalance.emptyWeight),
      range: model.massBalance.range,
    });
  }

  // M8905: Inertia tensor validation
  const { ixx, iyy, izz } = model.massBalance;
  if (ixx <= 0 || iyy <= 0 || izz <= 0) {
    diagnostics.push({
      code: JsbsimErrorCode.INVALID_INERTIA_TENSOR.code,
      rule: JsbsimErrorCode.INVALID_INERTIA_TENSOR.rule,
      severity: JsbsimErrorCode.INVALID_INERTIA_TENSOR.severity,
      message: JsbsimErrorCode.INVALID_INERTIA_TENSOR.message(
        `principal moments must be strictly positive (ixx=${ixx}, iyy=${iyy}, izz=${izz})`,
      ),
      range: model.massBalance.range,
    });
  } else if (ixx + iyy < izz || ixx + izz < iyy || iyy + izz < ixx) {
    diagnostics.push({
      code: JsbsimErrorCode.INVALID_INERTIA_TENSOR.code,
      rule: JsbsimErrorCode.INVALID_INERTIA_TENSOR.rule,
      severity: JsbsimErrorCode.INVALID_INERTIA_TENSOR.severity,
      message: JsbsimErrorCode.INVALID_INERTIA_TENSOR.message(
        `moments of inertia violate triangle inequality (Ixx+Iyy >= Izz)`,
      ),
      range: model.massBalance.range,
    });
  }

  // M8906: Missing aerodynamics section
  if (model.aeroCoefficients.length === 0) {
    diagnostics.push({
      code: JsbsimErrorCode.MISSING_AERODYNAMICS_SECTION.code,
      rule: JsbsimErrorCode.MISSING_AERODYNAMICS_SECTION.rule,
      severity: JsbsimErrorCode.MISSING_AERODYNAMICS_SECTION.severity,
      message: JsbsimErrorCode.MISSING_AERODYNAMICS_SECTION.message(),
      range: model.range,
    });
  }

  // M8907: Missing landing gear
  if (model.groundReactions.length === 0) {
    diagnostics.push({
      code: JsbsimErrorCode.MISSING_LANDING_GEAR.code,
      rule: JsbsimErrorCode.MISSING_LANDING_GEAR.rule,
      severity: JsbsimErrorCode.MISSING_LANDING_GEAR.severity,
      message: JsbsimErrorCode.MISSING_LANDING_GEAR.message(),
      range: model.range,
    });
  }

  // M8908: Negative engine thrust
  for (const eng of model.engines) {
    if (eng.maxThrust < 0) {
      diagnostics.push({
        code: JsbsimErrorCode.NEGATIVE_ENGINE_THRUST.code,
        rule: JsbsimErrorCode.NEGATIVE_ENGINE_THRUST.rule,
        severity: JsbsimErrorCode.NEGATIVE_ENGINE_THRUST.severity,
        message: JsbsimErrorCode.NEGATIVE_ENGINE_THRUST.message(eng.name, eng.maxThrust),
        range: eng.range,
      });
    }
  }

  return diagnostics;
}
