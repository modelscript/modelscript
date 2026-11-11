// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "@modelscript/modelica";
import { computeComponentInsert } from "@modelscript/modelica/diagram";
import type { ClassHierarchyNode, ComponentTreeNode, TreeNodeInfo } from "@modelscript/runtime";
import { printArenaDAE } from "@modelscript/runtime/dae-printer";
import { LspContext } from "../lsp-context.js";
import { isClassInstance } from "../utils/ast-utils.js";
import {
  buildClassHierarchy,
  buildComponentTree,
  classKindFromEntry,
  getCompositeName,
  hasClassChildren,
  isTreeVisible,
  mountedLibraryMetadata,
} from "../utils/hierarchy-utils.js";
import { loadPrebakedMslIcons } from "../utils/msl-icons-loader.js";
import { iconCache } from "./treeHandler.js";

export interface CatalogComponentInfo {
  fqn: string;
  name: string;
  kind: string;
  packageName: string;
  subpackage: string;
  description?: string | undefined;
  language?: string | undefined;
  hasLiveIcon: boolean;
}

const SKIP_CATALOG_SEGMENTS = new Set([
  "Internal",
  "Icons",
  "Interfaces",
  "UsersGuide",
  "Examples",
  "BaseClasses",
  "Types",
  "Constants",
  "Units",
  "Utilities",
  "Choices",
  "Common",
  "Frames",
]);

const ROOT_NAMESPACE_TO_PACKAGE: Record<string, string> = {
  SPICE: "SPICE-Standard",
  IEEEFeeders: "IEEE-Test-Feeders",
};

let cachedComponentCatalogKey = "";
let cachedComponentCatalog: CatalogComponentInfo[] = [];

function humanizeIdentifier(ident: string): string {
  return ident
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function inferIconEntryKind(fqn: string, hasChildren: boolean): string {
  if (hasChildren) return "package";
  if (
    fqn.startsWith("Modelica.Blocks.") ||
    fqn.startsWith("Modelica.ComplexBlocks.") ||
    fqn.startsWith("Modelica.Clocked.") ||
    fqn.startsWith("Modelica.StateGraph.")
  ) {
    return "block";
  }
  return "model";
}

function buildParentPrefixSet(keys: Iterable<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const key of keys) {
    let dot = key.indexOf(".");
    while (dot !== -1) {
      prefixes.add(key.slice(0, dot));
      dot = key.indexOf(".", dot + 1);
    }
  }
  return prefixes;
}

