// SPDX-License-Identifier: AGPL-3.0-or-later

import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { lookupApdlElementSchema } from "./catalog/library-package-adapter.js";
import { lintApdl } from "./lints/index.js";
import { parseApdl } from "./parser/deck-parser.js";
import { getApdlWasmParser } from "./wasm-loader.js";

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
  detail: string;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const APDL_COMMAND_DOCS: Record<string, { detail: string; doc: string; snippet?: string }> = {
  "/PREP7": {
    detail: "Preprocessor",
    doc: "Enters the ANSYS APDL model creation preprocessor (`/PREP7`) for defining element types, materials, geometry, and meshes.",
  },
  "/SOLU": {
    detail: "Solution Processor",
    doc: "Enters the ANSYS APDL solution processor (`/SOLU`) for defining analysis type, loads, boundary conditions, and executing `SOLVE`.",
  },
  "/POST1": {
    detail: "General Postprocessor",
    doc: "Enters the ANSYS APDL general postprocessor (`/POST1`) for reviewing nodal displacements, reactions, and element stresses.",
  },
  "/TITLE": {
    detail: "Model Title",
    doc: "`/TITLE, Title` — Defines the main title for the APDL model.",
    snippet: "/TITLE, ${1:Structural Analysis}",
  },
  "/UNITS": {
    detail: "Units System",
    doc: "`/UNITS, Label` — Annotates the unit system (`SI`, `MPA`, `BIN`, `BFT`, `CGS`).",
    snippet: "/UNITS, SI",
  },
  FINISH: {
    detail: "Exit Processor",
    doc: "Exits normally from the current processor and returns to the Begin level.",
  },
  ET: {
    detail: "Element Type",
    doc: "`ET, ITYPE, Ename` — Defines a local element type from the element library (e.g., `BEAM188`, `LINK180`, `SOLID185`, `SHELL181`).",
    snippet: "ET, 1, BEAM188",
  },
  MP: {
    detail: "Material Property",
    doc: "`MP, Lab, MAT, C0` — Defines a linear material property (`EX`, `PRXY`, `DENS`, `GXY`, `ALPX`).",
    snippet: "MP, EX, 1, 210e9",
  },
  R: {
    detail: "Real Constant Set",
    doc: "`R, NSET, R1, R2, ...` — Defines element real constants (e.g., cross-sectional area `A` for `LINK180`).",
    snippet: "R, 1, 1e-4",
  },
  SECTYPE: {
    detail: "Section Type",
    doc: "`SECTYPE, SECID, Type, Subtype` — Associates a section type (`BEAM`, `SHELL`) and subtype (`RECT`, `CSOLID`, `CTUBE`, `ASEC`) with a section ID.",
    snippet: "SECTYPE, 1, BEAM, RECT",
  },
  SECDATA: {
    detail: "Section Geometry",
    doc: "`SECDATA, VAL1, VAL2, ...` — Describes the cross-section geometry for the active `SECTYPE`.",
    snippet: "SECDATA, 0.05, 0.10",
  },
  K: {
    detail: "Keypoint",
    doc: "`K, NPT, X, Y, Z` — Defines a geometric keypoint at coordinates `(X, Y, Z)`.",
    snippet: "K, 1, 0, 0, 0",
  },
  L: {
    detail: "Line",
    doc: "`L, P1, P2` — Defines a straight line between keypoints `P1` and `P2`.",
    snippet: "L, 1, 2",
  },
  N: {
    detail: "Node",
    doc: "`N, NODE, X, Y, Z` — Defines a finite element node at coordinates `(X, Y, Z)`.",
    snippet: "N, 1, 0, 0, 0",
  },
  E: {
    detail: "Element",
    doc: "`E, I, J, K, L, ...` — Defines an element by node connectivity using the active `TYPE`, `MAT`, `REAL`, and `SECNUM`.",
    snippet: "E, 1, 2",
  },
  ESIZE: {
    detail: "Element Size / Divisions",
    doc: "`ESIZE, SIZE, NDIV` — Specifies the default element edge length or number of divisions along lines for meshing.",
    snippet: "ESIZE, , 10",
  },
  LMESH: {
    detail: "Mesh Lines",
    doc: "`LMESH, NL1, NL2, NINC` — Generates nodes and line elements (`BEAM188`, `LINK180`) along selected lines.",
    snippet: "LMESH, ALL",
  },
  D: {
    detail: "Displacement Constraint",
    doc: "`D, Node, Lab, VALUE` — Defines degree-of-freedom displacement constraints (`ALL`, `UX`, `UY`, `UZ`, `ROTX`, `ROTY`, `ROTZ`).",
    snippet: "D, 1, ALL, 0",
  },
  F: {
    detail: "Nodal Force / Moment",
    doc: "`F, Node, Lab, VALUE` — Specifies concentrated nodal force or moment (`FX`, `FY`, `FZ`, `MX`, `MY`, `MZ`).",
    snippet: "F, 2, FY, -1000",
  },
  SF: {
    detail: "Surface Load",
    doc: "`SF, Nlist, Lab, VALUE` — Specifies surface loads on nodes or elements (`PRES`, `CONV`, `HFLUX`).",
    snippet: "SF, ALL, PRES, 1000",
  },
  ANTYPE: {
    detail: "Analysis Type",
    doc: "`ANTYPE, Antype` — Specifies the analysis type (`STATIC`, `MODAL`, `BUCKLE`, `HARMIC`, `TRANS`).",
    snippet: "ANTYPE, STATIC",
  },
  SOLVE: {
    detail: "Start Solution",
    doc: "`SOLVE` — Starts the finite element equation solver for the current load step.",
  },
  "*SET": {
    detail: "Assign Parameter",
    doc: "`*SET, Par, VALUE` — Assigns a scalar or array value to a user-named APDL parameter.",
    snippet: "*SET, L, 2.0",
  },
  "*DIM": {
    detail: "Dimension Array",
    doc: "`*DIM, Par, Type, IMAX, JMAX, KMAX` — Defines an APDL array parameter and its dimensions.",
    snippet: "*DIM, XVAL, ARRAY, 10",
  },
  "*DO": {
    detail: "Loop Start",
    doc: "`*DO, Par, IVAL, FVAL, INC` — Defines the beginning of a parametric do-loop terminated by `*ENDDO`.",
    snippet: "*DO, I, 1, 10, 1\n  \n*ENDDO",
  },
  "*ENDDO": {
    detail: "Loop End",
    doc: "`*ENDDO` — Terminates a `*DO` parametric loop.",
  },
  "*IF": {
    detail: "Conditional Branch",
    doc: "`*IF, VAL1, Oper1, VAL2, THEN` — Conditionally executes commands (`EQ`, `NE`, `LT`, `GT`, `LE`, `GE`).",
    snippet: "*IF, I, EQ, 1, THEN\n  \n*ENDIF",
  },
  "*ELSE": {
    detail: "Else Branch",
    doc: "`*ELSE` — Alternative branch inside a `*IF ... *ENDIF` block.",
  },
  "*ENDIF": {
    detail: "End Conditional",
    doc: "`*ENDIF` — Terminates a `*IF` conditional block.",
  },
  "*GET": {
    detail: "Retrieve Entity Value",
    doc: "`*GET, Par, Entity, ENTNUM, Item1, IT1NUM` — Retrieves model or solution data into an APDL parameter.",
    snippet: "*GET, NMAX, NODE, 0, NUM, MAX",
  },
};

