// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit } from "@modelscript/dsl";
import { Range, TextEdit, type WorkspaceEdit } from "vscode-languageserver";
import type { LspContext } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";

import { isIdentContCode, skipWs, trimTrailingChars } from "../utils/lexical-utils.js";

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
  entry: any,
  newValue: string,
  doc?: { positionAt: (offset: number) => { line: number; character: number } },
  operators: string[] = [":=", "="],
  customValueField?: string,
): TextEdit[] {
  const sortedOps = [...operators].sort((a, b) => b.length - a.length);

  // Tier 1: Check precomputed CST fieldRanges from AST indexing
  if (entry.fieldRanges) {
    const valField =
      (customValueField ? entry.fieldRanges[customValueField] : undefined) ??
      entry.fieldRanges.value ??
      entry.fieldRanges.expression ??
      entry.fieldRanges.val ??
      entry.fieldRanges.modification ??
      entry.fieldRanges.initializer ??
      entry.fieldRanges.init ??
      entry.fieldRanges.binding ??
      entry.fieldRanges.defaultValue ??
      entry.fieldRanges.default ??
      entry.fieldRanges.assignedExpression ??
      entry.fieldRanges.ownedRelatedElement ??
      entry.fieldRanges.featureValue;

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
  const { target, newValue } = params;
  if (!target || newValue === undefined) {
    return { success: false, error: "Missing target or newValue" };
  }

  const db = context.workspaceManager.unifiedWorkspace.getIndex();
  let matchedEntry: any = null;
  const qualifiedTarget = target.trim();

  // 1. Try exact match on getCompositeName
  for (const entry of db.symbols.values()) {
    if (!entry.name) continue;
    const fqn = getCompositeName(entry, db);
    if (fqn === qualifiedTarget) {
      matchedEntry = entry;
      break;
    }
  }

  // 2. If not found, match by suffix or simple name
  if (!matchedEntry) {
    for (const entry of db.symbols.values()) {
      if (!entry.name) continue;
      const fqn = getCompositeName(entry, db);
      if (fqn.endsWith("." + qualifiedTarget) || entry.name === qualifiedTarget) {
        matchedEntry = entry;
        break;
      }
    }
  }

  // 3. Check language workspace indices if unified index did not find it
  if (!matchedEntry) {
    const allPlugins = globalLanguageRegistry.getAllPlugins();
    for (const plugin of allPlugins) {
      const idx = plugin.workspaceIndex ?? context.workspaceManager.getWorkspaceIndex(plugin.id);
      if (idx?.symbols) {
        for (const entry of idx.symbols.values()) {
          if (!entry.name) continue;
          const fqn = getCompositeName(entry, idx);
          if (fqn === qualifiedTarget || fqn.endsWith("." + qualifiedTarget) || entry.name === qualifiedTarget) {
            matchedEntry = entry;
            break;
          }
        }
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
  const registry = (context as any).languageRegistry ?? globalLanguageRegistry;
  const plugin = registry.getPluginForUri(uri);

  let edits: TextEdit[] = [];

  // Dispatch via language package's writeback hook
  const writebackDef = plugin?.writeback ?? plugin?.languageDef?.writeback;
  const handler = typeof writebackDef === "function" ? writebackDef : writebackDef?.handler;

  if (handler) {
    const wbContext: WritebackContext = {
      entry: matchedEntry,
      fullText,
      newValue,
      rootCst: context.documentManager?.documentTrees?.get(uri)?.tree,
      queryEngine: plugin?.queryEngine,
      uri,
    };
    const result = handler(wbContext);
    if (result) {
      const rawEdits: WritebackEdit[] = Array.isArray(result) ? result : [result];
      edits = rawEdits.map((e: any) => {
        const sOff = e.startOffset;
        const eOff = e.endOffset;
        const startPos = doc ? doc.positionAt(sOff) : offsetToPosition(fullText, sOff);
        const endPos = doc ? doc.positionAt(eOff) : offsetToPosition(fullText, eOff);
        return TextEdit.replace(Range.create(startPos, endPos), e.newText);
      });
    }
  }

  // If no custom handler or handler returned nothing, fallback to universal generic strategy
  if (edits.length === 0) {
    const operators =
      typeof writebackDef === "object" && writebackDef?.operators ? writebackDef.operators : [":=", "="];
    const valueField = typeof writebackDef === "object" ? writebackDef.valueField : undefined;
    edits = computeGenericWriteback(fullText, matchedEntry, newValue, doc, operators, valueField);
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
