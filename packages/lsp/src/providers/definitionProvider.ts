// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPscadDefinitionLocation } from "@modelscript/pscad";
import { scanStepEntities, splitStepArgs } from "@modelscript/step";
import { Connection, Definition, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import {
  extractCrossDomainLineHints,
  extractLeafSymbolName,
  extractQualifiedTokenAtOffset,
  extractWordAtOffset,
  isDigitCode,
  parseStepReferenceToken,
} from "../utils/lexical-utils.js";
import { symbolEntryToLocation } from "../utils/lsp-utils.js";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

function isPscadDocument(document: TextDocument): boolean {
  return document.languageId === "pscad" || /\.(pscx|pslx|pswx|psmx)$/i.test(document.uri);
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
  if (lineHints.partType) candidates.push(lineHints.partType);
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

  // Query engine resolution
  const qe =
    (bridge as any)?.engine ??
    (bridge as any)?.getQueryEngine?.() ??
    validationService?.workspaceManager?.getQueryEngine?.("modelica") ??
    validationService?.workspaceManager?.getQueryEngine?.("sysml2") ??
    validationService?.workspaceManager?.queryEngine ??
    globalLanguageRegistry.getAllPlugins().find((p: any) => p.queryEngine)?.queryEngine;

  // A. Check candidates for STEP entity or CAD reference
  for (const cand of uniqueCandidates) {
    const stepRef = parseStepReferenceToken(cand);
    const targetFile = stepRef?.targetFile;
    const entityNum = stepRef?.entityNum;

    if (entityNum) {
      const stepDocs: { uri: string; text: string }[] = [];
      if (documents) {
        for (const d of documents.all()) {
          if (isStepDocument(d)) {
            stepDocs.push({ uri: d.uri, text: d.getText() });
          }
        }
      }
      for (const [tUri, tTree] of documentTrees.entries()) {
        if (/\.(step|stp|p21)$/i.test(tUri) && tTree?.text) {
          stepDocs.push({ uri: tUri, text: tTree.text });
        }
      }

      // Prioritize document matching target filename if provided
      const sortedStepDocs = targetFile
        ? [...stepDocs].sort((a, b) => (b.uri.includes(targetFile) ? 1 : 0) - (a.uri.includes(targetFile) ? 1 : 0))
        : stepDocs;

      const wantedId = `#${entityNum}`;
      for (const sDoc of sortedStepDocs) {
        if (sDoc.uri === document.uri) continue;
        const entity = scanStepEntities(sDoc.text).find((e) => e.id === wantedId);
        if (entity) {
          const eqIdx = sDoc.text.indexOf("=", entity.startOffset);
          const defEnd = eqIdx !== -1 ? eqIdx + 1 : entity.startOffset + wantedId.length;
          const positions = new PositionIndex(sDoc.text);
          return {
            uri: sDoc.uri,
            range: positions.rangeFromOffsets(entity.startOffset, defEnd),
          };
        }
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
    const stepDocs: { uri: string; text: string }[] = [];
    if (documents) {
      for (const d of documents.all()) {
        if (isStepDocument(d)) {
          stepDocs.push({ uri: d.uri, text: d.getText() });
        }
      }
    }
    for (const [tUri, tTree] of documentTrees.entries()) {
      if (/\.(step|stp|p21)$/i.test(tUri) && tTree?.text) {
        stepDocs.push({ uri: tUri, text: tTree.text });
      }
    }
    const candLower = cand.toLowerCase();
    for (const sDoc of stepDocs) {
      if (sDoc.uri === document.uri) continue;
      for (const entity of scanStepEntities(sDoc.text)) {
        if (entity.type.toUpperCase() !== "PRODUCT") continue;
        const firstArg = splitStepArgs(entity.args)[0]?.trim();
        if (!firstArg || !firstArg.startsWith("'") || !firstArg.endsWith("'")) continue;
        const productName = firstArg.slice(1, -1).replaceAll("''", "'");
        if (productName.toLowerCase() === candLower) {
          const quoteEnd = sDoc.text.indexOf(firstArg, entity.startOffset);
          const spanEnd = quoteEnd !== -1 ? quoteEnd + firstArg.length : entity.endOffset;
          const prodOffset = sDoc.text.toUpperCase().indexOf("PRODUCT", entity.startOffset);
          const spanStart = prodOffset !== -1 ? prodOffset : entity.startOffset;
          const positions = new PositionIndex(sDoc.text);
          return {
            uri: sDoc.uri,
            range: positions.rangeFromOffsets(spanStart, spanEnd),
          };
        }
      }
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
          cand === lineHints.partType ||
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

  // C. Search across workspace indices for candidate matches
  const workspaceIndices: any[] = [];
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

  for (const cand of uniqueCandidates) {
    const leaf = extractLeafSymbolName(cand);
    for (const idx of workspaceIndices) {
      const candidatesInIdx = idx.byName?.get(leaf) || idx.byName?.get(cand) || [];
      for (const id of candidatesInIdx) {
        const sym = idx.symbols?.get(id);
        if (sym && sym.resourceId && sym.resourceId !== document.uri) {
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

    // ── STEP-specific go-to-definition ──
    if (isStepDocument(document)) {
      const text = document.getText();
      let start = offset;
      while (start > 0 && isDigitCode(text.charCodeAt(start - 1))) start--;
      if (start > 0 && text[start - 1] === "#") start--;
      let end = offset;
      if (text[end] === "#") end++;
      while (end < text.length && isDigitCode(text.charCodeAt(end))) end++;

      const token = text.slice(start, end);
      let localDefSpan: { start: number; end: number } | null = null;
      if (token.startsWith("#") && token.length > 1) {
        const entity = scanStepEntities(text).find((e) => e.id === token);
        if (entity) {
          const eqIdx = text.indexOf("=", entity.startOffset);
          const defEnd = eqIdx !== -1 ? eqIdx + 1 : entity.startOffset + token.length;
          localDefSpan = { start: entity.startOffset, end: defEnd };
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

    // ── PSCAD-specific go-to-definition (.pscx / .pslx) ──
    if (isPscadDocument(document)) {
      const pscadDocs: Array<{ uri: string; text: string }> = [];
      for (const d of documents.all()) {
        if (isPscadDocument(d)) {
          pscadDocs.push({ uri: d.uri, text: d.getText() });
        }
      }
      for (const [tUri, tTree] of documentTrees.entries()) {
        if (/\.(pscx|pslx|pswx|psmx)$/i.test(tUri) && tTree?.text && !pscadDocs.some((d) => d.uri === tUri)) {
          pscadDocs.push({ uri: tUri, text: tTree.text });
        }
      }
      const pscadLoc = getPscadDefinitionLocation(document.getText(), offset, document.uri, pscadDocs);
      if (pscadLoc) return pscadLoc as Definition;
    }

    // ── Standard polyglot go-to-definition ──
    const bridge = documentLSPBridges.get(params.textDocument.uri);

    const docText = document.getText();
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
