// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type DigitalThreadHypergraph,
  DOMAIN_INDEX_TO_NAME,
  DOMAIN_NAME_TO_INDEX,
  extractCrossLanguageLinks,
  isMemberLikeSymbol,
  isTypeLikeSymbol,
  parseSysmlRequirements,
  type SemanticTheoryCoordinator,
  type SymbolEntry,
  type SymbolIndex,
  type SyntaxNode,
  type TheoryLiteral,
  ThreadDomain,
  type ThreadRecord,
  type UnifiedWorkspace,
} from "@modelscript/runtime";
import type { AlignedDomainElement } from "../providers/threadDiagnosticsProvider.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { CstNodeLike } from "../utils/ast-utils.js";
import { findAssignedNumberInLine } from "../utils/lexical-utils.js";
import type { DocumentManager } from "./document-manager.js";

/** Digital thread record with optional legacy `id` alias. */
export type WorkspaceThreadRecord = ThreadRecord & { id?: number | undefined };

/**
 * Source location and property metadata for a domain element bound to a digital thread slot.
 */
export interface ThreadElementMetadata {
  /** Human-readable element name or identifier. */
  name: string;
  /** Document URI containing the element declaration. */
  uri: string;
  /** 1-based source line number of the declaration identifier. */
  line: number;
  /** 1-based source column number of the declaration identifier. */
  column: number;
  /** Optional character length of the declaration identifier. */
  length?: number | undefined;
  /** Originating SymbolId in the UnifiedSymbolIndex for CST span resolution. */
  symbolId?: number | undefined;
  /** Exact CST start offset of the declaration identifier. */
  startOffset?: number | undefined;
  /** Exact CST end offset of the declaration identifier. */
  endOffset?: number | undefined;
  /** Engineering domain key (e.g., `"sysml2"`, `"modelica"`, `"cad"`, `"fea"`). */
  domain?: string | undefined;
  /** Optional key-value map of extracted engineering parameters (e.g., `mass`, `frontalArea`). */
  properties?: Record<string, unknown> | undefined;
  /** Marks entries created by automatic workspace discovery so manual test seeders remain untouched. */
  autoDiscovered?: boolean | undefined;
}

type SpanCstNode = (CstNodeLike | SyntaxNode) & {
  descendantForIndex?(start: number, end?: number): SpanCstNode | null;
  children?: readonly SpanCstNode[];
  child?(index: number): SpanCstNode | null;
  childForFieldName?(name: string): SpanCstNode | null;
};

/**
 * Resolves the exact CST byte/character span of a `SymbolEntry`'s name identifier token.
 * Checks CST-indexed `fieldRanges` first, then walks the parsed CST subtree rooted at
 * `[entry.startOffset, entry.endOffset]` to locate the identifier token node.
 */
export function resolveCstNameSpan(
  entry: SymbolEntry,
  tree?: { rootNode?: CstNodeLike | SyntaxNode | null | undefined } | null,
): { startOffset: number; endOffset: number } | undefined {
  const fieldRanges = (entry as { fieldRanges?: Record<string, { startOffset: number; endOffset: number }> })
    .fieldRanges;
  const namePath = (entry as { namePath?: string }).namePath;
  const indexedRange = fieldRanges?.["name"] ?? (namePath ? fieldRanges?.[namePath] : undefined);
  if (indexedRange && indexedRange.endOffset > indexedRange.startOffset) {
    return { startOffset: indexedRange.startOffset, endOffset: indexedRange.endOffset };
  }

  const root = tree?.rootNode as SpanCstNode | null | undefined;
  if (root && typeof entry.startOffset === "number" && typeof root.descendantForIndex === "function") {
    const endBound =
      typeof entry.endOffset === "number" && entry.endOffset > entry.startOffset
        ? entry.endOffset - 1
        : entry.startOffset;
    const declNode = root.descendantForIndex(entry.startOffset, endBound);
    if (declNode) {
      const nameField = typeof declNode.childForFieldName === "function" ? declNode.childForFieldName("name") : null;
      if (
        nameField &&
        typeof nameField.startIndex === "number" &&
        typeof nameField.endIndex === "number" &&
        nameField.endIndex > nameField.startIndex
      ) {
        return { startOffset: nameField.startIndex, endOffset: nameField.endIndex };
      }

      // BFS the declaration CST subtree (bounded depth) for the exact identifier leaf matching entry.name
      const targetName = entry.name;
      if (targetName) {
        const queue: Array<{ node: SpanCstNode; depth: number }> = [{ node: declNode, depth: 0 }];
        let firstIdentFallback: { startOffset: number; endOffset: number } | undefined;
        while (queue.length > 0) {
          const { node, depth } = queue.shift()!;
          const childCount = typeof node.childCount === "number" ? node.childCount : (node.children?.length ?? 0);
          if (childCount === 0) {
            const nodeText = node.text;
            if (
              typeof node.startIndex === "number" &&
              typeof node.endIndex === "number" &&
              node.endIndex > node.startIndex
            ) {
              if (nodeText === targetName) {
                return { startOffset: node.startIndex, endOffset: node.endIndex };
              }
              const kind = String(node.type ?? "").toLowerCase();
              if (
                !firstIdentFallback &&
                (kind === "identifier" || kind === "ident" || kind === "name" || kind === "id")
              ) {
                firstIdentFallback = { startOffset: node.startIndex, endOffset: node.endIndex };
              }
            }
            continue;
          }
          if (depth < 6) {
            for (let i = 0; i < childCount; i++) {
              const ch = typeof node.child === "function" ? node.child(i) : node.children?.[i];
              if (ch) queue.push({ node: ch, depth: depth + 1 });
            }
          }
        }
        if (firstIdentFallback) return firstIdentFallback;
      }
    }
  }

  if (
    typeof entry.startOffset === "number" &&
    typeof entry.endOffset === "number" &&
    entry.endOffset > entry.startOffset
  ) {
    return { startOffset: entry.startOffset, endOffset: entry.endOffset };
  }
  return undefined;
}

