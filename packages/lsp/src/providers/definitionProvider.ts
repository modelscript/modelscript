// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection, Definition, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
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
  let tokStart = offset;
  while (tokStart > 0 && /[-a-zA-Z0-9_:#./]/.test(text[tokStart - 1]!)) tokStart--;
  let tokEnd = offset;
  while (tokEnd < text.length && /[-a-zA-Z0-9_:#./]/.test(text[tokEnd]!)) tokEnd++;
  const rawFullToken = text.slice(tokStart, tokEnd).trim();
  const fullToken = rawFullToken.replace(/^:+|:+$/g, "");

  // 3. Word token under cursor
  let wStart = offset;
  while (wStart > 0 && /[a-zA-Z0-9_]/.test(text[wStart - 1]!)) wStart--;
  let wEnd = offset;
  while (wEnd < text.length && /[a-zA-Z0-9_]/.test(text[wEnd]!)) wEnd++;
  const word = text.slice(wStart, wEnd).trim();

  // 4. Line text
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const nextLine = text.indexOf("\n", offset);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const lineText = text.slice(lineStart, lineEnd);

  // 5. AST Entry at offset
  const refEntry = (bridge as any)?.findEntryAtOffset?.(offset) || (bridge as any)?.findScopeAtOffset?.(offset);

  // 6. Line pattern matches
  const cadPartMatch =
    lineText.match(/CAD(?:Port)?\([^)]*?(?:feature|part)\s*=\s*"([^"]+)"/i) ||
    lineText.match(/__modelscript_cad\([^)]*?part\s*=\s*"([^"]+)"/i) ||
    lineText.match(/part\s*=\s*"([^"]+)"/i);
  const twinMatch = lineText.match(/(?:twin|counterpart|implements)\s*=\s*"([^"]+)"/i);
  const partTypeMatch = lineText.match(/part\s+[a-zA-Z0-9_]+\s*:\s*([a-zA-Z0-9_:]+)/);

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
  if (twinMatch?.[1]) candidates.push(twinMatch[1]);
  if (partTypeMatch?.[1]) candidates.push(partTypeMatch[1]);
  if (cadPartMatch?.[1]) candidates.push(cadPartMatch[1]);
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

  // Helper to escape regex special characters
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // A. Check candidates for STEP entity or CAD reference
  for (const cand of uniqueCandidates) {
    const stepEntityMatch = cand.match(/#(\d+)/);
    const uriFileMatch = cand.match(/(?:cad:\/\/|file:\/\/)?([^#]+\.(?:step|stp|p21))#(\d+)/i);
    const targetFile = uriFileMatch?.[1];
    const entityNum = uriFileMatch?.[2] ?? stepEntityMatch?.[1];

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

      for (const sDoc of sortedStepDocs) {
        if (sDoc.uri === document.uri) continue;
        const defRegex = new RegExp(`^#${entityNum}\\s*=`, "m");
        const match = defRegex.exec(sDoc.text);
        if (match) {
          const positions = new PositionIndex(sDoc.text);
          return {
            uri: sDoc.uri,
            range: positions.rangeFromOffsets(match.index, match.index + match[0].length),
          };
        }
      }
    }

    // Check CAD part name in STEP workspace index
    const stepWs = validationService?.workspaceManager?.stepWorkspaceIndex;
    if (stepWs && typeof stepWs.getFileIndex === "function") {
      const indices = stepWs.fileIndices;
      if (indices) {
        for (const sUri of indices.keys()) {
          const sIndex = stepWs.getFileIndex(sUri);
          if (sIndex?.byName?.has(cand)) {
            const symIds = sIndex.byName.get(cand);
            if (symIds && symIds.length > 0) {
              const sEntry = sIndex.symbols.get(symIds[0]);
              if (
                sEntry &&
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
    const escapedCand = escapeRegex(cand);
    for (const sDoc of stepDocs) {
      if (sDoc.uri === document.uri) continue;
      const prodRegex = new RegExp(`PRODUCT\\s*\\(\\s*'${escapedCand}'`, "i");
      const match = prodRegex.exec(sDoc.text);
      if (match) {
        const positions = new PositionIndex(sDoc.text);
        return {
          uri: sDoc.uri,
          range: positions.rangeFromOffsets(match.index, match.index + match[0].length),
        };
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
    const leaf = cand.split(/::|\./).pop() || cand;
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
      while (start > 0 && /[0-9#]/.test(text[start - 1])) start--;
      let end = offset;
      while (end < text.length && /[0-9]/.test(text[end])) end++;

      const token = text.slice(start, end);
      let localDefMatch: RegExpExecArray | null = null;
      if (/^#\d+$/.test(token)) {
        const defRegex = new RegExp(`^${token.replace("#", "\\#")}\\s*=`, "m");
        localDefMatch = defRegex.exec(text);
        if (localDefMatch) {
          const isAtDefinition =
            offset >= localDefMatch.index && offset <= localDefMatch.index + localDefMatch[0].length;
          if (!isAtDefinition) {
            return {
              uri: document.uri,
              range: {
                start: document.positionAt(localDefMatch.index),
                end: document.positionAt(localDefMatch.index + localDefMatch[0].length),
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

      if (localDefMatch) {
        return {
          uri: document.uri,
          range: {
            start: document.positionAt(localDefMatch.index),
            end: document.positionAt(localDefMatch.index + localDefMatch[0].length),
          },
        };
      }

      return null;
    }

    // ── Standard polyglot go-to-definition ──
    const bridge = documentLSPBridges.get(params.textDocument.uri);

    const docText = document.getText();
    let tokStart = offset;
    while (tokStart > 0 && /[-a-zA-Z0-9_:#./]/.test(docText[tokStart - 1]!)) tokStart--;
    let tokEnd = offset;
    while (tokEnd < docText.length && /[-a-zA-Z0-9_:#./]/.test(docText[tokEnd]!)) tokEnd++;
    const rawFullToken = docText.slice(tokStart, tokEnd).trim();
    const fullToken = rawFullToken.replace(/^:+|:+$/g, "");

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

    if (!bridge) {
      const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
      if (plugin) {
        if (plugin.customHandlers?.definition) {
          return plugin.customHandlers.definition(offset, document.getText());
        }
        if (plugin.facade?.getDefinition) {
          try {
            const def = plugin.facade.getDefinition(0, offset);
            if (def) {
              const start = def.startByte ?? def.startIndex ?? 0;
              const end = def.endByte ?? def.endIndex ?? start;
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
