// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for USAF Stability and Control Digital DATCOM.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lookupDatcomModelSchema } from "./catalog/library-package-adapter.js";
import { lintDatcom } from "./lints/index.js";
import { parseDatcomDeck } from "./parser/deck-parser.js";
import { KNOWN_NAMELIST_GROUPS } from "./types.js";

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
  Constant = 14,
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
  detail: string;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const NAMELIST_DOCS: Record<string, string> = {
  FLTCON: "**$FLTCON** — Flight Conditions: `NMACH`, `MACH`, `NALPHA`, `ALSCHD`, `NALT`, `ALT`, `WT`, `RNNUB`, `LOOP`.",
  OPTINS: "**$OPTINS** — Reference Options: `SREF` (wing area), `CBARR` (MAC), `BLREF` (wingspan), `ROUGFC`.",
  SYNTHS:
    "**$SYNTHS** — Synthesis / Component Locations: `XCG`, `ZCG`, `XW`, `ZW`, `ALIW`, `XH`, `ZH`, `ALIH`, `XV`, `ZV`, `VERTUP`.",
  BODY: "**$BODY** — Axisymmetric / Cambered Fuselage Geometry: `NX`, `X`, `S`, `P`, `R`, `ZU`, `ZL`, `BNOSE`, `BTAIL`.",
  WGPLNF:
    "**$WGPLNF** — Wing Planform Geometry: `CHRDR`, `CHRDTP`, `SSPN`, `SSPNE`, `SAVSI`, `CHSTAT`, `TWISTA`, `DHDADI`, `TYPE`.",
  HTPLNF:
    "**$HTPLNF** — Horizontal Tail Planform Geometry: `CHRDR`, `CHRDTP`, `SSPN`, `SSPNE`, `SAVSI`, `CHSTAT`, `TYPE`.",
  VTPLNF:
    "**$VTPLNF** — Vertical Tail Planform Geometry: `CHRDR`, `CHRDTP`, `SSPN`, `SSPNE`, `SAVSI`, `CHSTAT`, `TYPE`.",
  VFPLNF: "**$VFPLNF** — Ventral Fin Planform Geometry: `CHRDR`, `CHRDTP`, `SSPN`, `SAVSI`, `CHSTAT`, `TYPE`.",
  SYMFLP:
    "**$SYMFLP** — Symmetrical Trailing-Edge Flap / Elevator Deflection: `FTYPE`, `NDELTA`, `DELTA`, `SPANFI`, `SPANFO`, `CHRDFI`, `CHRDFO`.",
  ASYFLP:
    "**$ASYFLP** — Asymmetrical Control Surface (Aileron / Spoiler): `STYPE`, `NDELTA`, `DELTAL`, `DELTAR`, `SPANFI`, `SPANFO`.",
  WGSCHR:
    "**$WGSCHR** — Wing Airfoil Section Coordinates / Characteristics: `TYPEIN`, `NPTS`, `X`, `YUPPER`, `YLOWER`, `TOVC`, `CLI`, `CMO`.",
};

const PARAM_DOCS: Record<string, string> = {
  NMACH: "`NMACH` — Number of Mach numbers in `MACH` array.",
  MACH: "`MACH` — Array of freestream Mach numbers.",
  NALPHA: "`NALPHA` — Number of angles of attack in `ALSCHD` array.",
  ALSCHD: "`ALSCHD` — Schedule of angles of attack (deg).",
  NALT: "`NALT` — Number of altitudes in `ALT` array.",
  ALT: "`ALT` — Array of flight altitudes (in active `DIM` units).",
  WT: "`WT` — Aircraft gross weight (lbf in FT/IN, N in M).",
  SREF: "`SREF` — Reference wing area.",
  CBARR: "`CBARR` — Reference mean aerodynamic chord (MAC).",
  BLREF: "`BLREF` — Reference wing span.",
  XCG: "`XCG` — Longitudinal center-of-gravity location.",
  XW: "`XW` — Wing apex longitudinal location.",
  XH: "`XH` — Horizontal tail apex longitudinal location.",
  XV: "`XV` — Vertical tail apex longitudinal location.",
  CHRDR: "`CHRDR` — Planform root chord.",
  CHRDTP: "`CHRDTP` — Planform tip chord.",
  SSPN: "`SSPN` — Theoretical semispan (half of full wingspan).",
  SAVSI: "`SAVSI` — Inboard panel sweep angle (deg) at `CHSTAT` chord fraction.",
  CHSTAT: "`CHSTAT` — Reference chord fraction for sweep angle (0.0=LE, 0.25=c/4).",
};

