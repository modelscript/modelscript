// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Synchronizes parameter tuning (resistors, capacitors, inductors, voltage/current sources)
 * and component lifecycle changes from Modelica back into SPICE netlists (.cir, .net).
 */

import { PolyglotTransformer } from "@modelscript/runtime";
import { parseSpice } from "../parser/spice-parser.js";
import type { ParsedModelicaElectrical, ReconciledChange, SyncOptions, SyncResult } from "./types.js";

export function parseModelicaElectrical(sourceText: string): ParsedModelicaElectrical {
  const lines = sourceText.split(/\r?\n/);
  const components = new Map<
    string,
    { name: string; kind: "R" | "C" | "L" | "V" | "I" | "Other"; fullType: string; value: number }
  >();
  const connections: { source: string; target: string }[] = [];
  let modelName = "SpiceModel";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    if (line.startsWith("model ") || line.startsWith("block ")) {
      const parts = line.split(/\s+/);
      if (parts[1]) modelName = parts[1].replace(/;$/, "");
      continue;
    }

    if (line.startsWith("connect(") && line.endsWith(");")) {
      const inner = line.slice("connect(".length, -2);
      const parts = inner.split(",").map((s) => s.trim());
      if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
        connections.push({ source: parts[0], target: parts[1] });
      }
      continue;
    }

    // Component declarations: e.g. Modelica.Electrical.Analog.Basic.Resistor R1(R=2200);
    if (line.includes("Modelica.Electrical.Analog.") && line.endsWith(";")) {
      const declStr = line.slice(0, -1).trim();
      const openParen = declStr.indexOf("(");
      let typeAndName = "";
      let modStr = "";

      if (openParen !== -1 && declStr.endsWith(")")) {
        typeAndName = declStr.slice(0, openParen).trim();
        modStr = declStr.slice(openParen + 1, -1).trim();
      } else {
        typeAndName = declStr;
      }

      const tokens = typeAndName.split(/\s+/);
      const fullType = tokens[tokens.length - 2];
      const name = tokens[tokens.length - 1];
      if (fullType !== undefined && name !== undefined) {
        let kind: "R" | "C" | "L" | "V" | "I" | "Other" = "Other";
        if (fullType.includes("Resistor")) kind = "R";
        else if (fullType.includes("Capacitor")) kind = "C";
        else if (fullType.includes("Inductor")) kind = "L";
        else if (fullType.includes("Voltage")) kind = "V";
        else if (fullType.includes("Current")) kind = "I";

        let val = 1.0;
        const eqIdx = modStr.indexOf("=");
        if (eqIdx !== -1) {
          const rawNum = parseFloat(modStr.slice(eqIdx + 1).trim());
          if (!isNaN(rawNum)) val = rawNum;
        }

        components.set(name.toUpperCase(), { name, kind, fullType, value: val });
      }
    }
  }

  return { name: modelName, components, connections };
}

export function synchronizeModelicaToSpice(
  originalSpiceText: string,
  modifiedModelicaText: string,
  options?: SyncOptions,
): SyncResult {
  const circuit = parseSpice(originalSpiceText);
  const parsedModelica = parseModelicaElectrical(modifiedModelicaText);
  const transformer = new PolyglotTransformer();
  const changes: ReconciledChange[] = [];
  const strategy = options?.strategy ?? "target-wins";

  const updatedValues = new Map<string, number>();
  const existingCompNames = new Set<string>();

  // 1. Identify parameter modifications across existing components
  for (const comp of circuit.components) {
    const normName = comp.name.toUpperCase();
    existingCompNames.add(normName);

    const moComp = parsedModelica.components.get(normName);
    if (moComp) {
      const oldVal = comp.value ?? 1.0;
      const newVal = moComp.value;

      if (newVal !== oldVal) {
        const resolved = resolveParameterConflict(transformer, normName, oldVal, newVal, strategy, options);
        updatedValues.set(normName, resolved);
        changes.push({
          target: "parameter",
          elementId: comp.name,
          property: "value",
          sourceOldVal: oldVal,
          targetNewVal: newVal,
          reconciledVal: resolved,
          strategy,
        });
      }
    }
  }

  // 2. Identify newly added components in Modelica
  const addedComponents: { line: string; name: string }[] = [];
  for (const [normName, moComp] of parsedModelica.components) {
    if (!existingCompNames.has(normName) && moComp.name.toLowerCase() !== "ground") {
      // Create new component line, e.g. R_new n1 n2 1000
      const compLine = `${moComp.name} net_${moComp.name}_p net_${moComp.name}_n ${moComp.value}`;
      addedComponents.push({ line: compLine, name: moComp.name });
      changes.push({
        target: "component",
        elementId: moComp.name,
        reconciledVal: moComp.value,
        strategy,
      });
    }
  }

  // 3. Surgical in-place update of SPICE netlist text preserving comments, formatting, and directives
  const lines = originalSpiceText.split(/\r?\n/);
  const outputLines: string[] = [];
  let endDirectiveIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed.toUpperCase() === ".END" || trimmed.toUpperCase().startsWith(".END ")) {
      endDirectiveIndex = outputLines.length;
      outputLines.push(rawLine);
      continue;
    }

    // Skip empty lines or comments (*, ;, //)
    if (
      trimmed === "" ||
      trimmed.startsWith("*") ||
      trimmed.startsWith(";") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith(".")
    ) {
      outputLines.push(rawLine);
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const compName = tokens[0]?.toUpperCase() ?? "";

    const newVal = updatedValues.get(compName);
    if (newVal !== undefined) {
      // In SPICE, 2-terminal device format: NAME N1 N2 VALUE [params]
      // 3-terminal: NAME N1 N2 N3 ...
      // If 4 or more tokens, token 3 is typically the value
      if (tokens.length >= 4) {
        tokens[3] = String(newVal);
      }
      const indentMatch = /^\s*/.exec(rawLine);
      const indent = indentMatch ? indentMatch[0] : "";
      outputLines.push(`${indent}${tokens.join(" ")}`);
    } else {
      outputLines.push(rawLine);
    }
  }

  // If there are newly added components, insert before .END or append
  if (addedComponents.length > 0) {
    const newLines = addedComponents.map((c) => c.line);
    if (endDirectiveIndex !== -1) {
      outputLines.splice(endDirectiveIndex, 0, ...newLines);
    } else {
      outputLines.push(...newLines);
    }
  }

  return {
    updatedText: outputLines.join("\n"),
    changes,
    conflicts: transformer.getConflicts(),
  };
}

function resolveParameterConflict(
  transformer: PolyglotTransformer,
  id: string,
  sourceVal: number,
  targetVal: number,
  strategy: string,
  options?: SyncOptions,
): number {
  transformer.recordConflict(id, sourceVal, targetVal);

  if (strategy === "source-wins") {
    transformer.resolveConflict(id, "source");
    return sourceVal;
  }

  if (strategy === "physics-simplex") {
    const bounds = options?.physicsBounds?.[id];
    const min = bounds?.min ?? Math.min(sourceVal, targetVal) * 0.8;
    const max = bounds?.max ?? Math.max(sourceVal, targetVal) * 1.2;
    transformer.resolveConflictPhysics(id, min, max);
    const resolved = transformer.getConflicts().find((c) => c.id === id)?.resolved;
    return typeof resolved === "number" ? resolved : targetVal;
  }

  transformer.resolveConflict(id, "target");
  return targetVal;
}
