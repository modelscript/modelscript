// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit } from "@modelscript/dsl";
import { Range, TextEdit, type WorkspaceEdit } from "vscode-languageserver";
import type { LspContext } from "../LspContext.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName } from "../utils/hierarchyUtils.js";

export interface ComputeWritebackEditParams {
  target: string;
  newValue: string;
  documentUri?: string;
}

export interface ComputeWritebackEditResult {
  success: boolean;
  workspaceEdit?: WorkspaceEdit;
  error?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
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
): TextEdit[] {
  // Tier 1: Check precomputed CST fieldRanges from AST indexing
  if (entry.fieldRanges) {
    const valField = entry.fieldRanges.value ?? entry.fieldRanges.expression ?? entry.fieldRanges.val;
    if (valField && valField.endByte > valField.startByte) {
      const startPos = doc ? doc.positionAt(valField.startByte) : offsetToPosition(fullText, valField.startByte);
      const endPos = doc ? doc.positionAt(valField.endByte) : offsetToPosition(fullText, valField.endByte);
      return [TextEdit.replace(Range.create(startPos, endPos), newValue.trim())];
    }
  }

  // Tier 2: Universal assignment locator within [startByte, endByte]
  if (entry.startByte != null && entry.endByte != null && entry.endByte > entry.startByte) {
    const declText = fullText.substring(entry.startByte, entry.endByte);
    const opPattern = operators.map(escapeRegex).join("|");
    const regex = new RegExp(`(${opPattern})\\s*([^;}\\r\\n,]+)`);
    const match = declText.match(regex);
    if (match && match.index !== undefined) {
      const rawVal = match[2].trimEnd();
      const valOffsetInDecl = match.index + declText.substring(match.index).indexOf(rawVal);
      const valStartByte = entry.startByte + valOffsetInDecl;
      const valEndByte = valStartByte + rawVal.length;

      const startPos = doc ? doc.positionAt(valStartByte) : offsetToPosition(fullText, valStartByte);
      const endPos = doc ? doc.positionAt(valEndByte) : offsetToPosition(fullText, valEndByte);
      return [TextEdit.replace(Range.create(startPos, endPos), newValue.trim())];
    }
  }

  // Tier 3: Universal assignment locator by identifier name within the source
  const name = entry.name;
  if (name) {
    const opPattern = operators.map(escapeRegex).join("|");
    const regex = new RegExp(`(\\b${escapeRegex(name)}\\s*(?:${opPattern})\\s*)([^;}\\r\\n,]+)`);
    const match = fullText.match(regex);
    if (match && match.index !== undefined) {
      const valStart = match.index + match[1].length;
      const valEnd = valStart + match[2].trimEnd().length;
      const startPos = doc ? doc.positionAt(valStart) : offsetToPosition(fullText, valStart);
      const endPos = doc ? doc.positionAt(valEnd) : offsetToPosition(fullText, valEnd);
      return [TextEdit.replace(Range.create(startPos, endPos), newValue.trim())];
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

  const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
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
      edits = rawEdits.map((e) => {
        const startPos = doc ? doc.positionAt(e.startByte) : offsetToPosition(fullText, e.startByte);
        const endPos = doc ? doc.positionAt(e.endByte) : offsetToPosition(fullText, e.endByte);
        return TextEdit.replace(Range.create(startPos, endPos), e.newText);
      });
    }
  }

  // If no custom handler or handler returned nothing, fallback to universal generic strategy
  if (edits.length === 0) {
    const operators =
      typeof writebackDef === "object" && writebackDef?.operators ? writebackDef.operators : [":=", "="];
    edits = computeGenericWriteback(fullText, matchedEntry, newValue, doc, operators);
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
