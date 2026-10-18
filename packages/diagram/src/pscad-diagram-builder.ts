// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD Schematic & Single-Line Diagram (SLD) Builder.
 *
 * Translates PSCAD project models into AntV X6 diagram graphs,
 * standalone headless SVGs, and visual git diff graphs.
 */

import {
  breakerGlyph,
  busbarGlyph,
  converterBridgeGlyph,
  csmfBlockGlyph,
  faultGlyph,
  generatorGlyph,
  inverterIbrGlyph,
  meterProbeGlyph,
  surgeArresterGlyph,
  transformerGlyph,
  transmissionLineGlyph,
  wirelessNetLabelGlyph,
} from "./glyphs.js";

export interface PscadComponentLike {
  id: string;
  definitionName: string;
  instanceName?: string | undefined;
  position: { x: number; y: number };
  width?: number | undefined;
  height?: number | undefined;
  rotation?: number | undefined;
  mirror?: boolean | undefined;
  parameters: Record<string, string | number>;
  sourceRange?: { startByte: number; endByte: number } | undefined;
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
  sourceRange?: { startByte: number; endByte: number } | undefined;
}

export interface PscadWireLike {
  id: string;
  vertices: { x: number; y: number }[];
  connectedPortIds?: string[] | undefined;
  startPortId?: string | undefined;
  endPortId?: string | undefined;
  sourceRange?: { startByte: number; endByte: number } | undefined;
}

export interface PscadStickyLike {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
}

export interface PscadModuleLike {
  name?: string | undefined;
  buses: PscadBusLike[];
  components: PscadComponentLike[];
  wires: PscadWireLike[];
  stickies?: PscadStickyLike[] | undefined;
  junctions?: { x: number; y: number }[] | undefined;
  wirelessNets?: Record<string, string[]> | undefined;
}

export interface PscadProjectLike {
  name: string;
  projectType?: "case" | "library" | undefined;
  rootModule: PscadModuleLike;
  subModules?: Map<string, PscadModuleLike> | undefined;
}

export interface X6CellData {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  markup?: any[] | undefined;
  attrs?: Record<string, any> | undefined;
  ports?: any;
  properties?: Record<string, any> | undefined;
  source?: any;
  target?: any;
  vertices?: { x: number; y: number }[] | undefined;
  data?: Record<string, any> | undefined;
  diffStatus?: "added" | "removed" | "modified" | "unchanged" | undefined;
}

export interface PscadDiagramGraph {
  cells: X6CellData[];
  metadata: {
    projectName: string;
    moduleName?: string | undefined;
    nodeCount: number;
    edgeCount: number;
  };
}

/**
 * Builds an AntV X6-compatible diagram graph from a PSCAD project (or a specific sub-module).
 */
