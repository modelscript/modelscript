// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for ISO/ITU-T X.208 / X.680 ASN.1:
 * diagnostics (`validateAsn1`), document symbols (`getAsn1DocumentSymbols`),
 * hover documentation (`getAsn1Hover`), and keyword/catalog completions (`getAsn1Completions`).
 */

import { getAsn1SchemasFromLibraries, lookupAsn1ModelSchema } from "./catalog/library-package-adapter.js";
import { lintAsn1 } from "./lints/index.js";
import { parseAsn1 } from "./parser/asn1-parser.js";
import { computeWireSizeBounds } from "./solver/wire-analyzer.js";

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
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
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
  detail?: string;
  documentation?: string;
}

const ASN1_KEYWORDS: Array<{ keyword: string; detail: string }> = [
  { keyword: "DEFINITIONS", detail: "ASN.1 module header keyword" },
  { keyword: "AUTOMATIC TAGS", detail: "Automatic context tagging mode (X.680)" },
  { keyword: "EXPLICIT TAGS", detail: "Explicit tagging mode (default in X.208/X.680)" },
  { keyword: "IMPLICIT TAGS", detail: "Implicit tagging mode for compact BER/DER" },
  { keyword: "BEGIN", detail: "Begin ASN.1 module body" },
  { keyword: "END", detail: "End ASN.1 module body" },
  { keyword: "IMPORTS", detail: "Import type/value symbols from external ASN.1 modules" },
  { keyword: "EXPORTS", detail: "Export type/value symbols from current module" },
  { keyword: "SEQUENCE", detail: "Ordered composite record (universal tag 0x30)" },
  { keyword: "SEQUENCE OF", detail: "Ordered homogeneous list (universal tag 0x30)" },
  { keyword: "SET", detail: "Unordered composite record (universal tag 0x31)" },
  { keyword: "SET OF", detail: "Unordered homogeneous collection (universal tag 0x31)" },
  { keyword: "CHOICE", detail: "Tagged discriminated union type" },
  { keyword: "ENUMERATED", detail: "Named integer enumeration (universal tag 0x0A)" },
  { keyword: "INTEGER", detail: "Signed arbitrary-precision integer (universal tag 0x02)" },
  { keyword: "BOOLEAN", detail: "Boolean truth value (universal tag 0x01)" },
  { keyword: "REAL", detail: "Floating-point real number (universal tag 0x09)" },
  { keyword: "NULL", detail: "Empty placeholder value (universal tag 0x05)" },
  { keyword: "OCTET STRING", detail: "Raw byte sequence (universal tag 0x04)" },
  { keyword: "BIT STRING", detail: "Bit sequence with unused-bits count (universal tag 0x03)" },
  { keyword: "OBJECT IDENTIFIER", detail: "Hierarchical ISO/ITU-T OID (universal tag 0x06)" },
  { keyword: "UTF8String", detail: "UTF-8 character string (universal tag 0x0C)" },
  { keyword: "IA5String", detail: "7-bit ASCII IA5 string (universal tag 0x16)" },
  { keyword: "PrintableString", detail: "Restricted ASCII printable string (universal tag 0x13)" },
  { keyword: "OPTIONAL", detail: "Marks a SEQUENCE/SET component as optional" },
  { keyword: "DEFAULT", detail: "Specifies a default value for an optional component" },
  { keyword: "SIZE", detail: "Length/cardinality constraint on strings or SEQUENCE OF" },
];

function spanToRange(line: number, column: number, length = 1): LspRange {
  const l = Math.max(0, line - 1);
  const c = Math.max(0, column - 1);
  return {
    start: { line: l, character: c },
    end: { line: l, character: c + Math.max(1, length) },
  };
}

/**
 * Validates an ASN.1 source string and returns LSP-compatible diagnostics (`ASN11001`–`ASN15006`).
 */
export function validateAsn1(source: string): LspDiagnostic[] {
  const diags = lintAsn1(source);
  return diags.map((d) => ({
    range: spanToRange(d.line, d.column, 4),
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "asn1",
    message: d.message,
  }));
}

/**
 * Extracts hierarchical LSP document symbols for an ASN.1 module.
 */
