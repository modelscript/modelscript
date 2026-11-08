// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramBackend, DiagramDispatchDeps } from "../diagramApi.js";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramPalette,
  PropertyFieldConfig,
} from "../diagramProtocol.js";

export function createOpenDriveDiagramBackend(backends: DiagramDispatchDeps): DiagramBackend {
  const readOpenDriveSource = async (targetUri: string): Promise<string | null> => {
    const memText =
      (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
      (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
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
      const { parseOpenDrive } = await import("@modelscript/opendrive");
      const doc = parseOpenDrive(text);

      const nodes: any[] = [];
      const edges: any[] = [];

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
      } as any;
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      const text = await readOpenDriveSource(params.uri);
      if (!text) return null;
      const { parseOpenDrive } = await import("@modelscript/opendrive");
      const doc = parseOpenDrive(text);
      const rawId = (params.componentName || "").replace(/^road_/, "").replace(/^junc_/, "");

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
      const { parseOpenDrive } = await import("@modelscript/opendrive");
      const doc = parseOpenDrive(text);
      const targetName = params.className || params.componentName || params.nodeId || "";
      const rawId = targetName.replace(/^road_/, "");
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
        } as any,
        breadcrumbs: [{ id: road.id, label: road.name ?? `Road ${road.id}`, uri: params.uri }],
        targetUri: params.uri,
        targetClassName: road.name ?? road.id,
      };
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      if (backends.generic) {
        return await backends.generic.applyEdits(params);
      }
      return { seq: params.seq, edits: [], renderHint: "none" };
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
