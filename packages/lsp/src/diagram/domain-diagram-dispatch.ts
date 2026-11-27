// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramBackend,
  DiagramData,
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramGetPaletteParams,
  DiagramPalette,
} from "../diagramProtocol.js";
import {
  createOpenDriveDiagramBackend,
  createPscadDiagramBackend,
  createPsseDiagramBackend,
  createSimulinkDiagramBackend,
  createSpiceDiagramBackend,
  createSspDiagramBackend,
} from "../diagrams/index.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { BackendWithDepsLike, DiagramDispatchDeps } from "./diagram-api-types.js";

export function getUnifiedIndexFromDeps(backends: DiagramDispatchDeps): unknown {
  return (
    backends.getUnifiedIndex?.() ??
    (backends.modelica as BackendWithDepsLike | undefined)?.deps?.getUnifiedIndex?.() ??
    (backends.sysml2 as BackendWithDepsLike | undefined)?.deps?.getUnifiedIndex?.() ??
    (backends.generic as BackendWithDepsLike | undefined)?.deps?.getUnifiedIndex?.() ??
    null
  );
}

const DOMAIN_BUILDERS: Record<string, (text: string, params: DiagramGetDataParams) => Promise<unknown>> = {
  simpack: async (text) => {
    const { parseSpckXml, parseSimDeck, buildSimpackDiagram } = await import("@modelscript/simpack");
    const isXml = text.trimStart().startsWith("<");
    const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
    return buildSimpackDiagram(model);
  },
  gensys: async (text) => {
    const { parseGensysDeck, buildGensysDiagram } = await import("@modelscript/gensys");
    return buildGensysDiagram(parseGensysDeck(text));
  },
  adams: async (text) => {
    const { parseAdams, buildAdamsDiagram } = await import("@modelscript/adams");
    return buildAdamsDiagram(parseAdams(text));
  },
  urdf: async (text) => {
    const { parseUrdf, buildUrdfDiagram } = await import("@modelscript/urdf");
    return buildUrdfDiagram(parseUrdf(text));
  },
  aspen: async (text) => {
    const { parseAspen } = await import("@modelscript/aspen");
    const { buildAspenDiagram } = await import("@modelscript/diagram/aspen-diagram-builder");
    return buildAspenDiagram(parseAspen(text) as Parameters<typeof buildAspenDiagram>[0]);
  },
  swmm: async (text) => {
    const { parseSwmm } = await import("@modelscript/swmm");
    const { buildSwmmDiagram } = await import("@modelscript/diagram/swmm-diagram-builder");
    return buildSwmmDiagram(parseSwmm(text) as Parameters<typeof buildSwmmDiagram>[0]);
  },
  eclipse: async (text) => {
    const { parseEclipse } = await import("@modelscript/eclipse");
    const { buildEclipseDiagram } = await import("@modelscript/diagram/eclipse-diagram-builder");
    return buildEclipseDiagram(parseEclipse(text) as Parameters<typeof buildEclipseDiagram>[0]);
  },
  jsbsim: async (text) => {
    const { parseJsbsim } = await import("@modelscript/jsbsim");
    const { buildJsbsimDiagram } = await import("@modelscript/diagram/jsbsim-diagram-builder");
    const parsed: unknown = parseJsbsim(text);
    const doc =
      parsed && typeof parsed === "object" ? (parsed as { fdm?: Parameters<typeof buildJsbsimDiagram>[0] }) : {};
    return buildJsbsimDiagram((doc.fdm ?? parsed) as Parameters<typeof buildJsbsimDiagram>[0]);
  },
  lps: async (text) => {
    const { parseLps } = await import("@modelscript/lps");
    const { buildLpsDiagram } = await import("@modelscript/diagram/lps-diagram-builder");
    return buildLpsDiagram(parseLps(text) as Parameters<typeof buildLpsDiagram>[0]);
  },
  olga: async (text) => {
    const { parseOpi } = await import("@modelscript/olga");
    const { buildOlgaDiagram } = await import("@modelscript/diagram/olga-diagram-builder");
    return buildOlgaDiagram(parseOpi(text) as Parameters<typeof buildOlgaDiagram>[0]);
  },
  opendss: async (text) => {
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    return buildOpenDssDiagram(parseOpenDss(text) as Parameters<typeof buildOpenDssDiagram>[0]);
  },
  gridlabd: async (text) => {
    const { parseGridlabd, projectGridlabdToOpenDss } = await import("@modelscript/gridlabd");
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    const dss = projectGridlabdToOpenDss(parseGridlabd(text));
    return buildOpenDssDiagram(parseOpenDss(dss) as Parameters<typeof buildOpenDssDiagram>[0]);
  },
  cyme: async (text) => {
    const { parseCyme, projectCymeToOpenDss } = await import("@modelscript/cyme");
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    const dss = projectCymeToOpenDss(parseCyme(text));
    return buildOpenDssDiagram(parseOpenDss(dss) as Parameters<typeof buildOpenDssDiagram>[0]);
  },
  powerworld: async (text, params) => {
    const { parsePowerWorldAux, parseIeeeCdf, projectPowerWorldToPsseRaw } = await import("@modelscript/powerworld");
    const { parseRaw, solvePowerFlow } = await import("@modelscript/psse");
    const { buildPsseDiagram } = await import("@modelscript/diagram/psse-diagram-builder");
    const isCdf = params.uri.toLowerCase().endsWith(".cdf") || text.toUpperCase().includes("BUS DATA FOLLOWS");
    const model = isCdf ? parseIeeeCdf(text) : parsePowerWorldAux(text);
    const parsed = parseRaw(projectPowerWorldToPsseRaw(model));
    const pf = parsed.buses.size > 0 ? solvePowerFlow(parsed) : undefined;
    return buildPsseDiagram(
      parsed as Parameters<typeof buildPsseDiagram>[0],
      pf as Parameters<typeof buildPsseDiagram>[1],
    );
  },
  pypsa: async (text) => {
    const [{ buildPypsaDiagramInput }, { buildPsseDiagram }] = await Promise.all([
      import("@modelscript/pypsa"),
      import("@modelscript/diagram/psse-diagram-builder"),
    ]);
    return buildPsseDiagram(await buildPypsaDiagramInput(text));
  },
  openscenario: async (text) => {
    const { parseOpenScenario } = await import("@modelscript/openscenario");
    const { buildOpenScenarioDiagram } = await import("@modelscript/diagram/openscenario-diagram-builder");
    return buildOpenScenarioDiagram(
      parseOpenScenario(text) as unknown as Parameters<typeof buildOpenScenarioDiagram>[0],
    );
  },
  psse: async (text, params) => {
    const [{ buildPsseDiagramInput }, { buildPsseDiagram }] = await Promise.all([
      import("@modelscript/psse"),
      import("@modelscript/diagram/psse-diagram-builder"),
    ]);
    const { model, powerFlow } = await buildPsseDiagramInput(text, params.uri);
    return buildPsseDiagram(
      model as Parameters<typeof buildPsseDiagram>[0],
      powerFlow as Parameters<typeof buildPsseDiagram>[1],
    );
  },
  relap5: async (text) => {
    const { parseRelap5 } = await import("@modelscript/relap5");
    const { buildRelap5Diagram } = await import("@modelscript/diagram/relap5-diagram-builder");
    return buildRelap5Diagram(parseRelap5(text) as Parameters<typeof buildRelap5Diagram>[0]);
  },
  sbml: async (text) => {
    const { parseSbml } = await import("@modelscript/sbml");
    const { buildSbmlDiagram } = await import("@modelscript/diagram/sbml-diagram-builder");
    const parsed: unknown = parseSbml(text);
    const doc =
      parsed && typeof parsed === "object" ? (parsed as { model?: Parameters<typeof buildSbmlDiagram>[0] }) : {};
    return buildSbmlDiagram((doc.model ?? parsed) as Parameters<typeof buildSbmlDiagram>[0]);
  },
  touchstone: async (text) => {
    const { parseTouchstone } = await import("@modelscript/touchstone");
    const { buildTouchstoneDiagram } = await import("@modelscript/diagram/touchstone-diagram-builder");
    const doc = parseTouchstone(text) as unknown as Record<string, unknown> & {
      numPorts?: number | undefined;
      portCount?: number | undefined;
    };
    return buildTouchstoneDiagram({
      portCount: doc.numPorts ?? doc.portCount ?? 2,
      ...doc,
    } as unknown as Parameters<typeof buildTouchstoneDiagram>[0]);
  },
  easy5: async (text) => {
    const { parseEasy5 } = await import("@modelscript/easy5");
    const { buildEasy5Diagram } = await import("@modelscript/diagram/easy5-diagram-builder");
    return buildEasy5Diagram(parseEasy5(text));
  },
  rocets: async (text) => {
    const { parseRocetsDeck } = await import("@modelscript/rocets");
    const { buildRocetsDiagram } = await import("@modelscript/diagram/rocets-diagram-builder");
    return buildRocetsDiagram(parseRocetsDeck(text));
  },
  gtsuite: async (text, params) => {
    const { parseGtmModel, buildGtSuiteDiagramData } = await import("@modelscript/gtsuite");
    return buildGtSuiteDiagramData(parseGtmModel(text, params.uri));
  },
  ssp: async (text) => {
    const sspMod = (await import("@modelscript/ssp")) as unknown as {
      parseSsd: (source: string) => unknown;
      buildSspDiagramData?: ((model: unknown) => unknown) | undefined;
    };
    return typeof sspMod.buildSspDiagramData === "function" ? sspMod.buildSspDiagramData(sspMod.parseSsd(text)) : null;
  },
  autosar: async (text) => {
    const { parseArxml } = await import("@modelscript/autosar");
    const { buildAutosarDiagram } = await import("@modelscript/diagram/autosar-diagram-builder");
    return buildAutosarDiagram(parseArxml(text) as never);
  },
  "verilog-a": async (text) => {
    const { parseVerilogA } = await import("@modelscript/verilog-a");
    const { buildVerilogADiagram } = await import("@modelscript/diagram/verilog-a-diagram-builder");
    return buildVerilogADiagram(parseVerilogA(text) as never);
  },
  plcopen: async (text, params) => {
    const { parsePlcopen } = await import("@modelscript/plcopen");
    const { buildPlcopenDiagram } = await import("@modelscript/diagram/plcopen-diagram-builder");
    return buildPlcopenDiagram(parsePlcopen(text, params.uri) as never).diagram;
  },
  oscal: async (text, params) => {
    const { parseOscal } = await import("@modelscript/oscal");
    const { buildOscalDiagram } = await import("@modelscript/diagram/oscal-diagram-builder");
    const doc = parseOscal(text, params.uri);
    return buildOscalDiagram(doc as unknown as Parameters<typeof buildOscalDiagram>[0]);
  },
};

