// SPDX-License-Identifier: AGPL-3.0-or-later

import { scanStepEntities } from "@modelscript/step";
import { createRequire } from "node:module";
import type { Range } from "vscode-languageserver";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { isDigitCode } from "./lexical-utils.js";

function isStepEntityRefName(name: string): string | undefined {
  const digits = name.startsWith("#") ? name.slice(1) : name;
  if (!digits) return undefined;
  for (let i = 0; i < digits.length; i++) {
    if (!isDigitCode(digits.charCodeAt(i))) return undefined;
  }
  return `#${digits}`;
}

type NodeRequireFn = (id: string) => unknown;

interface NodeFsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
}

interface NodeUrlLike {
  fileURLToPath(url: string): string;
}

export interface SymbolEntryLocationLike {
  resourceId?: string | undefined;
  name?: string | undefined;
  namePath?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  fieldRanges?: Record<string, { startOffset: number; endOffset: number } | undefined> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

interface DocumentTextLookupLike {
  get?(uri: string): { getText?(): string } | undefined | null;
}

let nodeRequire: NodeRequireFn | null = null;
try {
  if (typeof process !== "undefined" && process.versions?.node) {
    nodeRequire = createRequire(import.meta.url) as NodeRequireFn;
  }
} catch {
  // Expected in browser or bundled environments where import.meta.url is not a file URL.
}

/** Helper to convert a SymbolEntry to a cross-file LSP Location */
export function symbolEntryToLocation(
  entry: SymbolEntryLocationLike,
  documentLSPBridges: ReadonlyMap<string, LSPBridge>,
  documentTrees: ReadonlyMap<string, { text?: string | undefined }>,
  documents?: DocumentTextLookupLike | null,
): { uri: string; range: Range } | null {
  const uri = entry.resourceId;
  if (!uri) return null;

  const bridge = documentLSPBridges.get(uri);
  let text: string | undefined = bridge ? bridge.positions?.getSourceText?.() : documentTrees.get(uri)?.text;
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
      const req = nodeRequire;
      if (typeof req === "function") {
        const fs = req("node:fs") as NodeFsLike | null;
        const { fileURLToPath } = req("node:url") as NodeUrlLike;
        const filePath = fileURLToPath(uri);
        if (fs && fs.existsSync(filePath)) {
          text = fs.readFileSync(filePath, "utf-8");
        }
      }
    } catch {
      // Disk read fallback failed; proceed with stored byte/line offsets without source text.
    }
  }

  const namePathKey = entry.namePath;
  const nameField =
    entry.fieldRanges?.["name"] ??
    (entry.fieldRanges
      ? (namePathKey ? entry.fieldRanges[namePathKey] : undefined) || entry.fieldRanges["identifier"]
      : undefined);
  let startOff = nameField?.startOffset;
  let endOff = nameField?.endOffset;

  if (startOff === undefined || endOff === undefined) {
    const baseStart = entry.startOffset ?? 0;
    const baseEnd = entry.endOffset ?? baseStart;
    if (text && entry.name && entry.name !== "<anonymous>") {
      // Check for STEP entity reference: #123
      const wantedStepId = isStepEntityRefName(entry.name);
      if (wantedStepId) {
        const entity = scanStepEntities(text).find((e) => e.id === wantedStepId);
        if (entity) {
          startOff = entity.startOffset;
          const eqIdx = text.indexOf("=", entity.startOffset);
          endOff = eqIdx !== -1 ? eqIdx + 1 : entity.startOffset + wantedStepId.length;
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
  if (bridge && typeof bridge.positions?.rangeFromOffsets === "function") {
    const range = bridge.positions.rangeFromOffsets(startOff, endOff);
    return { uri, range };
  }

  // File is not open and we don't have text. Fallback to entry line / column if available.
  if (!text) {
    const metaLine = typeof entry.metadata?.["line"] === "number" ? entry.metadata["line"] : undefined;
    const metaCol = typeof entry.metadata?.["column"] === "number" ? entry.metadata["column"] : undefined;
    const line = (entry.line ?? metaLine ?? 1) - 1;
    const col = (entry.column ?? metaCol ?? 1) - 1;
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

/**
 * Normalizes scheme slashes on a document URI (e.g. `file:/foo` -> `file:///foo`).
 */
export function normalizeUri(uri: string): string {
  return uri ? uri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///") : "";
}

/**
 * Case-insensitive normalized URI for map/equality comparisons across Windows & POSIX paths.
 */
export function normalizeUriLower(uri: string | undefined): string {
  return uri ? normalizeUri(uri).toLowerCase() : "";
}
