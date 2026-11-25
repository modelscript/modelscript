// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId } from "@modelscript/runtime";
import {
  type BridgeContext,
  findEntryAtOffset,
  findScopeAtOffset,
  getExportedChildren,
  getGlobalLspBridgeEnv,
} from "./bridge-context.js";
import { extractQualifiedPrefixAtOffset, extractWordSpanAtOffset } from "./cst-helpers.js";
import { PositionIndex } from "./position-index.js";
import { collectCrossDomainCounterpartIds, findRefs, resolveName, resolveRef } from "./resolution.js";
import { getRootCstNode } from "./source-access.js";
import type { LSPLocation, LSPRange } from "./types.js";

/**
 * Resolves the declaration location (`LSPLocation`) for the symbol at `byteOffset`.
 */
export function computeDefinition(ctx: BridgeContext, byteOffset: number, sourceText?: string): LSPLocation | null {
  const target = computeDefinitionRaw(ctx, byteOffset, sourceText);
  if (!target) return null;

  const targetUri = target.resourceId || ctx.documentUri;
  let targetPositions: {
    getSourceText(): string;
    rangeFromOffsets(startOffset: number, endOffset: number): LSPRange;
  } = ctx.positions;
  let text: string | undefined = sourceText ?? ctx.positions.getSourceText();

  if (target.resourceId && target.resourceId !== ctx.documentUri) {
    const globalEnv = getGlobalLspBridgeEnv();
    const otherBridge =
      ctx.env?.documentLSPBridges?.get(target.resourceId) ?? globalEnv.documentLSPBridges?.get(target.resourceId);
    if (otherBridge?.positions) {
      targetPositions = otherBridge.positions;
      text = targetPositions.getSourceText();
    } else {
      const otherDocText =
        ctx.env?.documents?.get(target.resourceId)?.getText?.() ??
        globalEnv.documents?.get(target.resourceId)?.getText?.() ??
        ctx.env?.sharedFs?.readFile?.(target.resourceId) ??
        globalEnv.sharedFs?.readFile?.(target.resourceId);
      if (typeof otherDocText === "string") {
        targetPositions = new PositionIndex(otherDocText);
        text = otherDocText;
      } else {
        text = undefined;
      }
    }
  }

  const nameField =
    target.fieldRanges?.["name"] ??
    (target.fieldRanges ? target.fieldRanges[target.namePath] || target.fieldRanges["identifier"] : undefined);
  let startOff = target.startOffset;
  let endOff = target.endOffset;
  if (nameField) {
    startOff = nameField.startOffset;
    endOff = nameField.endOffset;
  } else if (text && target.name && target.name !== "<anonymous>") {
    const baseStart = target.startOffset;
    const baseEnd = target.endOffset;
    const slice = text.slice(baseStart, Math.min(baseStart + 300, baseEnd));
    const idx = slice.indexOf(target.name);
    if (idx !== -1) {
      startOff = baseStart + idx;
      endOff = startOff + target.name.length;
    }
  }

  return {
    uri: targetUri,
    range: targetPositions.rangeFromOffsets(startOff, endOff),
  };
}

/** Returns the raw resolved symbol entry, preserving cross-document resourceIds. */
export function computeDefinitionRaw(ctx: BridgeContext, byteOffset: number, sourceText?: string): SymbolEntry | null {
  const text = sourceText ?? ctx.positions.getSourceText();
  let word = "";
  let qualifiedPrefix = "";
  if (text) {
    const cstRoot = getRootCstNode(ctx);
    const span = extractWordSpanAtOffset(text, byteOffset, cstRoot);
    if (!span) {
      return null;
    }
    word = span.word;
    qualifiedPrefix = extractQualifiedPrefixAtOffset(text, span.start, span.end, cstRoot);
  }

  const refEntry = findEntryAtOffset(ctx, byteOffset);

  if (qualifiedPrefix && qualifiedPrefix !== word) {
    const scopeEntry = findScopeAtOffset(ctx, byteOffset);
    const scopeId = scopeEntry?.id ?? refEntry?.parentId ?? null;
    const qTargets = resolveName(ctx, qualifiedPrefix, scopeId);
    if (qTargets.length > 0) return qTargets[0]!;
  }

  if (!refEntry) return null;

  if (
    word &&
    (refEntry.kind === "Class" || refEntry.ruleName === "SourceFile" || refEntry.ruleName === "source_file")
  ) {
    const nameRange = refEntry.fieldRanges?.["name"];
    const isOverClassName = nameRange
      ? byteOffset >= nameRange.startOffset && byteOffset <= nameRange.endOffset
      : word === refEntry.name && byteOffset < refEntry.startOffset + 200;

    if (!isOverClassName) {
      // Cursor is inside the class body — resolve the word within this class scope
      const targets = resolveName(ctx, qualifiedPrefix || word, refEntry.id);
      if (targets.length > 0) return targets[0]!;
      return null;
    }
  } else if (word && refEntry.kind === "Component") {
    if (word !== refEntry.name) {
      // Cursor is on component type or modifier
      const targets = resolveName(ctx, qualifiedPrefix || word, refEntry.parentId);
      if (targets.length > 0) return targets[0]!;
      return null;
    }
  } else if (word && (refEntry.kind === "Extends" || refEntry.kind === "Import")) {
    const targets = resolveName(ctx, qualifiedPrefix || word, refEntry.parentId);
    if (targets.length > 0) return targets[0]!;
  }

  const targets = resolveRef(ctx, refEntry);
  if (targets.length === 0) return null;

  return targets[0]!;
}

