// SPDX-License-Identifier: AGPL-3.0-or-later

import { getVhdlSchemasFromLibraries, lookupVhdlModelSchema } from "./catalog/library-package-adapter.js";
import { lintVhdl } from "./lints/index.js";
import { parseVhdl } from "./parser/vhdl-parser.js";

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
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
}

const VHDL_KEYWORDS: Record<string, string> = {
  entity: "Declares the external interface (generics and ports) of a VHDL hardware design unit.",
  architecture: "Defines the structural or behavioral implementation of an entity.",
  process: "Sequential execution block triggered by signals in its sensitivity list.",
  signal: "Concurrent hardware wire or register updated at delta-cycle boundaries via `<=`.",
  variable: "Process-local storage updated immediately via `:=`.",
  constant: "Compile-time immutable value declaration.",
  component: "Declares an entity interface for structural instantiation via `port map`.",
  port: "Defines input/output/inout/buffer interface signals of an entity or component.",
  generic: "Defines compile-time parameterization of an entity or component.",
  library: "Declares a logical design library (e.g. `library ieee;`).",
  use: "Imports declarations from a package (e.g. `use ieee.std_logic_1164.all;`).",
  package: "Groups reusable type, constant, component, and subprogram declarations.",
  downto: "Descending discrete index range direction (MSB downto LSB).",
  to: "Ascending discrete index range direction (LSB to MSB).",
};

function spanToRange(span: { line: number; column: number; endLine: number; endColumn: number }): LspRange {
  return {
    start: { line: Math.max(0, span.line - 1), character: Math.max(0, span.column - 1) },
    end: { line: Math.max(0, span.endLine - 1), character: Math.max(0, span.endColumn - 1) },
  };
}

function getWordAt(content: string, pos: LspPosition): { word: string; range: LspRange } | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[pos.line];
  if (lineText === undefined) return null;

  let start = Math.min(pos.character, lineText.length);
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1] ?? "")) start--;
  let end = Math.min(pos.character, lineText.length);
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end] ?? "")) end++;
  const word = lineText.slice(start, end);
  if (!word) return null;
  return {
    word,
    range: {
      start: { line: pos.line, character: start },
      end: { line: pos.line, character: end },
    },
  };
}

/**
 * Validates VHDL source text and returns LSP diagnostics (`VHDL1001`–`VHDL5006`).
 */
export function validateVhdl(content: string, _uri = "design.vhd"): LspDiagnostic[] {
  const diags = lintVhdl(content);
  return diags.map((d) => ({
    range: {
      start: { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) },
      end: {
        line: Math.max(0, (d.endLine ?? d.line) - 1),
        character: Math.max(Math.max(0, d.column - 1) + 1, (d.endColumn ?? d.column + 1) - 1),
      },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.id,
    source: "modelscript-vhdl",
    message: d.message,
  }));
}

/**
 * Extracts hierarchical LSP document symbols (packages, entities, ports, architectures, signals, processes).
 */
export function getVhdlDocumentSymbols(content: string): LspDocumentSymbol[] {
  const design = parseVhdl(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const pkg of design.packages) {
    const r = spanToRange(pkg.span);
    symbols.push({
      name: pkg.name,
      detail: "package",
      kind: LspSymbolKind.Package,
      range: r,
      selectionRange: r,
      children: [
        ...pkg.types.map((t) => ({
          name: t.name,
          detail: `type (${t.kind})`,
          kind: LspSymbolKind.Enum,
          range: spanToRange(t.span),
          selectionRange: spanToRange(t.span),
        })),
        ...pkg.constants.map((c) => ({
          name: c.name,
          detail: `constant ${c.type.name}`,
          kind: LspSymbolKind.Constant,
          range: spanToRange(c.span),
          selectionRange: spanToRange(c.span),
        })),
      ],
    });
  }

  for (const ent of design.entities) {
    const r = spanToRange(ent.span);
    symbols.push({
      name: ent.name,
      detail: "entity",
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
      children: [
        ...ent.generics.map((g) => ({
          name: g.name,
          detail: `generic : ${g.type.name}`,
          kind: LspSymbolKind.Constant,
          range: spanToRange(g.span),
          selectionRange: spanToRange(g.span),
        })),
        ...ent.ports.map((p) => ({
          name: p.name,
          detail: `port ${p.direction} ${p.type.name}`,
          kind: LspSymbolKind.Field,
          range: spanToRange(p.span),
          selectionRange: spanToRange(p.span),
        })),
      ],
    });
  }

  for (const arch of design.architectures) {
    const r = spanToRange(arch.span);
    const children: LspDocumentSymbol[] = [
      ...arch.signals.map((s) => ({
        name: s.name,
        detail: `signal : ${s.type.name}`,
        kind: LspSymbolKind.Variable,
        range: spanToRange(s.span),
        selectionRange: spanToRange(s.span),
      })),
      ...arch.statements
        .filter((st) => st.kind === "process")
        .map((st, idx) => ({
          name: st.label ?? `process_${idx}`,
          detail: `process(${st.sensitivity.join(", ")})`,
          kind: LspSymbolKind.Method,
          range: spanToRange(st.span),
          selectionRange: spanToRange(st.span),
        })),
    ];

    symbols.push({
      name: `${arch.name} of ${arch.entityName}`,
      detail: "architecture",
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children,
    });
  }

  return symbols;
}

