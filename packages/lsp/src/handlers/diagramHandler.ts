// SPDX-License-Identifier: AGPL-3.0-or-later

import { cellsToDiagramData, renderPolyglotDiagramToSvg } from "@modelscript/diagram/svg";
import { DiagramApplyEditsParams, DiagramMethods } from "../diagramProtocol.js";
import { LspContext } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { handleApplyCadEdit, type ApplyCadEditParams, type ApplyCadEditResult } from "./cadEditHandler.js";
import {
  compileStepFromSources,
  type CompileStepFromSourcesParams,
  type CompileStepFromSourcesResult,
} from "./cadStepCompiler.js";
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

function resolvePreviewExtension(languageId?: string): string {
  if (!languageId) return "mo";
  const normalized = languageId.toLowerCase();
  if (LANGUAGE_PREVIEW_EXT[normalized]) {
    return LANGUAGE_PREVIEW_EXT[normalized]!;
  }
  const plugin = globalLanguageRegistry.getPluginById(normalized);
  const firstExt = plugin?.extensions?.[0];
  if (typeof firstExt === "string" && firstExt.length > 0) {
    return firstExt.startsWith(".") ? firstExt.slice(1) : firstExt;
  }
  return "mo";
}

function resolvePreviewUriForItem(context: LspContext, item: DiagramPreviewItemRequest): string {
  if (item.uri && item.uri.trim().length > 0 && item.uri !== "file:///") {
    return item.uri.trim();
  }
  const ext = resolvePreviewExtension(item.languageId);
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
          const scopePrefix = `${simpleHash(cacheKey)}`;
          const rawSvg = renderPolyglotDiagramToSvg(normalizedData, {
            theme: isDark ? "dark" : "light",
            padding: 26,
            background: bg,
            idPrefix: scopePrefix,
          });
          const svg = makeResponsiveScopedSvg(rawSvg, scopePrefix);
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

  context.connection.onRequest(
    "modelscript/getStepMeshes",
    async (params: { uri: string; documentText?: string }): Promise<any[]> => {
      return await dispatchLanguageRequest(context, "modelscript/getStepMeshes", params.uri, params, []);
    },
  );

  context.connection.onRequest(
    "modelscript/compileStepFromSources",
    async (params: CompileStepFromSourcesParams): Promise<CompileStepFromSourcesResult> => {
      return compileStepFromSources(params);
    },
  );

  context.connection.onRequest(
    "modelscript/applyCadEdit",
    async (params: ApplyCadEditParams): Promise<ApplyCadEditResult> => {
      return handleApplyCadEdit(context, params);
    },
  );

  context.connection.onRequest(
    DiagramMethods.getPropertySchema,
    async (params: { uri: string; componentName: string; className?: string | undefined }) => {
      try {
        const dispatch = context.diagramService.getDiagramDispatch();
        const props =
          typeof dispatch?.getComponentProperties === "function" ? await dispatch.getComponentProperties(params) : null;
        if (!props) {
          return {
            componentName: params.componentName,
            className: params.className ?? "",
            properties: [],
          };
        }
        const rawParams: any[] = Array.isArray(props.parameters) ? props.parameters : [];
        const properties = rawParams.map((p) => {
          const val = p.value ?? p.defaultValue ?? "";
          let inferredType = "string";
          if (p.isBoolean || val === "true" || val === "false") {
            inferredType = "boolean";
          } else if (
            typeof val === "number" ||
            (typeof val === "string" && val.trim() !== "" && !Number.isNaN(Number(val)))
          ) {
            inferredType = "number";
          }
          return {
            name: String(p.name ?? ""),
            type: typeof p.type === "string" ? p.type : inferredType,
            value: val,
            unit: p.unit,
            description: p.description,
            group: p.group ?? p.tab ?? "Parameters",
          };
        });
        return {
          componentName: props.name ?? params.componentName,
          className: props.className ?? params.className ?? "",
          description: props.description,
          properties,
          ...(props.schema ? { schema: props.schema } : {}),
        };
      } catch (e: any) {
        context.connection.console.warn?.(
          `[diagram] Error building property schema for '${params.componentName}': ${e?.message ?? e}`,
        );
        return {
          componentName: params.componentName,
          className: params.className ?? "",
          properties: [],
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/diagram.getVisualDiff",
    async (params: {
      uri: string;
      oldText: string;
      newText: string;
      className?: string | undefined;
      diagramType?: string | undefined;
    }) => {
      const escapeHtml = (str: string): string =>
        str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      type DiagramNodeLike = {
        id: string;
        label?: unknown;
        attrs?: { label?: { text?: unknown } };
        data?: { className?: string; type?: string };
        shape?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      };
      type DiagramEdgeLike = {
        id?: string;
        source?: string | { cell?: string; port?: string };
        target?: string | { cell?: string; port?: string };
      };
      type DiagramDataLike = {
        nodes?: DiagramNodeLike[];
        edges?: DiagramEdgeLike[];
        cells?: unknown[];
      } | null;

      const normalizeDiagram = (rawData: DiagramDataLike): DiagramDataLike =>
        rawData && !Array.isArray(rawData.nodes) && Array.isArray(rawData.cells)
          ? (cellsToDiagramData({
              cells: rawData.cells as Parameters<typeof cellsToDiagramData>[0]["cells"],
            }) as DiagramDataLike)
          : rawData;

      const extractRealNodes = (data: DiagramDataLike): DiagramNodeLike[] =>
        Array.isArray(data?.nodes)
          ? data.nodes.filter(
              (n) =>
                n &&
                typeof n.id === "string" &&
                !n.id.startsWith("__") &&
                !n.id.startsWith("solder_dot_") &&
                !n.id.startsWith("wire_crossing_"),
            )
          : [];

      const edgeKey = (e: DiagramEdgeLike): string => {
        const src = typeof e.source === "string" ? e.source : `${e.source?.cell ?? ""}:${e.source?.port ?? ""}`;
        const tgt = typeof e.target === "string" ? e.target : `${e.target?.cell ?? ""}:${e.target?.port ?? ""}`;
        return `${src}->${tgt}`;
      };

      const nodeSignature = (n: DiagramNodeLike): string =>
        JSON.stringify({
          label: n.label ?? n.attrs?.label?.text ?? "",
          className: n.data?.className ?? n.data?.type ?? "",
          shape: n.shape ?? "",
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
        });

      const [oldRaw, newRaw] = await Promise.all([
        context.diagramService
          .handleGetDiagramData({
            uri: params.uri,
            className: params.className,
            diagramType: params.diagramType,
            documentText: params.oldText ?? "",
          })
          .catch(() => null),
        context.diagramService
          .handleGetDiagramData({
            uri: params.uri,
            className: params.className,
            diagramType: params.diagramType,
            documentText: params.newText ?? "",
          })
          .catch(() => null),
      ]);

      const oldData = normalizeDiagram(oldRaw as DiagramDataLike);
      const newData = normalizeDiagram(newRaw as DiagramDataLike);

      const oldNodes = new Map<string, DiagramNodeLike>();
      for (const n of extractRealNodes(oldData)) oldNodes.set(n.id, n);
      const newNodes = new Map<string, DiagramNodeLike>();
      for (const n of extractRealNodes(newData)) newNodes.set(n.id, n);

      const addedNodes: { id: string; label: string; className?: string | undefined }[] = [];
      const removedNodes: { id: string; label: string; className?: string | undefined }[] = [];
      const modifiedNodes: { id: string; label: string; className?: string | undefined }[] = [];

      for (const [id, n] of newNodes) {
        const info = {
          id,
          label: String(n.label ?? n.attrs?.label?.text ?? id),
          className: n.data?.className ?? n.data?.type,
        };
        const prev = oldNodes.get(id);
        if (!prev) {
          addedNodes.push(info);
        } else if (nodeSignature(prev) !== nodeSignature(n)) {
          modifiedNodes.push(info);
        }
      }
      for (const [id, n] of oldNodes) {
        if (!newNodes.has(id)) {
          removedNodes.push({
            id,
            label: String(n.label ?? n.attrs?.label?.text ?? id),
            className: n.data?.className ?? n.data?.type,
          });
        }
      }

      const oldEdges = new Map<string, DiagramEdgeLike>();
      for (const e of Array.isArray(oldData?.edges) ? oldData.edges : []) {
        oldEdges.set(edgeKey(e), e);
      }
      const newEdges = new Map<string, DiagramEdgeLike>();
      for (const e of Array.isArray(newData?.edges) ? newData.edges : []) {
        newEdges.set(edgeKey(e), e);
      }

      const addedEdges: { key: string; id?: string | undefined }[] = [];
      const removedEdges: { key: string; id?: string | undefined }[] = [];
      for (const [k, e] of newEdges) {
        if (!oldEdges.has(k)) addedEdges.push({ key: k, id: e?.id });
      }
      for (const [k, e] of oldEdges) {
        if (!newEdges.has(k)) removedEdges.push({ key: k, id: e?.id });
      }

      const renderItems = (items: string[], color: string, prefix: string) =>
        items.length === 0
          ? `<p style="color:#888;margin:4px 0;">None</p>`
          : `<ul style="margin:4px 0;padding-left:18px;">${items
              .map((item) => `<li style="color:${color};font-family:monospace;">${prefix} ${escapeHtml(item)}</li>`)
              .join("")}</ul>`;

      const html = `
        <div style="font-family:var(--vscode-font-family,sans-serif);padding:16px;color:var(--vscode-editor-foreground,#e2e8f0);background:var(--vscode-editor-background,#0f172a);">
          <h2 style="margin-top:0;">Visual Model Diff</h2>
          <p style="font-size:12px;opacity:0.8;">${escapeHtml(params.uri)}</p>
          <div style="display:flex;gap:16px;margin:12px 0;font-size:13px;">
            <span style="color:#4ade80;">+${addedNodes.length} nodes</span>
            <span style="color:#f87171;">-${removedNodes.length} nodes</span>
            <span style="color:#facc15;">~${modifiedNodes.length} modified</span>
            <span style="color:#4ade80;">+${addedEdges.length} edges</span>
            <span style="color:#f87171;">-${removedEdges.length} edges</span>
          </div>
          <h3>Added Nodes</h3>
          ${renderItems(
            addedNodes.map((n) => (n.className ? `${n.label} (${n.className})` : n.label)),
            "#4ade80",
            "+",
          )}
          <h3>Removed Nodes</h3>
          ${renderItems(
            removedNodes.map((n) => (n.className ? `${n.label} (${n.className})` : n.label)),
            "#f87171",
            "-",
          )}
          <h3>Modified Nodes</h3>
          ${renderItems(
            modifiedNodes.map((n) => (n.className ? `${n.label} (${n.className})` : n.label)),
            "#facc15",
            "~",
          )}
          <h3>Added Edges</h3>
          ${renderItems(
            addedEdges.map((e) => e.key),
            "#4ade80",
            "+",
          )}
          <h3>Removed Edges</h3>
          ${renderItems(
            removedEdges.map((e) => e.key),
            "#f87171",
            "-",
          )}
        </div>
      `;

      return {
        uri: params.uri,
        addedNodes,
        removedNodes,
        modifiedNodes,
        addedEdges,
        removedEdges,
        summary: {
          addedNodes: addedNodes.length,
          removedNodes: removedNodes.length,
          modifiedNodes: modifiedNodes.length,
          addedEdges: addedEdges.length,
          removedEdges: removedEdges.length,
        },
        html,
      };
    },
  );
}
