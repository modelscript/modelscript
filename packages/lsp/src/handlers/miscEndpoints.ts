// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeSemanticDiff, type SemanticEdit } from "@modelscript/dsl";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import {
  DOMAIN_INDEX_TO_NAME,
  globalLibraryRegistry,
  type DiagramComponentSpec,
  type LibrarySymbolStub,
  type ModelscriptLibraryManifest,
  type SymbolEntry,
  type SymbolIndex,
} from "@modelscript/runtime";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LspContext, type ModelScriptLspSettings } from "../lsp-context.js";
import { ThreadExplorerProvider } from "../providers/threadExplorerProvider.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getTraceabilityMatrix } from "../requirements.js";
import type { ComputeWritebackEditParams } from "../services/writeback-service.js";
import {
  getCompositeName,
  loadingLibraryState,
  mountedLibraryMetadata,
  normalizeLibraryName,
  type LoadingLibraryInfo,
  type MountedLibraryInfo,
} from "../utils/hierarchy-utils.js";
import { extractFirstQuotedLiteral, trimTrailingChars } from "../utils/lexical-utils.js";
import {
  decodeBase64Bytes,
  ensureLibraryVersionMounted,
  importLibraryZip,
  loadRegistryPackages,
  unloadLibraryPackage,
  type RegistryPackageInfo,
} from "../vfs/library-loader.js";

export interface SemanticRegulatoryImpact {
  isSafetyCritical: boolean;
  hazardId?: string | undefined;
  hazardName?: string | undefined;
  requirementId?: string | undefined;
  riskSeverity: number;
  invalidatedLinks: { targetName: string; targetKind: string; reason: string }[];
}

export interface FlatSemanticEdit {
  action: "insert" | "delete" | "update" | "none" | "move";
  description: string;
  oldRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number } | undefined;
  newRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number } | undefined;
  kind?: string | undefined;
  regulatoryImpact?: SemanticRegulatoryImpact | undefined;
}

interface ValueCarryingEntryLike {
  name?: string | undefined;
  ruleName?: string | undefined;
  fieldRanges?: Record<string, unknown> | undefined;
}

interface DiffTreeLike {
  rootNode: unknown;
  delete?: () => void;
}

interface DiffParserLike {
  parse(text: string): DiffTreeLike;
}

interface DiffWorkspaceIndexLike {
  reindexDocument?: (uri: string, getRoot: () => never) => void;
  getIndex?: () => SymbolIndex;
  symbols?: SymbolIndex["symbols"];
  childrenOf?: SymbolIndex["childrenOf"];
}

function isValueCarryingEntry(entry: ValueCarryingEntryLike, slice?: string): boolean {
  if (!entry.name) return false;
  const rule = entry.ruleName || "";

  if (
    // SysML2
    rule === "AttributeUsage" ||
    rule === "ReferenceUsage" ||
    rule === "DefaultReferenceUsage" ||
    rule === "PartUsage" ||
    rule === "PortUsage" ||
    rule === "ItemUsage" ||
    rule === "EnumerationUsage" ||
    rule === "ConstraintUsage" ||
    // Modelica
    rule === "ComponentDeclaration" ||
    rule === "component_declaration" ||
    rule === "ShortClassDefinition" ||
    // OpenSCAD
    rule === "VariableDeclaration" ||
    rule === "Assignment" ||
    // OWL2
    rule === "DataPropertyAssertion" ||
    // STEP
    rule === "step_product" ||
    rule === "step_shape" ||
    // CSV
    rule === "Row" ||
    rule === "Cell"
  ) {
    return true;
  }

  if (entry.fieldRanges?.["value"] || entry.fieldRanges?.["expression"]) {
    return true;
  }

  const lowerRule = rule.toLowerCase();
  if (
    lowerRule.includes("attribute") ||
    lowerRule.includes("param") ||
    lowerRule.includes("variable") ||
    lowerRule.includes("property") ||
    lowerRule.includes("assignment")
  ) {
    return true;
  }

  if (slice && (slice.includes("=") || slice.includes(":="))) {
    return true;
  }

  return false;
}

