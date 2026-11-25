// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CstUnparser,
  type SymbolEntry as DslSymbolEntry,
  type SyntaxNode,
  type WritebackContext,
  type WritebackEdit,
} from "@modelscript/dsl";
import type { SymbolEntry } from "@modelscript/runtime";
import { Range, TextEdit, type WorkspaceEdit } from "vscode-languageserver";
import type { LspContext } from "../lsp-context.js";
import { globalLanguageRegistry, type LanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName, type HierarchySymbolIndexLike } from "../utils/hierarchy-utils.js";

import { isIdentContCode, skipWs, trimTrailingChars } from "../utils/lexical-utils.js";

type WritebackSymbolEntry = SymbolEntry & {
  fieldRanges?: Record<string, { startOffset: number; endOffset: number } | undefined> | undefined;
};

interface WritebackSymbolIndexLike {
  symbols?: Map<number, WritebackSymbolEntry> | undefined;
  childrenOf?: ReadonlyMap<number | null, readonly number[]> | undefined;
}

export interface ComputeWritebackEditParams {
  target: string;
  newValue: string;
  documentUri?: string | undefined;
}

export interface ComputeWritebackEditResult {
  success: boolean;
  workspaceEdit?: WorkspaceEdit | undefined;
  error?: string | undefined;
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10) {
      line++;
      character = 0;
    } else if (ch === 13) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        continue;
      }
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

function matchOperatorAt(text: string, idx: number, sortedOps: string[]): string | undefined {
  for (const op of sortedOps) {
    if (text.startsWith(op, idx)) return op;
  }
  return undefined;
}

function readAssignmentValueSpan(text: string, afterOpIdx: number): { start: number; end: number } | undefined {
  const valStart = skipWs(text, afterOpIdx);
  let valEnd = valStart;
  while (valEnd < text.length) {
    const ch = text[valEnd]!;
    if (ch === ";" || ch === "}" || ch === "\r" || ch === "\n" || ch === ",") break;
    valEnd++;
  }
  while (valEnd > valStart && (text[valEnd - 1] === " " || text[valEnd - 1] === "\t")) valEnd--;
  return valEnd > valStart ? { start: valStart, end: valEnd } : undefined;
}

/**
 * Universal Generic Fallback (FieldRanges or Assignment Locator).
 * Used when a language plugin does not supply a custom writeback handler,
 * or for dynamic/ad-hoc grammar rules.
 */
