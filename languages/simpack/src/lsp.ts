// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { analyzeMobility } from "./kinematics/mobility.js";
import { lintSimpackModel } from "./lints/index.js";
import { parseSimDeck, parseSpckXml } from "./parser/index.js";
import type { SimpackModel } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
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

interface SimpackCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
  tokens: CstNodeLike[];
}

interface SimpackCstIndex {
  entries: SimpackCstLine[];
}

function buildSimpackCstIndex(text: string): SimpackCstIndex {
  const entries: SimpackCstLine[] = [];

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("simpack", import.meta.url, createWasmParserSync).parse(text)?.rootNode as
        CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(text, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      entries.push({ row, text: lineText, colLine, startCol, endCol, tokens });
    }
  } else {
    const rawLines = text.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      entries.push({ row: i, text: trimmed, colLine: raw, startCol, endCol, tokens: [] });
    }
  }

  return { entries };
}

function findLineAndCol(cstIndex: SimpackCstIndex, searchPattern: string | RegExp): LspRange {
  for (const entry of cstIndex.entries) {
    const line = entry.colLine;
    const match = typeof searchPattern === "string" ? line.indexOf(searchPattern) : line.search(searchPattern);
    if (match >= 0) {
      const len = typeof searchPattern === "string" ? searchPattern.length : 10;
      return {
        start: { line: entry.row, character: match },
        end: { line: entry.row, character: match + len },
      };
    }
  }
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
}

/**
 * Extracts hierarchical DocumentSymbols from a SIMPACK model (.spck or .sim).
 */
