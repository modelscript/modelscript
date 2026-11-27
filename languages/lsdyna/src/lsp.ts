// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lookupLsDynaSchema } from "./catalog/library-package-adapter.js";
import { lintLsDynaDeck } from "./lints/index.js";
import { parseLsDynaDeck } from "./parser/deck-parser.js";

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
  detail: string;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const LSDYNA_KEYWORD_DOCS: Record<string, { detail: string; doc: string; snippet: string }> = {
  "*KEYWORD": {
    detail: "LS-DYNA keyword deck header",
    doc: "Declares the start of an LS-DYNA / DYNA3D keyword input deck.",
    snippet: "*KEYWORD\n",
  },
  "*TITLE": {
    detail: "Model title card",
    doc: "Specifies an 80-character title describing the explicit dynamics simulation.",
    snippet: "*TITLE\nMy Explicit Dynamics Model\n",
  },
  "*NODE": {
    detail: "Nodal coordinates (NID, X, Y, Z, TC, RC)",
    doc: "Defines nodal point coordinates and optional single-point translational/rotational constraints.",
    snippet:
      "*NODE\n$#   nid               x               y               z      tc      rc\n1, 0.0, 0.0, 0.0, 0, 0\n",
  },
  "*ELEMENT_SOLID": {
    detail: "3D solid elements (EID, PID, N1..N8)",
    doc: "Defines 8-node hexahedral or 4-node tetrahedral continuum solid elements.",
    snippet: "*ELEMENT_SOLID\n1, 1, 1, 2, 3, 4, 5, 6, 7, 8\n",
  },
  "*ELEMENT_SHELL": {
    detail: "Shell elements (EID, PID, N1..N4)",
    doc: "Defines 3-node triangular or 4-node quadrilateral shell elements.",
    snippet: "*ELEMENT_SHELL\n1, 1, 1, 2, 3, 4\n",
  },
  "*ELEMENT_BEAM": {
    detail: "Beam/truss elements (EID, PID, N1, N2, N3)",
    doc: "Defines 2-node 1D bar/truss or beam elements with optional orientation node N3.",
    snippet: "*ELEMENT_BEAM\n1, 1, 1, 2, 0\n",
  },
  "*PART": {
    detail: "Part definition (TITLE; PID, SECID, MID)",
    doc: "Associates a part ID with a section formulation (`SECID`) and constitutive material (`MID`).",
    snippet: "*PART\nPart_1\n1, 1, 1, 0, 0, 0, 0, 0\n",
  },
  "*SECTION_SOLID": {
    detail: "Solid element formulation (SECID, ELFORM)",
    doc: "Defines solid element formulation (`ELFORM=1` constant stress solid, `ELFORM=2` fully integrated).",
    snippet: "*SECTION_SOLID\n1, 1\n",
  },
  "*SECTION_SHELL": {
    detail: "Shell element formulation & thickness",
    doc: "Defines shell formulation (`ELFORM=2` Belytschko-Tsay), shear factor, integration points, and thickness.",
    snippet: "*SECTION_SHELL\n1, 2, 0.8333, 2\n0.005, 0.005, 0.005, 0.005\n",
  },
  "*SECTION_BEAM": {
    detail: "Beam/truss formulation & cross-section",
    doc: "Defines beam/truss formulation (`ELFORM=3` truss, `ELFORM=1` Hughes-Liu) and cross-sectional area.",
    snippet: "*SECTION_BEAM\n1, 3, 1.0\n0.001, 0.0, 0.0, 0.0\n",
  },
  "*MAT_ELASTIC": {
    detail: "MAT_001 isotropic linear elastic material",
    doc: "Defines isotropic linear elastic constitutive model (`MID, RO, E, PR`).",
    snippet: "*MAT_ELASTIC\n1, 7850.0, 2.1e11, 0.3\n",
  },
  "*MAT_PLASTIC_KINEMATIC": {
    detail: "MAT_003 isotropic/kinematic hardening plasticity",
    doc: "Defines elasto-plastic material with yield stress `SIGY`, tangent modulus `ETAN`, and hardening parameter `BETA`.",
    snippet: "*MAT_PLASTIC_KINEMATIC\n1, 7850.0, 2.1e11, 0.3, 2.5e8, 2.1e9, 1.0\n",
  },
  "*MAT_RIGID": {
    detail: "MAT_020 rigid body material",
    doc: "Defines rigid body inertial properties and optional center-of-mass constraints.",
    snippet: "*MAT_RIGID\n1, 7850.0, 2.1e11, 0.3\n0.0, 0, 0\n",
  },
  "*BOUNDARY_SPC_NODE": {
    detail: "Single-point constraint on a node",
    doc: "Fixes translational (`DOFX, DOFY, DOFZ`) and rotational (`DOFRX, DOFRY, DOFRZ`) degrees of freedom on a node.",
    snippet: "*BOUNDARY_SPC_NODE\n1, 0, 1, 1, 1, 1, 1, 1\n",
  },
  "*BOUNDARY_SPC_SET": {
    detail: "Single-point constraint on a node set",
    doc: "Fixes degrees of freedom for all nodes in a `*SET_NODE_LIST`.",
    snippet: "*BOUNDARY_SPC_SET\n1, 0, 1, 1, 1, 1, 1, 1\n",
  },
  "*INITIAL_VELOCITY": {
    detail: "Initial nodal velocity condition",
    doc: "Assigns initial translational/rotational velocities to a node set (`NSID=0` applies to all nodes).",
    snippet: "*INITIAL_VELOCITY\n0, 0, 0\n10.0, 0.0, 0.0, 0.0, 0.0, 0.0\n",
  },
  "*LOAD_NODE_POINT": {
    detail: "Concentrated nodal force/moment",
    doc: "Applies a time-dependent nodal force or moment scaled by `*DEFINE_CURVE` (`NID, DOF, LCID, SF`).",
    snippet: "*LOAD_NODE_POINT\n2, 1, 1, 1000.0\n",
  },
  "*DEFINE_CURVE": {
    detail: "Piecewise-linear load/amplitude curve",
    doc: "Defines an `(abscissa, ordinate)` curve table referenced by `LCID`.",
    snippet: "*DEFINE_CURVE\n1, 0, 1.0, 1.0, 0.0, 0.0\n0.0, 1.0\n1.0, 1.0\n",
  },
  "*SET_NODE_LIST": {
    detail: "Named set of node IDs",
    doc: "Groups node IDs under a set identifier `SID` for boundary conditions or initial velocities.",
    snippet: "*SET_NODE_LIST\n1\n1, 2, 3\n",
  },
  "*CONTROL_TERMINATION": {
    detail: "Explicit simulation termination criteria",
    doc: "Specifies termination time (`ENDTIM`), cycle limit (`ENDCYC`), and minimum timestep (`DTMIN`).",
    snippet: "*CONTROL_TERMINATION\n0.01, 0, 0.0, 0.0, 0.0\n",
  },
  "*CONTROL_TIMESTEP": {
    detail: "Explicit CFL timestep control",
    doc: "Controls initial timestep (`DTINIT`) and CFL scale factor (`TSSFAC`, default 0.9).",
    snippet: "*CONTROL_TIMESTEP\n0.0, 0.9, 0, 0.0, 0.0\n",
  },
  "*DATABASE_GLSTAT": {
    detail: "Global statistics energy output interval",
    doc: "Requests global kinetic, internal, and total energy history output at interval `DT`.",
    snippet: "*DATABASE_GLSTAT\n1.0e-4\n",
  },
  "*END": {
    detail: "End of LS-DYNA keyword deck",
    doc: "Marks the logical end of the keyword input file.",
    snippet: "*END\n",
  },
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface LsDynaCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildLsDynaCstIndex(content: string): LsDynaCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("lsdyna", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  let lastRow = 0;
  let lastEndCol = 0;
  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      byRow.set(row, { row, text: lineText, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }
  return { byRow, lastRow, lastEndCol };
}

function makeLineRange(cstIndex: LsDynaCstIndex, lineZeroBased: number): LspRange {
  const safeLine = Math.max(0, lineZeroBased);
  const entry = cstIndex.byRow.get(safeLine);
  const startChar = entry?.startCol ?? 0;
  const endChar = Math.max(startChar + 1, entry?.endCol ?? 1);
  return {
    start: { line: safeLine, character: startChar },
    end: { line: safeLine, character: endChar },
  };
}

/**
 * Validates an LS-DYNA `.k` keyword deck and returns LSP diagnostics.
 */
export function validateLsDyna(content: string, _uri = "model.k"): LspDiagnostic[] {
  const deck = parseLsDynaDeck(content);
  const diags = lintLsDynaDeck(deck);
  const cstIndex = buildLsDynaCstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    return {
      range: makeLineRange(cstIndex, lineIdx),
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-lsdyna",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols for an LS-DYNA keyword deck.
 */
export function getLsDynaDocumentSymbols(content: string): LspDocumentSymbol[] {
  const deck = parseLsDynaDeck(content);
  const cstIndex = buildLsDynaCstIndex(content);
  const fullRange: LspRange = {
    start: { line: 0, character: cstIndex.byRow.get(0)?.startCol ?? 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };

  const children: LspDocumentSymbol[] = [];

  for (const part of deck.parts.values()) {
    const ln = Math.max(0, (part.loc?.line ?? 1) - 1);
    const r = makeLineRange(cstIndex, ln);
    children.push({
      name: `PART ${part.pid}${part.title ? ` (${part.title})` : ""}`,
      detail: `SECID=${part.secid}, MID=${part.mid}`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  for (const mat of deck.materials.values()) {
    const ln = Math.max(0, (mat.loc?.line ?? 1) - 1);
    const r = makeLineRange(cstIndex, ln);
    children.push({
      name: `${mat.type} ${mat.mid}`,
      detail: `RO=${mat.ro}, E=${mat.e}, PR=${mat.pr}`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const sec of deck.sections.values()) {
    const ln = Math.max(0, (sec.loc?.line ?? 1) - 1);
    const r = makeLineRange(cstIndex, ln);
    children.push({
      name: `SECTION_${sec.kind} ${sec.secid}`,
      detail: `ELFORM=${sec.elform}`,
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
    });
  }

  if (deck.controlTermination) {
    const ln = Math.max(0, (deck.controlTermination.loc?.line ?? 1) - 1);
    const r = makeLineRange(cstIndex, ln);
    children.push({
      name: "CONTROL_TERMINATION",
      detail: `ENDTIM=${deck.controlTermination.endtim}`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  return [
    {
      name: deck.title || "LS-DYNA Deck",
      detail: `${deck.nodes.size} nodes, ${deck.elements.size} elements, ${deck.parts.size} parts`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: makeLineRange(cstIndex, 0),
      children,
    },
  ];
}

/**
 * Provides Markdown hover documentation for LS-DYNA keywords at a given cursor position.
 */
export function getLsDynaHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildLsDynaCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const trimmed = entry.text.trim();
  if (!trimmed.startsWith("*")) return null;

  const token = trimmed.split(/[\s,]/)[0]?.toUpperCase() ?? "";
  const doc = LSDYNA_KEYWORD_DOCS[token];
  const schema = lookupLsDynaSchema(token);

  if (!doc && !schema) return null;

  const mdLines: string[] = [];
  mdLines.push(`### \`${token}\``);
  if (doc) {
    mdLines.push(doc.doc);
  }
  if (schema) {
    mdLines.push(`\n**Standard Library:** \`${schema.name}\` — ${schema.description}`);
    if (schema.parameters.length > 0) {
      mdLines.push(`\n**Parameters:** ${schema.parameters.map((p) => `\`${p.key}\` (${p.unit ?? "-"})`).join(", ")}`);
    }
  }

  return {
    contents: {
      kind: "markdown",
      value: mdLines.join("\n"),
    },
    range: makeLineRange(cstIndex, position.line),
  };
}

/**
 * Returns LS-DYNA keyword completion items filtered by optional prefix.
 */
export function getLsDynaCompletions(prefix = ""): LspCompletionItem[] {
  const norm = prefix.trim().toUpperCase();
  const out: LspCompletionItem[] = [];
  for (const [kw, info] of Object.entries(LSDYNA_KEYWORD_DOCS)) {
    if (!norm || kw.startsWith(norm) || kw.slice(1).startsWith(norm)) {
      out.push({
        label: kw,
        detail: info.detail,
        documentation: info.doc,
        insertText: info.snippet,
      });
    }
  }
  return out;
}
