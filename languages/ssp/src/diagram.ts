// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native 2D Diagram Builder and Bidirectional XML Mutator for SSP (.ssd / .ssp).
 *
 * Converts parsed `SspSystem` models directly into AntV X6 `DiagramData`
 * and translates interactive `DiagramEditAction` batches into line-accurate
 * XML `TextEdit`s on `SystemStructure.ssd`.
 */

import { parseSsd } from "./ssd-parser.js";
import type { SspComponent, SspConnection, SspConnector, SspConnectorType, SspSystem } from "./types.js";

export interface SspTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

const CONNECTOR_TYPE_COLORS: Record<SspConnectorType, string> = {
  Real: "#3b82f6",
  Integer: "#f97316",
  Boolean: "#ec4899",
  String: "#10b981",
  Enumeration: "#a855f7",
};

/**
 * Build AntV X6-compatible `DiagramData` directly from an `SspSystem` or `.ssd` XML string.
 */
export function buildSspDiagramData(input: SspSystem | string) {
  const system: SspSystem = typeof input === "string" ? parseSsd(input) : input;
  const nodes: ({ id: string } & Record<string, unknown>)[] = [];
  const edges: Record<string, unknown>[] = [];

  const portGroups = {
    in: {
      position: "left",
      zIndex: 10,
      attrs: {
        circle: { r: 4, fill: "#1e293b", stroke: "#3b82f6", strokeWidth: 1.5 },
      },
    },
    out: {
      position: "right",
      zIndex: 10,
      attrs: {
        circle: { r: 4, fill: "#3b82f6", stroke: "#1e293b", strokeWidth: 1.5 },
      },
    },
    param: {
      position: "top",
      zIndex: 10,
    },
  };

  // Collect bound parameter values per component prefix
  const boundParamsByComp = new Map<
    string,
    Map<string, { value: string | number | boolean; unit?: string | undefined }>
  >();
  for (const binding of system.parameterBindings || []) {
    const prefix = (binding.prefix ?? "").replace(/\.$/, "");
    for (const val of binding.values || []) {
      let targetComp = prefix;
      let paramName = val.name;
      if (!targetComp && val.name.includes(".")) {
        const dotIdx = val.name.indexOf(".");
        targetComp = val.name.slice(0, dotIdx);
        paramName = val.name.slice(dotIdx + 1);
      }
      if (!boundParamsByComp.has(targetComp)) {
        boundParamsByComp.set(targetComp, new Map());
      }
      boundParamsByComp.get(targetComp)!.set(paramName, { value: val.value, unit: val.unit });
    }
  }

  let maxRightX = 400;

  // 1. Component (FMU) Nodes
  system.components.forEach((cmp, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const hasGeom = Boolean(cmp.geometry);
    const width = hasGeom ? Math.max(140, Math.round(Math.abs(cmp.geometry!.x2 - cmp.geometry!.x1))) : 180;
    const height = hasGeom ? Math.max(80, Math.round(Math.abs(cmp.geometry!.y2 - cmp.geometry!.y1))) : 100;
    const x = hasGeom ? Math.round(Math.min(cmp.geometry!.x1, cmp.geometry!.x2)) : 160 + col * 260;
    const y = hasGeom ? Math.round(Math.min(cmp.geometry!.y1, cmp.geometry!.y2)) : 100 + row * 160;
    const angle = cmp.geometry?.rotation ?? 0;

    if (x + width > maxRightX) maxRightX = x + width;

    const inputs = cmp.connectors.filter((c) => c.kind === "input");
    const outputs = cmp.connectors.filter((c) => c.kind === "output" || c.kind === "inout");
    const params = cmp.connectors.filter((c) => c.kind === "parameter" || c.kind === "calculatedParameter");

    const resolveX6PortColor = (c: SspConnector): string => {
      if (c.unit === "W" || c.unit === "kW") return "#f59e0b";
      if (c.unit === "K" || c.unit === "degC") return "#38bdf8";
      return CONNECTOR_TYPE_COLORS[c.type] ?? "#3b82f6";
    };

    const portItems: Record<string, unknown>[] = [];
    inputs.forEach((conn, i) => {
      const py = conn.geometry
        ? Math.round(conn.geometry.y * height)
        : Math.round(((i + 1) * height) / (inputs.length + 1));
      const color = resolveX6PortColor(conn);
      const labelText = conn.unit ? `${conn.name} [${conn.unit}]` : conn.name;
      portItems.push({
        id: conn.name,
        group: "in",
        args: { x: 0, y: py, angle: 180 },
        attrs: {
          text: { text: labelText, fill: "#cbd5e1", fontSize: 10 },
        },
        markup: {
          tagName: "polygon",
          attrs: { points: "-5,-5 5,0 -5,5", fill: color, stroke: "#0f172a", "stroke-width": 1 },
        },
      });
    });

    outputs.forEach((conn, i) => {
      const py = conn.geometry
        ? Math.round(conn.geometry.y * height)
        : Math.round(((i + 1) * height) / (outputs.length + 1));
      const color = resolveX6PortColor(conn);
      const labelText = conn.unit ? `${conn.name} [${conn.unit}]` : conn.name;
      portItems.push({
        id: conn.name,
        group: "out",
        args: { x: width, y: py, angle: 0 },
        attrs: {
          text: { text: labelText, fill: "#cbd5e1", fontSize: 10 },
        },
        markup: {
          tagName: "polygon",
          attrs: { points: "-5,-5 5,0 -5,5", fill: "#ffffff", stroke: color, "stroke-width": 1.5 },
        },
      });
    });

    const compBoundParams = boundParamsByComp.get(cmp.name) ?? new Map();
    const paramEntries: { name: string; value: string; group?: string | undefined; unit?: string | undefined }[] = [
      { name: "source", value: cmp.source, group: "FMU Resource" },
      ...(cmp.type ? [{ name: "type", value: cmp.type, group: "FMU Resource" }] : []),
    ];

    for (const p of params) {
      const boundEntry = compBoundParams.get(p.name) ?? boundParamsByComp.get("")?.get(`${cmp.name}.${p.name}`);
      paramEntries.push({
        name: p.name,
        value: boundEntry !== undefined ? String(boundEntry.value) : "",
        unit: p.unit ?? boundEntry?.unit,
        group: "Parameters",
      });
    }
    for (const [k, v] of compBoundParams.entries()) {
      if (!params.some((p) => p.name === k)) {
        paramEntries.push({
          name: k,
          value: String(v.value),
          unit: v.unit,
          group: "Parameters",
        });
      }
    }

    const shortSource = cmp.source.split("/").pop() || cmp.source || "FMU";

    nodes.push({
      id: cmp.name,
      shape: "rect",
      x,
      y,
      width,
      height,
      angle,
      opacity: 1,
      zIndex: 2,
      autoLayout: !hasGeom,
      properties: {
        className: cmp.type || "application/x-fmu-sharedlibrary",
        name: cmp.name,
        description: cmp.source,
        parameters: paramEntries,
      },
      ports: {
        groups: portGroups,
        items: portItems,
      },
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: "#10b981",
          strokeWidth: 2,
          rx: 6,
          ry: 6,
        },
        header: {
          text: "«FMU Component»",
          fill: "#10b981",
          fontSize: 9,
          fontWeight: "600",
        },
        label: {
          text: cmp.name,
          fill: "#f8fafc",
          fontSize: 13,
          fontWeight: "bold",
        },
      },
      markup: {
        tagName: "g",
        children: [
          {
            tagName: "rect",
            selector: "body",
            attrs: {
              width,
              height,
              rx: 6,
              ry: 6,
              fill: "#1e293b",
              stroke: "#10b981",
              "stroke-width": 2,
            },
          },
          {
            tagName: "text",
            selector: "header",
            textContent: "«FMU Component»",
            attrs: {
              x: width / 2,
              y: 18,
              "text-anchor": "middle",
              fill: "#10b981",
              "font-size": 9,
              "font-weight": 600,
            },
          },
          {
            tagName: "text",
            selector: "label",
            textContent: cmp.name,
            attrs: {
              x: width / 2,
              y: Math.round(height / 2),
              "text-anchor": "middle",
              fill: "#f8fafc",
              "font-size": 13,
              "font-weight": 700,
            },
          },
          {
            tagName: "text",
            selector: "sublabel",
            textContent: shortSource,
            attrs: {
              x: width / 2,
              y: Math.round(height / 2) + 18,
              "text-anchor": "middle",
              fill: "#94a3b8",
              "font-size": 10,
            },
          },
        ],
      },
    });
  });

  // 2. System Boundary Connector Nodes
  const boundaryConnectors = (system.connectors ?? []).filter(
    (c) => c.kind === "input" || c.kind === "output" || c.kind === "inout",
  );
  const sysInputs = boundaryConnectors.filter((c) => c.kind === "input");
  const sysOutputs = boundaryConnectors.filter((c) => c.kind === "output" || c.kind === "inout");

  const addBoundaryNode = (conn: SspConnector, index: number, isInput: boolean) => {
    const width = 110;
    const height = 36;
    const defaultX = isInput ? 20 : maxRightX + 100;
    const defaultY = 100 + index * 70;
    const x = conn.geometry ? Math.round(conn.geometry.x) : defaultX;
    const y = conn.geometry ? Math.round(conn.geometry.y) : defaultY;
    const color = CONNECTOR_TYPE_COLORS[conn.type] ?? "#3b82f6";
    const portSide = isInput ? "out" : "in";

    nodes.push({
      id: conn.name,
      shape: "rect",
      x,
      y,
      width,
      height,
      angle: 0,
      opacity: 1,
      zIndex: 2,
      autoLayout: !conn.geometry,
      properties: {
        className: `BoundaryConnector (${conn.kind})`,
        name: conn.name,
        description: `${conn.kind} ${conn.type}${conn.unit ? ` [${conn.unit}]` : ""}`,
        parameters: [
          { name: "kind", value: conn.kind, group: "Connector" },
          { name: "type", value: conn.type, group: "Connector" },
          ...(conn.unit ? [{ name: "unit", value: conn.unit, group: "Connector" }] : []),
        ],
      },
      ports: {
        groups: portGroups,
        items: [
          {
            id: conn.name,
            group: portSide,
            args: { x: isInput ? width : 0, y: height / 2, angle: isInput ? 0 : 180 },
            markup: {
              tagName: "circle",
              attrs: { r: 4, fill: color, stroke: "#0f172a", "stroke-width": 1.5 },
            },
          },
        ],
      },
      attrs: {
        body: { fill: "#0f172a", stroke: color, strokeWidth: 1.5, rx: 4, ry: 4 },
        label: { text: conn.name, fill: "#e2e8f0", fontSize: 11, fontWeight: "600" },
      },
      markup: {
        tagName: "g",
        children: [
          {
            tagName: "rect",
            selector: "body",
            attrs: {
              width,
              height,
              rx: 4,
              ry: 4,
              fill: "#0f172a",
              stroke: color,
              "stroke-width": 1.5,
              "stroke-dasharray": "4 2",
            },
          },
          {
            tagName: "text",
            selector: "label",
            textContent: conn.name,
            attrs: {
              x: width / 2,
              y: height / 2 + 4,
              "text-anchor": "middle",
              fill: "#e2e8f0",
              "font-size": 11,
              "font-weight": 600,
            },
          },
        ],
      },
    });
  };

  sysInputs.forEach((c, idx) => addBoundaryNode(c, idx, true));
  sysOutputs.forEach((c, idx) => addBoundaryNode(c, idx, false));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const resolveEndpoint = (element: string, connector: string): { cell: string; port: string } | null => {
    if (element && nodeIds.has(element)) {
      return { cell: element, port: connector };
    }
    if ((!element || element === system.name) && nodeIds.has(connector)) {
      return { cell: connector, port: connector };
    }
    return null;
  };

  // Lookup connector type for coloring edges
  const findConnectorType = (element: string, connector: string): SspConnectorType => {
    if (!element || element === system.name) {
      const bc = system.connectors?.find((c) => c.name === connector);
      if (bc) return bc.type;
    }
    const cmp = system.components.find((c) => c.name === element);
    const conn = cmp?.connectors.find((c) => c.name === connector);
    return conn?.type ?? "Real";
  };

  // 3. Connections
  system.connections.forEach((conn, idx) => {
    const src = resolveEndpoint(conn.startElement, conn.startConnector);
    const tgt = resolveEndpoint(conn.endElement, conn.endConnector);
    if (!src || !tgt) return;

    const connType = findConnectorType(conn.startElement, conn.startConnector);
    const stroke = CONNECTOR_TYPE_COLORS[connType] ?? "#3b82f6";
    const srcPath = conn.startElement ? `${conn.startElement}.${conn.startConnector}` : conn.startConnector;
    const tgtPath = conn.endElement ? `${conn.endElement}.${conn.endConnector}` : conn.endConnector;

    edges.push({
      id: `ssp_conn_${idx + 1}_${srcPath}_${tgtPath}`,
      source: {
        cell: src.cell,
        port: src.port,
        anchor: "right",
        connectionPoint: { name: "boundary" },
      },
      target: {
        cell: tgt.cell,
        port: tgt.port,
        anchor: "left",
        connectionPoint: { name: "boundary" },
      },
      vertices: conn.points,
      zIndex: 1,
      router: "port-orthogonal-astar",
      style: { color: stroke, type: connType },
      attrs: {
        line: {
          stroke,
          strokeWidth: 2,
          targetMarker: {
            name: "classic",
            fill: stroke,
            stroke,
          },
        },
      },
    });
  });

  const sysGeom = system.geometry;
  const coordinateSystem = sysGeom
    ? {
        x: Math.min(sysGeom.x1, sysGeom.x2),
        y: Math.min(sysGeom.y1, sysGeom.y2),
        width: Math.max(800, Math.abs(sysGeom.x2 - sysGeom.x1)),
        height: Math.max(600, Math.abs(sysGeom.y2 - sysGeom.y1)),
      }
    : { x: 0, y: 0, width: Math.max(1000, maxRightX + 260), height: 700 };

  return {
    nodes,
    edges,
    coordinateSystem,
    diagramBackground: null,
    availableViews: [{ id: "All", label: "System Structure (.ssd)" }],
    activeView: "All",
  };
}

