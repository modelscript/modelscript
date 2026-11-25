// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "@modelscript/runtime";
import {
  type BridgeContext,
  findEntryAtOffset,
  findScopeAtOffset,
  getExportedChildren,
  isDecl,
} from "./bridge-context.js";
import {
  extractModificationTargetType,
  extractQualifiedPrefixAtOffset,
  extractWordSpanAtOffset,
} from "./cst-helpers.js";
import { hoverEntry } from "./hover-format.js";
import { getInheritedMembers, resolveName, resolveRef } from "./resolution.js";
import { getRootCstNode } from "./source-access.js";
import type { LSPHover } from "./types.js";

/**
 * Computes Markdown hover documentation (`LSPHover`) for the symbol at `byteOffset`,
 * supporting modification-context attribute hover, qualified paths, class/component declarations,
 * doc comments, and predefined types.
 */
export function computeHover(ctx: BridgeContext, byteOffset: number, sourceText?: string): LSPHover | null {
  const text = sourceText ?? ctx.positions.getSourceText();
  if (text) {
    const modHover = hoverModificationContext(ctx, byteOffset, text);
    if (modHover) return modHover;
  }

  if (!text) return null;

  const cstRoot = getRootCstNode(ctx);
  const span = extractWordSpanAtOffset(text, byteOffset, cstRoot);
  if (!span) {
    return null;
  }

  const { word, start: wordStart, end: wordEnd } = span;
  const qualifiedPrefix = extractQualifiedPrefixAtOffset(text, wordStart, wordEnd, cstRoot);
  const hoverRange = ctx.positions.rangeFromOffsets(wordStart, wordEnd);

  const entry = findEntryAtOffset(ctx, byteOffset);
  let targetDecl: SymbolEntry | null = null;

  // 1. If the hovered identifier is part of a dotted or `::`-qualified reference (e.g.
  //    `Modelica.Electrical.Analog.Sources.SineVoltage` or `Vb.p`), resolve the full prefix up to `wordEnd`.
  if (qualifiedPrefix && qualifiedPrefix !== word) {
    const scopeEntry = findScopeAtOffset(ctx, byteOffset);
    const scopeId = scopeEntry?.id ?? entry?.parentId ?? null;
    const qResolved = resolveName(ctx, qualifiedPrefix, scopeId);
    if (qResolved.length > 0) {
      targetDecl = qResolved[0]!;
    }
  }

  if (!targetDecl && entry) {
    if (
      entry.kind === "Class" ||
      entry.kind === "Package" ||
      entry.kind === "Module" ||
      entry.kind === "Namespace" ||
      entry.ruleName === "SourceFile" ||
      entry.ruleName === "source_file"
    ) {
      const nameRange = entry.fieldRanges?.["name"];
      const isOverClassName = nameRange
        ? wordStart >= nameRange.startOffset && wordEnd <= nameRange.endOffset
        : word === entry.name && wordStart < entry.startOffset + 200;

      if (isOverClassName) {
        targetDecl = entry;
      } else {
        // Inside class body — resolve the word within this class scope
        const resolved = resolveName(ctx, qualifiedPrefix || word, entry.id);
        if (resolved.length > 0) {
          targetDecl = resolved[0]!;
        }
      }
    } else if (entry.kind === "Component" || entry.kind === "Variable") {
      const nameRange = entry.fieldRanges?.["name"] ?? entry.fieldRanges?.[entry.namePath];
      const isOverCompName = nameRange
        ? wordStart >= nameRange.startOffset && wordEnd <= nameRange.endOffset
        : word === entry.name && qualifiedPrefix === word;
      if (isOverCompName) {
        targetDecl = entry;
      } else {
        const resolved = resolveName(ctx, qualifiedPrefix || word, entry.parentId);
        if (resolved.length > 0) {
          targetDecl = resolved[0]!;
        }
      }
    } else if (
      entry.kind === "Reference" ||
      entry.kind === "Extends" ||
      entry.kind === "Import" ||
      entry.kind === "ConnectEquation" ||
      entry.kind === "FunctionCall"
    ) {
      const resolved = resolveName(ctx, qualifiedPrefix || word, entry.parentId);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      } else {
        const refResolved = resolveRef(ctx, entry);
        if (refResolved.length > 0) {
          targetDecl = refResolved[0]!;
        }
      }
    } else if (word === entry.name) {
      targetDecl = entry;
    }
  }

  if (!targetDecl) {
    const scopeEntry = findScopeAtOffset(ctx, byteOffset);
    const scopeId = scopeEntry?.id ?? null;
    const resolved = resolveName(ctx, qualifiedPrefix || word, scopeId);
    if (resolved.length > 0) {
      targetDecl = resolved[0]!;
    }
  }

  if (!targetDecl) {
    // Check if word is a predefined type in the index
    const predefinedIds = ctx.index.byName.get(word);
    if (predefinedIds && predefinedIds.length > 0) {
      const candidate = ctx.index.symbols.get(predefinedIds[0]!);
      if (candidate?.metadata?.["isPredefined"]) {
        targetDecl = candidate;
      }
    }
  }

  if (!targetDecl) return null;

  const md = hoverEntry(ctx, targetDecl);
  if (!md) return null;

  return {
    contents: md,
    range: hoverRange,
  };
}

