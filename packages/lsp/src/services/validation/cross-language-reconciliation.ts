// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type ModelicaReconcileView,
  reconcileModelicaCstDiagnostics,
  resolveModelicaTypeInWorkspace,
  resolveModelicaVariableInWorkspace,
} from "@modelscript/modelica";
import {
  type CorrespondenceDiagnostic,
  extractCrossLanguageLinks,
  isTypeLikeSymbol,
  PolyglotTransformer,
  splitQualifiedPath,
  type SymbolEntry,
  symbolEntryToPolyglotNode,
  type SymbolIndex,
  type SyntaxNode,
} from "@modelscript/runtime";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { LanguagePlugin } from "../../registry/LanguageRegistry.js";
import { extractCanonicalErrorInfo } from "../diagnostic-dedup.js";
import type { DocumentManager } from "../document-manager.js";
import { resolveCstNameSpan, type WorkspaceManager } from "../workspace-manager.js";
import {
  collectCstNodesByTypes,
  extractDigitsOnly,
  extractLeadingNumericAfterEquals,
  extractParameterRealLine,
  hasConnectCallPrefix,
  isChainTokenChar,
  type PolyglotTreeLike,
  splitLinesPreserve,
  stripLeadingKeywordPrefixes,
  type ValidationQueryEngine,
} from "./text-helpers.js";

/**
 * Reconciles single-file WASM CST lint diagnostics (`M2002`/`M2003`) against the multi-file,
 * cross-language `UnifiedWorkspace` and Salsa `QueryEngine` so resolved imported or foreign types,
 * ports, and variables never produce false single-file errors while genuine unresolved errors remain.
 */
