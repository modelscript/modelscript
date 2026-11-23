// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/rinex`:
 * - `validateRinex`: Diagnostics from `lintRinex`
 * - `getRinexDocumentSymbols`: Header, epochs, satellites, and broadcast ephemerides
 * - `getRinexHover`: Documentation for RINEX v2 header labels, observation types, and WGS-84 constants
 * - `getRinexCompletions`: Completions for RINEX v2 header labels and observation type codes
 */

import { RINEX_CLEANROOM_SPECS } from "./catalog/rinex-std-schemas.js";
import { lintRinex } from "./lints/index.js";
import { formatRinexTimestamp, parseRinex } from "./parser/index.js";

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
  insertText?: string | undefined;
}

const RINEX_HEADER_DOCS: Record<string, string> = {
  "RINEX VERSION / TYPE":
    "**RINEX VERSION / TYPE** — Format version (`2.10` / `2.11`), file type (`O` = Observation, `N` = GPS Navigation), and satellite system (`G`, `R`, `E`, `M`).",
  "PGM / RUN BY / DATE":
    "**PGM / RUN BY / DATE** — Name of program creating file, agency/operator, and UTC creation date.",
  "MARKER NAME": "**MARKER NAME** — Name of the antenna marker / geodetic station.",
  "APPROX POSITION XYZ":
    "**APPROX POSITION XYZ** — Approximate geocentric WGS-84 ECEF marker coordinates `(X, Y, Z)` in meters.",
  "ANTENNA: DELTA H/E/N":
    "**ANTENNA: DELTA H/E/N** — Antenna height `H` above marker and horizontal eccentricities `E`, `N` in meters.",
  "# / TYPES OF OBSERV":
    "**# / TYPES OF OBSERV** — Count and ordered list of observation codes (e.g., `C1`, `P1`, `P2`, `L1`, `L2`, `D1`, `S1`).",
  "TIME OF FIRST OBS":
    "**TIME OF FIRST OBS** — Timestamp of the first observation record (`YYYY MM DD HH MM SS.sssssss GPS`).",
  "ION ALPHA": "**ION ALPHA** — Klobuchar ionospheric model alpha parameters `a0..a3`.",
  "ION BETA": "**ION BETA** — Klobuchar ionospheric model beta parameters `b0..b3`.",
  "END OF HEADER": "**END OF HEADER** — Mandatory delimiter terminating the RINEX v2 header block.",
};

function makeLineRange(lineZeroBased: number, lineText: string): LspRange {
  return {
    start: { line: lineZeroBased, character: 0 },
    end: { line: lineZeroBased, character: Math.max(1, lineText.length) },
  };
}

/**
 * Validates a RINEX v2 OBS or NAV file and returns LSP diagnostics.
 */
