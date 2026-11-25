// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Connection, type Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { ThreadDiagnosticsProvider } from "../../providers/threadDiagnosticsProvider.js";
import { deduplicateAllDiagnostics } from "../diagnostic-dedup.js";
import type { DocumentManager } from "../document-manager.js";
import { resolveCstNameSpan, type WorkspaceManager } from "../workspace-manager.js";

export interface DigitalThreadValidationContext {
  connection: Connection;
  documentManager: DocumentManager;
  workspaceManager: WorkspaceManager;
  digitalThreadDiagnosticsByUri: Map<string, Diagnostic[]>;
  lastSemanticDiagnostics: Map<string, Diagnostic[]>;
  siblingDirCache: Map<string, { ts: number; files: Array<{ uri: string; content: string }> }>;
  getLastDigitalThreadFingerprint: () => string;
  setLastDigitalThreadFingerprint: (fp: string) => void;
  getIsDigitalThreadRunning: () => boolean;
  setIsDigitalThreadRunning: (running: boolean) => void;
  getPolyglotProviders: () => Promise<Record<string, unknown>>;
  applyDiagnosticFilters: (diagnostics: Diagnostic[]) => Diagnostic[];
  requestCodeLensRefresh: (delayMs?: number) => void;
}

interface HypergraphConflictLike {
  getConflict?: (slot: number) => Parameters<typeof ThreadDiagnosticsProvider.diagnoseThread>[3];
}

interface AlignedElementLike {
  uri?: string;
  line?: number;
  column?: number;
  length?: number;
  name?: string;
  domain?: string;
}

/**
 * Evaluates hypergraph digital thread slots for `uri` against aligned peer elements across domains,
 * returning LSP diagnostics for parameter drift or conflict slots.
 */
