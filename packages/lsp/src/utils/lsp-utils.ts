// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";

/** Helper to convert a SymbolEntry to a cross-file LSP Location */
export function symbolEntryToLocation(
  entry: any,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
): { uri: string; range: any } | null {
  const uri = entry.resourceId;
  if (!uri) return null;

  const bridge = documentLSPBridges.get(uri);
  const text = bridge ? (bridge as any).positions?.getSourceText?.() : documentTrees.get(uri)?.text;

  const nameField =
    entry.fieldRanges?.name ??
    (entry.fieldRanges ? entry.fieldRanges[entry.namePath] || entry.fieldRanges["identifier"] : undefined);
  let startOff = nameField?.startOffset ?? nameField?.startByte;
  let endOff = nameField?.endOffset ?? nameField?.endByte;

  if (startOff === undefined || endOff === undefined) {
    const baseStart = entry.startOffset ?? entry.startByte ?? 0;
    const baseEnd = entry.endOffset ?? entry.endByte ?? baseStart;
    if (text && entry.name && entry.name !== "<anonymous>") {
      const slice = text.slice(baseStart, Math.min(baseStart + 300, baseEnd));
      const idx = slice.indexOf(entry.name);
      if (idx !== -1) {
        startOff = baseStart + idx;
        endOff = startOff + entry.name.length;
      }
    }
    if (startOff === undefined || endOff === undefined) {
      startOff = baseStart;
      endOff = baseEnd;
    }
  }

  // If the file is open, we already have a PositionIndex in its LSPBridge
  if (bridge) {
    const range = (bridge as any).positions.rangeFromOffsets(startOff, endOff);
    return { uri, range };
  }

  // File is not open and we don't have text. Fallback to line 1 to avoid sync IO.
  // In the future, we could resolve positions asynchronously from VFS.
  if (!text) {
    return {
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }

  const positions = new PositionIndex(text);
  return { uri, range: positions.rangeFromOffsets(startOff, endOff) };
}
