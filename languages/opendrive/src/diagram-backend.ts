// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deduplicateAndSort,
  getHostDocumentText,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramBackendHost,
  type DiagramData,
  type DiagramDrillDownParams,
  type DiagramDrillDownResult,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramPalette,
  type PropertyFieldConfig,
} from "@modelscript/diagram/protocol";
import {
  CstDocumentSession,
  CstSessionCache,
  CstTransaction,
  CstXmlAdapter,
  encodeXmlAttrValue,
  type CstIncrementalParser,
  type CstTextEdit,
} from "@modelscript/dsl/unparser";
import { getOpenDriveWasmParser } from "./parser/wasm-loader.js";

export function createOpenDriveCstSession(text: string, uri = "file:///road.xodr"): CstDocumentSession {
  let parser: CstIncrementalParser | null = null;
  try {
    parser = getOpenDriveWasmParser() as unknown as CstIncrementalParser;
  } catch {
    parser = null;
  }
  return new CstDocumentSession({ uri, text, parser, xmlFallback: true });
}

/**
 * CST-backed OpenDRIVE (`.xodr`) diagram edit planner operating directly on a live
 * {@link CstDocumentSession}. Zero regex patching; error-tolerant against broken sibling XML.
 */
export function planOpenDriveEditsOnSession(
  session: CstDocumentSession,
  actions: ReadonlyArray<DiagramApplyEditsParams["actions"][number]>,
): { edits: CstTextEdit[]; spatialActions: DiagramApplyEditsParams["actions"]; hasStructural: boolean } {
  const text = session.text;
  const root = session.rootNode;
  const tx = new CstTransaction(session);
  const spatialActions: DiagramApplyEditsParams["actions"] = [];
  let hasStructural = false;

  const parseEntity = (id: string): { kind: "road" | "junction"; id: string } | null => {
    if (id.startsWith("road_")) return { kind: "road", id: id.slice(5) };
    if (id.startsWith("junc_")) return { kind: "junction", id: id.slice(5) };
    return null;
  };

  const allocatedIds = new Map<"road" | "junction", number>();
  const nextId = (tag: "road" | "junction"): string => {
    let maxId = allocatedIds.get(tag) ?? 0;
    if (maxId === 0 && root) {
      for (const el of CstXmlAdapter.findElements(root, text, (_n, t) => t.toLowerCase() === tag)) {
        const raw = CstXmlAdapter.getAttribute(el, "id", text)?.value ?? "0";
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n > maxId) maxId = n;
      }
    }
    const next = maxId + 1;
    allocatedIds.set(tag, next);
    return String(next);
  };

  const openDriveEl = root
    ? (CstXmlAdapter.findElements(root, text, (_n, t) => t.toLowerCase() === "opendrive")[0] ?? null)
    : null;

  for (const action of actions) {
    if (action.type === "move" || action.type === "resize" || action.type === "rotate" || action.type === "moveEdge") {
      spatialActions.push(action);
    } else if (action.type === "addComponent") {
      if (!openDriveEl) continue;
      const isJunc = /junction/i.test(action.className);
      if (isJunc) {
        const id = nextId("junction");
        const juncName = encodeXmlAttrValue(action.name || `Junction_${id}`);
        CstXmlAdapter.appendChild(tx, openDriveEl, `<junction id="${id}" name="${juncName}">\n  </junction>`);
      } else {
        const id = nextId("road");
        const roadName = encodeXmlAttrValue(action.name || `Road_${id}`);
        const snippet = [
          `<road name="${roadName}" length="100.0" id="${id}" junction="-1">`,
          `    <planView>`,
          `      <geometry s="0.0" x="${Math.round(action.x)}" y="${Math.round(action.y)}" hdg="0.0" length="100.0">`,
          `        <line/>`,
          `      </geometry>`,
          `    </planView>`,
          `    <lanes><laneSection s="0.0"><center><lane id="0" type="none" level="false"/></center></laneSection></lanes>`,
          `  </road>`,
        ].join("\n");
        CstXmlAdapter.appendChild(tx, openDriveEl, snippet);
      }
      hasStructural = true;
    } else if (action.type === "deleteComponents") {
      for (const rawName of action.names) {
        const ent = parseEntity(rawName);
        if (!ent || !root) continue;
        const el = CstXmlAdapter.findElementByAttr(root, text, "id", ent.id, ent.kind);
        if (el) {
          CstXmlAdapter.deleteElement(tx, el);
          hasStructural = true;
        }
      }
    } else if (action.type === "updateName") {
      const ent = parseEntity(action.oldName);
      if (ent && root) {
        const el = CstXmlAdapter.findElementByAttr(root, text, "id", ent.id, ent.kind);
        if (el && CstXmlAdapter.setAttribute(tx, el, "name", action.newName)) {
          hasStructural = true;
        }
      }
    } else if (action.type === "updateParameter" || action.type === "updateProperty") {
      const ent = parseEntity(action.name);
      const key = action.type === "updateParameter" ? action.parameter : action.key;
      if (ent && root) {
        const el = CstXmlAdapter.findElementByAttr(root, text, "id", ent.id, ent.kind);
        if (el) {
          CstXmlAdapter.setAttribute(tx, el, key, String(action.value ?? ""));
        }
      }
    } else if (action.type === "connect" || action.type === "reconnect") {
      const srcId = action.type === "connect" ? action.source : action.newSource;
      const dstId = action.type === "connect" ? action.target : action.newTarget;
      const src = parseEntity(srcId);
      const dst = parseEntity(dstId);
      if (src?.kind === "road" && dst?.kind === "road" && root) {
        const roadEl = CstXmlAdapter.findElementByAttr(root, text, "id", src.id, "road");
        if (roadEl) {
          const linkEl = CstXmlAdapter.getChildElements(roadEl).find(
            (c) => (CstXmlAdapter.getTagName(c, text) ?? "").toLowerCase() === "link",
          );
          const succTag = `<successor elementType="road" elementId="${encodeXmlAttrValue(dst.id)}" contactPoint="start"/>`;
          if (linkEl) {
            const existingSucc = CstXmlAdapter.getChildElements(linkEl).find(
              (c) => (CstXmlAdapter.getTagName(c, text) ?? "").toLowerCase() === "successor",
            );
            if (existingSucc) {
              CstXmlAdapter.setAttribute(tx, existingSucc, "elementType", "road");
              CstXmlAdapter.setAttribute(tx, existingSucc, "elementId", dst.id);
              CstXmlAdapter.setAttribute(tx, existingSucc, "contactPoint", "start");
            } else {
              CstXmlAdapter.appendChild(tx, linkEl, succTag);
            }
          } else {
            CstXmlAdapter.appendChild(tx, roadEl, `<link>\n      ${succTag}\n    </link>`);
          }
          hasStructural = true;
        }
      }
    } else if (action.type === "disconnect") {
      const src = parseEntity(action.source);
      const dst = parseEntity(action.target);
      if (src?.kind === "road" && dst?.kind === "road" && root) {
        const roadEl = CstXmlAdapter.findElementByAttr(root, text, "id", src.id, "road");
        const linkEl = roadEl
          ? CstXmlAdapter.getChildElements(roadEl).find(
              (c) => (CstXmlAdapter.getTagName(c, text) ?? "").toLowerCase() === "link",
            )
          : undefined;
        if (linkEl) {
          for (const child of CstXmlAdapter.getChildElements(linkEl)) {
            if (
              (CstXmlAdapter.getTagName(child, text) ?? "").toLowerCase() === "successor" &&
              CstXmlAdapter.getAttribute(child, "elementId", text)?.value === dst.id
            ) {
              CstXmlAdapter.deleteElement(tx, child);
              hasStructural = true;
            }
          }
        }
      }
    }
  }

  return { edits: tx.commit().edits, spatialActions, hasStructural };
}

