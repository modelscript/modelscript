// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) handlers for `@modelscript/iucr-cif`:
 * - `validateIucrCif`
 * - `getIucrCifDocumentSymbols`
 * - `getIucrCifHover`
 * - `getIucrCifCompletions`
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintIucrCif } from "./lints/index.js";
import { extractCrystalStructure, parseIucrCif } from "./parser/cif-parser.js";
import { solveCrystalStructure } from "./solver/index.js";

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
  Array = 18,
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

const CIF_TAG_DOCS: Record<string, { detail: string; doc: string; snippet?: string }> = {
  _cell_length_a: {
    detail: "Unit-cell length a (Å)",
    doc: "Unit-cell length `a` in Ångströms. Must be strictly positive; supports standard uncertainty e.g. `5.4310(2)`.",
    snippet: "_cell_length_a 5.4310(2)",
  },
  _cell_length_b: {
    detail: "Unit-cell length b (Å)",
    doc: "Unit-cell length `b` in Ångströms. Must be strictly positive.",
    snippet: "_cell_length_b 5.4310(2)",
  },
  _cell_length_c: {
    detail: "Unit-cell length c (Å)",
    doc: "Unit-cell length `c` in Ångströms. Must be strictly positive.",
    snippet: "_cell_length_c 5.4310(2)",
  },
  _cell_angle_alpha: {
    detail: "Unit-cell angle α (deg)",
    doc: "Interaxial angle α between lattice vectors **b** and **c** in degrees, strictly in `(0, 180)`.",
    snippet: "_cell_angle_alpha 90.0",
  },
  _cell_angle_beta: {
    detail: "Unit-cell angle β (deg)",
    doc: "Interaxial angle β between lattice vectors **a** and **c** in degrees, strictly in `(0, 180)`.",
    snippet: "_cell_angle_beta 90.0",
  },
  _cell_angle_gamma: {
    detail: "Unit-cell angle γ (deg)",
    doc: "Interaxial angle γ between lattice vectors **a** and **b** in degrees, strictly in `(0, 180)`.",
    snippet: "_cell_angle_gamma 90.0",
  },
  _cell_volume: {
    detail: "Unit-cell volume V (Å³)",
    doc: "Unit-cell volume $V = \\sqrt{\\det G}$ in cubic Ångströms.",
  },
  _cell_formula_units_z: {
    detail: "Formula units per unit cell (Z)",
    doc: "Number of chemical formula units per unit cell.",
    snippet: "_cell_formula_units_Z 4",
  },
  "_symmetry_space_group_name_h-m": {
    detail: "Hermann-Mauguin space group symbol",
    doc: "Hermann-Mauguin space group symbol, e.g. `'F d -3 m'`, `'F m -3 m'`, `'P 31 2 1'`.",
    snippet: "_symmetry_space_group_name_H-M 'F d -3 m'",
  },
  _symmetry_int_tables_number: {
    detail: "International Tables space group number (1–230)",
    doc: "Space group number in International Tables for Crystallography Vol. A (1–230).",
    snippet: "_symmetry_Int_Tables_number 227",
  },
  _symmetry_equiv_pos_as_xyz: {
    detail: "Symmetry equivalent position (x, y, z)",
    doc: "Affine symmetry operation generating Wyckoff equivalent positions, e.g. `'x+1/2, y+1/2, z'`.",
  },
  _atom_site_label: {
    detail: "Unique atom site label",
    doc: "Unique identifier for an atom site in the asymmetric unit (e.g. `Si1`, `O2`).",
  },
  _atom_site_type_symbol: {
    detail: "Chemical element / ion symbol",
    doc: "Element or oxidation-state symbol (e.g. `Si`, `O`, `Fe3+`).",
  },
  _atom_site_fract_x: {
    detail: "Fractional coordinate x",
    doc: "Atom-site fractional coordinate along lattice vector **a**.",
  },
  _atom_site_fract_y: {
    detail: "Fractional coordinate y",
    doc: "Atom-site fractional coordinate along lattice vector **b**.",
  },
  _atom_site_fract_z: {
    detail: "Fractional coordinate z",
    doc: "Atom-site fractional coordinate along lattice vector **c**.",
  },
  _atom_site_occupancy: {
    detail: "Fractional site occupancy (0, 1]",
    doc: "Fraction of the atom type present at this crystallographic site (must lie in `(0, 1]`).",
  },
  _atom_site_b_iso_or_equiv: {
    detail: "Isotropic displacement parameter B_iso (Å²)",
    doc: "Isotropic Debye-Waller thermal displacement parameter $B_{\\text{iso}} = 8\\pi^2 U_{\\text{iso}}$ in Å².",
  },
  _diffrn_radiation_wavelength: {
    detail: "X-ray radiation wavelength λ (Å)",
    doc: "Incident X-ray wavelength in Ångströms (default Cu-Kα1 = `1.5406` Å).",
    snippet: "_diffrn_radiation_wavelength 1.5406",
  },
  _chemical_formula_sum: {
    detail: "Chemical formula sum",
    doc: "Hill-notation chemical formula sum of the crystal (e.g. `'O2 Si'`).",
  },
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
  endIndex: number;
}

