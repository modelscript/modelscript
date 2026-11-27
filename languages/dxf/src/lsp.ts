// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { analyzeDxfGeometry } from "./cad/geometry.js";
import { DXF_ENTITY_SPECS, lookupDxfEntitySchema } from "./catalog/index.js";
import { lintDxf } from "./lints/index.js";
import { parseDxf } from "./parser/dxf-parser.js";

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
  detail: string;
  documentation?: string | undefined;
}

const DXF_GROUP_CODE_DOCS: Record<string, string> = {
  "0": "Entity / Structural Type Marker (`SECTION`, `ENDSEC`, `TABLE`, `LAYER`, `BLOCK`, `ENDBLK`, `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE`, `INSERT`, `EOF`)",
  "2": "Section name, Table name, Layer name, or Block name",
  "5": "Entity handle (hexadecimal unique identifier)",
  "6": "Linetype name (e.g., `CONTINUOUS`, `DASHED`, `CENTER`)",
  "8": "Layer name (defaults to `'0'`)",
  "9": "HEADER variable identifier (e.g., `$ACADVER`, `$INSUNITS`, `$EXTMIN`, `$EXTMAX`)",
  "10": "Primary X coordinate (start point, center, vertex, or insert point)",
  "20": "Primary Y coordinate",
  "30": "Primary Z coordinate",
  "11": "Secondary X coordinate (LINE endpoint, ELLIPSE major axis, 3DFACE vertex 2)",
  "21": "Secondary Y coordinate",
  "31": "Secondary Z coordinate",
  "40": "Floating-point value (radius, text height, ellipse minor/major ratio, spline knot)",
  "41": "X scale factor (`INSERT`) or start parameter (`ELLIPSE`)",
  "42": "Y scale factor (`INSERT`), bulge (`LWPOLYLINE`), or end parameter (`ELLIPSE`)",
  "43": "Z scale factor (`INSERT`) or constant width (`LWPOLYLINE`)",
  "50": "Start angle (`ARC`) or rotation angle in degrees (`INSERT`, `TEXT`)",
  "51": "End angle in degrees (`ARC`)",
  "62": "AutoCAD Color Index (ACI: 1=Red, 2=Yellow, 3=Green, 4=Cyan, 5=Blue, 6=Magenta, 7=White, 256=ByLayer)",
  "70": "Integer flags (bit 1 = closed polyline, `$INSUNITS` code 0..20)",
  "71": "Spline degree (`SPLINE`) or row count (`INSERT`)",
};

const DXF_SECTION_NAMES = ["HEADER", "CLASSES", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS"];
const DXF_HEADER_VARS = ["$ACADVER", "$INSUNITS", "$EXTMIN", "$EXTMAX", "$CLAYER", "$MEASUREMENT"];

interface DxfCstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

function buildDxfCstLineMap(content: string): Map<number, DxfCstLineEntry> {
  const byRow = new Map<number, DxfCstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("dxf", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const text = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + text.length;
      byRow.set(row, { row, text, startCol, endCol });
    }
    return byRow;
  }

  const rawLines = content.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const startCol = Math.max(0, raw.search(/\S/));
    byRow.set(i, { row: i, text: trimmed, startCol, endCol: startCol + trimmed.length });
  }
  return byRow;
}

function lineRange(lineNum1Based: number, cstLines: Map<number, DxfCstLineEntry>): LspRange {
  const zero = Math.max(0, lineNum1Based - 1);
  const entry = cstLines.get(zero);
  return {
    start: { line: zero, character: entry?.startCol ?? 0 },
    end: { line: zero, character: Math.max((entry?.startCol ?? 0) + 1, entry?.endCol ?? 1) },
  };
}

/**
 * Validates a DXF source document and returns LSP diagnostics.
 */
export function validateDxf(content: string, _uri = "drawing.dxf"): LspDiagnostic[] {
  const doc = parseDxf(content);
  const diags = lintDxf(doc);
  const cstLines = buildDxfCstLineMap(content);

  return diags.map((d) => ({
    range: lineRange(d.line, cstLines),
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.id,
    source: "modelscript-dxf",
    message: d.message,
  }));
}

/**
 * Builds a hierarchical LSP document symbol tree for a DXF drawing (Sections, Layers, Blocks, Entities).
 */
export function getDxfDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseDxf(content);
  const cstLines = buildDxfCstLineMap(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const sec of doc.sections) {
    const startZero = Math.max(0, sec.startLine - 1);
    const endZero = Math.max(startZero, sec.endLine - 1);
    const range: LspRange = {
      start: { line: startZero, character: cstLines.get(startZero)?.startCol ?? 0 },
      end: { line: endZero, character: cstLines.get(endZero)?.endCol ?? 0 },
    };
    const selectionRange = lineRange(sec.startLine, cstLines);
    const children: LspDocumentSymbol[] = [];

    if (sec.name === "TABLES") {
      for (const layer of doc.layers.values()) {
        const lr = lineRange(layer.line, cstLines);
        children.push({
          name: layer.name,
          detail: `ACI ${layer.color} (${layer.lineType})`,
          kind: LspSymbolKind.Variable,
          range: lr,
          selectionRange: lr,
        });
      }
    } else if (sec.name === "BLOCKS") {
      for (const blk of doc.blocks.values()) {
        const blkStart = Math.max(0, blk.line - 1);
        const blkEnd = Math.max(0, blk.endLine - 1);
        const br: LspRange = {
          start: { line: blkStart, character: cstLines.get(blkStart)?.startCol ?? 0 },
          end: { line: blkEnd, character: cstLines.get(blkEnd)?.endCol ?? 0 },
        };
        children.push({
          name: blk.name,
          detail: `${blk.entities.length} entity(ies)`,
          kind: LspSymbolKind.Class,
          range: br,
          selectionRange: lineRange(blk.line, cstLines),
        });
      }
    } else if (sec.name === "ENTITIES") {
      doc.entities.forEach((ent, idx) => {
        const er = lineRange(ent.line, cstLines);
        const label = ent.type === "INSERT" ? `INSERT ${ent.blockName}` : `${ent.type} #${idx + 1}`;
        children.push({
          name: label,
          detail: `Layer ${ent.layer}`,
          kind: LspSymbolKind.Object,
          range: er,
          selectionRange: er,
        });
      });
    }

    symbols.push({
      name: `SECTION ${sec.name}`,
      detail: `${sec.pairCount} pairs`,
      kind: LspSymbolKind.Namespace,
      range,
      selectionRange,
      children,
    });
  }

  return symbols;
}

