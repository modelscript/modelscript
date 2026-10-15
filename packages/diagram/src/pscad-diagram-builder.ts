// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD Schematic & Single-Line Diagram (SLD) Builder.
 *
 * Translates PSCAD project models into AntV X6 diagram graphs,
 * standalone headless SVGs, and visual git diff graphs.
 */

import { busbarGlyph, generatorGlyph, inverterIbrGlyph, transformerGlyph } from "./glyphs.js";

export interface PscadComponentLike {
  id: string;
  definitionName: string;
  instanceName?: string | undefined;
  position: { x: number; y: number };
  width?: number | undefined;
  height?: number | undefined;
  parameters: Record<string, string | number>;
  ports?:
    | {
        id: string;
        name: string;
        kind?: string | undefined;
        position?: { x: number; y: number } | undefined;
      }[]
    | undefined;
}

export interface PscadBusLike {
  id: string;
  name: string;
  voltageBaseKv?: number | undefined;
  position: { x: number; y: number };
  length?: number | undefined;
}

export interface PscadWireLike {
  id: string;
  vertices: { x: number; y: number }[];
  connectedPortIds?: string[] | undefined;
}

export interface PscadStickyLike {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
}

export interface PscadProjectLike {
  name: string;
  projectType?: "case" | "library" | undefined;
  rootModule: {
    buses: PscadBusLike[];
    components: PscadComponentLike[];
    wires: PscadWireLike[];
    stickies?: PscadStickyLike[] | undefined;
  };
}

export interface X6CellData {
  id: string;
  shape: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  markup?: any[];
  attrs?: Record<string, any>;
  ports?: any;
  source?: any;
  target?: any;
  vertices?: { x: number; y: number }[];
  data?: Record<string, any>;
  diffStatus?: "added" | "removed" | "modified" | "unchanged";
}

export interface PscadDiagramGraph {
  cells: X6CellData[];
  metadata: {
    projectName: string;
    nodeCount: number;
    edgeCount: number;
  };
}

/**
 * Builds an AntV X6-compatible diagram graph from a PSCAD project.
 */