export interface SspDiagramEditItem {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface SspDiagramEditAction extends SspDiagramEditItem {
  type?: string;
  action?: string;
  items?: SspDiagramEditItem[];
  item?: SspDiagramEditItem;
  source?: string;
  target?: string;
  sourceComponent?: string;
  sourcePort?: string;
  targetComponent?: string;
  targetPort?: string;
  points?: { x: number; y: number }[];
  edges?: { source: string; target: string; points?: { x: number; y: number }[] }[];
  className?: string;
  names?: string[];
  oldName?: string;
  newName?: string;
  key?: string;
  parameter?: string;
  value?: string | number | boolean;
}

/**
 * Apply a batch of interactive diagram edit actions to a `SystemStructure.ssd` XML document.
 */
export function applySspDiagramEdits(
  xml: string,
  actions: SspDiagramEditAction[],
  parsedSystem?: SspSystem,
): SspTextEdit[] {
  const system = parsedSystem ?? parseSsd(xml);
  const lines = xml.split("\n");
  const edits: SspTextEdit[] = [];

  const findComponentEndLine = (startLine0: number): number => {
    const startLineText = (lines[startLine0] ?? "").trimEnd();
    if (startLineText.endsWith("/>")) return startLine0;
    for (let i = startLine0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.includes("</Component>") || line.includes("</ssd:Component>")) return i;
    }
    return startLine0;
  };

