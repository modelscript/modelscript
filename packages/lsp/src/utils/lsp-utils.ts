// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from "node:module";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";

let nodeRequire: any = null;
try {
  if (typeof process !== "undefined" && process.versions?.node) {
    nodeRequire = createRequire(import.meta.url);
  }
} catch {}

/** Helper to convert a SymbolEntry to a cross-file LSP Location */
export function symbolEntryToLocation(
  entry: any,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
  documents?: any,
): { uri: string; range: any } | null {
  const uri = entry.resourceId;
  if (!uri) return null;

  const bridge = documentLSPBridges.get(uri);
  let text = bridge ? (bridge as any).positions?.getSourceText?.() : documentTrees.get(uri)?.text;
  if (!text && documents) {
    const doc = typeof documents.get === "function" ? documents.get(uri) : null;
    if (doc && typeof doc.getText === "function") {
      text = doc.getText();
    }
  }

  // Node.js fallback if running in Node and URI is a file:// URL
  if (
    !text &&
    typeof process !== "undefined" &&
    process.versions?.node &&
    typeof uri === "string" &&
    uri.startsWith("file://")
  ) {
    try {
      const req = nodeRequire ?? (globalThis as any).require;
      if (typeof req === "function") {
        const fs = req("node:fs");
        const { fileURLToPath } = req("node:url");
        const filePath = fileURLToPath(uri);
        if (fs && fs.existsSync(filePath)) {
          text = fs.readFileSync(filePath, "utf-8");
        }
      }
    } catch {}
  }

  const nameField =
    entry.fieldRanges?.name ??
    (entry.fieldRanges ? entry.fieldRanges[entry.namePath] || entry.fieldRanges["identifier"] : undefined);
  let startOff = nameField?.startOffset ?? nameField?.startByte;
  let endOff = nameField?.endOffset ?? nameField?.endByte;

  if (startOff === undefined || endOff === undefined) {
    const baseStart = entry.startOffset ?? entry.startByte ?? 0;
    const baseEnd = entry.endOffset ?? entry.endByte ?? baseStart;
    if (text && entry.name && entry.name !== "<anonymous>") {
      // Check for STEP entity reference: #123
      if (/^#?\d+$/.test(entry.name)) {
        const num = entry.name.replace("#", "");
        const stepMatch = new RegExp(`^#${num}\\s*=`, "m").exec(text);
        if (stepMatch) {
          startOff = stepMatch.index;
          endOff = startOff + stepMatch[0].length;
        }
      }
      if (startOff === undefined || endOff === undefined) {
        const slice = text.slice(baseStart, Math.min(baseStart + 300, baseEnd));
        const idx = slice.indexOf(entry.name);
        if (idx !== -1) {
          startOff = baseStart + idx;
          endOff = startOff + entry.name.length;
        }
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

  // File is not open and we don't have text. Fallback to entry line / column if available.
  if (!text) {
    const line = (entry.line ?? entry.metadata?.line ?? 1) - 1;
    const col = (entry.column ?? entry.metadata?.column ?? 1) - 1;
    const len = entry.name?.length || 1;
    return {
      uri,
      range: {
        start: { line: Math.max(0, line), character: Math.max(0, col) },
        end: { line: Math.max(0, line), character: Math.max(0, col + len) },
      },
    };
  }

  const positions = new PositionIndex(text);
  return { uri, range: positions.rangeFromOffsets(startOff, endOff) };
}