export function reconcileCrossLanguageWasmDiagnosticsImpl(
  wasmDiags: Diagnostic[],
  unifiedIndex: SymbolIndex,
  engine: ValidationQueryEngine | null | undefined,
  engineDiags: Array<{
    code?: string | number | undefined;
    startOffset?: number | undefined;
    endOffset?: number | undefined;
  }> | null,
  effectiveUri: string,
  langId: string,
  text: string,
  textDocument?: TextDocument,
  plugin?: LanguagePlugin,
): Diagnostic[] {
  if (!wasmDiags.length || !unifiedIndex?.symbols) return wasmDiags;

  const normLang = langId.toLowerCase();
  const normUri = (u: string) =>
    (u.startsWith("modelscript-lib://global") ? "file://" + u.substring("modelscript-lib://global".length) : u).replace(
      /^([a-z0-9+-]+):\/{0,3}/i,
      "$1:///",
    );
  const targetNorm = normUri(effectiveUri);

  const docIds: number[] =
    unifiedIndex.symbolsByResource?.get(effectiveUri) ?? unifiedIndex.symbolsByResource?.get(targetNorm) ?? [];
  const docSymbols: SymbolEntry[] = docIds
    .map((id) => unifiedIndex.symbols.get(id))
    .filter((s): s is SymbolEntry => Boolean(s));

  const importedPrefixes: string[][] = [];
  const importedLeafMap = new Map<string, string[]>();
  for (const sym of docSymbols) {
    if (sym.kind !== "Import" || !sym.name) continue;
    const rawImp = String(sym.name).trim();
    if (rawImp.endsWith(".*") || rawImp.endsWith("::*")) {
      const pkgPath = rawImp.endsWith("::*") ? rawImp.slice(0, -3) : rawImp.slice(0, -2);
      const parts = splitQualifiedPath(pkgPath);
      if (parts.length > 0) importedPrefixes.push(parts);
    } else {
      const parts = splitQualifiedPath(rawImp);
      if (parts.length > 0) importedLeafMap.set(parts[parts.length - 1]!, parts);
    }
  }

  const resolvePathInUnified = (parts: string[]): SymbolEntry | undefined => {
    if (parts.length === 0) return undefined;
    const isExternalMatch = (cand: SymbolEntry | undefined): boolean => {
      if (!cand) return false;
      const candLang = (cand.language ?? "").toLowerCase();
      if (candLang && candLang !== normLang) return true;
      return Boolean(cand.resourceId && normUri(cand.resourceId) !== targetNorm);
    };

    const walkChildren = (root: SymbolEntry, rest: string[]): SymbolEntry | undefined => {
      let curr: SymbolEntry | undefined = root;
      for (const seg of rest) {
        if (!curr) return undefined;
        const childIds: number[] = unifiedIndex.childrenOf?.get(curr.id) ?? [];
        let next: SymbolEntry | undefined;
        for (const cid of childIds) {
          const c = unifiedIndex.symbols.get(cid);
          if (c && c.name === seg && c.kind !== "Import" && c.kind !== "Extends") {
            next = c;
            break;
          }
        }
        if (!next) {
          for (const cid of childIds) {
            const c = unifiedIndex.symbols.get(cid);
            if (c?.kind === "Extends" && c.name) {
              const base = resolvePathInUnified(splitQualifiedPath(c.name));
              if (base) {
                const foundInBase = walkChildren(base, [seg]);
                if (foundInBase) {
                  next = foundInBase;
                  break;
                }
              }
            }
          }
        }
        curr = next;
      }
      return curr;
    };

    const roots: SymbolEntry[] = (unifiedIndex.byName?.get(parts[0]!) ?? [])
      .map((id: number) => unifiedIndex.symbols.get(id))
      .filter((s): s is SymbolEntry => Boolean(s && s.kind !== "Import" && s.kind !== "Extends"));
    for (const r of roots) {
      const hit = parts.length === 1 ? r : walkChildren(r, parts.slice(1));
      if (hit && isExternalMatch(hit)) return hit;
    }

    const leaf = parts[parts.length - 1]!;
    const candidates: SymbolEntry[] = (unifiedIndex.byName?.get(leaf) ?? [])
      .map((id: number) => unifiedIndex.symbols.get(id))
      .filter((s): s is SymbolEntry => Boolean(s && isExternalMatch(s)));
    const expected = parts.join(".").toLowerCase();
    for (const c of candidates) {
      if (parts.length === 1) return c;
      const np = (c.namePath ?? c.name).replaceAll("::", ".").toLowerCase();
      if (np === expected || np.endsWith(`.${expected}`)) return c;
    }
    return undefined;
  };

  const resolveImportedOrQualifiedChain = (chain: string): boolean => {
    const parts = splitQualifiedPath(chain);
    if (parts.length === 0) return false;
    if (resolvePathInUnified(parts)) return true;
    const aliased = importedLeafMap.get(parts[0]!);
    if (aliased && resolvePathInUnified([...aliased, ...parts.slice(1)])) return true;
    for (const pref of importedPrefixes) {
      if (resolvePathInUnified([...pref, ...parts])) return true;
    }
    return false;
  };

  const computeOffset = (pos: { line: number; character: number }): number => {
    if (textDocument && typeof textDocument.offsetAt === "function") {
      return textDocument.offsetAt(pos);
    }
    let line = 0;
    let i = 0;
    while (i < text.length && line < pos.line) {
      if (text.charCodeAt(i) === 10) line++;
      i++;
    }
    return Math.min(text.length, i + pos.character);
  };

  const extractChainAround = (startOff: number, endOff: number): string => {
    let l = startOff;
    let r = endOff;
    while (l > 0 && isChainTokenChar(text[l - 1]!)) l--;
    while (r < text.length && isChainTokenChar(text[r]!)) r++;
    let s = l;
    let e = r;
    while (s < e && (text[s] === ":" || text[s] === ".")) s++;
    while (e > s && (text[e - 1] === ":" || text[e - 1] === ".")) e--;
    return text.slice(s, e);
  };

  const resolveMemberViaComponentType = (offset: number, fullChain: string): boolean => {
    const parts = splitQualifiedPath(fullChain);
    if (parts.length < 2) return resolveImportedOrQualifiedChain(fullChain);

    let enclosingClass: SymbolEntry | undefined;
    for (const s of docSymbols) {
      if (s.startOffset <= offset && s.endOffset >= offset && isTypeLikeSymbol(s)) {
        if (!enclosingClass || s.endOffset - s.startOffset < enclosingClass.endOffset - enclosingClass.startOffset) {
          enclosingClass = s;
        }
      }
    }
    if (enclosingClass && engine && typeof engine.query === "function") {
      const compIds: number[] = unifiedIndex.childrenOf?.get(enclosingClass.id) ?? [];
      const comp = compIds.map((cid) => unifiedIndex.symbols.get(cid)).find((c) => c && c.name === parts[0]);
      if (comp) {
        const typeSpec =
          (engine.query("typeSpecifier", comp.id) as string | undefined) ??
          (comp.metadata?.["typeSpecifier"] as string | undefined) ??
          (comp.metadata?.["type_specifier"] as string | undefined);
        if (typeSpec) {
          const typeEntry =
            resolvePathInUnified(splitQualifiedPath(String(typeSpec))) ??
            (() => {
              const resolved = engine.query("resolveName", enclosingClass.id);
              if (typeof resolved === "function") {
                return (resolved as (name: string) => SymbolEntry | null | undefined)(String(typeSpec)) ?? undefined;
              }
              return typeof resolved === "number" ? unifiedIndex.symbols.get(resolved) : undefined;
            })();
          if (typeEntry) {
            const targetEntry =
              resolvePathInUnified([typeEntry.name, ...parts.slice(1)]) ??
              (() => {
                let curr: SymbolEntry | undefined = typeEntry;
                for (const seg of parts.slice(1)) {
                  const cids: number[] = unifiedIndex.childrenOf?.get(curr.id) ?? [];
                  curr = cids.map((id) => unifiedIndex.symbols.get(id)).find((c) => c && c.name === seg);
                  if (!curr) return undefined;
                }
                return curr;
              })();
            if (targetEntry) return true;
          }
        }
      }
    }
    return resolveImportedOrQualifiedChain(fullChain);
  };

  const engineHasOverlappingCode = (codeNum: number, startOff: number, endOff: number): boolean =>
    (engineDiags ?? []).some((ed) => {
      const edCode = typeof ed.code === "number" ? ed.code : parseInt(extractDigitsOnly(String(ed.code ?? "")), 10);
      if (edCode !== codeNum) return false;
      const es = ed.startOffset ?? -1;
      const ee = ed.endOffset ?? es;
      return Math.max(es, startOff) <= Math.min(ee, endOff) + 2;
    });

  const modelicaView: ModelicaReconcileView | null =
    normLang === "modelica" && engine && typeof engine.query === "function"
      ? {
          symbols: unifiedIndex.symbols,
          symbol: (id: number) => unifiedIndex.symbols.get(id),
          byName: (n: string) =>
            (unifiedIndex.byName?.get(n) ?? [])
              .map((id: number) => unifiedIndex.symbols.get(id))
              .filter((s): s is SymbolEntry => Boolean(s)),
          query: <T = unknown>(q: string, id: number) => engine.query<T>(q, id),
        }
      : null;
  const docScopeIds = docSymbols.filter((s) => s.kind === "Class" || s.kind === "Package").map((s) => s.id);

  const preFiltered =
    normLang === "modelica"
      ? reconcileModelicaCstDiagnostics({
          cstDiags: wasmDiags,
          hasArenaResult: false,
          engineDiags,
          isOldFrontend: text.includes("-d=-newInst"),
        })
      : wasmDiags;

  return preFiltered.filter((diag) => {
    const info = extractCanonicalErrorInfo(diag.code, undefined, plugin);
    const codeNum = info.codeNum;
    const isTypeNotFound = codeNum === 2003 || info.ruleName === "typenotfound" || info.ruleName === "classnotfound";
    const isVarNotFound = codeNum === 2002 || info.ruleName === "variablenotfound";
    if (!isTypeNotFound && !isVarNotFound) return true;

    const startOff = computeOffset(diag.range.start);
    const endOff = Math.max(startOff, computeOffset(diag.range.end));
    const tokenText = text.slice(startOff, endOff).trim();
    const fullChain = extractChainAround(startOff, endOff) || tokenText;

    if (isTypeNotFound) {
      if (engineHasOverlappingCode(2003, startOff, endOff)) {
        return false;
      }
      if (resolveImportedOrQualifiedChain(fullChain) || resolveImportedOrQualifiedChain(tokenText)) {
        return false;
      }
      if (
        modelicaView &&
        (resolveModelicaTypeInWorkspace(modelicaView, fullChain, docScopeIds) ||
          resolveModelicaTypeInWorkspace(modelicaView, tokenText, docScopeIds))
      ) {
        return false;
      }
      for (const s of docSymbols) {
        if (s.startOffset <= startOff && s.endOffset >= endOff && engine && typeof engine.query === "function") {
          const rt = engine.query("resolvedType", s.id);
          if (rt) return false;
        }
      }
      return true;
    }

    const stmtStart = Math.max(0, text.lastIndexOf(";", startOff) + 1);
    const stmtPrefix = text.slice(stmtStart, endOff);
    if (
      engineDiags !== null &&
      hasConnectCallPrefix(stmtPrefix) &&
      engine &&
      typeof engine.runAllLintsAsync === "function"
    ) {
      return false;
    }
    if (resolveMemberViaComponentType(startOff, fullChain)) {
      return false;
    }
    if (modelicaView && resolveModelicaVariableInWorkspace(modelicaView, fullChain, null, docScopeIds)) {
      return false;
    }
    return true;
  });
}

