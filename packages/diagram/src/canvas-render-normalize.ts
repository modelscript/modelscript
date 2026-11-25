// SPDX-License-Identifier: AGPL-3.0-or-later

import * as antvLayout from "@antv/layout";

import { getDefaultConnectorForGraph } from "./canvas-state.js";
import type {
  DagreLayoutConstructor,
  DagreLayoutResultNode,
  Graph,
  RenderDiagramInput,
  RenderEdgeData,
  RenderNodeData,
} from "./canvas-types.js";
import { adaptColorForDarkMode, adaptX6Markup } from "./color-inversion.js";
import type { ReactiveAnimationBinding } from "./protocol.js";
import { applySequenceLayout } from "./sequence-layout.js";
import { applySwimlaneLayout } from "./swimlane-layout.js";
import { applyTsmOrthogonalLayout } from "./tsm-layout.js";

const antvLayoutModule = antvLayout as unknown as {
  DagreLayout?: DagreLayoutConstructor | undefined;
};

const DagreLayout: DagreLayoutConstructor =
  antvLayoutModule.DagreLayout || (class {} as unknown as DagreLayoutConstructor);

/**
 * Normalizes incoming `RenderDiagramInput` nodes and edges for theme adaptation,
 * synthesizes coordinate-system background/axes nodes, executes layout phases
 * (Sequence, Swimlane, TSM orthogonal, or 3-phase hierarchical Dagre), and
 * extracts parent-child embedding relations.
 */