interface ApdlCstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

function buildApdlCstLineMap(content: string): Map<number, ApdlCstLineEntry> {
  const byRow = new Map<number, ApdlCstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode = getApdlWasmParser().parse(content)?.rootNode ?? null;
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

/**
 * Validates an APDL script and returns LSP diagnostics (`APDL1001`–`APDL5006`).
 */
export function validateApdl(content: string): LspDiagnostic[] {
  const diags = lintApdl(content);
  const cstLines = buildApdlCstLineMap(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const colIdx = Math.max(0, d.column - 1);
    const lineLen = cstLines.get(lineIdx)?.endCol ?? 1;
    return {
      range: {
        start: { line: lineIdx, character: colIdx },
        end: { line: lineIdx, character: Math.max(colIdx + 1, lineLen) },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-apdl",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (processors, parameters, element types, materials, sections).
 */
export function getApdlDocumentSymbols(content: string): LspDocumentSymbol[] {
  const deck = parseApdl(content);
  const cstLines = buildApdlCstLineMap(content);
  const symbols: LspDocumentSymbol[] = [];

  const makeRange = (line: number): LspRange => {
    const idx = Math.max(0, line - 1);
    const entry = cstLines.get(idx);
    const startCol = entry?.startCol ?? 0;
    const endCol = entry?.endCol ?? Math.max(1, startCol + 1);
    return {
      start: { line: idx, character: startCol },
      end: { line: idx, character: endCol },
    };
  };

  for (const stmt of deck.statements) {
    if (stmt.kind === "processor") {
      const r = makeRange(stmt.line);
      symbols.push({
        name: stmt.command,
        detail: `Processor: ${stmt.processor}`,
        kind: LspSymbolKind.Module,
        range: r,
        selectionRange: r,
      });
    } else if (stmt.kind === "set") {
      const r = makeRange(stmt.line);
      symbols.push({
        name: stmt.name,
        detail: `= ${stmt.expr}`,
        kind: LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    } else if (stmt.kind === "dim") {
      const r = makeRange(stmt.line);
      symbols.push({
        name: stmt.name,
        detail: `${stmt.arrayType}(${stmt.imax})`,
        kind: LspSymbolKind.Array,
        range: r,
        selectionRange: r,
      });
    } else if (stmt.kind === "command") {
      if (stmt.command === "ET") {
        const r = makeRange(stmt.line);
        symbols.push({
          name: `ET ${stmt.args[0] ?? "1"}`,
          detail: stmt.args[1] ?? "",
          kind: LspSymbolKind.Struct,
          range: r,
          selectionRange: r,
        });
      } else if (stmt.command === "MP") {
        const r = makeRange(stmt.line);
        symbols.push({
          name: `MP ${stmt.args[0] ?? ""} (MAT ${stmt.args[1] ?? "1"})`,
          detail: stmt.args[2] ?? "",
          kind: LspSymbolKind.Property,
          range: r,
          selectionRange: r,
        });
      } else if (stmt.command === "SECTYPE") {
        const r = makeRange(stmt.line);
        symbols.push({
          name: `SECTYPE ${stmt.args[0] ?? "1"}`,
          detail: `${stmt.args[1] ?? ""} ${stmt.args[2] ?? ""}`.trim(),
          kind: LspSymbolKind.Class,
          range: r,
          selectionRange: r,
        });
      }
    }
  }

  return symbols;
}

/**
 * Provides LSP hover documentation for APDL processors, commands, macros, and standard library element types.
 */
export function getApdlHover(content: string, position: LspPosition): LspHover | null {
  const cstLines = buildApdlCstLineMap(content);
  const entry = cstLines.get(position.line);
  if (!entry) return null;
  const line = " ".repeat(entry.startCol) + entry.text;

  // Extract token around cursor (including leading `/` or `*`)
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_/*]/.test(line[start - 1]!)) start--;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end]!)) end++;

  const token = line.slice(start, end).toUpperCase();
  if (!token) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  // 1. In argument position (start > 0), check user-defined parameters first (e.g., parameter `L` vs command `L`)
  const deck = parseApdl(content);
  if (start > 0) {
    for (const stmt of deck.statements) {
      if (stmt.kind === "set" && stmt.name === token) {
        return {
          contents: {
            kind: "markdown",
            value: `**APDL Parameter** \`${stmt.name}\` = \`${stmt.expr}\` *(defined on line ${stmt.line})*`,
          },
          range,
        };
      }
    }
  }

  // 2. Check command/macro/processor docs
  const cmdDoc = APDL_COMMAND_DOCS[token];
  if (cmdDoc) {
    return {
      contents: {
        kind: "markdown",
        value: `**${token}** — *${cmdDoc.detail}*\n\n${cmdDoc.doc}`,
      },
      range,
    };
  }

  // 3. Check cleanroom stdlib element schema
  const schema = lookupApdlElementSchema(token);
  if (schema) {
    const paramSummary = schema.parameters
      .map((p) => `- \`${p.key}\` = \`${p.defaultValue}\`${p.unit ? ` (${p.unit})` : ""}`)
      .join("\n");
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.name}** — *${schema.label}*\n\n${schema.description}\n\n**Parameters:**\n${paramSummary}`,
      },
      range,
    };
  }

  // 4. Check user-defined parameters at start of line
  for (const stmt of deck.statements) {
    if (stmt.kind === "set" && stmt.name === token) {
      return {
        contents: {
          kind: "markdown",
          value: `**APDL Parameter** \`${stmt.name}\` = \`${stmt.expr}\` *(defined on line ${stmt.line})*`,
        },
        range,
      };
    }
  }

  return null;
}

/**
 * Provides LSP completion items for APDL commands, processors, macros, and element types.
 */
export function getApdlCompletions(prefix: string = ""): LspCompletionItem[] {
  const upper = prefix.trim().toUpperCase();
  const items: LspCompletionItem[] = [];

  for (const [cmd, info] of Object.entries(APDL_COMMAND_DOCS)) {
    if (!upper || cmd.startsWith(upper)) {
      items.push({
        label: cmd,
        kind: cmd.startsWith("/") ? 9 : cmd.startsWith("*") ? 14 : 3,
        detail: info.detail,
        documentation: info.doc,
        insertText: info.snippet ?? cmd,
      });
    }
  }

  const elementNames = ["LINK180", "BEAM188", "PLANE182", "SHELL181", "SOLID185", "MASS21", "COMBIN14"];
  for (const elem of elementNames) {
    if (!upper || elem.startsWith(upper)) {
      const schema = lookupApdlElementSchema(elem);
      items.push({
        label: elem,
        kind: 22,
        detail: schema?.label ?? elem,
        documentation: schema?.description,
        insertText: elem,
      });
    }
  }

  return items;
}