function computeGenericWriteback(
  fullText: string,
  entry: WritebackSymbolEntry,
  newValue: string,
  doc?: { positionAt: (offset: number) => { line: number; character: number } },
  operators: string[] = [":=", "="],
  customValueField?: string,
  rootCst?: unknown,
): TextEdit[] {
  const sortedOps = [...operators].sort((a, b) => b.length - a.length);

  // Tier 0: Canonical CstUnparser CST field/value replacement
  const cstRoot = ((rootCst as { rootNode?: SyntaxNode } | undefined)?.rootNode ?? rootCst) as SyntaxNode | undefined;
  const cstUnparse = CstUnparser.patchWritebackValue(
    fullText,
    cstRoot,
    entry as Parameters<typeof CstUnparser.patchWritebackValue>[2],
    newValue,
    {
      valueFields: customValueField ? [customValueField] : undefined,
      operators: sortedOps,
    },
  );
  if (cstUnparse) {
    const startPos = doc ? doc.positionAt(cstUnparse.startIndex) : offsetToPosition(fullText, cstUnparse.startIndex);
    const endPos = doc ? doc.positionAt(cstUnparse.endIndex) : offsetToPosition(fullText, cstUnparse.endIndex);
    return [TextEdit.replace(Range.create(startPos, endPos), cstUnparse.text)];
  }

  // Tier 1: Check precomputed CST fieldRanges from AST indexing (without rootCst alignment)
  if (entry.fieldRanges) {
    const fr = entry.fieldRanges;
    const valField =
      (customValueField ? fr[customValueField] : undefined) ??
      fr["value"] ??
      fr["expression"] ??
      fr["val"] ??
      fr["modification"] ??
      fr["initializer"] ??
      fr["init"] ??
      fr["binding"] ??
      fr["defaultValue"] ??
      fr["default"] ??
      fr["assignedExpression"] ??
      fr["ownedRelatedElement"] ??
      fr["featureValue"];

    const rawStart = valField?.startOffset;
    const rawEnd = valField?.endOffset;
    if (valField && rawStart != null && rawEnd != null && rawEnd > rawStart) {
      let valStart = rawStart;
      let valEnd = rawEnd;
      const valSlice = fullText.substring(valStart, valEnd);
      const leadOp = matchOperatorAt(valSlice, 0, sortedOps);
      if (leadOp) {
        valStart += skipWs(valSlice, leadOp.length);
      }
      const trimmedVal = trimTrailingChars(fullText.substring(valStart, valEnd), ";}\r\n,").trimEnd();
      valEnd = valStart + trimmedVal.length;
      if (valEnd > valStart) {
        const startPos = doc ? doc.positionAt(valStart) : offsetToPosition(fullText, valStart);
        const endPos = doc ? doc.positionAt(valEnd) : offsetToPosition(fullText, valEnd);
        return [TextEdit.replace(Range.create(startPos, endPos), newValue.trim())];
      }
    }
  }

  // Tier 2: Universal assignment locator within [startOffset, endOffset]
  const entryStart = entry.startOffset;
  const entryEnd = entry.endOffset;
  if (entryStart != null && entryEnd != null && entryEnd > entryStart) {
    const declText = fullText.substring(entryStart, entryEnd);
    let bestIdx = -1;
    let bestOp = "";
    for (const op of sortedOps) {
      const idx = declText.indexOf(op);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx || (idx === bestIdx && op.length > bestOp.length))) {
        bestIdx = idx;
        bestOp = op;
      }
    }
    if (bestIdx !== -1) {
      const span = readAssignmentValueSpan(declText, bestIdx + bestOp.length);
      if (span) {
        const valStartOffset = entryStart + span.start;
        const valEndOffset = entryStart + span.end;
        const startPos = doc ? doc.positionAt(valStartOffset) : offsetToPosition(fullText, valStartOffset);
        const endPos = doc ? doc.positionAt(valEndOffset) : offsetToPosition(fullText, valEndOffset);
        return [TextEdit.replace(Range.create(startPos, endPos), newValue.trim())];
      }
    }
  }

  // Tier 3: Universal assignment locator by identifier name within the source
  const name: string | undefined = entry.name;
  if (name) {
    let pos = 0;
    while (pos < fullText.length) {
      const idx = fullText.indexOf(name, pos);
      if (idx === -1) break;
      const prevOk = idx === 0 || !isIdentContCode(fullText.charCodeAt(idx - 1));
      const afterName = idx + name.length;
      const nextOk = afterName >= fullText.length || !isIdentContCode(fullText.charCodeAt(afterName));
      if (prevOk && nextOk) {
        const opStart = skipWs(fullText, afterName);
        const op = matchOperatorAt(fullText, opStart, sortedOps);
        if (op) {
          const span = readAssignmentValueSpan(fullText, opStart + op.length);
          if (span) {
            const startPos = doc ? doc.positionAt(span.start) : offsetToPosition(fullText, span.start);
            const endPos = doc ? doc.positionAt(span.end) : offsetToPosition(fullText, span.end);
            return [TextEdit.replace(Range.create(startPos, endPos), newValue.trim())];
          }
        }
      }
      pos = afterName;
    }
  }

  return [];
}

