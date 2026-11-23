// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { parseApdl } from "./parser/deck-parser.js";
import type { ApdlParsedDeck } from "./types.js";

export interface ApdlReferenceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Content predicate for ANSYS APDL scripts (`.apdl`, `.mac`, `.ans`, `.cdb`).
 */
export function canIndexApdl(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".apdl") || lower.endsWith(".mac") || lower.endsWith(".ans") || lower.endsWith(".cdb")) {
    return true;
  }
  if (text) {
    if (/^\s*\/(PREP7|SOLU|POST1|TITLE|UNITS)\b/im.test(text)) return true;
    if (/^\s*(ET|MP|SECTYPE|SECDATA|LMESH|ANTYPE)\s*,/im.test(text)) return true;
    if (/^\s*\*(SET|DIM|DO|ENDDO|IF|ENDIF|GET)\b/im.test(text)) return true;
  }
  return false;
}

/**
 * Declarative workspace indexer for ANSYS APDL documents.
 */
export function indexApdlDocument(ctx: DslIndexFileContext): void {
  const { text } = ctx;
  const addSym = (parentId: number | null, name: string, kind: string): number => {
    return ctx.addSymbol(
      name,
      kind,
      parentId,
      0,
      0,
      {},
      {
        ruleName: "apdl_entity",
        namePath: name,
      },
    );
  };

  try {
    const deck = parseApdl(text);
    ctx.setParsedModel(deck);

    const rootId = addSym(null, deck.title || "APDL Model", "model");
    const seenParams = new Set<string>();

    for (const stmt of deck.statements) {
      if (stmt.kind === "set" && !seenParams.has(stmt.name)) {
        seenParams.add(stmt.name);
        addSym(rootId, stmt.name, "parameter");
      } else if (stmt.kind === "dim" && !seenParams.has(stmt.name)) {
        seenParams.add(stmt.name);
        addSym(rootId, stmt.name, "array");
      } else if (stmt.kind === "command") {
        if (stmt.command === "ET" && stmt.args[0]) {
          addSym(rootId, `ET_${stmt.args[0]}_${stmt.args[1] ?? ""}`.replace(/_$/, ""), "element_type");
        } else if (stmt.command === "MP" && stmt.args[0] && stmt.args[1]) {
          addSym(rootId, `MAT_${stmt.args[1]}_${stmt.args[0]}`, "material");
        } else if (stmt.command === "SECTYPE" && stmt.args[0]) {
          addSym(rootId, `SEC_${stmt.args[0]}`, "section");
        }
      }
    }
  } catch {
    // Ignore parse failures during incremental editing
  }
}

export const apdlIndexing = {
  indexFile: indexApdlDocument,
  canIndex: canIndexApdl,
};

export function getApdlDeck(workspace: UnifiedWorkspace, uri: string): ApdlParsedDeck | undefined {
  return workspace.getParsedModel<ApdlParsedDeck>(uri);
}

export function findApdlDefinitions(
  workspace: UnifiedWorkspace,
  name: string,
  currentUri?: string,
): { uri: string; symbol: SymbolEntry }[] {
  const results: { uri: string; symbol: SymbolEntry }[] = [];
  const uris = workspace.listDocumentUris();
  const searchOrder: string[] = [];
  if (currentUri && uris.includes(currentUri)) {
    searchOrder.push(currentUri);
  }
  for (const u of uris) {
    if (u !== currentUri) searchOrder.push(u);
  }
  const upper = name.toUpperCase();
  for (const uri of searchOrder) {
    for (const symbol of workspace.findSymbolsByName(name, uri)) {
      results.push({ uri, symbol });
    }
    if (upper !== name) {
      for (const symbol of workspace.findSymbolsByName(upper, uri)) {
        results.push({ uri, symbol });
      }
    }
  }
  return results;
}

export function findApdlReferences(
  workspace: UnifiedWorkspace,
  name: string,
): { uri: string; range: ApdlReferenceSpan }[] {
  const results: { uri: string; range: ApdlReferenceSpan }[] = [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");

  for (const [uri, deck] of workspace.getAllParsedModels<ApdlParsedDeck>().entries()) {
    const lines = deck.rawText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      let match: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((match = re.exec(line)) !== null) {
        results.push({
          uri,
          range: {
            startLine: i,
            startCol: match.index,
            endLine: i,
            endCol: match.index + match[0].length,
          },
        });
      }
    }
  }
  return results;
}
