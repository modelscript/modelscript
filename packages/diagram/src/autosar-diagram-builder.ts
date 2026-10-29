// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — AUTOSAR Classic & Adaptive ARXML Software Architecture Diagram Builder.
 *
 * Translates AUTOSAR `.arxml` models into:
 * 1. Interactive AntV X6 Virtual Function Bus (VFB) and Software Component (SWC) diagrams showing:
 *    - Composition SWC hierarchies (`COMPOSITION-SW-COMPONENT-TYPE`) and SWC prototypes (`SW-COMPONENT-PROTOTYPE`),
 *    - Atomic SWCs (`APPLICATION-SW-COMPONENT-TYPE`, `SENSOR-ACTUATOR-SW-COMPONENT-TYPE`, etc.),
 *    - Provider (`P-PORT-PROTOTYPE`) and Requirer (`R-PORT-PROTOTYPE`) ports with `SENDER-RECEIVER` / `CLIENT-SERVER` interfaces,
 *    - Assembly & delegation connectors (`ASSEMBLY-SW-CONNECTOR`, `DELEGATION-SW-CONNECTOR`),
 *    - Internal behavior (`SWC-INTERNAL-BEHAVIOR`), `RUNNABLE-ENTITY` execution blocks, and periodic `TIMING-EVENT` / `DATA-RECEIVED-EVENT` triggers,
 *    - CAN Frame & `I-SIGNAL-I-PDU` communication bus frames.
 * 2. Standalone vector SVG architectural schematics.
 */

export interface AutosarPortPrototypeLike {
  shortName: string;
  direction: "provided" | "required" | "provided-required" | string;
  interfaceRef?: string | undefined;
}

export interface AutosarDataAccessLike {
  port: string;
  dataElement: string;
}

export interface AutosarRunnableEntityLike {
  shortName: string;
  symbol?: string | undefined;
  executionTimeWcet?: number | undefined;
  canBeInvokedConcurrently?: boolean | undefined;
  dataReadAccess?: AutosarDataAccessLike[] | undefined;
  dataWriteAccess?: AutosarDataAccessLike[] | undefined;
}

export interface AutosarRteEventLike {
  shortName: string;
  kind: "TIMING-EVENT" | "DATA-RECEIVED-EVENT" | "INIT-EVENT" | "OPERATION-INVOKED-EVENT" | string;
  startOnEventRef: string;
  period?: number | undefined;
  dataReceivePointRef?: AutosarDataAccessLike | undefined;
  operationRef?: string | undefined;
}

export interface AutosarInternalBehaviorLike {
  shortName: string;
  runnables: Map<string, AutosarRunnableEntityLike> | AutosarRunnableEntityLike[];
  events?: AutosarRteEventLike[] | undefined;
}

export interface AutosarSwcPrototypeLike {
  shortName: string;
  typeRef: string;
}

export interface AutosarPortRefLike {
  component?: string | undefined;
  port: string;
}

export interface AutosarConnectorLike {
  shortName: string;
  kind: "ASSEMBLY-SW-CONNECTOR" | "DELEGATION-SW-CONNECTOR" | string;
  provider?: AutosarPortRefLike | undefined;
  requirer?: AutosarPortRefLike | undefined;
  outerPort?: string | undefined;
  innerPort?: AutosarPortRefLike | undefined;
}

export interface AutosarSwComponentLike {
  shortName: string;
  kind: string;
  ports?: Map<string, AutosarPortPrototypeLike> | AutosarPortPrototypeLike[] | undefined;
  internalBehavior?: AutosarInternalBehaviorLike | undefined;
  subComponents?: Map<string, AutosarSwcPrototypeLike> | AutosarSwcPrototypeLike[] | undefined;
  connectors?: AutosarConnectorLike[] | undefined;
}

export interface AutosarSignalLike {
  shortName: string;
  length: number;
  startBit: number;
  dataType?: string | undefined;
}