const CONTROL_CARD_DOCS: Record<string, string> = {
  CASEID: "**CASEID** — Case identification title card.",
  DIM: "**DIM** — Dimension unit system (`FT`, `IN`, `M`, `CM`).",
  DERIV: "**DERIV** — Angular units for stability derivatives (`DEG` or `RAD`).",
  DAMP: "**DAMP** — Compute dynamic damping derivatives (`Cmq`, `Clp`, `Cnr`).",
  BUILD: "**BUILD** — Output component build-up aerodynamics (body, wing, tail).",
  PLOT: "**PLOT** — Generate aerodynamic polar plot output.",
  SAVE: "**SAVE** — Retain current configuration NAMELISTs for the following `NEXT CASE`.",
  "NEXT CASE": "**NEXT CASE** — Terminate current case and start a subsequent DATCOM case.",
};

interface DatcomCstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface DatcomCstLineIndex {
  byRow: Map<number, DatcomCstLineEntry>;
  lastRow: number;
}

function buildDatcomCstLineIndex(content: string): DatcomCstLineIndex {
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("datcom", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  const byRow = new Map<number, DatcomCstLineEntry>();
  if (rootNode) {
    let maxRow = 0;
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const text = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + text.length;
      byRow.set(row, { row, text, startCol, endCol });
      if (row > maxRow) maxRow = row;
    }
    const rootEndRow = (rootNode as { endPosition?: { row?: number } }).endPosition?.row ?? 0;
    return { byRow, lastRow: Math.max(maxRow, rootEndRow) };
  }

  const rawLines = content.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const startCol = Math.max(0, raw.search(/\S/));
    byRow.set(i, { row: i, text: trimmed, startCol, endCol: startCol + trimmed.length });
  }
  return { byRow, lastRow: Math.max(0, rawLines.length - 1) };
}

/**
 * Validates a Digital DATCOM deck and returns LSP diagnostics.
 */
