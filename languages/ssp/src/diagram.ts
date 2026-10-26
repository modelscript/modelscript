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
export function buildSspDiagramData(input: SspSystem | string): any {
  const system: SspSystem = typeof input === "string" ? parseSsd(input) : input;
  const nodes: any[] = [];
  const edges: any[] = [];

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
  const boundParamsByComp = new Map<string, Map<string, string | number | boolean>>();
  for (const binding of system.parameterBindings || []) {
    const prefix = binding.prefix ?? "";
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
      boundParamsByComp.get(targetComp)!.set(paramName, val.value);
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

    const portItems: any[] = [];
    inputs.forEach((conn, i) => {
      const py = conn.geometry
        ? Math.round(conn.geometry.y * height)
        : Math.round(((i + 1) * height) / (inputs.length + 1));
      const color = CONNECTOR_TYPE_COLORS[conn.type] ?? "#3b82f6";
      portItems.push({
        id: conn.name,
        group: "in",
        args: { x: 0, y: py, angle: 180 },
        attrs: {
          text: { text: conn.name, fill: "#cbd5e1", fontSize: 10 },
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
      const color = CONNECTOR_TYPE_COLORS[conn.type] ?? "#3b82f6";
      portItems.push({
        id: conn.name,
        group: "out",
        args: { x: width, y: py, angle: 0 },
        attrs: {
          text: { text: conn.name, fill: "#cbd5e1", fontSize: 10 },
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
      const boundVal = compBoundParams.get(p.name) ?? boundParamsByComp.get("")?.get(`${cmp.name}.${p.name}`);
      paramEntries.push({
        name: p.name,
        value: boundVal !== undefined ? String(boundVal) : "",
        unit: p.unit,
        group: "Parameters",
      });
    }
    for (const [k, v] of compBoundParams.entries()) {
      if (!params.some((p) => p.name === k)) {
        paramEntries.push({
          name: k,
          value: String(v),
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

/**
 * Apply a batch of interactive diagram edit actions to a `SystemStructure.ssd` XML document.
 */
export function applySspDiagramEdits(xml: string, actions: any[], parsedSystem?: SspSystem): SspTextEdit[] {
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
            item.x,
            item.y,
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
          upsertComponentGeometry(cmp, item.x, item.y, item.width, item.height, item.rotation);
        }
      }
    } else if (actionType === "connect") {
      const src =
        action.sourcePort !== undefined
          ? { element: action.sourceComponent || "", connector: action.sourcePort }
          : parseEndpointRef(action.source);
      const tgt =
        action.targetPort !== undefined
          ? { element: action.targetComponent || "", connector: action.targetPort }
          : parseEndpointRef(action.target);
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
      const matched = findMatchingConnection(action.source, action.target);
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
      const paramName: string = actionType === "updateProperty" ? action.key : action.parameter;
      const paramVal = String(action.value);
      const targetName: string = action.name;

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
        const prefixMatch = !binding.prefix || binding.prefix === targetName;
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
