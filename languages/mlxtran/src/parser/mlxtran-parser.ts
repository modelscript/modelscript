// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Character-by-Character Parser & Serializer for Monolix MLXTRAN.
 *
 * Extracts [LONGITUDINAL], input lists, EQUATION blocks, OUTPUT lists, and PK macros.
 */

import type {
  MlxtranDocument,
  MlxtranEquation,
  MlxtranMacro,
  MlxtranMacroKind,
  MlxtranModel,
  MlxtranParameter,
  MlxtranRange,
} from "../types.js";

function stripComments(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      inString = !inString;
    } else if (!inString) {
      if (ch === ";" || (ch === "/" && line[i + 1] === "/")) {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

export function parseMlxtran(source: string): MlxtranDocument {
  const lines = source.split(/\r?\n/);
  const rawBlocks: Record<string, string> = {};

  const inputs: MlxtranParameter[] = [];
  const equations: MlxtranEquation[] = [];
  const macros: MlxtranMacro[] = [];
  const outputs: string[] = [];

  let currentSection = "";
  let currentSubBlock = ""; // "EQUATION", "OUTPUT", "PK", "DESCRIPTION"
  let modelName = "MlxtranModel";
  let description: string | undefined;

  let offset = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = offset;
    const lineEndOffset = offset + rawLine.length;
    offset = lineEndOffset + 1; // +1 for newline

    const cleanLine = stripComments(rawLine).trim();
    if (cleanLine.length === 0) continue;

    // Check for [SECTION] header
    const sectionMatch = cleanLine.match(/^\[([A-Z0-9_]+)\]$/i);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.toUpperCase();
      currentSubBlock = "";
      if (!rawBlocks[currentSection]) {
        rawBlocks[currentSection] = "";
      }
      continue;
    }

    // Check for Sub-block header like EQUATION:, OUTPUT:, PK:, DESCRIPTION:
    const subBlockMatch = cleanLine.match(/^([A-Z0-9_]+)\s*:$/i);
    if (subBlockMatch) {
      currentSubBlock = subBlockMatch[1]!.toUpperCase();
      continue;
    }

    const range: MlxtranRange = {
      startLine: lineIdx + 1,
      startColumn: 1,
      endLine: lineIdx + 1,
      endColumn: rawLine.length + 1,
      startOffset: lineStartOffset,
      endOffset: lineEndOffset,
    };

    // If inside DESCRIPTION:
    if (currentSubBlock === "DESCRIPTION") {
      description = description ? `${description}\n${cleanLine}` : cleanLine;
      continue;
    }

    // Check for input = { ... } (handling nested braces)
    if (/^input\s*=/i.test(cleanLine)) {
      const braceStart = cleanLine.indexOf("{");
      const braceEnd = cleanLine.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd > braceStart) {
        const body = cleanLine.slice(braceStart + 1, braceEnd);
        const items: string[] = [];
        let depth = 0;
        let cur = "";
        for (let j = 0; j < body.length; j++) {
          const c = body[j]!;
          if (c === "{" || c === "(") depth++;
          else if (c === "}" || c === ")") depth--;
          else if (c === "," && depth === 0) {
            items.push(cur.trim());
            cur = "";
            continue;
          }
          cur += c;
        }
        if (cur.trim().length > 0) items.push(cur.trim());

        for (const item of items) {
          const eqIdx = item.indexOf("=");
          if (eqIdx === -1) {
            const pName = item.trim();
            if (pName.length > 0) {
              inputs.push({ name: pName, type: "real", range });
            }
          } else {
            const pName = item.slice(0, eqIdx).trim();
            const metaStr = item
              .slice(eqIdx + 1)
              .trim()
              .replace(/^\{|\}$/g, "")
              .trim();
            let pMin: number | undefined;
            let pMax: number | undefined;
            let pInit: number | undefined;

            for (const kv of metaStr.split(",")) {
              const pair = kv.split("=").map((s) => s.trim());
              const k = pair[0];
              const v = pair[1];
              if (k === "min" && v) pMin = parseFloat(v);
              if (k === "max" && v) pMax = parseFloat(v);
              if (k === "init" && v) pInit = parseFloat(v);
            }

            inputs.push({
              name: pName,
              type: "real",
              min: pMin,
              max: pMax,
              init: pInit,
              range,
            });
          }
        }
      }
      continue;
    }

    // Check for output = { ... }
    const outputMatch = cleanLine.match(/^output\s*=\s*\{([^}]*)\}/i);
    if (outputMatch) {
      const items = outputMatch[1]!.split(",");
      for (const it of items) {
        const trimmed = it.trim();
        if (trimmed.length > 0) outputs.push(trimmed);
      }
      continue;
    }

    // If inside EQUATION: block or line is an assignment
    if (currentSubBlock === "EQUATION" || cleanLine.includes("=")) {
      // Check for macro inside PK or general block
      const macroMatch = cleanLine.match(/^([a-zA-Z0-9_]+)\s*\((.*)\)$/);
      if (
        macroMatch &&
        ["compartment", "depot", "absorption", "elimination", "transfer", "iv", "oral"].includes(
          macroMatch[1]!.toLowerCase(),
        )
      ) {
        const macroKind = macroMatch[1]!.toLowerCase() as MlxtranMacroKind;
        const argStr = macroMatch[2]!;
        const params: Record<string, string> = {};
        for (const pair of argStr.split(",")) {
          const parts = pair.split("=").map((s) => s.trim());
          if (parts[0] && parts[1]) {
            params[parts[0]] = parts[1];
          }
        }
        macros.push({
          kind: macroKind,
          params,
          raw: cleanLine,
          range,
        });
        continue;
      }

      // Check for equation: lhs = rhs
      const eqIdx = cleanLine.indexOf("=");
      if (eqIdx !== -1) {
        const lhs = cleanLine.slice(0, eqIdx).trim();
        const rhs = cleanLine.slice(eqIdx + 1).trim();
        const isDerivative = lhs.startsWith("ddt_");
        const stateName = isDerivative ? lhs.slice(4) : undefined;
        equations.push({
          lhs,
          rhs,
          isDerivative,
          stateName,
          range,
        });
        continue;
      }
    }

    // If inside PK: block check for macros
    if (currentSubBlock === "PK") {
      const macroMatch = cleanLine.match(/^([a-zA-Z0-9_]+)\s*\((.*)\)$/);
      if (macroMatch) {
        const macroKind = macroMatch[1]!.toLowerCase() as MlxtranMacroKind;
        const argStr = macroMatch[2]!;
        const params: Record<string, string> = {};
        for (const pair of argStr.split(",")) {
          const parts = pair.split("=").map((s) => s.trim());
          if (parts[0] && parts[1]) {
            params[parts[0]] = parts[1];
          }
        }
        macros.push({
          kind: macroKind,
          params,
          raw: cleanLine,
          range,
        });
        continue;
      }
    }
  }

  // If description has title or model name
  if (description) {
    const firstLine = description.split("\n")[0]?.trim();
    if (firstLine && /^[a-zA-Z0-9_]+$/.test(firstLine)) {
      modelName = firstLine;
    }
  }

  const model: MlxtranModel = {
    name: modelName,
    description,
    inputs,
    equations,
    macros,
    outputs,
    rawBlocks,
  };

  return {
    model,
    raw: source,
  };
}

