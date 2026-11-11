// SPDX-License-Identifier: AGPL-3.0-or-later

import { cellsToDiagramData, renderPolyglotDiagramToSvg } from "@modelscript/diagram/svg";
import { DiagramApplyEditsParams, DiagramMethods } from "../diagramProtocol.js";
import { LspContext } from "../lsp-context.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { dispatchLanguageRequest } from "./languageProtocolRouter.js";

function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export interface DiagramPreviewItemRequest {
  id: string;
  className?: string | undefined;
  uri?: string | undefined;
  documentText?: string | undefined;
  languageId?: string | undefined;
  diagramType?: string | undefined;
}

export interface DiagramPreviewItemResult {
  svg: string;
  nodeCount: number;
  edgeCount: number;
}

export const cadComponentsCache = new Map<string, { version: string; data: any }>();
export const diagramPreviewSvgCache = new Map<string, DiagramPreviewItemResult>();
export { simpleHash };

const LANGUAGE_PREVIEW_EXT: Record<string, string> = {
  modelica: "mo",
  modelscript: "mo",
  sysml2: "sysml",
  sysml: "sysml",
  owl2: "owl",
  pscad: "pscx",
  spice: "sp",
  opendss: "dss",
  psse: "raw",
  urdf: "urdf",
  epanet: "epanet.inp",
  swmm: "swmm.inp",
  scad: "scad",
  step: "step",
};

function makeResponsiveScopedSvg(rawSvg: string, scopePrefix: string): string {
  const safePrefix = scopePrefix.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "p";
  let svg = rawSvg.replace(
    /<svg\b([^>]*?)\s+width="[^"]*"\s+height="[^"]*"/,
    '<svg$1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet"',
  );
  const defIds = [
    "shadow",
    "grad-cylinder-horizontal",
    "grad-cylinder-vertical",
    "grad-sphere",
    "marker-classic",
    "marker-hollow-triangle",
    "marker-diamond",
    "marker-hollow-diamond",
  ];
  for (const defId of defIds) {
    const nextId = `${defId}-${safePrefix}`;
    svg = svg.replaceAll(`id="${defId}"`, `id="${nextId}"`).replaceAll(`url(#${defId})`, `url(#${nextId})`);
  }
  return svg;
}

function resolvePreviewUriForItem(context: LspContext, item: DiagramPreviewItemRequest): string {
  if (item.uri && item.uri.trim().length > 0 && item.uri !== "file:///") {
    return item.uri.trim();
  }
  const ext = (item.languageId && LANGUAGE_PREVIEW_EXT[item.languageId.toLowerCase()]) || "mo";
  if (item.documentText !== undefined) {
    const safeId = item.id.replace(/[^A-Za-z0-9_.-]/g, "_") || "preview";
    return `file:///__open_model_preview_${safeId}__.${ext}`;
  }
  if (item.className) {
    const moIdx = context.workspaceManager.getWorkspaceIndex("modelica");
    const sysmlIdx = context.workspaceManager.getWorkspaceIndex("sysml2");
    (context.workspaceManager.unifiedWorkspace as any)?.ensureFQNIndexed?.(item.className);
    (moIdx as any)?.ensureFQNIndexed?.(item.className);
    (sysmlIdx as any)?.ensureFQNIndexed?.(item.className);

    let candidateUri: string | undefined =
      (context.workspaceManager.unifiedWorkspace as any)?.getFileUriForFQN?.(item.className) ||
      (moIdx as any)?.getFileUriForFQN?.(item.className) ||
      (sysmlIdx as any)?.getFileUriForFQN?.(item.className);

    if (!candidateUri) {
      const unified = (context.workspaceManager.unifiedWorkspace as any)?.getIndex?.() ?? (moIdx as any);
      if (unified?.byName && unified?.symbols) {
        const shortName = item.className.split(".").pop() || item.className;
        const ids = unified.byName.get(item.className) ?? unified.byName.get(shortName);
        if (ids) {
          for (const id of ids) {
            const sym = unified.symbols.get(id);
            if (
              sym &&
              (getCompositeName(sym, unified) === item.className || sym.name === item.className) &&
              sym.resourceId
            ) {
              candidateUri = sym.resourceId;
              break;
            }
          }
        }
      }
    }

    if (candidateUri) {
      if (candidateUri.endsWith(".sysml") || candidateUri.endsWith(".sysml2") || candidateUri.startsWith("sysml2:")) {
        return candidateUri.endsWith(".sysml") || candidateUri.endsWith(".sysml2")
          ? candidateUri
          : "file:///__library_preview__.sysml";
      }
      if (candidateUri.endsWith(".mo")) {
        return candidateUri;
      }
    }
    return `file:///__library_preview__.${ext}`;
  }
  return `file:///__library_preview__.${ext}`;
}