export async function computeWritebackEdit(
  context: LspContext,
  params: ComputeWritebackEditParams,
): Promise<ComputeWritebackEditResult> {
  const { target, newValue, documentUri } = params;
  if (!target || newValue === undefined) {
    return { success: false, error: "Missing target or newValue" };
  }

  const db = context.workspaceManager.unifiedWorkspace.getIndex();
  const qualifiedTarget = target.trim();

  const matchesUri = (entry: WritebackSymbolEntry | null | undefined): boolean => {
    if (!documentUri) return true;
    if (!entry?.resourceId) return false;
    if (entry.resourceId === documentUri) return true;
    try {
      return decodeURIComponent(entry.resourceId) === decodeURIComponent(documentUri);
    } catch {
      return false;
    }
  };

  const findMatchInIndex = (
    idx: WritebackSymbolIndexLike | null | undefined,
    requireDocumentUri: boolean,
  ): WritebackSymbolEntry | null => {
    if (!idx?.symbols) return null;
    const hIdx = idx as HierarchySymbolIndexLike;
    // 1. Exact FQN match
    for (const entry of idx.symbols.values()) {
      if (!entry.name) continue;
      if (requireDocumentUri && !matchesUri(entry)) continue;
      const fqn = getCompositeName(entry, hIdx);
      if (fqn === qualifiedTarget) {
        return entry;
      }
    }
    // 2. Suffix or simple name match
    for (const entry of idx.symbols.values()) {
      if (!entry.name) continue;
      if (requireDocumentUri && !matchesUri(entry)) continue;
      const fqn = getCompositeName(entry, hIdx);
      if (fqn.endsWith("." + qualifiedTarget) || entry.name === qualifiedTarget) {
        return entry;
      }
    }
    return null;
  };

  let matchedEntry: WritebackSymbolEntry | null = documentUri
    ? findMatchInIndex(db, true)
    : findMatchInIndex(db, false);

  // Check language workspace indices in the target document before falling back globally
  if (!matchedEntry) {
    const allPlugins = globalLanguageRegistry.getAllPlugins();
    if (documentUri) {
      for (const plugin of allPlugins) {
        const idx = (plugin.workspaceIndex ?? context.workspaceManager.getWorkspaceIndex(plugin.id)) as
          WritebackSymbolIndexLike | undefined;
        matchedEntry = findMatchInIndex(idx, true);
        if (matchedEntry) break;
      }
    }
    if (!matchedEntry && !documentUri) {
      for (const plugin of allPlugins) {
        const idx = (plugin.workspaceIndex ?? context.workspaceManager.getWorkspaceIndex(plugin.id)) as
          WritebackSymbolIndexLike | undefined;
        matchedEntry = findMatchInIndex(idx, false);
        if (matchedEntry) break;
      }
    }
  }

  // Only allow cross-document fallback for qualified paths if documentUri did not contain it
  if (!matchedEntry && documentUri && qualifiedTarget.includes(".")) {
    matchedEntry = findMatchInIndex(db, false);
    if (!matchedEntry) {
      for (const plugin of globalLanguageRegistry.getAllPlugins()) {
        const idx = (plugin.workspaceIndex ?? context.workspaceManager.getWorkspaceIndex(plugin.id)) as
          WritebackSymbolIndexLike | undefined;
        matchedEntry = findMatchInIndex(idx, false);
        if (matchedEntry) break;
      }
    }
  }

  if (!matchedEntry || !matchedEntry.resourceId) {
    return { success: false, error: `Symbol '${target}' not found in workspace index.` };
  }

  const uri = matchedEntry.resourceId;
  const doc = context.documents.get(uri);
  const fullText = doc?.getText() ?? context.documentManager.documentTrees.get(uri)?.text;
  if (!fullText) {
    return { success: false, error: `Could not retrieve source text for document ${uri}` };
  }

  // Retrieve the language plugin for this file
  const registry = (context as { languageRegistry?: LanguageRegistry }).languageRegistry ?? globalLanguageRegistry;
  const plugin = registry.getPluginForUri(uri);

  let edits: TextEdit[] = [];

  // Dispatch via language package's writeback hook
  const writebackDef = plugin?.writeback ?? plugin?.languageDef?.writeback;
  const handler = typeof writebackDef === "function" ? writebackDef : writebackDef?.handler;

  if (handler) {
    const wbContext: WritebackContext = {
      entry: matchedEntry as unknown as DslSymbolEntry,
      fullText,
      newValue,
      rootCst: context.documentManager?.documentTrees?.get(uri)?.tree,
      queryEngine: plugin?.queryEngine,
      uri,
    };
    const result = handler(wbContext);
    if (result) {
      const rawEdits: WritebackEdit[] = Array.isArray(result) ? result : [result];
      edits = rawEdits.map((e: WritebackEdit) => {
        const sOff = e.startOffset;
        const eOff = e.endOffset;
        const startPos = doc ? doc.positionAt(sOff) : offsetToPosition(fullText, sOff);
        const endPos = doc ? doc.positionAt(eOff) : offsetToPosition(fullText, eOff);
        return TextEdit.replace(Range.create(startPos, endPos), e.newText);
      });
    }
  }

  // If no custom handler or handler returned nothing, fallback to universal CST/field strategy
  if (edits.length === 0) {
    const operators =
      typeof writebackDef === "object" && writebackDef?.operators ? writebackDef.operators : [":=", "="];
    const valueField = typeof writebackDef === "object" ? writebackDef.valueField : undefined;
    const rootCst = context.documentManager?.documentTrees?.get(uri)?.tree;
    edits = computeGenericWriteback(fullText, matchedEntry, newValue, doc, operators, valueField, rootCst);
  }

  if (edits.length === 0) {
    return { success: false, error: `Could not locate parameter value assignment for '${target}'.` };
  }

  return {
    success: true,
    workspaceEdit: {
      changes: {
        [uri]: edits,
      },
    },
  };
}
