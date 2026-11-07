// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — CST-Backed Modelica Block Diagram Parser.
 *
 * Uses `parseModelicaCst` from `@modelscript/runtime` to extract class definitions,
 * multi-line component declarations with structured modifications (e.g. `k=5.0`,
 * `b={1.0, 2.0}`), and `connect(...)` equations while stripping line and block comments.
 */

import { parseModelicaCst } from "@modelscript/runtime";
import type { ModelicaComponentDecl, ModelicaConnection, ParsedModelicaModel } from "./types.js";

export function parseModelicaBlocks(sourceText: string): ParsedModelicaModel {
  const cst = parseModelicaCst(sourceText);
  const components = new Map<string, ModelicaComponentDecl>();
  const connections: ModelicaConnection[] = [];

  for (const comp of cst.components) {
    const modifications: Record<string, number | number[] | string> = {};
    for (const [key, valRaw] of Object.entries(comp.modifications)) {
      const trimmed = valRaw.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        const inner = trimmed.slice(1, -1);
        const elems = inner
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !Number.isNaN(n));
        modifications[key] = elems;
      } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        modifications[key] = trimmed.slice(1, -1);
      } else {
        const num = parseFloat(trimmed);
        modifications[key] = Number.isNaN(num) ? trimmed : num;
      }
    }

    components.set(comp.name, {
      name: comp.name,
      typeSpecifier: comp.typeSpecifier,
      modifications,
      variability: comp.typePrefix || undefined,
    });
  }

  for (const conn of cst.connections) {
    connections.push({
      source: conn.from,
      target: conn.to,
    });
  }

  return {
    name: cst.modelName === "ModelicaModel" ? "SimulinkModel" : cst.modelName,
    components,
    connections,
  };
}
