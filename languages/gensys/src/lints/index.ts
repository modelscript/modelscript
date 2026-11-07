// SPDX-License-Identifier: AGPL-3.0-or-later

import { GensysErrorCode } from "../errors.js";
import type { GensysModel } from "../types.js";

export interface GensysDiagnostic {
  code: string;
  rule?: string;
  severity: "error" | "warning";
  message: string;
}

export function lintGensysModel(model: GensysModel): GensysDiagnostic[] {
  const diagnostics: GensysDiagnostic[] = [];

  for (const [name, body] of model.bodies.entries()) {
    if (body.mass <= 0) {
      diagnostics.push({
        code: GensysErrorCode.INVALID_BODY_MASS.code,
        rule: GensysErrorCode.INVALID_BODY_MASS.rule,
        severity: GensysErrorCode.INVALID_BODY_MASS.severity,
        message: GensysErrorCode.INVALID_BODY_MASS.message(name, body.mass),
      });
    }

    if (body.inertia.jx <= 0 || body.inertia.jy <= 0 || body.inertia.jz <= 0) {
      diagnostics.push({
        code: GensysErrorCode.NON_POSITIVE_INERTIA.code,
        rule: GensysErrorCode.NON_POSITIVE_INERTIA.rule,
        severity: GensysErrorCode.NON_POSITIVE_INERTIA.severity,
        message: GensysErrorCode.NON_POSITIVE_INERTIA.message(name),
      });
    }
  }

  for (const [name, coupling] of model.couplings.entries()) {
    if (!model.bodies.has(coupling.body1) && !model.wheelsets.has(coupling.body1) && coupling.body1 !== "ground") {
      diagnostics.push({
        code: GensysErrorCode.DANGLING_BODY1_REFERENCE.code,
        rule: GensysErrorCode.DANGLING_BODY1_REFERENCE.rule,
        severity: GensysErrorCode.DANGLING_BODY1_REFERENCE.severity,
        message: GensysErrorCode.DANGLING_BODY1_REFERENCE.message(name, coupling.body1),
      });
    }
    if (!model.bodies.has(coupling.body2) && !model.wheelsets.has(coupling.body2) && coupling.body2 !== "ground") {
      diagnostics.push({
        code: GensysErrorCode.DANGLING_BODY2_REFERENCE.code,
        rule: GensysErrorCode.DANGLING_BODY2_REFERENCE.rule,
        severity: GensysErrorCode.DANGLING_BODY2_REFERENCE.severity,
        message: GensysErrorCode.DANGLING_BODY2_REFERENCE.message(name, coupling.body2),
      });
    }
  }

  if (
    model.track &&
    (model.track.nominalGauge <= 0 ||
      !Number.isFinite(model.track.nominalGauge) ||
      model.track.nominalGauge < 0.5 ||
      model.track.nominalGauge > 3.0)
  ) {
    diagnostics.push({
      code: GensysErrorCode.INVALID_TRACK_GAUGE.code,
      rule: GensysErrorCode.INVALID_TRACK_GAUGE.rule,
      severity: GensysErrorCode.INVALID_TRACK_GAUGE.severity,
      message: GensysErrorCode.INVALID_TRACK_GAUGE.message(model.track.nominalGauge),
    });
  }

  if (model.track && model.track.points.length >= 2) {
    for (let i = 1; i < model.track.points.length; i++) {
      const p0 = model.track.points[i - 1]!;
      const p1 = model.track.points[i]!;
      const dx = p1.distance - p0.distance;
      if (
        dx <= 1e-6 ||
        Math.abs(p1.cant - p0.cant) / dx > 0.05 ||
        Math.abs(p1.curvature - p0.curvature) / dx > 0.05
      ) {
        diagnostics.push({
          code: GensysErrorCode.DISCONTINUOUS_TRACK_CANT.code,
          rule: GensysErrorCode.DISCONTINUOUS_TRACK_CANT.rule,
          severity: GensysErrorCode.DISCONTINUOUS_TRACK_CANT.severity,
          message: GensysErrorCode.DISCONTINUOUS_TRACK_CANT.message(),
        });
        break;
      }
    }
  }

  let referenceWheelsetGauge: number | undefined;
  for (const [wsName, ws] of model.wheelsets.entries()) {
    if (ws.mass <= 0) {
      diagnostics.push({
        code: GensysErrorCode.INVALID_BODY_MASS.code,
        rule: GensysErrorCode.INVALID_BODY_MASS.rule,
        severity: GensysErrorCode.INVALID_BODY_MASS.severity,
        message: GensysErrorCode.INVALID_BODY_MASS.message(wsName, ws.mass),
      });
    }
    if (ws.gauge <= 0 || !Number.isFinite(ws.gauge) || ws.gauge < 0.5 || ws.gauge > 3.0) {
      diagnostics.push({
        code: GensysErrorCode.INVALID_TRACK_GAUGE.code,
        rule: GensysErrorCode.INVALID_TRACK_GAUGE.rule,
        severity: GensysErrorCode.INVALID_TRACK_GAUGE.severity,
        message: GensysErrorCode.INVALID_TRACK_GAUGE.message(ws.gauge),
      });
    } else {
      if (
        model.track &&
        model.track.nominalGauge >= 0.5 &&
        model.track.nominalGauge <= 3.0 &&
        Math.abs(ws.gauge - model.track.nominalGauge) > 0.005
      ) {
        diagnostics.push({
          code: GensysErrorCode.GAUGE_MISMATCH.code,
          rule: GensysErrorCode.GAUGE_MISMATCH.rule,
          severity: GensysErrorCode.GAUGE_MISMATCH.severity,
          message: GensysErrorCode.GAUGE_MISMATCH.message(ws.gauge, model.track.nominalGauge),
        });
      } else if (!model.track) {
        if (referenceWheelsetGauge === undefined) {
          referenceWheelsetGauge = ws.gauge;
        } else if (Math.abs(ws.gauge - referenceWheelsetGauge) > 0.005) {
          diagnostics.push({
            code: GensysErrorCode.GAUGE_MISMATCH.code,
            rule: GensysErrorCode.GAUGE_MISMATCH.rule,
            severity: GensysErrorCode.GAUGE_MISMATCH.severity,
            message: GensysErrorCode.GAUGE_MISMATCH.message(ws.gauge, referenceWheelsetGauge),
          });
        }
      }
    }

    if (ws.conicity > 0.4) {
      diagnostics.push({
        code: GensysErrorCode.HUNTING_CONICITY_RISK.code,
        rule: GensysErrorCode.HUNTING_CONICITY_RISK.rule,
        severity: GensysErrorCode.HUNTING_CONICITY_RISK.severity,
        message: GensysErrorCode.HUNTING_CONICITY_RISK.message(ws.conicity),
      });
    }

    if (ws.axleLoad !== undefined && ws.axleLoad <= 0) {
      diagnostics.push({
        code: GensysErrorCode.ZERO_AXLE_LOAD.code,
        rule: GensysErrorCode.ZERO_AXLE_LOAD.rule,
        severity: GensysErrorCode.ZERO_AXLE_LOAD.severity,
        message: GensysErrorCode.ZERO_AXLE_LOAD.message(ws.axleLoad),
      });
    }

    const profileLower = ws.profile?.trim().toLowerCase() ?? "";
    if (
      (ws.profile !== undefined &&
        (profileLower === "" ||
          profileLower.includes("unclosed") ||
          profileLower.includes("discontinuous") ||
          profileLower.includes("invalid"))) ||
      ws.conicity <= 0 ||
      ws.wheelRadius <= 0
    ) {
      diagnostics.push({
        code: GensysErrorCode.UNCLOSED_RAIL_PROFILE.code,
        rule: GensysErrorCode.UNCLOSED_RAIL_PROFILE.rule,
        severity: GensysErrorCode.UNCLOSED_RAIL_PROFILE.severity,
        message: GensysErrorCode.UNCLOSED_RAIL_PROFILE.message(ws.profile || wsName),
      });
    }
  }

  return diagnostics;
}