export function prepareDiagramRenderModel(
  g: Graph,
  data: RenderDiagramInput,
  isDark: boolean,
): {
  nodes: RenderNodeData[];
  edges: RenderEdgeData[];
  relations: Map<string, string>;
} {
  const nodes: RenderNodeData[] = [];
  const edges: RenderEdgeData[] = [];

  for (const node of data.nodes) {
    let normalizedPorts = node.ports;
    if (Array.isArray(node.ports)) {
      const portStroke = isDark ? "#38bdf8" : "#0284c7";
      const portFill = isDark ? "#0f172a" : "#ffffff";
      normalizedPorts = {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: portStroke, fill: portFill, strokeWidth: 1.5 },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: portStroke, fill: portFill, strokeWidth: 1.5 },
            },
          },
        },
        items: (node.ports as { id?: string; name?: string; direction?: string }[]).map((p, idx) => ({
          id: p.id || p.name || `port_${idx}`,
          group: p.direction === "in" || p.id === "in" ? "in" : "out",
        })),
      };
    }

    const effectiveMarkup =
      isDark && node.markup ? adaptX6Markup(node.markup, { isDark, targetBg: "#121212" }) : node.markup;
    const portsObj =
      isDark && normalizedPorts && typeof normalizedPorts === "object"
        ? (normalizedPorts as { items?: unknown[] })
        : undefined;
    const effectivePorts =
      portsObj && Array.isArray(portsObj.items)
        ? {
            ...portsObj,
            items: portsObj.items.map((item) => {
              if (!item || typeof item !== "object") return item;
              const portItem = item as Record<string, unknown>;
              if (!portItem["markup"]) return item;
              return {
                ...portItem,
                markup: adaptX6Markup(portItem["markup"], { isDark, targetBg: "#121212" }),
              };
            }),
          }
        : normalizedPorts;

    const nodeData: RenderNodeData = {
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 180,
      height: node.height ?? 70,
      angle: node.angle,
      zIndex: node.zIndex,
      opacity: node.opacity,
      markup: effectiveMarkup,
      ports: effectivePorts,
      data: {
        properties: node.properties,
        animations: node.animations as ReactiveAnimationBinding[] | undefined,
        interactive: node.interactive,
        ...((node as { portal?: unknown }).portal ? { portal: (node as { portal?: unknown }).portal } : {}),
        ...((node as { widget?: unknown }).widget ? { widget: (node as { widget?: unknown }).widget } : {}),
        ...(node.data || {}),
      },
      autoLayout: node.autoLayout,
    };
    // Forward polyglot X6 attrs and shape (selector-based rendering)
    if (node.attrs) {
      const attrsCopy = { ...(node.attrs as Record<string, Record<string, unknown>>) };
      const rawNodeLabel = (node as { label?: string }).label;
      if (rawNodeLabel && (!attrsCopy["label"] || attrsCopy["label"]["text"] === undefined)) {
        attrsCopy["label"] = { ...(attrsCopy["label"] || {}), text: rawNodeLabel };
      }
      if (!isDark) {
        const bodyFill = attrsCopy["body"]?.["fill"];
        if (bodyFill === "#1e1e1e" || bodyFill === "#1e293b" || bodyFill === "#0f172a") {
          attrsCopy["body"] = { ...attrsCopy["body"], fill: "#ffffff" };
        }
        const labelFill = attrsCopy["label"]?.["fill"];
        if (labelFill === "#e0e0e0" || labelFill === "#f8fafc" || labelFill === "#f1f5f9") {
          attrsCopy["label"] = { ...attrsCopy["label"], fill: "#0f172a" };
        }
        const subFill = attrsCopy["subtitle"]?.["fill"];
        if (subFill === "#94a3b8" || subFill === "#cbd5e1") {
          attrsCopy["subtitle"] = { ...attrsCopy["subtitle"], fill: "#475569" };
        }
        for (const [selKey, selVal] of Object.entries(attrsCopy)) {
          if (selKey.startsWith("entry_") && selVal && typeof selVal === "object") {
            const ef = selVal["fill"];
            if (ef === "#cbd5e1" || ef === "#e2e8f0" || ef === "#f8fafc") {
              attrsCopy[selKey] = { ...selVal, fill: "#334155" };
            }
          }
        }
      } else {
        for (const [selKey, selVal] of Object.entries(attrsCopy)) {
          if (selVal && typeof selVal === "object") {
            const valObj = { ...(selVal as Record<string, unknown>) };
            const isTextSel =
              selKey === "label" ||
              selKey === "subtitle" ||
              selKey === "sublabel" ||
              selKey === "header" ||
              selKey === "stereotype" ||
              selKey.includes("text");
            if (typeof valObj["fill"] === "string" && valObj["fill"] !== "none" && valObj["fill"] !== "transparent") {
              valObj["fill"] = adaptColorForDarkMode(
                valObj["fill"],
                { isDark: true, targetBg: "#121212" },
                isTextSel ? "text" : "fill",
              );
            }
            if (
              typeof valObj["stroke"] === "string" &&
              valObj["stroke"] !== "none" &&
              valObj["stroke"] !== "transparent"
            ) {
              valObj["stroke"] = adaptColorForDarkMode(
                valObj["stroke"],
                { isDark: true, targetBg: "#121212" },
                "stroke",
              );
            }
            attrsCopy[selKey] = valObj;
          }
        }
      }
      nodeData.attrs = attrsCopy;
    } else if (!node.markup) {
      const rawLabel =
        (node as { label?: string; name?: string }).label ||
        (node as { name?: string }).name ||
        node.properties?.name ||
        node.id;
      const rawKind = (node as { kind?: string }).kind || node.properties?.className || "component";
      const lines = String(rawLabel).split(/\r?\n/);
      const titleText = lines[0] || node.id;
      const subText = lines.slice(1).join(" ");
      const strokeColor = isDark ? "#38bdf8" : "#0284c7";
      const bodyFill = isDark ? "#1e293b" : "#f8fafc";
      const titleFill = isDark ? "#f1f5f9" : "#0f172a";
      const subFill = isDark ? "#94a3b8" : "#475569";

      nodeData.markup = [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "stereotype" },
        { tagName: "text", selector: "label" },
        ...(subText ? [{ tagName: "text", selector: "subtitle" }] : []),
      ];
      nodeData.attrs = {
        body: {
          fill: bodyFill,
          stroke: strokeColor,
          strokeWidth: 1.5,
          rx: 6,
          ry: 6,
          refWidth: "100%",
          refHeight: "100%",
        },
        stereotype: {
          text: `«${String(rawKind).toLowerCase()}»`,
          fill: strokeColor,
          fontSize: 10,
          fontStyle: "italic",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: 6,
        },
        label: {
          text: titleText,
          fill: titleFill,
          fontSize: 12,
          fontWeight: "bold",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: subText ? 22 : 26,
        },
        ...(subText
          ? {
              subtitle: {
                text: subText,
                fill: subFill,
                fontSize: 10,
                textAnchor: "middle",
                textVerticalAnchor: "top",
                refX: 0.5,
                refY: 42,
              },
            }
          : {}),
      };
    }
    if (node.shape) nodeData.shape = node.shape;
    if (node.parent) nodeData.parent = node.parent;
    nodes.push(nodeData);
  }

  for (const edge of data.edges) {
    const rawEdge = edge as {
      sourcePort?: string | undefined;
      targetPort?: string | undefined;
      style?: Record<string, unknown> | undefined;
    };
    const resolvedSource =
      typeof edge.source === "string" && rawEdge.sourcePort
        ? { cell: edge.source, port: rawEdge.sourcePort }
        : edge.source;
    const resolvedTarget =
      typeof edge.target === "string" && rawEdge.targetPort
        ? { cell: edge.target, port: rawEdge.targetPort }
        : edge.target;

    const edgeData: RenderEdgeData = {
      id: edge.id,
      shape: edge.shape ?? "edge",
      zIndex: edge.zIndex,
      source: resolvedSource,
      target: resolvedTarget,
      vertices: edge.vertices,
      connector: edge.connector ?? getDefaultConnectorForGraph(g) ?? { name: "rounded", args: { radius: 8 } },
      router: edge.router ?? (edge.connector === "smooth" ? { name: "normal" } : { name: "port-orthogonal-astar" }),
    };
    // Polyglot edges pass attrs as a full selector-keyed object;
    // Modelica edges have attrs.line specifically
    const edgeAttrs = edge.attrs as
      { line?: Record<string, unknown> | undefined; [key: string]: Record<string, unknown> | undefined } | undefined;
    if (edgeAttrs?.line) {
      const lineCopy = { ...edgeAttrs.line };
      if (isDark) {
        if (
          typeof lineCopy["stroke"] === "string" &&
          lineCopy["stroke"] !== "none" &&
          lineCopy["stroke"] !== "transparent"
        ) {
          lineCopy["stroke"] = adaptColorForDarkMode(
            lineCopy["stroke"],
            { isDark: true, targetBg: "#121212" },
            "stroke",
          );
        }
        if (typeof lineCopy["strokeWidth"] === "number" && lineCopy["strokeWidth"] < 1.5) {
          lineCopy["strokeWidth"] = 1.75;
        }
        const sm = lineCopy["sourceMarker"] as Record<string, unknown> | undefined;
        if (sm && typeof sm === "object") {
          const smCopy = { ...sm };
          if (typeof smCopy["fill"] === "string" && smCopy["fill"] !== "none") {
            smCopy["fill"] = adaptColorForDarkMode(smCopy["fill"], { isDark: true, targetBg: "#121212" }, "fill");
          }
          if (typeof smCopy["stroke"] === "string" && smCopy["stroke"] !== "none") {
            smCopy["stroke"] = adaptColorForDarkMode(smCopy["stroke"], { isDark: true, targetBg: "#121212" }, "stroke");
          }
          lineCopy["sourceMarker"] = smCopy;
        }
        const tm = lineCopy["targetMarker"] as Record<string, unknown> | undefined;
        if (tm && typeof tm === "object") {
          const tmCopy = { ...tm };
          if (typeof tmCopy["fill"] === "string" && tmCopy["fill"] !== "none") {
            tmCopy["fill"] = adaptColorForDarkMode(tmCopy["fill"], { isDark: true, targetBg: "#121212" }, "fill");
          }
          if (typeof tmCopy["stroke"] === "string" && tmCopy["stroke"] !== "none") {
            tmCopy["stroke"] = adaptColorForDarkMode(tmCopy["stroke"], { isDark: true, targetBg: "#121212" }, "stroke");
          }
          lineCopy["targetMarker"] = tmCopy;
        }
      } else {
        const tm = lineCopy["targetMarker"] as Record<string, unknown> | undefined;
        if (tm && typeof tm === "object" && tm["fill"] === "#1e1e1e") {
          lineCopy["targetMarker"] = { ...tm, fill: "#ffffff" };
        }
      }
      edgeData.attrs = { "z-index": "-10", line: lineCopy };
    } else if (edgeAttrs) {
      if (isDark) {
        const adaptedEdgeAttrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(edgeAttrs)) {
          if (v && typeof v === "object") {
            const vObj = { ...(v as Record<string, unknown>) };
            if (typeof vObj["stroke"] === "string" && vObj["stroke"] !== "none") {
              vObj["stroke"] = adaptColorForDarkMode(vObj["stroke"], { isDark: true, targetBg: "#121212" }, "stroke");
            }
            if (typeof vObj["fill"] === "string" && vObj["fill"] !== "none") {
              vObj["fill"] = adaptColorForDarkMode(vObj["fill"], { isDark: true, targetBg: "#121212" }, "fill");
            }
            adaptedEdgeAttrs[k] = vObj;
          } else {
            adaptedEdgeAttrs[k] = v;
          }
        }
        edgeData.attrs = adaptedEdgeAttrs as RenderEdgeData["attrs"];
      } else {
        edgeData.attrs = edgeAttrs;
      }
    } else {
      edgeData.attrs = {
        line: {
          stroke: isDark ? "#64748b" : "#475569",
          strokeWidth: 1.5,
          targetMarker: {
            name: "block",
            width: 8,
            height: 6,
          },
        },
      };
    }
    // Forward labels (polyglot edge stereotypes like «connect», «satisfy», or PSS/E branch labels)
    if (edge.labels) {
      edgeData.labels = (edge.labels as RenderEdgeData["labels"])?.map((lbl) => {
        if (!lbl || typeof lbl !== "object" || !lbl.attrs) return lbl;
        const rectAttr = lbl.attrs.rect as Record<string, unknown> | undefined;
        const textAttr = lbl.attrs.text as Record<string, unknown> | undefined;
        const rectFill = rectAttr?.["fill"];
        if (rectFill === "#1e1e1e" || rectFill === "#1e293b" || rectFill === "#0f172a") {
          const textFill = typeof textAttr?.["fill"] === "string" ? textAttr["fill"] : undefined;
          const adaptedTextFill: string = isDark
            ? textFill === "#999"
              ? "#cbd5e1"
              : (textFill ?? "#cbd5e1")
            : textFill === "#c084fc"
              ? "#7e22ce"
              : "#334155";
          return {
            ...lbl,
            attrs: {
              ...lbl.attrs,
              text: {
                ...(textAttr || {}),
                fill: adaptedTextFill,
                fontFamily: (textAttr?.["fontFamily"] as string | undefined) ?? "Inter, system-ui, sans-serif",
              },
              rect: {
                ...(rectAttr || {}),
                fill: isDark ? "#0f172a" : "#f8fafc",
                stroke: isDark ? "#334155" : "#cbd5e1",
                strokeWidth: 1,
                rx: 4,
                ry: 4,
              },
            },
          };
        }
        return lbl;
      });
    } else if ((edge as { label?: string }).label) {
      const rawEdgeLabel = (edge as { label?: string }).label!;
      edgeData.labels = [
        {
          attrs: {
            text: {
              text: rawEdgeLabel,
              fill: isDark ? "#cbd5e1" : "#334155",
              fontSize: 10,
              fontFamily: "Inter, system-ui, sans-serif",
            },
            rect: {
              fill: isDark ? "#0f172a" : "#f8fafc",
              stroke: isDark ? "#334155" : "#cbd5e1",
              strokeWidth: 1,
              rx: 4,
              ry: 4,
            },
          },
          position: 0.5,
        },
      ];
    }
    if (edge.data || rawEdge.style) {
      edgeData.data = { ...(rawEdge.style || {}), ...(edge.data || {}) };
    }
    edges.push(edgeData);
  }

  // Add diagram background if present
  if (data.coordinateSystem) {
    const cs = data.coordinateSystem;
    const showBounds = cs.boundsStyle?.visible !== false;
    const boundsStroke = cs.boundsStyle?.stroke ?? (isDark ? "rgba(255, 255, 255, 0.10)" : "rgba(15, 23, 42, 0.10)");
    const boundsDash = cs.boundsStyle?.strokeDasharray
      ? ` stroke-dasharray: ${cs.boundsStyle.strokeDasharray};`
      : " stroke-dasharray: 4 4;";
    const boundsWidth = cs.boundsStyle?.strokeWidth ?? 1;
    const boundsFill = cs.boundsStyle?.fill ?? "transparent";

    const children: unknown[] = [];
    if (showBounds) {
      children.push({
        tagName: "rect",
        attrs: {
          style: `fill: ${boundsFill}; stroke: ${boundsStroke}; stroke-width: ${boundsWidth}px;${boundsDash} vector-effect: non-scaling-stroke; pointer-events: none;`,
          width: cs.width,
          height: cs.height,
        },
      });

      if (cs.boundsStyle?.headerText) {
        const headerText = cs.boundsStyle.headerText;
        const badgeW = Math.min(cs.width, Math.max(80, headerText.length * 7 + 16));
        children.push(
          {
            tagName: "rect",
            attrs: {
              x: "0",
              y: "0",
              width: String(badgeW),
              height: "20",
              fill: isDark ? "#1e293b" : "#f1f5f9",
              stroke: boundsStroke,
              "stroke-width": "1",
            },
          },
          {
            tagName: "text",
            textContent: headerText,
            attrs: {
              x: "8",
              y: "14",
              fill: isDark ? "#94a3b8" : "#475569",
              "font-size": "10.5",
              "font-family": "Inter, system-ui, sans-serif",
              "font-weight": "600",
            },
          },
        );
      }
    }
    if (data.diagramBackground) {
      children.push(
        isDark ? adaptX6Markup(data.diagramBackground, { isDark, targetBg: "#121212" }) : data.diagramBackground,
      );
    }
    nodes.push({
      id: "__diagram_background__",
      x: cs.x,
      y: cs.y,
      width: cs.width,
      height: cs.height,
      zIndex: -1,
      markup: {
        tagName: "svg",
        children,
        attrs: {
          preserveAspectRatio: "none",
          width: cs.width,
          height: cs.height,
          pointerEvents: "none",
          style: "overflow: visible; pointer-events: none;",
        },
      },
    });
  }

  // Add axes node
  if (data.coordinateSystem) {
    const cs = data.coordinateSystem;
    const showAxes = cs.axesStyle?.visible !== false;
    if (showAxes) {
      const defaultAxisStroke = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(15, 23, 42, 0.07)";
      const axisStroke = cs.axesStyle?.stroke ?? defaultAxisStroke;
      const axisWidth = String(cs.axesStyle?.strokeWidth ?? 1);
      const axisDash = cs.axesStyle?.strokeDasharray;
      const boundsOnly = cs.axesStyle?.boundsOnly === true;
      const ox = cs.axesStyle?.origin?.[0] ?? 0;
      const oy = cs.axesStyle?.origin?.[1] ?? 0;

      const minX = boundsOnly ? cs.x : -100000;
      const maxX = boundsOnly ? cs.x + cs.width : 100000;
      const minY = boundsOnly ? cs.y : -100000;
      const maxY = boundsOnly ? cs.y + cs.height : 100000;

      const lineAttrsX: Record<string, string> = {
        x1: String(minX),
        y1: String(oy),
        x2: String(maxX),
        y2: String(oy),
        stroke: axisStroke,
        "stroke-width": axisWidth,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "none",
      };
      if (axisDash) {
        lineAttrsX["stroke-dasharray"] = axisDash;
      }

      const lineAttrsY: Record<string, string> = {
        x1: String(ox),
        y1: String(minY),
        x2: String(ox),
        y2: String(maxY),
        stroke: axisStroke,
        "stroke-width": axisWidth,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "none",
      };
      if (axisDash) {
        lineAttrsY["stroke-dasharray"] = axisDash;
      }

      const axisChildren: unknown[] = [
        {
          tagName: "line",
          attrs: lineAttrsX,
        },
        {
          tagName: "line",
          attrs: lineAttrsY,
        },
      ];

      if (cs.axesStyle?.xLabel) {
        axisChildren.push({
          tagName: "text",
          textContent: cs.axesStyle.xLabel,
          attrs: {
            x: String(maxX - 4),
            y: String(oy - 6),
            "text-anchor": "end",
            fill: axisStroke,
            "font-size": "10",
            "font-family": "Inter, system-ui, sans-serif",
          },
        });
      }

      if (cs.axesStyle?.yLabel) {
        axisChildren.push({
          tagName: "text",
          textContent: cs.axesStyle.yLabel,
          attrs: {
            x: String(ox + 6),
            y: String(minY + 12),
            "text-anchor": "start",
            fill: axisStroke,
            "font-size": "10",
            "font-family": "Inter, system-ui, sans-serif",
          },
        });
      }

      nodes.push({
        id: "__diagram_axes__",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        zIndex: -2,
        markup: {
          tagName: "g",
          attrs: {
            pointerEvents: "none",
            style: "pointer-events: none;",
          },
          children: axisChildren,
        },
      });
    }
  }

  // ── Layout Dispatch ──
  if (data.diagramType === "Sequence") {
    applySequenceLayout(nodes, edges, isDark);
  } else if (data.partitions && data.partitions.length > 0) {
    applySwimlaneLayout({ nodes, edges }, data.partitions, { isDark });
  } else if (data.layout === "tsm-orthogonal" || data.layout === "orthogonal") {
    const tsmResult = applyTsmOrthogonalLayout({ nodes, edges });
    const posMap = new Map(tsmResult.nodes.map((n) => [n.id, n]));
    for (const node of nodes) {
      const pos = posMap.get(node.id);
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        node.x = pos.x;
        node.y = pos.y;
      }
    }
    const edgeVertMap = new Map(tsmResult.edges.map((e) => [e.id, e]));
    for (const edge of edges) {
      const e = edgeVertMap.get(edge.id);
      if (e?.vertices) {
        edge.vertices = e.vertices;
      }
    }
  } else {
    // ── Hierarchical 3-Phase Dagre Layout ──
    //   Phase 1: Sub-Dagre for each container to compute actual child bounding boxes
    //   Phase 2: Top-level Dagre with expanded container sizes
    //   Phase 3: Reposition children relative to final parent positions
    const parentChildMap = new Map<string, RenderNodeData[]>();
    for (const node of nodes) {
      if (node.parent) {
        const list = parentChildMap.get(node.parent) ?? [];
        list.push(node);
        parentChildMap.set(node.parent, list);
      }
    }

    const childRelativePositions = new Map<string, { dx: number; dy: number }>();

    for (const [parentId, childNodes] of parentChildMap) {
      const parentNode = nodes.find((n) => n.id === parentId);
      if (!parentNode) continue;

      const PAD = { top: 48, left: 24, right: 24, bottom: 24 };
      const childIds = new Set(childNodes.map((c) => c.id));

      const subDagre = new DagreLayout({
        type: "dagre",
        rankdir: "TB",
        align: "UL",
        ranksep: 40,
        nodesep: 40,
        begin: [0, 0],
        controlPoints: true,
      });

      const subEdges = edges
        .filter((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.cell;
          const t = typeof e.target === "string" ? e.target : e.target.cell;
          return childIds.has(s) && childIds.has(t);
        })
        .map((e) => ({
          source: typeof e.source === "string" ? e.source : e.source.cell,
          target: typeof e.target === "string" ? e.target : e.target.cell,
        }));

      // Inject fake edges to wrap isolated nodes into 2 rows for a compact layout
      const connectedSub = new Set<string>();
      subEdges.forEach((e) => {
        connectedSub.add(e.source);
        connectedSub.add(e.target);
      });
      const isolatedSub = childNodes.filter((n) => !connectedSub.has(n.id)).map((n) => n.id);
      if (isolatedSub.length > 2) {
        const cols = Math.ceil(Math.sqrt(isolatedSub.length));
        for (let i = 0; i < isolatedSub.length - cols; i++) {
          subEdges.push({ source: isolatedSub[i]!, target: isolatedSub[i + cols]! });
        }
      }

      const subModel = {
        nodes: childNodes.map((c) => ({
          id: c.id,
          width: c.width,
          height: c.height,
          size: [c.width || 220, c.height || 50],
        })),
        edges: subEdges,
      };

      const subResult = subDagre.layout(subModel);

      let minX = Infinity;
      let minY = Infinity;
      const layoutCoords = new Map<string, { leftX: number; topY: number }>();

      subResult.nodes?.forEach((laid: DagreLayoutResultNode) => {
        const childNode = childNodes.find((c) => c.id === laid.id);
        if (childNode) {
          const leftX = laid.x - childNode.width / 2;
          const topY = laid.y - childNode.height / 2;
          minX = Math.min(minX, leftX);
          minY = Math.min(minY, topY);
          layoutCoords.set(childNode.id, { leftX, topY });
        }
      });

      let maxRight = 0;
      let maxBottom = 0;

      for (const childNode of childNodes) {
        const coords = layoutCoords.get(childNode.id);
        if (coords) {
          const dx = PAD.left + (coords.leftX - minX);
          const dy = PAD.top + (coords.topY - minY);
          childRelativePositions.set(childNode.id, { dx, dy });
          maxRight = Math.max(maxRight, dx + childNode.width + PAD.right);
          maxBottom = Math.max(maxBottom, dy + childNode.height + PAD.bottom);
        }
      }

      const tabAttr = parentNode.attrs?.["tab"] as { width?: number | undefined } | undefined;
      const minParentWidth = tabAttr?.width ? Math.round(tabAttr.width + 30) : 220;
      parentNode.width = Math.max(maxRight, minParentWidth);
      parentNode.height = Math.max(maxBottom, 80);
    }

    // ── Phase 2: Top-level Dagre layout with expanded container sizes ──
    const nodesToLayout: string[] = [];
    nodes.forEach((node: RenderNodeData) => {
      if (node.autoLayout && !node.parent) {
        nodesToLayout.push(node.id ?? "");
      }
    });

    if (nodesToLayout.length > 0) {
      const isUpwardHierarchyEdge = (e: RenderEdgeData): boolean => {
        const edgeType = e.data?.["type"];
        return (
          edgeType === "subClassOf" ||
          edgeType === "inferredSubClassOf" ||
          edgeType === "classAssertion" ||
          edgeType === "domain" ||
          edgeType === "specialization"
        );
      };
      const isHorizontalPeerEdge = (e: RenderEdgeData): boolean => {
        if (e.data?.["isHorizontalPeer"] === true) return true;
        const edgeType = e.data?.["type"];
        return (
          edgeType === "disjointWith" ||
          edgeType === "equivalentTo" ||
          edgeType === "inverseOf" ||
          edgeType === "objectPropertyAssertion" ||
          edgeType === "sameAs" ||
          edgeType === "differentFrom"
        );
      };
      const hasHierarchyEdges = edges.some(isUpwardHierarchyEdge);

      const dagreLayout = new DagreLayout({
        type: "dagre",
        rankdir: "TB",
        ...(hasHierarchyEdges ? {} : { align: "UL" }),
        ranksep: hasHierarchyEdges ? 92 : 60,
        nodesep: hasHierarchyEdges ? 56 : 60,
        begin: [20, 20],
        controlPoints: true,
      });

      const modelEdges = edges
        .filter((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.cell;
          const t = typeof e.target === "string" ? e.target : e.target.cell;
          if (!nodesToLayout.includes(s) || !nodesToLayout.includes(t)) return false;
          if (hasHierarchyEdges && isHorizontalPeerEdge(e)) return false;
          return true;
        })
        .map((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.cell;
          const t = typeof e.target === "string" ? e.target : e.target.cell;
          if (isUpwardHierarchyEdge(e)) {
            return { source: t, target: s };
          }
          return { source: s, target: t };
        });

      const connectedTop = new Set<string>();
      edges.forEach((e) => {
        const s = typeof e.source === "string" ? e.source : e.source.cell;
        const t = typeof e.target === "string" ? e.target : e.target.cell;
        connectedTop.add(s);
        connectedTop.add(t);
      });
      const isolatedTop = nodes
        .filter((n) => nodesToLayout.includes(n.id ?? ""))
        .filter((n) => !connectedTop.has(n.id ?? ""))
        .map((n) => n.id ?? "");
      if (isolatedTop.length > 2) {
        const cols = Math.ceil(Math.sqrt(isolatedTop.length));
        for (let i = 0; i < isolatedTop.length - cols; i++) {
          modelEdges.push({ source: isolatedTop[i]!, target: isolatedTop[i + cols]! });
        }
      }

      const model = {
        nodes: nodes
          .filter((n) => nodesToLayout.includes(n.id ?? ""))
          .map((n) => ({
            ...n,
            size: [n.width || 220, n.height || 100],
          })),
        edges: modelEdges,
      };

      const newModel = dagreLayout.layout(model);

      newModel.nodes?.forEach((n: DagreLayoutResultNode) => {
        const node = nodes.find((no: RenderNodeData) => no.id === n.id);
        if (node) {
          node.x = n.x - (node.width ?? 0) / 2;
          node.y = n.y - (node.height ?? 0) / 2;
        }
      });
    }

    // ── Phase 3: Reposition children relative to final parent positions ──
    for (const [parentId, childNodes] of parentChildMap) {
      const parentNode = nodes.find((n) => n.id === parentId);
      if (!parentNode) continue;

      for (const child of childNodes) {
        const rel = childRelativePositions.get(child.id);
        if (rel) {
          child.x = parentNode.x + rel.dx;
          child.y = parentNode.y + rel.dy;
        }
      }
    }
  }

  // Stash parent-child relationships and clean JSON before X6 fromJSON/diff
  const relations = new Map<string, string>();
  for (const n of nodes) {
    if (n.parent) {
      relations.set(n.id, n.parent);
      delete n.parent;
    }
    if (n.children) {
      delete n.children;
    }
  }

  return { nodes, edges, relations };
}