interface IucrCifCstIndex {
  byRow: Map<number, CstLineEntry>;
  entries: CstLineEntry[];
  lastRow: number;
  lastEndCol: number;
}

function buildIucrCifCstIndex(content: string): IucrCifCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  const entries: CstLineEntry[] = [];
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("iucr-cif", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
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
      const endIndex = last?.endIndex ?? 0;
      const entry: CstLineEntry = { row, text: lineText, startCol, endCol, endIndex };
      byRow.set(row, entry);
      entries.push(entry);
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    let offset = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (trimmed) {
        const startCol = Math.max(0, raw.search(/\S/));
        const endCol = startCol + trimmed.length;
        const entry: CstLineEntry = { row: i, text: trimmed, startCol, endCol, endIndex: offset + endCol };
        byRow.set(i, entry);
        entries.push(entry);
        lastRow = i;
        lastEndCol = endCol;
      }
      offset += raw.length + 1;
    }
  }
  return { byRow, entries, lastRow, lastEndCol };
}

/**
 * Validates an IUCr CIF / STAR 1.1 document and returns LSP diagnostics.
 */
export function validateIucrCif(content: string, _uri = "crystal.cif"): LspDiagnostic[] {
  const diags = lintIucrCif(content);
  const cstIndex = buildIucrCifCstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = d.column > 1 ? d.column - 1 : (entry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);
    const severity: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity,
      code: d.code,
      source: "iucr-cif",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols (data blocks, scalar tags, and loop tables).
 */
export function getIucrCifDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseIucrCif(content);
  const cstIndex = buildIucrCifCstIndex(content);
  const result: LspDocumentSymbol[] = [];

  for (const block of doc.blocks) {
    const startLine = Math.max(0, block.line - 1);
    let endLine = startLine;
    for (const e of cstIndex.entries) {
      if (e.row >= startLine && (e.endIndex <= block.endOffset || e.endIndex === 0)) {
        endLine = e.row;
      }
    }
    const startEntry = cstIndex.byRow.get(startLine);
    const endEntry = cstIndex.byRow.get(endLine);
    const range: LspRange = {
      start: { line: startLine, character: startEntry?.startCol ?? 0 },
      end: { line: endLine, character: endEntry?.endCol ?? 0 },
    };
    const selRange: LspRange = {
      start: { line: startLine, character: startEntry?.startCol ?? 0 },
      end: { line: startLine, character: startEntry?.endCol ?? 0 },
    };

    const children: LspDocumentSymbol[] = [];
    for (const entry of block.tagEntries) {
      const l = Math.max(0, entry.line - 1);
      const lineEntry = cstIndex.byRow.get(l);
      const r: LspRange = {
        start: { line: l, character: Math.max(0, entry.column - 1) },
        end: { line: l, character: lineEntry?.endCol ?? Math.max(0, entry.column - 1) + entry.tag.length },
      };
      children.push({
        name: entry.tag,
        detail: entry.value.raw,
        kind: LspSymbolKind.Property,
        range: r,
        selectionRange: r,
      });
    }

    for (let idx = 0; idx < block.loops.length; idx++) {
      const loop = block.loops[idx]!;
      const l = Math.max(0, loop.line - 1);
      const lineEntry = cstIndex.byRow.get(l);
      const r: LspRange = {
        start: { line: l, character: Math.max(0, loop.column - 1) },
        end: { line: l, character: lineEntry?.endCol ?? Math.max(0, loop.column - 1) + 5 },
      };
      children.push({
        name: `loop_ (${loop.tags[0] ?? `table_${idx + 1}`})`,
        detail: `${loop.tags.length} cols × ${loop.rows.length} rows`,
        kind: LspSymbolKind.Array,
        range: r,
        selectionRange: r,
      });
    }

    result.push({
      name: `data_${block.name}`,
      detail: `${block.tagEntries.length} tags, ${block.loops.length} loops`,
      kind: LspSymbolKind.Package,
      range,
      selectionRange: selRange,
      children,
    });
  }

  return result;
}