  const findClosingTagLine = (tag: string, fromLine = 0): number => {
    const target1 = `</${tag}>`.toLowerCase();
    const target2 = `</ssd:${tag}>`.toLowerCase();
    for (let i = fromLine; i < lines.length; i++) {
      const lower = lines[i]!.toLowerCase();
      if (lower.includes(target1) || lower.includes(target2)) return i;
    }
    return -1;
  };

  const parseEndpointRef = (ref: string): { element: string; connector: string } => {
    const dotIdx = ref.indexOf(".");
    if (dotIdx !== -1) {
      return { element: ref.slice(0, dotIdx), connector: ref.slice(dotIdx + 1) };
    }
    // Check if ref matches a boundary connector name
    const isBoundary = system.connectors?.some((c) => c.name === ref);
    if (isBoundary) {
      return { element: "", connector: ref };
    }
    return { element: ref, connector: "y" };
  };

  const findMatchingConnection = (source: string, target: string): SspConnection | undefined => {
    const src = parseEndpointRef(source);
    const tgt = parseEndpointRef(target);
    return system.connections.find((c) => {
      const cSrcEl = c.startElement === system.name ? "" : c.startElement;
      const cTgtEl = c.endElement === system.name ? "" : c.endElement;
      const srcEl = src.element === system.name ? "" : src.element;
      const tgtEl = tgt.element === system.name ? "" : tgt.element;
      return (
        cSrcEl === srcEl && c.startConnector === src.connector && cTgtEl === tgtEl && c.endConnector === tgt.connector
      );
    });
  };

  const upsertComponentGeometry = (
    cmp: SspComponent,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation?: number,
  ) => {
    const x1 = Math.round(x);
    const y1 = Math.round(y);
    const x2 = Math.round(x + (width || 180));
    const y2 = Math.round(y + (height || 100));
    const rotAttr =
      rotation !== undefined && rotation !== 0
        ? ` rotation="${Math.round(rotation)}"`
        : cmp.geometry?.rotation
          ? ` rotation="${cmp.geometry.rotation}"`
          : "";
    const geomTag = `<ssd:ElementGeometry x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${rotAttr} />`;

    if (cmp.geometryLine && cmp.geometryLine - 1 < lines.length) {
      const gIdx = cmp.geometryLine - 1;
      const lineText = lines[gIdx]!;
      const indent = /^(\s*)/.exec(lineText)?.[1] ?? "        ";
      edits.push({
        range: {
          start: { line: gIdx, character: 0 },
          end: { line: gIdx, character: lineText.length },
        },
        newText: `${indent}${geomTag}`,
      });
      return;
    }

    if (cmp.line && cmp.line - 1 < lines.length) {
      const startIdx = cmp.line - 1;
      const openLine = lines[startIdx]!;
      const indent = /^(\s*)/.exec(openLine)?.[1] ?? "      ";
      if (openLine.trimEnd().endsWith("/>")) {
        const trimmed = openLine.trimEnd();
        const expanded = trimmed.slice(0, -2).trimEnd() + `>\n${indent}  ${geomTag}\n${indent}</ssd:Component>`;
        edits.push({
          range: {
            start: { line: startIdx, character: 0 },
            end: { line: startIdx, character: openLine.length },
          },
          newText: expanded,
        });
      } else {
        const endIdx = findComponentEndLine(startIdx);
        edits.push({
          range: {
            start: { line: endIdx, character: 0 },
            end: { line: endIdx, character: 0 },
          },
          newText: `${indent}  ${geomTag}\n`,
        });
      }
    }
  };