export function buildPscadDiagram(project: PscadProjectLike): PscadDiagramGraph {
  const cells: X6CellData[] = [];
  const mod = project.rootModule;

  // 1. Convert Buses to Busbar Nodes
  for (const bus of mod.buses) {
    const width = bus.length ?? 80;
    const height = 14;
    const vbase = bus.voltageBaseKv ?? 230;

    cells.push({
      id: bus.id,
      shape: "rect",
      x: bus.position.x,
      y: bus.position.y,
      width,
      height,
      markup: busbarGlyph({ length: width, voltageBaseKv: vbase }),
      data: {
        kind: "bus",
        name: bus.name,
        vbase,
      },
    });
  }

  // 2. Convert Components to Power Glyph or Modular IC Nodes
  for (const cmp of mod.components) {
    // If library project, ignore dummy Drawing Station Main at 0, 0
    if (
      project.projectType === "library" &&
      cmp.definitionName.endsWith(":Main") &&
      cmp.position.x === 0 &&
      cmp.position.y === 0
    ) {
      continue;
    }

    const defn = cmp.definitionName.toLowerCase();
    let markup = undefined;
    let width = cmp.width && cmp.width > 60 ? cmp.width : 110;
    let height = cmp.height && cmp.height > 40 ? cmp.height : 60;

    if (defn.includes("xfmr") || defn.includes("transformer")) {
      markup = transformerGlyph();
      width = 72;
      height = 60;
    } else if (defn.includes("gen") || defn.includes("source")) {
      markup = generatorGlyph();
      width = 60;
      height = 60;
    } else if (defn.includes("fmu") || defn.includes("inverter") || defn.includes("ibr")) {
      markup = inverterIbrGlyph();
      width = 60;
      height = 60;
    }

    const cleanName = (cmp.instanceName || cmp.id).includes(":")
      ? (cmp.instanceName || cmp.id).split(":").pop()!
      : cmp.instanceName || cmp.id;

    const cleanDefn = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;

    // Build ports if present
    const portGroups: Record<string, any> = {
      left: {
        position: "left",
        attrs: {
          circle: { r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 1.5, magnet: true },
        },
        label: { position: { name: "left", args: { x: -6 } } },
      },
      right: {
        position: "right",
        attrs: {
          circle: { r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 1.5, magnet: true },
        },
        label: { position: { name: "right", args: { x: 6 } } },
      },
      top: {
        position: "top",
        attrs: {
          circle: { r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 1.5, magnet: true },
        },
        label: { position: { name: "top", args: { y: -6 } } },
      },
      bottom: {
        position: "bottom",
        attrs: {
          circle: { r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 1.5, magnet: true },
        },
        label: { position: { name: "bottom", args: { y: 6 } } },
      },
    };

    const portItems: any[] = [];
    if (cmp.ports && cmp.ports.length > 0) {
      const seenPortIds = new Set<string>();
      for (const p of cmp.ports) {
        let group = "left";
        if (p.position) {
          if (p.position.x > 10) group = "right";
          else if (p.position.x < -10) group = "left";
          else if (p.position.y < -10) group = "top";
          else if (p.position.y > 10) group = "bottom";
        } else if (p.name.toLowerCase().includes("out") || p.name.toLowerCase().includes("term")) {
          group = "right";
        }

        let portId = p.id || `${cmp.id}_${p.name}`;
        if (seenPortIds.has(portId)) {
          let counter = 2;
          while (seenPortIds.has(`${portId}_${counter}`)) {
            counter++;
          }
          portId = `${portId}_${counter}`;
        }
        seenPortIds.add(portId);

        portItems.push({
          id: portId,
          group,
          attrs: {
            text: {
              text: p.name,
              fill: "#94a3b8",
              fontSize: 9,
            },
          },
        });
      }
    }

    cells.push({
      id: cmp.id,
      shape: "rect",
      x: cmp.position.x,
      y: cmp.position.y,
      width,
      height,
      markup: markup ?? [
        { tagName: "rect", selector: "body" },
        { tagName: "rect", selector: "headerBg" },
        { tagName: "text", selector: "typeBadge" },
        { tagName: "text", selector: "label" },
      ],
      attrs: markup
        ? undefined
        : {
            body: {
              fill: "#1e293b",
              stroke: "#38bdf8",
              strokeWidth: 1.5,
              rx: 6,
              ry: 6,
            },
            headerBg: {
              refWidth: 1,
              height: 18,
              fill: "#0f172a",
              rx: 6,
              ry: 6,
            },
            typeBadge: {
              text: `«${cleanDefn}»`,
              fill: "#38bdf8",
              fontSize: 8,
              fontStyle: "italic",
              refX: 0.5,
              refY: 4,
              textAnchor: "middle",
            },
            label: {
              text: cleanName,
              fill: "#f8fafc",
              fontSize: 11,
              fontWeight: "bold",
              refX: 0.5,
              refY: 26,
              textAnchor: "middle",
            },
          },
      ports: portItems.length > 0 ? { groups: portGroups, items: portItems } : undefined,
      data: {
        kind: "component",
        definition: cmp.definitionName,
        name: cmp.instanceName,
        parameters: cmp.parameters,
      },
    });
  }

  // 3. Convert Wires to Edges
  for (const wire of mod.wires) {
    if (wire.vertices.length >= 2) {
      cells.push({
        id: wire.id,
        shape: "edge",
        source: { x: wire.vertices[0]!.x, y: wire.vertices[0]!.y },
        target: {
          x: wire.vertices[wire.vertices.length - 1]!.x,
          y: wire.vertices[wire.vertices.length - 1]!.y,
        },
        vertices: wire.vertices.slice(1, -1),
        attrs: {
          line: {
            stroke: "#81d4fa",
            strokeWidth: 2,
            targetMarker: null,
          },
        },
        data: {
          kind: "wire",
          connectedPorts: wire.connectedPortIds ?? [],
        },
      });
    }
  }

  // 4. Convert Sticky Notes to Card Nodes
  if (mod.stickies) {
    for (const sticky of mod.stickies) {
      const isBanner = sticky.width > 400;
      const isTitle = sticky.height <= 40;
      cells.push({
        id: sticky.id,
        shape: "rect",
        x: sticky.position.x,
        y: sticky.position.y,
        width: sticky.width,
        height: sticky.height,
        attrs: {
          body: {
            fill: isBanner ? "#fffbeb" : isTitle ? "#fef3c7" : "#fffdf0",
            stroke: isBanner ? "#f59e0b" : isTitle ? "#d97706" : "#cbd5e1",
            strokeWidth: isBanner ? 1.5 : 1,
            rx: isBanner ? 6 : 4,
            ry: isBanner ? 6 : 4,
          },
          label: {
            text: sticky.text,
            fill: "#1e293b",
            fontSize: isTitle ? 13 : isBanner ? 12 : 11,
            fontWeight: isTitle ? "bold" : "normal",
            textAnchor: isTitle ? "middle" : "start",
            textVerticalAnchor: isTitle ? "middle" : "top",
            refX: isTitle ? 0.5 : 10,
            refY: isTitle ? 0.5 : 10,
          },
        },
        data: {
          kind: "sticky",
          text: sticky.text,
        },
      });
    }
  }

  return {
    cells,
    metadata: {
      projectName: project.name,
      nodeCount: mod.buses.length + mod.components.length + (mod.stickies?.length ?? 0),
      edgeCount: mod.wires.length,
    },
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generates standalone SVG markup for headless export and CI/CD rendering.
 */
export function renderPscadSvg(project: PscadProjectLike): string {
  const diag = buildPscadDiagram(project);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of diag.cells) {
    if (c.x !== undefined && c.y !== undefined) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      const w = c.width ?? 60;
      const h = c.height ?? 60;
      if (c.x + w > maxX) maxX = c.x + w;
      if (c.y + h > maxY) maxY = c.y + h;
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const padding = 50;
  const vbX = minX - padding;
  const vbY = minY - padding;
  const vbW = maxX - minX + 2 * padding;
  const vbH = maxY - minY + 2 * padding;

  let elementsSvg = "";

  // Render edges (wires) first
  for (const c of diag.cells) {
    if (c.shape === "edge" && c.source && c.target) {
      let pathData = `M ${c.source.x} ${c.source.y}`;
      if (c.vertices) {
        for (const v of c.vertices) {
          pathData += ` L ${v.x} ${v.y}`;
        }
      }
      pathData += ` L ${c.target.x} ${c.target.y}`;
      elementsSvg += `  <path d="${pathData}" fill="none" stroke="#81d4fa" stroke-width="2" stroke-linecap="round" />\n`;
    }
  }

  // Render nodes (components & buses & stickies)
  for (const c of diag.cells) {
    if (c.x !== undefined && c.y !== undefined) {
      const w = c.width ?? 60;
      const h = c.height ?? 60;

      if (c.data?.kind === "bus") {
        const vbase = c.data.vbase ?? 230;
        const color = vbase >= 200 ? "#ff5252" : vbase >= 69 ? "#ffab40" : "#40c4ff";
        elementsSvg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
        elementsSvg += `    <rect width="${w}" height="${h}" rx="2" fill="${color}" />\n`;
        elementsSvg += `    <text x="${w / 2}" y="-4" fill="${color}" font-size="10" font-weight="bold" font-family="monospace" text-anchor="middle">${c.data.name} (${vbase} kV)</text>\n`;
        elementsSvg += `  </g>\n`;
      } else if (c.data?.kind === "sticky") {
        const lines = (c.data.text || "").split("\n");
        const isBanner = w > 400;
        const fill = isBanner ? "#fffbeb" : "#fef3c7";
        const stroke = isBanner ? "#f59e0b" : "#d97706";
        elementsSvg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
        elementsSvg += `    <rect width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1" />\n`;
        let textY = 18;
        for (const line of lines.slice(0, 12)) {
          elementsSvg += `    <text x="12" y="${textY}" fill="#1e293b" font-size="11" font-family="sans-serif">${escapeHtml(line)}</text>\n`;
          textY += 15;
        }
        elementsSvg += `  </g>\n`;
      } else {
        const rawName = c.data?.name || c.id;
        const name = rawName.includes(":") ? rawName.split(":").pop()! : rawName;
        const defn = c.data?.definition || "Component";
        elementsSvg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
        elementsSvg += `    <rect width="${w}" height="${h}" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />\n`;
        elementsSvg += `    <text x="${w / 2}" y="${h / 2 - 4}" fill="#f8fafc" font-size="10" font-weight="bold" font-family="sans-serif" text-anchor="middle">${name}</text>\n`;
        elementsSvg += `    <text x="${w / 2}" y="${h / 2 + 10}" fill="#94a3b8" font-size="8" font-family="sans-serif" text-anchor="middle">${defn}</text>\n`;
        elementsSvg += `  </g>\n`;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}" style="background-color: #0f172a;">
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="#334155" />
    </pattern>
  </defs>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="url(#grid)" />
${elementsSvg}
</svg>`;
}

/**
 * Computes a semantic and visual diff between two PSCAD projects.
 */
export function diffPscadProjects(
  oldProj: PscadProjectLike,
  newProj: PscadProjectLike,
): {
  addedComponents: PscadComponentLike[];
  removedComponents: PscadComponentLike[];
  modifiedComponents: {
    id: string;
    name: string;
    changedParams: { param: string; oldValue: any; newValue: any }[];
  }[];
  diffSummary: string;
} {
  const oldCompMap = new Map<string, PscadComponentLike>(oldProj.rootModule.components.map((c) => [c.id, c]));
  const newCompMap = new Map<string, PscadComponentLike>(newProj.rootModule.components.map((c) => [c.id, c]));

  const addedComponents: PscadComponentLike[] = [];
  const removedComponents: PscadComponentLike[] = [];
  const modifiedComponents: {
    id: string;
    name: string;
    changedParams: { param: string; oldValue: any; newValue: any }[];
  }[] = [];

  for (const [id, newC] of newCompMap) {
    if (!oldCompMap.has(id)) {
      addedComponents.push(newC);
    } else {
      const oldC = oldCompMap.get(id)!;
      const changedParams: { param: string; oldValue: any; newValue: any }[] = [];

      for (const [key, newVal] of Object.entries(newC.parameters)) {
        const oldVal = oldC.parameters[key];
        if (oldVal !== newVal) {
          changedParams.push({ param: key, oldValue: oldVal, newValue: newVal });
        }
      }

      if (changedParams.length > 0) {
        modifiedComponents.push({
          id,
          name: newC.instanceName || id,
          changedParams,
        });
      }
    }
  }

  for (const [id, oldC] of oldCompMap) {
    if (!newCompMap.has(id)) {
      removedComponents.push(oldC);
    }
  }

  const diffSummary =
    `PSCAD Semantic Diff:\n` +
    `  Added: ${addedComponents.length} components (${addedComponents.map((c) => c.instanceName || c.id).join(", ") || "none"})\n` +
    `  Removed: ${removedComponents.length} components (${removedComponents.map((c) => c.instanceName || c.id).join(", ") || "none"})\n` +
    `  Modified: ${modifiedComponents.length} components (${modifiedComponents.map((c) => `${c.name} [${c.changedParams.map((p) => p.param).join(", ")}]`).join(", ") || "none"})`;

  return {
    addedComponents,
    removedComponents,
    modifiedComponents,
    diffSummary,
  };
}