export function mapCorrespondenceErrorCodeImpl(
  diagCode: CorrespondenceDiagnostic["code"],
  langId: string,
): number | string {
  const norm = langId.toLowerCase();
  if (norm === "modelica") {
    switch (diagCode) {
      case "CONFORMANCE_MISSING_PORT":
        return 4140;
      case "CONFORMANCE_PARAM_MISMATCH":
        return 4141;
      case "CONFORMANCE_MISSING_COMPONENT":
        return 4142;
      case "CONFORMANCE_UNRESOLVED_TARGET":
        return 4143;
    }
  } else if (norm === "sysml2" || norm === "sysml") {
    switch (diagCode) {
      case "CONFORMANCE_MISSING_PORT":
        return 4080;
      case "CONFORMANCE_PARAM_MISMATCH":
        return 4081;
      case "CONFORMANCE_MISSING_COMPONENT":
        return 4082;
      case "CONFORMANCE_UNRESOLVED_TARGET":
        return 4083;
    }
  }
  return diagCode;
}

export interface LiveTggContext {
  readonly workspaceManager: WorkspaceManager | undefined;
  readonly documentManager: DocumentManager | undefined;
  getTggTransformer(langId: string): PolyglotTransformer | null;
}

/**
 * Evaluates live read-only TGG structural correspondence diagnostics on `@twin` / `implements`
 * links in `effectiveUri`, reporting missing ports/components/type mismatches (`warning`) and
 * unresolved explicit twin targets (`error`).
 */
