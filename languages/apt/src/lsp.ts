// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/apt`.
 *
 * Provides diagnostics (`validateApt`), document symbols (`getAptDocumentSymbols`),
 * hover documentation (`getAptHover`), and completions (`getAptCompletions`).
 */

import { solveAptToClData } from "./cad/geometry-solver.js";
import { getAptSchemasFromLibraries, lookupAptModelSchema } from "./catalog/library-package-adapter.js";
import { lintApt } from "./lints/index.js";
import { parseAptProgram } from "./parser/apt-parser.js";

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
  documentation: string;
  kind: number;
}

const APT_KEYWORD_DOCS: Record<string, { detail: string; doc: string }> = {
  PARTNO: {
    detail: "APT Part Program Title",
    doc: "**PARTNO** — Declares the descriptive part program title printed on the CLDATA header.",
  },
  MACHIN: {
    detail: "APT Postprocessor Target",
    doc: "**MACHIN / name, id** — Selects the target CNC machine postprocessor.",
  },
  UNITS: {
    detail: "APT Measurement Units",
    doc: "**UNITS / INCHES | MM** — Sets program coordinate and feedrate units.",
  },
  INTOL: {
    detail: "APT Inside Chordal Tolerance",
    doc: "**INTOL / tol** — Maximum allowable chordal deviation inside a curved surface.",
  },
  OUTTOL: {
    detail: "APT Outside Chordal Tolerance",
    doc: "**OUTTOL / tol** — Maximum allowable chordal deviation outside a curved surface.",
  },
  COOLNT: {
    detail: "APT Coolant Control",
    doc: "**COOLNT / ON | OFF | FLOOD | MIST** — Controls cutting coolant state.",
  },
  RAPID: {
    detail: "APT Rapid Traverse Modifier",
    doc: "**RAPID** — Executes the immediately following motion statement at rapid traverse speed.",
  },
  FINI: {
    detail: "APT End of Part Program",
    doc: "**FINI** — Terminates the APT part program and signals end-of-tape to the postprocessor.",
  },
  TO: {
    detail: "APT Surface Relation (Before)",
    doc: "**TO** — Positions the cutter tangent to the near side of the check/drive surface.",
  },
  ON: {
    detail: "APT Surface Relation (Center)",
    doc: "**ON** — Positions the cutter center directly on the check/drive surface.",
  },
  PAST: {
    detail: "APT Surface Relation (Beyond)",
    doc: "**PAST** — Positions the cutter tangent to the far side of the check/drive surface.",
  },
  TANTO: {
    detail: "APT Surface Relation (Tangent To)",
    doc: "**TANTO** — Stops the cutter at the exact point of tangency between drive and check surfaces.",
  },
  GOUP: {
    detail: "APT Motion Upward",
    doc: "**GOUP / ds, mod, cs** — Moves cutter upward along the drive surface to the check surface.",
  },
  GODOWN: {
    detail: "APT Motion Downward",
    doc: "**GODOWN / ds, mod, cs** — Moves cutter downward along the drive surface to the check surface.",
  },
};

/**
 * Validates an APT part program and returns LSP diagnostics.
 */
export function validateApt(content: string, _uri = "part.apt"): LspDiagnostic[] {
  const diags = lintApt(content);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const lineText = lines[lineIdx] ?? "";
    const startChar = Math.max(0, d.column - 1);
    const spanLen =
      d.startOffset !== undefined && d.endOffset !== undefined && d.endOffset > d.startOffset
        ? d.endOffset - d.startOffset
        : Math.max(1, lineText.length - startChar);
    const endChar = Math.max(startChar + 1, Math.min(lineText.length || startChar + 1, startChar + spanLen));
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-apt",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (part program root, canonical geometry definitions, and cutter setup).
 */
export function getAptDocumentSymbols(content: string): LspDocumentSymbol[] {
  const program = parseAptProgram(content);
  const lines = content.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const lastCol = (lines[lastLine] ?? "").length;

  const children: LspDocumentSymbol[] = [];

  for (const geom of program.geometryList) {
    const startL = Math.max(0, geom.line - 1);
    const endL = Math.max(startL, geom.endLine - 1);
    const range: LspRange = {
      start: { line: startL, character: Math.max(0, geom.column - 1) },
      end: { line: endL, character: Math.max(0, geom.endColumn - 1) },
    };
    const selectionRange: LspRange = {
      start: { line: startL, character: Math.max(0, geom.column - 1) },
      end: { line: startL, character: Math.max(0, geom.column - 1) + geom.label.length },
    };
    children.push({
      name: geom.label,
      detail: `${geom.geometryKind} / ${geom.args.join(", ")}`,
      kind:
        geom.geometryKind === "PLANE" || geom.geometryKind === "PATERN" ? LspSymbolKind.Class : LspSymbolKind.Variable,
      range,
      selectionRange,
    });
  }

  for (const stmt of program.statements) {
    if (
      stmt.stmtKind === "postprocessor" &&
      (stmt.keyword === "CUTTER" || stmt.keyword === "SPINDL" || stmt.keyword === "FEDRAT")
    ) {
      const startL = Math.max(0, stmt.line - 1);
      const endL = Math.max(startL, stmt.endLine - 1);
      const range: LspRange = {
        start: { line: startL, character: Math.max(0, stmt.column - 1) },
        end: { line: endL, character: Math.max(0, stmt.endColumn - 1) },
      };
      children.push({
        name: stmt.keyword,
        detail: stmt.args.join(", "),
        kind: LspSymbolKind.Constant,
        range,
        selectionRange: {
          start: range.start,
          end: { line: startL, character: range.start.character + stmt.keyword.length },
        },
      });
    }
  }

  return [
    {
      name: program.partno,
      detail: `APT Part Program (${program.units}, ${program.geometryList.length} geometries)`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: lastCol },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.min((lines[0] ?? "").length, Math.max(1, program.partno.length)) },
      },
      children,
    },
  ];
}

