// SPDX-License-Identifier: AGPL-3.0-or-later

import { analyzeMobility } from "../kinematics/mobility.js";
import type { SimpackModel } from "../types.js";

export interface SimpackDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export function lintSimpackModel(model: SimpackModel): SimpackDiagnostic[] {
  const diagnostics: SimpackDiagnostic[] = [];

  for (const [id, body] of model.bodies.entries()) {
    if (body.mass <= 0) {
      diagnostics.push({
        code: "S3001",
        severity: "error",
        message: `Body '${id}' has non-positive mass (${body.mass} kg).`,
      });
    }
  }

  for (const [id, marker] of model.markers.entries()) {
    if (marker.bodyId !== "$inertial" && !model.bodies.has(marker.bodyId)) {
      diagnostics.push({
        code: "S2001",
        severity: "error",
        message: `Marker '${id}' references unknown parent body '${marker.bodyId}'.`,
      });
    }
  }

  for (const [id, joint] of model.joints.entries()) {
    if (!model.markers.has(joint.fromMarker)) {
      diagnostics.push({
        code: "S2002",
        severity: "error",
        message: `Joint '${id}' references unknown from-marker '${joint.fromMarker}'.`,
      });
    }
    if (!model.markers.has(joint.toMarker)) {
      diagnostics.push({
        code: "S2003",
        severity: "error",
        message: `Joint '${id}' references unknown to-marker '${joint.toMarker}'.`,
      });
    }
  }

  const mobility = analyzeMobility(model);
  if (mobility.isOverconstrained) {
    diagnostics.push({
      code: "S4001",
      severity: "warning",
      message: `Mechanism is overconstrained according to Grübler-Kutzbach criterion (Mobility = ${mobility.calculatedMobility} < 0).`,
    });
  }

  return diagnostics;
}