export interface AutosarPduLike {
  shortName: string;
  byteLength: number;
  signals?: AutosarSignalLike[] | undefined;
}

export interface AutosarCanFrameLike {
  shortName: string;
  frameId: number;
  length: number;
  pduRef?: string | undefined;
  period?: number | undefined;
}

export interface AutosarPortInterfaceLike {
  shortName: string;
  kind: string;
  dataElements?: { shortName: string; typeRef?: string | undefined }[] | undefined;
}

export interface AutosarModelLike {
  title?: string | undefined;
  components: Map<string, AutosarSwComponentLike> | AutosarSwComponentLike[];
  interfaces?: Map<string, AutosarPortInterfaceLike> | AutosarPortInterfaceLike[] | undefined;
  pdus?: Map<string, AutosarPduLike> | AutosarPduLike[] | undefined;
  frames?: Map<string, AutosarCanFrameLike> | AutosarCanFrameLike[] | undefined;
}

export interface AutosarDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface AutosarDiagramGraph {
  title: string;
  cells: AutosarDiagramCell[];
  nodes: AutosarDiagramCell[];
  edges: AutosarDiagramCell[];
  metadata: {
    componentCount: number;
    compositionCount: number;
    portCount: number;
    connectorCount: number;
    runnableCount: number;
    eventCount: number;
    pduCount: number;
    frameCount: number;
  };
}

export interface AutosarRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