export function validateDatcom(content: string, _uri: string = "aircraft.dcm"): LspDiagnostic[] {
  const deck = parseDatcomDeck(content);
  const diags = lintDatcom(deck);
  const cstIndex = buildDatcomCstLineIndex(content);

  return diags.map((d) => {
    const lineIdx = d.line ? Math.max(0, Math.min(cstIndex.lastRow, d.line - 1)) : 0;
    const lineEnd = cstIndex.byRow.get(lineIdx)?.endCol ?? 0;
    const startChar = d.column ? Math.max(0, d.column - 1) : 0;
    const endChar = Math.max(startChar + 1, lineEnd);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-datcom",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols (Cases -> NAMELIST blocks & NACA cards).
 */
export function getDatcomDocumentSymbols(content: string): LspDocumentSymbol[] {
  const deck = parseDatcomDeck(content);
  const cstIndex = buildDatcomCstLineIndex(content);
  const lastLine = cstIndex.lastRow;

  return deck.cases.map((c) => {
    const children: LspDocumentSymbol[] = [];

    for (const nl of c.namelists) {
      const lineIdx = Math.max(0, nl.line - 1);
      const entry = cstIndex.byRow.get(lineIdx);
      const range: LspRange = {
        start: { line: lineIdx, character: entry?.startCol ?? 0 },
        end: { line: lineIdx, character: Math.max((entry?.startCol ?? 0) + 1, entry?.endCol ?? 1) },
      };
      children.push({
        name: `$${nl.group}`,
        detail: `${Object.keys(nl.values).length} params`,
        kind: LspSymbolKind.Class,
        range,
        selectionRange: range,
      });
    }

    for (const naca of c.nacaCards) {
      const lineIdx = Math.max(0, naca.line - 1);
      const entry = cstIndex.byRow.get(lineIdx);
      const range: LspRange = {
        start: { line: lineIdx, character: entry?.startCol ?? 0 },
        end: { line: lineIdx, character: Math.max((entry?.startCol ?? 0) + 1, entry?.endCol ?? 1) },
      };
      children.push({
        name: naca.raw,
        detail: `Airfoil (${naca.surface})`,
        kind: LspSymbolKind.Constant,
        range,
        selectionRange: range,
      });
    }

    const firstLine = children.length > 0 ? children[0]!.range.start.line : 0;
    const endLine = children.length > 0 ? children[children.length - 1]!.range.end.line : lastLine;
    const caseRange: LspRange = {
      start: { line: firstLine, character: 0 },
      end: { line: endLine, character: Math.max(1, cstIndex.byRow.get(endLine)?.endCol ?? 1) },
    };

    return {
      name: c.caseId,
      detail: `DIM ${c.dim}, DERIV ${c.deriv}`,
      kind: LspSymbolKind.Package,
      range: caseRange,
      selectionRange: caseRange,
      children,
    };
  });
}

/**
 * Returns hover documentation for NAMELIST groups, parameters, control cards, or NACA airfoils.
 */
export function getDatcomHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildDatcomCstLineIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const line = " ".repeat(entry.startCol) + entry.text;

  const col = Math.max(0, Math.min(position.character, line.length));
  // Expand word around cursor (including $ and -)
  let start = col;
  while (start > 0 && /[A-Za-z0-9_$-]/.test(line[start - 1]!)) start--;
  let end = col;
  while (end < line.length && /[A-Za-z0-9_$-]/.test(line[end]!)) end++;
  const token = line.slice(start, end).toUpperCase();
  if (!token) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  const bareGroup = token.replace(/^[$&]/, "");
  if (NAMELIST_DOCS[bareGroup]) {
    return { contents: { kind: "markdown", value: NAMELIST_DOCS[bareGroup]! }, range };
  }
  if (PARAM_DOCS[token]) {
    return { contents: { kind: "markdown", value: PARAM_DOCS[token]! }, range };
  }
  if (CONTROL_CARD_DOCS[token]) {
    return { contents: { kind: "markdown", value: CONTROL_CARD_DOCS[token]! }, range };
  }
  if (token.startsWith("NACA-")) {
    const parts = token.split("-");
    const desig = parts[parts.length - 1] ?? token;
    const schema = lookupDatcomModelSchema(desig);
    if (schema) {
      return {
        contents: {
          kind: "markdown",
          value: `**${schema.label}** (\`${schema.name}\`)\n\n${schema.description}\n\n*Provenance:* ${schema.provenance}`,
        },
        range,
      };
    }
    return {
      contents: {
        kind: "markdown",
        value: `**NACA Airfoil Card** (\`${token}\`) — Specifies NACA section geometry for DATCOM surface.`,
      },
      range,
    };
  }

  return null;
}

/**
 * Returns completion items for DATCOM NAMELIST groups, parameters, and control cards.
 */
export function getDatcomCompletions(prefix: string = ""): LspCompletionItem[] {
  const upper = prefix.trim().toUpperCase();
  const items: LspCompletionItem[] = [];

  for (const grp of KNOWN_NAMELIST_GROUPS) {
    items.push({
      label: `$${grp}`,
      detail: "DATCOM NAMELIST",
      documentation: NAMELIST_DOCS[grp],
      insertText: `$${grp} $`,
    });
  }
  for (const [card, doc] of Object.entries(CONTROL_CARD_DOCS)) {
    items.push({
      label: card,
      detail: "DATCOM Control Card",
      documentation: doc,
    });
  }
  for (const [param, doc] of Object.entries(PARAM_DOCS)) {
    items.push({
      label: param,
      detail: "NAMELIST Parameter",
      documentation: doc,
      insertText: `${param}=`,
    });
  }

  if (!upper) return items;
  return items.filter((item) => item.label.toUpperCase().includes(upper));
}