/**
 * Maps any registered ModelScript language ID onto the 16-domain `ThreadDomain` bitfield
 * used by `DigitalThreadHypergraph`, preserving distinct slots across cross-language pairs.
 */
export function mapLanguageToThreadDomain(langId: string): ThreadDomain {
  const norm = langId.toLowerCase();
  const mapped = DOMAIN_NAME_TO_INDEX[norm];
  if (mapped !== undefined) return mapped;
  switch (norm) {
    case "psse":
    case "raw":
    case "dyr":
      return ThreadDomain.FMU;
    case "pscad":
    case "pscx":
    case "pslx":
      return ThreadDomain.Software;
    case "easy5":
    case "rocets":
      return ThreadDomain.Surrogate;
    case "spice":
      return ThreadDomain.Telemetry;
    case "ssp":
    case "ssv":
      return ThreadDomain.BOM;
    default:
      return ThreadDomain.Software;
  }
}

export function normalizeAutoThreadUri(uri: string | undefined): string {
  return (uri ?? "").replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///").toLowerCase();
}

export interface DigitalThreadHost {
  readonly hypergraph: DigitalThreadHypergraph;
  readonly threadMetadataMap: Map<string, ThreadElementMetadata>;
  readonly coordinator: SemanticTheoryCoordinator;
  readonly unifiedWorkspace: UnifiedWorkspace;
  readonly documentManager?: DocumentManager | undefined;
}

/**
 * Manages Digital Thread Hypergraph bindings, automatic cross-language thread discovery,
 * TGG correspondence alignment, and formal theory constraint assertion/retraction.
 */
export class DigitalThreadIndex {
  /** Tracks auto-asserted SemanticTheoryCoordinator literal IDs per hypergraph slot for clean cross-file retraction. */
  private autoCoordinatorLiteralsBySlot = new Map<number, number[]>();
  /** Tracks auto-discovered hypergraph slots touched by each document URI. */
  private autoSlotsByUri = new Map<string, Set<number>>();
  /** Tracks auto-bound thread slot/metadata keys owned by each document URI. */
  private autoThreadKeysByUri = new Map<string, Array<{ slot: number; metaKey: string }>>();
  /** Set of hypergraph slot indices created by automatic discovery (never manually seeded slots). */
  private autoSlotIds = new Set<number>();

  constructor(private readonly host: DigitalThreadHost) {}

  public bindThreadSlot(threadId: number, domain: ThreadDomain, nodeId: number, meta: ThreadElementMetadata): number {
    let slot = this.host.hypergraph.findSlotByThreadId(threadId);
    if (slot === null || slot === undefined) {
      slot = this.host.hypergraph.createThread(threadId, 1);
    }
    this.host.hypergraph.bindDomainNode(slot, domain, nodeId);
    const slotDomName = DOMAIN_INDEX_TO_NAME[domain] ?? "unknown";
    const key = `${slotDomName}:${nodeId}`;
    this.host.threadMetadataMap.set(key, { ...meta, domain: meta.domain ?? slotDomName });
    return slot;
  }

