// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/gdsii`:
 * - Diagnostics (structural, semantic & geometric DRC)
 * - Document Symbols (library, structures, elements)
 * - Hover documentation (keywords, CMOS layers, structures)
 * - Completions (GDSII record keywords & cleanroom CMOS stdlib presets)
 */

import { DEFAULT_CMOS_LAYER_STACK, lowerGdsiiToGeometry } from "./cad/index.js";
import { getGdsiiSchemasFromLibraries, lookupGdsiiSchema } from "./catalog/library-package-adapter.js";
import { lintGdsii, type GdsiiLintOptions } from "./lints/index.js";
import { parseGdsiiAscii } from "./parser/gdt-parser.js";

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
  Struct = 23,
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

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
}

const GDSII_KEYWORD_DOCS: Record<string, string> = {
  HEADER: "**HEADER** `<version>` — GDSII stream format release version (e.g., `600` for v6.0).",
  BGNLIB: "**BGNLIB** — Marks the beginning of a GDSII library stream.",
  LIBNAME: "**LIBNAME** `<name>` — Declares the library identifier.",
  UNITS: "**UNITS** `<dbUnitInUserUnits> <dbUnitInMeters>` — Database unit scaling factors (typically `1e-3 1e-9`).",
  BGNSTR: "**BGNSTR** — Begins a structure (cell) definition.",
  STRNAME: "**STRNAME** `<name>` — Declares the structure (cell) name.",
  BOUNDARY: "**BOUNDARY** — Closed planar polygon element (minimum 4 vertices, first == last).",
  PATH: "**PATH** — Open polyline wire element with `WIDTH` and `PATHTYPE`.",
  SREF: "**SREF** — Single hierarchical structure instance reference (`SNAME`, optional `STRANS`/`MAG`/`ANGLE`, `XY`).",
  AREF: "**AREF** — 2D array structure instance reference (`SNAME`, `COLROW`, 3-point `XY`).",
  TEXT: "**TEXT** — Layer text label annotation (`LAYER`, `TEXTTYPE`, `XY`, `STRING`).",
  LAYER: "**LAYER** `<0..65535>` — GDSII mask layer number.",
  DATATYPE: "**DATATYPE** `<0..65535>` — GDSII layer datatype purpose.",
  WIDTH: "**WIDTH** `<dbUnits>` — Path wire width in database units.",
  XY: "**XY** `<x: y ...>` — Vertex coordinate list in database units.",
  SNAME: "**SNAME** `<cellName>` — Target structure name for `SREF` or `AREF`.",
  STRANS: "**STRANS** `<bitmask>` — Structure reflection/magnification/angle flags (bit 15 = X-reflection).",
  MAG: "**MAG** `<factor>` — Structure magnification scale factor.",
  ANGLE: "**ANGLE** `<degrees>` — Counter-clockwise rotation angle in degrees.",
  COLROW: "**COLROW** `<columns> <rows>` — Array reference dimensions.",
  ENDEL: "**ENDEL** — Terminates the current layout element.",
  ENDSTR: "**ENDSTR** — Terminates the current structure definition.",
  ENDLIB: "**ENDLIB** — Terminates the GDSII library stream.",
};

/**
 * Validates a GDSII GDT/ASCII layout document and returns LSP diagnostics.
 */
