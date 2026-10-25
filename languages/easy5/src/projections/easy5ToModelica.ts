// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5Model } from "../types.js";

/**
 * Projects an EASY5 model into clean, executable Modelica 3.x code.
 */
export function easy5ToModelica(model: Easy5Model): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`// Modelica projection generated from EASY5 model: ${model.name}`);
  if (model.title) {
    lines.push(`// Title: ${model.title}`);
  }
  lines.push(`model ${modelName}`);

  // 1. Declarations of Modelica.Blocks components
  lines.push("  // Component instances");
  for (const [compId, comp] of model.components) {
    const t = comp.type.toUpperCase().replace(/^GP\//, "");
    switch (t) {
      case "GA": {
        const k = typeof comp.parameters["K"] === "number" ? comp.parameters["K"] : 1.0;
        lines.push(`  Modelica.Blocks.Math.Gain ${compId}(k = ${k});`);
        break;
      }

      case "SJ": {
        lines.push(`  Modelica.Blocks.Math.Add ${compId};`);
        break;
      }

      case "IN": {
        const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
        const s0 =
          comp.initialStates["S1"] ?? (typeof comp.parameters["S0"] === "number" ? comp.parameters["S0"] : 0.0);
        lines.push(`  Modelica.Blocks.Continuous.Integrator ${compId}(k = ${gain}, y_start = ${s0});`);
        break;
      }

      case "TF": {
        const num = Array.isArray(comp.parameters["NUM"]) ? (comp.parameters["NUM"] as number[]) : [1.0];
        const den = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];
        lines.push(
          `  Modelica.Blocks.Continuous.TransferFunction ${compId}(b = {${num.join(", ")}}, a = {${den.join(", ")}});`,
        );
        break;
      }

      case "LA": {
        const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
        const tau1 = typeof comp.parameters["TAU1"] === "number" ? comp.parameters["TAU1"] : 0.0;
        const tau2 = typeof comp.parameters["TAU2"] === "number" ? comp.parameters["TAU2"] : 1.0;
        lines.push(
          `  Modelica.Blocks.Continuous.TransferFunction ${compId}(b = {${gain * tau1}, ${gain}}, a = {${tau2}, 1.0});`,
        );
        break;
      }

      case "LM": {
        const ul = typeof comp.parameters["UL"] === "number" ? comp.parameters["UL"] : 1.0;
        const ll = typeof comp.parameters["LL"] === "number" ? comp.parameters["LL"] : -1.0;
        lines.push(`  Modelica.Blocks.Nonlinear.Limiter ${compId}(uMax = ${ul}, uMin = ${ll});`);
        break;
      }

      default: {
        // Fallback generic block with real input u and real output y
        lines.push(`  Modelica.Blocks.Interfaces.RealInput ${compId}_u;`);
        lines.push(`  Modelica.Blocks.Interfaces.RealOutput ${compId}_y;`);
        break;
      }
    }
  }

  lines.push("");
  lines.push("equation");

  // 2. Connect equations
  lines.push("  // Inter-component connections");
  for (const conn of model.connections) {
    const fromComp = model.components.get(conn.fromComponent);
    const toComp = model.components.get(conn.toComponent);

    const fromPortNorm = mapPortToModelica(fromComp?.type, conn.fromPort, false);
    const toPortNorm = mapPortToModelica(toComp?.type, conn.toPort, true);

    lines.push(`  connect(${conn.fromComponent}.${fromPortNorm}, ${conn.toComponent}.${toPortNorm});`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

function mapPortToModelica(compType: string | undefined, portName: string, isTarget: boolean): string {
  const t = (compType || "").toUpperCase().replace(/^GP\//, "");
  const p = portName.toUpperCase();

  if (t === "SJ") {
    if (p === "IN1") return "u1";
    if (p === "IN2") return "u2";
    if (p === "OUT") return "y";
  }

  if (isTarget) {
    return p === "IN" ? "u" : p.toLowerCase();
  } else {
    return p === "OUT" ? "y" : p.toLowerCase();
  }
}