export function registerClassQueryEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/getExperiments",
    (): {
      experiments: {
        name: string;
        uri: string;
        type: "simulation" | "calibration";
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
      }[];
    } => {
      const experiments: {
        name: string;
        uri: string;
        type: "simulation" | "calibration";
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
      }[] = [];

      for (const [uri, instances] of context.workspaceManager.documentInstances) {
        for (const instance of instances) {
          if (instance && !instance.instantiated && typeof instance.instantiate === "function") {
            try {
              instance.instantiate();
            } catch {
              continue;
            }
          }

          const rawKind = String(instance.classKind ?? instance.kind ?? "").toLowerCase();
          const isSimulatable =
            rawKind === "model" ||
            rawKind === "block" ||
            rawKind === "class" ||
            instance.classKind === 0 ||
            instance.classKind === 1 ||
            instance.classKind === 2;
          if (!isSimulatable) continue;

          // Check for experiment annotation
          try {
            const docContext = context.workspaceManager.documentContexts.get(uri);
            if (!docContext) continue;

            const arena = flattenArenaFromInstance(instance, docContext);
            const exp = arena.experiment;
            // Only consider classes with actual experiment data (not the default empty {})
            if (
              exp &&
              (exp.startTime !== undefined ||
                exp.stopTime !== undefined ||
                exp.tolerance !== undefined ||
                exp.interval !== undefined)
            ) {
              // Detect calibration type by checking for __ModelScript_CalibrationResult
              // in the experiment annotation (this is what Phase 6 generates)
              const expAny = exp as Record<string, unknown>;
              const hasCalibration =
                "__ModelScript_CalibrationResult" in expAny || "__modelscript_calibration" in expAny;
              experiments.push({
                name: instance.compositeName || instance.name || "Unknown",
                uri,
                type: hasCalibration ? "calibration" : "simulation",
                startTime: exp.startTime,
                stopTime: exp.stopTime,
                interval: exp.interval,
                tolerance: exp.tolerance,
              });
            }
          } catch {
            // ignore errors during experiment discovery
          }
        }
      }

      return { experiments };
    },
  );

  context.connection.onRequest(
    "modelscript/searchClasses",
    async (params: { query: string; limit?: number | undefined }): Promise<{ results: TreeNodeInfo[] }> => {
      const query = (params.query ?? "").trim().toLowerCase();
      if (!query) return { results: [] };

      const limit = params.limit ?? 60;
      try {
        const distBase = (globalThis as any).serverDistBase ?? context.parserService?.getServerDistBase?.();
        await loadPrebakedMslIcons(distBase);
      } catch {
        // Prebaked icon index optional in minimal unit-test harnesses
      }

      const unifiedIndex = context.workspaceManager.unifiedWorkspace?.getIndex?.();
      const results: TreeNodeInfo[] = [];
      const seenFqns = new Set<string>();

      if (unifiedIndex?.symbols) {
        for (const [id, entry] of unifiedIndex.symbols) {
          if (!isTreeVisible(entry)) continue;
          const compositeName = getCompositeName(entry, unifiedIndex);
          if (!compositeName || seenFqns.has(compositeName)) continue;
          if (compositeName.toLowerCase().includes(query)) {
            seenFqns.add(compositeName);
            results.push({
              id: compositeName,
              name: entry.name,
              compositeName,
              classKind: classKindFromEntry(entry),
              hasChildren: hasClassChildren(unifiedIndex, id),
              language: entry.language,
            });
            if (results.length >= limit) break;
          }
        }
      }

      // Also search prebaked MSL / mounted library icon keys so lazy-unparsed MSL classes & examples match immediately
      if (results.length < limit && iconCache.size > 0) {
        const prefixes = buildParentPrefixSet(iconCache.keys());
        for (const fqn of iconCache.keys()) {
          if (seenFqns.has(fqn) || !fqn.toLowerCase().includes(query)) continue;
          const parts = fqn.split(".");
          if (parts.some((p) => p === "Internal" || p === "UsersGuide")) continue;
          const leaf = parts[parts.length - 1] || fqn;
          if (!/^[A-Z]/.test(leaf)) continue;
          const hasChildren = prefixes.has(fqn);
          seenFqns.add(fqn);
          results.push({
            id: fqn,
            name: leaf,
            compositeName: fqn,
            classKind: inferIconEntryKind(fqn, hasChildren) as any,
            hasChildren,
            language: "modelica",
          });
          if (results.length >= limit) break;
        }
      }

      results.sort((a, b) => (a.compositeName ?? "").localeCompare(b.compositeName ?? ""));
      return { results };
    },
  );

  context.connection.onRequest(
    "modelscript/getComponentCatalog",
    async (): Promise<{ components: CatalogComponentInfo[] }> => {
      try {
        const distBase = (globalThis as any).serverDistBase ?? context.parserService?.getServerDistBase?.();
        await loadPrebakedMslIcons(distBase);
      } catch {
        // Prebaked icon index optional in minimal unit-test harnesses
      }

      // Eager-index small custom mounted packages (< 25 files) so newly installed packages appear in the gallery
      const moIdx = context.workspaceManager?.getWorkspaceIndex?.("modelica") as any;
      if (moIdx?.fileLoaders instanceof Map) {
        const customUris: string[] = [];
        for (const uri of moIdx.fileLoaders.keys()) {
          if (typeof uri === "string" && (uri.includes("/packages/") || uri.includes("/modelscript_registry/"))) {
            customUris.push(uri);
          }
        }
        if (customUris.length > 0 && customUris.length <= 40) {
          for (const uri of customUris) {
            try {
              moIdx.ensureIndexed?.(uri);
            } catch {
              // ignore unparseable auxiliary files
            }
          }
        }
      }

      const unifiedIndex = context.workspaceManager?.unifiedWorkspace?.getIndex?.();
      const mountedKeys = Array.from(mountedLibraryMetadata.keys()).sort().join(",");
      const cacheKey = `${iconCache.size}|${unifiedIndex?.symbols?.size ?? 0}|${mountedKeys}`;
      if (cacheKey === cachedComponentCatalogKey && cachedComponentCatalog.length > 0) {
        return { components: cachedComponentCatalog };
      }

      const byFqn = new Map<string, CatalogComponentInfo>();

      // 1. All leaf schematic components from prebaked MSL & package icon index (~1,333 MSL components)
      if (iconCache.size > 0) {
        const prefixes = buildParentPrefixSet(iconCache.keys());
        for (const [fqn, svgVal] of iconCache.entries()) {
          if (!svgVal || prefixes.has(fqn)) continue;
          if (fqn.startsWith("Modelica.Media.") || fqn.startsWith("Modelica.Math.")) continue;
          const parts = fqn.split(".");
          if (parts.length < 2) continue;
          if (parts.some((seg) => SKIP_CATALOG_SEGMENTS.has(seg))) continue;
          const leaf = parts[parts.length - 1]!;
          if (!/^[A-Z]/.test(leaf)) continue;

          const rawRoot = parts[0]!;
          const packageName = ROOT_NAMESPACE_TO_PACKAGE[rawRoot] ?? rawRoot;
          const subpackage = parts.slice(1, -1).join(" · ") || packageName;
          const kind = inferIconEntryKind(fqn, false);

          byFqn.set(fqn, {
            fqn,
            name: leaf,
            kind,
            packageName,
            subpackage,
            description: `${humanizeIdentifier(leaf)} (${subpackage})`,
            language: "modelica",
            hasLiveIcon: true,
          });
        }
      }

      // 2. Enrich & augment from indexed symbols across all mounted libraries (Buildings, PlanarMechanics, .zip imports, SysML, etc.)
      if (unifiedIndex?.symbols) {
        for (const [id, entry] of unifiedIndex.symbols) {
          if (!isTreeVisible(entry)) continue;
          const resId = String(entry.resourceId ?? "");
          if (
            resId.startsWith("builtin://") ||
            resId.startsWith("memfs:") ||
            resId.startsWith("inmemory:") ||
            resId.endsWith("/document.mo")
          ) {
            continue;
          }
          const kind = classKindFromEntry(entry);
          if (kind !== "model" && kind !== "block" && kind !== "part") continue;
          if (hasClassChildren(unifiedIndex, id)) continue;

          const fqn = getCompositeName(entry, unifiedIndex);
          if (!fqn || !fqn.includes(".")) continue;
          if (fqn.startsWith("Modelica.Media.") || fqn.startsWith("Modelica.Math.")) continue;
          const parts = fqn.split(".");
          if (parts.some((seg) => SKIP_CATALOG_SEGMENTS.has(seg))) continue;

          const rawDesc =
            typeof (entry.metadata as any)?.description === "string"
              ? String((entry.metadata as any).description).trim()
              : "";
          const existing = byFqn.get(fqn);
          if (existing) {
            existing.kind = kind;
            if (rawDesc) existing.description = rawDesc;
            if (entry.language) existing.language = entry.language;
          } else {
            const rawRoot = parts[0]!;
            const packageName = ROOT_NAMESPACE_TO_PACKAGE[rawRoot] ?? rawRoot;
            const subpackage = parts.slice(1, -1).join(" · ") || packageName;
            byFqn.set(fqn, {
              fqn,
              name: entry.name,
              kind,
              packageName,
              subpackage,
              description: rawDesc || `${humanizeIdentifier(entry.name)} (${subpackage})`,
              language: entry.language || "modelica",
              hasLiveIcon: Boolean(iconCache.get(fqn) || (entry.metadata as any)?.iconSvg),
            });
          }
        }
      }

      const components = Array.from(byFqn.values()).sort((a, b) => a.fqn.localeCompare(b.fqn));
      cachedComponentCatalogKey = cacheKey;
      cachedComponentCatalog = components;
      return { components };
    },
  );

  context.connection.onRequest(
    "modelscript/getClassSource",
    (params: {
      className: string;
    }): { content: string | null; uri?: string | undefined; error?: string | undefined } => {
      try {
        if (!params?.className || params.className.startsWith("__")) {
          return { content: null, error: `Invalid class name: ${params?.className ?? ""}` };
        }
        const unifiedIndex = context.workspaceManager.unifiedWorkspace.getIndex();
        const parts = params.className.split(".");
        let entries = unifiedIndex.byName.get(parts[parts.length - 1]!);
        let entry = undefined;

        if (entries) {
          let builtinEntry: any = undefined;
          for (const id of entries) {
            const e = unifiedIndex.symbols.get(id);
            if (e && getCompositeName(e, unifiedIndex) === params.className) {
              if (!e.resourceId?.startsWith("builtin://")) {
                entry = e;
                break;
              }
              if (!builtinEntry) builtinEntry = e;
            }
          }
          if (!entry && builtinEntry) {
            entry = builtinEntry;
          }
        }

        let uri = entry?.resourceId;
        if (!uri) {
          // Fallback: try to resolve file path via index
          const moIdx = context.workspaceManager.getWorkspaceIndex("modelica");
          const sysmlIdx = context.workspaceManager.getWorkspaceIndex("sysml2");
          uri =
            (moIdx as any)?.getFileUriForFQN?.(params.className) ||
            (sysmlIdx as any)?.getFileUriForFQN?.(params.className);
        }

        if (!entry && uri) {
          const moIdx = context.workspaceManager.getWorkspaceIndex("modelica");
          try {
            moIdx?.ensureIndexed?.(uri);
            context.workspaceManager.globalWorkspaceIndex?.ensureIndexed?.(uri);
          } catch {}
          const uIndex = context.workspaceManager.unifiedWorkspace.getIndex();
          const targetName = parts[parts.length - 1]!;
          const candIds = uIndex.byName.get(targetName) ?? [];
          for (const cid of candIds) {
            const ce = uIndex.symbols.get(cid);
            if (ce && (ce.resourceId === uri || getCompositeName(ce, uIndex) === params.className)) {
              entry = ce;
              break;
            }
          }
        }

        if (uri?.startsWith("builtin://") && entry) {
          const classPrefix =
            (entry.metadata as any)?.classPrefixes ?? (entry.kind === "Package" ? "package" : "model");
          const desc = (entry.metadata as any)?.description
            ? ` "${String((entry.metadata as any).description)
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')}"`
            : "";
          const childIds = unifiedIndex.childrenOf.get(entry.id) ?? [];
          const bodyLines: string[] = [];
          for (const cid of childIds) {
            const ch = unifiedIndex.symbols.get(cid);
            if (!ch) continue;
            if (ch.kind === "Component" || ch.kind === "Variable") {
              const m = (ch.metadata ?? {}) as Record<string, unknown>;
              const prefix =
                m["variability"] === "parameter"
                  ? "parameter "
                  : m["causality"] === "input"
                    ? "input "
                    : m["causality"] === "output"
                      ? "output "
                      : "";
              const tSpec = String(m["typeSpecifier"] ?? "Real");
              const defVal = m["defaultValue"] !== undefined ? ` = ${m["defaultValue"]}` : "";
              const chDesc = m["description"]
                ? ` "${String(m["description"]).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
                : "";
              bodyLines.push(`  ${prefix}${tSpec} ${ch.name}${defVal}${chDesc};`);
            }
          }
          const synth = `${classPrefix} ${entry.name}${desc}\n${bodyLines.join("\n")}\nend ${entry.name};\n`;
          return { content: synth, uri };
        }

        let text: string | undefined = uri ? context.documents?.get?.(uri)?.getText?.() : undefined;
        if (!text && uri && context.state.sharedContext) {
          let fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
          text = context.state.sharedContext.fs.read(fsPath);
          if (!text && uri.startsWith("modelica:")) {
            const stripped = uri.replace(/^modelica:\/?\/?/, "/");
            text = context.state.sharedContext.fs.read(stripped.startsWith("/") ? stripped : "/" + stripped);
          }
        }
        if (text) {
          if (
            entry &&
            typeof entry.startOffset === "number" &&
            typeof entry.endOffset === "number" &&
            entry.endOffset > entry.startOffset &&
            (entry.startOffset > 0 || entry.endOffset < text.length)
          ) {
            const snippet = text.substring(entry.startOffset, entry.endOffset).trim();
            if (snippet) {
              const parentFqn = params.className.includes(".")
                ? params.className.substring(0, params.className.lastIndexOf("."))
                : "";
              const withinPrefix = parentFqn && !snippet.startsWith("within") ? `within ${parentFqn};\n\n` : "";
              return { content: withinPrefix + snippet, uri };
            }
          }
          return { content: text, uri };
        }
        return { content: null, uri };

        return { content: null, uri, error: `Class not found: ${params.className}` };
      } catch (e) {
        return { content: null, error: String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getClassLocation",
    (params: { className: string }): { uri: string; line: number; character: number } | null => {
      try {
        const moIdx = context.workspaceManager.getWorkspaceIndex("modelica");
        const sysmlIdx = context.workspaceManager.getWorkspaceIndex("sysml2");
        let uri =
          (context.workspaceManager.unifiedWorkspace as any)?.getFileUriForFQN?.(params.className) ||
          (moIdx as any)?.getFileUriForFQN?.(params.className) ||
          (sysmlIdx as any)?.getFileUriForFQN?.(params.className);

        let entry: any = undefined;
        let lastName = params.className.split(".").pop() || "";

        // Only query unified index if uri wasn't found via fast-path
        if (!uri) {
          const unifiedIndex = context.workspaceManager.unifiedWorkspace.getIndex();
          let entries = unifiedIndex.byName.get(params.className) ?? unifiedIndex.byName.get(lastName);

          if (entries) {
            // 1. Try exact composite name match
            for (const id of entries) {
              const e = unifiedIndex.symbols.get(id);
              if (e && getCompositeName(e, unifiedIndex) === params.className) {
                entry = e;
                break;
              }
            }
            // 2. Fallback to name match
            if (!entry) {
              for (const id of entries) {
                const e = unifiedIndex.symbols.get(id);
                if (e && (e.name === lastName || e.name === params.className)) {
                  entry = e;
                  break;
                }
              }
            }
          }

          uri =
            entry?.resourceId ||
            (context.workspaceManager.unifiedWorkspace as any)?.getFileUriForFQN?.(lastName) ||
            (moIdx as any)?.getFileUriForFQN?.(lastName) ||
            (sysmlIdx as any)?.getFileUriForFQN?.(lastName);
        }

        if (uri) {
          let line = 0;
          let character = 0;
          let startOffset = entry?.startOffset ?? 0;

          const doc = context.documents.get(uri);
          if (doc) {
            if (startOffset === 0 && lastName) {
              const docText = doc.getText();
              const regex = new RegExp(
                `\\b(?:model|class|block|record|package|connector|function|type|operator|optimization)\\s+${lastName}\\b`,
              );
              const match = regex.exec(docText);
              if (match && match.index !== undefined) {
                startOffset = match.index;
              }
            }
            const pos = doc.positionAt(startOffset);
            return { uri, line: pos.line, character: pos.character };
          }

          let text: string | undefined;
          const sharedFs =
            (context.workspaceManager as any)?.fs ??
            context.state?.sharedContext?.fs ??
            context.parserService?.sharedContext?.fs ??
            (globalThis as any).sharedFs;
          if (sharedFs) {
            let fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            if (uri.startsWith("modelica:")) {
              const stripped = uri.replace(/^modelica:(?:\/\/lib\/|\/{1,3})/, "/lib/");
              fsPath = stripped.startsWith("/") ? stripped : "/" + stripped;
            }
            try {
              if (typeof sharedFs.read === "function") {
                text = sharedFs.read(fsPath);
              }
            } catch {}
          }
          if (text) {
            if (startOffset === 0 && lastName) {
              const regex = new RegExp(
                `\\b(?:model|class|block|record|package|connector|function|type|operator|optimization)\\s+${lastName}\\b`,
              );
              const match = regex.exec(text);
              if (match && match.index !== undefined) {
                startOffset = match.index;
              }
            }
            if (startOffset > 0) {
              const prefix = text.substring(0, startOffset);
              const lines = prefix.split("\n");
              line = lines.length - 1;
              character = lines[lines.length - 1]!.length;
            }
          }
          return { uri, line, character };
        }
      } catch (e: any) {
        context.connection.console.error(`[getClassLocation] Error: ${e?.message || e}`);
      }
      return null;
    },
  );

  context.connection.onRequest(
    "modelscript/addComponent",
    async (params: { uri: string; className: string; x: number; y: number }) => {
      const rawClass = params.className ?? "";
      if (
        !rawClass ||
        rawClass.startsWith("__LOADING__:") ||
        rawClass.startsWith("__ONTOLOGY__:") ||
        (rawClass.startsWith("__LIB__:") && !rawClass.includes("/") && !rawClass.includes("."))
      ) {
        return [];
      }
      const cleanClassName = rawClass.replace(/^__LIB__:[^/]+\//, "").replace(/^__LIB__:/, "");

      // SysML2 — dispatch handles element insert + layout storage
      if (params.uri.endsWith(".sysml")) {
        const result = await context.diagramService.getDiagramDispatch().applyEdits({
          uri: params.uri,
          seq: 0,
          actions: [{ type: "addComponent", className: cleanClassName, x: params.x, y: params.y }],
        });
        return result.edits;
      }

      // Modelica — uses context-aware name generation (defaultComponentName annotation)
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      const doc = context.documents.get(params.uri);
      if (!instances?.[0]) {
        const result = await context.diagramService.getDiagramDispatch().applyEdits({
          uri: params.uri,
          seq: 0,
          actions: [{ type: "addComponent", className: cleanClassName, x: params.x, y: params.y }],
        });
        return result.edits;
      }
      if (!doc) return [];

      const classInstance = instances[0];
      const docContext = context.workspaceManager.documentContexts.get(params.uri);
      void docContext;

      try {
        // Get base name from defaultComponentName annotation or class name
        const shortName = cleanClassName.split(".").pop() || "component";
        let baseName = shortName.toLowerCase();
        try {
          let droppedClass: any = null;
          if (context.workspaceManager.globalModelicaQueryEngine) {
            const db = context.workspaceManager.globalModelicaQueryEngine.toQueryDB();
            const parts = cleanClassName.split(".");
            let currentId: any = null;
            for (const part of parts) {
              const resolver = db.query<any>("resolveSimpleName", currentId);
              const res = resolver ? resolver(part) : null;
              if (!res) {
                currentId = null;
                break;
              }
              currentId = res.id ?? null;
            }
            if (currentId != null) droppedClass = new ModelicaClassInstance(currentId, db);
          }

          if (isClassInstance(droppedClass)) {
            const defaultName = droppedClass.annotation("defaultComponentName") as string | null;
            if (defaultName) {
              baseName = (droppedClass as any).translate?.(defaultName) ?? defaultName;
            } else {
              baseName = (droppedClass.localizedName || shortName).toLowerCase();
            }
          }
        } catch {
          // proceed with default baseName
        }

        // Find unique name
        let name = baseName;
        let i = 1;
        const existingNames = new Set(Array.from<any>(classInstance.components ?? []).map((c: any) => c.name));
        while (existingNames.has(name)) {
          name = `${baseName}${i}`;
          i++;
        }

        return computeComponentInsert(classInstance, cleanClassName, name, params.x, params.y, doc.getText());
      } catch (e) {
        console.error("[diagram] addComponent error:", e);
        return [];
      }
    },
  );

  context.connection.onRequest(
    "modelscript/flatten",
    async (params: {
      name: string;
      uri?: string | undefined;
    }): Promise<{ text: string | null; error?: string | undefined }> => {
      let instances = params.uri ? context.workspaceManager.documentInstances.get(params.uri) : undefined;

      // Fallback to finding instances via context if URI isn't provided or didn't work
      if (!instances && params.uri) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }

      if (!instances && !params.uri) {
        for (const insts of context.workspaceManager.documentInstances.values()) {
          if (insts && insts.length > 0) {
            instances = insts;
            break;
          }
        }
      }

      if (!instances || instances.length === 0) {
        return { text: null, error: "No Modelica class instances found in the active document." };
      }

      let classInstance = instances[0];
      if (params.name) {
        const found = instances.find(
          (i) =>
            i.name === params.name ||
            (i as any).compositeName === params.name ||
            params.name.endsWith("." + i.name) ||
            i.name.endsWith("." + params.name),
        );
        if (found) classInstance = found;
      }

      try {
        // Ensure the full index is available before flattening
        const moIdx = context.workspaceManager.getWorkspaceIndex("modelica");
        if (!context.state.dependenciesReady && (moIdx?.pendingFileCount ?? 0) > 0) {
          const fullIndex = context.workspaceManager.unifiedWorkspace.getIndex();
          injectPredefinedTypes(fullIndex);
          const langId = params.uri?.endsWith(".sysml") ? "sysml2" : "modelica";
          const engine = context.workspaceManager.getQueryEngine(langId);
          if (engine) {
            engine.updateIndex(fullIndex);
          }

          if (params.uri) {
            const doc = context.documents.get(params.uri);
            if (doc) await context.validationService.validateTextDocument(doc);
            instances = context.workspaceManager.documentInstances.get(params.uri);
            if (instances && instances.length > 0) {
              classInstance = params.name
                ? (instances.find(
                    (i) =>
                      i.name === params.name ||
                      (i as any).compositeName === params.name ||
                      params.name.endsWith("." + i.name) ||
                      i.name.endsWith("." + params.name),
                  ) ?? instances[0])
                : instances[0];
            }
          }
        }

        let docContext = params.uri ? context.workspaceManager.documentContexts.get(params.uri) : undefined;
        if (!docContext) {
          docContext = context.workspaceManager.documentContexts.values().next().value;
        }
        if (!docContext) {
          return { text: null, error: "No Modelica context found." };
        }

        const arena = flattenArenaFromInstance(classInstance, docContext);
        return { text: printArenaDAE(arena) };
      } catch (e) {
        return { text: null, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/query",
    (params: {
      name: string;
      uri?: string | undefined;
    }): {
      name: string;
      kind: string;
      description: string;
      components: { name: string; type: string; description: string }[];
      childClasses: { name: string; kind: string }[];
      error?: string | undefined;
    } | null => {
      let ctx: Context | undefined;
      if (params.uri) ctx = context.workspaceManager.documentContexts.get(params.uri);
      if (!ctx) {
        for (const c of context.workspaceManager.documentContexts.values()) {
          ctx = c;
          break;
        }
      }
      if (!ctx) return null;

      try {
        if (!context.workspaceManager.globalModelicaQueryEngine) return null;
        const db = context.workspaceManager.globalModelicaQueryEngine.toQueryDB();
        const parts = params.name.split(".");
        let currentId: any = null;
        for (const part of parts) {
          const resolver = db.query<any>("resolveSimpleName", currentId);
          const res = resolver ? resolver(part) : null;
          if (!res) return null;
          currentId = res.id ?? null;
        }
        if (currentId == null) return null;
        const ModelicaClassInstanceCtor = (globalThis as any).ModelicaClassInstance;
        const element = ModelicaClassInstanceCtor ? new ModelicaClassInstanceCtor(currentId, db) : null;

        if (!isClassInstance(element)) return null;

        const components: { name: string; type: string; description: string }[] = [];
        const childClasses: { name: string; kind: string }[] = [];
        const ModelicaComponentInstanceCtor = (globalThis as any).ModelicaComponentInstance;
        for (const child of element.elements) {
          if (
            (ModelicaComponentInstanceCtor && child instanceof ModelicaComponentInstanceCtor) ||
            (!isClassInstance(child) && child?.classInstance)
          ) {
            components.push({
              name: child.name ?? "",
              type: child.classInstance?.name ?? "",
              description: child.description ?? "",
            });
          } else if (isClassInstance(child)) {
            childClasses.push({
              name: child.name ?? "",
              kind: child.classKind ?? "class",
            });
          }
        }

        return {
          name: params.name,
          kind: element.classKind ?? "class",
          description: element.description ?? "",
          components,
          childClasses,
        };
      } catch (e) {
        console.error("[mcp-bridge] query error:", e);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/parse",
    (params: { code: string }): { classes: { name: string; kind: string }[]; syntaxErrors: string[] } => {
      let ctx: Context | undefined = context.state?.sharedContext ?? context.parserService?.sharedContext;
      if (!ctx) {
        for (const c of context.workspaceManager.documentContexts.values()) {
          ctx = c;
          break;
        }
      }
      if (!ctx) return { classes: [], syntaxErrors: ["No Modelica context available."] };

      try {
        const tree = ctx.parse(".mo", params.code);
        const errors: string[] = [];
        const walk = (node: any) => {
          if (!node) return;
          if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
          if (node.isMissing || node.type === "ERROR") {
            errors.push(node.isMissing ? `Missing syntax element` : `Syntax error`);
          }
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) walk(children[i]);
        };
        walk(tree.rootNode);

        const classes: { name: string; kind: string }[] = [];
        const findClassDefs = (n: any) => {
          if (!n) return;
          if (n.type === "class_definition" || n.type === "ClassDefinition") {
            const spec = n.children?.find((c: any) => c.type === "class_specifier" || c.type === "ClassSpecifier") ?? n;
            const longSpec =
              spec.children?.find((c: any) => c.type === "long_class_specifier" || c.type === "LongClassSpecifier") ??
              spec;
            const idNode =
              longSpec.children?.find((c: any) => c.type === "identifier" || c.type === "Identifier") ??
              n.childForFieldName?.("identifier");
            const prefixes = n.children?.find((c: any) => c.type === "class_prefixes" || c.type === "ClassPrefixes");
            classes.push({
              name: idNode?.text?.trim() ?? "<anonymous>",
              kind: prefixes?.text?.trim() ?? "class",
            });
            return;
          }
          for (const ch of n.children || []) {
            findClassDefs(ch);
          }
        };
        findClassDefs(tree.rootNode);
        return { classes, syntaxErrors: errors };
      } catch (e) {
        return { classes: [], syntaxErrors: [e instanceof Error ? e.message : String(e)] };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getClassHierarchy",
    (params: { uri: string; className?: string | undefined }): ClassHierarchyNode | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      return buildClassHierarchy(target);
    },
  );

  context.connection.onRequest(
    "modelscript/getComponentTree",
    (params: { uri: string; className?: string | undefined }): ComponentTreeNode | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      return buildComponentTree(target);
    },
  );

  const getVirtualFsPath = (raw: string): string => {
    let uStr = raw;
    try {
      uStr = decodeURIComponent(uStr);
    } catch {}
    // Normalize modelica://lib/..., modelica:///lib/..., modelica:/lib/...
    const m = uStr.match(/^modelica:(?:\/\/lib\/|\/{1,3})(.*)$/i);
    let p = m ? m[1]! : uStr;
    if (!p.startsWith("lib/") && !p.startsWith("/lib/")) {
      p = "lib/" + p.replace(/^\/+/, "");
    }
    return p.startsWith("/") ? p : "/" + p;
  };

  context.connection.onRequest(
    "modelscript/getVirtualFile",
    (params: {
      uri?: string | undefined;
      path?: string | undefined;
    }): {
      content?: string | undefined;
      size?: number | undefined;
      exists: boolean;
      isDirectory?: boolean | undefined;
    } => {
      const target = params?.uri || params?.path || "";
      if (!target) return { exists: false };
      const fsPath = getVirtualFsPath(target);
      const fs =
        (context.workspaceManager as any)?.fs ??
        context.state?.sharedContext?.fs ??
        context.parserService?.sharedContext?.fs ??
        (globalThis as any).sharedFs;
      if (!fs) return { exists: false };
      if (typeof fs.exists === "function" && fs.exists(fsPath)) {
        const stat = typeof fs.stat === "function" ? fs.stat(fsPath) : null;
        if (stat?.isDirectory?.()) {
          return { exists: true, isDirectory: true, size: 0 };
        }
        const content = typeof fs.read === "function" ? fs.read(fsPath) : "";
        return {
          exists: true,
          isDirectory: false,
          content,
          size: stat?.size ?? content.length,
        };
      }
      return { exists: false };
    },
  );

  context.connection.onRequest(
    "modelscript/readVirtualDirectory",
    (params: { uri?: string | undefined; path?: string | undefined }): { name: string; isDirectory: boolean }[] => {
      const target = params?.uri || params?.path || "";
      if (!target) return [];
      const fsPath = getVirtualFsPath(target);
      const fs =
        (context.workspaceManager as any)?.fs ??
        context.state?.sharedContext?.fs ??
        context.parserService?.sharedContext?.fs ??
        (globalThis as any).sharedFs;
      if (!fs || typeof fs.readdir !== "function") return [];
      try {
        const entries = fs.readdir(fsPath);
        if (Array.isArray(entries)) {
          return entries.map((e: any) => ({
            name: e.name,
            isDirectory: typeof e.isDirectory === "function" ? e.isDirectory() : Boolean(e.isDirectory),
          }));
        }
      } catch {}
      return [];
    },
  );
}
