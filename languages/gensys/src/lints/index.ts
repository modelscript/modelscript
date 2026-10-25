// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GensysModel } from "../types.js";

export interface GensysDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export function lintGensysModel(model: GensysModel): GensysDiagnostic[] {
  const diagnostics: GensysDiagnostic[] = [];

  for (const [name, body] of model.bodies.entries()) {
    if (body.mass <= 0) {
      diagnostics.push({
        code: "G3001",
        severity: "error",
        message: `Body '${name}' has non-positive mass (${body.mass} kg).`,
      });
    }

    if (body.inertia.jx <= 0 || body.inertia.jy <= 0 || body.inertia.jz <= 0) {
      diagnostics.push({
        code: "G3002",
        severity: "error",
        message: `Body '${name}' has non-positive principal inertia tensor components.`,
      });
    }
  }

  for (const [name, coupling] of model.couplings.entries()) {
    if (!model.bodies.has(coupling.body1) && coupling.body1 !== "ground") {
      diagnostics.push({
        code: "G2001",
        severity: "error",
        message: `Coupling '${name}' references unknown body1 '${coupling.body1}'.`,
      });
    }
    if (!model.bodies.has(coupling.body2) && coupling.body2 !== "ground") {
      diagnostics.push({
        code: "G2002",
        severity: "error",
        message: `Coupling '${name}' references unknown body2 '${coupling.body2}'.`,
      });
    }
  }

  return diagnostics;
}