  public getThreadsForUri(uri: string): {
    slot: number;
    record: WorkspaceThreadRecord | null | undefined;
    meta: ThreadElementMetadata;
    domain: string;
    nodeId: number;
  }[] {
    const results: {
      slot: number;
      record: WorkspaceThreadRecord | null | undefined;
      meta: ThreadElementMetadata;
      domain: string;
      nodeId: number;
    }[] = [];
    const seenSlotNodes = new Set<string>();

    const normUri = uri.toLowerCase();
    for (const [key, meta] of this.host.threadMetadataMap.entries()) {
      if (meta.uri && (meta.uri.toLowerCase() === normUri || normUri.endsWith(meta.uri.toLowerCase()))) {
        const parts = key.split(":");
        const slotDomName = parts[0]!;
        const nodeId = parseInt(parts[1]!, 10);
        const domIdx = DOMAIN_NAME_TO_INDEX[slotDomName];
        if (domIdx !== undefined) {
          const slots =
            typeof this.host.hypergraph.findSlotsByDomainNode === "function"
              ? this.host.hypergraph.findSlotsByDomainNode(domIdx, nodeId)
              : (() => {
                  const s = this.host.hypergraph.findSlotByDomainNode(domIdx, nodeId);
                  return s !== null && s !== undefined ? [s] : [];
                })();
          for (const slot of slots) {
            if (typeof this.host.hypergraph.isRemoved === "function" && this.host.hypergraph.isRemoved(slot)) {
              continue;
            }
            const dedupe = `${slot}:${slotDomName}:${nodeId}`;
            if (seenSlotNodes.has(dedupe)) continue;
            seenSlotNodes.add(dedupe);
            const record = this.host.hypergraph.getRecord(slot);
            results.push({ slot, record, meta, domain: meta.domain ?? slotDomName, nodeId });
          }
        }
      }
    }
    return results;
  }

  public findAlignedElementsBySlot(slot: number): AlignedDomainElement[] {
    const record = this.host.hypergraph.getRecord(slot);
    if (!record) return [];

    const domainElements: AlignedDomainElement[] = [];
    const isConflict = this.host.hypergraph.isConflicted(slot);
    const isStale = this.host.hypergraph.isStale(slot);
    const status = isConflict ? "conflict" : isStale ? "stale" : "synced";

    const isAutoSlot = this.autoSlotIds.has(slot);
    for (let dom = 0; dom < 16; dom++) {
      const nodeId = this.host.hypergraph.getDomainNode(slot, dom);
      if (nodeId && nodeId > 0) {
        const slotDomName = DOMAIN_INDEX_TO_NAME[dom] ?? "unknown";
        const key = `${slotDomName}:${nodeId}`;
        const meta = this.host.threadMetadataMap.get(key);
        if (isAutoSlot && !meta) continue;
        const reportedDomain = meta?.domain ?? slotDomName;
        domainElements.push({
          domain: reportedDomain,
          name: meta?.name ?? `${reportedDomain}_node_${nodeId}`,
          uri: meta?.uri,
          line: meta?.line ?? 1,
          column: meta?.column ?? 1,
          length: meta?.length,
          properties: meta?.properties,
          status,
        });
      }
    }
    if (isAutoSlot && domainElements.length < 2) return [];
    return domainElements;
  }

  public disposeDocument(uri: string): void {
    this.retractAutoThreadStateForUri(uri);
    const normUri = normalizeAutoThreadUri(uri);
    for (const [key, meta] of this.host.threadMetadataMap.entries()) {
      if (meta.uri && normalizeAutoThreadUri(meta.uri) === normUri) {
        this.host.threadMetadataMap.delete(key);
      }
    }
  }

  private retractSlotCoordinatorLiterals(slot: number): void {
    const prevLits = this.autoCoordinatorLiteralsBySlot.get(slot);
    if (prevLits && typeof this.host.coordinator?.retractLiteral === "function") {
      for (const litId of prevLits) {
        try {
          this.host.coordinator.retractLiteral(litId);
        } catch {
          // Ignore already-retracted literals
        }
      }
    }
    this.autoCoordinatorLiteralsBySlot.delete(slot);
  }

  public retractAutoThreadStateForUri(uri: string): void {
    const normTarget = normalizeAutoThreadUri(uri);
    const prevSlots = this.autoSlotsByUri.get(normTarget);
    if (prevSlots) {
      for (const slot of prevSlots) {
        this.retractSlotCoordinatorLiterals(slot);
      }
      this.autoSlotsByUri.delete(normTarget);
    }

    const prevKeys = this.autoThreadKeysByUri.get(normTarget);
    if (prevKeys) {
      for (const { slot, metaKey } of prevKeys) {
        this.retractSlotCoordinatorLiterals(slot);
        if (typeof this.host.hypergraph?.clearTheoryConflict === "function") {
          this.host.hypergraph.clearTheoryConflict(slot);
        }
        const existing = this.host.threadMetadataMap.get(metaKey);
        if (existing?.autoDiscovered && normalizeAutoThreadUri(existing.uri) === normTarget) {
          this.host.threadMetadataMap.delete(metaKey);
        }
      }
      this.autoThreadKeysByUri.delete(normTarget);
    }
  }

