// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostics, document symbol outlines, hover documentation,
 * and go-to-definition across `xmi:id` references for `.mdzip`, `.mdxml`, and `.xmi`.
 */

import { lintMagicDrawDocument } from "./lints/index.js";
import { parseMagicDraw } from "./parser/index.js";
import type { MagicDrawDocument, SourceSpan } from "./types.js";

export interface MagicDrawLspPosition {
  line: number;
  character: number;
}

export interface MagicDrawLspRange {
  start: MagicDrawLspPosition;
  end: MagicDrawLspPosition;
}

export interface MagicDrawLspDiagnostic {
  range: MagicDrawLspRange;
  severity: 1 | 2 | 3;
  code: string;
  source: string;
  message: string;
}

export interface MagicDrawLspSymbol {
  name: string;
  detail?: string | undefined;
  kind: number;
  range: MagicDrawLspRange;
  selectionRange: MagicDrawLspRange;
  children?: MagicDrawLspSymbol[] | undefined;
}

function spanToRange(span?: SourceSpan): MagicDrawLspRange {
  if (!span) {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  }
  return {
    start: { line: Math.max(0, span.startLine - 1), character: Math.max(0, span.startColumn - 1) },
    end: { line: Math.max(0, span.endLine - 1), character: Math.max(0, span.endColumn - 1) },
  };
}

export function getMagicDrawDiagnostics(text: string): MagicDrawLspDiagnostic[] {
  const doc = parseMagicDraw(text);
  const diags = lintMagicDrawDocument(doc);
  return diags.map((d) => ({
    range: spanToRange(d.span),
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "magicdraw",
    message: d.message,
  }));
}

export function getMagicDrawDocumentSymbols(textOrDoc: string | MagicDrawDocument): MagicDrawLspSymbol[] {
  const doc = typeof textOrDoc === "string" ? parseMagicDraw(textOrDoc) : textOrDoc;
  const symbols: MagicDrawLspSymbol[] = [];

  for (const pkg of doc.packages.values()) {
    const children: MagicDrawLspSymbol[] = [];
    for (const clsId of pkg.classifierIds) {
      const cls = doc.classifiers.get(clsId);
      if (!cls) continue;
      const clsRange = spanToRange(cls.span);
      const memberSyms: MagicDrawLspSymbol[] = [
        ...cls.properties.map((p) => ({
          name: p.name,
          detail: p.typeRef?.resolvedName ? `: ${p.typeRef.resolvedName}` : undefined,
          kind: 7, // Property
          range: spanToRange(p.span),
          selectionRange: spanToRange(p.span),
        })),
        ...cls.ports.map((pt) => ({
          name: pt.name,
          detail: pt.typeRef?.resolvedName ? `: ${pt.isConjugated ? "~" : ""}${pt.typeRef.resolvedName}` : "Port",
          kind: 8, // Field
          range: spanToRange(pt.span),
          selectionRange: spanToRange(pt.span),
        })),
      ];
      children.push({
        name: cls.name,
        detail: cls.stereotypes.length > 0 ? cls.stereotypes.map((s) => `«${s.name}»`).join(" ") : cls.kind,
        kind: cls.kind === "Enumeration" ? 10 : cls.kind === "InterfaceBlock" ? 11 : 5,
        range: clsRange,
        selectionRange: clsRange,
        children: memberSyms.length > 0 ? memberSyms : undefined,
      });
    }
    const pkgRange = spanToRange(pkg.span);
    symbols.push({
      name: pkg.name,
      detail: pkg.isModel ? "uml:Model" : "uml:Package",
      kind: 4, // Package
      range: pkgRange,
      selectionRange: pkgRange,
      children: children.length > 0 ? children : undefined,
    });
  }

  return symbols;
}

export function getMagicDrawHover(
  text: string,
  offset: number,
): { contents: string; range?: MagicDrawLspRange } | null {
  const doc = parseMagicDraw(text);
  for (const cls of doc.classifiers.values()) {
    if (cls.span && offset >= cls.span.startOffset && offset <= cls.span.endOffset) {
      const stStr = cls.stereotypes.map((s) => `«${s.name}»`).join(" ") || `«${cls.kind}»`;
      const lines = [`**${stStr} ${cls.name}**`, `Qualified Name: \`${cls.qualifiedName}\``, `XMI ID: \`${cls.id}\``];
      if (cls.requirementId) lines.push(`Requirement ID: \`${cls.requirementId}\``);
      if (cls.requirementText) lines.push(`\n> ${cls.requirementText}`);
      if (cls.documentation) lines.push(`\n${cls.documentation}`);
      return { contents: lines.join("\n"), range: spanToRange(cls.span) };
    }
  }
  return null;
}