/**
 * Provides hover documentation for APT keywords, surface modifiers, and user-defined geometry labels.
 */
export function getAptHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (!lineText) return null;

  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1] ?? "")) start--;
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end] ?? "")) end++;
  const token = lineText.slice(start, end).trim();
  if (!token) return null;

  const upper = token.toUpperCase();
  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  // 1. Check cleanroom stdlib schemas
  const schema = lookupAptModelSchema(upper);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.name} — ${schema.label}**\n\n${schema.description}\n\n*Standard:* ${schema.provenance}`,
      },
      range,
    };
  }

  // 2. Check postprocessor / modifier keyword docs
  const kwDoc = APT_KEYWORD_DOCS[upper];
  if (kwDoc) {
    return {
      contents: {
        kind: "markdown",
        value: kwDoc.doc,
      },
      range,
    };
  }

  // 3. Check user-defined geometry labels in the document
  const program = parseAptProgram(content);
  const geomDef = program.geometries.get(upper);
  if (geomDef) {
    const clData = solveAptToClData(program);
    const resolved = clData.geometries.get(upper);
    let extra = "";
    if (resolved?.kind === "POINT") {
      extra = `\n\nResolved: \`(${resolved.x.toFixed(4)}, ${resolved.y.toFixed(4)}, ${resolved.z.toFixed(4)})\``;
    } else if (resolved?.kind === "CIRCLE") {
      extra = `\n\nResolved: center \`(${resolved.cx.toFixed(4)}, ${resolved.cy.toFixed(4)})\`, radius \`${resolved.radius.toFixed(4)}\``;
    } else if (resolved?.kind === "LINE") {
      extra = `\n\nResolved: \`(${resolved.x1.toFixed(4)}, ${resolved.y1.toFixed(4)}) -> (${resolved.x2.toFixed(4)}, ${resolved.y2.toFixed(4)})\``;
    } else if (resolved?.kind === "PLANE") {
      extra = `\n\nResolved: \`${resolved.nx.toFixed(4)}x + ${resolved.ny.toFixed(4)}y + ${resolved.nz.toFixed(4)}z = ${resolved.d.toFixed(4)}\``;
    } else if (resolved?.kind === "PATERN") {
      extra = `\n\nResolved: \`${resolved.points.length}\` points`;
    }
    return {
      contents: {
        kind: "markdown",
        value: `**${geomDef.label}** (\`${geomDef.geometryKind}\`)\n\n\`\`\`apt\n${geomDef.raw}\n\`\`\`${extra}`,
      },
      range,
    };
  }

  return null;
}

/**
 * Returns APT keyword, geometry, motion, and modifier completion items from the cleanroom standard library.
 */
export function getAptCompletions(): LspCompletionItem[] {
  const schemas = getAptSchemasFromLibraries();
  const items: LspCompletionItem[] = schemas.map((s) => ({
    label: s.name,
    detail: s.label,
    documentation: s.description,
    kind: s.category === "Analytic Geometry" ? 7 : 14,
  }));

  for (const [kw, info] of Object.entries(APT_KEYWORD_DOCS)) {
    if (!items.some((it) => it.label === kw)) {
      items.push({
        label: kw,
        detail: info.detail,
        documentation: info.doc,
        kind: 14,
      });
    }
  }

  return items;
}