export function collectThreadDiagnosticsImpl(
  ctx: Pick<DigitalThreadValidationContext, "workspaceManager" | "documentManager">,
  uri: string,
  textDocument?: TextDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (typeof ctx.workspaceManager?.getThreadsForUri !== "function") return diagnostics;

  const threadEntries = ctx.workspaceManager.getThreadsForUri(uri);
  if (!threadEntries || threadEntries.length === 0) return diagnostics;

  const text = textDocument ? textDocument.getText() : "";

  for (const entry of threadEntries) {
    const { slot, record, meta, domain } = entry;
    const alignedElements = ctx.workspaceManager.findAlignedElementsBySlot(slot);
    const hg = ctx.workspaceManager.hypergraph as unknown as HypergraphConflictLike | undefined;
    const conflict = typeof hg?.getConflict === "function" ? hg.getConflict(slot) : undefined;

    const threadDiags = ThreadDiagnosticsProvider.diagnoseThread(
      record?.id ?? slot,
      alignedElements,
      0.05,
      conflict,
      domain,
    );

    for (const td of threadDiags) {
      if (td.domain.toLowerCase() !== domain.toLowerCase()) continue;

      const cachedTree = ctx.documentManager?.documentTrees?.get(uri)?.tree;
      const uIdx = ctx.workspaceManager.unifiedWorkspace?.getFileIndex(uri);
      const offsetToPos = (src: string, off: number): { line: number; character: number } => {
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

      // 1. Resolve the target SymbolEntry from UnifiedSymbolIndex (preferring a matching child symbol
      //    such as an attribute/parameter like `K_droop` when `td.elementName` identifies one).
      let targetSym = meta.symbolId !== undefined ? uIdx?.symbols?.get(meta.symbolId) : undefined;
      const culpritBase = td.elementName ? td.elementName.split(".").pop() || td.elementName : "";
      if (targetSym && culpritBase && culpritBase !== targetSym.name && uIdx) {
        const childIds = uIdx.childrenOf?.get(targetSym.id) ?? [];
        for (const cid of childIds) {
          const child = uIdx.symbols.get(cid);
          if (child && child.name === culpritBase) {
            targetSym = child;
            break;
          }
        }
      }

      let startPos: { line: number; character: number } | undefined;
      let endPos: { line: number; character: number } | undefined;

      // 2. Compute exact LSP range from the symbol's CST span (fieldRanges or CST identifier node)
      if (targetSym && text) {
        const cstSpan = resolveCstNameSpan(targetSym, cachedTree);
        if (cstSpan && cstSpan.endOffset > cstSpan.startOffset) {
          startPos = offsetToPos(text, cstSpan.startOffset);
          endPos = offsetToPos(text, cstSpan.endOffset);
        }
      }

      // 3. Fallback to CST offsets cached on ThreadElementMetadata, or exact CST token at (line, col)
      if (
        !startPos &&
        text &&
        typeof meta.startOffset === "number" &&
        typeof meta.endOffset === "number" &&
        meta.endOffset > meta.startOffset
      ) {
        startPos = offsetToPos(text, meta.startOffset);
        endPos = offsetToPos(text, meta.endOffset);
      }

      if (!startPos) {
        const fallbackLine = Math.max(0, (td.line || meta.line || 1) - 1);
        const fallbackCol = Math.max(0, (td.column || meta.column || 1) - 1);
        const rootNode = cachedTree?.rootNode as
          | {
              descendantForPosition?: (pos: { row: number; column: number }) => {
                startPosition?: { row: number; column: number };
                endPosition?: { row: number; column: number };
              } | null;
            }
          | undefined;
        const cstToken =
          rootNode && typeof rootNode.descendantForPosition === "function"
            ? rootNode.descendantForPosition({ row: fallbackLine, column: fallbackCol })
            : null;
        if (cstToken?.startPosition && cstToken?.endPosition) {
          startPos = { line: cstToken.startPosition.row, character: cstToken.startPosition.column };
          endPos = { line: cstToken.endPosition.row, character: cstToken.endPosition.column };
        } else {
          const len = td.length || meta.length || (meta.name ? meta.name.length : 1);
          startPos = { line: fallbackLine, character: fallbackCol };
          endPos = { line: fallbackLine, character: fallbackCol + len };
        }
      }

      const startLine = startPos.line;
      const startCol = startPos.character;
      const endLine = endPos!.line;
      const endCol = endPos!.character;

      const typedAligned = alignedElements as unknown as AlignedElementLike[];
      const relatedInformation =
        td.relatedInformation && td.relatedInformation.length > 0
          ? td.relatedInformation.filter((r) => r.location.uri !== uri)
          : typedAligned
              .filter((el): el is AlignedElementLike & { uri: string } => Boolean(el?.uri && el.uri !== uri))
              .map((el) => {
                const relLine = Math.max(0, (el.line ?? 1) - 1);
                const relCol = Math.max(0, (el.column ?? 1) - 1);
                return {
                  location: {
                    uri: el.uri,
                    range: {
                      start: { line: relLine, character: relCol },
                      end: { line: relLine, character: relCol + Math.max(1, el.length ?? (el.name || "").length) },
                    },
                  },
                  message: `Aligned ${String(el.domain || "domain").toUpperCase()} element '${el.name || td.elementName}'`,
                };
              });

      diagnostics.push({
        range: {
          start: { line: startLine, character: startCol },
          end: { line: endLine, character: endCol },
        },
        severity:
          td.severity === "error"
            ? DiagnosticSeverity.Error
            : td.severity === "info"
              ? DiagnosticSeverity.Information
              : DiagnosticSeverity.Warning,
        code: td.code || "THREAD_CONFLICT",
        source: td.source || "modelscript-digital-thread",
        message: td.message,
        ...(relatedInformation.length > 0 ? { relatedInformation } : {}),
        data: {
          threadId: td.threadId ?? record?.id ?? slot,
          slot,
          elementName: td.elementName,
          sourceDomain: td.sourceDomain,
          sourceValue: td.sourceValue,
          targetDomain: td.targetDomain,
          targetValue: td.targetValue,
          simplexConsensus: td.simplexConsensus,
          unit: td.unit,
          alignedElements,
        },
      });
    }
  }

  return diagnostics;
}

/**
 * Merges polyglot digital thread diagnostics into cached per-document diagnostics without
 * clobbering existing syntax/semantic lints, then pushes updated diagnostics to the client.
 */
export function mergeDigitalThreadDiagnosticsImpl(
  ctx: Pick<
    DigitalThreadValidationContext,
    | "connection"
    | "digitalThreadDiagnosticsByUri"
    | "lastSemanticDiagnostics"
    | "applyDiagnosticFilters"
    | "requestCodeLensRefresh"
  >,
  diagsByUri: Map<string, Diagnostic[]>,
): void {
  const allKnownUris = new Set<string>([...ctx.digitalThreadDiagnosticsByUri.keys(), ...diagsByUri.keys()]);
  let didChange = false;
  for (const uri of allKnownUris) {
    const next = diagsByUri.get(uri) || [];
    if (next.length === 0) {
      const hadPrev = ctx.digitalThreadDiagnosticsByUri.has(uri);
      ctx.digitalThreadDiagnosticsByUri.delete(uri);
      if (hadPrev) {
        const base = ctx.applyDiagnosticFilters(
          (ctx.lastSemanticDiagnostics.get(uri) || []).filter((d) => d.source !== "modelscript-digital-thread"),
        );
        ctx.lastSemanticDiagnostics.set(uri, base);
        ctx.connection.sendDiagnostics({ uri, diagnostics: base });
        didChange = true;
      }
    } else {
      ctx.digitalThreadDiagnosticsByUri.set(uri, next);
      const existing = (ctx.lastSemanticDiagnostics.get(uri) || []).filter(
        (d) => d.source !== "modelscript-digital-thread",
      );
      const merged = ctx.applyDiagnosticFilters(deduplicateAllDiagnostics([...existing, ...next]));
      ctx.lastSemanticDiagnostics.set(uri, merged);
      ctx.connection.sendDiagnostics({ uri, diagnostics: merged });
      didChange = true;
    }
  }
  if (didChange) {
    ctx.requestCodeLensRefresh();
  }
}

/**
 * Runs live cross-file polyglot digital thread validation across open, indexed, and disk-sibling files,
 * updating `digitalThreadDiagnosticsByUri` without clobbering per-document diagnostics.
 */
export async function runLiveDigitalThreadValidationImpl(
  ctx: DigitalThreadValidationContext,
  triggerUri: string,
): Promise<void> {
  if (ctx.getIsDigitalThreadRunning()) return;
  const openDocs = ctx.documentManager?.documents?.all?.() ?? [];
  const byUri = new Map<string, { uri: string; fileName: string; content: string }>();
  const addDoc = (uri: string, content: string) => {
    const key = uri.replace(/^([a-z0-9+-]+):\/(?!\/)/i, "$1:///").toLowerCase();
    if (byUri.has(key) || /^(builtin|modelica|msl):/i.test(uri) || !content.trim()) return;
    byUri.set(key, { uri, fileName: uri.split(/[\\/]/).pop() || uri, content });
  };
  for (const d of openDocs) addDoc(d.uri, d.getText());
  const unifiedWs = ctx.workspaceManager?.unifiedWorkspace as unknown as
    | {
        getAllDocumentEntries?: () => Array<{ uri?: string; text?: string }>;
        getIndex?: (opts?: { eager?: boolean }) => unknown;
      }
    | undefined;
  if (unifiedWs && typeof unifiedWs.getAllDocumentEntries === "function") {
    for (const e of unifiedWs.getAllDocumentEntries()) {
      if (e?.uri && e.text) addDoc(e.uri, e.text);
    }
  }

  // Fallback: when a single file:// document is opened outside a workspace index, scan sibling files asynchronously with a 5s TTL cache
  if (/^file:\/\//i.test(triggerUri) && typeof process !== "undefined") {
    try {
      const procBuiltin = process as unknown as { getBuiltinModule?: (id: string) => unknown };
      const nodeFs = procBuiltin.getBuiltinModule?.("node:fs") as
        | {
            promises?: {
              readdir: (
                p: string,
                opts: { withFileTypes: boolean },
              ) => Promise<Array<{ isFile: () => boolean; name: string }>>;
              stat: (p: string) => Promise<{ size: number }>;
              readFile: (p: string, enc: string) => Promise<string>;
            };
          }
        | undefined;
      const nodePath = procBuiltin.getBuiltinModule?.("node:path") as
        | { dirname: (p: string) => string; extname: (p: string) => string; join: (...p: string[]) => string }
        | undefined;
      const nodeUrl = procBuiltin.getBuiltinModule?.("node:url") as
        { fileURLToPath: (u: string) => string; pathToFileURL: (p: string) => { href: string } } | undefined;
      if (nodeFs?.promises && nodePath && nodeUrl) {
        const triggerDir = nodePath.dirname(nodeUrl.fileURLToPath(triggerUri));
        const now = Date.now();
        const cachedDir = ctx.siblingDirCache.get(triggerDir);
        if (cachedDir && now - cachedDir.ts < 5000) {
          for (const f of cachedDir.files) {
            addDoc(f.uri, f.content);
          }
        } else {
          const siblingExts = new Set([
            ".sysml",
            ".mo",
            ".sp",
            ".spice",
            ".cir",
            ".scad",
            ".inp",
            ".cfd",
            ".urdf",
            ".step",
            ".stp",
            ".reqif",
            ".owl",
            ".omn",
            ".ttl",
            ".ofn",
            ".owl2",
          ]);
          const entries = await nodeFs.promises.readdir(triggerDir, { withFileTypes: true });
          const scannedFiles: Array<{ uri: string; content: string }> = [];
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const ext = nodePath.extname(entry.name).toLowerCase();
            if (!siblingExts.has(ext)) continue;
            const fullPath = nodePath.join(triggerDir, entry.name);
            const sibUri = nodeUrl.pathToFileURL(fullPath).href;
            const sibKey = sibUri.replace(/^([a-z0-9+-]+):\/(?!\/)/i, "$1:///").toLowerCase();
            if (!byUri.has(sibKey)) {
              try {
                const stat = await nodeFs.promises.stat(fullPath);
                if (stat.size <= 1024 * 1024) {
                  const content = await nodeFs.promises.readFile(fullPath, "utf-8");
                  scannedFiles.push({ uri: sibUri, content });
                  addDoc(sibUri, content);
                }
              } catch {
                // Ignore unreadable sibling file
              }
            }
          }
          if (ctx.siblingDirCache.size >= 32) {
            const oldest = ctx.siblingDirCache.keys().next().value;
            if (oldest !== undefined) ctx.siblingDirCache.delete(oldest);
          }
          ctx.siblingDirCache.set(triggerDir, { ts: now, files: scannedFiles });
        }
      }
    } catch {
      // Ignore inaccessible disk directory
    }
  }

  const files = Array.from(byUri.values());
  const uniqueExts = new Set(files.map((f) => f.fileName.split(".").pop()?.toLowerCase() ?? "").filter(Boolean));
  const hasDirectives = files.some(
    (f) =>
      f.content.includes("@twin:") ||
      f.content.includes("@port_map:") ||
      f.content.includes("@mesh_source:") ||
      f.content.includes("annotation(twin"),
  );
  if (files.length < 2 || (!hasDirectives && uniqueExts.size < 2)) {
    ctx.setLastDigitalThreadFingerprint("");
    if (ctx.digitalThreadDiagnosticsByUri.size > 0) {
      mergeDigitalThreadDiagnosticsImpl(ctx, new Map());
    }
    return;
  }

  const fingerprint = files
    .map((f) => `${f.uri}:${f.content.length}:${f.content.slice(0, 64)}:${f.content.slice(-64)}`)
    .sort()
    .join("|");
  if (fingerprint === ctx.getLastDigitalThreadFingerprint() && ctx.digitalThreadDiagnosticsByUri.size > 0) {
    return;
  }

  ctx.setIsDigitalThreadRunning(true);
  const docVersionsAtStart = new Map<string, number>();
  if (ctx.documentManager?.documents && typeof ctx.documentManager.documents.all === "function") {
    for (const d of ctx.documentManager.documents.all()) {
      docVersionsAtStart.set(d.uri, d.version);
    }
  }
  try {
    const [{ createPolyglotCoordinator }, providers] = await Promise.all([
      import("@modelscript/runtime"),
      ctx.getPolyglotProviders(),
    ]);
    const { evaluatePolyglotDigitalThreadFromFiles } = createPolyglotCoordinator(
      providers as unknown as Parameters<typeof createPolyglotCoordinator>[0],
    );
    const symbolIndex = typeof unifiedWs?.getIndex === "function" ? unifiedWs.getIndex({ eager: false }) : undefined;
    type ThreadOptions = NonNullable<Parameters<typeof evaluatePolyglotDigitalThreadFromFiles>[2]>;
    const threadRes = evaluatePolyglotDigitalThreadFromFiles(files, undefined, {
      symbolIndex: symbolIndex as ThreadOptions["symbolIndex"],
    });
    const diagsByUri = new Map<string, Diagnostic[]>();
    const threadEdits =
      "suggestedEdits" in threadRes && Array.isArray(threadRes.suggestedEdits) ? threadRes.suggestedEdits : [];
    const artifacts = "artifacts" in threadRes && Array.isArray(threadRes.artifacts) ? threadRes.artifacts : [];

    for (const art of artifacts) {
      const targetUri = art.uri || files[art.index]?.uri;
      if (!targetUri) continue;
      const artEdits = threadEdits.filter((se) => (se.uri ?? files[se.fileIndex]?.uri) === targetUri);
      const mapped: Diagnostic[] = (art.diagnostics ?? []).map((d) => ({
        range: {
          start: { line: Math.max(0, (d.startLine ?? 1) - 1), character: Math.max(0, (d.startCol ?? 1) - 1) },
          end: { line: Math.max(0, (d.endLine ?? 1) - 1), character: Math.max(0, (d.endCol ?? 12) - 1) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.code ?? "POLYGLOT_TWIN_DRIFT",
        source: "modelscript-digital-thread",
        message: d.message,
        data: { suggestedEdits: artEdits.length > 0 ? artEdits : threadEdits },
      }));
      diagsByUri.set(targetUri, mapped);
    }
    let isStale = false;
    if (ctx.documentManager?.documents && typeof ctx.documentManager.documents.all === "function") {
      for (const d of ctx.documentManager.documents.all()) {
        const prev = docVersionsAtStart.get(d.uri);
        if (prev !== undefined && d.version !== prev) {
          isStale = true;
          break;
        }
      }
    }
    if (!isStale) {
      ctx.setLastDigitalThreadFingerprint(fingerprint);
      mergeDigitalThreadDiagnosticsImpl(ctx, diagsByUri);
    }
  } catch {
    // Non-fatal background check
  } finally {
    ctx.setIsDigitalThreadRunning(false);
  }
}