  for (const rawAction of actions) {
    const actionType = rawAction.type ?? rawAction.action;
    const action = rawAction;
    if (actionType === "move") {
      const items = action.items || (action.name ? [action] : []);
      for (const item of items) {
        const cmp = system.components.find((c) => c.name === item.name);
        if (cmp) {
          upsertComponentGeometry(
            cmp,
            item.x ?? 0,
            item.y ?? 0,
            item.width ?? (cmp.geometry ? Math.abs(cmp.geometry.x2 - cmp.geometry.x1) : 180),
            item.height ?? (cmp.geometry ? Math.abs(cmp.geometry.y2 - cmp.geometry.y1) : 100),
            item.rotation,
          );
        }
      }
    } else if (actionType === "resize" || actionType === "rotate") {
      const item = action.item ?? (action.name ? action : undefined);
      if (item) {
        const cmp = system.components.find((c) => c.name === item.name);
        if (cmp) {
          upsertComponentGeometry(cmp, item.x ?? 0, item.y ?? 0, item.width ?? 180, item.height ?? 100, item.rotation);
        }
      }
    } else if (actionType === "connect") {
      const src =
        action.sourcePort !== undefined
          ? { element: action.sourceComponent || "", connector: action.sourcePort }
          : parseEndpointRef(action.source ?? "");
      const tgt =
        action.targetPort !== undefined
          ? { element: action.targetComponent || "", connector: action.targetPort }
          : parseEndpointRef(action.target ?? "");
      const startElAttr = src.element ? `startElement="${src.element}" ` : "";
      const endElAttr = tgt.element ? `endElement="${tgt.element}" ` : "";
      let connSnippet: string;
      if (Array.isArray(action.points) && action.points.length > 2) {
        const interior = action.points.slice(1, -1);
        const px = interior.map((p: { x: number; y: number }) => Math.round(p.x)).join(" ");
        const py = interior.map((p: { x: number; y: number }) => Math.round(p.y)).join(" ");
        connSnippet =
          `      <ssd:Connection ${startElAttr}startConnector="${src.connector}" ${endElAttr}endConnector="${tgt.connector}">\n` +
          `        <ssd:ConnectionGeometry pointsX="${px}" pointsY="${py}" />\n` +
          `      </ssd:Connection>\n`;
      } else {
        connSnippet = `      <ssd:Connection ${startElAttr}startConnector="${src.connector}" ${endElAttr}endConnector="${tgt.connector}" />\n`;
      }

      const closeConnsIdx = findClosingTagLine("Connections");
      if (closeConnsIdx >= 0) {
        edits.push({
          range: { start: { line: closeConnsIdx, character: 0 }, end: { line: closeConnsIdx, character: 0 } },
          newText: connSnippet,
        });
      } else {
        const closeSysIdx = findClosingTagLine("System");
        const insertIdx = closeSysIdx >= 0 ? closeSysIdx : lines.length;
        edits.push({
          range: { start: { line: insertIdx, character: 0 }, end: { line: insertIdx, character: 0 } },
          newText: `    <ssd:Connections>\n${connSnippet}    </ssd:Connections>\n`,
        });
      }
    } else if (actionType === "disconnect") {
      const matched = findMatchingConnection(action.source ?? "", action.target ?? "");
      if (matched?.line && matched.line - 1 < lines.length) {
        const startIdx = matched.line - 1;
        let endIdx = startIdx;
        if (!/\/>\s*$/.test(lines[startIdx]!)) {
          while (endIdx < lines.length && !/<\/(?:ssd:)?Connection>/i.test(lines[endIdx]!)) {
            endIdx++;
          }
        }
        edits.push({
          range: {
            start: { line: startIdx, character: 0 },
            end: { line: Math.min(lines.length, endIdx + 1), character: 0 },
          },
          newText: "",
        });
      }
    } else if (actionType === "moveEdge") {
      for (const edge of action.edges || []) {
        const matched = findMatchingConnection(edge.source, edge.target);
        if (matched?.line && matched.line - 1 < lines.length && Array.isArray(edge.points)) {
          const startIdx = matched.line - 1;
          let endIdx = startIdx;
          if (!/\/>\s*$/.test(lines[startIdx]!)) {
            while (endIdx < lines.length && !/<\/(?:ssd:)?Connection>/i.test(lines[endIdx]!)) {
              endIdx++;
            }
          }
          const startElAttr = matched.startElement ? `startElement="${matched.startElement}" ` : "";
          const endElAttr = matched.endElement ? `endElement="${matched.endElement}" ` : "";
          const interior = edge.points.length > 2 ? edge.points.slice(1, -1) : edge.points;
          const px = interior.map((p: { x: number; y: number }) => Math.round(p.x)).join(" ");
          const py = interior.map((p: { x: number; y: number }) => Math.round(p.y)).join(" ");
          const replacement =
            `      <ssd:Connection ${startElAttr}startConnector="${matched.startConnector}" ${endElAttr}endConnector="${matched.endConnector}">\n` +
            `        <ssd:ConnectionGeometry pointsX="${px}" pointsY="${py}" />\n` +
            `      </ssd:Connection>\n`;
          edits.push({
            range: {
              start: { line: startIdx, character: 0 },
              end: { line: Math.min(lines.length, endIdx + 1), character: 0 },
            },
            newText: replacement,
          });
        }
      }
    } else if (actionType === "addComponent") {
      const baseName = (action.name || action.className?.split(/[/.]/).pop() || "Component").replace(
        /[^a-zA-Z0-9_]/g,
        "_",
      );
      const existingNames = new Set(system.components.map((c) => c.name));
      let uniqueName = baseName;
      let counter = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter++}`;
      }
      const x1 = Math.round(action.x ?? 160);
      const y1 = Math.round(action.y ?? 100);
      const x2 = x1 + 180;
      const y2 = y1 + 100;
      const fmuSource =
        action.className && action.className.endsWith(".fmu") ? action.className : `resources/${uniqueName}.fmu`;
      const compSnippet =
        `      <ssd:Component name="${uniqueName}" type="application/x-fmu-sharedlibrary" source="${fmuSource}">\n` +
        `        <ssd:Connectors>\n` +
        `          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>\n` +
        `          <ssd:Connector name="y" kind="output"><ssc:Real /></ssd:Connector>\n` +
        `        </ssd:Connectors>\n` +
        `        <ssd:ElementGeometry x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />\n` +
        `      </ssd:Component>\n`;

      const closeElsIdx = findClosingTagLine("Elements");
      if (closeElsIdx >= 0) {
        edits.push({
          range: { start: { line: closeElsIdx, character: 0 }, end: { line: closeElsIdx, character: 0 } },
          newText: compSnippet,
        });
      } else {
        const closeSysIdx = findClosingTagLine("System");
        const insertIdx = closeSysIdx >= 0 ? closeSysIdx : lines.length;
        edits.push({
          range: { start: { line: insertIdx, character: 0 }, end: { line: insertIdx, character: 0 } },
          newText: `    <ssd:Elements>\n${compSnippet}    </ssd:Elements>\n`,
        });
      }
    } else if (actionType === "deleteComponents") {
      const toDelete = new Set<string>(action.names || []);
      for (const cmp of system.components) {
        if (toDelete.has(cmp.name) && cmp.line && cmp.line - 1 < lines.length) {
          const startIdx = cmp.line - 1;
          const endIdx = findComponentEndLine(startIdx);
          edits.push({
            range: {
              start: { line: startIdx, character: 0 },
              end: { line: Math.min(lines.length, endIdx + 1), character: 0 },
            },
            newText: "",
          });
        }
      }
      for (const conn of system.connections) {
        if (
          (toDelete.has(conn.startElement) || toDelete.has(conn.endElement)) &&
          conn.line &&
          conn.line - 1 < lines.length
        ) {
          const startIdx = conn.line - 1;
          let endIdx = startIdx;
          if (!/\/>\s*$/.test(lines[startIdx]!)) {
            while (endIdx < lines.length && !/<\/(?:ssd:)?Connection>/i.test(lines[endIdx]!)) {
              endIdx++;
            }
          }
          edits.push({
            range: {
              start: { line: startIdx, character: 0 },
              end: { line: Math.min(lines.length, endIdx + 1), character: 0 },
            },
            newText: "",
          });
        }
      }
    } else if (actionType === "updateName") {
      const cmp = system.components.find((c) => c.name === action.oldName);
      if (cmp?.line && cmp.line - 1 < lines.length) {
        const lIdx = cmp.line - 1;
        const lineText = lines[lIdx]!;
        const updated = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/, `name=$1${action.newName}$1`);
        if (updated !== lineText) {
          edits.push({
            range: { start: { line: lIdx, character: 0 }, end: { line: lIdx, character: lineText.length } },
            newText: updated,
          });
        }
      }
      for (const conn of system.connections) {
        if (
          (conn.startElement === action.oldName || conn.endElement === action.oldName) &&
          conn.line &&
          conn.line - 1 < lines.length
        ) {
          const cIdx = conn.line - 1;
          let lineText = lines[cIdx]!;
          if (conn.startElement === action.oldName) {
            lineText = lineText.replace(/\bstartElement\s*=\s*(["'])[^"']*\1/, `startElement=$1${action.newName}$1`);
          }
          if (conn.endElement === action.oldName) {
            lineText = lineText.replace(/\bendElement\s*=\s*(["'])[^"']*\1/, `endElement=$1${action.newName}$1`);
          }
          edits.push({
            range: { start: { line: cIdx, character: 0 }, end: { line: cIdx, character: lines[cIdx]!.length } },
            newText: lineText,
          });
        }
      }
    } else if (actionType === "updateParameter" || actionType === "updateProperty") {
      const paramName: string = (actionType === "updateProperty" ? action.key : action.parameter) ?? "";
      const paramVal = String(action.value);
      const targetName: string = action.name ?? "";

      if (paramName === "source" || paramName === "type") {
        const cmp = system.components.find((c) => c.name === targetName);
        if (cmp?.line && cmp.line - 1 < lines.length) {
          const lIdx = cmp.line - 1;
          const lineText = lines[lIdx]!;
          const attrRe = new RegExp(`\\b${paramName}\\s*=\\s*(["'])[^"']*\\1`);
          let updated: string;
          if (attrRe.test(lineText)) {
            updated = lineText.replace(attrRe, `${paramName}=$1${paramVal}$1`);
          } else {
            const trimmed = lineText.trimEnd();
            if (trimmed.endsWith("/>")) {
              updated = `${trimmed.slice(0, -2)} ${paramName}="${paramVal}"/>`;
            } else if (trimmed.endsWith(">")) {
              updated = `${trimmed.slice(0, -1)} ${paramName}="${paramVal}">`;
            } else {
              updated = lineText;
            }
          }
          if (updated !== lineText) {
            edits.push({
              range: { start: { line: lIdx, character: 0 }, end: { line: lIdx, character: lineText.length } },
              newText: updated,
            });
          }
        }
        continue;
      }

      // Check existing inline SSV parameter bindings
      let matchedParamLine: number | undefined;
      for (const binding of system.parameterBindings || []) {
        const cleanPrefix = (binding.prefix ?? "").replace(/\.$/, "");
        const prefixMatch = !cleanPrefix || cleanPrefix === targetName;
        if (!prefixMatch) continue;
        for (const p of binding.values) {
          if (p.name === paramName || p.name === `${targetName}.${paramName}`) {
            matchedParamLine = p.line;
            break;
          }
        }
      }

      if (matchedParamLine && matchedParamLine - 1 < lines.length) {
        const pStart = matchedParamLine - 1;
        for (let i = pStart; i < Math.min(lines.length, pStart + 4); i++) {
          if (/\bvalue\s*=\s*["'][^"']*["']/.test(lines[i]!)) {
            const oldLine = lines[i]!;
            const newLine = oldLine.replace(/(\bvalue\s*=\s*["'])([^"']*)(["'])/, `$1${paramVal}$3`);
            edits.push({
              range: { start: { line: i, character: 0 }, end: { line: i, character: oldLine.length } },
              newText: newLine,
            });
            break;
          }
        }
      } else {
        const closeSysIdx = findClosingTagLine("System");
        const insertIdx = closeSysIdx >= 0 ? closeSysIdx : lines.length;
        const bindingXml =
          `    <ssd:ParameterBindings>\n` +
          `      <ssd:ParameterBinding prefix="${targetName}">\n` +
          `        <ssd:ParameterValues>\n` +
          `          <ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues" version="1.0" name="Parameters">\n` +
          `            <ssv:Parameters>\n` +
          `              <ssv:Parameter name="${paramName}">\n` +
          `                <ssv:Real value="${paramVal}" />\n` +
          `              </ssv:Parameter>\n` +
          `            </ssv:Parameters>\n` +
          `          </ssv:ParameterSet>\n` +
          `        </ssd:ParameterValues>\n` +
          `      </ssd:ParameterBinding>\n` +
          `    </ssd:ParameterBindings>\n`;
        edits.push({
          range: { start: { line: insertIdx, character: 0 }, end: { line: insertIdx, character: 0 } },
          newText: bindingXml,
        });
      }
    }
  }

  return edits;
}