export function collectLiveTggCorrespondenceDiagnosticsImpl(
  ctx: LiveTggContext,
  params: {
    effectiveUri: string;
    langId: string;
    text: string;
    tree: PolyglotTreeLike | null | undefined;
    textDocument?: TextDocument | undefined;
    diagnostics: Diagnostic[];
  },
): void {
  const { effectiveUri, langId, text, tree, textDocument, diagnostics } = params;
  const uw = ctx.workspaceManager?.unifiedWorkspace;
  if (!uw || typeof uw.getIndex !== "function" || !text) return;
  const uIdx = uw.getIndex();
  if (!uIdx?.symbols) return;

  const normLang = langId.toLowerCase();
  if (normLang === "step" && text.length > 262_144) return;
  let links: ReturnType<typeof extractCrossLanguageLinks> = [];
  try {
    links = extractCrossLanguageLinks({
      uri: effectiveUri,
      language: normLang,
      index: uIdx,
      text,
      tree,
    });
  } catch {
    return;
  }
  const explicitLinks = links.filter((l) => l.relationKind === "twin" || l.relationKind === "implements");

  const dbView = {
    symbol: (id: number) => uIdx.symbols.get(id),
    childrenOf: (id: number | null) =>
      (uIdx.childrenOf.get(id) ?? [])
        .map((cid: number) => uIdx.symbols.get(cid))
        .filter((s): s is SymbolEntry => Boolean(s)),
    byName: (name: string) =>
      (uIdx.byName.get(name) ?? [])
        .map((id: number) => uIdx.symbols.get(id))
        .filter((s): s is SymbolEntry => Boolean(s)),
  };

  const inferTargetLang = (targetPath: string, fallbackLang: string): string => {
    const lower = targetPath.toLowerCase();
    if (lower.startsWith("sysml2::") || lower.startsWith("sysml::") || targetPath.includes("::")) return "sysml2";
    if (lower.startsWith("modelica::")) return "modelica";
    if (lower.startsWith("psse::")) return "psse";
    if (lower.startsWith("pscad::")) return "pscad";
    return fallbackLang === "modelica" ? "sysml2" : "modelica";
  };

  const srcTransformer = ctx.getTggTransformer(normLang) ?? new PolyglotTransformer();
  const validatedPairs = new Set<string>();

  const validatePair = (
    srcEntry: SymbolEntry,
    tgtEntry: SymbolEntry | null,
    targetNameHint: string,
    fallbackLine: number,
    fallbackCol: number,
  ) => {
    const pairKey = `${srcEntry.id}:${tgtEntry?.id ?? targetNameHint}`;
    if (validatedPairs.has(pairKey)) return;
    validatedPairs.add(pairKey);

    const targetDocUri = textDocument?.uri ?? srcEntry.resourceId ?? "";
    const cachedTree = targetDocUri ? ctx.documentManager?.documentTrees?.get(targetDocUri)?.tree : undefined;
    const cstSpan = resolveCstNameSpan(srcEntry, cachedTree);
    const spanStart = cstSpan?.startOffset ?? srcEntry.startOffset;
    const spanEnd = cstSpan?.endOffset ?? Math.min(text.length, spanStart + Math.max(1, srcEntry.name.length));
    const startPos = textDocument
      ? textDocument.positionAt(spanStart)
      : { line: Math.max(0, fallbackLine - 1), character: Math.max(0, fallbackCol - 1) };
    const endPos = textDocument
      ? textDocument.positionAt(spanEnd)
      : { line: startPos.line, character: startPos.character + Math.max(1, spanEnd - spanStart) };
    const range: Range = { start: startPos, end: endPos };

    const srcNode = symbolEntryToPolyglotNode(dbView, srcEntry);
    if (!tgtEntry) {
      const expectedLang = inferTargetLang(targetNameHint, normLang);
      const corrDiags = srcTransformer.validateCorrespondence(srcNode, null, normLang, expectedLang);
      for (const cd of corrDiags) {
        diagnostics.push({
          severity: cd.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          range,
          code: mapCorrespondenceErrorCodeImpl(cd.code, normLang),
          source: "modelscript-tgg",
          message: cd.message,
        });
      }
      return;
    }

    const tgtLang = (tgtEntry.language ?? inferTargetLang(targetNameHint, normLang)).toLowerCase();
    if (tgtLang === normLang) return;

    const isContainerTwin =
      isTypeLikeSymbol(srcEntry) ||
      srcEntry.ruleName === "psse_model" ||
      srcEntry.ruleName === "psse_dyr_record" ||
      srcEntry.ruleName === "pscad_component" ||
      srcEntry.ruleName === "ModuleDeclaration";
    if (!isContainerTwin) return;

    const tgtNode = symbolEntryToPolyglotNode(dbView, tgtEntry);
    const seenCorr = new Set<string>();
    const emitCorr = (cd: CorrespondenceDiagnostic) => {
      const key = `${cd.code}:${cd.expectedName ?? cd.elementName}`;
      if (seenCorr.has(key)) return;
      seenCorr.add(key);
      diagnostics.push({
        severity: cd.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        range,
        code: mapCorrespondenceErrorCodeImpl(cd.code, normLang),
        source: "modelscript-tgg",
        message: cd.message,
      });
    };

    for (const cd of srcTransformer.validateCorrespondence(srcNode, tgtNode, normLang, tgtLang)) {
      emitCorr(cd);
    }

    const tgtTransformer = ctx.getTggTransformer(tgtLang);
    if (tgtTransformer) {
      for (const cd of tgtTransformer.validateCorrespondence(tgtNode, srcNode, tgtLang, normLang)) {
        emitCorr(cd);
      }
    }
  };

  for (const link of explicitLinks) {
    const srcEntry = uIdx.symbols.get(link.sourceSymbolId);
    if (!srcEntry) continue;
    validatePair(srcEntry, link.targetEntry ?? null, link.targetName, link.sourceLine, link.sourceColumn);
  }

  // Also validate zero-annotation TGG container correspondences aligned by TggCorrespondenceIndexer
  const tggIndexer = uw.tggCorrespondenceIndexer;
  if (tggIndexer) {
    const tggWithVer = tggIndexer as typeof tggIndexer & { lastSyncedVersion?: number };
    if (tggWithVer.lastSyncedVersion !== uw.version) {
      uw.syncTggCorrespondences?.(uIdx);
    }
    for (const sym of uIdx.symbols.values()) {
      if ((sym.resourceId || sym.documentUri || "") !== effectiveUri) continue;
      for (const slot of tggIndexer.getSlotsForSymbol(sym.id)) {
        const rec = tggIndexer.hypergraph.getRecord(slot);
        if (!rec || rec.isRemoved) continue;
        for (const memberId of Object.values(rec.domainNodes)) {
          if (typeof memberId === "number" && memberId !== sym.id) {
            const peer = uIdx.symbols.get(memberId);
            if (peer) validatePair(sym, peer, peer.name, 1, 1);
          }
        }
      }
    }
  }
}