export function getAsn1DocumentSymbols(source: string): LspDocumentSymbol[] {
  const mod = parseAsn1(source);
  const children: LspDocumentSymbol[] = [];

  for (const t of mod.types) {
    const tRange = spanToRange(t.span.startLine, t.span.startColumn, t.name.length);
    const subChildren: LspDocumentSymbol[] = [];
    if (t.type.kind === "sequence" || t.type.kind === "set") {
      for (const f of t.type.fields) {
        const fRange = spanToRange(f.span.startLine, f.span.startColumn, f.name.length);
        subChildren.push({
          name: f.name,
          detail: f.optional ? "OPTIONAL" : undefined,
          kind: LspSymbolKind.Field,
          range: fRange,
          selectionRange: fRange,
        });
      }
    } else if (t.type.kind === "choice") {
      for (const alt of t.type.alternatives) {
        const aRange = spanToRange(alt.span.startLine, alt.span.startColumn, alt.name.length);
        subChildren.push({
          name: alt.name,
          detail: "CHOICE alternative",
          kind: LspSymbolKind.Field,
          range: aRange,
          selectionRange: aRange,
        });
      }
    } else if (t.type.kind === "enumerated") {
      for (const item of t.type.items) {
        const iRange = spanToRange(item.span.startLine, item.span.startColumn, item.name.length);
        subChildren.push({
          name: item.name,
          detail: String(item.value),
          kind: LspSymbolKind.EnumMember,
          range: iRange,
          selectionRange: iRange,
        });
      }
    }

    children.push({
      name: t.name,
      detail: t.type.kind.toUpperCase(),
      kind:
        t.type.kind === "enumerated"
          ? LspSymbolKind.Enum
          : t.type.kind === "sequence" || t.type.kind === "set" || t.type.kind === "choice"
            ? LspSymbolKind.Struct
            : LspSymbolKind.Class,
      range: tRange,
      selectionRange: tRange,
      children: subChildren.length > 0 ? subChildren : undefined,
    });
  }

  for (const v of mod.values) {
    const vRange = spanToRange(v.span.startLine, v.span.startColumn, v.name.length);
    children.push({
      name: v.name,
      detail: v.rawValue,
      kind: LspSymbolKind.Constant,
      range: vRange,
      selectionRange: vRange,
    });
  }

  const modRange = spanToRange(mod.span.startLine, mod.span.startColumn, mod.name.length);
  return [
    {
      name: mod.name,
      detail: `${mod.tagDefault} TAGS`,
      kind: LspSymbolKind.Module,
      range: modRange,
      selectionRange: modRange,
      children,
    },
  ];
}

function wordAtPosition(source: string, pos: LspPosition): string {
  const lines = source.split(/\r?\n/);
  const lineText = lines[pos.line] ?? "";
  let start = pos.character;
  let end = pos.character;
  const isWordChar = (ch: string): boolean => /[A-Za-z0-9_-]/.test(ch);
  while (start > 0 && isWordChar(lineText[start - 1] ?? "")) start--;
  while (end < lineText.length && isWordChar(lineText[end] ?? "")) end++;
  return lineText.slice(start, end);
}

/**
 * Provides Markdown hover documentation for ASN.1 types, wire-size bounds, and X.680 universal tags.
 */
export function getAsn1Hover(source: string, position: LspPosition): LspHover | null {
  const word = wordAtPosition(source, position);
  if (!word) return null;

  const mod = parseAsn1(source);
  const bounds = computeWireSizeBounds(mod);
  const typeDef = mod.types.find((t) => t.name === word);
  if (typeDef) {
    const b = bounds.get(typeDef.name);
    const sizeInfo = b
      ? `\n\n- **BER/DER Wire Size:** \`${b.minBytes}..${b.maxBytes}${b.isUnbounded ? "+" : ""} bytes\`\n- **TLV Framing Overhead:** \`${b.minTlvOverhead}..${b.maxTlvOverhead} bytes\``
      : "";
    return {
      contents: {
        kind: "markdown",
        value: `**ASN.1 Type \`${typeDef.name}\`** (\`${typeDef.type.kind}\`)${sizeInfo}`,
      },
    };
  }

  const schema = lookupAsn1ModelSchema(word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}**\n\n${schema.description}\n\n*Reference:* ${schema.provenance}`,
      },
    };
  }

  const kw = ASN1_KEYWORDS.find((k) => k.keyword === word);
  if (kw) {
    return {
      contents: {
        kind: "markdown",
        value: `**\`${kw.keyword}\`** — ${kw.detail}`,
      },
    };
  }

  return null;
}

/**
 * Returns ASN.1 keyword, module type, and cleanroom stdlib completions.
 */
export function getAsn1Completions(source: string): LspCompletionItem[] {
  const items: LspCompletionItem[] = ASN1_KEYWORDS.map((k) => ({
    label: k.keyword,
    kind: 14, // Keyword
    detail: k.detail,
  }));

  const mod = parseAsn1(source);
  for (const t of mod.types) {
    items.push({
      label: t.name,
      kind: 7, // Class/Type
      detail: `ASN.1 ${t.type.kind} in ${mod.name}`,
    });
  }

  for (const schema of getAsn1SchemasFromLibraries()) {
    items.push({
      label: schema.name,
      kind: 22, // Struct
      detail: schema.label,
      documentation: schema.description,
    });
  }

  return items;
}