/**
 * Apply LSP-style line/character `SspTextEdit[]` directly to an XML string (in reverse document order).
 */
export function applySspTextEdits(xml: string, edits: SspTextEdit[]): string {
  if (edits.length === 0) return xml;
  const lineStarts: number[] = [0];
  for (let i = 0; i < xml.length; i++) {
    if (xml[i] === "\n") lineStarts.push(i + 1);
  }
  const toOffset = (pos: { line: number; character: number }): number => {
    if (pos.line >= lineStarts.length) return xml.length;
    return Math.min(xml.length, lineStarts[pos.line]! + pos.character);
  };
  const sorted = [...edits].sort((a, b) => {
    const offA = toOffset(a.range.start);
    const offB = toOffset(b.range.start);
    return offB - offA;
  });
  let out = xml;
  for (const edit of sorted) {
    const start = toOffset(edit.range.start);
    const end = toOffset(edit.range.end);
    out = out.slice(0, start) + edit.newText + out.slice(end);
  }
  return out;
}

/**
 * Default palette categories for SSP System Structure (.ssd) diagrams.
 */
export function getSspPaletteCategories() {
  return [
    {
      name: "SSP Elements",
      items: [
        { label: "FMU Component", className: "FMUComponent", description: "Functional Mock-up Unit (.fmu) component" },
        { label: "Controller FMU", className: "ControllerFMU", description: "Discrete/Continuous Controller FMU" },
        { label: "Plant FMU", className: "PlantFMU", description: "Physical Plant FMU" },
      ],
    },
  ];
}

function escapeSvgXml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRoundedOrthogonalPath(pts: { x: number; y: number }[], radius = 7): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  // Deduplicate consecutive identical points
  const clean: { x: number; y: number }[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const prev = clean[clean.length - 1]!;
    const curr = pts[i]!;
    if (Math.abs(curr.x - prev.x) > 0.5 || Math.abs(curr.y - prev.y) > 0.5) {
      clean.push(curr);
    }
  }
  if (clean.length === 1) return `M ${clean[0]!.x} ${clean[0]!.y}`;
  if (clean.length === 2) return `M ${clean[0]!.x} ${clean[0]!.y} L ${clean[1]!.x} ${clean[1]!.y}`;

  const d: string[] = [`M ${clean[0]!.x} ${clean[0]!.y}`];
  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1]!;
    const curr = clean[i]!;
    const next = clean[i + 1]!;
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2);
    const r = Math.min(radius, len1 / 2.2, len2 / 2.2);
    if (r < 1.5) {
      d.push(`L ${curr.x} ${curr.y}`);
    } else {
      const p1x = Math.round((curr.x - (dx1 / len1) * r) * 10) / 10;
      const p1y = Math.round((curr.y - (dy1 / len1) * r) * 10) / 10;
      const p2x = Math.round((curr.x + (dx2 / len2) * r) * 10) / 10;
      const p2y = Math.round((curr.y + (dy2 / len2) * r) * 10) / 10;
      d.push(`L ${p1x} ${p1y} Q ${curr.x} ${curr.y} ${p2x} ${p2y}`);
    }
  }
  const last = clean[clean.length - 1]!;
  d.push(`L ${last.x} ${last.y}`);
  return d.join(" ");
}

/**
 * Render an authentic Modelica Association SSP 1.0 / FMI 3.0 System Structure (.ssd)
 * engineering schematic SVG with directional port pins, unit badges, SSV parameter
 * compartments, orthogonal Manhattan signal lines, and solder-dot branch junctions.
 */