export function serializeMlxtran(doc: MlxtranDocument): string {
  const m = doc.model;
  const out: string[] = [];

  if (m.description) {
    out.push(`; ${m.description.replace(/\n/g, "\n; ")}`);
  }

  out.push("[LONGITUDINAL]");

  if (m.inputs.length > 0) {
    const inputParts = m.inputs.map((p) => {
      const metas: string[] = [];
      if (p.min !== undefined) metas.push(`min=${p.min}`);
      if (p.max !== undefined) metas.push(`max=${p.max}`);
      if (p.init !== undefined) metas.push(`init=${p.init}`);
      return metas.length > 0 ? `${p.name} = {${metas.join(", ")}}` : p.name;
    });
    out.push(`input = {${inputParts.join(", ")}}`);
  }

  if (m.equations.length > 0) {
    out.push("");
    out.push("EQUATION:");
    for (const eq of m.equations) {
      out.push(`${eq.lhs} = ${eq.rhs}`);
    }
  }

  if (m.outputs.length > 0) {
    out.push("");
    out.push("OUTPUT:");
    out.push(`output = {${m.outputs.join(", ")}}`);
  }

  if (m.macros.length > 0) {
    out.push("");
    out.push("PK:");
    for (const mac of m.macros) {
      const args = Object.entries(mac.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      out.push(`${mac.kind}(${args})`);
    }
  }

  return out.join("\n");
}