export function getSimpackDocumentSymbols(content: string): LspDocumentSymbol[] {
  const isXml = content.trimStart().startsWith("<");
  let model: SimpackModel;
  try {
    model = isXml ? parseSpckXml(content, "SimpackModel") : parseSimDeck(content, "SimpackModel");
  } catch {
    return [];
  }

  const cstIndex = buildSimpackCstIndex(content);
  const symbols: LspDocumentSymbol[] = [];

  // Group markers by body
  const markersByBody = new Map<string, typeof model.markers extends Map<unknown, infer V> ? V[] : never[]>();
  for (const marker of model.markers.values()) {
    const list = markersByBody.get(marker.bodyId) ?? [];
    list.push(marker);
    markersByBody.set(marker.bodyId, list);
  }

  // Bodies
  for (const [id, body] of model.bodies.entries()) {
    const range = findLineAndCol(cstIndex, id);
    const markerChildren: LspDocumentSymbol[] = (markersByBody.get(id) ?? []).map((m) => {
      const mRange = findLineAndCol(cstIndex, m.id);
      return {
        name: m.id,
        detail: `(${m.position.x}, ${m.position.y}, ${m.position.z})`,
        kind: LspSymbolKind.Field,
        range: mRange,
        selectionRange: mRange,
      };
    });

    symbols.push({
      name: body.name && body.name !== id ? `${id} (${body.name})` : id,
      detail: `mass: ${body.mass} kg, I=[${body.inertia.ixx}, ${body.inertia.iyy}, ${body.inertia.izz}]`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
      children: markerChildren.length > 0 ? markerChildren : undefined,
    });
  }

  // Joints
  for (const [id, joint] of model.joints.entries()) {
    const range = findLineAndCol(cstIndex, id);
    symbols.push({
      name: id,
      detail: `${joint.type} [${joint.fromMarker} -> ${joint.toMarker}]`,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  // Force Elements / Springs
  for (const [id, force] of model.forces.entries()) {
    const range = findLineAndCol(cstIndex, id);
    symbols.push({
      name: id,
      detail: `${force.type} kz=${force.stiffness.z} N/m, cz=${force.damping.z} Ns/m`,
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

function extractWordAtOffset(content: string, offset: number): string {
  const cstIndex = buildSimpackCstIndex(content);
  for (const entry of cstIndex.entries) {
    for (const tok of entry.tokens) {
      if (
        typeof tok.startIndex === "number" &&
        typeof tok.endIndex === "number" &&
        offset >= tok.startIndex &&
        offset <= tok.endIndex
      ) {
        const tokText = tok.text ?? content.slice(tok.startIndex, tok.endIndex);
        const rel = offset - tok.startIndex;
        let s = rel;
        while (s > 0 && /[A-Za-z0-9_:-]/.test(tokText[s - 1] ?? "")) s--;
        let e = rel;
        while (e < tokText.length && /[A-Za-z0-9_:-]/.test(tokText[e] ?? "")) e++;
        const candidate = tokText.slice(s, e).trim();
        if (candidate) return candidate;
      }
    }
  }
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_:-]/.test(content[start - 1]!)) start--;
  let end = offset;
  while (end < content.length && /[A-Za-z0-9_:-]/.test(content[end]!)) end++;
  return content.slice(start, end).trim();
}

/**
 * Evaluates Markdown Hover documentation for identifiers in SIMPACK models.
 */
export function getSimpackHover(content: string, offset: number): LspHover | null {
  if (offset < 0 || offset >= content.length) return null;

  const word = extractWordAtOffset(content, offset);
  if (!word) return null;

  const isXml = content.trimStart().startsWith("<");
  let model: SimpackModel;
  try {
    model = isXml ? parseSpckXml(content, "SimpackModel") : parseSimDeck(content, "SimpackModel");
  } catch {
    return null;
  }

  // Check bodies
  if (model.bodies.has(word)) {
    const b = model.bodies.get(word)!;
    const attachedMarkers = Array.from(model.markers.values()).filter((m) => m.bodyId === word);
    return {
      contents: {
        kind: "markdown",
        value: [
          `### SIMPACK Rigid Body \`${word}\``,
          b.name ? `**Name:** ${b.name}` : "",
          `**Mass:** \`${b.mass} kg\``,
          `**Principal Inertias:** \`Ixx=${b.inertia.ixx}, Iyy=${b.inertia.iyy}, Izz=${b.inertia.izz} kg·m²\``,
          `**Attached Markers:** ${attachedMarkers.length} (\`${attachedMarkers.map((m) => m.id).join(", ") || "none"}\`)`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    };
  }

  // Check markers
  if (model.markers.has(word)) {
    const m = model.markers.get(word)!;
    return {
      contents: {
        kind: "markdown",
        value: [
          `### SIMPACK Marker \`${word}\``,
          `**Parent Body:** \`${m.bodyId}\``,
          `**Position (local frame):** \`(${m.position.x}, ${m.position.y}, ${m.position.z}) m\``,
        ].join("\n\n"),
      },
    };
  }

  // Check joints
  if (model.joints.has(word)) {
    const j = model.joints.get(word)!;
    const mobility = analyzeMobility(model);
    return {
      contents: {
        kind: "markdown",
        value: [
          `### SIMPACK Kinematic Joint \`${word}\``,
          `**Type:** \`${j.type.toUpperCase()}\``,
          `**From Marker:** \`${j.fromMarker}\``,
          `**To Marker:** \`${j.toMarker}\``,
          `**Total System Mobility (Grübler):** \`${mobility.calculatedMobility} DOFs\``,
        ].join("\n\n"),
      },
    };
  }

  // Check forces / springs
  if (model.forces.has(word)) {
    const f = model.forces.get(word)!;
    return {
      contents: {
        kind: "markdown",
        value: [
          `### SIMPACK Constitutive Force \`${word}\``,
          `**Type:** \`${f.type}\``,
          `**Connections:** \`${f.markerA} <-> ${f.markerB}\``,
          `**Stiffness (k):** \`[${f.stiffness.x}, ${f.stiffness.y}, ${f.stiffness.z}] N/m\``,
          `**Damping (c):** \`[${f.damping.x}, ${f.damping.y}, ${f.damping.z}] N·s/m\``,
        ].join("\n\n"),
      },
    };
  }

  return null;
}

/**
 * Validates a SIMPACK model and produces LSP Diagnostics.
 */
export function validateSimpack(content: string): LspDiagnostic[] {
  const isXml = content.trimStart().startsWith("<");
  let model: SimpackModel;
  try {
    model = isXml ? parseSpckXml(content, "SimpackModel") : parseSimDeck(content, "SimpackModel");
  } catch (err: unknown) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "M1001",
        source: "simpack",
        message: `SIMPACK Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const cstIndex = buildSimpackCstIndex(content);
  const diags = lintSimpackModel(model);
  return diags.map((d) => {
    const match = d.message.match(/'([^']+)'/);
    const identifier = match ? match[1]! : "";
    const range = identifier
      ? findLineAndCol(cstIndex, identifier)
      : {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        };
    return {
      range,
      severity: d.severity === "error" ? 1 : 2,
      code: d.code,
      source: "simpack",
      message: d.message,
    };
  });
}