export function renderSspSvg(input: SspSystem | string): string {
  const system: SspSystem = typeof input === "string" ? parseSsd(input) : input;
  const W = 980;
  const H = 540;

  // Collect bound parameter values per component
  const boundParamsByComp = new Map<string, { name: string; value: string; unit?: string | undefined }[]>();
  for (const binding of system.parameterBindings || []) {
    const prefix = (binding.prefix ?? "").replace(/\.$/, "");
    for (const val of binding.values || []) {
      let targetComp = prefix;
      let paramName = val.name;
      if (!targetComp && val.name.includes(".")) {
        const dotIdx = val.name.indexOf(".");
        targetComp = val.name.slice(0, dotIdx);
        paramName = val.name.slice(dotIdx + 1);
      }
      if (!boundParamsByComp.has(targetComp)) {
        boundParamsByComp.set(targetComp, []);
      }
      boundParamsByComp.get(targetComp)!.push({
        name: paramName,
        value: String(val.value),
        unit: val.unit,
      });
    }
  }

  // Determine signal color by connector unit or type
  const resolvePortColor = (
    type: SspConnectorType,
    unit?: string,
  ): { stroke: string; badgeBg: string; markerId: string } => {
    if (type === "Boolean") return { stroke: "#ec4899", badgeBg: "#500724", markerId: "ssp-arr-pink" };
    if (type === "Integer" || type === "Enumeration")
      return { stroke: "#f97316", badgeBg: "#431407", markerId: "ssp-arr-orange" };
    const u = (unit ?? "").trim();
    if (u === "W" || u === "kW" || u === "J") {
      return { stroke: "#f59e0b", badgeBg: "#451a03", markerId: "ssp-arr-amber" };
    }
    if (u === "K" || u === "degC") {
      return { stroke: "#38bdf8", badgeBg: "#082f49", markerId: "ssp-arr-cyan" };
    }
    if (u === "N.m" || u === "rad" || u === "rpm" || u === "km/h") {
      return { stroke: "#a855f7", badgeBg: "#3b0764", markerId: "ssp-arr-purple" };
    }
    return { stroke: "#38bdf8", badgeBg: "#082f49", markerId: "ssp-arr-cyan" };
  };

  // Layout components: use explicit positive canvas coordinates when within [30..940, 50..460],
  // otherwise compute a clean topological / multi-column schematic layout.
  interface PlacedComp {
    cmp: SspComponent;
    x: number;
    y: number;
    w: number;
    h: number;
    inputs: SspConnector[];
    outputs: SspConnector[];
    params: { name: string; value: string; unit?: string | undefined }[];
    inPorts: Map<string, { x: number; y: number; conn: SspConnector }>;
    outPorts: Map<string, { x: number; y: number; conn: SspConnector }>;
  }

  const comps = system.components;
  const allHaveCanvasCoords =
    comps.length > 0 &&
    comps.every(
      (c) =>
        c.geometry &&
        Math.min(c.geometry.x1, c.geometry.x2) >= 30 &&
        Math.max(c.geometry.x1, c.geometry.x2) <= 955 &&
        Math.min(c.geometry.y1, c.geometry.y2) >= 50 &&
        Math.max(c.geometry.y1, c.geometry.y2) <= 465 &&
        Math.abs(c.geometry.x2 - c.geometry.x1) >= 160,
    );

  const placedMap = new Map<string, PlacedComp>();

  // Check if topological columns are needed
  const assignLayout = (): { x: number; y: number; w: number; h: number }[] => {
    if (allHaveCanvasCoords) {
      return comps.map((c) => {
        const g = c.geometry!;
        return {
          x: Math.round(Math.min(g.x1, g.x2)),
          y: Math.round(Math.min(g.y1, g.y2)),
          w: Math.round(Math.abs(g.x2 - g.x1)),
          h: Math.round(Math.abs(g.y2 - g.y1)),
        };
      });
    }

    // Specialize 4-component thermal/plant layout or general columnar layout
    if (comps.length === 4) {
      return [
        { x: 76, y: 76, w: 236, h: 148 },
        { x: 76, y: 268, w: 236, h: 148 },
        { x: 396, y: 152, w: 252, h: 190 },
        { x: 716, y: 152, w: 224, h: 166 },
      ];
    }

    const cols = Math.min(3, Math.max(1, comps.length));
    const colW = 240;
    const gapX = Math.max(54, Math.floor((860 - cols * colW) / Math.max(1, cols - 1)));
    return comps.map((_, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      return {
        x: 76 + col * (colW + gapX),
        y: 84 + row * 184,
        w: colW,
        h: 154,
      };
    });
  };

  const boxes = assignLayout();

  comps.forEach((cmp, idx) => {
    const box = boxes[idx]!;
    const inputs = cmp.connectors.filter((c) => c.kind === "input");
    const outputs = cmp.connectors.filter((c) => c.kind === "output" || c.kind === "inout");
    const paramConns = cmp.connectors.filter((c) => c.kind === "parameter" || c.kind === "calculatedParameter");
    const boundList = [...(boundParamsByComp.get(cmp.name) ?? [])];
    for (const pc of paramConns) {
      if (!boundList.some((b) => b.name === pc.name)) {
        boundList.push({ name: pc.name, value: "default", unit: pc.unit });
      }
    }

    const headerH = 44;
    const paramH = boundList.length > 0 ? 46 : 26;
    const portZoneTop = box.y + headerH;
    const portZoneH = Math.max(48, box.h - headerH - paramH);

    const inPorts = new Map<string, { x: number; y: number; conn: SspConnector }>();
    inputs.forEach((conn, i) => {
      const py = Math.round(portZoneTop + ((i + 1) * portZoneH) / (inputs.length + 1));
      inPorts.set(conn.name, { x: box.x, y: py, conn });
    });

    const outPorts = new Map<string, { x: number; y: number; conn: SspConnector }>();
    outputs.forEach((conn, i) => {
      const py = Math.round(portZoneTop + ((i + 1) * portZoneH) / (outputs.length + 1));
      outPorts.set(conn.name, { x: box.x + box.w, y: py, conn });
    });

    placedMap.set(cmp.name, {
      cmp,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      inputs,
      outputs,
      params: boundList,
      inPorts,
      outPorts,
    });
  });

  // Render connections and track branch junctions
  const connSvgParts: string[] = [];
  const labelSvgParts: string[] = [];
  const junctionPoints = new Map<string, { x: number; y: number; color: string }>();
  const startPortUsageCount = new Map<string, number>();

  for (const conn of system.connections) {
    const key = `${conn.startElement}.${conn.startConnector}`;
    startPortUsageCount.set(key, (startPortUsageCount.get(key) ?? 0) + 1);
  }

  let feedbackLaneIdx = 0;
  let forwardLaneIdx = 0;

  system.connections.forEach((conn) => {
    const srcComp = placedMap.get(conn.startElement);
    const tgtComp = placedMap.get(conn.endElement);
    const srcPort = srcComp?.outPorts.get(conn.startConnector) ?? srcComp?.inPorts.get(conn.startConnector);
    const tgtPort = tgtComp?.inPorts.get(conn.endConnector) ?? tgtComp?.outPorts.get(conn.endConnector);
    if (!srcPort || !tgtPort || !srcComp || !tgtComp) return;

    const unit = srcPort.conn.unit ?? tgtPort.conn.unit;
    const style = resolvePortColor(srcPort.conn.type, unit);

    let waypoints: { x: number; y: number }[] = [];
    const hasValidExplicitPoints =
      conn.points &&
      conn.points.length >= 1 &&
      conn.points.every((p) => p.x >= 20 && p.x <= 960 && p.y >= 40 && p.y <= 490);

    if (hasValidExplicitPoints) {
      waypoints = [{ x: srcPort.x, y: srcPort.y }, ...conn.points!, { x: tgtPort.x, y: tgtPort.y }];
    } else if (tgtPort.x > srcPort.x + 24) {
      // Forward left-to-right orthogonal connection
      if (Math.abs(srcPort.y - tgtPort.y) <= 2) {
        waypoints = [
          { x: srcPort.x, y: srcPort.y },
          { x: tgtPort.x, y: tgtPort.y },
        ];
      } else {
        const midX = Math.round((srcPort.x + tgtPort.x) / 2) + ((forwardLaneIdx++ % 2) * 8 - 4);
        waypoints = [
          { x: srcPort.x, y: srcPort.y },
          { x: midX, y: srcPort.y },
          { x: midX, y: tgtPort.y },
          { x: tgtPort.x, y: tgtPort.y },
        ];
      }
    } else {
      // Feedback loop connection (right-to-left): route cleanly along bottom return bus
      const busY = 448 + feedbackLaneIdx * 14;
      const rightStubX = Math.min(948, srcPort.x + 30);
      const leftBusX = Math.max(36, tgtPort.x - 34);
      waypoints = [
        { x: srcPort.x, y: srcPort.y },
        { x: rightStubX, y: srcPort.y },
        { x: rightStubX, y: busY },
        { x: leftBusX, y: busY },
        { x: leftBusX, y: tgtPort.y },
        { x: tgtPort.x, y: tgtPort.y },
      ];
    }

    const startKey = `${conn.startElement}.${conn.startConnector}`;
    if ((startPortUsageCount.get(startKey) ?? 0) > 1 && waypoints.length >= 4) {
      // Record branch junction point where the shared return trunk splits
      const branchPt = waypoints[waypoints.length - 2]!;
      const jKey = `${startKey}@${branchPt.x}`;
      if (!junctionPoints.has(jKey)) {
        junctionPoints.set(jKey, { x: branchPt.x, y: branchPt.y, color: style.stroke });
      }
    }

    const pathD = buildRoundedOrthogonalPath(waypoints, 7);
    // Subtle outer glow for signal trace
    connSvgParts.push(
      `<path d="${pathD}" fill="none" stroke="${style.stroke}" stroke-width="5" stroke-opacity="0.14" stroke-linecap="round" stroke-linejoin="round" />`,
    );
    connSvgParts.push(
      `<path d="${pathD}" fill="none" stroke="${style.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${style.markerId})" />`,
    );

    // Signal label pill along the primary segment
    const labelUnit = unit ? ` [${unit}]` : "";
    const shortSignal = conn.startConnector.replace(/_[WK]$/, "");
    const labelText = `${shortSignal}${labelUnit}`;
    let lx = 0;
    let ly = 0;
    if (waypoints.length === 2) {
      lx = Math.round((waypoints[0]!.x + waypoints[1]!.x) / 2);
      ly = waypoints[0]!.y - 12;
    } else if (waypoints.length >= 5) {
      // Feedback bus label on horizontal bottom segment
      const p2 = waypoints[2]!;
      const p3 = waypoints[3]!;
      lx = Math.round((p2.x + p3.x) / 2);
      ly = p2.y - 11;
      // Avoid duplicate feedback bus labels for branched signals
      if (feedbackLaneIdx > 0) {
        lx = waypoints[waypoints.length - 2]!.x + 18;
        ly = tgtPort.y - 11;
      }
      feedbackLaneIdx++;
    } else {
      const p1 = waypoints[1]!;
      const p2 = waypoints[2]!;
      lx = p1.x;
      ly = Math.round((p1.y + p2.y) / 2);
    }

    const pillW = Math.max(66, labelText.length * 6.1 + 14);
    labelSvgParts.push(
      `<g transform="translate(${lx}, ${ly})">` +
        `<rect x="${-Math.round(pillW / 2)}" y="-9" width="${Math.round(pillW)}" height="17" rx="4" fill="#09101d" fill-opacity="0.92" stroke="${style.stroke}" stroke-width="1" stroke-opacity="0.55" />` +
        `<text x="0" y="3" text-anchor="middle" fill="#e2e8f0" font-size="9.5" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeSvgXml(labelText)}</text>` +
        `</g>`,
    );
  });

  // Render solder-dot branch junctions
  const junctionSvgParts: string[] = [];
  for (const j of junctionPoints.values()) {
    junctionSvgParts.push(
      `<circle cx="${j.x}" cy="${j.y}" r="7" fill="${j.color}" fill-opacity="0.22" />` +
        `<circle cx="${j.x}" cy="${j.y}" r="4.2" fill="${j.color}" stroke="#0b111e" stroke-width="1.5" />`,
    );
  }

  // Render FMU Component blocks
  const compSvgParts: string[] = [];
  for (const placed of placedMap.values()) {
    const { cmp, x, y, w, h, params, inPorts, outPorts } = placed;
    const shortFmu = cmp.source.split("/").pop() || cmp.source || `${cmp.name}.fmu`;
    const headerH = 44;
    const paramH = params.length > 0 ? 46 : 26;
    const paramTop = y + h - paramH;

    const portRenderings: string[] = [];
    for (const p of inPorts.values()) {
      const style = resolvePortColor(p.conn.type, p.conn.unit);
      const unitBadge = p.conn.unit ? ` [${p.conn.unit}]` : "";
      portRenderings.push(
        `<g transform="translate(${p.x}, ${p.y})">` +
          `<polygon points="-6,-5.5 5,0 -6,5.5" fill="${style.stroke}" stroke="#0b111e" stroke-width="1.3" />` +
          `<text x="10" y="3.5" fill="#cbd5e1" font-size="10" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeSvgXml(p.conn.name)}<tspan fill="${style.stroke}" font-weight="700">${escapeSvgXml(unitBadge)}</tspan></text>` +
          `</g>`,
      );
    }

    for (const p of outPorts.values()) {
      const style = resolvePortColor(p.conn.type, p.conn.unit);
      const unitBadge = p.conn.unit ? ` [${p.conn.unit}]` : "";
      portRenderings.push(
        `<g transform="translate(${p.x}, ${p.y})">` +
          `<polygon points="-4,-5.5 7,0 -4,5.5" fill="#0b111e" stroke="${style.stroke}" stroke-width="1.8" />` +
          `<text x="-9" y="3.5" text-anchor="end" fill="#cbd5e1" font-size="10" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeSvgXml(p.conn.name)}<tspan fill="${style.stroke}" font-weight="700">${escapeSvgXml(unitBadge)}</tspan></text>` +
          `</g>`,
      );
    }

    // Format up to 2 lines of bound SSV parameters
    const paramLines: string[] = [];
    if (params.length > 0) {
      const formatted = params.map((p) => `${p.name}=${p.value}${p.unit ? ` ${p.unit}` : ""}`);
      if (formatted.length <= 2) {
        paramLines.push(formatted.join(" · "));
      } else {
        paramLines.push(formatted.slice(0, 2).join(" · "));
        paramLines.push(formatted.slice(2, 4).join(" · "));
      }
    } else {
      paramLines.push(`mime: ${cmp.type || "application/x-fmu-sharedlibrary"}`);
    }

    compSvgParts.push(
      `<g class="ssp-fmu-node" data-fmu="${escapeSvgXml(cmp.name)}">` +
        // Drop shadow + main body
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#111a2e" stroke="#10b981" stroke-width="1.8" filter="url(#ssp-shadow)" />` +
        // Header band
        `<path d="M ${x + 8} ${y} L ${x + w - 8} ${y} Q ${x + w} ${y} ${x + w} ${y + 8} L ${x + w} ${y + headerH} L ${x} ${y + headerH} L ${x} ${y + 8} Q ${x} ${y} ${x + 8} ${y} Z" fill="url(#ssp-fmu-hdr)" />` +
        `<line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="#10b981" stroke-opacity="0.45" stroke-width="1" />` +
        // Stereotype + FMU resource pill
        `<text x="${x + 10}" y="${y + 15}" fill="#34d399" font-size="9" font-weight="700" letter-spacing="0.4" font-family="'Inter', system-ui, sans-serif">«FMU 3.0 CS»</text>` +
        `<rect x="${x + w - Math.min(w - 86, shortFmu.length * 5.4 + 12) - 8}" y="${y + 5}" width="${Math.min(w - 86, Math.round(shortFmu.length * 5.4 + 12))}" height="14" rx="3" fill="#064e3b" fill-opacity="0.75" stroke="#10b981" stroke-opacity="0.4" stroke-width="0.8" />` +
        `<text x="${x + w - 13}" y="${y + 14.5}" text-anchor="end" fill="#a7f3d0" font-size="8.5" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeSvgXml(shortFmu)}</text>` +
        // Component instance name
        `<text x="${x + 10}" y="${y + 34}" fill="#f8fafc" font-size="13" font-weight="700" font-family="'Inter', system-ui, sans-serif">${escapeSvgXml(cmp.name)}</text>` +
        // Parameter compartment (.ssv)
        `<line x1="${x}" y1="${paramTop}" x2="${x + w}" y2="${paramTop}" stroke="#1e293b" stroke-width="1" />` +
        `<path d="M ${x} ${paramTop} L ${x + w} ${paramTop} L ${x + w} ${y + h - 8} Q ${x + w} ${y + h} ${x + w - 8} ${y + h} L ${x + 8} ${y + h} Q ${x} ${y + h} ${x} ${y + h - 8} Z" fill="#0b1324" fill-opacity="0.85" />` +
        `<text x="${x + 10}" y="${paramTop + 13}" fill="#64748b" font-size="8" font-weight="700" letter-spacing="0.5" font-family="'Inter', system-ui, sans-serif">SSV PARAMETERS</text>` +
        paramLines
          .map(
            (line, lIdx) =>
              `<text x="${x + 10}" y="${paramTop + 26 + lIdx * 12}" fill="#94a3b8" font-size="9" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeSvgXml(line)}</text>`,
          )
          .join("") +
        portRenderings.join("") +
        `</g>`,
    );
  }

  const startTime = system.defaultExperiment?.startTime ?? 0.0;
  const stopTime = system.defaultExperiment?.stopTime ?? 600.0;
  const stepSize = system.defaultExperiment?.stepSize ?? 0.002;
  const stepMs = (stepSize * 1000).toFixed(1);
  const algo = system.defaultExperiment?.algorithm ?? "Fixed-Step Gauss-Seidel";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">`,
    `  <defs>`,
    `    <pattern id="ssp-grid" width="24" height="24" patternUnits="userSpaceOnUse">`,
    `      <circle cx="12" cy="12" r="0.9" fill="#1e293b" />`,
    `    </pattern>`,
    `    <linearGradient id="ssp-fmu-hdr" x1="0" y1="0" x2="1" y2="1">`,
    `      <stop offset="0%" stop-color="#064e3b" stop-opacity="0.72" />`,
    `      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92" />`,
    `    </linearGradient>`,
    `    <filter id="ssp-shadow" x="-6%" y="-6%" width="112%" height="116%">`,
    `      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#020617" flood-opacity="0.55" />`,
    `    </filter>`,
    `    <marker id="ssp-arr-amber" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#f59e0b" />`,
    `    </marker>`,
    `    <marker id="ssp-arr-cyan" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#38bdf8" />`,
    `    </marker>`,
    `    <marker id="ssp-arr-pink" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#ec4899" />`,
    `    </marker>`,
    `    <marker id="ssp-arr-orange" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#f97316" />`,
    `    </marker>`,
    `    <marker id="ssp-arr-purple" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#a855f7" />`,
    `    </marker>`,
    `  </defs>`,
    `  <!-- Background Canvas -->`,
    `  <rect width="${W}" height="${H}" rx="10" fill="#0b111e" />`,
    `  <rect width="${W}" height="${H}" rx="10" fill="url(#ssp-grid)" />`,
    `  <!-- Outer <ssd:System> Frame -->`,
    `  <rect x="14" y="12" width="${W - 28}" height="${H - 24}" rx="9" fill="none" stroke="#1e293b" stroke-width="1.6" />`,
    `  <!-- SSP 1.0 Pentagon Header Tab -->`,
    `  <path d="M 14 12 L 456 12 L 456 32 L 442 44 L 14 44 Z" fill="#111c33" stroke="#1e293b" stroke-width="1.4" />`,
    `  <text x="26" y="32" fill="#e2e8f0" font-size="11.5" font-weight="700" font-family="'Inter', system-ui, sans-serif">`,
    `    <tspan fill="#10b981">ssd</tspan> <tspan fill="#94a3b8" font-weight="500">[System]</tspan> ${escapeSvgXml(system.name)} <tspan fill="#64748b" font-size="10" font-weight="500">(SSP ${escapeSvgXml(system.version || "1.0")} · FMI 3.0 CS)</tspan>`,
    `  </text>`,
    `  <!-- Signal Legend & Solver Badges -->`,
    `  <g transform="translate(530, 18)">`,
    `    <rect x="0" y="0" width="132" height="22" rx="5" fill="#111827" stroke="#f59e0b" stroke-opacity="0.45" stroke-width="1" />`,
    `    <line x1="10" y1="11" x2="26" y2="11" stroke="#f59e0b" stroke-width="2.2" />`,
    `    <polygon points="26,7.5 32,11 26,14.5" fill="#f59e0b" />`,
    `    <text x="38" y="14.5" fill="#fde68a" font-size="9.5" font-weight="600" font-family="'Inter', system-ui, sans-serif">Heat Flow [W]</text>`,
    `    <rect x="142" y="0" width="142" height="22" rx="5" fill="#111827" stroke="#38bdf8" stroke-opacity="0.45" stroke-width="1" />`,
    `    <line x1="152" y1="11" x2="168" y2="11" stroke="#38bdf8" stroke-width="2.2" />`,
    `    <polygon points="168,7.5 174,11 168,14.5" fill="#38bdf8" />`,
    `    <text x="180" y="14.5" fill="#bae6fd" font-size="9.5" font-weight="600" font-family="'Inter', system-ui, sans-serif">Coolant Temp [K]</text>`,
    `    <rect x="294" y="0" width="130" height="22" rx="5" fill="#064e3b" fill-opacity="0.55" stroke="#10b981" stroke-opacity="0.5" stroke-width="1" />`,
    `    <text x="359" y="14.5" text-anchor="middle" fill="#a7f3d0" font-size="9.5" font-weight="700" font-family="'JetBrains Mono', ui-monospace, monospace">Δt = ${escapeSvgXml(stepMs)} ms CS</text>`,
    `  </g>`,
    `  <!-- Orthogonal Signal Routing -->`,
    `  <g class="ssp-connections">`,
    ...connSvgParts.map((p) => `    ${p}`),
    ...junctionSvgParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <!-- FMU 3.0 Components -->`,
    `  <g class="ssp-components">`,
    ...compSvgParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <!-- Signal Labels -->`,
    `  <g class="ssp-labels">`,
    ...labelSvgParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <!-- Co-Simulation Master & DefaultExperiment Footer Bar -->`,
    `  <g transform="translate(26, ${H - 44})">`,
    `    <rect x="0" y="0" width="${W - 52}" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1" />`,
    `    <circle cx="14" cy="12" r="3.5" fill="#10b981" />`,
    `    <text x="24" y="15.5" fill="#94a3b8" font-size="9.5" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">`,
    `      <tspan fill="#10b981" font-weight="700">MASTER:</tspan> ${escapeSvgXml(algo)}  ·  <tspan fill="#cbd5e1">DefaultExperiment:</tspan> t = ${startTime.toFixed(1)}s → ${stopTime.toFixed(1)}s (Δt = ${escapeSvgXml(stepMs)} ms)  ·  <tspan fill="#38bdf8">${comps.length} FMUs</tspan> · <tspan fill="#f59e0b">${system.connections.length} Causal Signals</tspan>`,
    `    </text>`,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}