/**
 * Creates a dispatch object that routes diagram requests to the
 * appropriate language backend based on the document URI.
 */
export function createDiagramDispatch(backends: DiagramDispatchDeps) {
  const custom = backends.customBackends ?? new Map<string | RegExp, DiagramBackend>();

  function getBackend(uri: string): DiagramBackend {
    for (const [matcher, backend] of custom.entries()) {
      if (typeof matcher === "string" && uri.endsWith(matcher)) return backend;
      if (matcher instanceof RegExp && matcher.test(uri)) return backend;
    }
    if (uri.endsWith(".raw") || uri.endsWith(".dyr")) {
      return createPsseDiagramBackend(backends);
    }
    if (uri.endsWith(".pscx") || uri.endsWith(".pslx") || uri.endsWith(".pswx") || uri.endsWith(".psmx")) {
      return createPscadDiagramBackend(backends);
    }
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    if (plugin?.diagramBackend) {
      return plugin.diagramBackend as DiagramBackend;
    }
    if (uri.endsWith(".sysml") && backends.sysml2) return backends.sysml2;
    if (uri.endsWith(".mo") && backends.modelica) return backends.modelica;
    if (
      backends.owl2 &&
      (uri.endsWith(".owl") ||
        uri.endsWith(".owl2") ||
        uri.endsWith(".ofn") ||
        uri.endsWith(".owx") ||
        uri.endsWith(".ttl"))
    ) {
      return backends.owl2;
    }
    if (uri.endsWith(".ssd") || uri.endsWith(".ssp")) {
      return createSspDiagramBackend(backends);
    }
    if (uri.endsWith(".slx") || uri.endsWith(".mdl")) {
      return backends.simulink ?? createSimulinkDiagramBackend(backends);
    }
    if (uri.endsWith(".cir") || uri.endsWith(".sp") || uri.endsWith(".spice")) {
      return backends.spice ?? createSpiceDiagramBackend(backends);
    }
    if (uri.endsWith(".xodr") || uri.endsWith(".opendrive")) {
      return backends.opendrive ?? createOpenDriveDiagramBackend(backends);
    }
    const readKinematicSource = async (targetUri: string): Promise<string | null> => {
      const memText =
        (backends.generic as BackendWithDepsLike | undefined)?.deps?.getDocumentText?.(targetUri) ??
        (backends.modelica as BackendWithDepsLike | undefined)?.deps?.getDocumentText?.(targetUri);
      if (typeof memText === "string") return memText;
      try {
        const fs = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
        return await fs.promises.readFile(filePath, "utf-8");
      } catch {
        // ignore fs errors
      }
      return null;
    };

    interface RawDiagramCellLike {
      id: string;
      shape?: string | undefined;
      name?: string | undefined;
      label?: string | undefined;
      x?: number | undefined;
      y?: number | undefined;
      width?: number | undefined;
      height?: number | undefined;
      position?: { x: number; y: number } | undefined;
    }

    interface RawDiagramPayloadLike {
      cells?: RawDiagramCellLike[] | undefined;
      nodes?: RawDiagramCellLike[] | undefined;
      edges?: RawDiagramCellLike[] | undefined;
      metadata?: Record<string, unknown> | undefined;
    }

    const formatKinematicDiagramData = async (rawDiagram: unknown, targetUri: string): Promise<DiagramData> => {
      const raw = (rawDiagram && typeof rawDiagram === "object" ? rawDiagram : {}) as RawDiagramPayloadLike;
      const cells: RawDiagramCellLike[] = Array.isArray(raw.cells) ? raw.cells : [];
      const nodes: RawDiagramCellLike[] = Array.isArray(raw.nodes)
        ? raw.nodes
        : cells.filter((c) => c.shape !== "edge");
      const edges: RawDiagramCellLike[] = Array.isArray(raw.edges)
        ? raw.edges
        : cells.filter((c) => c.shape === "edge");

      // Merge any persisted sidecar layout positions so drag/move edits persist
      try {
        const storage = (backends.generic as BackendWithDepsLike | undefined)?.getLayoutStorage?.(targetUri);
        const layout = storage ? await storage.loadLayout(targetUri) : null;
        if (layout?.elements) {
          for (const node of nodes) {
            const nodeName = node.name || node.label || node.id;
            const el = layout.elements[node.id] || (nodeName && layout.elements[nodeName]);
            if (el) {
              node.x = el.x;
              node.y = el.y;
              if (node.position) {
                node.position.x = el.x;
                node.position.y = el.y;
              }
              if (el.width) node.width = el.width;
              if (el.height) node.height = el.height;
            }
          }
        }
      } catch {
        // ignore layout storage errors
      }

      return {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
        cells: cells.length > 0 ? cells : [...nodes, ...edges],
        readOnly: true,
        metadata: {
          ...raw.metadata,
          readOnly: true,
          layoutEditable: Boolean(backends.generic),
        },
      } as unknown as DiagramData;
    };

    const domainBackendCache = new Map<string, DiagramBackend>();

    const createDomainBuilderBackend = (
      buildFn: (text: string, params: DiagramGetDataParams) => Promise<unknown>,
      domainName?: string,
    ): DiagramBackend => ({
      async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
        try {
          const text = await readKinematicSource(params.uri);
          if (!text) return null;
          const rawDiagram = await buildFn(text, params);
          if (rawDiagram) {
            const formatted = await formatKinematicDiagramData(rawDiagram, params.uri);
            if (formatted.nodes && formatted.nodes.length > 0) {
              return formatted;
            }
          }
        } catch (err) {
          console.error(`[Diagram] Error building diagram for ${params.uri} (${domainName ?? "domain"}):`, err);
          return {
            nodes: [],
            edges: [],
            coordinateSystem: null,
            diagramBackground: null,
            readOnly: true,
            metadata: {
              error: err instanceof Error ? err.message : String(err),
              readOnly: true,
              domain: domainName,
            },
          } as unknown as DiagramData;
        }
        return {
          nodes: [],
          edges: [],
          coordinateSystem: null,
          diagramBackground: null,
          readOnly: true,
          metadata: {
            readOnly: true,
            domain: domainName,
          },
        } as unknown as DiagramData;
      },
      async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
        return backends.generic ? await backends.generic.getComponentProperties(params) : null;
      },
      async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
        const hasMutations = Boolean(
          (
            backends.generic as { deps?: { getDiagramConfig?: (u: string) => { mutations?: unknown } } } | undefined
          )?.deps?.getDiagramConfig?.(params.uri)?.mutations,
        );
        if (hasMutations && backends.generic) {
          return await backends.generic.applyEdits(params);
        }
        const spatialActions = params.actions.filter(
          (a) => a.type === "move" || a.type === "resize" || a.type === "rotate" || a.type === "moveEdge",
        );
        if (spatialActions.length < params.actions.length) {
          console.warn(
            `[Diagram] Cannot apply structural edits: ${domainName ?? "domain"} diagram for ${params.uri} only supports layout persistence.`,
          );
        }
        if (spatialActions.length > 0 && backends.generic) {
          const genericRes = await backends.generic.applyEdits({ ...params, actions: spatialActions });
          return {
            seq: params.seq,
            edits: genericRes?.edits ?? [],
            sidecarContent: genericRes?.sidecarContent,
            renderHint: genericRes?.renderHint ?? "none",
          };
        }
        return { seq: params.seq, edits: [], renderHint: "none" };
      },
    });

    const pluginId = plugin?.id?.toLowerCase() || (/\.oscal(\.(json|ya?ml|xml))?$/i.test(uri) ? "oscal" : undefined);
    if (pluginId) {
      if ((backends as Record<string, unknown>)[pluginId]) {
        return (backends as Record<string, unknown>)[pluginId] as DiagramBackend;
      }
      const pluginBuilder = plugin?.customHandlers?.buildDiagram;
      const builder = pluginBuilder
        ? (text: string, params: DiagramGetDataParams) => Promise.resolve(pluginBuilder(text, params))
        : DOMAIN_BUILDERS[pluginId];
      if (builder) {
        let cached = domainBackendCache.get(pluginId);
        if (!cached) {
          cached = createDomainBuilderBackend(builder, pluginId);
          domainBackendCache.set(pluginId, cached);
        }
        return cached;
      }
    }

    return (backends.generic ?? backends.modelica ?? backends.sysml2) as DiagramBackend;
  }

  return {
    getBackend,
    registerBackend(matcher: string | RegExp, backend: DiagramBackend) {
      custom.set(matcher, backend);
    },

    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      return await getBackend(params.uri).getData(params);
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      return await getBackend(params.uri).getComponentProperties(params);
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      // Expand high-level `pasteSubgraph` actions into atomic `addComponent` + `connect` actions
      // so every language backend gets topology-preserving copy/paste automatically.
      const expandedActions: DiagramApplyEditsParams["actions"] = [];
      let pasteCounter = Date.now() % 10000;
      for (const action of params.actions) {
        if (action.type === "pasteSubgraph") {
          const generatedNames: string[] = [];
          for (const node of action.nodes) {
            const shortType = (node.className.split(".").pop() || "comp").replace(/[^A-Za-z0-9_]/g, "");
            const base = shortType.charAt(0).toLowerCase() + shortType.slice(1);
            const genName = `${base}_${++pasteCounter}`;
            generatedNames.push(genName);
            expandedActions.push({
              type: "addComponent",
              className: node.className,
              name: genName,
              x: node.x,
              y: node.y,
              rotation: node.rotation,
              parameters: node.parameters,
            });
          }
          for (const edge of action.edges) {
            const srcName = generatedNames[edge.sourceIdx];
            const tgtName = generatedNames[edge.targetIdx];
            if (!srcName || !tgtName) continue;
            expandedActions.push({
              type: "connect",
              source: edge.sourcePort ? `${srcName}.${edge.sourcePort}` : srcName,
              target: edge.targetPort ? `${tgtName}.${edge.targetPort}` : tgtName,
              sourcePort: edge.sourcePort,
              targetPort: edge.targetPort,
            });
          }
        } else {
          expandedActions.push(action);
        }
      }
      return await getBackend(params.uri).applyEdits({ ...params, actions: expandedActions });
    },

    async getPalette(params: DiagramGetPaletteParams): Promise<DiagramPalette | null> {
      const backend = getBackend(params.uri);
      return backend.getPalette ? await backend.getPalette(params) : null;
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      const backend = getBackend(params.uri);
      return backend.drillDown ? await backend.drillDown(params) : null;
    },

    supports(uri: string): boolean {
      for (const matcher of custom.keys()) {
        if (typeof matcher === "string" ? uri.includes(matcher) : matcher.test(uri)) {
          return true;
        }
      }
      const plugin = globalLanguageRegistry.getPluginForUri(uri);
      const pluginId = plugin?.id?.toLowerCase() || (/\.oscal(\.(json|ya?ml|xml))?$/i.test(uri) ? "oscal" : undefined);
      if (pluginId) {
        if ((backends as Record<string, unknown>)[pluginId]) return true;
        if (plugin?.customHandlers?.buildDiagram || DOMAIN_BUILDERS[pluginId]) return true;
      }
      if (uri.endsWith(".mo") || pluginId === "modelica") return true;
      if (uri.endsWith(".sysml") || pluginId === "sysml2") return true;
      if (uri.endsWith(".owl") || uri.endsWith(".ofn") || uri.endsWith(".owx") || pluginId === "owl2") {
        return true;
      }
      if (/\.scad($|\?|#)/i.test(uri) || plugin?.id === "scad") return true;
      if (/\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i.test(uri) || plugin?.id === "fortran") return true;
      if (plugin?.customHandlers?.symbols) return true;
      const config = (backends.generic as BackendWithDepsLike | undefined)?.deps?.getDiagramConfig?.(uri);
      if (config) return true;
      return false;
    },
  };
}