/**
 * Provides Markdown hover documentation for DXF entity keywords, group codes, blocks, and layers.
 */
export function getDxfHover(content: string, position: LspPosition): LspHover | null {
  const cstLines = buildDxfCstLineMap(content);
  const entry = cstLines.get(position.line);
  if (!entry) return null;
  const token = entry.text.trim();
  if (!token) return null;

  const upper = token.toUpperCase();
  const range: LspRange = {
    start: { line: position.line, character: entry.startCol },
    end: { line: position.line, character: entry.endCol },
  };

  // 1. Entity schema hover
  const schema = lookupDxfEntitySchema(upper);
  if (schema) {
    const paramList = schema.parameters
      .map((p) => `- \`${p.key}\` (${p.unit ?? ""}): ${p.description ?? ""}`)
      .join("\n");
    return {
      range,
      contents: {
        kind: "markdown",
        value: `### DXF Entity \`${schema.name}\` — ${schema.label}\n\n${schema.description}\n\n${paramList}`,
      },
    };
  }

  // 2. Group code hover (even/odd line check: if token is an integer and matches known DXF code)
  if (/^-?\d+$/.test(token) && DXF_GROUP_CODE_DOCS[token]) {
    return {
      range,
      contents: {
        kind: "markdown",
        value: `**DXF Group Code \`${token}\`**\n\n${DXF_GROUP_CODE_DOCS[token]}`,
      },
    };
  }

  // 3. Block or Layer symbol hover from parsed document
  const doc = parseDxf(content);
  const blk = doc.blocks.get(token);
  if (blk) {
    return {
      range,
      contents: {
        kind: "markdown",
        value: `### DXF Block \`${blk.name}\`\n\n- **Base point:** (${blk.basePoint.x}, ${blk.basePoint.y}, ${blk.basePoint.z})\n- **Entities:** ${blk.entities.length}\n- **Layer:** \`${blk.layer}\``,
      },
    };
  }

  const layer = doc.layers.get(token);
  if (layer) {
    return {
      range,
      contents: {
        kind: "markdown",
        value: `### DXF Layer \`${layer.name}\`\n\n- **ACI Color:** ${layer.color}\n- **Linetype:** \`${layer.lineType}\`\n- **Frozen:** ${layer.frozen} | **Locked:** ${layer.locked}`,
      },
    };
  }

  if (upper === "SECTION" || upper === "ENTITIES") {
    const report = analyzeDxfGeometry(doc);
    return {
      range,
      contents: {
        kind: "markdown",
        value: `### DXF Drawing Summary\n\n- **Flattened Entities:** ${report.flatEntities.length}\n- **Total Path Length:** ${report.totalPathLength.toFixed(3)}\n- **Total Enclosed Area:** ${report.totalEnclosedArea.toFixed(3)}`,
      },
    };
  }

  return null;
}

/**
 * Provides LSP completion items for DXF entity types, section names, and header variables.
 */
export function getDxfCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const cstLines = buildDxfCstLineMap(content);
  const prevLine = position.line > 0 ? (cstLines.get(position.line - 1)?.text.trim() ?? "") : "";
  const items: LspCompletionItem[] = [];

  if (prevLine === "0") {
    for (const spec of DXF_ENTITY_SPECS) {
      items.push({
        label: spec.entityType,
        kind: 7,
        detail: spec.label,
        documentation: spec.description,
      });
    }
    for (const kw of [
      "SECTION",
      "ENDSEC",
      "TABLE",
      "LAYER",
      "ENDTAB",
      "BLOCK",
      "ENDBLK",
      "POLYLINE",
      "VERTEX",
      "SEQEND",
      "POINT",
      "TEXT",
      "EOF",
    ]) {
      items.push({ label: kw, kind: 14, detail: "DXF structural/entity keyword" });
    }
    return items;
  }

  if (prevLine === "2") {
    for (const sec of DXF_SECTION_NAMES) {
      items.push({ label: sec, kind: 9, detail: "DXF section name" });
    }
    const doc = parseDxf(content);
    for (const blkName of doc.blocks.keys()) {
      items.push({ label: blkName, kind: 7, detail: "Defined DXF block" });
    }
    return items;
  }

  if (prevLine === "9") {
    for (const hv of DXF_HEADER_VARS) {
      items.push({ label: hv, kind: 6, detail: "DXF HEADER variable" });
    }
    return items;
  }

  if (prevLine === "8") {
    const doc = parseDxf(content);
    items.push({ label: "0", kind: 6, detail: "Default DXF layer" });
    for (const layerName of doc.layers.keys()) {
      if (layerName !== "0") {
        items.push({ label: layerName, kind: 6, detail: "Defined DXF layer" });
      }
    }
    return items;
  }

  // Default: offer entity types & section names
  for (const spec of DXF_ENTITY_SPECS) {
    items.push({ label: spec.entityType, kind: 7, detail: spec.label, documentation: spec.description });
  }
  return items;
}