export function registerMiscEndpoints(context: LspContext) {
  // ── Live VS Code Settings Synchronization ────────────────────────────
  context.connection.onNotification("modelscript/updateSettings", (params: ModelScriptLspSettings) => {
    context.settings = {
      ...context.settings,
      ...params,
    };
    if (params?.languages) {
      globalLanguageRegistry.setLanguageConfig(params.languages);
    }
    if (params?.diagnostics && context.validationService) {
      context.validationService.diagnosticsConfig = {
        ...context.validationService.diagnosticsConfig,
        ...params.diagnostics,
      };
    }
    if (context.documents && context.validationService) {
      for (const doc of context.documents.all()) {
        context.validationService.validateTextDocument(doc);
      }
      context.validationService.requestCodeLensRefresh?.();
    }
  });

  // ── Viewport tracking for prioritized linting ────────────────────────
  // Client sends visible line ranges on scroll/edit. We convert to byte
  // ranges and store in ValidationService for viewport-aware linting.
  context.connection.onNotification(
    "modelscript/visibleRanges",
    (params: { uri: string; ranges: { startLine: number; endLine: number }[] }) => {
      if (!params.ranges || params.ranges.length === 0) {
        context.validationService.documentViewports.delete(params.uri);
        return;
      }
      // Use the bridge's PositionIndex to convert lines → character offsets,
      // falling back to DocumentManager's PositionIndex if bridge is not yet ready.
      const bridge = context.validationService.documentLSPBridges.get(params.uri) as
        { positions?: { positionToCharOffset?: (line: number, character: number) => number } } | undefined;
      const bridgePositions = bridge?.positions;
      const positions =
        bridgePositions && typeof bridgePositions.positionToCharOffset === "function"
          ? bridgePositions
          : context.documentManager?.getLineIndexForDoc?.(params.uri);

      if (positions && typeof positions.positionToCharOffset === "function") {
        // Merge all visible ranges into one encompassing offset range
        let minOffset = Infinity;
        let maxOffset = 0;
        for (const range of params.ranges) {
          const startOffset = positions.positionToCharOffset(range.startLine, 0);
          const endOffset = positions.positionToCharOffset(range.endLine + 1, 0); // end of last visible line
          if (startOffset < minOffset) minOffset = startOffset;
          if (endOffset > maxOffset) maxOffset = endOffset;
        }
        if (minOffset < maxOffset) {
          context.validationService.documentViewports.set(params.uri, {
            startOffset: minOffset,
            endOffset: maxOffset,
          });
        }
      }
    },
  );

  const getLoaderCtx = () => context.parserService?.getOrCreateLoaderContext?.();
  const getServerDistBase = () => context.parserService?.getServerDistBase?.();

  const syncAndRevalidateAll = () => {
    (context.validationService as { syncWorkspaceStateAfterIndex?: () => void }).syncWorkspaceStateAfterIndex?.();
    for (const doc of context.documents.all()) {
      context.validationService.validateTextDocument(doc);
    }
  };

  context.connection.onNotification(
    "modelscript/registryPackages",
    async (params: { packages: RegistryPackageInfo[] }) => {
      const loaderCtx = getLoaderCtx();
      if (loaderCtx) {
        context.connection.console.info(`[lsp] Received ${params.packages.length} registry packages from client.`);
        await loadRegistryPackages(params.packages, loaderCtx);
        syncAndRevalidateAll();
        context.connection.sendNotification("modelscript/projectTreeChanged");
      } else {
        context.connection.console.warn("[lsp] Received registry packages but loader context is not ready.");
      }
    },
  );

  const snapshotMountedLibraries = (): MountedLibraryInfo[] => {
    const overrides = context.state?.activeStandardOverrides;
    const list: MountedLibraryInfo[] = [];
    const seen = new Set<string>();
    for (const info of mountedLibraryMetadata.values()) {
      const copy = { ...info };
      const overrideVal = overrides?.get(normalizeLibraryName(info.name));
      if (overrideVal !== undefined) {
        copy.active = overrideVal;
      }
      list.push(copy);
      seen.add(info.name.toLowerCase());
    }
    for (const pack of globalLibraryRegistry.getStandardPacks()) {
      const norm = normalizeLibraryName(pack.packageName);
      if (seen.has(norm.toLowerCase()) || seen.has(pack.packageName.toLowerCase())) continue;
      const overrideVal = overrides?.get(norm);
      list.push({
        name: norm,
        version: pack.version,
        language: pack.languages?.[0] ?? "sysml2",
        category: "standard-pack",
        standardCode: pack.manifest.standard?.code,
        standardEdition: pack.manifest.standard?.edition,
        profile: pack.manifest.standard?.profile,
        activation: pack.manifest.standard?.activation ?? "import",
        active: overrideVal ?? pack.manifest.standard?.activation === "workspace",
      });
      seen.add(norm.toLowerCase());
    }
    const msl = mountedLibraryMetadata.get("Modelica");
    if (msl) {
      if (!seen.has("complex")) {
        list.push({
          name: "Complex",
          version: msl.version,
          language: "modelica",
          description: "Bundled with Modelica Standard Library",
        });
      }
      if (!seen.has("modelicaservices")) {
        list.push({
          name: "ModelicaServices",
          version: msl.version,
          language: "modelica",
          description: "Bundled with Modelica Standard Library",
        });
      }
    }
    return list;
  };

  const performInstallPackage = async (params: {
    name: string;
    version: string;
  }): Promise<{ ok: boolean; name: string; version: string; mounted: MountedLibraryInfo[]; error?: string }> => {
    const loaderCtx = getLoaderCtx();
    if (!loaderCtx) {
      context.connection.console.warn("[lsp] installDependency: loader context not ready.");
      return {
        ok: false,
        name: params.name,
        version: params.version,
        mounted: snapshotMountedLibraries(),
        error: "Language server loader context is not ready yet.",
      };
    }
    context.connection.console.info(`[lsp] Installing dependency ${params.name}@${params.version} from registry...`);
    context.connection.sendNotification("modelscript/status", {
      state: "loading",
      message: `Loading ${params.name}@${params.version}...`,
    });
    try {
      const swapped = await ensureLibraryVersionMounted(params, loaderCtx, getServerDistBase(), true);
      try {
        const packagesRoot = path.resolve(process.cwd(), ".modelscript", "packages");
        const pkgDir = path.resolve(packagesRoot, params.name);
        const relPkg = path.relative(packagesRoot, pkgDir);
        if (relPkg && !relPkg.startsWith("..") && !path.isAbsolute(relPkg)) {
          await globalLibraryRegistry.loadLibraryFromDir(pkgDir);
        }
      } catch {
        // Non-Node or non-library package; ignore
      }
      context.connection.console.info(`[lsp] Successfully loaded ${params.name}@${params.version}`);

      // Sync QueryEngines + re-validate all open documents immediately
      syncAndRevalidateAll();
      // Notify client that the project tree changed (refreshes Libraries panel)
      context.connection.sendNotification("modelscript/projectTreeChanged");
      context.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: `Loaded ${params.name}@${params.version}`,
      });

      if (swapped) {
        // Defer background indexing so immediate requests (e.g. modelscript/simulate) are not starved on the worker thread.
        setTimeout(() => {
          void (async () => {
            for (const langId of ["modelica", "sysml2"] as const) {
              const idx = context.workspaceManager.getWorkspaceIndex(langId);
              await idx?.indexRemainingInBackground?.(15);
            }
            syncAndRevalidateAll();
            context.connection.sendNotification("modelscript/projectTreeChanged");
          })();
        }, 2000);
      }
      return {
        ok: true,
        name: params.name,
        version: params.version,
        mounted: snapshotMountedLibraries(),
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      context.connection.console.error(`[lsp] Failed to install ${params.name}@${params.version}: ${errMsg}`);
      context.connection.sendNotification("modelscript/status", {
        state: "error",
        message: `Failed to load ${params.name}`,
      });
      return {
        ok: false,
        name: params.name,
        version: params.version,
        mounted: snapshotMountedLibraries(),
        error: errMsg,
      };
    }
  };

  const performUninstallPackage = (params: {
    name: string;
  }): { ok: boolean; evicted: number; mounted: MountedLibraryInfo[]; error?: string } => {
    const loaderCtx = getLoaderCtx();
    if (!loaderCtx) {
      context.connection.console.warn("[lsp] uninstallDependency: loader context not ready.");
      return {
        ok: false,
        evicted: 0,
        mounted: snapshotMountedLibraries(),
        error: "Language server loader context is not ready yet.",
      };
    }
    try {
      const evicted = unloadLibraryPackage(params.name, loaderCtx);
      context.state?.activeStandardOverrides?.delete(normalizeLibraryName(params.name));
      context.connection.console.info(`[lsp] Uninstalled dependency ${params.name} (${evicted} URIs evicted)`);
      syncAndRevalidateAll();
      context.connection.sendNotification("modelscript/projectTreeChanged");
      context.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: `Removed ${params.name}`,
      });
      return { ok: true, evicted, mounted: snapshotMountedLibraries() };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      context.connection.console.error(`[lsp] Failed to uninstall ${params.name}: ${errMsg}`);
      return { ok: false, evicted: 0, mounted: snapshotMountedLibraries(), error: errMsg };
    }
  };

  const performImportLibraryZip = async (params: {
    name?: string | undefined;
    version?: string | undefined;
    zipBase64?: string | undefined;
    url?: string | undefined;
  }): Promise<{
    ok: boolean;
    name: string;
    version: string;
    fileCount: number;
    mounted: MountedLibraryInfo[];
    error?: string;
  }> => {
    const loaderCtx = getLoaderCtx();
    if (!loaderCtx) {
      context.connection.console.warn("[lsp] importLibraryZip: loader context not ready.");
      return {
        ok: false,
        name: params.name || "ImportedLibrary",
        version: params.version || "1.0.0",
        fileCount: 0,
        mounted: snapshotMountedLibraries(),
        error: "Language server loader context is not ready yet.",
      };
    }
    try {
      const result = await importLibraryZip(params, loaderCtx);
      context.connection.console.info(
        `[lsp] Imported .zip library ${result.name}@${result.version} (${result.fileCount} files)`,
      );
      syncAndRevalidateAll();
      context.connection.sendNotification("modelscript/projectTreeChanged");
      context.connection.sendNotification("modelscript/status", {
        state: "ready",
        message: `Mounted ${result.name}@${result.version}`,
      });
      return {
        ok: true,
        name: result.name,
        version: result.version,
        fileCount: result.fileCount,
        mounted: snapshotMountedLibraries(),
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      context.connection.console.error(`[lsp] Failed to import library zip: ${errMsg}`);
      context.connection.sendNotification("modelscript/status", {
        state: "error",
        message: `Failed to import .zip library`,
      });
      return {
        ok: false,
        name: params.name || "ImportedLibrary",
        version: params.version || "1.0.0",
        fileCount: 0,
        mounted: snapshotMountedLibraries(),
        error: errMsg,
      };
    }
  };

  // Query currently mounted libraries & background loading state
  context.connection.onRequest(
    "modelscript/getMountedLibraries",
    (): { mounted: MountedLibraryInfo[]; loading: LoadingLibraryInfo[] } => ({
      mounted: snapshotMountedLibraries(),
      loading: [...loadingLibraryState.values()],
    }),
  );

  // Query and toggle active compliance standard-pack profiles
  const applyActiveStandardsUpdate = (params: {
    packageName?: string | undefined;
    active?: boolean | undefined;
    activePackages?: string[] | undefined;
  }) => {
    const state = (context.state ??= {} as LspContext["state"]);
    const overrides = (state.activeStandardOverrides ??= new Map<string, boolean>());
    if (Array.isArray(params.activePackages)) {
      const enabledSet = new Set(params.activePackages.map((p) => normalizeLibraryName(p)));
      for (const lib of snapshotMountedLibraries()) {
        if (lib.category === "standard-pack" || lib.standardCode) {
          const norm = normalizeLibraryName(lib.name);
          const next = enabledSet.has(norm);
          overrides.set(norm, next);
          const existing = mountedLibraryMetadata.get(norm);
          if (existing) mountedLibraryMetadata.set(norm, { ...existing, active: next });
        }
      }
    } else if (typeof params.packageName === "string" && typeof params.active === "boolean") {
      const norm = normalizeLibraryName(params.packageName);
      overrides.set(norm, params.active);
      const existing = mountedLibraryMetadata.get(norm);
      if (existing) {
        mountedLibraryMetadata.set(norm, { ...existing, active: params.active });
      }
    }
    context.validationService.setStandardOverrides(overrides);
    syncAndRevalidateAll();
    context.connection.sendNotification("modelscript/projectTreeChanged");
    return {
      ok: true,
      standards: snapshotMountedLibraries().filter((m) => m.category === "standard-pack" || Boolean(m.standardCode)),
    };
  };

  context.connection.onRequest("modelscript/getActiveStandards", () => ({
    standards: snapshotMountedLibraries().filter((m) => m.category === "standard-pack" || Boolean(m.standardCode)),
    overrides: Object.fromEntries(context.state?.activeStandardOverrides ?? new Map<string, boolean>()),
  }));

  context.connection.onRequest("modelscript/setActiveStandards", applyActiveStandardsUpdate);
  context.connection.onNotification("modelscript/setActiveStandards", applyActiveStandardsUpdate);

  // Request-based package lifecycle endpoints (awaited by Ansatz & VS Code Package Hub)
  context.connection.onRequest("modelscript/installPackage", performInstallPackage);
  context.connection.onRequest("modelscript/uninstallPackage", performUninstallPackage);
  context.connection.onRequest(
    "modelscript/registerLibraryBundle",
    async (params: {
      pkgJson: { name: string; version?: string; modelscript: ModelscriptLibraryManifest };
      symbols?: LibrarySymbolStub[] | undefined;
      diagrams?: DiagramComponentSpec[] | undefined;
      tables?: Record<string, unknown> | undefined;
      wasmBase64?: string | undefined;
    }) => {
      const wasmBytes = params.wasmBase64 ? decodeBase64Bytes(String(params.wasmBase64)) : undefined;
      const loaded = globalLibraryRegistry.registerLibraryBundle(params.pkgJson, {
        symbols: params.symbols ?? [],
        diagrams: params.diagrams,
        tables: params.tables,
        wasmBytes,
      });
      if (loaded.wasmBytes && !loaded.wasmExports) {
        await globalLibraryRegistry.ensureWasmInstantiated(loaded);
      }
      const normName = normalizeLibraryName(loaded.packageName);
      const msx = params.pkgJson.modelscript;
      if (msx && (msx.category === "standard-pack" || msx.standard)) {
        mountedLibraryMetadata.set(normName, {
          name: normName,
          version: loaded.version,
          language: msx.languages?.[0] ?? msx.language ?? "sysml2",
          category: "standard-pack",
          standardCode: msx.standard?.code,
          standardEdition: msx.standard?.edition,
          profile: msx.standard?.profile,
          activation: msx.standard?.activation ?? "import",
        });
      }
      syncAndRevalidateAll();
      context.connection.sendNotification("modelscript/projectTreeChanged");
      return { ok: true, packageName: loaded.packageName, symbolCount: loaded.symbols.length };
    },
  );
  context.connection.onRequest("modelscript/importLibraryZipReq", performImportLibraryZip);

  // Backwards-compatible notification handlers
  context.connection.onNotification(
    "modelscript/installDependency",
    async (params: { name: string; version: string }) => {
      await performInstallPackage(params);
    },
  );

  context.connection.onNotification("modelscript/uninstallDependency", (params: { name: string }) => {
    performUninstallPackage(params);
  });

  context.connection.onNotification(
    "modelscript/importLibraryZip",
    async (params: { name?: string; version?: string; zipBase64?: string; url?: string }) => {
      await performImportLibraryZip(params);
    },
  );

  context.connection.onRequest("modelscript/getTraceabilityMatrix", (_params: { uri: string }) => {
    try {
      const db = context.workspaceManager.unifiedWorkspace.getIndex();
      return getTraceabilityMatrix(db); // Do not filter by uri to show workspace-level traceability
    } catch (e) {
      console.error("[traceability] Error:", e);
      return { sources: [], targets: [], links: [] };
    }
  });

  context.connection.onRequest("modelscript/resolveMarkdownVars", (): { values: Record<string, string> } => {
    try {
      const db = context.workspaceManager.unifiedWorkspace.getIndex();
      const values: Record<string, string> = {};

      for (const entry of db.symbols.values()) {
        if (!entry.name) continue;

        const qualifiedName = getCompositeName(entry, db);

        if (entry.resourceId) {
          const doc = context.documents.get(entry.resourceId);
          const fullText = doc?.getText() ?? context.documentManager.documentTrees.get(entry.resourceId)?.text;
          const startOff = entry.startOffset;
          const endOff = entry.endOffset;
          if (fullText && startOff != null && endOff != null && endOff > startOff) {
            const sourceText = fullText.substring(startOff, endOff);
            if (!isValueCarryingEntry(entry, sourceText)) continue;

            let valueText: string | undefined;

            // OWL2 DataPropertyAssertion
            if (entry.ruleName === "DataPropertyAssertion" || sourceText.startsWith("DataPropertyAssertion")) {
              const cachedTree = context.documentManager?.documentTrees?.get(entry.resourceId)?.tree;
              if (cachedTree?.rootNode) {
                const stack = [cachedTree.rootNode];
                while (stack.length > 0) {
                  const n = stack.pop();
                  if (!n) continue;
                  if (
                    n.type === "StringLiteral" &&
                    n.startIndex !== undefined &&
                    n.endIndex !== undefined &&
                    n.startIndex >= startOff &&
                    n.endIndex <= endOff
                  ) {
                    valueText = extractFirstQuotedLiteral(n.text);
                    if (valueText !== undefined) break;
                  }
                  for (const c of n.children || []) stack.push(c);
                }
              }
              if (valueText === undefined) {
                valueText = extractFirstQuotedLiteral(sourceText);
              }
            } else {
              const eqIdx = sourceText.indexOf("=");
              if (eqIdx !== -1) {
                valueText = trimTrailingChars(sourceText.substring(eqIdx + 1), ";} \t\r\n").trim();
              }
            }

            if (valueText) {
              values[qualifiedName] = valueText;
              if (!values[entry.name]) {
                values[entry.name] = valueText;
              }
            }
          }
        }
      }
      return { values };
    } catch (e) {
      console.error("[resolveMarkdownVars] Error:", e);
      return { values: {} };
    }
  });

  context.connection.onRequest("modelscript/computeWritebackEdit", async (params: ComputeWritebackEditParams) => {
    const { computeWritebackEdit } = await import("../services/writeback-service.js");
    return await computeWritebackEdit(context, params);
  });

  context.connection.onRequest(
    "modelscript/resolveMarkdownContent",
    (): {
      requirements: Record<string, { rows: { reqId: string; name: string; text: string; status: string }[] }>;
      diagrams: Record<
        string,
        { components: { name: string; type: string }[]; connections: { from: string; to: string }[] }
      >;
    } => {
      return { requirements: {}, diagrams: {} };
    },
  );

  context.connection.onRequest(
    "modelscript/generateCommitMessage",
    async (params: { changes: { uri: string; oldText: string; newText: string }[] }) => {
      let descriptions: string[] = [];
      let scopeStr = "";

      for (const change of params.changes) {
        const isSysml = change.uri.endsWith(".sysml") || change.uri.endsWith(".sysml2");
        const isModelica = change.uri.endsWith(".mo");
        if (!isSysml && !isModelica) continue;

        scopeStr = isSysml ? "sysml" : "modelica";

        const langParser = context.parserService.getParser(isSysml ? "sysml2" : "modelica") as
          DiffParserLike | null | undefined;

        if (!langParser) continue;

        let oldTree: DiffTreeLike | null = null;
        let newTree: DiffTreeLike | null = null;
        try {
          oldTree = langParser.parse(change.oldText);
          const oldWs = isSysml ? createSysML2WorkspaceIndex() : createModelicaWorkspaceIndex();
          oldWs.reindexDocument(
            change.uri,
            () => oldTree!.rootNode as ReturnType<NonNullable<Parameters<typeof oldWs.reindexDocument>[1]>>,
          );
          const oldIndex = oldWs.getIndex();
          const oldDb = isSysml ? createSysML2QueryEngine(oldIndex) : createModelicaQueryEngine(oldIndex);
          const oldRootEntries = oldIndex.childrenOf.get(null) || [];

          newTree = langParser.parse(change.newText);
          const newWs = isSysml ? createSysML2WorkspaceIndex() : createModelicaWorkspaceIndex();
          newWs.reindexDocument(
            change.uri,
            () => newTree!.rootNode as ReturnType<NonNullable<Parameters<typeof newWs.reindexDocument>[1]>>,
          );
          const newIndex = newWs.getIndex();
          const newDb = isSysml ? createSysML2QueryEngine(newIndex) : createModelicaQueryEngine(newIndex);
          const newRootEntries = newIndex.childrenOf.get(null) || [];

          const maxLen = Math.max(oldRootEntries.length, newRootEntries.length);
          for (let i = 0; i < maxLen; i++) {
            const oldId = i < oldRootEntries.length ? oldRootEntries[i]! : null;
            const newId = i < newRootEntries.length ? newRootEntries[i]! : null;

            if (oldId === null && newId === null) continue;

            const oldNode = oldId !== null ? { id: oldId, db: oldDb.toQueryDB() } : null;
            const newNode = newId !== null ? { id: newId, db: newDb.toQueryDB() } : null;

            const diff = computeSemanticDiff(
              oldNode as Parameters<typeof computeSemanticDiff>[0],
              newNode as Parameters<typeof computeSemanticDiff>[1],
              {
                orderAgnostic: true,
              },
            );

            const collectDescriptions = (edit: SemanticEdit) => {
              if (edit.description) descriptions.push(edit.description);
              if (edit.children) {
                for (const child of edit.children) collectDescriptions(child);
              }
            };

            collectDescriptions(diff);
          }
        } catch (e) {
          console.error("Diff error", e);
        } finally {
          oldTree?.delete?.();
          newTree?.delete?.();
        }
      }

      if (descriptions.length === 0) {
        return { commitMessage: `chore(${scopeStr || "core"}): update files` };
      }

      // Aggregate descriptions
      const uniqueDescs = Array.from(new Set(descriptions));
      const commitMsg = `feat(${scopeStr}): ${uniqueDescs.join(", ")}`;
      return { commitMessage: commitMsg };
    },
  );

  context.connection.onRequest(
    "modelscript/getSemanticDiff",
    async (params: { uri: string; oldText: string; newText: string }): Promise<{ diffs: FlatSemanticEdit[] }> => {
      const plugin =
        globalLanguageRegistry.getPluginForLanguageIdOrUri(undefined, params.uri) ||
        globalLanguageRegistry.getPluginForUri(params.uri);
      const isSysml =
        params.uri.endsWith(".sysml") ||
        params.uri.endsWith(".sysml2") ||
        plugin?.id === "sysml2" ||
        plugin?.id === "sysml";
      const isModelica = params.uri.endsWith(".mo") || plugin?.id === "modelica";
      const langId = plugin?.id ?? (isSysml ? "sysml2" : isModelica ? "modelica" : null);

      const langParser =
        ((langId ? context.parserService.getParser(langId) : null) as DiffParserLike | null | undefined) ??
        (context.parserService.getParserForUri(params.uri) as DiffParserLike | null | undefined);

      if (!langParser) return { diffs: [] };

      let oldTree: DiffTreeLike | null = null;
      let newTree: DiffTreeLike | null = null;
      try {
        const docLang = langId ?? (isSysml ? "sysml2" : "modelica");
        const oldDoc = TextDocument.create(params.uri, docLang, 1, params.oldText);
        const newDoc = TextDocument.create(params.uri, docLang, 1, params.newText);

        const createWsIndex = (): DiffWorkspaceIndexLike => {
          if (isSysml) return createSysML2WorkspaceIndex();
          if (isModelica) return createModelicaWorkspaceIndex();
          if (langId) {
            const pluginWithFactory = plugin as { createWorkspaceIndex?: () => DiffWorkspaceIndexLike } | undefined;
            if (typeof pluginWithFactory?.createWorkspaceIndex === "function") {
              return pluginWithFactory.createWorkspaceIndex();
            }
          }
          return createModelicaWorkspaceIndex();
        };

        const createDb = (idx: SymbolIndex) => {
          if (isSysml) return createSysML2QueryEngine(idx);
          if (isModelica) return createModelicaQueryEngine(idx);
          if (plugin?.createQueryEngine) {
            try {
              return plugin.createQueryEngine(idx, null);
            } catch {
              // Plugin query engine creation failed; fall back to default Modelica query engine below.
            }
          }
          return createModelicaQueryEngine(idx);
        };

        oldTree = langParser.parse(params.oldText);
        const oldWs = createWsIndex();
        if (typeof oldWs.reindexDocument === "function") {
          oldWs.reindexDocument(params.uri, () => oldTree!.rootNode as never);
        }
        const oldIndex = (typeof oldWs.getIndex === "function" ? oldWs.getIndex() : oldWs) as SymbolIndex;
        const oldDb = createDb(oldIndex);
        const oldRootEntries = oldIndex?.childrenOf?.get(null) || [];

        newTree = langParser.parse(params.newText);
        const newWs = createWsIndex();
        if (typeof newWs.reindexDocument === "function") {
          newWs.reindexDocument(params.uri, () => newTree!.rootNode as never);
        }
        const newIndex = (typeof newWs.getIndex === "function" ? newWs.getIndex() : newWs) as SymbolIndex;
        const newDb = createDb(newIndex);
        const newRootEntries = newIndex?.childrenOf?.get(null) || [];

        // Pre-build index of safety critical symbols and their mitigations
        const hazardSymbols = new Map<string, SymbolEntry>();
        const mitigatedReqs = new Map<string, string>();

        for (const entry of newIndex.symbols.values()) {
          const rule = entry.ruleName ?? "";
          if (rule.includes("Hazard") || entry.metadata?.["defKind"] === "hazard" || entry.metadata?.["hazardId"]) {
            hazardSymbols.set(entry.name, entry);
            if (entry.metadata?.["mitigates"]) {
              mitigatedReqs.set(
                String(entry.metadata["mitigates"]),
                String(entry.metadata?.["hazardId"] ?? entry.name),
              );
            }
            if (entry.metadata?.["mitigatedBy"]) {
              mitigatedReqs.set(
                String(entry.metadata["mitigatedBy"]),
                String(entry.metadata?.["hazardId"] ?? entry.name),
              );
            }
          }
        }

        const maxLen = Math.max(oldRootEntries.length, newRootEntries.length);
        const diffs: FlatSemanticEdit[] = [];

        for (let i = 0; i < maxLen; i++) {
          const oldId = i < oldRootEntries.length ? oldRootEntries[i]! : null;
          const newId = i < newRootEntries.length ? newRootEntries[i]! : null;

          if (oldId === null && newId === null) continue;

          const oldNode = oldId !== null ? { id: oldId, db: oldDb.toQueryDB() } : null;
          const newNode = newId !== null ? { id: newId, db: newDb.toQueryDB() } : null;

          const diff = computeSemanticDiff(
            oldNode as Parameters<typeof computeSemanticDiff>[0],
            newNode as Parameters<typeof computeSemanticDiff>[1],
            {
              orderAgnostic: true,
            },
          );

          const flattenDiffs = (edit: SemanticEdit) => {
            if (edit.action !== "none" && edit.description) {
              const flatEdit: FlatSemanticEdit = {
                action: edit.action,
                description: edit.description,
              };

              if (edit.oldEntry) {
                const startPos = oldDoc.positionAt(edit.oldEntry.startOffset);
                const endPos = oldDoc.positionAt(edit.oldEntry.endOffset);
                flatEdit.oldRange = {
                  startLine: startPos.line,
                  startCharacter: startPos.character,
                  endLine: endPos.line,
                  endCharacter: endPos.character,
                };
                flatEdit.kind = edit.oldEntry.kind;
              }

              if (edit.newEntry) {
                const startPos = newDoc.positionAt(edit.newEntry.startOffset);
                const endPos = newDoc.positionAt(edit.newEntry.endOffset);
                flatEdit.newRange = {
                  startLine: startPos.line,
                  startCharacter: startPos.character,
                  endLine: endPos.line,
                  endCharacter: endPos.character,
                };
                flatEdit.kind = edit.newEntry.kind;
              }

              // Assess regulatory impact (ISO 14971 / IEC 62304)
              const targetEntry = edit.newEntry ?? edit.oldEntry;
              if (targetEntry) {
                const entryName = targetEntry.name ?? "";
                const isHazard =
                  hazardSymbols.has(entryName) ||
                  targetEntry.ruleName?.includes("Hazard") ||
                  Boolean(targetEntry.metadata?.["hazardId"]);
                const isMitigated =
                  mitigatedReqs.has(entryName) ||
                  Boolean(targetEntry.metadata?.["mitigates"]) ||
                  Boolean(targetEntry.metadata?.["mitigatedBy"]);
                const isReq = targetEntry.ruleName?.includes("Requirement") || Boolean(targetEntry.metadata?.["reqId"]);

                if (isHazard || isMitigated || isReq) {
                  const hId = isHazard
                    ? (targetEntry.metadata?.["hazardId"] ?? targetEntry.name)
                    : (mitigatedReqs.get(entryName) ?? (targetEntry.metadata?.["mitigates"] as string) ?? undefined);
                  flatEdit.regulatoryImpact = {
                    isSafetyCritical: true,
                    hazardId: hId ? String(hId) : undefined,
                    hazardName: isHazard ? targetEntry.name : undefined,
                    requirementId: isReq ? String(targetEntry.metadata?.["reqId"] ?? targetEntry.name) : undefined,
                    riskSeverity: Number(targetEntry.metadata?.["severity"] ?? 4),
                    invalidatedLinks: [
                      {
                        targetName: `${entryName}_verification`,
                        targetKind: "verification_case",
                        reason: `Semantic change in ${targetEntry.kind} '${entryName}' marks downstream verification suspect`,
                      },
                    ],
                  };
                }
              }

              diffs.push(flatEdit);
            }

            if (edit.children) {
              for (const child of edit.children) flattenDiffs(child);
            }
          };

          flattenDiffs(diff);
        }

        return { diffs };
      } catch (e) {
        console.error("getSemanticDiff error", e);
        return { diffs: [] };
      } finally {
        oldTree?.delete?.();
        newTree?.delete?.();
      }
    },
  );

  context.connection.onRequest("modelscript/runVerification", async (params: { uri: string }) => {
    return context.validationService.runVerificationForUri(params.uri);
  });

  context.connection.onRequest(
    "modelscript/runFormalLints",
    async (params: {
      uri: string;
      includeFormal?: boolean | undefined;
      includeCompilerLints?: boolean | undefined;
    }) => {
      const startedAt = Date.now();
      const targetUri = params?.uri ?? "";
      const includeFormal = params?.includeFormal !== false;
      const includeCompilerLints = params?.includeCompilerLints !== false;

      if (!targetUri) {
        return {
          ok: false,
          diagnostics: [],
          formalCount: 0,
          compilerCount: 0,
          error: "Missing target document URI.",
        };
      }

      try {
        const liveDoc = context.documents.get(targetUri);
        const wm: typeof context.workspaceManager & {
          getFileContent?: (uri: string) => Promise<string | undefined>;
        } = context.workspaceManager;
        const docText =
          liveDoc?.getText() ??
          (await wm.getFileContent?.(targetUri)) ??
          context.documentManager?.documents?.get(targetUri)?.getText() ??
          "";
        const lowerUri = targetUri.toLowerCase();
        const isSysml =
          liveDoc?.languageId === "sysml2" ||
          lowerUri.endsWith(".sysml") ||
          lowerUri.endsWith(".sysml2") ||
          lowerUri.endsWith(".kerml");
        const isModelica = liveDoc?.languageId === "modelica" || lowerUri.endsWith(".mo");
        const langId = isSysml ? "sysml2" : isModelica ? "modelica" : (liveDoc?.languageId ?? "modelscript");
        const textDoc = liveDoc ?? TextDocument.create(targetUri, langId, 1, docText);

        type OutDiag = {
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          severity: 1 | 2 | 3 | 4;
          code?: string | number | undefined;
          source?: string | undefined;
          message: string;
        };

        const outDiagnostics: OutDiag[] = [];
        const seenKeys = new Set<string>();
        let formalCount = 0;
        let compilerCount = 0;

        const pushDiag = (d: OutDiag, kind: "formal" | "compiler") => {
          const key = `${d.range.start.line}:${d.range.start.character}:${d.code ?? ""}:${d.message}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          outDiagnostics.push(d);
          if (kind === "formal") formalCount++;
          else compilerCount++;
        };

        await (context.parserService as { ensureParserInitialized?: (id: string) => Promise<unknown> })
          ?.ensureParserInitialized?.(langId)
          ?.catch?.(() => {});
        const parser = context.parserService?.getParser?.(langId) as
          | { parse(src: string): { rootPtr?: number; rootNode?: unknown; delete?: () => void } | null }
          | null
          | undefined;
        const facade = context.parserService?.getFacade?.(langId) as
          | {
              loadSource?: (src: string) => void;
              getDiagnostics?: (
                rootPtr: number,
                start?: number,
                end?: number,
                src?: string,
              ) => Array<{
                startOffset?: number;
                endOffset?: number;
                severity?: number;
                code?: string | number;
                message?: string;
              }>;
            }
          | null
          | undefined;

        const parsedTree = parser && docText ? parser.parse(docText) : null;
        try {
          if (includeCompilerLints && parsedTree && facade && typeof facade.getDiagnostics === "function") {
            const rootNodeObj = parsedTree.rootNode as { id?: number; ptr?: number } | undefined;
            const rootPtr = parsedTree.rootPtr ?? rootNodeObj?.id ?? rootNodeObj?.ptr ?? 0;
            if (rootPtr) {
              if (typeof facade.loadSource === "function") facade.loadSource(docText);
              const wasmDiags = facade.getDiagnostics(rootPtr, 0, 0, docText) ?? [];
              const sysmlMod = isSysml ? await import("@modelscript/sysml2") : null;
              for (const wd of wasmDiags) {
                const startOff = Math.max(0, wd.startOffset ?? 0);
                const endOff = Math.max(startOff + 1, wd.endOffset ?? startOff + 1);
                const codeNum = typeof wd.code === "number" ? wd.code : undefined;
                const sysmlDef =
                  isSysml && codeNum !== undefined ? sysmlMod?.getSysML2ErrorCodeDef(codeNum) : undefined;
                const sev: 1 | 2 | 3 =
                  wd.severity === 1
                    ? 1
                    : wd.severity === 2
                      ? 2
                      : sysmlDef?.severity === "warning"
                        ? 2
                        : sysmlDef?.severity === "info"
                          ? 3
                          : 1;
                const codeStr =
                  codeNum !== undefined
                    ? `${isSysml ? "S" : isModelica ? "M" : ""}${codeNum}`
                    : wd.code !== undefined
                      ? String(wd.code)
                      : undefined;
                pushDiag(
                  {
                    range: {
                      start: textDoc.positionAt(startOff),
                      end: textDoc.positionAt(Math.min(docText.length, endOff)),
                    },
                    severity: sev,
                    ...(codeStr !== undefined ? { code: codeStr } : {}),
                    source: `${langId}-compiler`,
                    message: wd.message || "Compiler diagnostic",
                  },
                  "compiler",
                );
              }
            }
          }

          if (includeFormal && isSysml) {
            const sysmlMod = await import("@modelscript/sysml2");
            if (parser && typeof sysmlMod.registerSysmlWasmParser === "function") {
              sysmlMod.registerSysmlWasmParser(
                parser as unknown as Parameters<typeof sysmlMod.registerSysmlWasmParser>[0],
              );
            }
            const wsIdx = createSysML2WorkspaceIndex();
            if (parser && typeof sysmlMod.loadEmbeddedKerMLStdlib === "function") {
              sysmlMod.loadEmbeddedKerMLStdlib(
                wsIdx,
                parser as unknown as Parameters<typeof sysmlMod.loadEmbeddedKerMLStdlib>[1],
              );
            }
            if (parsedTree?.rootNode) {
              wsIdx.register(
                targetUri,
                () => parsedTree.rootNode as ReturnType<NonNullable<Parameters<typeof wsIdx.register>[1]>>,
                docText,
              );
            }
            const localUnified = await wsIdx.getIndexAsync();
            const qe = createSysML2QueryEngine(
              localUnified,
              parsedTree as unknown as Parameters<typeof createSysML2QueryEngine>[1],
            );
            const formalDiags = await sysmlMod.verifySysML2Formal(qe.toQueryDB(), { resourceUri: targetUri });
            for (const fd of formalDiags) {
              const startOff = Math.max(0, fd.startOffset ?? 0);
              const endOff = Math.max(startOff + 1, fd.endOffset ?? startOff + 1);
              const sev: 1 | 2 | 3 = fd.severity === "error" ? 1 : fd.severity === "warning" ? 2 : 3;
              pushDiag(
                {
                  range: {
                    start: textDoc.positionAt(Math.min(docText.length, startOff)),
                    end: textDoc.positionAt(Math.min(docText.length, endOff)),
                  },
                  severity: sev,
                  code: `S${fd.code}`,
                  source: `sysml2-formal (${fd.engine})`,
                  message: fd.message,
                },
                "formal",
              );
            }
          } else if (includeFormal && isModelica && docText) {
            try {
              const { Context } = await import("@modelscript/modelica/context");
              if (parser) {
                Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
              }
              const memFiles = new Map<string, string>([[targetUri, docText]]);
              const memFs = {
                readFile: (p: string) => memFiles.get(p) ?? "",
                exists: (p: string) => memFiles.has(p),
                readDir: () => [] as string[],
                isDir: () => false,
              };
              const ctx = new Context(
                memFs as unknown as ConstructorParameters<typeof Context>[0],
                undefined,
                undefined,
                {
                  loadStdlib: false,
                },
              );
              ctx.load(docText, targetUri);
              const wsIdx: typeof ctx.workspaceIndex & {
                getUnifiedIndex?: () => {
                  symbols?: {
                    values?: () => Iterable<{ kind?: string; name?: string; resourceId?: string }>;
                  };
                };
              } = ctx.workspaceIndex;
              const loadedSymbols = Array.from(wsIdx?.getUnifiedIndex?.()?.symbols?.values?.() ?? []).filter(
                (s) => (s.kind === "Class" || s.kind === "Def") && s.name,
              );
              const targetClass = loadedSymbols.length > 0 ? loadedSymbols[loadedSymbols.length - 1]!.name : undefined;
              if (targetClass && typeof ctx.verifyFormal === "function") {
                const rawFormal: unknown = Reflect.apply(ctx.verifyFormal, ctx, [targetClass]);
                const formalDiags = (Array.isArray(rawFormal) ? rawFormal : []) as Array<{
                  severity?: string;
                  code?: number;
                  message: string;
                  range?: {
                    startPosition: { row: number; column: number };
                    endPosition: { row: number; column: number };
                  };
                }>;
                for (const fd of formalDiags) {
                  const sev: 1 | 2 | 3 = fd.severity === "error" ? 1 : fd.severity === "warning" ? 2 : 3;
                  const startPos = fd.range
                    ? { line: fd.range.startPosition.row, character: fd.range.startPosition.column }
                    : { line: 0, character: 0 };
                  const endPos = fd.range
                    ? {
                        line: fd.range.endPosition.row,
                        character: Math.max(fd.range.endPosition.column, fd.range.startPosition.column + 1),
                      }
                    : { line: 0, character: 1 };
                  pushDiag(
                    {
                      range: { start: startPos, end: endPos },
                      severity: sev,
                      ...(fd.code !== undefined ? { code: `M${fd.code}` } : {}),
                      source: "modelica-formal",
                      message: fd.message,
                    },
                    "formal",
                  );
                }
              }
            } catch {
              // Formal verification pass is best-effort; return collected compiler diagnostics.
            }
          }
        } finally {
          parsedTree?.delete?.();
        }

        return {
          ok: true,
          uri: targetUri,
          diagnostics: outDiagnostics,
          formalCount,
          compilerCount,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        return {
          ok: false,
          uri: targetUri,
          diagnostics: [],
          formalCount: 0,
          compilerCount: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ── Digital Thread Hypergraph Explorer Endpoints ────────────────────
  const sharedHypergraph = context.workspaceManager.hypergraph;
  const sharedMetadataMap = context.workspaceManager.threadMetadataMap;

  context.connection.onRequest("modelscript/getThreadGraph", async () => {
    return ThreadExplorerProvider.buildThreadGraph(sharedHypergraph, sharedMetadataMap);
  });

  context.connection.onRequest("modelscript/getBlastRadius", async (params: { domain: string; nodeId: number }) => {
    return ThreadExplorerProvider.getBlastRadius(sharedHypergraph, params.domain, params.nodeId);
  });

  context.connection.onRequest(
    "modelscript/reconcileThreadSlot",
    async (params: {
      slot: number;
      strategy?: "physics-simplex" | "source-wins" | "target-wins" | "custom" | undefined;
      customValue?: number | undefined;
    }) => {
      const { slot, strategy = "physics-simplex", customValue } = params;
      const isConflicted = sharedHypergraph.isConflicted(slot);
      const isStale = sharedHypergraph.isStale(slot);

      if (!isConflicted && !isStale) {
        return { success: true, message: "Slot not in conflict or stale.", reconciledValue: undefined };
      }

      const domainIndexToName = DOMAIN_INDEX_TO_NAME as Record<number, string>;
      let consensusVal = customValue;
      if (consensusVal === undefined) {
        // Evaluate physics-simplex balance across aligned domain elements
        const elements = context.workspaceManager.findAlignedElementsBySlot(slot);
        const vals: number[] = [];
        for (const el of elements) {
          const m = el.properties?.["mass"] ?? el.properties?.["voltage"] ?? el.properties?.["value"];
          if (typeof m === "number") vals.push(m);
        }
        if (vals.length >= 2) {
          vals.sort((a, b) => a - b);
          const mid = Math.floor(vals.length / 2);
          consensusVal = vals.length % 2 !== 0 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
        } else if (vals.length === 1) {
          consensusVal = vals[0];
        } else {
          // Preserve existing property on any domain node associated with this slot
          let existingVal: number | undefined;
          for (let dom = 0; dom < 16; dom++) {
            const nodeId = sharedHypergraph.getDomainNode(slot, dom);
            if (nodeId && nodeId > 0) {
              const domName = domainIndexToName[dom] ?? "unknown";
              const meta = sharedMetadataMap.get(`${domName}:${nodeId}`);
              const p = meta?.properties?.["mass"] ?? meta?.properties?.["voltage"] ?? meta?.properties?.["value"];
              if (typeof p === "number") {
                existingVal = p;
                break;
              }
            }
          }
          consensusVal = existingVal ?? 0.0;
        }
      }

      // Clear conflict and stale flags in hypergraph
      sharedHypergraph.recordTheorySat(slot);

      // Update properties in threadMetadataMap
      for (let dom = 0; dom < 16; dom++) {
        const nodeId = sharedHypergraph.getDomainNode(slot, dom);
        if (nodeId && nodeId > 0) {
          const domName = domainIndexToName[dom] ?? "unknown";
          const key = `${domName}:${nodeId}`;
          const meta = sharedMetadataMap.get(key);
          if (meta && meta.properties) {
            if (meta.properties["mass"] !== undefined) meta.properties["mass"] = consensusVal;
            if (meta.properties["voltage"] !== undefined) meta.properties["voltage"] = consensusVal;
            if (meta.properties["value"] !== undefined) meta.properties["value"] = consensusVal;
          }
        }
      }

      return {
        success: true,
        slot,
        reconciledValue: consensusVal,
        strategy,
      };
    },
  );

  context.connection.onRequest(
    "modelscript/generateMultibodyReport",
    async (params: {
      uri: string;
      format?: "html" | "sarif" | "junit" | "ctrf";
      maxNadalYOverQ?: number;
      maxLateralForceYKn?: number;
      nominalAxleLoadQ0Kn?: number;
      sperlingVerticalWz?: number;
      sperlingHorizontalWz?: number;
      crossWindUnloadingRatio?: number;
      equivalentConicity?: number;
    }) => {
      const { generateGensysMultibodyReport } = await import("@modelscript/gensys");
      const modelName = params.uri ? path.basename(params.uri, path.extname(params.uri)) : "MultibodyModel";
      return generateGensysMultibodyReport({ ...params, modelName });
    },
  );

  // ── MQTT Co-Simulation Participant Registry ──────────────────────────
  interface MqttParticipantVariable {
    name: string;
    causality: "input" | "output" | "parameter" | "local";
    type: string;
    unit?: string | undefined;
    start?: number | undefined;
    description?: string | undefined;
  }

  interface MqttParticipantRecord {
    participantId: string;
    modelName: string;
    type: string;
    classKind: string;
    description?: string | undefined;
    variables: MqttParticipantVariable[];
    iconSvg?: string | undefined;
    timestamp: string;
    uri?: string | undefined;
    sessionId?: string | undefined;
  }

  const mqttParticipants = new Map<string, MqttParticipantRecord>();

  context.connection.onRequest(
    "modelscript/getMqttParticipants",
    (params?: { sessionId?: string | undefined }): { participants: MqttParticipantRecord[] } => {
      const all = Array.from(mqttParticipants.values());
      const participants = params?.sessionId ? all.filter((p) => p.sessionId === params.sessionId) : all;
      return { participants };
    },
  );

  context.connection.onRequest(
    "modelscript/publishParticipant",
    (params: {
      uri?: string | undefined;
      sessionId?: string | undefined;
      participantId?: string | undefined;
      modelName?: string | undefined;
      type?: string | undefined;
      classKind?: string | undefined;
      description?: string | undefined;
      variables?: MqttParticipantVariable[] | undefined;
      iconSvg?: string | undefined;
    }): { ok: boolean; participantId?: string | undefined; error?: string | undefined } => {
      if (!params?.uri && !params?.participantId) {
        return { ok: false, error: "Missing uri or participantId." };
      }

      const uri = params.uri;
      let modelName = params.modelName;
      let classKind = params.classKind ?? "model";
      const variables: MqttParticipantVariable[] = Array.isArray(params.variables) ? [...params.variables] : [];

      if (uri) {
        try {
          const db = context.workspaceManager.unifiedWorkspace.getIndex();
          for (const entry of db.symbols.values()) {
            if (entry.resourceId !== uri || !entry.name) continue;
            const rule = entry.ruleName ?? "";
            if (
              !modelName &&
              (rule === "ClassDefinition" ||
                rule === "class_definition" ||
                rule === "PartDefinition" ||
                rule === "Package")
            ) {
              modelName = entry.name;
              if (typeof entry.metadata?.["classKind"] === "string") {
                classKind = entry.metadata["classKind"];
              }
            }
            if (
              variables.length < 256 &&
              !Array.isArray(params.variables) &&
              (rule === "ComponentDeclaration" ||
                rule === "component_declaration" ||
                rule === "AttributeUsage" ||
                rule === "PortUsage")
            ) {
              const rawCausality = String(entry.metadata?.["causality"] ?? entry.metadata?.["variability"] ?? "local");
              const causality: MqttParticipantVariable["causality"] =
                rawCausality === "input" || rawCausality === "output" || rawCausality === "parameter"
                  ? rawCausality
                  : "local";
              variables.push({
                name: entry.name,
                causality,
                type: String(entry.metadata?.["typeName"] ?? entry.metadata?.["type"] ?? "Real"),
              });
            }
          }
        } catch {
          // Fallback to URI-derived metadata if workspace index is unavailable
        }
      }

      if (!modelName) {
        modelName = uri ? path.basename(uri, path.extname(uri)) || "Model" : (params.participantId ?? "Model");
      }

      const participantId = params.participantId ?? (params.sessionId ? `${params.sessionId}:${modelName}` : modelName);
      const key = uri ?? participantId;

      mqttParticipants.set(key, {
        participantId,
        modelName,
        type: params.type ?? "js-simulator",
        classKind,
        description: params.description,
        variables,
        iconSvg: params.iconSvg,
        timestamp: new Date().toISOString(),
        uri,
        sessionId: params.sessionId,
      });

      return { ok: true, participantId };
    },
  );
}
