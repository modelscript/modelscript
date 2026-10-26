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
    if (!model.bodies.has(coupling.body1) && coupling.body1 !== "ground") {
      diagnostics.push({
        code: GensysErrorCode.DANGLING_BODY1_REFERENCE.code,
        rule: GensysErrorCode.DANGLING_BODY1_REFERENCE.rule,
        severity: GensysErrorCode.DANGLING_BODY1_REFERENCE.severity,
        message: GensysErrorCode.DANGLING_BODY1_REFERENCE.message(name, coupling.body1),
      });
    }
    if (!model.bodies.has(coupling.body2) && coupling.body2 !== "ground") {
      diagnostics.push({
        code: GensysErrorCode.DANGLING_BODY2_REFERENCE.code,
        rule: GensysErrorCode.DANGLING_BODY2_REFERENCE.rule,
        severity: GensysErrorCode.DANGLING_BODY2_REFERENCE.severity,
        message: GensysErrorCode.DANGLING_BODY2_REFERENCE.message(name, coupling.body2),
      });
    }
  }

  return diagnostics;
}
