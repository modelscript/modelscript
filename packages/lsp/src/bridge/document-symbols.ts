// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId } from "@modelscript/runtime";
import { type BridgeContext, normalizeResourceUri } from "./bridge-context.js";
import { type LSPDocumentSymbol, mapSymbolKind } from "./types.js";

/**
 * Builds the hierarchical `LSPDocumentSymbol` outline tree for the bound document.
 */
export function computeDocumentSymbols(ctx: BridgeContext): LSPDocumentSymbol[] {
  // Collect only symbols belonging to this document
  const docSymbols = new Set<SymbolId>();
  const targetNorm = normalizeResourceUri(ctx.documentUri);

  let docSymbolIds: SymbolId[] | undefined;
  if (ctx.index.symbolsByResource) {
    docSymbolIds = ctx.index.symbolsByResource.get(ctx.documentUri);
    if (!docSymbolIds || docSymbolIds.length === 0) {
      for (const [k, v] of ctx.index.symbolsByResource.entries()) {
        const kNorm = normalizeResourceUri(k);
        if (k === ctx.documentUri || kNorm === targetNorm || kNorm.endsWith(targetNorm) || targetNorm.endsWith(kNorm)) {
          docSymbolIds = v;
          break;
        }
      }
    }
  }

  if (docSymbolIds && docSymbolIds.length > 0) {
    for (const id of docSymbolIds) {
      const entry = ctx.index.symbols.get(id);
      if (!entry || entry.kind === "Reference" || entry.kind === "ConnectEquation" || entry.kind === "FunctionCall")
        continue;
      docSymbols.add(entry.id);
    }
  } else {
    // Fallback for older index format or if symbolsByResource missed it
    for (const entry of ctx.index.symbols.values()) {
      const resNorm = entry.resourceId ? normalizeResourceUri(entry.resourceId) : "";
      const matches =
        entry.resourceId === ctx.documentUri ||
        resNorm === targetNorm ||
        (resNorm && (resNorm.endsWith(targetNorm) || targetNorm.endsWith(resNorm)));
      if (!matches) continue;
      if (entry.kind === "Reference" || entry.kind === "ConnectEquation" || entry.kind === "FunctionCall") continue;
      docSymbols.add(entry.id);
    }
  }

  // Build hierarchy: group by parentId, reparenting orphans to null
  const childrenOf = new Map<SymbolId | null, SymbolEntry[]>();

  for (const id of docSymbols) {
    const entry = ctx.index.symbols.get(id)!;
    // If parent was filtered out (from a different file), treat as root
    const parentKey = entry.parentId !== null && docSymbols.has(entry.parentId) ? entry.parentId : null;
    const children = childrenOf.get(parentKey);
    if (children) {
      children.push(entry);
    } else {
      childrenOf.set(parentKey, [entry]);
    }
  }

  const visitedDocSymbolIds = new Set<SymbolId>();
  const buildLevel = (parentId: SymbolId | null): LSPDocumentSymbol[] => {
    if (parentId !== null) {
      if (visitedDocSymbolIds.has(parentId)) return [];
      visitedDocSymbolIds.add(parentId);
    }
    const entries = childrenOf.get(parentId) || [];
    return entries.map((entry) => {
      const fullStart = Math.min(entry.startOffset, entry.endOffset);
      const fullEnd = Math.max(entry.startOffset, entry.endOffset);
      let range = ctx.positions.rangeFromOffsets(fullStart, fullEnd);
      if (
        range.end.line < range.start.line ||
        (range.end.line === range.start.line && range.end.character < range.start.character)
      ) {
        range = { start: range.start, end: { ...range.start } };
      }

      let name = entry.name;
      if (!name || name === "<anonymous>") {
        try {
          const source = ctx.engine.cstText(fullStart, fullEnd, entry);
          if (source) {
            const firstLine = source.trim().split("\n")[0]!.trim();
            name = firstLine.length > 40 ? firstLine.substring(0, 37) + "..." : firstLine;
          }
        } catch {
          // fallback if engine doesn't support cstText
        }
      }
      if (!name) name = "anonymous";

      let selectionRange = range;
      const nameField =
        entry.fieldRanges?.["name"] ??
        (entry.fieldRanges ? entry.fieldRanges[entry.namePath] || entry.fieldRanges["identifier"] : undefined);
      if (nameField) {
        const nfStart = Math.min(nameField.startOffset, nameField.endOffset);
        const nfEnd = Math.max(nameField.startOffset, nameField.endOffset);
        const selStart = Math.max(fullStart, Math.min(nfStart, fullEnd));
        const selEnd = Math.max(selStart, Math.min(nfEnd, fullEnd));
        selectionRange = ctx.positions.rangeFromOffsets(selStart, selEnd);
      } else {
        const text = ctx.positions.getSourceText();
        if (text && entry.name && entry.name !== "<anonymous>") {
          const slice = text.slice(fullStart, Math.min(fullStart + 300, fullEnd));
          const idx = slice.indexOf(entry.name);
          if (idx !== -1) {
            const selStart = fullStart + idx;
            const selEnd = Math.min(selStart + entry.name.length, fullEnd);
            selectionRange = ctx.positions.rangeFromOffsets(selStart, selEnd);
          }
        }
      }

      // Validate & clamp selectionRange inside range so VS Code never throws selectionRange must be contained in fullRange
      let sStart = { ...selectionRange.start };
      let sEnd = { ...selectionRange.end };
      const isBefore = (a: { line: number; character: number }, b: { line: number; character: number }) =>
        a.line < b.line || (a.line === b.line && a.character < b.character);
      if (isBefore(sEnd, sStart)) sEnd = { ...sStart };
      if (isBefore(sStart, range.start)) sStart = { ...range.start };
      if (isBefore(range.end, sStart)) sStart = { ...range.end };
      if (isBefore(sEnd, sStart)) sEnd = { ...sStart };
      if (isBefore(range.end, sEnd)) sEnd = { ...range.end };
      if (isBefore(sEnd, sStart) || isBefore(sStart, range.start) || isBefore(range.end, sEnd)) {
        sStart = { ...range.start };
        sEnd = { ...range.end };
      }
      selectionRange = { start: sStart, end: sEnd };

      const symbol: LSPDocumentSymbol = {
        name,
        kind: mapSymbolKind(entry.kind),
        range,
        selectionRange,
        children: buildLevel(entry.id),
      };
      return symbol;
    });
  };

  return buildLevel(null);
}