/**
 * Resolves hover documentation when the cursor is over a modifier name inside a component modification `(...)`.
 */
function hoverModificationContext(ctx: BridgeContext, byteOffset: number, sourceText: string): LSPHover | null {
  const cstRoot = getRootCstNode(ctx);
  const span = extractWordSpanAtOffset(sourceText, byteOffset, cstRoot);
  if (!span) return null;
  const { word, start, end } = span;

  const before = sourceText.slice(0, start);
  let depth = 0;
  let parenPos = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ")") depth++;
    if (ch === "(") {
      if (depth === 0) {
        parenPos = i;
        break;
      }
      depth--;
    }
  }
  if (parenPos < 0) return null;

  // Ensure the hovered identifier is on the left-hand side of a modification (not after `=`)
  const sinceOpenParen = before.slice(parenPos + 1);
  let innerDepth = 0;
  let lastCommaOrStart = 0;
  for (let i = 0; i < sinceOpenParen.length; i++) {
    const ch = sinceOpenParen[i];
    if (ch === "(" || ch === "[" || ch === "{") innerDepth++;
    else if (ch === ")" || ch === "]" || ch === "}") innerDepth = Math.max(0, innerDepth - 1);
    else if (innerDepth === 0 && ch === ",") lastCommaOrStart = i + 1;
  }
  const currentArgPrefix = sinceOpenParen.slice(lastCommaOrStart);
  if (currentArgPrefix.includes("=")) {
    return null;
  }

  const beforeParen = before.slice(0, parenPos).trimEnd();
  const typeName = extractModificationTargetType(beforeParen, true, cstRoot, parenPos);
  if (!typeName) return null;

  const scopeEntry = findScopeAtOffset(ctx, byteOffset);
  const scopeId = scopeEntry?.id ?? null;
  const typeDecls = resolveName(ctx, typeName, scopeId);
  if (typeDecls.length === 0) return null;

  const typeEntry = typeDecls[0]!;
  const hoverRange = ctx.positions.rangeFromOffsets(start, end);

  const children = getExportedChildren(ctx, typeEntry.id);
  for (const child of children) {
    if (child.name === word && isDecl(child)) {
      return { contents: hoverEntry(ctx, child), range: hoverRange };
    }
  }

  const inherited = getInheritedMembers(ctx, typeEntry.id);
  for (const member of inherited) {
    if (member.name === word) {
      return { contents: hoverEntry(ctx, member), range: hoverRange };
    }
  }

  if (typeEntry.metadata?.["completionMembers"] && Array.isArray(typeEntry.metadata["completionMembers"])) {
    if (typeEntry.metadata["completionMembers"].includes(word)) {
      const lang = typeEntry.language ?? "modelica";
      return {
        contents: `\`\`\`${lang}\n${word}\n\`\`\`\n---\nBuilt-in attribute of ${typeEntry.name}`,
        range: hoverRange,
      };
    }
  }

  return null;
}
