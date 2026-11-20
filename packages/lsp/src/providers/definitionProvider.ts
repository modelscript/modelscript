// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  findStepEntityDefSpanInDocuments,
  findStepLocalEntityDefSpan,
  findStepProductDefSpanInDocuments,
} from "@modelscript/step";
import { Connection, Definition, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import {
  extractCrossDomainLineHints,
  extractLeafSymbolName,
  extractQualifiedTokenAtOffset,
  extractWordAtOffset,
  parseStepReferenceToken,
} from "../utils/lexical-utils.js";
import { symbolEntryToLocation } from "../utils/lsp-utils.js";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

/**
 * Resolves definitions across language domains (e.g. Modelica -> SysML2 -> STEP CAD).
 */
export function findCrossLanguageDefinition(
  document: TextDocument,
  offset: number,
  bridge: LSPBridge | undefined,
  validationService: any | undefined,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
  documents?: TextDocuments<TextDocument>,
): Definition | null {
  const text = document.getText();
  if (!text) return null;

  // 1. Quoted string under or immediately adjacent to cursor
  let qStart = offset;
  while (qStart > 0 && text[qStart - 1] !== '"' && text[qStart - 1] !== "'" && text[qStart - 1] !== "\n") qStart--;
  let qEnd = offset;
  while (qEnd < text.length && text[qEnd] !== '"' && text[qEnd] !== "'" && text[qEnd] !== "\n") qEnd++;
  let quotedToken: string | null = null;
  if (
    qStart > 0 &&
    qEnd < text.length &&
    (text[qStart - 1] === '"' || text[qStart - 1] === "'") &&
    text[qEnd] === text[qStart - 1]
  ) {
    quotedToken = text.slice(qStart, qEnd).trim();
  }

  // 2. Scoped / Qualified token under cursor: e.g. SysML2::Propulsion::Motor or Propulsion::Motor or cad://...
  const { token: fullToken } = extractQualifiedTokenAtOffset(text, offset, true);

  // 3. Word token under cursor
  const { token: word } = extractWordAtOffset(text, offset);

  // 4. Line text
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const nextLine = text.indexOf("\n", offset);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const lineText = text.slice(lineStart, lineEnd);

  // 5. AST Entry at offset
  const refEntry = (bridge as any)?.findEntryAtOffset?.(offset) || (bridge as any)?.findScopeAtOffset?.(offset);

  // 6. Structured line hints (CAD(...), twin="...", part x : Type)
  const lineHints = extractCrossDomainLineHints(lineText);

  // Candidate identifiers to resolve across languages
  const candidates: string[] = [];
  if (quotedToken) candidates.push(quotedToken);
  if (fullToken && (fullToken.includes("::") || fullToken.includes("#") || fullToken.includes("//"))) {
    candidates.push(fullToken);
  }
  if (refEntry?.metadata?.twin) candidates.push(String(refEntry.metadata.twin));
  if (refEntry?.metadata?.counterpart) candidates.push(String(refEntry.metadata.counterpart));
  if (refEntry?.metadata?.implements) candidates.push(String(refEntry.metadata.implements));
  if (refEntry?.metadata?.cadBinding) candidates.push(String(refEntry.metadata.cadBinding));
  if (refEntry?.metadata?.typeSpecifier) candidates.push(String(refEntry.metadata.typeSpecifier));
  if (lineHints.twin) candidates.push(lineHints.twin);
  if (lineHints.cadAnyPart) candidates.push(lineHints.cadAnyPart);
  if (word && word !== refEntry?.name) candidates.push(word);
  if (fullToken) candidates.push(fullToken);
  if (word) candidates.push(word);

  const seenCand = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    if (!c || seenCand.has(c)) return false;
    seenCand.add(c);
    return true;
  });

  // 0. Direct TGG / Hypergraph counterpart resolution via LSPBridge
  if (typeof bridge?.counterpartDefinitionsRaw === "function" && !quotedToken && !fullToken.includes("::")) {
    try {
      const counterparts = bridge.counterpartDefinitionsRaw(offset);
      if (Array.isArray(counterparts) && counterparts.length > 0) {
        for (const cp of counterparts) {
          const loc = symbolEntryToLocation(cp, documentLSPBridges, documentTrees, documents);
          if (loc) return loc;
        }
      }
    } catch {}
  }

  // Query engine resolution
  const qe =
    (bridge as any)?.engine ??
    (bridge as any)?.getQueryEngine?.() ??
    validationService?.workspaceManager?.getQueryEngine?.("modelica") ??
    validationService?.workspaceManager?.getQueryEngine?.("sysml2") ??
    validationService?.workspaceManager?.queryEngine ??
    globalLanguageRegistry.getAllPlugins().find((p: any) => p.queryEngine)?.queryEngine;

  const collectStepDocs = (): { uri: string; text: string }[] => {
    const out: { uri: string; text: string }[] = [];
    if (documents) {
      for (const d of documents.all()) {
        if (isStepDocument(d)) out.push({ uri: d.uri, text: d.getText() });
      }
    }
    for (const [tUri, tTree] of documentTrees.entries()) {
      if (/\.(step|stp|p21)$/i.test(tUri) && tTree?.text) out.push({ uri: tUri, text: tTree.text });
    }
    return out;
  };

  // A. Check candidates for STEP entity or CAD reference
  for (const cand of uniqueCandidates) {
    const stepRef = parseStepReferenceToken(cand);
    const targetFile = stepRef?.targetFile;
    const entityNum = stepRef?.entityNum;

    if (entityNum) {
      const hit = findStepEntityDefSpanInDocuments(collectStepDocs(), document.uri, entityNum, targetFile);
      if (hit) {
        return {
          uri: hit.uri,
          range: new PositionIndex(hit.text).rangeFromOffsets(hit.startOffset, hit.endOffset),
        };
      }
    }

    // Check CAD part name in UnifiedWorkspace (STEP symbols)
    const uIndex = validationService?.workspaceManager?.unifiedWorkspace?.getIndex?.();
    if (uIndex?.byName?.has(cand)) {
      const symIds = uIndex.byName.get(cand);
      if (symIds && symIds.length > 0) {
        for (const symId of symIds) {
          const sEntry = uIndex.symbols.get(symId);
          if (
            sEntry &&
            sEntry.resourceId &&
            sEntry.resourceId !== document.uri &&
            (/\.(step|stp|p21)$/i.test(sEntry.resourceId) ||
              sEntry.kind === "Product" ||
              sEntry.ruleName?.includes("step"))
          ) {
            const loc = symbolEntryToLocation(sEntry, documentLSPBridges, documentTrees, documents);
            if (loc) return loc as any;
          }
        }
      }
    }

    // Fallback: search open STEP documents directly for CAD Product/Shape name definition
    const prodHit = findStepProductDefSpanInDocuments(collectStepDocs(), document.uri, cand);
    if (prodHit) {
      return {
        uri: prodHit.uri,
        range: new PositionIndex(prodHit.text).rangeFromOffsets(prodHit.startOffset, prodHit.endOffset),
      };
    }
  }

  // B. Salsa QueryEngine polyglot resolution
  if (qe) {
    // 1. Check crossDomainBinding on current symbol if indexed
    if (refEntry?.id !== undefined && typeof qe.crossDomainBinding === "function") {
      try {
        const boundIds = qe.crossDomainBinding(refEntry.id);
        for (const bid of boundIds) {
          const bEntry = typeof qe.resolveEntry === "function" ? qe.resolveEntry(bid) : qe.symbol?.(bid);
          if (bEntry && bEntry.resourceId && bEntry.resourceId !== document.uri) {
            const loc = symbolEntryToLocation(bEntry, documentLSPBridges, documentTrees, documents);
            if (loc) return loc as any;
          }
        }
      } catch {}
    }

    // 2. Resolve candidates via Salsa resolvePolyglotSymbol
    if (typeof qe.resolvePolyglotSymbol === "function") {
      for (const cand of uniqueCandidates) {
        const isQualified =
          cand.includes("::") ||
          cand.includes("//") ||
          cand.includes("#") ||
          (cand.includes(".") && !cand.startsWith("."));
        const isExplicitMeta =
          cand === refEntry?.metadata?.twin ||
          cand === refEntry?.metadata?.counterpart ||
          cand === refEntry?.metadata?.implements ||
          cand === refEntry?.metadata?.cadBinding ||
          cand === lineHints.twin ||
          cand === lineHints.cadAnyPart;
        if (!isQualified && !isExplicitMeta) continue;
        try {
          const symId = qe.resolvePolyglotSymbol(cand);
          if (symId !== null && symId !== undefined) {
            const targetEntry = typeof qe.resolveEntry === "function" ? qe.resolveEntry(symId) : qe.symbol?.(symId);
            if (targetEntry && targetEntry.resourceId && targetEntry.resourceId !== document.uri) {
              const loc = symbolEntryToLocation(targetEntry, documentLSPBridges, documentTrees, documents);
              if (loc) return loc as any;
            }
          }
        } catch {}
      }
    }
  }

  // C. Search across workspace indices for candidate matches (validated against TggSymbolProjectionTable when available)
  const workspaceIndices: any[] = [];
  const uWorkspace = validationService?.workspaceManager?.unifiedWorkspace;
  const uIdx = uWorkspace?.getIndex?.();
  if (uIdx && !workspaceIndices.includes(uIdx)) {
    workspaceIndices.push(uIdx);
  }
  if (validationService?.workspaceManager?.allWorkspaceIndices) {
    for (const idx of validationService.workspaceManager.allWorkspaceIndices.values()) {
      if (idx && !workspaceIndices.includes(idx)) workspaceIndices.push(idx);
    }
  }
  for (const plugin of globalLanguageRegistry.getAllPlugins()) {
    if (plugin.workspaceIndex && !workspaceIndices.includes(plugin.workspaceIndex)) {
      workspaceIndices.push(plugin.workspaceIndex);
    }
  }

  const docPluginId = globalLanguageRegistry.getPluginForUri(document.uri, text)?.id ?? document.languageId ?? "";
  const projTable = uWorkspace?.tggProjectionTable ?? uIdx?.tggProjectionTable;
  const hasProjRules = typeof projTable?.getAllRules === "function" && projTable.getAllRules().length > 0;

  for (const cand of uniqueCandidates) {
    const isExplicitHint =
      cand === refEntry?.metadata?.twin ||
      cand === refEntry?.metadata?.counterpart ||
      cand === refEntry?.metadata?.implements ||
      cand === refEntry?.metadata?.cadBinding ||
      cand === lineHints.twin ||
      cand === lineHints.cadAnyPart ||
      cand.includes("::") ||
      cand.includes("//");
    const leaf = extractLeafSymbolName(cand);
    for (const idx of workspaceIndices) {
      const candidatesInIdx = idx.byName?.get(leaf) || idx.byName?.get(cand) || [];
      for (const id of candidatesInIdx) {
        const sym = idx.symbols?.get(id);
        if (sym && sym.resourceId && sym.resourceId !== document.uri && sym.kind !== "Reference") {
          if (
            !isExplicitHint &&
            hasProjRules &&
            docPluginId &&
            sym.language &&
            sym.language.toLowerCase() !== docPluginId.toLowerCase()
          ) {
            if (!projTable.canResolveAs(docPluginId, sym)) continue;
          }
          const loc = symbolEntryToLocation(sym, documentLSPBridges, documentTrees, documents);
          if (loc) return loc as any;
        }
      }
    }
  }

  // D. Digital Thread Hypergraph resolution
  if (validationService?.workspaceManager?.getThreadsForUri) {
    try {
      const threads = validationService.workspaceManager.getThreadsForUri(document.uri);
      if (threads && threads.length > 0) {
        for (const t of threads) {
          if (refEntry?.id !== undefined && t.nodeId !== refEntry.id && t.meta?.name !== word) {
            continue;
          }
          const aligned = validationService.workspaceManager.findAlignedElementsBySlot(t.slot);
          for (const elem of aligned) {
            if (elem.uri && elem.uri !== document.uri) {
              const l = Math.max(0, (elem.line ?? 1) - 1);
              const c = Math.max(0, (elem.column ?? 1) - 1);
              const len = elem.name?.length || 1;
              return {
                uri: elem.uri,
                range: {
                  start: { line: l, character: c },
                  end: { line: l, character: c + len },
                },
              };
            }
          }
        }
      }
    } catch {}
  }

  return null;
}

