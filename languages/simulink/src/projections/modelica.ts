// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Production Bidirectional Modelica.Blocks Projection.
 *
 * Translates Simulink control block diagrams directly into standard Modelica 3.x
 * blocks (Modelica.Blocks.Continuous, Modelica.Blocks.Math, Modelica.Blocks.Sources, etc.)
 */

import { parseVectorString } from "../lints/simulink-linters.js";
import type { SimulinkBlock, SimulinkModel, SimulinkSystem } from "../types.js";

export function simulinkToModelica(model: SimulinkModel): string {
  const modelName = sanitizeIdentifier(model.name || "SimulinkExport");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  // Generated automatically by @modelscript/simulink`);
  lines.push(``);

  projectSystemComponents(model.rootSystem, lines, "  ");

  lines.push(`equation`);
  projectSystemConnections(model.rootSystem, lines, "  ");

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

function sanitizeIdentifier(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(clean)) return `b_${clean}`;
  return clean || "unnamed";
}

function projectSystemComponents(system: SimulinkSystem, lines: string[], indent: string): void {
  for (const block of system.blocks.values()) {
    const id = sanitizeIdentifier(block.name);

    switch (block.type) {
      case "Constant": {
        const val = block.parameters.get("Value") ?? 1.0;
        lines.push(`${indent}Modelica.Blocks.Sources.Constant ${id}(k=${val});`);
        break;
      }
      case "Integrator": {
        const ic = block.parameters.get("InitialCondition") ?? 0.0;
        lines.push(`${indent}Modelica.Blocks.Continuous.Integrator ${id}(y_start=${ic});`);
        break;
      }
      case "Gain": {
        const k = block.parameters.get("Gain") ?? 1.0;
        lines.push(`${indent}Modelica.Blocks.Math.Gain ${id}(k=${k});`);
        break;
      }
      case "Sum": {
        const inputs = String(block.parameters.get("Inputs") ?? "++");
        if (inputs === "+-" || inputs === "|+-") {
          lines.push(`${indent}Modelica.Blocks.Math.Feedback ${id};`);
        } else {
          lines.push(`${indent}Modelica.Blocks.Math.Add ${id};`);
        }
        break;
      }
      case "Product": {
        lines.push(`${indent}Modelica.Blocks.Math.Product ${id};`);
        break;
      }
      case "TransferFcn": {
        const numStr = String(block.parameters.get("Numerator") ?? "1");
        const denStr = String(block.parameters.get("Denominator") ?? "[1 1]");
        const num = parseVectorString(numStr);
        const den = parseVectorString(denStr);
        const bStr = num.length > 0 ? `{${num.join(", ")}}` : "{1.0}";
        const aStr = den.length > 0 ? `{${den.join(", ")}}` : "{1.0, 1.0}";
        lines.push(`${indent}Modelica.Blocks.Continuous.TransferFunction ${id}(b=${bStr}, a=${aStr});`);
        break;
      }
      case "UnitDelay": {
        const ic = block.parameters.get("InitialCondition") ?? 0.0;
        const st = block.parameters.get("SampleTime") ?? 0.01;
        lines.push(`${indent}Modelica.Blocks.Discrete.UnitDelay ${id}(y_start=${ic}, samplePeriod=${st});`);
        break;
      }
      case "Inport": {
        lines.push(`${indent}Modelica.Blocks.Interfaces.RealInput ${id};`);
        break;
      }
      case "Outport": {
        lines.push(`${indent}Modelica.Blocks.Interfaces.RealOutput ${id};`);
        break;
      }
      default: {
        // Generic Real pass-through block
        lines.push(`${indent}Modelica.Blocks.Math.Gain ${id}(k=1.0);`);
        break;
      }
    }
  }
  lines.push(``);
}

function projectSystemConnections(system: SimulinkSystem, lines: string[], indent: string): void {
  for (const line of system.lines) {
    const srcId = sanitizeIdentifier(line.srcBlock);
    const srcPort = getModelicaPortName(system.blocks.get(line.srcBlock), line.srcPort, "out");

    if (line.dstBlock) {
      const dstId = sanitizeIdentifier(line.dstBlock);
      const dstPort = getModelicaPortName(system.blocks.get(line.dstBlock), line.dstPort ?? 1, "in");
      lines.push(`${indent}connect(${srcId}.${srcPort}, ${dstId}.${dstPort});`);
    }

    for (const br of line.branches) {
      const dstId = sanitizeIdentifier(br.dstBlock);
      const dstPort = getModelicaPortName(system.blocks.get(br.dstBlock), br.dstPort, "in");
      lines.push(`${indent}connect(${srcId}.${srcPort}, ${dstId}.${dstPort});`);
    }
  }
}

function getModelicaPortName(block: SimulinkBlock | undefined, portNum: number, dir: "in" | "out"): string {
  if (!block) return dir === "in" ? "u" : "y";

  if (dir === "in") {
    if (block.type === "Sum") {
      return portNum === 2 ? "u2" : "u1";
    }
    if (block.type === "Product") {
      return portNum === 2 ? "u2" : "u1";
    }
    if (block.type === "Outport") {
      return "inPort"; // Or just the connector itself
    }
    return "u";
  }

  // dir === 'out'
  return "y";
}
