// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Language Server Protocol (LSP) Service Integration.
 *
 * Implements real-time diagnostic reporting, document symbol trees,
 * hover documentation, and formal entailment inspection for OMG ReqIF 1.2.
 */

import { parseXml } from "@modelscript/dsl/xml";
import { lintReqIf } from "./lints/index.js";
import { parseReqIf } from "./parser/reqif-parser.js";
import type { ReqIfDocument, ReqIfSpecHierarchy, ReqIfSpecObject } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  code: string | number;
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

/**
 * Validates a ReqIF document text and produces LSP diagnostics.
 */
export function validateReqif(content: string): LspDiagnostic[] {
  const xml = parseXml(content);
  const diags: LspDiagnostic[] = [];

  if (xml.errors && xml.errors.length > 0) {
    for (const _err of xml.errors) {
      diags.push({
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "REQIF-PARSE-ERROR",
        source: "reqif",
        message: "XML syntax error in ReqIF document",
      });
    }
  }

  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch (err: unknown) {
    diags.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
      code: "REQIF-PARSE-ERROR",
      source: "reqif",
      message: (err instanceof Error ? err.message : String(err)) || "Failed to parse ReqIF XML document",
    });
    return diags;
  }

  const lintDiags = lintReqIf(doc);
  for (const d of lintDiags) {
    const startLine = d.span ? Math.max(0, d.span.startLine - 1) : 0;
    const startCol = d.span ? Math.max(0, d.span.startCol - 1) : 0;
    const endLine = d.span ? Math.max(0, d.span.endLine - 1) : startLine;
    const endCol = d.span ? Math.max(0, d.span.endCol - 1) : startCol + 10;

    diags.push({
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "reqif",
      message: d.message,
    });
  }

  return diags;
}

/**
 * Builds hierarchical DocumentSymbols representing specifications and requirements.
 */
export function getReqifDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  function hierarchyToSymbol(h: ReqIfSpecHierarchy): LspDocumentSymbol | null {
    const obj = doc.specObjects.get(h.objectRef);
    if (!obj) return null;

    const startLine = obj.span ? Math.max(0, obj.span.startLine - 1) : 0;
    const startCol = obj.span ? Math.max(0, obj.span.startCol - 1) : 0;
    const endLine = obj.span ? Math.max(0, obj.span.endLine - 1) : startLine;
    const endCol = obj.span ? Math.max(0, obj.span.endCol - 1) : startCol + 20;

    const range: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    const asilStr = obj.asilLevel ? ` [${obj.asilLevel}]` : "";
    const contractStr = obj.contract
      ? ` (${obj.contract.variable} ${obj.contract.comparator} ${obj.contract.limitValue}${obj.contract.unit ? " " + obj.contract.unit : ""})`
      : "";
    const detail = `${obj.longName ?? ""}${asilStr}${contractStr}`.trim();

    const childSymbols: LspDocumentSymbol[] = [];
    if (h.children && h.children.length > 0) {
      for (const child of h.children) {
        const s = hierarchyToSymbol(child);
        if (s) childSymbols.push(s);
      }
    }

    return {
      name: `[${obj.identifier}] ${obj.longName ?? obj.text.slice(0, 30)}`,
      detail: detail.length > 0 ? detail : undefined,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
      children: childSymbols.length > 0 ? childSymbols : undefined,
    };
  }

  for (const spec of doc.specifications) {
    const startLine = spec.span ? Math.max(0, spec.span.startLine - 1) : 0;
    const startCol = spec.span ? Math.max(0, spec.span.startCol - 1) : 0;
    const endLine = spec.span ? Math.max(0, spec.span.endLine - 1) : startLine;
    const endCol = spec.span ? Math.max(0, spec.span.endCol - 1) : startCol + 20;

    const specRange: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    const children: LspDocumentSymbol[] = [];
    for (const h of spec.children) {
      const s = hierarchyToSymbol(h);
      if (s) children.push(s);
    }

    symbols.push({
      name: spec.longName ?? spec.identifier,
      detail: `Specification (${children.length} root items)`,
      kind: LspSymbolKind.Package,
      range: specRange,
      selectionRange: specRange,
      children: children.length > 0 ? children : undefined,
    });
  }

  return symbols;
}

/**
 * Resolves hover documentation for a requirement under cursor.
 */
export function getReqifHover(content: string, line: number, character: number): LspHover | null {
  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch {
    return null;
  }

  // 1-indexed line for comparison with SourceSpan
  const l1 = line + 1;
  const c1 = character + 1;

  for (const obj of doc.specObjects.values()) {
    if (obj.span) {
      const inside =
        (l1 > obj.span.startLine || (l1 === obj.span.startLine && c1 >= obj.span.startCol)) &&
        (l1 < obj.span.endLine || (l1 === obj.span.endLine && c1 <= obj.span.endCol));

      if (inside) {
        return formatSpecObjectHover(obj, doc);
      }
    }
  }

  return null;
}

function formatSpecObjectHover(obj: ReqIfSpecObject, doc: ReqIfDocument): LspHover {
  const md: string[] = [];
  md.push(`### Requirement: \`${obj.identifier}\``);
  if (obj.longName) {
    md.push(`**Title:** ${obj.longName}`);
  }

  const badges: string[] = [];
  if (obj.asilLevel) badges.push(`**ASIL:** \`${obj.asilLevel}\``);
  if (obj.status) badges.push(`**Status:** \`${obj.status}\``);
  if (badges.length > 0) {
    md.push(badges.join(" | "));
  }

  if (obj.text) {
    md.push(`\n> ${obj.text.trim()}\n`);
  }

  if (obj.contract) {
    const c = obj.contract;
    const unitStr = c.unit ? ` ${c.unit}` : "";
    md.push(`**Formal Contract (Nelson-Oppen):** \`${c.variable} ${c.comparator} ${c.limitValue}${unitStr}\``);
  }

  // Traceability relations
  const outgoing = doc.specRelations.filter((r) => r.sourceId === obj.identifier);
  const incoming = doc.specRelations.filter((r) => r.targetId === obj.identifier);

  if (outgoing.length > 0 || incoming.length > 0) {
    md.push(`\n**Traceability Links:**`);
    for (const r of outgoing) {
      md.push(`- *${r.relationType}* → \`${r.targetId}\``);
    }
    for (const r of incoming) {
      md.push(`- *${r.relationType}* ← from \`${r.sourceId}\``);
    }
  }

  return {
    contents: {
      kind: "markdown",
      value: md.join("\n"),
    },
  };
}