function toArray<T>(mapOrArr: Map<string, T> | T[] | undefined): T[] {
  if (!mapOrArr) return [];
  return Array.isArray(mapOrArr) ? mapOrArr : Array.from(mapOrArr.values());
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shortRefName(ref: string | undefined): string {
  if (!ref) return "";
  const parts = ref.split("/");
  return parts[parts.length - 1] ?? ref;
}

function getSwcBadgeAndColor(kind: string): { badge: string; stereotype: string; color: string } {
  switch (kind) {
    case "COMPOSITION-SW-COMPONENT-TYPE":
      return { badge: "COMP", stereotype: "composition swc", color: "#38bdf8" };
    case "SENSOR-ACTUATOR-SW-COMPONENT-TYPE":
      return { badge: "S/A", stereotype: "sensor/actuator swc", color: "#10b981" };
    case "COMPLEX-DEVICE-DRIVER-SW-COMPONENT-TYPE":
      return { badge: "CDD", stereotype: "complex driver", color: "#f97316" };
    case "SERVICE-SW-COMPONENT-TYPE":
      return { badge: "SRV", stereotype: "service swc", color: "#a855f7" };
    case "ECU-ABSTRACTION-SW-COMPONENT-TYPE":
      return { badge: "ECU", stereotype: "ecu abstraction", color: "#eab308" };
    case "APPLICATION-SW-COMPONENT-TYPE":
    default:
      return { badge: "ASW", stereotype: "application swc", color: "#0284c7" };
  }
}

/**
 * Builds an interactive AntV X6 Virtual Function Bus (VFB) and RTE Runnable diagram for an AUTOSAR model.
 */
export function buildAutosarDiagram(model: AutosarModelLike): AutosarDiagramGraph {
  const components = toArray(model.components);
  const pdus = toArray(model.pdus);
  const frames = toArray(model.frames);

  const compByShortName = new Map<string, AutosarSwComponentLike>();
  for (const c of components) {
    compByShortName.set(c.shortName, c);
  }

  const compositions = components.filter((c) => c.kind === "COMPOSITION-SW-COMPONENT-TYPE");
  const atomicComponents = components.filter((c) => c.kind !== "COMPOSITION-SW-COMPONENT-TYPE");

  const primaryComposition = compositions[0];
  const title =
    model.title?.trim() ||
    primaryComposition?.shortName ||
    atomicComponents[0]?.shortName ||
    "AUTOSAR VFB Architecture";

  const cells: AutosarDiagramCell[] = [];
  let totalPortCount = 0;
  let totalConnectorCount = 0;
  let totalRunnableCount = 0;
  let totalEventCount = 0;

  for (const c of components) {
    totalPortCount += toArray(c.ports).length;
    totalConnectorCount += (c.connectors ?? []).length;
    if (c.internalBehavior) {
      totalRunnableCount += toArray(c.internalBehavior.runnables).length;
      totalEventCount += (c.internalBehavior.events ?? []).length;
    }
  }

  // Case 1: Composition SWC with SW-COMPONENT-PROTOTYPE instances
  const protoList = primaryComposition ? toArray(primaryComposition.subComponents) : [];
  if (primaryComposition && protoList.length > 0) {
    const protoCellIds: string[] = [];
    const protoByShortName = new Map<string, string>();

    const cols = Math.min(2, protoList.length);
    protoList.forEach((proto, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 90 + col * 360;
      const y = 105 + row * 145;
      const width = 260;
      const height = 96;

      const targetTypeName = shortRefName(proto.typeRef);
      const targetSwc = compByShortName.get(targetTypeName);
      const swcKind = targetSwc?.kind ?? "APPLICATION-SW-COMPONENT-TYPE";
      const { badge, stereotype, color } = getSwcBadgeAndColor(swcKind);
      const swcPorts = toArray(targetSwc?.ports);
      const rPorts = swcPorts.filter((p) => p.direction === "required").map((p) => p.shortName);
      const pPorts = swcPorts.filter((p) => p.direction !== "required").map((p) => p.shortName);

      const cellId = `swc_proto_${proto.shortName}`;
      protoCellIds.push(cellId);
      protoByShortName.set(proto.shortName, cellId);

      cells.push({
        id: cellId,
        shape: "rect",
        x,
        y,
        width,
        height,
        label: `${proto.shortName}\n: ${targetTypeName}`,
        attrs: {
          body: {
            fill: "#0f172a",
            stroke: color,
            strokeWidth: 2,
            rx: 7,
            ry: 7,
          },
          label: {
            fill: "#f8fafc",
            fontSize: 11,
            fontFamily: "JetBrains Mono, Menlo, monospace",
          },
        },
        data: {
          kind: "swc_prototype",
          name: proto.shortName,
          typeName: targetTypeName,
          swcKind,
          badge,
          stereotype,
          color,
          rPorts,
          pPorts,
        },
      });
    });

    // Connect explicit ASSEMBLY-SW-CONNECTORs or synthesize VFB architectural signal flow across composition prototypes
    const explicitConnectors = primaryComposition.connectors ?? [];
    if (explicitConnectors.length > 0) {
      explicitConnectors.forEach((conn, idx) => {
        const srcComp = conn.provider?.component ? protoByShortName.get(conn.provider.component) : undefined;
        const tgtComp = conn.requirer?.component ? protoByShortName.get(conn.requirer.component) : undefined;
        if (srcComp && tgtComp) {
          const pPort = conn.provider?.port ?? "PPort";
          const rPort = conn.requirer?.port ?? "RPort";
          cells.push({
            id: `conn_${idx + 1}_${conn.shortName}`,
            shape: "edge",
            source: { cell: srcComp, port: pPort },
            target: { cell: tgtComp, port: rPort },
            label: `${pPort} → ${rPort}`,
            attrs: {
              line: {
                stroke: "#38bdf8",
                strokeWidth: 2,
              },
            },
            data: {
              kind: conn.kind,
              name: conn.shortName,
              providerPort: pPort,
              requirerPort: rPort,
              color: "#38bdf8",
            },
          });
        }
      });
    } else if (protoCellIds.length > 1) {
      for (let i = 0; i < protoCellIds.length - 1; i++) {
        const srcId = protoCellIds[i]!;
        const tgtId = protoCellIds[i + 1]!;
        const srcProto = protoList[i]!;
        const tgtProto = protoList[i + 1]!;
        cells.push({
          id: `vfb_link_${i + 1}`,
          shape: "edge",
          source: { cell: srcId, port: "P_Out" },
          target: { cell: tgtId, port: "R_In" },
          label: `VFB: ${srcProto.shortName} → ${tgtProto.shortName}`,
          attrs: {
            line: {
              stroke: "#38bdf8",
              strokeWidth: 2,
            },
          },
          data: {
            kind: "ASSEMBLY-SW-CONNECTOR",
            name: `VFB_${srcProto.shortName}_to_${tgtProto.shortName}`,
            color: "#38bdf8",
          },
        });
      }
      totalConnectorCount = protoCellIds.length - 1;
    }
  } else {
    // Case 2: Atomic SWC(s) with R-Ports, P-Ports, Internal Behavior Runnables, and RTE Events
    const targetSwc = atomicComponents[0] ?? components[0];
    if (targetSwc) {
      const ports = toArray(targetSwc.ports);
      const rPorts = ports.filter((p) => p.direction === "required");
      const pPorts = ports.filter((p) => p.direction !== "required");
      const runnables = toArray(targetSwc.internalBehavior?.runnables);
      const events = targetSwc.internalBehavior?.events ?? [];

      // Place Left R-Ports
      rPorts.forEach((rp, idx) => {
        const x = 60;
        const y = 110 + idx * 105;
        const ifName = shortRefName(rp.interfaceRef) || "SR_Interface";
        cells.push({
          id: `rport_${rp.shortName}`,
          shape: "rect",
          x,
          y,
          width: 165,
          height: 60,
          label: `${rp.shortName}\n«R-Port: ${ifName}»`,
          attrs: {
            body: { fill: "#0f172a", stroke: "#f59e0b", strokeWidth: 2, rx: 6, ry: 6 },
            label: { fill: "#f8fafc", fontSize: 10 },
          },
          data: {
            kind: "r_port",
            name: rp.shortName,
            interfaceName: ifName,
            badge: "R-PORT",
            stereotype: `interface: ${ifName}`,
            color: "#f59e0b",
          },
        });
      });

      // Place Center RTE Events & Runnables (or Atomic SWC Core if no runnables)
      const runnableCellByName = new Map<string, string>();
      if (runnables.length > 0) {
        runnables.forEach((run, idx) => {
          const x = 325;
          const y = 110 + idx * 115;
          const cellId = `runnable_${run.shortName}`;
          runnableCellByName.set(run.shortName, cellId);

          const triggerEv = events.find((e) => shortRefName(e.startOnEventRef) === run.shortName);
          const periodMs =
            triggerEv?.period !== undefined ? `${(triggerEv.period * 1000).toFixed(1)} ms` : (triggerEv?.kind ?? "RTE");
          const wcetUs =
            run.executionTimeWcet !== undefined && run.executionTimeWcet > 0
              ? ` | WCET ${(run.executionTimeWcet * 1e6).toFixed(0)} µs`
              : "";
          const symLabel = run.symbol ? `symbol: ${run.symbol}()` : "runnable entity";

          cells.push({
            id: cellId,
            shape: "rect",
            x,
            y,
            width: 245,
            height: 76,
            label: `${run.shortName}\n[${periodMs}${wcetUs}]`,
            attrs: {
              body: { fill: "#111827", stroke: "#0284c7", strokeWidth: 2, rx: 7, ry: 7 },
              label: { fill: "#f8fafc", fontSize: 10.5 },
            },
            data: {
              kind: "runnable",
              name: run.shortName,
              symbol: run.symbol,
              periodLabel: `${periodMs}${wcetUs}`,
              badge: "RUN",
              stereotype: symLabel,
              color: "#0284c7",
            },
          });

          // Connect R-Ports -> Runnable
          rPorts.forEach((rp, rIdx) => {
            cells.push({
              id: `rte_read_${idx}_${rIdx}`,
              shape: "edge",
              source: { cell: `rport_${rp.shortName}`, port: "out" },
              target: { cell: cellId, port: "in" },
              label: "Rte_Read",
              attrs: { line: { stroke: "#f59e0b", strokeWidth: 1.8 } },
              data: { kind: "rte_read", color: "#f59e0b" },
            });
          });
        });
      } else {
        const { badge, stereotype, color } = getSwcBadgeAndColor(targetSwc.kind);
        const coreId = `swc_${targetSwc.shortName}`;
        runnableCellByName.set(targetSwc.shortName, coreId);
        cells.push({
          id: coreId,
          shape: "rect",
          x: 325,
          y: 120,
          width: 245,
          height: 80,
          label: `${targetSwc.shortName}\n«${stereotype}»`,
          attrs: {
            body: { fill: "#111827", stroke: color, strokeWidth: 2, rx: 7, ry: 7 },
            label: { fill: "#f8fafc", fontSize: 11 },
          },
          data: {
            kind: "swc_core",
            name: targetSwc.shortName,
            badge,
            stereotype,
            color,
          },
        });
      }

      // Place Right P-Ports
      const firstRunCellId = Array.from(runnableCellByName.values())[0];
      pPorts.forEach((pp, idx) => {
        const x = 665;
        const y = 110 + idx * 105;
        const ifName = shortRefName(pp.interfaceRef) || "SR_Interface";
        const pCellId = `pport_${pp.shortName}`;
        cells.push({
          id: pCellId,
          shape: "rect",
          x,
          y,
          width: 165,
          height: 60,
          label: `${pp.shortName}\n«P-Port: ${ifName}»`,
          attrs: {
            body: { fill: "#0f172a", stroke: "#10b981", strokeWidth: 2, rx: 6, ry: 6 },
            label: { fill: "#f8fafc", fontSize: 10 },
          },
          data: {
            kind: "p_port",
            name: pp.shortName,
            interfaceName: ifName,
            badge: "P-PORT",
            stereotype: `interface: ${ifName}`,
            color: "#10b981",
          },
        });

        if (firstRunCellId) {
          cells.push({
            id: `rte_write_${idx}`,
            shape: "edge",
            source: { cell: firstRunCellId, port: "out" },
            target: { cell: pCellId, port: "in" },
            label: "Rte_Write",
            attrs: { line: { stroke: "#10b981", strokeWidth: 1.8 } },
            data: { kind: "rte_write", color: "#10b981" },
          });
        }
      });
    }
  }

  // Case 3: Append CAN-FRAME / I-SIGNAL-I-PDU communication nodes if present
  if (frames.length > 0 || pdus.length > 0) {
    let commY = 280;
    for (const c of cells) {
      if (c.y !== undefined) {
        commY = Math.max(commY, c.y + (c.height ?? 80) + 45);
      }
    }
    frames.forEach((fr, idx) => {
      const hexId = `0x${fr.frameId.toString(16).toUpperCase()}`;
      cells.push({
        id: `frame_${fr.shortName}`,
        shape: "rect",
        x: 90 + idx * 260,
        y: commY,
        width: 220,
        height: 62,
        label: `${fr.shortName} [${hexId}]\nDLC: ${fr.length}B → PDU: ${shortRefName(fr.pduRef) || "N/A"}`,
        attrs: {
          body: { fill: "#0f172a", stroke: "#a855f7", strokeWidth: 1.8, rx: 6, ry: 6 },
          label: { fill: "#f8fafc", fontSize: 10 },
        },
        data: {
          kind: "can_frame",
          name: fr.shortName,
          badge: "CAN",
          stereotype: `ID ${hexId} (${fr.length} Bytes)`,
          color: "#a855f7",
        },
      });
    });
  }

  const nodes = cells.filter((c) => c.shape !== "edge");
  const edges = cells.filter((c) => c.shape === "edge");

  return {
    title,
    cells,
    nodes,
    edges,
    metadata: {
      componentCount: components.length,
      compositionCount: compositions.length,
      portCount: totalPortCount,
      connectorCount: totalConnectorCount,
      runnableCount: totalRunnableCount,
      eventCount: totalEventCount,
      pduCount: pdus.length,
      frameCount: frames.length,
    },
  };
}

/**
 * Renders an AUTOSAR ARXML model into a standalone dark/light vector SVG architecture diagram.
 */
export function renderAutosarSvg(model: AutosarModelLike, options?: AutosarRenderOptions): string {
  const diag = buildAutosarDiagram(model);
  const isLight = options?.theme === "light";

  const bg = isLight ? "#f8fafc" : "#0b0f19";
  const panelBg = isLight ? "#ffffff" : "#111827";
  const busBg = isLight ? "#f1f5f9" : "#0f172a";
  const fg = isLight ? "#0f172a" : "#f8fafc";
  const mutedFg = isLight ? "#475569" : "#94a3b8";

  let minX = 40;
  let minY = 40;
  let maxX = 820;
  let maxY = 340;

  for (const cell of diag.nodes) {
    if (cell.x !== undefined && cell.y !== undefined) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x + (cell.width ?? 220));
      maxY = Math.max(maxY, cell.y + (cell.height ?? 80));
    }
  }

  const padding = 48;
  const width = options?.width ?? Math.max(880, maxX - minX + padding * 2);
  const height = options?.height ?? Math.max(420, maxY - minY + padding * 2 + 30);
  const viewBox = `0 0 ${width} ${height}`;

  const nodeMap = new Map<string, AutosarDiagramCell>();
  for (const cell of diag.nodes) {
    nodeMap.set(cell.id, cell);
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" style="background-color: ${bg}; font-family: 'JetBrains Mono', Menlo, ui-monospace, monospace;">\n`;
  svg += `  <defs>\n`;
  svg += `    <filter id="autosar-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0284c7" flood-opacity="0.2" />\n`;
  svg += `    </filter>\n`;
  svg += `    <marker id="autosar-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n\n`;

  // Header
  svg += `  <text x="48" y="34" fill="${fg}" font-size="15" font-weight="700">${escapeXml(diag.title)} — AUTOSAR VFB &amp; RTE Architecture</text>\n`;
  svg += `  <text x="48" y="52" fill="${mutedFg}" font-size="11">SWCs: ${diag.metadata.componentCount} | Ports: ${diag.metadata.portCount} | Runnables: ${diag.metadata.runnableCount} | Events: ${diag.metadata.eventCount} | Connectors: ${diag.metadata.connectorCount}</text>\n\n`;

  // VFB / RTE Container Frame
  const boxX = 44;
  const boxY = 72;
  const boxW = width - 88;
  const boxH = height - 102;
  svg += `  <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="10" fill="${busBg}" fill-opacity="0.5" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="6,4" />\n`;
  svg += `  <text x="${boxX + 16}" y="${boxY + 20}" fill="#38bdf8" font-size="10" font-weight="700">AUTOSAR VIRTUAL FUNCTION BUS (VFB) / RUNTIME ENVIRONMENT (RTE)</text>\n\n`;

  // Edges Layer
  svg += `  <g id="autosar-connectors-layer">\n`;
  for (const edge of diag.edges) {
    const srcId = typeof edge.source === "object" && edge.source && "cell" in edge.source ? edge.source.cell : null;
    const tgtId = typeof edge.target === "object" && edge.target && "cell" in edge.target ? edge.target.cell : null;
    if (!srcId || !tgtId) continue;

    const srcNode = nodeMap.get(srcId);
    const tgtNode = nodeMap.get(tgtId);
    if (!srcNode || !tgtNode) continue;

    const srcW = srcNode.width ?? 220;
    const srcH = srcNode.height ?? 80;
    const tgtW = tgtNode.width ?? 220;
    const tgtH = tgtNode.height ?? 80;

    const srcCx = (srcNode.x ?? 0) + srcW / 2;
    const srcCy = (srcNode.y ?? 0) + srcH / 2;
    const tgtCx = (tgtNode.x ?? 0) + tgtW / 2;
    const tgtCy = (tgtNode.y ?? 0) + tgtH / 2;

    let pathD: string;
    if (Math.abs((srcNode.y ?? 0) - (tgtNode.y ?? 0)) < 30) {
      const x1 = srcCx <= tgtCx ? (srcNode.x ?? 0) + srcW : (srcNode.x ?? 0);
      const y1 = srcCy;
      const x2 = srcCx <= tgtCx ? (tgtNode.x ?? 0) : (tgtNode.x ?? 0) + tgtW;
      const y2 = tgtCy;
      const midX = Math.round((x1 + x2) / 2);
      pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    } else {
      const x1 = srcCx;
      const y1 = srcCy <= tgtCy ? (srcNode.y ?? 0) + srcH : (srcNode.y ?? 0);
      const x2 = tgtCx;
      const y2 = srcCy <= tgtCy ? (tgtNode.y ?? 0) : (tgtNode.y ?? 0) + tgtH;
      const midY = Math.round((y1 + y2) / 2);
      pathD = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }

    const stroke = (edge.data?.["color"] as string | undefined) ?? "#38bdf8";
    svg += `    <path id="${escapeXml(edge.id)}" d="${pathD}" fill="none" stroke="${stroke}" stroke-width="2" marker-end="url(#autosar-arrow)" opacity="0.9" />\n`;
  }
  svg += `  </g>\n\n`;

  // Nodes Layer
  svg += `  <g id="autosar-components-layer">\n`;
  for (const cell of diag.nodes) {
    const x = cell.x ?? 0;
    const y = cell.y ?? 0;
    const w = cell.width ?? 220;
    const h = cell.height ?? 80;
    const cx = x + w / 2;
    const cy = y + h / 2;

    const name = (cell.data?.["name"] as string | undefined) ?? cell.id;
    const typeName = (cell.data?.["typeName"] as string | undefined) ?? "";
    const badge = (cell.data?.["badge"] as string | undefined) ?? "SWC";
    const stereotype = (cell.data?.["stereotype"] as string | undefined) ?? "autosar";
    const periodLabel = (cell.data?.["periodLabel"] as string | undefined) ?? "";
    const color = (cell.data?.["color"] as string | undefined) ?? "#0284c7";

    svg += `    <g id="${escapeXml(cell.id)}" filter="url(#autosar-glow)">\n`;
    svg += `      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${panelBg}" stroke="${color}" stroke-width="2" />\n`;
    svg += `      <rect x="${x + 8}" y="${y + 8}" width="44" height="15" rx="3" fill="${color}" fill-opacity="0.2" />\n`;
    svg += `      <text x="${x + 30}" y="${y + 18.5}" fill="${color}" font-size="8.5" font-weight="700" text-anchor="middle">${escapeXml(badge)}</text>\n`;
    svg += `      <text x="${cx + 14}" y="${y + 22}" fill="${fg}" font-size="11.5" font-weight="700" text-anchor="middle">${escapeXml(name)}</text>\n`;

    if (typeName) {
      svg += `      <text x="${cx}" y="${y + 44}" fill="#38bdf8" font-size="9.5" text-anchor="middle">: ${escapeXml(typeName)}</text>\n`;
    } else if (periodLabel) {
      svg += `      <text x="${cx}" y="${y + 44}" fill="#38bdf8" font-size="9.5" font-weight="600" text-anchor="middle">${escapeXml(periodLabel)}</text>\n`;
    }

    svg += `      <text x="${cx}" y="${y + h - 10}" fill="${mutedFg}" font-size="9" text-anchor="middle">«${escapeXml(stereotype)}»</text>\n`;

    // Left R-Port & Right P-Port connector pins
    svg += `      <rect x="${x - 4}" y="${cy - 4}" width="8" height="8" rx="1.5" fill="#f59e0b" />\n`;
    svg += `      <rect x="${x + w - 4}" y="${cy - 4}" width="8" height="8" rx="1.5" fill="#10b981" />\n`;
    svg += `    </g>\n`;
  }
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