/**
 * Provides hover documentation for VHDL keywords, IEEE stdlib symbols, and local declarations.
 */
export function getVhdlHover(content: string, position: LspPosition): LspHover | null {
  const hit = getWordAt(content, position);
  if (!hit) return null;
  const lower = hit.word.toLowerCase();

  // 1. Check local design declarations
  const design = parseVhdl(content);
  for (const ent of design.entities) {
    if (ent.name.toLowerCase() === lower) {
      return {
        contents: {
          kind: "markdown",
          value: `**entity** \`${ent.name}\` (${ent.ports.length} ports, ${ent.generics.length} generics)`,
        },
        range: hit.range,
      };
    }
    for (const p of ent.ports) {
      if (p.name.toLowerCase() === lower) {
        const w = p.type.width ? ` (${p.type.width}-bit)` : "";
        return {
          contents: {
            kind: "markdown",
            value: `**port** \`${p.name}\` : \`${p.direction} ${p.type.name}\`${w}`,
          },
          range: hit.range,
        };
      }
    }
  }
  for (const arch of design.architectures) {
    for (const s of arch.signals) {
      if (s.name.toLowerCase() === lower) {
        const w = s.type.width ? ` (${s.type.width}-bit)` : "";
        return {
          contents: {
            kind: "markdown",
            value: `**signal** \`${s.name}\` : \`${s.type.name}\`${w}`,
          },
          range: hit.range,
        };
      }
    }
  }

  // 2. Check IEEE cleanroom standard library
  const schema = lookupVhdlModelSchema(hit.word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.namePath}** (${schema.category})\n\n${schema.description}\n\n*${schema.provenance}*`,
      },
      range: hit.range,
    };
  }

  // 3. Check VHDL keywords
  const kwDoc = VHDL_KEYWORDS[lower];
  if (kwDoc) {
    return {
      contents: {
        kind: "markdown",
        value: `**VHDL keyword** \`${lower}\`\n\n${kwDoc}`,
      },
      range: hit.range,
    };
  }

  return null;
}

/**
 * Returns context-aware LSP completion items for VHDL keywords, IEEE stdlib, and local signals/ports.
 */
export function getVhdlCompletions(content: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: LspCompletionItem): void => {
    const k = item.label.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    items.push(item);
  };

  // Local signals and ports
  const design = parseVhdl(content);
  for (const ent of design.entities) {
    for (const p of ent.ports) {
      pushUnique({ label: p.name, kind: 5, detail: `port ${p.direction} ${p.type.name}` });
    }
  }
  for (const arch of design.architectures) {
    for (const s of arch.signals) {
      pushUnique({ label: s.name, kind: 6, detail: `signal ${s.type.name}` });
    }
  }

  // IEEE stdlib schemas
  for (const schema of getVhdlSchemasFromLibraries()) {
    pushUnique({
      label: schema.name.toLowerCase(),
      kind: 7,
      detail: schema.namePath,
      documentation: schema.description,
    });
  }

  // Keywords
  for (const [kw, doc] of Object.entries(VHDL_KEYWORDS)) {
    pushUnique({ label: kw, kind: 14, detail: "VHDL keyword", documentation: doc });
  }

  return items;
}