export function planOpenDriveEdits(
  text: string,
  actions: ReadonlyArray<DiagramApplyEditsParams["actions"][number]>,
  uri = "file:///road.xodr",
): { edits: CstTextEdit[]; spatialActions: DiagramApplyEditsParams["actions"]; hasStructural: boolean } {
  const session = createOpenDriveCstSession(text, uri);
  try {
    return planOpenDriveEditsOnSession(session, actions);
  } finally {
    session.dispose();
  }
}

export function createOpenDriveDiagramBackend(backends: DiagramBackendHost): DiagramBackend {
  const sessionCache = new CstSessionCache(16);
  const readOpenDriveSource = async (targetUri: string): Promise<string | null> => {
    const memText = getHostDocumentText(backends, targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore
    }
    return null;
  };

  const opendriveBackend = {
    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      const text = await readOpenDriveSource(params.uri);
      if (!text) return null;
      const { parseOpenDrive } = await import("./parser/index.js");
      const doc = parseOpenDrive(text);

      const nodes: unknown[] = [];
      const edges: unknown[] = [];

      let row = 0;
      let col = 0;
      for (const road of doc.roads) {
        const roadName = road.name ? `${road.name} (#${road.id})` : `Road ${road.id}`;
        const x = 50 + col * 260;
        const y = 50 + row * 160;
        col++;
        if (col > 3) {
          col = 0;
          row++;
        }

        nodes.push({
          id: `road_${road.id}`,
          label: roadName,
          kind: "road",
          position: { x, y },
          size: { width: 220, height: 100 },
          ports: [
            { id: "start", name: "start", direction: "inout" },
            { id: "end", name: "end", direction: "inout" },
          ],
          data: {
            roadId: road.id,
            length: road.length,
            junction: road.junction,
            segmentsCount: road.planView.length,
            lanesCount: road.lanes.laneSections.length,
            signalsCount: road.signals.length,
          },
        });

        if (road.link?.successor?.elementType === "road") {
          edges.push({
            id: `edge_${road.id}_succ_${road.link.successor.elementId}`,
            source: `road_${road.id}`,
            target: `road_${road.link.successor.elementId}`,
            sourcePort: "end",
            targetPort: road.link.successor.contactPoint === "end" ? "end" : "start",
            kind: "connection",
          });
        }
      }

      for (const junc of doc.junctions) {
        const x = 50 + col * 260;
        const y = 50 + row * 160;
        col++;
        if (col > 3) {
          col = 0;
          row++;
        }

        nodes.push({
          id: `junc_${junc.id}`,
          label: `Junction ${junc.name ?? junc.id}`,
          kind: "junction",
          position: { x, y },
          size: { width: 180, height: 80 },
          ports: [{ id: "junc_port", name: "junc", direction: "inout" }],
          data: {
            junctionId: junc.id,
            connectionsCount: junc.connections.length,
          },
        });

        for (const conn of junc.connections) {
          edges.push({
            id: `conn_${junc.id}_${conn.id}`,
            source: `road_${conn.incomingRoad}`,
            target: `road_${conn.connectingRoad}`,
            sourcePort: "end",
            targetPort: conn.contactPoint === "end" ? "end" : "start",
            kind: "junction_connection",
          });
        }
      }

      return {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
      } as unknown as DiagramData;
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      const text = await readOpenDriveSource(params.uri);
      if (!text) return null;
      const { parseOpenDrive } = await import("./parser/index.js");
      const doc = parseOpenDrive(text);
      const rawComp = params.componentName || "";
      const rawId = rawComp.startsWith("road_")
        ? rawComp.slice(5)
        : rawComp.startsWith("junc_")
          ? rawComp.slice(5)
          : rawComp;

      const road = doc.roads.find((r) => r.id === rawId || r.name === rawId);
      if (road) {
        const parameters: ComponentPropertyData["parameters"] = [
          { name: "id", value: road.id, group: "General" },
          { name: "length", value: String(road.length), group: "Geometry" },
          { name: "junction", value: road.junction, group: "Topology" },
          { name: "segments", value: String(road.planView.length), group: "Geometry" },
          { name: "signals", value: String(road.signals.length), group: "Equipment" },
        ];
        const fields: PropertyFieldConfig[] = [
          { key: "id", label: "Road ID", kind: "string", defaultValue: road.id },
          { key: "length", label: "Length (m)", kind: "number", defaultValue: road.length },
          { key: "junction", label: "Junction ID", kind: "string", defaultValue: road.junction },
        ];
        return {
          classKind: "road",
          className: "Road",
          name: road.name ?? `Road_${road.id}`,
          description: `OpenDRIVE Road (${road.name ?? road.id}, length=${road.length}m)`,
          parameters,
          schema: {
            title: `Road: ${road.name ?? road.id}`,
            tabs: [
              { id: "general", label: "Road Properties", groups: [{ id: "main", label: "Configuration", fields }] },
            ],
          },
          values: { id: road.id, length: road.length, junction: road.junction },
        };
      }

      const junc = doc.junctions.find((j) => j.id === rawId || j.name === rawId);
      if (junc) {
        const parameters: ComponentPropertyData["parameters"] = [
          { name: "id", value: junc.id, group: "General" },
          { name: "connections", value: String(junc.connections.length), group: "Topology" },
        ];
        const fields: PropertyFieldConfig[] = [
          { key: "id", label: "Junction ID", kind: "string", defaultValue: junc.id },
          { key: "connections", label: "Connection Count", kind: "number", defaultValue: junc.connections.length },
        ];
        return {
          classKind: "junction",
          className: "Junction",
          name: junc.name ?? `Junction_${junc.id}`,
          description: `OpenDRIVE Junction (${junc.name ?? junc.id})`,
          parameters,
          schema: {
            title: `Junction: ${junc.name ?? junc.id}`,
            tabs: [
              {
                id: "general",
                label: "Junction Properties",
                groups: [{ id: "main", label: "Configuration", fields }],
              },
            ],
          },
          values: { id: junc.id, connections: junc.connections.length },
        };
      }
      return null;
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      const text = await readOpenDriveSource(params.uri);
      if (!text) return null;
      const { parseOpenDrive } = await import("./parser/index.js");
      const doc = parseOpenDrive(text);
      const targetName = params.className || params.componentName || params.nodeId || "";
      const rawId = targetName.startsWith("road_") ? targetName.slice(5) : targetName;
      const road = doc.roads.find((r) => r.id === rawId || r.name === rawId);
      if (!road) return null;

      const nodes = road.planView.map((geom, idx) => ({
        id: `geom_${idx}`,
        label: `${geom.type.toUpperCase()} [${geom.length.toFixed(1)}m]`,
        kind: geom.type,
        position: { x: 50 + idx * 180, y: 100 },
        size: { width: 150, height: 70 },
        ports: [
          { id: "in", name: "in", direction: "in" },
          { id: "out", name: "out", direction: "out" },
        ],
        data: { ...geom },
      }));

      const edges = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
          id: `geom_flow_${i}_${i + 1}`,
          source: `geom_${i}`,
          target: `geom_${i + 1}`,
          sourcePort: "out",
          targetPort: "in",
        });
      }

      return {
        data: {
          nodes,
          edges,
          coordinateSystem: null,
          diagramBackground: null,
        } as unknown as DiagramData,
        breadcrumbs: [{ id: road.id, label: road.name ?? `Road ${road.id}`, uri: params.uri }],
        targetUri: params.uri,
        targetClassName: road.name ?? road.id,
      };
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      const text = await readOpenDriveSource(params.uri);
      if (!text) {
        return backends.generic?.applyEdits
          ? await backends.generic.applyEdits(params)
          : { seq: params.seq, edits: [], renderHint: "none" };
      }

      const session = sessionCache.getOrUpdate(params.uri, text, () => createOpenDriveCstSession(text, params.uri));
      const { edits, spatialActions, hasStructural } = planOpenDriveEditsOnSession(session, params.actions);

      if (spatialActions.length > 0 && backends.generic?.applyEdits) {
        const genericRes = await backends.generic.applyEdits({ ...params, actions: spatialActions });
        if (genericRes?.edits?.length) {
          edits.push(...genericRes.edits);
        }
        return {
          seq: params.seq,
          edits: deduplicateAndSort(edits),
          sidecarContent: genericRes?.sidecarContent,
          renderHint: hasStructural ? "immediate" : (genericRes?.renderHint ?? "none"),
        };
      }

      return {
        seq: params.seq,
        edits: deduplicateAndSort(edits),
        renderHint: hasStructural ? "immediate" : "none",
      };
    },

    async getPalette(): Promise<DiagramPalette> {
      return {
        categories: [
          {
            name: "Roadway Entities",
            items: [
              { className: "Road", label: "Road", description: "OpenDRIVE road segment" },
              { className: "Junction", label: "Junction", description: "OpenDRIVE road junction" },
            ],
          },
          {
            name: "Geometry Elements",
            items: [
              { className: "Line", label: "Line", description: "Straight road segment" },
              { className: "Spiral", label: "Spiral (Clothoid)", description: "Transition spiral curve" },
              { className: "Arc", label: "Arc", description: "Circular road curve" },
              { className: "Poly3", label: "Cubic Polynomial", description: "Polynomial curve" },
            ],
          },
        ],
      };
    },
  };
  return opendriveBackend as DiagramBackend;
}