/**
 * Returns Markdown hover information for a CIF tag or `data_` block at the given LSP position.
 */
export function getIucrCifHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildIucrCifCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const lineText = entry.text;
  const relChar = position.character - entry.startCol;
  if (relChar < 0 || relChar > lineText.length) return null;

  // Find token surrounding position.character
  let start = relChar;
  let end = relChar;
  while (start > 0 && !/\s/.test(lineText[start - 1]!)) start--;
  while (end < lineText.length && !/\s/.test(lineText[end]!)) end++;
  const token = lineText.slice(start, end).trim();
  if (!token) return null;

  const hoverRange: LspRange = {
    start: { line: position.line, character: entry.startCol + start },
    end: { line: position.line, character: entry.startCol + end },
  };

  if (token.toLowerCase().startsWith("data_")) {
    const blockName = token.slice(5);
    const doc = parseIucrCif(content);
    const block = doc.blocks.find((b) => b.name.toLowerCase() === blockName.toLowerCase());
    if (block) {
      const structure = extractCrystalStructure(block);
      if (structure) {
        try {
          const sol = solveCrystalStructure(structure);
          return {
            range: hoverRange,
            contents: {
              kind: "markdown",
              value:
                `### \`data_${block.name}\`\n` +
                `- **Crystal System**: ${sol.metric.crystalSystem}\n` +
                `- **Space Group**: ${structure.spaceGroupName ?? "P 1"}\n` +
                `- **Unit Cell Volume**: ${sol.metric.volume.toFixed(3)} Å³\n` +
                `- **Density**: ${sol.densityGCm3.toFixed(3)} g/cm³\n` +
                `- **Expanded Atoms**: ${sol.expandedAtoms.length}`,
            },
          };
        } catch {
          // Fall through to basic block hover
        }
      }
      return {
        range: hoverRange,
        contents: {
          kind: "markdown",
          value: `### \`data_${block.name}\`\nCIF data block with ${block.tagEntries.length} tags and ${block.loops.length} loops.`,
        },
      };
    }
  }

  const tagInfo = CIF_TAG_DOCS[token.toLowerCase()];
  if (tagInfo) {
    return {
      range: hoverRange,
      contents: {
        kind: "markdown",
        value: `**\`${token}\`** — ${tagInfo.detail}\n\n${tagInfo.doc}`,
      },
    };
  }

  return null;
}

/**
 * Returns CIF 1.1 dictionary tag & keyword completions at the given LSP position.
 */
export function getIucrCifCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const cstIndex = buildIucrCifCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  const prefixSlice = entry ? entry.text.slice(0, Math.max(0, position.character - entry.startCol)) : "";
  const wordMatch = /([^\s]*)$/.exec(prefixSlice);
  const prefix = (wordMatch?.[1] ?? "").toLowerCase();

  const items: LspCompletionItem[] = [
    {
      label: "data_",
      kind: 14,
      detail: "CIF data block header",
      documentation: "Starts a named STAR/CIF data block.",
      insertText: "data_crystal",
    },
    {
      label: "loop_",
      kind: 14,
      detail: "CIF tabular loop header",
      documentation: "Starts a tabular list of data names followed by row values.",
      insertText: "loop_\n",
    },
  ];

  for (const [tag, info] of Object.entries(CIF_TAG_DOCS)) {
    items.push({
      label: tag,
      kind: 10,
      detail: info.detail,
      documentation: info.doc,
      insertText: info.snippet ?? tag,
    });
  }

  if (!prefix) return items;
  return items.filter((item) => item.label.toLowerCase().startsWith(prefix));
}