export function collectDroneSimulationParityDiagnosticsImpl(
  workspaceManager: WorkspaceManager | undefined,
  documentManager: DocumentManager | undefined,
  uri: string,
  langId: string,
  text: string,
  textDocument: TextDocument | undefined,
  diagnostics: Diagnostic[],
): void {
  if (!text) return;
  const lines = splitLinesPreserve(text);
  const threadEntries = workspaceManager?.getThreadsForUri?.(uri) ?? [];
  let calibratedMass: number | undefined;
  let peerSysmlName: string | undefined;

  for (const te of threadEntries) {
    const aligned = workspaceManager?.findAlignedElementsBySlot?.(te.slot) ?? [];
    for (const el of aligned) {
      if (el.uri !== uri && typeof el.properties?.["mass"] === "number") {
        if (calibratedMass === undefined || el.domain === "fea") {
          calibratedMass = el.properties["mass"];
        }
      }
      if (!peerSysmlName && (el.domain === "sysml2" || el.domain === "sysml")) {
        peerSysmlName = stripLeadingKeywordPrefixes(el.name, ["part def", "model"]);
      }
    }
    if (calibratedMass !== undefined && peerSysmlName !== undefined) break;
  }

  const pushMassParityDiag = (range: Diagnostic["range"], val: number, targetMass: number): void => {
    if (Math.abs(val - targetMass) > 0.01) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `[Digital Thread Drift] Parameter 'm = ${val}' drifts from FEA calibrated structural mass (${targetMass.toFixed(2)} kg). Run 'ModelScript: Sync Digital Thread Parameters' to reconcile.`,
        source: "modelscript-digital-thread",
      });
    } else {
      const peerSuffix = peerSysmlName ? ` and SysML v2 ${peerSysmlName}` : "";
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range,
        message: `[Digital Thread In Parity] Parameter 'm' (${targetMass.toFixed(2)} kg) is synchronized with FEA structural mass${peerSuffix}.`,
        source: "modelscript-digital-thread",
      });
    }
  };

  const isParityTarget = (uri.endsWith(".mo") || langId === "modelica") && calibratedMass !== undefined;

  if (isParityTarget && calibratedMass !== undefined) {
    const targetMass = calibratedMass;
    const cachedTree = documentManager?.documentTrees?.get(uri);
    const rootNode = cachedTree?.tree?.rootNode;
    let handledViaCst = false;
    if (rootNode && textDocument) {
      const compDecls = collectCstNodesByTypes(rootNode, ["component_declaration"]);
      for (const cd of compDecls) {
        const idNode = (cd.children || []).find((c: SyntaxNode) => c.type === "identifier");
        if (idNode?.text === "m") {
          const modNode = (cd.children || []).find((c: SyntaxNode) => c.type === "modification");
          const val = modNode?.text ? extractLeadingNumericAfterEquals(modNode.text) : null;
          if (val !== null) {
            const startPos = textDocument.positionAt(idNode.startIndex);
            const endPos = textDocument.positionAt(idNode.endIndex);
            handledViaCst = true;
            pushMassParityDiag({ start: startPos, end: endPos }, val, targetMass);
            break;
          }
        }
      }
    }

    if (!handledViaCst) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const parsed = extractParameterRealLine(line, "m");
        if (parsed !== null) {
          pushMassParityDiag(
            { start: { line: i, character: parsed.nameCol }, end: { line: i, character: parsed.nameCol + 1 } },
            parsed.value,
            targetMass,
          );
        }
      }
    }
  }

  if (workspaceManager && typeof workspaceManager.getThreadsForUri === "function") {
    const currentThreads = workspaceManager.getThreadsForUri(uri);
    if (currentThreads && currentThreads.length > 0) {
      for (const entry of currentThreads) {
        const { slot, meta } = entry;
        const aligned = workspaceManager.findAlignedElementsBySlot?.(slot) ?? [];
        if (aligned.length > 1) {
          const rawName = stripLeadingKeywordPrefixes(meta.name, ["part def", "model", "package", "def"]).trim();
          const peerList = aligned
            .filter((el) => el.domain.toLowerCase() !== entry.domain.toLowerCase())
            .map((el) => `${el.domain.toUpperCase()} (${el.name})`)
            .join(", ");

          const cachedTree = documentManager?.documentTrees?.get(uri)?.tree;
          const fileIdx = workspaceManager.unifiedWorkspace?.getFileIndex(uri);
          const targetSym =
            entry.meta.symbolId !== undefined
              ? fileIdx?.symbols?.get(entry.meta.symbolId)
              : rawName && fileIdx?.byName?.get(rawName)?.[0] !== undefined
                ? fileIdx.symbols.get(fileIdx.byName.get(rawName)![0]!)
                : undefined;

          const cstSpan = targetSym
            ? resolveCstNameSpan(targetSym, cachedTree)
            : typeof entry.meta.startOffset === "number" &&
                typeof entry.meta.endOffset === "number" &&
                entry.meta.endOffset > entry.meta.startOffset
              ? { startOffset: entry.meta.startOffset, endOffset: entry.meta.endOffset }
              : undefined;

          let infoRange: Range | undefined;
          if (cstSpan) {
            const offsetToPos = (src: string, off: number) => {
              const clamped = Math.max(0, Math.min(src.length, off));
              let line = 0;
              let lastNl = -1;
              for (let i = 0; i < clamped; i++) {
                if (src.charCodeAt(i) === 10) {
                  line++;
                  lastNl = i;
                }
              }
              return { line, character: clamped - lastNl - 1 };
            };
            infoRange = {
              start: offsetToPos(text, cstSpan.startOffset),
              end: offsetToPos(text, cstSpan.endOffset),
            };
          } else if (entry.meta.line >= 1) {
            const line0 = Math.max(0, entry.meta.line - 1);
            const col0 = Math.max(0, (entry.meta.column || 1) - 1);
            infoRange = {
              start: { line: line0, character: col0 },
              end: { line: line0, character: col0 + Math.max(1, entry.meta.length ?? rawName.length) },
            };
          }

          if (infoRange) {
            diagnostics.push({
              severity: DiagnosticSeverity.Information,
              range: infoRange,
              message: `[Multi-Domain Digital Thread] Architecture bound across ${aligned.length} domains: ${peerList}.`,
              source: "modelscript-digital-thread",
            });
          }
        }
      }
    }
  }
}
