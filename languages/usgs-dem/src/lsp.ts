// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/usgs-dem`.
 */

import { getUsgsDemSchemasFromLibraries } from "./catalog/index.js";
import { lintUsgsDem } from "./lints/index.js";
import { parseUsgsDem } from "./parser/index.js";

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
  Property = 7,
  Field = 8,
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
  contents: { kind: "markdown"; value: string };
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const KEYWORD_DOCS: Record<string, string> = {
  TYPE_A:
    "**USGS DEM Type A Header Record** — Defines quadrangle metadata, CRS/projection codes, units, bounding corners, elevation min/max, spatial resolution (`DX`, `DY`, `DZ`), and grid dimensions (`NROWS`, `NCOLS`).",
  TYPE_B:
    "**USGS DEM Type B Elevation Profile Record** — Stores one column profile: `row col m n xOrigin yOrigin localDatum minZ maxZ : z_1 ... z_m`.",
  TYPE_C:
    "**USGS DEM Type C Accuracy Record** — Stores datum and DEM root-mean-square error (RMSE) statistics `[x, y, z]` and sample counts.",
  REF: "**Ground Planimetric Reference System Code** — `0` = Geographic (lat/lon), `1` = UTM, `2` = State Plane, `3` = Albers Equal-Area.",
  ZONE: "**Projection Zone Code** — UTM zone (`1..60` North, `-60..-1` South) or State Plane FIPS zone.",
  UNITS: "**Planimetric Ground Units** — `0` = radians, `1` = feet, `2` = meters, `3` = arc-seconds.",
  ZUNITS: "**Elevation Units** — `1` = feet, `2` = meters.",
  DX: "**East-West Spatial Resolution (`dx`)** — Strictly positive horizontal grid spacing along X.",
  DY: "**North-South Spatial Resolution (`dy`)** — Strictly positive horizontal grid spacing along Y.",
  DZ: "**Vertical Elevation Resolution (`dz`)** — Strictly positive elevation scale factor multiplying Type B integers.",
  NCOLS: "**Profile Count (`NCOLS`)** — Number of Type B elevation profiles in the DEM.",
  NROWS: "**Profile Row Count (`NROWS`)** — Normally `1` for regular USGS DEM profiles.",
  LEVEL: "**USGS DEM Level Code** — `1` = photogrammetric 7.5-min, `2` = smoothed/hypsography, `3` = DLG-integrated.",
};

/**
 * Validate a USGS DEM document and return LSP diagnostics.
 */
export function validateUsgsDem(text: string): LspDiagnostic[] {
  const model = parseUsgsDem(text);
  const lints = lintUsgsDem(model);
  return lints.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const colIdx = Math.max(0, d.column - 1);
    return {
      range: {
        start: { line: lineIdx, character: colIdx },
        end: { line: Math.max(lineIdx, (d.endLine ?? d.line) - 1), character: colIdx + 20 },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "usgs-dem",
      message: d.message,
    };
  });
}

/**
 * Extract hierarchical LSP document symbols for Type A header, Type B profiles, and Type C accuracy.
 */
export function getUsgsDemDocumentSymbols(text: string): LspDocumentSymbol[] {
  const model = parseUsgsDem(text);
  const lines = text.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);

  const children: LspDocumentSymbol[] = [];

  const hdrLine = Math.max(0, model.header.line - 1);
  children.push({
    name: `Type A Header (${model.header.quadrangleName})`,
    detail: `REF=${model.header.groundRefSystem} ZONE=${model.header.groundRefZone} ${model.grid.numCols}x${model.grid.numRows}`,
    kind: LspSymbolKind.Struct,
    range: { start: { line: hdrLine, character: 0 }, end: { line: hdrLine, character: (lines[hdrLine] ?? "").length } },
    selectionRange: { start: { line: hdrLine, character: 0 }, end: { line: hdrLine, character: 6 } },
  });

  for (const p of model.profiles) {
    const l = Math.max(0, p.line - 1);
    children.push({
      name: `Profile Col ${p.colIndex}`,
      detail: `${p.elevations.length} pts [${p.minElevation.toFixed(1)}, ${p.maxElevation.toFixed(1)}]`,
      kind: LspSymbolKind.Field,
      range: { start: { line: l, character: 0 }, end: { line: l, character: (lines[l] ?? "").length } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 6 } },
    });
  }

  if (model.accuracy) {
    const l = Math.max(0, model.accuracy.line - 1);
    children.push({
      name: "Type C Accuracy (RMSE)",
      detail: `RMSE=[${model.accuracy.rmseDem.join(", ")}]`,
      kind: LspSymbolKind.Constant,
      range: { start: { line: l, character: 0 }, end: { line: l, character: (lines[l] ?? "").length } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 6 } },
    });
  }

  return [
    {
      name: model.header.quadrangleName || "USGS DEM",
      detail: model.format,
      kind: LspSymbolKind.Package,
      range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: (lines[lastLine] ?? "").length } },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.min(20, (lines[0] ?? "").length) },
      },
      children,
    },
  ];
}

/**
 * Provide markdown hover documentation for USGS DEM keywords, parameters, and datum schemas.
 */
export function getUsgsDemHover(text: string, position: LspPosition): LspHover | null {
  const lines = text.split(/\r?\n/);
  const line = lines[position.line];
  if (!line) return null;

  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end] ?? "")) end++;
  const word = line.slice(start, end).toUpperCase();
  if (!word) return null;

  const doc = KEYWORD_DOCS[word];
  if (doc) {
    return { contents: { kind: "markdown", value: doc } };
  }

  const schemas = getUsgsDemSchemasFromLibraries();
  const matched = schemas.find(
    (s) => s.name.toUpperCase() === word || s.aliases?.some((a) => a.toUpperCase() === word),
  );
  if (matched) {
    return {
      contents: {
        kind: "markdown",
        value: `**${matched.label}** (\`${matched.name}\`)\n\n${matched.description}\n\n*Provenance:* ${matched.provenance}`,
      },
    };
  }

  return null;
}

/**
 * Provide LSP completion items for USGS DEM records, header attributes, and cleanroom schemas.
 */
export function getUsgsDemCompletions(): LspCompletionItem[] {
  const items: LspCompletionItem[] = Object.entries(KEYWORD_DOCS).map(([key, doc]) => ({
    label: key,
    kind: key.startsWith("TYPE_") ? 14 : 5,
    detail: key.startsWith("TYPE_") ? "USGS DEM Record" : "Type A Header Field",
    documentation: doc,
    insertText: key.startsWith("TYPE_") ? `${key} ` : `${key}=`,
  }));

  for (const s of getUsgsDemSchemasFromLibraries()) {
    items.push({
      label: s.name,
      kind: 7,
      detail: `${s.category} — ${s.label}`,
      documentation: s.description,
    });
  }

  return items;
}