export function registerDiagramHandlers(context: LspContext) {
  context.connection.onRequest(
    DiagramMethods.getData,
    async (params: {
      uri: string;
      className?: string | undefined;
      diagramType?: string | undefined;
      sidecarContent?: string | undefined;
      documentText?: string | undefined;
    }) => {
      return await context.diagramService.handleGetDiagramData(params);
    },
  );

  context.connection.onRequest(
    DiagramMethods.getComponentProperties,
    async (params: { uri: string; componentName: string; className?: string | undefined }) => {
      return await context.diagramService.getDiagramDispatch().getComponentProperties(params);
    },
  );

  context.connection.onRequest("modelscript/generateMultiBody", async (params: { uri: string }) => {
    return await dispatchLanguageRequest(context, "modelscript/generateMultiBody", params.uri, params);
  });

  context.connection.onRequest("modelscript/exportShapeToStep", async (params: { uri: string; className: string }) => {
    return await dispatchLanguageRequest(context, "modelscript/exportShapeToStep", params.uri, params);
  });

  context.connection.onRequest("modelscript/flattenStudy", async (params: { uri: string; className: string }) => {
    return await dispatchLanguageRequest(context, "modelscript/flattenStudy", params.uri, params);
  });

  context.connection.onRequest(
    "modelscript/getDiagramData",
    async (params: {
      uri: string;
      className?: string | undefined;
      diagramType?: string | undefined;
      documentText?: string | undefined;
    }) => await context.diagramService.handleGetDiagramData(params),
  );

  context.connection.onRequest(
    "modelscript/getDiagramPreviewSvgs",
    async (params: {
      items: DiagramPreviewItemRequest[];
      isDark?: boolean | undefined;
    }): Promise<{ previews: Record<string, DiagramPreviewItemResult> }> => {
      const previews: Record<string, DiagramPreviewItemResult> = {};
      if (!Array.isArray(params?.items) || params.items.length === 0) {
        return { previews };
      }
      const isDark = Boolean(params.isDark);
      const bg = isDark ? "#0d131f" : "#f8fafc";

      for (const item of params.items) {
        if (!item?.id) continue;
        try {
          const targetUri = resolvePreviewUriForItem(context, item);
          const textSig =
            item.documentText !== undefined ? `txt:${item.documentText.length}:${simpleHash(item.documentText)}` : "";
          const cacheKey = `${isDark ? "dark" : "light"}|${targetUri}|${item.className ?? ""}|${item.diagramType ?? ""}|${textSig}`;
          if (!item.documentText) {
            const hit = diagramPreviewSvgCache.get(cacheKey);
            if (hit) {
              previews[item.id] = hit;
              continue;
            }
          }

          const rawData = await context.diagramService.handleGetDiagramData({
            uri: targetUri,
            className: item.className,
            diagramType: item.diagramType,
            documentText: item.documentText,
          });

          const normalizedData =
            rawData && !Array.isArray(rawData.nodes) && Array.isArray(rawData.cells)
              ? cellsToDiagramData({ cells: rawData.cells })
              : rawData;

          const realNodes = Array.isArray(normalizedData?.nodes)
            ? normalizedData.nodes.filter(
                (n: any) =>
                  n &&
                  typeof n.id === "string" &&
                  !n.id.startsWith("__") &&
                  !n.id.startsWith("solder_dot_") &&
                  !n.id.startsWith("wire_crossing_"),
              )
            : [];

          if (realNodes.length === 0) {
            continue;
          }

          const edgeCount = Array.isArray(normalizedData?.edges) ? normalizedData.edges.length : 0;
          const rawSvg = renderPolyglotDiagramToSvg(normalizedData, {
            theme: isDark ? "dark" : "light",
            padding: 26,
            background: bg,
          });
          const svg = makeResponsiveScopedSvg(rawSvg, `${simpleHash(cacheKey)}`);
          const result: DiagramPreviewItemResult = {
            svg,
            nodeCount: realNodes.length,
            edgeCount,
          };
          if (!item.documentText) {
            if (diagramPreviewSvgCache.size > 250) {
              const oldest = diagramPreviewSvgCache.keys().next().value;
              if (oldest !== undefined) diagramPreviewSvgCache.delete(oldest);
            }
            diagramPreviewSvgCache.set(cacheKey, result);
          }
          previews[item.id] = result;
        } catch (e: any) {
          context.connection.console.warn?.(
            `[diagram-preview] Could not render preview for '${item.className ?? item.uri ?? item.id}': ${e?.message ?? e}`,
          );
        }
      }

      return { previews };
    },
  );

  context.connection.onRequest(
    "modelscript/getComponentProperties",
    async (params: { uri: string; componentName: string; className?: string | undefined }) => {
      try {
        const dispatch = context.diagramService.getDiagramDispatch();
        if (typeof dispatch?.getComponentProperties === "function") {
          return await dispatch.getComponentProperties(params);
        }
      } catch {
        // ignore
      }

      const classInstance = context.workspaceManager.resolveClassInstance(params.uri, params.className);
      if (!classInstance) return null;

      const buildProps = (globalThis as any).modelicaDiagramOps?.buildComponentProperties;
      if (typeof buildProps === "function") {
        try {
          return buildProps(classInstance, params.componentName);
        } catch (e: any) {
          context.connection.console.error(
            `[diagram] Error building component properties: ${e?.message ?? e}\n  ${e?.stack ?? ""}`,
          );
        }
      }
      return null;
    },
  );

  context.connection.onRequest(
    "modelscript/getCadComponents",
    async (params: { uri: string; documentText?: string | undefined }) => {
      // Check cache using the same content-hash strategy as the diagram cache
      const effectiveUri = params.uri.startsWith("modelscript-lib://global")
        ? "file://" + params.uri.substring("modelscript-lib://global".length)
        : params.uri;
      const sourceText =
        params.documentText ??
        context.validationService.lastIndexedText.get(effectiveUri) ??
        context.documentManager.documents.get(effectiveUri)?.getText() ??
        context.documentManager.documentTrees.get(effectiveUri)?.text;
      const version = sourceText != null ? `idx:${sourceText.length}:${simpleHash(sourceText)}` : "unknown";
      const cached = cadComponentsCache.get(params.uri);
      if (cached && cached.version === version && version !== "unknown" && cached.data.length > 0) {
        return cached.data;
      }

      try {
        const data = await dispatchLanguageRequest(context, "modelscript/getCadComponents", params.uri, params, []);
        if (version !== "unknown" && Array.isArray(data) && data.length > 0) {
          cadComponentsCache.set(params.uri, { version, data });
        }
        return data;
      } catch (e: any) {
        context.connection.console.error(`[cad] Error extracting CAD components: ${e?.message ?? e}`);
        return [];
      }
    },
  );

  context.connection.onRequest(DiagramMethods.applyEdits, async (params: DiagramApplyEditsParams) => {
    return await context.diagramService.getDiagramDispatch().applyEdits(params);
  });

  context.connection.onRequest(DiagramMethods.getPalette, async (params: any) => {
    return await context.diagramService.getDiagramDispatch().getPalette(params);
  });

  context.connection.onRequest(DiagramMethods.drillDown, async (params: any) => {
    return await context.diagramService.getDiagramDispatch().drillDown(params);
  });

  context.connection.onRequest("modelscript/getStepMeshes", async (params: { uri: string }): Promise<any[]> => {
    return await dispatchLanguageRequest(context, "modelscript/getStepMeshes", params.uri, params, []);
  });
}