export function buildPscadDiagram(project: PscadProjectLike, moduleName?: string): PscadDiagramGraph {
  const cells: X6CellData[] = [];
  const mod =
    (moduleName && project.subModules?.get(moduleName)) ||
    (moduleName && moduleName.includes(":") ? project.subModules?.get(moduleName.split(":").pop()!) : undefined) ||
    project.rootModule;

  // Map portId or busId -> { cell: nodeId, port: portId, world: { x, y } }
  const portAnchorMap = new Map<string, { cell: string; port: string; world: { x: number; y: number } }>();

  // 1. Convert Buses to Busbar Nodes
  for (const bus of mod.buses) {
    const width = bus.length ?? 80;
    const height = 14;
    const vbase = bus.voltageBaseKv ?? 230;
    const busPortId = `${bus.id}_bus`;
    const color = vbase >= 200 ? "#ff5252" : vbase >= 69 ? "#ffab40" : "#40c4ff";

    portAnchorMap.set(bus.id, {
      cell: bus.id,
      port: busPortId,
      world: { x: bus.position.x, y: bus.position.y },
    });

    const busProps = {
      name: bus.name,
      className: "Bus",
      description: `${bus.name} (${vbase} kV)`,
      sourceRange: bus.sourceRange,
    };

    cells.push({
      id: bus.id,
      shape: "rect",
      x: bus.position.x,
      y: bus.position.y,
      width,
      height,
      markup: busbarGlyph({ length: width, voltageBaseKv: vbase, label: bus.name }),
      attrs: {
        busbar: { fill: color, width },
        busLabel: { text: `${bus.name} (${vbase} kV)`, fill: color },
        label: { text: `${bus.name} (${vbase} kV)` },
      },
      ports: {
        groups: {
          bus: {
            position: { name: "absolute", args: { x: 0, y: 3 } },
            attrs: {
              circle: { r: 3.5, fill: color, stroke: "#0f172a", strokeWidth: 1, magnet: true },
            },
          },
        },
        items: [{ id: busPortId, group: "bus" }],
      },
      properties: busProps,
      data: {
        kind: "bus",
        name: bus.name,
        vbase,
        centerPosition: { x: bus.position.x, y: bus.position.y },
        properties: busProps,
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
    const cleanName = (cmp.instanceName || cmp.id).includes(":")
      ? (cmp.instanceName || cmp.id).split(":").pop()!
      : cmp.instanceName || cmp.id;
    const cleanDefn = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;

    // Build concise instance + rating label for apparatus glyphs
    const mvaRating = cmp.parameters["MVA"] ?? cmp.parameters["mva"] ?? cmp.parameters["rated_mva"];
    const vRating = cmp.parameters["V"] ?? cmp.parameters["Vref"] ?? cmp.parameters["v"];
    const displayLabel =
      mvaRating !== undefined
        ? `${cleanName} (${mvaRating} MVA)`
        : vRating !== undefined && (defn.includes("source") || defn.includes("arrester") || defn.includes("mov"))
          ? `${cleanName} (${vRating} kV)`
          : cleanName;

    let markup = undefined;
    let width = cmp.width && cmp.width > 60 ? cmp.width : 110;
    let height = cmp.height && cmp.height > 40 ? cmp.height : 60;

    if (defn.includes("xfmr") || defn.includes("transformer")) {
      markup = transformerGlyph({ label: displayLabel });
      width = 72;
      height = 60;
    } else if (
      defn.includes("gen") ||
      defn.includes("source") ||
      defn.includes("sync_machine") ||
      defn.includes("ind_machine") ||
      defn.includes("dfig")
    ) {
      markup = generatorGlyph({ label: displayLabel });
      width = 60;
      height = 60;
    } else if (defn.includes("fmu") || defn.includes("inverter") || defn.includes("ibr")) {
      markup = inverterIbrGlyph({ label: displayLabel });
      width = 60;
      height = 60;
    } else if (defn.includes("breaker") || defn.includes("switch")) {
      const statusStr = String(cmp.parameters["Status"] ?? cmp.parameters["status"] ?? "closed").toLowerCase();
      markup = breakerGlyph({ isOpen: statusStr === "open" || statusStr === "0", label: displayLabel });
      width = 48;
      height = 44;
    } else if (defn.includes("arrester") || defn.includes("mov")) {
      markup = surgeArresterGlyph({ label: displayLabel });
      width = 40;
      height = 54;
    } else if (defn.includes("tpflt") || defn.includes("fault")) {
      markup = faultGlyph({ label: displayLabel });
      width = 40;
      height = 44;
    } else if (defn.includes("vsc_pwm") || defn.includes("lcc_6pulse") || defn.includes("mmc")) {
      const badge = defn.includes("mmc") ? "MMC" : defn.includes("lcc") ? "LCC" : "VSC";
      markup = converterBridgeGlyph({ badge, label: displayLabel });
      width = 72;
      height = 60;
    } else if (defn.includes("tline") || defn.includes("cable")) {
      markup = transmissionLineGlyph({ isCable: defn.includes("cable"), label: displayLabel });
      width = 80;
      height = 48;
    } else if (defn.includes("pi_ctlr") || defn === "pi" || defn.endsWith(":pi")) {
      markup = csmfBlockGlyph({ kind: "pi", label: cleanName });
      width = 64;
      height = 42;
    } else if (defn.includes("realpole") || defn.includes("lag")) {
      markup = csmfBlockGlyph({ kind: "lag", label: cleanName });
      width = 64;
      height = 42;
    } else if (defn.includes("sum") || defn.endsWith(":add")) {
      markup = csmfBlockGlyph({ kind: "sum", label: cleanName });
      width = 44;
      height = 44;
    } else if (defn.includes("gain")) {
      markup = csmfBlockGlyph({ kind: "gain", label: cleanName });
      width = 52;
      height = 40;
    } else if (defn.includes("limit")) {
      markup = csmfBlockGlyph({ kind: "limit", label: cleanName });
      width = 64;
      height = 42;
    } else if (defn.includes("compar") || defn.includes("relay")) {
      markup = csmfBlockGlyph({ kind: "compar", label: cleanName });
      width = 64;
      height = 42;
    } else if (defn.includes("const")) {
      markup = csmfBlockGlyph({ kind: "const", label: cleanName });
      width = 64;
      height = 42;
    } else if (defn.includes("pgb") || defn.includes("probe") || defn.includes("oscilloscope")) {
      markup = meterProbeGlyph({ kind: "pgb", label: String(cmp.parameters["Name"] ?? cmp.instanceName ?? "PGB") });
      width = 54;
      height = 34;
    } else if (defn.includes("multimeter") || defn.includes("voltmeter") || defn.includes("ammeter")) {
      const mKind = defn.includes("voltmeter") ? "voltmeter" : defn.includes("ammeter") ? "ammeter" : "multimeter";
      markup = meterProbeGlyph({
        kind: mKind,
        label: mKind === "voltmeter" ? "V" : mKind === "ammeter" ? "A" : "V/I/PQ",
      });
      width = 48;
      height = 44;
    } else if (
      defn.includes("datalabel") ||
      defn.includes("data_label") ||
      defn.includes("xnode") ||
      defn.includes("pin")
    ) {
      const isElec = defn.includes("xnode") || defn.includes("pin");
      markup = wirelessNetLabelGlyph({
        label: String(cmp.parameters["Name"] ?? cmp.parameters["name"] ?? cleanName),
        isElectrical: isElec,
      });
      width = 44;
      height = 24;
    }

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

        const rotRad = (((cmp.rotation ?? 0) % 360) * Math.PI) / 180;
        const cos = Math.round(Math.cos(rotRad) * 1e6) / 1e6;
        const sin = Math.round(Math.sin(rotRad) * 1e6) / 1e6;
        const lx = cmp.mirror ? -(p.position?.x ?? 0) : (p.position?.x ?? 0);
        const ly = p.position?.y ?? 0;
        const worldPos = {
          x: cmp.position.x + (lx * cos - ly * sin),
          y: cmp.position.y + (lx * sin + ly * cos),
        };
        portAnchorMap.set(portId, { cell: cmp.id, port: portId, world: worldPos });

        const isSignalPort =
          p.kind === "signal" || p.name === "in" || p.name === "out" || p.name === "in1" || p.name === "in2";
        portItems.push({
          id: portId,
          group,
          attrs: {
            circle: isSignalPort
              ? { r: 3.5, fill: "#c084fc", stroke: "#1e1b4b", strokeWidth: 1.5, magnet: true }
              : { r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 1.5, magnet: true },
            text: {
              text: p.name,
              fill: isSignalPort ? "#d8b4fe" : "#94a3b8",
              fontSize: 9,
            },
          },
          data: {
            portKind: isSignalPort ? "signal" : "electrical",
          },
        });
      }
    }

    const isSubModule = Boolean(project.subModules?.has(cleanDefn) || project.subModules?.has(cmp.definitionName));
    const nodeProperties = {
      name: cleanName,
      className: cmp.definitionName,
      description: isSubModule ? cleanDefn : `${cleanName} (${cleanDefn})`,
      sourceRange: cmp.sourceRange,
      ruleName: isSubModule ? "PartUsage" : undefined,
    };

    // Place X6 node top-left at (cmp.position.x - width/2, cmp.position.y - height/2)
    // so that cmp.position is the exact geometric center of the apparatus.
    const topLeftX = Math.round(cmp.position.x - width / 2);
    const topLeftY = Math.round(cmp.position.y - height / 2);

    cells.push({
      id: cmp.id,
      shape: "rect",
      x: topLeftX,
      y: topLeftY,
      width,
      height,
      angle: cmp.rotation ?? 0,
      markup: markup ?? [
        { tagName: "rect", selector: "body" },
        { tagName: "rect", selector: "headerBg" },
        { tagName: "text", selector: "typeBadge" },
        { tagName: "text", selector: "label" },
      ],
      attrs: markup
        ? {
            label: {
              text: displayLabel,
            },
          }
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
      properties: nodeProperties,
      data: {
        kind: "component",
        definition: cmp.definitionName,
        name: cmp.instanceName,
        parameters: cmp.parameters,
        centerPosition: { x: cmp.position.x, y: cmp.position.y },
        properties: nodeProperties,
      },
    });
  }

  // Collect signal port IDs to distinguish CSMF signal wires from 3-phase electrical wires
  const signalPortIdSet = new Set<string>();
  for (const cmp of mod.components) {
    const d = cmp.definitionName.toLowerCase();
    const isControlBlock =
      d.includes("pi_ctlr") ||
      d.includes("realpole") ||
      d.includes("lag") ||
      d.includes("sum") ||
      d.includes("gain") ||
      d.includes("limit") ||
      d.includes("compar") ||
      d.includes("const") ||
      d.includes("pgb") ||
      d.includes("datalabel");
    for (const p of cmp.ports ?? []) {
      if (isControlBlock || p.kind === "signal") {
        signalPortIdSet.add(p.id);
      }
    }
  }

  const findNearestPortAnchor = (pt: { x: number; y: number }, preferredId?: string) => {
    if (preferredId && portAnchorMap.has(preferredId)) {
      return portAnchorMap.get(preferredId)!;
    }
    let best: { cell: string; port: string; world: { x: number; y: number } } | undefined;
    let bestDist = 15.0;
    for (const anchor of portAnchorMap.values()) {
      const d = Math.hypot(pt.x - anchor.world.x, pt.y - anchor.world.y);
      if (d <= bestDist) {
        bestDist = d;
        best = anchor;
      }
    }
    return best;
  };

  // 3. Convert Wires to Edges (anchoring to component ports/buses when snapped, distinguishing signal vs power)
  for (const wire of mod.wires) {
    if (wire.vertices.length >= 2) {
      const firstPt = wire.vertices[0]!;
      const lastPt = wire.vertices[wire.vertices.length - 1]!;
      const srcAnchor = findNearestPortAnchor(firstPt, wire.startPortId);
      const tgtAnchor = findNearestPortAnchor(lastPt, wire.endPortId);

      const isSignalWire = (wire.connectedPortIds ?? []).some((pid) => signalPortIdSet.has(pid));
      cells.push({
        id: wire.id,
        shape: "edge",
        source: srcAnchor ? { cell: srcAnchor.cell, port: srcAnchor.port } : { x: firstPt.x, y: firstPt.y },
        target: tgtAnchor ? { cell: tgtAnchor.cell, port: tgtAnchor.port } : { x: lastPt.x, y: lastPt.y },
        vertices: wire.vertices.slice(1, -1),
        attrs: {
          line: {
            stroke: isSignalWire ? "#c084fc" : "#38bdf8",
            strokeWidth: isSignalWire ? 1.5 : 2.5,
            strokeDasharray: isSignalWire ? "4,2" : undefined,
            targetMarker: isSignalWire ? { name: "block", width: 6, height: 5 } : null,
          },
        },
        data: {
          kind: "wire",
          wireId: wire.id,
          wireKind: isSignalWire ? "signal" : "electrical",
          connectedPorts: wire.connectedPortIds ?? [],
          sourcePoint: { x: firstPt.x, y: firstPt.y },
          targetPoint: { x: lastPt.x, y: lastPt.y },
          sourceRange: wire.sourceRange,
        },
      });
    }
  }

  // 4. Emit T-Junction Solder Dots where 3+ wire segments or mid-wire taps intersect
  if (mod.junctions && mod.junctions.length > 0) {
    for (let idx = 0; idx < mod.junctions.length; idx++) {
      const j = mod.junctions[idx]!;
      cells.push({
        id: `solder_dot_${j.x}_${j.y}_${idx}`,
        shape: "circle",
        x: j.x - 4,
        y: j.y - 4,
        width: 8,
        height: 8,
        markup: [{ tagName: "circle", selector: "dot" }],
        attrs: {
          dot: {
            cx: 4,
            cy: 4,
            r: 4,
            fill: "#38bdf8",
            stroke: "#0f172a",
            strokeWidth: 1.5,
          },
        },
        data: {
          kind: "junction",
          position: { x: j.x, y: j.y },
        },
      });
    }
  }

  // 5. Convert Sticky Notes to Card Nodes
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
      moduleName: mod.name,
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
      const srcPt = c.data?.["sourcePoint"] ?? c.source;
      const tgtPt = c.data?.["targetPoint"] ?? c.target;
      if (srcPt?.x === undefined || tgtPt?.x === undefined) continue;
      let pathData = `M ${srcPt.x} ${srcPt.y}`;
      if (c.vertices) {
        for (const v of c.vertices) {
          pathData += ` L ${v.x} ${v.y}`;
        }
      }
      pathData += ` L ${tgtPt.x} ${tgtPt.y}`;
      elementsSvg += `  <path d="${pathData}" fill="none" stroke="#81d4fa" stroke-width="2" stroke-linecap="round" />\n`;
    }
  }

  // Render nodes (components, buses, junctions & stickies)
  for (const c of diag.cells) {
    if (c.x !== undefined && c.y !== undefined) {
      const w = c.width ?? 60;
      const h = c.height ?? 60;

      if (c.data?.["kind"] === "junction") {
        const jx = c.data["position"]?.x ?? c.x + 4;
        const jy = c.data["position"]?.y ?? c.y + 4;
        elementsSvg += `  <circle cx="${jx}" cy="${jy}" r="4" fill="#38bdf8" stroke="#0f172a" stroke-width="1.5" />\n`;
      } else if (c.data?.["kind"] === "bus") {
        const vbase = c.data["vbase"] ?? 230;
        const color = vbase >= 200 ? "#ff5252" : vbase >= 69 ? "#ffab40" : "#40c4ff";
        elementsSvg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
        elementsSvg += `    <rect width="${w}" height="${h}" rx="2" fill="${color}" />\n`;
        elementsSvg += `    <text x="${w / 2}" y="-4" fill="${color}" font-size="10" font-weight="bold" font-family="monospace" text-anchor="middle">${escapeHtml(String(c.data["name"] ?? c.id))} (${vbase} kV)</text>\n`;
        elementsSvg += `  </g>\n`;
      } else if (c.data?.["kind"] === "sticky") {
        const lines = (c.data["text"] || "").split("\n");
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
        const rawName = String(c.data?.["name"] || c.id);
        const name = rawName.includes(":") ? rawName.split(":").pop()! : rawName;
        const defn = String(c.data?.["definition"] || "Component");
        elementsSvg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
        elementsSvg += `    <rect width="${w}" height="${h}" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />\n`;
        elementsSvg += `    <text x="${w / 2}" y="${h / 2 - 4}" fill="#f8fafc" font-size="10" font-weight="bold" font-family="sans-serif" text-anchor="middle">${escapeHtml(name)}</text>\n`;
        elementsSvg += `    <text x="${w / 2}" y="${h / 2 + 10}" fill="#94a3b8" font-size="8" font-family="sans-serif" text-anchor="middle">${escapeHtml(defn)}</text>\n`;
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
      for (const [key, oldVal] of Object.entries(oldC.parameters)) {
        if (!(key in newC.parameters)) {
          changedParams.push({ param: key, oldValue: oldVal, newValue: undefined });
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