  private getDocTextForUri(uri: string | undefined): string {
    if (!uri) return "";
    const dm = this.host.documentManager;
    if (dm?.documents) {
      const doc = dm.documents.get(uri) ?? dm.documents.get(uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///"));
      if (doc && typeof doc.getText === "function") return doc.getText();
    }
    const treeEntry = dm?.documentTrees?.get(uri);
    if (treeEntry?.text) return treeEntry.text;
    const uDoc = this.host.unifiedWorkspace?.getDocument?.(uri);
    return uDoc?.text ?? "";
  }

  private extractNumericScalarProperties(
    index: SymbolIndex,
    entry: SymbolEntry,
    fallbackText?: string,
  ): Record<string, number> {
    const props: Record<string, number> = {};
    const docText = fallbackText || this.getDocTextForUri(entry.resourceId);

    const recordNumeric = (name: string | undefined, val: unknown): void => {
      if (!name) return;
      if (typeof val === "number" && Number.isFinite(val)) {
        props[name] = val;
      } else if (typeof val === "string") {
        const parsed = Number(val.trim());
        if (val.trim() !== "" && Number.isFinite(parsed)) {
          props[name] = parsed;
        }
      }
    };

    const extractFromSymbol = (sym: SymbolEntry): void => {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      if (meta["namedParams"] && typeof meta["namedParams"] === "object") {
        for (const [k, v] of Object.entries(meta["namedParams"])) {
          recordNumeric(k, v);
        }
      }
      for (const key of ["value", "defaultValue", "bindingValue", "literalValue"]) {
        if (meta[key] !== undefined) {
          recordNumeric(sym.name, meta[key]);
          break;
        }
      }
      if (props[sym.name] === undefined && sym.endOffset > sym.startOffset) {
        const symUri = sym.resourceId ?? entry.resourceId;
        const rootCst = symUri ? this.host.documentManager?.documentTrees?.get(symUri)?.tree?.rootNode : undefined;
        if (rootCst && "descendantForIndex" in rootCst && typeof rootCst.descendantForIndex === "function") {
          const declNode = rootCst.descendantForIndex(sym.startOffset, Math.max(sym.startOffset, sym.endOffset - 1));
          if (declNode) {
            type CstLeafNode = {
              childCount?: number;
              children?: CstLeafNode[];
              child?: (i: number) => CstLeafNode | null;
              text?: string;
            };
            const leaves: CstLeafNode[] = [];
            const collect = (n: CstLeafNode) => {
              const cnt = typeof n.childCount === "number" ? n.childCount : (n.children?.length ?? 0);
              if (cnt === 0) {
                leaves.push(n);
              } else {
                for (let i = 0; i < cnt; i++) {
                  const ch = typeof n.child === "function" ? n.child(i) : n.children?.[i];
                  if (ch) collect(ch);
                }
              }
            };
            collect(declNode);
            let seenOp = false;
            let sign = 1;
            for (const leaf of leaves) {
              const txt = String(leaf.text ?? "").trim();
              if (!seenOp) {
                if (txt === "=" || txt === ":=" || txt === "::=") seenOp = true;
                continue;
              }
              if (txt === "-") {
                sign = -sign;
                continue;
              }
              if (txt === "+") continue;
              const num = Number(txt);
              if (txt !== "" && Number.isFinite(num)) {
                recordNumeric(sym.name, sign * num);
              }
              break;
            }
          }
        }
        if (props[sym.name] === undefined && docText) {
          const slice = docText.slice(Math.max(0, sym.startOffset), Math.min(docText.length, sym.endOffset + 40));
          const span = findAssignedNumberInLine(slice, { allowSign: true, allowExponent: true });
          if (span?.text) {
            recordNumeric(sym.name, span.text);
          }
        }
      }
    };

    extractFromSymbol(entry);
    const childIds: number[] = index.childrenOf?.get(entry.id) ?? [];
    for (const cid of childIds) {
      const child = index.symbols?.get(cid);
      if (child && isMemberLikeSymbol(child)) {
        extractFromSymbol(child);
      }
    }
    return props;
  }

  public discoverThreadsForDocument(
    uri: string,
    text: string,
    langId: string,
    tree?: { rootNode?: SyntaxNode | null | undefined } | null,
  ): number[] {
    if (!this.host.unifiedWorkspace || typeof this.host.unifiedWorkspace.getIndex !== "function" || !text) {
      return [];
    }
    const uIdx = this.host.unifiedWorkspace.getIndex();
    if (!uIdx || !uIdx.symbols) return [];

    const normLang = langId.toLowerCase();
    // Large AP242 STEP B-Rep files (>256 KB) never declare @twin/Import/implements source links;
    // scanning them on every keystroke or peer validation stalls the LSP worker.
    if (normLang === "step" && text.length > 262_144) {
      this.retractAutoThreadStateForUri(uri);
      return [];
    }
    const normUri = (u: string) => u.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///").toLowerCase();
    const targetNormUri = normUri(uri);

    this.retractAutoThreadStateForUri(uri);

    const docsToScan: Array<{
      docUri: string;
      docText: string;
      docLang: string;
      docTree: { rootNode?: SyntaxNode | null | undefined } | null | undefined;
    }> = [{ docUri: uri, docText: text, docLang: normLang, docTree: tree }];
    if (this.host.documentManager?.documents) {
      for (const otherDoc of this.host.documentManager.documents.all()) {
        if (normUri(otherDoc.uri) === targetNormUri) continue;
        const otherLang =
          globalLanguageRegistry.getPluginForUri(otherDoc.uri)?.id?.toLowerCase() ??
          otherDoc.languageId?.toLowerCase() ??
          "";
        if (!otherLang) continue;
        const otherText = otherDoc.getText();
        if (otherLang === "step" && otherText.length > 262_144) continue;
        const cachedTree = this.host.documentManager.documentTrees.get(otherDoc.uri)?.tree;
        docsToScan.push({
          docUri: otherDoc.uri,
          docText: otherText,
          docLang: otherLang,
          docTree: cachedTree && "edit" in cachedTree ? cachedTree : undefined,
        });
      }
    }

    const discoveredLinks: ReturnType<typeof extractCrossLanguageLinks> = [];
    for (const item of docsToScan) {
      try {
        const found = extractCrossLanguageLinks({
          uri: item.docUri,
          language: item.docLang,
          index: uIdx,
          text: item.docText,
          tree: item.docTree,
        });
        for (const link of found) {
          if (!link.targetEntry) continue;
          const srcNorm = normUri(link.sourceUri);
          const tgtNorm = link.targetEntry.resourceId ? normUri(link.targetEntry.resourceId) : "";
          if (srcNorm === targetNormUri || tgtNorm === targetNormUri) {
            discoveredLinks.push(link);
          }
        }
      } catch {
        // Ignore link extraction failures on malformed/partial buffers
      }
    }

    const computeLineCol = (srcText: string, offset: number): { line: number; column: number } => {
      const safe = Math.max(0, Math.min(offset, srcText.length));
      const before = srcText.slice(0, safe);
      const nl = before.lastIndexOf("\n");
      let line = 1;
      for (let i = 0; i < safe; i++) {
        if (srcText.charCodeAt(i) === 10) line++;
      }
      return { line, column: nl === -1 ? safe + 1 : safe - nl };
    };

    const touchedSlots = new Set<number>();
    const retractedSlotsThisPass = new Set<number>();
    const ownedMetaKeys: Array<{ slot: number; metaKey: string }> = [];
    const slotVarNames = new Map<number, string[]>();

    const retractSlotOnce = (slot: number): void => {
      if (!retractedSlotsThisPass.has(slot)) {
        this.retractSlotCoordinatorLiterals(slot);
        retractedSlotsThisPass.add(slot);
      }
    };

    const assertSlotLiteral = (slot: number, lit: Omit<TheoryLiteral, "id"> & { id?: number | undefined }): void => {
      if (typeof this.host.coordinator?.assertLiteral !== "function") return;
      retractSlotOnce(slot);
      const litId = this.host.coordinator.assertLiteral(lit);
      const list = this.autoCoordinatorLiteralsBySlot.get(slot) ?? [];
      list.push(litId);
      this.autoCoordinatorLiteralsBySlot.set(slot, list);
    };

    for (const link of discoveredLinks) {
      const srcEntry = uIdx.symbols.get(link.sourceSymbolId);
      const tgtEntry = link.targetEntry;
      if (!srcEntry || !tgtEntry) continue;
      // Ignore pure package-level wildcard imports unless target is a concrete type/model
      if (link.relationKind === "import" && !isTypeLikeSymbol(tgtEntry)) continue;

      const srcLang = link.sourceLang.toLowerCase();
      const tgtLang = (tgtEntry.language ?? "").toLowerCase();
      if (!tgtLang || tgtLang === srcLang) continue;

      let srcDomain = mapLanguageToThreadDomain(srcLang);
      let tgtDomain = mapLanguageToThreadDomain(tgtLang);
      if (srcDomain === tgtDomain) {
        tgtDomain = srcDomain === ThreadDomain.Software ? ThreadDomain.FMU : ThreadDomain.Software;
      }

      const stableSymbolPath = (entry: SymbolEntry): string => {
        const parts: string[] = [];
        let cur: SymbolEntry | undefined = entry;
        const seen = new Set<number>();
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id);
          if (cur.name) parts.unshift(cur.name);
          cur = cur.parentId != null ? uIdx.symbols.get(cur.parentId) : undefined;
        }
        return parts.join(".") || entry.name;
      };
      const srcStableName = stableSymbolPath(srcEntry);
      const tgtStableName = stableSymbolPath(tgtEntry);
      const pairKey = [
        `${srcLang}:${normUri(srcEntry.resourceId ?? link.sourceUri)}:${srcStableName}`,
        `${tgtLang}:${normUri(tgtEntry.resourceId ?? "")}:${tgtStableName}`,
      ]
        .sort()
        .join("|");
      let hash = 2166136261;
      for (let i = 0; i < pairKey.length; i++) {
        hash ^= pairKey.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      const threadId = 100_000 + (hash % 800_000_000);

      const srcText = normUri(link.sourceUri) === targetNormUri ? text : this.getDocTextForUri(link.sourceUri);
      const tgtText =
        tgtEntry.resourceId && normUri(tgtEntry.resourceId) === targetNormUri
          ? text
          : this.getDocTextForUri(tgtEntry.resourceId);

      const srcProps: Record<string, unknown> = {
        ...this.extractNumericScalarProperties(uIdx, srcEntry, srcText),
        ...(link.properties ?? {}),
      };
      const tgtProps: Record<string, unknown> = {
        ...this.extractNumericScalarProperties(uIdx, tgtEntry, tgtText),
      };

      const tgtPos = tgtEntry.resourceId ? computeLineCol(tgtText, tgtEntry.startOffset) : { line: 1, column: 1 };

      const srcDomName = DOMAIN_INDEX_TO_NAME[srcDomain] ?? "unknown";
      const tgtDomName = DOMAIN_INDEX_TO_NAME[tgtDomain] ?? "unknown";
      const srcMetaKey = `${srcDomName}:${srcEntry.id}`;
      const tgtMetaKey = `${tgtDomName}:${tgtEntry.id}`;

      const slot = this.bindThreadSlot(threadId, srcDomain, srcEntry.id, {
        name: srcEntry.name,
        uri: link.sourceUri,
        line: link.sourceLine,
        column: link.sourceColumn,
        length: srcEntry.name.length,
        domain: srcLang,
        properties: srcProps,
        autoDiscovered: true,
      });
      this.bindThreadSlot(threadId, tgtDomain, tgtEntry.id, {
        name: tgtEntry.name,
        uri: tgtEntry.resourceId ?? "",
        line: tgtPos.line,
        column: tgtPos.column,
        length: tgtEntry.name.length,
        domain: tgtLang,
        properties: tgtProps,
        autoDiscovered: true,
      });

      this.autoSlotIds.add(slot);
      touchedSlots.add(slot);
      retractSlotOnce(slot);
      if (normUri(link.sourceUri) === targetNormUri) {
        ownedMetaKeys.push({ slot, metaKey: srcMetaKey });
      }
      if (tgtEntry.resourceId && normUri(tgtEntry.resourceId) === targetNormUri) {
        ownedMetaKeys.push({ slot, metaKey: tgtMetaKey });
      }

      // Assert shared numeric parameter equalities + exact intervals into SemanticTheoryCoordinator
      const canonicalKey = (k: string) => (k === "m" ? "mass" : k);
      for (const [kA, vA] of Object.entries(srcProps)) {
        if (typeof vA !== "number" || !Number.isFinite(vA)) continue;
        const canonA = canonicalKey(kA);
        const matchB = Object.entries(tgtProps).find(([kB]) => canonicalKey(kB) === canonA);
        if (matchB && typeof matchB[1] === "number" && Number.isFinite(matchB[1])) {
          const vB = matchB[1];
          const varA = `${threadId}.${srcLang}.${srcEntry.name}.${canonA}`;
          const varB = `${threadId}.${tgtLang}.${tgtEntry.name}.${canonA}`;
          const vars = slotVarNames.get(slot) ?? [];
          vars.push(varA, varB, canonA, srcEntry.name, tgtEntry.name);
          slotVarNames.set(slot, vars);
          if (typeof this.host.coordinator?.assertLiteral === "function") {
            assertSlotLiteral(slot, {
              predicate: "interval",
              args: [varA, vA, vA],
              domain: "continuous_safety",
              sourceContext: { slot, uri: link.sourceUri, name: `${srcEntry.name}.${kA}`, value: vA },
            });
            assertSlotLiteral(slot, {
              predicate: "interval",
              args: [varB, vB, vB],
              domain: "continuous_safety",
              sourceContext: { slot, uri: tgtEntry.resourceId, name: `${tgtEntry.name}.${matchB[0]}`, value: vB },
            });
            assertSlotLiteral(slot, {
              predicate: "equal",
              args: [varA, varB],
              domain: "continuous_safety",
              sourceContext: { slot, key: canonA },
            });
          }
        }
      }
    }

    // Synchronize declarative TGG correspondences (Tier 2: zero-annotation container/child/foreignKey alignment)
    if (typeof this.host.unifiedWorkspace.syncTggCorrespondences === "function") {
      const tggSummary = this.host.unifiedWorkspace.syncTggCorrespondences(uIdx);
      const projTable = this.host.unifiedWorkspace.tggProjectionTable;
      for (const slot of tggSummary.touchedSlots) {
        const rec = this.host.hypergraph.getRecord(slot);
        if (!rec || rec.isRemoved || !rec.domainNodes) continue;
        const memberEntries: Array<{ domIdx: number; entry: SymbolEntry; lang: string }> = [];
        let involvesTargetUri = false;
        for (const [domKey, nodeId] of Object.entries(rec.domainNodes)) {
          const domIdx = Number(domKey);
          if (!Number.isFinite(domIdx) || typeof nodeId !== "number" || nodeId <= 0) continue;
          const sym = uIdx.symbols.get(nodeId);
          if (!sym) continue;
          const symUri = sym.resourceId ?? sym.documentUri ?? "";
          if (symUri && normUri(symUri) === targetNormUri) {
            involvesTargetUri = true;
          }
          memberEntries.push({
            domIdx,
            entry: sym,
            lang: (sym.language ?? DOMAIN_INDEX_TO_NAME[domIdx] ?? "").toLowerCase(),
          });
        }
        if (!involvesTargetUri || memberEntries.length < 2) continue;

        touchedSlots.add(slot);
        const extractedByMember: Array<{
          entry: SymbolEntry;
          lang: string;
          symUri: string;
          props: Record<string, unknown>;
        }> = [];

        for (const m of memberEntries) {
          const symUri = m.entry.resourceId ?? m.entry.documentUri ?? "";
          const symText = symUri && normUri(symUri) === targetNormUri ? text : this.getDocTextForUri(symUri);
          const symTree = symUri ? this.host.documentManager?.documentTrees?.get(symUri)?.tree : undefined;
          const cstSpan = resolveCstNameSpan(m.entry, symTree);
          const startOff = cstSpan?.startOffset ?? m.entry.startOffset;
          const endOff = cstSpan?.endOffset ?? startOff + m.entry.name.length;
          const pos = symUri ? computeLineCol(symText, startOff) : { line: 1, column: 1 };
          const props = this.extractNumericScalarProperties(uIdx, m.entry, symText);
          const domName = DOMAIN_INDEX_TO_NAME[m.domIdx] ?? "unknown";
          const metaKey = `${domName}:${m.entry.id}`;
          if (!this.host.threadMetadataMap.has(metaKey)) {
            this.host.threadMetadataMap.set(metaKey, {
              name: m.entry.name,
              uri: symUri,
              line: pos.line,
              column: pos.column,
              length: Math.max(1, endOff - startOff),
              symbolId: m.entry.id,
              startOffset: startOff,
              endOffset: endOff,
              domain: m.lang || domName,
              properties: props,
              autoDiscovered: true,
            });
            if (symUri && normUri(symUri) === targetNormUri) {
              ownedMetaKeys.push({ slot, metaKey });
            }
          }
          extractedByMember.push({ entry: m.entry, lang: m.lang, symUri, props });
        }

        // Assert shared numeric parameter equalities across TGG-aligned containers (including fieldAliases like m <-> mass)
        const canonicalKey = (k: string) => (k === "m" ? "mass" : k);
        const threadId = rec.threadId || slot;
        for (let i = 0; i < extractedByMember.length; i++) {
          const mA = extractedByMember[i]!;
          for (let j = i + 1; j < extractedByMember.length; j++) {
            const mB = extractedByMember[j]!;
            for (const [kA, vA] of Object.entries(mA.props)) {
              if (typeof vA !== "number" || !Number.isFinite(vA)) continue;
              const matchB = Object.entries(mB.props).find(
                ([kB]) =>
                  canonicalKey(kA) === canonicalKey(kB) ||
                  (mA.lang && mB.lang && projTable.areMemberNamesAligned(mA.lang, kA, mB.lang, kB)),
              );
              if (matchB && typeof matchB[1] === "number" && Number.isFinite(matchB[1])) {
                const vB = matchB[1];
                const canon = canonicalKey(kA);
                const varA = `${threadId}.${mA.lang}.${mA.entry.name}.${canon}`;
                const varB = `${threadId}.${mB.lang}.${mB.entry.name}.${canon}`;
                const vars = slotVarNames.get(slot) ?? [];
                vars.push(varA, varB, canon, mA.entry.name, mB.entry.name);
                slotVarNames.set(slot, vars);
                if (typeof this.host.coordinator?.assertLiteral === "function") {
                  assertSlotLiteral(slot, {
                    predicate: "interval",
                    args: [varA, vA, vA],
                    domain: "continuous_safety",
                    sourceContext: { slot, uri: mA.symUri, name: `${mA.entry.name}.${kA}`, value: vA },
                  });
                  assertSlotLiteral(slot, {
                    predicate: "interval",
                    args: [varB, vB, vB],
                    domain: "continuous_safety",
                    sourceContext: { slot, uri: mB.symUri, name: `${mB.entry.name}.${matchB[0]}`, value: vB },
                  });
                  assertSlotLiteral(slot, {
                    predicate: "equal",
                    args: [varA, varB],
                    domain: "continuous_safety",
                    sourceContext: { slot, key: canon },
                  });
                }
              }
            }
          }
        }
      }
    }

    // Bind formal SysML v2 requirement constraints against discovered thread variables
    for (const item of docsToScan) {
      if (item.docLang !== "sysml2" && item.docLang !== "sysml") continue;
      let reqs: ReturnType<typeof parseSysmlRequirements> = [];
      try {
        reqs = parseSysmlRequirements(item.docText, item.docTree?.rootNode ?? null);
      } catch {
        reqs = [];
      }
      if (reqs.length === 0) continue;

      for (const req of reqs) {
        const canonAttr = req.targetAttribute === "m" ? "mass" : req.targetAttribute;
        for (const slot of touchedSlots) {
          const elems = this.findAlignedElementsBySlot(slot);
          const rec = this.host.hypergraph.getRecord(slot);
          const matchesSubject = (() => {
            if (!req.subjectName) return true;
            const subjLower = req.subjectName.toLowerCase();
            if (
              elems.some((el) => el.name.toLowerCase() === subjLower || el.name.toLowerCase().endsWith(`.${subjLower}`))
            ) {
              return true;
            }
            if (rec?.domainNodes) {
              for (const nodeId of Object.values(rec.domainNodes)) {
                let cur = uIdx.symbols.get(nodeId);
                const seen = new Set<number>();
                while (cur && !seen.has(cur.id)) {
                  seen.add(cur.id);
                  if (cur.name.toLowerCase() === subjLower) return true;
                  cur = cur.parentId != null ? uIdx.symbols.get(cur.parentId) : undefined;
                }
              }
            }
            return false;
          })();
          if (!matchesSubject) continue;

          for (const el of elems) {
            const props = el.properties ?? {};
            const matchedVal =
              typeof props[req.targetAttribute] === "number"
                ? props[req.targetAttribute]
                : typeof props[canonAttr] === "number"
                  ? props[canonAttr]
                  : undefined;
            if (
              typeof matchedVal === "number" &&
              Number.isFinite(matchedVal) &&
              typeof this.host.coordinator?.assertLiteral === "function"
            ) {
              const reqVar = `req.${req.id}.${canonAttr}`;
              const elVar = `${slot}.${el.domain}.${el.name}.${canonAttr}`;
              const vars = slotVarNames.get(slot) ?? [];
              vars.push(reqVar, elVar, req.id, el.name, req.targetAttribute);
              slotVarNames.set(slot, vars);
              assertSlotLiteral(slot, {
                predicate: "bound",
                args: [reqVar, req.operator, req.limitValue],
                domain: "continuous_safety",
                sourceContext: { slot, uri: item.docUri, requirementId: req.id, limitValue: req.limitValue },
              });
              assertSlotLiteral(slot, {
                predicate: "interval",
                args: [elVar, matchedVal, matchedVal],
                domain: "continuous_safety",
                sourceContext: { slot, uri: el.uri, name: el.name, value: matchedVal },
              });
              assertSlotLiteral(slot, {
                predicate: "equal",
                args: [reqVar, elVar],
                domain: "continuous_safety",
                sourceContext: { slot, requirementId: req.id },
              });
            }
          }
        }
      }
    }

    if (touchedSlots.size > 0) {
      this.autoSlotsByUri.set(targetNormUri, new Set(touchedSlots));
    }
    if (ownedMetaKeys.length > 0) {
      this.autoThreadKeysByUri.set(targetNormUri, ownedMetaKeys);
    }

    if (touchedSlots.size > 0 && typeof this.host.coordinator?.checkSat === "function") {
      try {
        const sat = this.host.coordinator.checkSat();
        for (const slot of touchedSlots) {
          if (typeof this.host.hypergraph?.clearTheoryConflict === "function") {
            this.host.hypergraph.clearTheoryConflict(slot);
          }
        }
        if (!sat.isSat && sat.conflict) {
          const culprits = (sat.conflict.culpritEntities ?? []).map((c) => c.toLowerCase());
          const explanationLower = (sat.conflict.explanation ?? "").toLowerCase();
          for (const slot of touchedSlots) {
            const slotVars = (slotVarNames.get(slot) ?? []).map((v) => v.toLowerCase());
            const matchesSlot =
              culprits.some((c) => slotVars.some((sv) => sv === c || sv.includes(c) || c.includes(sv))) ||
              slotVars.some((sv) => explanationLower.includes(sv));
            if (matchesSlot && typeof this.host.hypergraph?.recordTheoryConflict === "function") {
              this.host.hypergraph.recordTheoryConflict(slot, sat.conflict);
            }
          }
        }
      } catch {
        // Non-fatal: partial theory states must not crash validation
      }
    }

    return Array.from(touchedSlots);
  }
}