/** Returns the raw symbol entry for the type of the element at the offset, preserving cross-document resourceIds. */
export function computeTypeDefinitionRaw(
  ctx: BridgeContext,
  byteOffset: number,
  sourceText?: string,
): SymbolEntry | null {
  const text = sourceText ?? ctx.positions.getSourceText();
  let word = "";
  if (text) {
    const span = extractWordSpanAtOffset(text, byteOffset, getRootCstNode(ctx));
    if (!span) {
      return null;
    }
    word = span.word;
  }

  const refEntry = findEntryAtOffset(ctx, byteOffset);
  if (!refEntry) return null;

  let targetDecl = refEntry;
  if (word && (refEntry.kind === "Class" || refEntry.ruleName === "SourceFile")) {
    const resolved = resolveName(ctx, word, refEntry.id);
    if (resolved.length > 0) {
      targetDecl = resolved[0]!;
    } else {
      return null;
    }
  } else {
    const resolved = resolveRef(ctx, refEntry);
    if (resolved.length > 0) {
      targetDecl = resolved[0]!;
    }
  }

  try {
    const typeResult = ctx.engine.query<SymbolEntry | null>("resolvedType", targetDecl.id);
    if (typeResult) return typeResult;
  } catch {
    // fallback to child reference lookup
  }

  const children = getExportedChildren(ctx, targetDecl.id);
  const typeRef = children.find((c) => c.kind === "Reference");
  if (typeRef) {
    const typeResolved = resolveRef(ctx, typeRef);
    if (typeResolved.length > 0) return typeResolved[0]!;
  }
  return null;
}

/** Returns cross-language counterpart declarations aligned via TGG correspondence for the symbol at `byteOffset`. */
export function computeCounterpartDefinitionsRaw(ctx: BridgeContext, byteOffset: number): SymbolEntry[] {
  const entry = findEntryAtOffset(ctx, byteOffset);
  if (!entry) return [];
  let targetDecl = entry;
  const resolved = resolveRef(ctx, entry);
  if (resolved.length > 0) {
    targetDecl = resolved[0]!;
  }
  const peerIds = collectCrossDomainCounterpartIds(ctx, targetDecl.id);
  if (entry.id !== targetDecl.id) {
    for (const pid of collectCrossDomainCounterpartIds(ctx, entry.id)) {
      peerIds.add(pid);
    }
  }
  const out: SymbolEntry[] = [];
  for (const pid of peerIds) {
    const sym = ctx.index.symbols.get(pid);
    if (sym && sym.resourceId && sym.resourceId !== ctx.documentUri) {
      out.push(sym);
    }
  }
  return out;
}

/** Returns raw symbol entries for references, preserving cross-document and cross-language resourceIds. */
export function computeFindReferencesRaw(
  ctx: BridgeContext,
  byteOffset: number,
): { declaration: SymbolEntry | null; references: SymbolEntry[] } {
  const entry = findEntryAtOffset(ctx, byteOffset);
  if (!entry) return { declaration: null, references: [] };

  let targetDecl = entry;

  // Is the user hovering over a usage/reference instead of the definition?
  // In SysML2, usage rule names end with "Usage" (e.g. "PartUsage"), but more generally
  // we can check if it resolves to something.
  const resolved = resolveRef(ctx, entry);
  if (resolved.length > 0) {
    targetDecl = resolved[0]!;
  }

  // Find all references mapping to the target declaration (workspace-wide) + cross-domain TGG peers
  const references = [...findRefs(ctx, targetDecl.id)];
  const seenRefIds = new Set<SymbolId>(references.map((r) => r.id));
  for (const peerId of collectCrossDomainCounterpartIds(ctx, targetDecl.id)) {
    const peerDecl = ctx.index.symbols.get(peerId);
    if (peerDecl && !seenRefIds.has(peerDecl.id)) {
      seenRefIds.add(peerDecl.id);
      references.push(peerDecl);
    }
    for (const peerRef of findRefs(ctx, peerId)) {
      if (!seenRefIds.has(peerRef.id)) {
        seenRefIds.add(peerRef.id);
        references.push(peerRef);
      }
    }
  }
  return { declaration: targetDecl, references };
}

/**
 * Returns `LSPLocation[]` for all references within the bound document to the symbol at `byteOffset`.
 */
export function computeReferences(ctx: BridgeContext, byteOffset: number): LSPLocation[] {
  const { references } = computeFindReferencesRaw(ctx, byteOffset);

  // Note: The legacy references() method only maps entries belonging to THIS document
  // because this `positions` index is only valid for the current document.
  return references
    .filter((ref) => ref.resourceId === ctx.documentUri)
    .map((ref) => ({
      uri: ctx.documentUri,
      range: ctx.positions.rangeFromOffsets(ref.startOffset, ref.endOffset),
    }));
}
