// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintGensysModel } from "./lints/index.js";
import { parseGensysDeck } from "./parser/index.js";
import type { GensysModel } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string | number;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

function findLineAndCol(text: string, searchPattern: string): LspRange {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.indexOf(searchPattern);
    if (match >= 0) {
      return {
        start: { line: i, character: match },
        end: { line: i, character: match + searchPattern.length },
      };
    }
  }
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
}

/**
 * Extracts hierarchical DocumentSymbols from a GENSYS vehicle deck (.calc, .sub, .run, .ins).
 */
export function getGensysDocumentSymbols(content: string): LspDocumentSymbol[] {
  let model: GensysModel;
  try {
    model = parseGensysDeck(content, "GensysModel");
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  // Bodies (Carbody, Bogies)
  for (const [name, body] of model.bodies.entries()) {
    const range = findLineAndCol(content, name);
    symbols.push({
      name,
      detail: `mass: ${body.mass} kg, J=[${body.inertia.jx}, ${body.inertia.jy}, ${body.inertia.jz}]`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  // Wheelsets
  for (const [name, ws] of model.wheelsets.entries()) {
    const range = findLineAndCol(content, name);
    symbols.push({
      name,
      detail: `wheelset: r=${ws.wheelRadius}m, conicity=${ws.conicity}, gauge=${ws.gauge}m`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: range,
    });
  }

  // Couplings (Primary and Secondary Springs/Dampers)
  for (const [name, s] of model.couplings.entries()) {
    const range = findLineAndCol(content, name);
    symbols.push({
      name,
      detail: `spring: ${s.body1} <-> ${s.body2}, kz=${s.stiffness.z} N/m`,
      kind: LspSymbolKind.Field,
      range,
      selectionRange: range,
    });
  }

  // Subsystems
  for (const sub of model.subsystems) {
    const range = findLineAndCol(content, sub);
    symbols.push({
      name: sub,
      detail: "subsystem definition",
      kind: LspSymbolKind.Module,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

/**
 * Evaluates Markdown Hover documentation for GENSYS vehicle cards and keywords.
 */
export function getGensysHover(content: string, offset: number): LspHover | null {
  if (offset < 0 || offset >= content.length) return null;

  // Extract word at offset
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_:-]/.test(content[start - 1]!)) {
    start--;
  }
  let end = offset;
  while (end < content.length && /[A-Za-z0-9_:-]/.test(content[end]!)) {
    end++;
  }
  const word = content.slice(start, end).trim();
  if (!word) return null;

  let model: GensysModel;
  try {
    model = parseGensysDeck(content, "GensysModel");
  } catch {
    return null;
  }

  // Check bodies
  if (model.bodies.has(word)) {
    const b = model.bodies.get(word)!;
    return {
      contents: {
        kind: "markdown",
        value: [
          `### GENSYS Vehicle Body \`${word}\``,
          `**Mass:** \`${b.mass} kg\``,
          `**Moments of Inertia:** \`Jx=${b.inertia.jx}, Jy=${b.inertia.jy}, Jz=${b.inertia.jz} kg·m²\``,
          `**Initial CG Position:** \`(${b.position.x}, ${b.position.y}, ${b.position.z}) m\``,
        ].join("\n\n"),
      },
    };
  }

  // Check wheelsets
  if (model.wheelsets.has(word)) {
    const ws = model.wheelsets.get(word)!;
    return {
      contents: {
        kind: "markdown",
        value: [
          `### GENSYS Wheelset \`${word}\``,
          `**Mass:** \`${ws.mass} kg\``,
          `**Track Gauge:** \`${ws.gauge} m\``,
          `**Nominal Rolling Radius:** \`${ws.wheelRadius} m\``,
          `**Equivalent Conicity (λ):** \`${ws.conicity}\``,
          ws.profile ? `**Tread Profile:** \`${ws.profile}\`` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    };
  }

  // Check couplings / springs
  if (model.couplings.has(word)) {
    const c = model.couplings.get(word)!;
    return {
      contents: {
        kind: "markdown",
        value: [
          `### GENSYS Suspension Element \`${word}\``,
          `**Type:** \`${c.type}\``,
          `**Coupled Bodies:** \`${c.body1} <---> ${c.body2}\``,
          `**Stiffness (k):** \`[${c.stiffness.x}, ${c.stiffness.y}, ${c.stiffness.z}] N/m\``,
          `**Damping (c):** \`[${c.damping.x}, ${c.damping.y}, ${c.damping.z}] N·s/m\``,
        ].join("\n\n"),
      },
    };
  }

  // Check simulation operating commands
  const lowerWord = word.toLowerCase();
  if (lowerWord === "speed" && model.simulationConfig?.speed !== undefined) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### GENSYS Operating Speed`,
          `**Vehicle Velocity:** \`${model.simulationConfig.speed} m/s\` (\`${(model.simulationConfig.speed * 3.6).toFixed(1)} km/h\`)`,
        ].join("\n\n"),
      },
    };
  }

  return null;
}

/**
 * Validates a GENSYS vehicle deck and produces LSP Diagnostics.
 */
export function validateGensys(content: string): LspDiagnostic[] {
  let model: GensysModel;
  try {
    model = parseGensysDeck(content, "GensysModel");
  } catch (err: unknown) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "M1001",
        source: "gensys",
        message: `GENSYS Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const diags = lintGensysModel(model);
  return diags.map((d) => {
    const match = d.message.match(/'([^']+)'/);
    const identifier = match ? match[1]! : "";
    const range = identifier
      ? findLineAndCol(content, identifier)
      : {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        };
    return {
      range,
      severity: d.severity === "error" ? 1 : 2,
      code: d.code,
      source: "gensys",
      message: d.message,
    };
  });
}