export function validateRinex(content: string, _uri: string = "station.obs"): LspDiagnostic[] {
  const doc = parseRinex(content);
  const diags = lintRinex(doc);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const lineText = lines[lineIdx] ?? "";
    const startCol = Math.max(0, d.column - 1);
    const endCol = Math.max(startCol + 1, lineText.length);
    return {
      range: {
        start: { line: lineIdx, character: startCol },
        end: { line: lineIdx, character: endCol },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-rinex",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols for a RINEX v2 OBS or NAV file.
 */
export function getRinexDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseRinex(content);
  const lines = content.split(/\r?\n/);
  const symbols: LspDocumentSymbol[] = [];

  // Header symbol
  if (doc.header.rawLines.length > 0) {
    const endLine = (doc.header.endOfHeaderLine ?? doc.header.rawLines.length) - 1;
    const headerChildren: LspDocumentSymbol[] = doc.header.rawLines.map((h) => {
      const idx = Math.max(0, h.line - 1);
      const rng = makeLineRange(idx, lines[idx] ?? "");
      return {
        name: h.label,
        detail: h.data.trim() || undefined,
        kind: LspSymbolKind.Property,
        range: rng,
        selectionRange: rng,
      };
    });
    symbols.push({
      name: doc.header.markerName ? `Header (${doc.header.markerName})` : "RINEX Header",
      detail: `v${Number.isFinite(doc.header.version) ? doc.header.version.toFixed(2) : "?"} ${doc.fileType}`,
      kind: LspSymbolKind.Namespace,
      range: {
        start: { line: 0, character: 0 },
        end: { line: Math.max(0, endLine), character: (lines[endLine] ?? "").length },
      },
      selectionRange: makeLineRange(0, lines[0] ?? ""),
      children: headerChildren,
    });
  }

  // OBS Epochs
  for (const ep of doc.epochs) {
    const idx = Math.max(0, ep.line - 1);
    const rng = makeLineRange(idx, lines[idx] ?? "");
    const satChildren: LspDocumentSymbol[] = ep.satellites.map((s) => {
      const sIdx = Math.max(0, s.line - 1);
      const sRng = makeLineRange(sIdx, lines[sIdx] ?? "");
      return {
        name: s.prn,
        detail: Object.keys(s.observations).join(", "),
        kind: LspSymbolKind.Field,
        range: sRng,
        selectionRange: sRng,
      };
    });
    symbols.push({
      name: formatRinexTimestamp(ep.timestamp),
      detail: `${ep.satellites.length} SVs`,
      kind: LspSymbolKind.Class,
      range: rng,
      selectionRange: rng,
      children: satChildren,
    });
  }

  // NAV Ephemerides
  for (const ephem of doc.ephemerides) {
    const idx = Math.max(0, ephem.line - 1);
    const endIdx = Math.min(lines.length - 1, idx + 7);
    symbols.push({
      name: `${ephem.prn} Ephemeris`,
      detail: `Toc ${formatRinexTimestamp(ephem.toc)} · Toe ${ephem.toe}s`,
      kind: LspSymbolKind.Struct,
      range: {
        start: { line: idx, character: 0 },
        end: { line: endIdx, character: (lines[endIdx] ?? "").length },
      },
      selectionRange: makeLineRange(idx, lines[idx] ?? ""),
    });
  }

  return symbols;
}

/**
 * Provides hover documentation at a given cursor position in a RINEX v2 document.
 */
export function getRinexHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line];
  if (line === undefined) return null;

  // Check column 61-80 header label when cursor is in the label zone
  const label = line.slice(60).trim().toUpperCase();
  if (position.character >= 60 && label && RINEX_HEADER_DOCS[label]) {
    return {
      contents: {
        kind: "markdown",
        value: RINEX_HEADER_DOCS[label]!,
      },
      range: {
        start: { line: position.line, character: 60 },
        end: { line: position.line, character: line.length },
      },
    };
  }

  // Check packed 3-character RINEX v2 epoch PRN list (columns 32..68)
  if (position.character >= 32 && position.character < 68) {
    const slotStart = 32 + Math.floor((position.character - 32) / 3) * 3;
    const prnCandidate = line
      .slice(slotStart, slotStart + 3)
      .trim()
      .toUpperCase();
    if (/^[GRESCJ]\d{2}$/.test(prnCandidate)) {
      const sysNames: Record<string, string> = {
        G: "GPS",
        R: "GLONASS",
        E: "Galileo",
        S: "SBAS",
        C: "BeiDou",
        J: "QZSS",
      };
      const sysName = sysNames[prnCandidate[0]!] ?? "GNSS";
      return {
        contents: {
          kind: "markdown",
          value: `**Satellite \`${prnCandidate}\`** — ${sysName} Space Vehicle PRN ${Number.parseInt(prnCandidate.slice(1), 10)}.`,
        },
        range: {
          start: { line: position.line, character: slotStart },
          end: { line: position.line, character: slotStart + 3 },
        },
      };
    }
  }

  // Extract token under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end] ?? "")) end++;
  const token = line.slice(start, end).toUpperCase();
  if (!token) return null;

  // Check cleanroom stdlib schemas (C1, P1, P2, L1, L2, D1, S1, WGS84_MU, etc.)
  const spec = RINEX_CLEANROOM_SPECS.find(
    (s) => s.modelType.toUpperCase() === token || s.aliases?.some((a) => a.toUpperCase() === token),
  );
  if (spec) {
    return {
      contents: {
        kind: "markdown",
        value: `**${spec.modelType}** — ${spec.label}\n\n${spec.description}\n\n*Reference:* ${spec.provenance}`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  // Check standalone PRN pattern (e.g. G01..G32)
  if (/^[GRESCJ]\d{2}$/.test(token)) {
    const sysNames: Record<string, string> = {
      G: "GPS",
      R: "GLONASS",
      E: "Galileo",
      S: "SBAS",
      C: "BeiDou",
      J: "QZSS",
    };
    const sysName = sysNames[token[0]!] ?? "GNSS";
    return {
      contents: {
        kind: "markdown",
        value: `**Satellite \`${token}\`** — ${sysName} Space Vehicle PRN ${Number.parseInt(token.slice(1), 10)}.`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  return null;
}

/**
 * Provides RINEX v2 header label and observation code completions.
 */
export function getRinexCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line] ?? "";
  const items: LspCompletionItem[] = [];

  if (position.character >= 55) {
    for (const [label, doc] of Object.entries(RINEX_HEADER_DOCS)) {
      items.push({
        label,
        kind: 14, // Keyword
        detail: "RINEX v2 Header Label",
        documentation: doc,
        insertText: label,
      });
    }
    return items;
  }

  for (const spec of RINEX_CLEANROOM_SPECS) {
    items.push({
      label: spec.modelType,
      kind: spec.category === "Observation Type" ? 21 : 12,
      detail: spec.label,
      documentation: spec.description,
      insertText: spec.modelType,
    });
  }

  if (line.trim().length === 0) {
    for (const [label, doc] of Object.entries(RINEX_HEADER_DOCS)) {
      items.push({
        label,
        kind: 14,
        detail: "RINEX v2 Header Label",
        documentation: doc,
        insertText: " ".repeat(60) + label,
      });
    }
  }

  return items;
}
