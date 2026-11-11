// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Character-by-Character Parser & Serializer for NEURON NMODL.
 *
 * Extracts TITLE, NEURON, PARAMETER, ASSIGNED, STATE, BREAKPOINT, and DERIVATIVE blocks.
 */

import type {
  NmodlDocument,
  NmodlEquation,
  NmodlIonUse,
  NmodlModel,
  NmodlParameter,
  NmodlRange,
  NmodlVariable,
} from "../types.js";

function stripComments(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' || ch === "'") {
      inString = !inString;
    } else if (!inString) {
      if (ch === ":" || (ch === "?" && line[i + 1] === "?")) {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

export function parseNmodl(source: string): NmodlDocument {
  const lines = source.split(/\r?\n/);
  const rawBlocks: Record<string, string> = {};

  let title: string | undefined;
  let suffix = "channel";
  const ions: NmodlIonUse[] = [];
  const ranges: string[] = [];
  const globals: string[] = [];
  const parameters: NmodlParameter[] = [];
  const assigned: NmodlVariable[] = [];
  const states: NmodlVariable[] = [];
  const breakpointEquations: NmodlEquation[] = [];
  const derivativeEquations: NmodlEquation[] = [];
  const initialEquations: NmodlEquation[] = [];

  let currentBlock = "";
  let blockDepth = 0;
  let blockContent = "";

  let offset = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = offset;
    const lineEndOffset = offset + rawLine.length;
    offset = lineEndOffset + 1;

    const cleanLine = stripComments(rawLine).trim();
    if (cleanLine.length === 0) continue;

    const range: NmodlRange = {
      startLine: lineIdx + 1,
      startColumn: 1,
      endLine: lineIdx + 1,
      endColumn: rawLine.length + 1,
      startOffset: lineStartOffset,
      endOffset: lineEndOffset,
    };

    // TITLE statement (single line or block)
    if (cleanLine.startsWith("TITLE") && blockDepth === 0) {
      title = cleanLine.slice(5).trim();
      continue;
    }

    // Check for block start: BLOCK_NAME [args] {
    const blockStartMatch = cleanLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+([^{]+))?\s*\{/);
    if (blockStartMatch && blockDepth === 0) {
      currentBlock = blockStartMatch[1]!.toUpperCase();
      blockDepth = 1;
      blockContent = "";

      // Check if closing brace is on same line
      if (cleanLine.endsWith("}")) {
        blockDepth = 0;
      }
      continue;
    }

    // Inside block
    if (blockDepth > 0) {
      if (cleanLine.includes("{")) blockDepth++;
      if (cleanLine.includes("}")) {
        blockDepth--;
        if (blockDepth === 0) {
          rawBlocks[currentBlock] = blockContent;
          currentBlock = "";
          continue;
        }
      }

      blockContent += cleanLine + "\n";

      // Parse statements per block type
      if (currentBlock === "NEURON") {
        if (cleanLine.startsWith("SUFFIX")) {
          const parts = cleanLine.split(/\s+/);
          if (parts[1]) suffix = parts[1].replace(/;$/, "");
        } else if (cleanLine.startsWith("USEION")) {
          const parts = cleanLine.replace(/;$/, "").split(/\s+/);
          const ionName = parts[1] ?? "";
          const readVars: string[] = [];
          const writeVars: string[] = [];
          let mode: "read" | "write" | null = null;

          for (let i = 2; i < parts.length; i++) {
            const p = parts[i]!;
            if (p.toUpperCase() === "READ") mode = "read";
            else if (p.toUpperCase() === "WRITE") mode = "write";
            else if (mode === "read") readVars.push(p.replace(/,$/, ""));
            else if (mode === "write") writeVars.push(p.replace(/,$/, ""));
          }

          ions.push({
            ion: ionName,
            read: readVars,
            write: writeVars,
            range,
          });
        } else if (cleanLine.startsWith("RANGE")) {
          const vars = cleanLine
            .slice(5)
            .replace(/;$/, "")
            .split(",")
            .map((s) => s.trim());
          for (const v of vars) if (v) ranges.push(v);
        } else if (cleanLine.startsWith("GLOBAL")) {
          const vars = cleanLine
            .slice(6)
            .replace(/;$/, "")
            .split(",")
            .map((s) => s.trim());
          for (const v of vars) if (v) globals.push(v);
        }
      } else if (currentBlock === "PARAMETER") {
        // e.g. gnabar = 0.12 (mho/cm2) <0, 1e9>
        const eqIdx = cleanLine.indexOf("=");
        if (eqIdx !== -1) {
          const pName = cleanLine.slice(0, eqIdx).trim();
          const rest = cleanLine
            .slice(eqIdx + 1)
            .replace(/;$/, "")
            .trim();

          const numMatch = rest.match(/^[+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
          const val = numMatch ? parseFloat(numMatch[0]) : 1.0;

          const unitMatch = rest.match(/\(([^)]+)\)/);
          const units = unitMatch ? unitMatch[1] : undefined;

          const boundMatch = rest.match(/<([^,]+),([^>]+)>/);
          const min = boundMatch ? parseFloat(boundMatch[1]!) : undefined;
          const max = boundMatch ? parseFloat(boundMatch[2]!) : undefined;

          parameters.push({
            name: pName,
            val,
            units,
            min,
            max,
            range,
          });
        }
      } else if (currentBlock === "STATE") {
        const tokens = cleanLine.replace(/;$/, "").split(/\s+/);
        for (const tok of tokens) {
          const trimmed = tok.trim();
          if (trimmed && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
            states.push({
              name: trimmed,
              isState: true,
              isAssigned: false,
              range,
            });
          }
        }
      } else if (currentBlock === "ASSIGNED") {
        const parts = cleanLine.replace(/;$/, "").split(/\s+/);
        const name = parts[0]?.trim();
        if (name && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          const unitMatch = cleanLine.match(/\(([^)]+)\)/);
          assigned.push({
            name,
            units: unitMatch ? unitMatch[1] : undefined,
            isState: false,
            isAssigned: true,
            range,
          });
        }
      } else if (currentBlock === "BREAKPOINT") {
        const eqIdx = cleanLine.indexOf("=");
        if (eqIdx !== -1 && !cleanLine.startsWith("SOLVE")) {
          const lhs = cleanLine.slice(0, eqIdx).trim();
          const rhs = cleanLine
            .slice(eqIdx + 1)
            .replace(/;$/, "")
            .trim();
          breakpointEquations.push({
            lhs,
            rhs,
            isDerivative: false,
            range,
          });
        }
      } else if (currentBlock === "DERIVATIVE") {
        const eqIdx = cleanLine.indexOf("=");
        if (eqIdx !== -1) {
          const lhs = cleanLine.slice(0, eqIdx).trim();
          const rhs = cleanLine
            .slice(eqIdx + 1)
            .replace(/;$/, "")
            .trim();
          const isDer = lhs.endsWith("'") || lhs.startsWith("d");
          const stateName = lhs.endsWith("'") ? lhs.slice(0, -1) : lhs.replace(/^d/, "");
          derivativeEquations.push({
            lhs,
            rhs,
            isDerivative: isDer,
            stateName,
            range,
          });
        }
      } else if (currentBlock === "INITIAL") {
        const eqIdx = cleanLine.indexOf("=");
        if (eqIdx !== -1) {
          const lhs = cleanLine.slice(0, eqIdx).trim();
          const rhs = cleanLine
            .slice(eqIdx + 1)
            .replace(/;$/, "")
            .trim();
          initialEquations.push({
            lhs,
            rhs,
            isDerivative: false,
            range,
          });
        }
      }
    }
  }

  const model: NmodlModel = {
    title,
    suffix,
    ions,
    ranges,
    globals,
    parameters,
    assigned,
    states,
    breakpointEquations,
    derivativeEquations,
    initialEquations,
    rawBlocks,
  };

  return {
    model,
    raw: source,
  };
}

export function serializeNmodl(doc: NmodlDocument): string {
  const m = doc.model;
  const out: string[] = [];

  if (m.title) {
    out.push(`TITLE ${m.title}\n`);
  }

  out.push("NEURON {");
  out.push(`  SUFFIX ${m.suffix}`);
  for (const ion of m.ions) {
    const reads = ion.read.length > 0 ? ` READ ${ion.read.join(", ")}` : "";
    const writes = ion.write.length > 0 ? ` WRITE ${ion.write.join(", ")}` : "";
    out.push(`  USEION ${ion.ion}${reads}${writes}`);
  }
  if (m.ranges.length > 0) {
    out.push(`  RANGE ${m.ranges.join(", ")}`);
  }
  if (m.globals.length > 0) {
    out.push(`  GLOBAL ${m.globals.join(", ")}`);
  }
  out.push("}\n");

  if (m.parameters.length > 0) {
    out.push("PARAMETER {");
    for (const p of m.parameters) {
      const units = p.units ? ` (${p.units})` : "";
      const bounds = p.min !== undefined && p.max !== undefined ? ` <${p.min}, ${p.max}>` : "";
      out.push(`  ${p.name} = ${p.val}${units}${bounds}`);
    }
    out.push("}\n");
  }

  if (m.states.length > 0) {
    out.push("STATE {");
    for (const s of m.states) {
      out.push(`  ${s.name}`);
    }
    out.push("}\n");
  }

  if (m.assigned.length > 0) {
    out.push("ASSIGNED {");
    for (const a of m.assigned) {
      const u = a.units ? ` (${a.units})` : "";
      out.push(`  ${a.name}${u}`);
    }
    out.push("}\n");
  }

  if (m.breakpointEquations.length > 0) {
    out.push("BREAKPOINT {");
    out.push("  SOLVE states METHOD cnexp");
    for (const eq of m.breakpointEquations) {
      out.push(`  ${eq.lhs} = ${eq.rhs}`);
    }
    out.push("}\n");
  }

  if (m.derivativeEquations.length > 0) {
    out.push("DERIVATIVE states {");
    for (const eq of m.derivativeEquations) {
      out.push(`  ${eq.lhs} = ${eq.rhs}`);
    }
    out.push("}\n");
  }

  return out.join("\n");
}
