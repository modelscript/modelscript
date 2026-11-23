// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Language Server Protocol (LSP) Service Integration.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lowerDoe2ToDae } from "./dae/index.js";
import { lintDoe2 } from "./lints/index.js";
import { parseDoe2 } from "./parser/index.js";
import { doe2ToEnergyPlusIdf, doe2ToModelica } from "./projections/index.js";
import { computeAllConstructionProps } from "./solver/index.js";
import type { Doe2Document, Doe2Range } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export const LspSymbolKind = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Interface: 11,
  Variable: 13,
  Struct: 23,
} as const;

export type LspSymbolKind = (typeof LspSymbolKind)[keyof typeof LspSymbolKind];

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
  code: string;
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

function toLspRange(r: Doe2Range): LspRange {
  return {
    start: { line: Math.max(0, r.startLine - 1), character: Math.max(0, r.startColumn - 1) },
    end: { line: Math.max(0, r.endLine - 1), character: Math.max(0, r.endColumn - 1) },
  };
}

export function validateDoe2(content: string): LspDiagnostic[] {
  let doc: Doe2Document;
  try {
    try {
      getOrLoadLanguageWasmParser("doe2", import.meta.url, createWasmParserSync).parse(content);
    } catch {
      // Fall back cleanly if WASM parser is unavailable in current runtime
    }
    doc = parseDoe2(content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "DOE1001",
        source: "doe2-parser",
        message: `Parse error: ${message}`,
      },
    ];
  }

  return lintDoe2(doc).map((d) => ({
    range: toLspRange(d.range),
    severity: d.severity === "warning" ? 2 : d.severity === "info" ? 3 : 1,
    code: d.code,
    source: "doe2-linter",
    message: d.message,
  }));
}