export function registerDefinitionProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
  validationService?: any,
) {
  connection.onDefinition((params): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const offset = document.offsetAt(params.position);
    const docText = document.getText();
    const activePlugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, docText);

    // ── STEP-specific go-to-definition (plugin handler first, then fast-path fallback) ──
    if (isStepDocument(document)) {
      if (activePlugin?.customHandlers?.definition) {
        const stepCustom = activePlugin.customHandlers.definition(offset, docText, document.uri);
        if (stepCustom) return stepCustom;
      }
      const localDefSpan = findStepLocalEntityDefSpan(docText, offset);
      if (localDefSpan) {
        const isAtDefinition = offset >= localDefSpan.start && offset <= localDefSpan.end;
        if (!isAtDefinition) {
          return {
            uri: document.uri,
            range: {
              start: document.positionAt(localDefSpan.start),
              end: document.positionAt(localDefSpan.end),
            },
          };
        }
      }

      // Check cross-language target (e.g. STEP -> Modelica/SysML via Digital Thread)
      const crossLoc = findCrossLanguageDefinition(
        document,
        offset,
        undefined,
        validationService,
        documentLSPBridges,
        documentTrees,
        documents,
      );
      if (crossLoc) return crossLoc;

      if (localDefSpan) {
        return {
          uri: document.uri,
          range: {
            start: document.positionAt(localDefSpan.start),
            end: document.positionAt(localDefSpan.end),
          },
        };
      }

      return null;
    }

    // ── Language-plugin custom go-to-definition (PSCAD, PSS/E, STEP, etc.) ──
    if (activePlugin?.customHandlers?.definition) {
      const customDef = activePlugin.customHandlers.definition(offset, docText, document.uri);
      if (customDef) return customDef as Definition;
    }

    // ── Standard polyglot go-to-definition ──
    const bridge = documentLSPBridges.get(params.textDocument.uri);

    const { token: fullToken } = extractQualifiedTokenAtOffset(docText, offset, true);

    // If clicking on a qualified path (e.g. Propulsion::Motor) or URI, resolve the specific target first
    if (fullToken.includes("::") || fullToken.includes("#") || fullToken.includes("//")) {
      const crossLoc = findCrossLanguageDefinition(
        document,
        offset,
        bridge,
        validationService,
        documentLSPBridges,
        documentTrees,
        documents,
      );
      if (crossLoc) return crossLoc as any;
    }

    const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, docText);
    if (plugin?.customHandlers?.definition) {
      const customDef = plugin.customHandlers.definition(offset, docText, params.textDocument.uri);
      if (customDef) return customDef;
    }

    if (!bridge) {
      if (plugin) {
        if (plugin.facade?.getDefinition) {
          try {
            const def = plugin.facade.getDefinition(0, offset);
            if (def) {
              const start = def.startOffset ?? def.startIndex ?? 0;
              const end = def.endOffset ?? def.endIndex ?? start;
              return {
                uri: document.uri,
                range: {
                  start: document.positionAt(start),
                  end: document.positionAt(end),
                },
              };
            }
          } catch {}
        }
      }

      // Check cross-language target even without bridge
      const crossLoc = findCrossLanguageDefinition(
        document,
        offset,
        undefined,
        validationService,
        documentLSPBridges,
        documentTrees,
        documents,
      );
      if (crossLoc) return crossLoc;

      return null;
    }

    const rawTarget = (bridge as any).definitionRaw(offset, document.getText());
    if (rawTarget) {
      const refEntry = (bridge as any).findEntryAtOffset(offset);
      const isSelfDeclaration = refEntry && rawTarget.id === refEntry.id && rawTarget.resourceId === document.uri;

      // If rawTarget points to a different symbol or external file, it's a genuine local jump
      if (!isSelfDeclaration) {
        const loc = symbolEntryToLocation(rawTarget, documentLSPBridges, documentTrees, documents);
        if (loc) return loc as any;
      }
    }

    // Cross-language jump fallback (e.g. Modelica component implementing SysML2 part usage)
    const crossLoc = findCrossLanguageDefinition(
      document,
      offset,
      bridge,
      validationService,
      documentLSPBridges,
      documentTrees,
      documents,
    );
    if (crossLoc) return crossLoc as any;

    if (rawTarget) {
      return symbolEntryToLocation(rawTarget, documentLSPBridges, documentTrees, documents) as any;
    }

    return null;
  });

  /* Go to Type Definition — jumps to the class definition of a component's type */
  connection.onTypeDefinition((params): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!document) return null;

    const offset = document.offsetAt(params.position);
    if (bridge) {
      const typeTarget = (bridge as any).typeDefinitionRaw(offset, document.getText());
      if (typeTarget) {
        const loc = symbolEntryToLocation(typeTarget, documentLSPBridges, documentTrees, documents);
        if (loc) return loc as any;
      }
    }

    const crossLoc = findCrossLanguageDefinition(
      document,
      offset,
      bridge,
      validationService,
      documentLSPBridges,
      documentTrees,
      documents,
    );
    if (crossLoc) return crossLoc as any;

    return null;
  });
}
