// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for NASA SINDA / SINDA-FLUINT thermal networks.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lookupSindaModelSchema } from "./catalog/library-package-adapter.js";
import { lintSinda } from "./lints/index.js";
import { parseSindaDeck } from "./parser/deck-parser.js";

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
  detail?: string;
  documentation?: string;
}

const SINDA_KEYWORDS: Array<{ label: string; detail: string; documentation: string }> = [
  {
    label: "HEADER OPTIONS DATA",
    detail: "Section Header",
    documentation: "Model title, units, ABSZRO, and SIGMA options.",
  },
  {
    label: "HEADER NODE DATA",
    detail: "Section Header",
    documentation: "Thermal nodes: +n (diffusion), 0/C=0 (arithmetic), -n (boundary).",
  },
  {
    label: "HEADER CONDUCTOR DATA",
    detail: "Section Header",
    documentation: "Thermal conductors: +g (linear W/K), -g (radiation εAF in m²).",
  },
  {
    label: "HEADER CONSTANTS DATA",
    detail: "Section Header",
    documentation: "Control constants (TIMEO, TIMEND, DTIMEI, DRLXCA, NLOOP).",
  },
  {
    label: "HEADER ARRAY DATA",
    detail: "Section Header",
    documentation: "Tabular lookup arrays for time- or temperature-dependent properties.",
  },
  { label: "HEADER SOURCE DATA", detail: "Section Header", documentation: "Nodal heat loads Q (W)." },
  {
    label: "HEADER EXECUTION",
    detail: "Section Header",
    documentation: "Solver execution calls (STDSTL, FWDBCK, CRANKN, SNFR).",
  },
  { label: "HEADER VARIABLES 1", detail: "Section Header", documentation: "Pre-step nodal/conductor update logic." },
  { label: "HEADER VARIABLES 2", detail: "Section Header", documentation: "Post-step nodal/conductor update logic." },
  { label: "HEADER OUTPUT CALLS", detail: "Section Header", documentation: "Output reporting and printing calls." },
  { label: "END OF DATA", detail: "Deck Terminator", documentation: "Required terminator for a SINDA input deck." },
  {
    label: "STDSTL",
    detail: "Solver Routine",
    documentation: "Steady-state Newton-Raphson thermal equilibrium solver.",
  },
  { label: "FWDBCK", detail: "Solver Routine", documentation: "Forward-Backward implicit transient thermal solver." },
  { label: "CRANKN", detail: "Solver Routine", documentation: "Crank-Nicolson implicit transient thermal solver." },
  {
    label: "SNFR",
    detail: "Solver Routine",
    documentation: "Simultaneous Newton / Fast Relaxation steady-state solver.",
  },
];

interface SindaCstLine {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
  tokens: CstNodeLike[];
}

function buildSindaCstLineMap(content: string, cstTree?: { rootNode?: unknown } | null): Map<number, SindaCstLine> {
  const byRow = new Map<number, SindaCstLine>();
  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("sinda", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }
  if (!rootNode) return byRow;

  for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
    const lineText = cstLineText(content, tokens);
    const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const startCol = first?.startPosition?.column ?? 0;
    const endCol = last?.endPosition?.column ?? startCol + lineText.length;
    byRow.set(row, { row, text: lineText, startCol, endCol, tokens });
  }
  return byRow;
}

function findSindaTokenAtPosition(
  lineEntry: SindaCstLine,
  character: number,
): { word: string; start: number; end: number } | null {
  for (let i = 0; i < lineEntry.tokens.length; i++) {
    const tok = lineEntry.tokens[i] as CstNodeLike & { endPosition?: { column: number } };
    const text = tok.text ?? "";
    const start = tok.startPosition?.column ?? 0;
    const end = tok.endPosition?.column ?? start + text.length;
    if (character >= start && character <= end) {
      if (text === "-" && i + 1 < lineEntry.tokens.length) {
        const next = lineEntry.tokens[i + 1] as CstNodeLike & { endPosition?: { column: number } };
        const nextText = next.text ?? "";
        const nextStart = next.startPosition?.column ?? end;
        const nextEnd = next.endPosition?.column ?? nextStart + nextText.length;
        if (nextStart === end && nextText) {
          return { word: `-${nextText}`, start, end: nextEnd };
        }
      }
      const trimmed = text.trim();
      if (trimmed) {
        return { word: trimmed, start, end };
      }
    }
  }
  return null;
}

/**
 * Validates a SINDA input deck and returns LSP diagnostics.
 */