export function getDoe2DocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: Doe2Document;
  try {
    doc = parseDoe2(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const mat of doc.materials) {
    const range = toLspRange(mat.range);
    symbols.push({
      name: `MATERIAL: ${mat.name}`,
      detail:
        mat.type === "RESISTANCE"
          ? `R=${mat.resistance ?? "?"}`
          : `t=${mat.thickness ?? "?"}, k=${mat.conductivity ?? "?"}`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: range,
    });
  }

  for (const con of doc.constructions) {
    const range = toLspRange(con.range);
    symbols.push({
      name: `CONSTRUCTION: ${con.name}`,
      detail: con.layersName ? `layers=${con.layersName}` : `U=${con.uValue ?? "?"}`,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  for (const glz of doc.glassTypes) {
    const range = toLspRange(glz.range);
    symbols.push({
      name: `GLASS-TYPE: ${glz.name}`,
      detail: `U=${glz.glassConductance ?? "?"}, SHGC=${glz.shgc?.toFixed(2) ?? "?"}`,
      kind: LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  for (const sp of doc.spaces) {
    const range = toLspRange(sp.range);
    const children: LspDocumentSymbol[] = doc.surfaces
      .filter((s) => s.spaceName?.toLowerCase() === sp.name.toLowerCase())
      .map((s) => {
        const sRange = toLspRange(s.range);
        return {
          name: `${s.kind}: ${s.name}`,
          detail: `construction=${s.constructionName ?? "?"}, area=${s.area ?? "?"}`,
          kind: LspSymbolKind.Field,
          range: sRange,
          selectionRange: sRange,
        };
      });

    symbols.push({
      name: `SPACE: ${sp.name}`,
      detail: `area=${sp.area ?? "?"}, vol=${sp.volume ?? "?"}`,
      kind: LspSymbolKind.Namespace,
      range,
      selectionRange: range,
      children,
    });
  }

  for (const sys of doc.systems) {
    const range = toLspRange(sys.range);
    symbols.push({
      name: `SYSTEM: ${sys.name}`,
      detail: `type=${sys.type}, zones=${sys.zones.length}`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  for (const z of doc.zones) {
    const range = toLspRange(z.range);
    symbols.push({
      name: `ZONE: ${z.name}`,
      detail: `space=${z.spaceName ?? "?"}, type=${z.type ?? "CONDITIONED"}`,
      kind: LspSymbolKind.Variable,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

export function getDoe2Hover(content: string, offset: number): LspHover | null {
  let doc: Doe2Document;
  try {
    doc = parseDoe2(content);
  } catch {
    return null;
  }

  for (const mat of doc.materials) {
    if (offset >= mat.range.startOffset && offset <= mat.range.endOffset) {
      return {
        range: toLspRange(mat.range),
        contents: {
          kind: "markdown",
          value: [
            `### DOE-2 Material: **${mat.name}**`,
            `* **Type:** \`${mat.type}\``,
            mat.thickness !== undefined ? `* **Thickness:** \`${mat.thickness}\`` : undefined,
            mat.conductivity !== undefined ? `* **Conductivity:** \`${mat.conductivity}\`` : undefined,
            mat.resistance !== undefined ? `* **Resistance:** \`${mat.resistance}\`` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  const conProps = computeAllConstructionProps(doc);
  for (const con of doc.constructions) {
    if (offset >= con.range.startOffset && offset <= con.range.endOffset) {
      const prop = conProps.get(con.name.toLowerCase());
      return {
        range: toLspRange(con.range),
        contents: {
          kind: "markdown",
          value: [
            `### DOE-2 Construction: **${con.name}**`,
            `* **Type:** \`${con.type}\``,
            prop ? `* **U-value (SI):** \`${prop.uValueSi.toFixed(4)} W/(m²·K)\`` : undefined,
            prop ? `* **R-value (SI):** \`${prop.rTotalSi.toFixed(4)} m²·K/W\`` : undefined,
            prop ? `* **R-value (IP):** \`${prop.rTotalIp.toFixed(2)} hr·ft²·°F/Btu\`` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  for (const sp of doc.spaces) {
    if (offset >= sp.range.startOffset && offset <= sp.range.endOffset) {
      return {
        range: toLspRange(sp.range),
        contents: {
          kind: "markdown",
          value: [
            `### DOE-2 Space: **${sp.name}**`,
            `* **Area:** \`${sp.area ?? "N/A"}\``,
            `* **Volume:** \`${sp.volume ?? "N/A"}\``,
            `* **Infiltration (ACH):** \`${sp.infiltrationAch ?? 0}\``,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export interface Doe2ActionParams {
  title?: string | undefined;
}

export function executeDoe2Action(
  action: "doe2.toEnergyPlus",
  content: string,
  params?: Doe2ActionParams,
): { idf: string };
export function executeDoe2Action(
  action: "doe2.toModelica",
  content: string,
  params?: Doe2ActionParams,
): { modelica: string };
export function executeDoe2Action(
  action: "doe2.toDae",
  content: string,
  params?: Doe2ActionParams,
): { variables: number; equations: number };
export function executeDoe2Action(
  action: "doe2.summary",
  content: string,
  params?: Doe2ActionParams,
): {
  title: string | undefined;
  spaces: number;
  surfaces: number;
  windows: number;
  materials: number;
  constructions: number;
  zones: number;
  systems: number;
};
export function executeDoe2Action(action: string, content: string, params?: Doe2ActionParams): unknown;
export function executeDoe2Action(action: string, content: string, params?: Doe2ActionParams): unknown {
  const doc = parseDoe2(content);
  switch (action) {
    case "doe2.toEnergyPlus":
      return { idf: doe2ToEnergyPlusIdf(doc) };
    case "doe2.toModelica":
      return { modelica: doe2ToModelica(doc) };
    case "doe2.toDae": {
      const arena = lowerDoe2ToDae(doc, { arenaTitle: params?.title });
      return { variables: arena.getVarCount(), equations: arena.getEqCount() };
    }
    case "doe2.summary":
      return {
        title: doc.title,
        spaces: doc.spaces.length,
        surfaces: doc.surfaces.length,
        windows: doc.windows.length,
        materials: doc.materials.length,
        constructions: doc.constructions.length,
        zones: doc.zones.length,
        systems: doc.systems.length,
      };
    default:
      throw new Error(`Unknown DOE-2 LSP action: ${action}`);
  }
}