export function validateGdsii(content: string, options?: GdsiiLintOptions): LspDiagnostic[] {
  const library = parseGdsiiAscii(content);
  const diags = lintGdsii(library, options);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = d.line ? Math.max(0, d.line - 1) : 0;
    const lineText = lines[lineIdx] ?? "";
    const startChar = d.column ? Math.max(0, d.column - 1) : 0;
    const endChar = Math.max(startChar + 1, lineText.length);
    const severity: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity,
      code: d.id,
      source: "gdsii",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols for a GDSII GDT/ASCII document.
 */
export function getGdsiiDocumentSymbols(content: string): LspDocumentSymbol[] {
  const library = parseGdsiiAscii(content);
  const lines = content.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: (lines[lastLine] ?? "").length },
  };

  const structSymbols: LspDocumentSymbol[] = library.structures.map((struct) => {
    const startLine = Math.max(0, (struct.line ?? 1) - 1);
    const range: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: startLine, character: (lines[startLine] ?? "").length },
    };

    const children: LspDocumentSymbol[] = struct.elements.map((el, idx) => {
      const elLine = Math.max(0, (el.line ?? struct.line ?? 1) - 1);
      const elRange: LspRange = {
        start: { line: elLine, character: 0 },
        end: { line: elLine, character: (lines[elLine] ?? "").length },
      };
      let name = `${el.kind.toUpperCase()} #${idx + 1}`;
      let detail: string | undefined;
      if (el.kind === "boundary" || el.kind === "path") {
        detail = `layer ${el.layer}:${el.datatype}`;
      } else if (el.kind === "sref") {
        name = `SREF ${el.sname}`;
        detail = `(${el.xy.x}, ${el.xy.y})`;
      } else if (el.kind === "aref") {
        name = `AREF ${el.sname}`;
        detail = `${el.columns}x${el.rows}`;
      } else if (el.kind === "text") {
        name = `TEXT "${el.string}"`;
        detail = `layer ${el.layer}`;
      }
      return {
        name,
        detail,
        kind: el.kind === "sref" || el.kind === "aref" ? LspSymbolKind.Field : LspSymbolKind.Property,
        range: elRange,
        selectionRange: elRange,
      };
    });

    return {
      name: struct.name,
      detail: `${struct.elements.length} element(s)`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: range,
      children,
    };
  });

  return [
    {
      name: library.name,
      detail: `GDSII v${library.version} (${library.structures.length} structures)`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: (lines[0] ?? "").length } },
      children: structSymbols,
    },
  ];
}

/**
 * Provides Markdown hover documentation for keywords, layer numbers, structures, or stdlib schemas.
 */
export function getGdsiiHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line];
  if (!line) return null;

  // Find token under cursor
  const tokenRegex = /[A-Za-z0-9_]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (position.character >= start && position.character <= end) {
      const token = match[0];
      const upper = token.toUpperCase();
      const range: LspRange = {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      };

      // 1. Keyword documentation
      const kwDoc = GDSII_KEYWORD_DOCS[upper];
      if (kwDoc) {
        return { contents: { kind: "markdown", value: kwDoc }, range };
      }

      // 2. Structure in current library
      const lib = parseGdsiiAscii(content);
      const foundStruct = lib.structures.find((s) => s.name === token);
      if (foundStruct) {
        const flat = lowerGdsiiToGeometry(lib, { topStructure: foundStruct.name });
        const areaStr = flat.totalAreaUm2.toFixed(4);
        return {
          contents: {
            kind: "markdown",
            value: `**Structure \`${foundStruct.name}\`**\n\n- Elements: ${foundStruct.elements.length}\n- Flattened Polygons: ${flat.polygons.length}\n- Total Area: ${areaStr} μm²`,
          },
          range,
        };
      }

      // 3. Layer number lookup if on a LAYER line
      if (/^\s*LAYER\b/i.test(line) && /^\d+$/.test(token)) {
        const layerNum = Number.parseInt(token, 10);
        const layerMeta = DEFAULT_CMOS_LAYER_STACK.find((l) => l.layer === layerNum);
        if (layerMeta) {
          return {
            contents: {
              kind: "markdown",
              value: `**Layer ${layerMeta.layer} — ${layerMeta.name}**\n\n- Z: ${layerMeta.zMinUm} μm, Thickness: ${layerMeta.thicknessUm} μm\n- Sheet Resistance: ${layerMeta.sheetResistanceOhmSq} Ω/sq`,
            },
            range,
          };
        }
      }

      // 4. Cleanroom stdlib schema lookup
      const schema = lookupGdsiiSchema(token);
      if (schema) {
        return {
          contents: {
            kind: "markdown",
            value: `**${schema.label}** (\`${schema.namePath}\`)\n\n${schema.description}`,
          },
          range,
        };
      }

      return null;
    }
  }
  return null;
}

/**
 * Provides LSP completion items for GDSII keywords and cleanroom CMOS stdlib presets.
 */
export function getGdsiiCompletions(): LspCompletionItem[] {
  const items: LspCompletionItem[] = Object.entries(GDSII_KEYWORD_DOCS).map(([kw, doc]) => ({
    label: kw,
    kind: 14, // Keyword
    detail: "GDSII record",
    documentation: doc,
  }));

  for (const schema of getGdsiiSchemasFromLibraries()) {
    items.push({
      label: schema.name,
      kind: 7, // Class
      detail: `${schema.category} (${schema.provenance})`,
      documentation: schema.description,
    });
  }

  return items;
}