export function validateSinda(
  content: string,
  _uri: string = "thermal.sin",
  cstTree?: { rootNode?: unknown } | null,
): LspDiagnostic[] {
  const model = parseSindaDeck(content);
  const diags = lintSinda(model);
  const lineMap = buildSindaCstLineMap(content, cstTree);

  return diags.map((d) => {
    const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
    const lineEntry = lineMap.get(lineNum);
    const startChar = d.column ? Math.max(0, d.column - 1) : (lineEntry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, lineEntry?.endCol ?? startChar + 1);

    return {
      range: {
        start: { line: lineNum, character: startChar },
        end: { line: lineNum, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-sinda",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (HEADER blocks, nodes, conductors, constants).
 */
export function getSindaDocumentSymbols(content: string): LspDocumentSymbol[] {
  const model = parseSindaDeck(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const blk of model.rawBlocks) {
    const startLine = Math.max(0, blk.startLine - 1);
    const endLine = Math.max(startLine, blk.endLine - 1);
    const range: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 80 },
    };

    const children: LspDocumentSymbol[] = [];
    if (blk.header.startsWith("NODE")) {
      for (const node of model.nodes.values()) {
        if (node.line && node.line >= blk.startLine && node.line <= blk.endLine) {
          const ln = node.line - 1;
          const r: LspRange = { start: { line: ln, character: 0 }, end: { line: ln, character: 40 } };
          children.push({
            name: `Node ${node.id}`,
            detail: `${node.kind} (T0=${node.initialTemp}, C=${node.capacitance})`,
            kind: LspSymbolKind.Variable,
            range: r,
            selectionRange: r,
          });
        }
      }
    } else if (blk.header.startsWith("CONDUCTOR")) {
      for (const cond of model.conductors.values()) {
        if (cond.line && cond.line >= blk.startLine && cond.line <= blk.endLine) {
          const ln = cond.line - 1;
          const r: LspRange = { start: { line: ln, character: 0 }, end: { line: ln, character: 40 } };
          children.push({
            name: `Conductor ${cond.id}`,
            detail: `${cond.kind} (${cond.nodeI} <-> ${cond.nodeJ}, G=${cond.conductance})`,
            kind: LspSymbolKind.Field,
            range: r,
            selectionRange: r,
          });
        }
      }
    }

    symbols.push({
      name: `HEADER ${blk.header}`,
      detail: blk.submodel,
      kind: LspSymbolKind.Module,
      range,
      selectionRange: range,
      children: children.length > 0 ? children : undefined,
    });
  }

  return symbols;
}

/**
 * Returns hover documentation for SINDA solver routines, spacecraft materials, or node IDs.
 */
export function getSindaHover(
  content: string,
  position: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspHover | null {
  const lineMap = buildSindaCstLineMap(content, cstTree);
  const lineEntry = lineMap.get(position.line);
  if (!lineEntry) return null;

  const hit = findSindaTokenAtPosition(lineEntry, position.character);
  if (!hit) return null;
  const { word, start, end } = hit;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  // 1. Check cleanroom stdlib schemas (solver routines & spacecraft materials)
  const schema = lookupSindaModelSchema(word);
  if (schema) {
    const paramLines = schema.parameters
      .map(
        (p) =>
          `- \`${p.key}\` = \`${p.defaultValue}\`${p.unit ? ` ${p.unit}` : ""}${p.description ? ` — ${p.description}` : ""}`,
      )
      .join("\n");
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}** (\`${schema.namePath}\`)\n\n${schema.description}\n\n${paramLines}\n\n*Source: ${schema.provenance}*`,
      },
      range,
    };
  }

  // 2. Check parsed node ID
  const num = Number.parseInt(word, 10);
  if (!Number.isNaN(num)) {
    const model = parseSindaDeck(content);
    const node = model.nodes.get(Math.abs(num));
    if (node) {
      return {
        contents: {
          kind: "markdown",
          value: `**Thermal Node ${node.id}** (\`${node.kind}\`)\n\n- Initial Temperature: \`${node.initialTemp}\`\n- Capacitance: \`${node.capacitance} J/K\`\n- Submodel: \`${node.submodel}\``,
        },
        range,
      };
    }
  }

  // 3. Check SINDA keywords
  const upper = word.toUpperCase();
  const kw = SINDA_KEYWORDS.find((k) => k.label.includes(upper));
  if (kw) {
    return {
      contents: {
        kind: "markdown",
        value: `**${kw.label}** (${kw.detail})\n\n${kw.documentation}`,
      },
      range,
    };
  }

  return null;
}

/**
 * Returns SINDA completion items for headers, solver routines, and spacecraft materials.
 */
export function getSindaCompletions(prefix: string = ""): LspCompletionItem[] {
  const upper = prefix.trim().toUpperCase();
  return SINDA_KEYWORDS.filter((k) => !upper || k.label.toUpperCase().includes(upper));
}
