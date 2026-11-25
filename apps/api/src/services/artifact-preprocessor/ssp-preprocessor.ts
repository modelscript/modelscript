// SPDX-License-Identifier: AGPL-3.0-or-later

import { escapeXml } from "../../util/escape.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

export interface SspPortInfo {
  name: string;
  kind: "input" | "output" | "inout" | "parameter";
  type: string;
  unit?: string | undefined;
}

export interface SspFmuInfo {
  name: string;
  source: string;
  mimeType: string;
  fmiType: string;
  inputs: string[];
  outputs: string[];
  ports: SspPortInfo[];
  parameters: { name: string; value: string; unit?: string | undefined }[];
  geom?: { x1: number; y1: number; x2: number; y2: number } | undefined;
}

export interface SspConnInfo {
  startElement: string;
  startConnector: string;
  endElement: string;
  endConnector: string;
  type: string;
  unit?: string | undefined;
}

export function buildSspArchitectureFromSource(content: string, fallbackTitle: string) {
  const getAttr = (tag: string, name: string): string | undefined => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
    return m ? m[1] : undefined;
  };

  const ssdMatch = /<(?:ssd:)?SystemStructureDescription\b([^>]*)>/i.exec(content);
  const sspVersion = (ssdMatch && getAttr(ssdMatch[1]!, "version")) || "1.0";
  const sysMatch = /<(?:ssd:)?System\b([^>]*)>/i.exec(content);
  const systemName =
    (sysMatch && getAttr(sysMatch[1]!, "name")) ||
    (ssdMatch && getAttr(ssdMatch[1]!, "name")) ||
    fallbackTitle ||
    "System";

  const expMatch = /<(?:ssd:)?DefaultExperiment\b([^>]*)\/?>/i.exec(content);
  const startTime = expMatch && getAttr(expMatch[1]!, "startTime") ? Number(getAttr(expMatch[1]!, "startTime")) : 0.0;
  const stopTime = expMatch && getAttr(expMatch[1]!, "stopTime") ? Number(getAttr(expMatch[1]!, "stopTime")) : 600.0;
  const stepSize = expMatch && getAttr(expMatch[1]!, "stepSize") ? Number(getAttr(expMatch[1]!, "stepSize")) : 0.002;
  const communicationStepMs = Number((stepSize * 1000).toFixed(2));
  const masterAlgorithm = (expMatch && getAttr(expMatch[1]!, "algorithm")) || "Fixed-Step Gauss-Seidel";

  // Extract inline SSV parameter bindings per component
  const paramsByComp = new Map<string, { name: string; value: string; unit?: string | undefined }[]>();
  const parameterSets: string[] = [];
  const bindingRe = /<(?:ssd:)?ParameterBinding\b([^>]*)>([\s\S]*?)<\/(?:ssd:)?ParameterBinding>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = bindingRe.exec(content)) !== null) {
    const prefix = (getAttr(bm[1]!, "prefix") || "").replace(/\.$/, "");
    const body = bm[2]!;
    const setMatch = /<(?:ssv:)?ParameterSet\b([^>]*)>/i.exec(body);
    if (setMatch) {
      const setName = getAttr(setMatch[1]!, "name");
      if (setName) parameterSets.push(setName.endsWith(".ssv") ? setName : `${setName}.ssv`);
    }
    const pRe = /<(?:ssv:)?Parameter\b([^>]*)>([\s\S]*?)<\/(?:ssv:)?Parameter>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(body)) !== null) {
      const pName = getAttr(pm[1]!, "name") || "param";
      const valMatch = /<(?:ssv:)?(Real|Integer|Boolean|String|Enumeration)\b([^>]*)\/?>/i.exec(pm[2]!);
      if (valMatch) {
        const val = getAttr(valMatch[2]!, "value") ?? "";
        const unit = getAttr(valMatch[2]!, "unit");
        if (!paramsByComp.has(prefix)) paramsByComp.set(prefix, []);
        paramsByComp.get(prefix)!.push({ name: pName, value: val, unit });
      }
    }
  }

  const fmuComponents: SspFmuInfo[] = [];
  const compRe = /<(?:ssd:)?Component\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Component>)/gi;
  let cm: RegExpExecArray | null;
  while ((cm = compRe.exec(content)) !== null) {
    const attrs = cm[1]!;
    const body = cm[2] || "";
    const name = getAttr(attrs, "name") || `FMU_${fmuComponents.length + 1}`;
    const source = getAttr(attrs, "source") || `resources/${name}.fmu`;
    const mimeType = getAttr(attrs, "type") || "application/x-fmu-sharedlibrary";
    const geomMatch = /<(?:ssd:)?ElementGeometry\b([^>]*)\/?>/i.exec(body);
    const geom = geomMatch
      ? {
          x1: Number(getAttr(geomMatch[1]!, "x1") ?? 0),
          y1: Number(getAttr(geomMatch[1]!, "y1") ?? 0),
          x2: Number(getAttr(geomMatch[1]!, "x2") ?? 220),
          y2: Number(getAttr(geomMatch[1]!, "y2") ?? 140),
        }
      : undefined;

    const ports: SspPortInfo[] = [];
    const connRe = /<(?:ssd:)?Connector\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Connector>)/gi;
    let connM: RegExpExecArray | null;
    while ((connM = connRe.exec(body)) !== null) {
      const cAttrs = connM[1]!;
      const cBody = connM[2] || "";
      const cName = getAttr(cAttrs, "name") || "port";
      const rawKind = (getAttr(cAttrs, "kind") || "inout").toLowerCase();
      const kind: SspPortInfo["kind"] =
        rawKind === "input" || rawKind === "output" || rawKind === "parameter" ? rawKind : "inout";
      const typeMatch = /<(?:ssc:)?(Real|Integer|Boolean|String|Enumeration)\b([^>]*)\/?>/i.exec(cBody);
      const type = typeMatch ? typeMatch[1]! : "Real";
      let unit = typeMatch ? getAttr(typeMatch[2]!, "unit") : undefined;
      if (!unit) {
        if (cName.endsWith("_W")) unit = "W";
        else if (cName.endsWith("_K")) unit = "K";
      }
      ports.push({ name: cName, kind, type, unit });
    }

    const inputs = ports.filter((p) => p.kind === "input").map((p) => p.name);
    const outputs = ports.filter((p) => p.kind === "output" || p.kind === "inout").map((p) => p.name);
    const parameters = paramsByComp.get(name) ?? [];

    fmuComponents.push({
      name,
      source,
      mimeType,
      fmiType: "FMI 3.0 CS",
      inputs,
      outputs,
      ports,
      parameters,
      geom,
    });
  }

  const connections: SspConnInfo[] = [];
  const edgeRe = /<(?:ssd:)?Connection\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Connection>)/gi;
  let em: RegExpExecArray | null;
  while ((em = edgeRe.exec(content)) !== null) {
    const attrs = em[1]!;
    const startElement = getAttr(attrs, "startElement") || "";
    const startConnector = getAttr(attrs, "startConnector") || "";
    const endElement = getAttr(attrs, "endElement") || "";
    const endConnector = getAttr(attrs, "endConnector") || "";
    const srcComp = fmuComponents.find((c) => c.name === startElement);
    const srcPort = srcComp?.ports.find((p) => p.name === startConnector);
    const tgtComp = fmuComponents.find((c) => c.name === endElement);
    const tgtPort = tgtComp?.ports.find((p) => p.name === endConnector);
    const type = srcPort?.type || tgtPort?.type || "Real";
    const unit =
      srcPort?.unit ||
      tgtPort?.unit ||
      (startConnector.endsWith("_W") ? "W" : startConnector.endsWith("_K") ? "K" : undefined);
    connections.push({
      startElement,
      startConnector,
      endElement,
      endConnector,
      type,
      unit,
    });
  }

  // Build SSP 1.0 System Structure Schematic SVG (980 x 540)
  const W = 980;
  const H = 540;
  const resolveColor = (type: string, unit?: string) => {
    if (type === "Boolean") return { stroke: "#ec4899", marker: "ssp-arr-pink" };
    if (type === "Integer") return { stroke: "#f97316", marker: "ssp-arr-orange" };
    if (unit === "W" || unit === "kW") return { stroke: "#f59e0b", marker: "ssp-arr-amber" };
    return { stroke: "#38bdf8", marker: "ssp-arr-cyan" };
  };

  const defaultBoxes =
    fmuComponents.length === 4
      ? [
          { x: 76, y: 72, w: 242, h: 160 },
          { x: 76, y: 268, w: 242, h: 150 },
          { x: 398, y: 146, w: 258, h: 192 },
          { x: 726, y: 146, w: 218, h: 170 },
        ]
      : fmuComponents.map((_, idx) => {
          const cols = Math.min(3, Math.max(1, fmuComponents.length));
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          return { x: 76 + col * 296, y: 80 + row * 184, w: 242, h: 156 };
        });

  interface PlacedFmu {
    comp: SspFmuInfo;
    x: number;
    y: number;
    w: number;
    h: number;
    inPorts: Map<string, { x: number; y: number; port: SspPortInfo }>;
    outPorts: Map<string, { x: number; y: number; port: SspPortInfo }>;
  }

  const placed = new Map<string, PlacedFmu>();
  fmuComponents.forEach((comp, idx) => {
    const fb = defaultBoxes[idx] ?? { x: 76, y: 80, w: 240, h: 156 };
    const hasCanvasGeom =
      comp.geom &&
      Math.min(comp.geom.x1, comp.geom.x2) >= 30 &&
      Math.max(comp.geom.x1, comp.geom.x2) <= 955 &&
      Math.abs(comp.geom.x2 - comp.geom.x1) >= 160;
    const x = hasCanvasGeom ? Math.round(Math.min(comp.geom!.x1, comp.geom!.x2)) : fb.x;
    const y = hasCanvasGeom ? Math.round(Math.min(comp.geom!.y1, comp.geom!.y2)) : fb.y;
    const w = hasCanvasGeom ? Math.round(Math.abs(comp.geom!.x2 - comp.geom!.x1)) : fb.w;
    const h = hasCanvasGeom ? Math.round(Math.abs(comp.geom!.y2 - comp.geom!.y1)) : fb.h;

    const headerH = 44;
    const paramH = comp.parameters.length > 0 ? 44 : 26;
    const portZoneTop = y + headerH;
    const portZoneH = Math.max(48, h - headerH - paramH);

    const inList = comp.ports.filter((p) => p.kind === "input");
    const outList = comp.ports.filter((p) => p.kind === "output" || p.kind === "inout");

    const inPorts = new Map<string, { x: number; y: number; port: SspPortInfo }>();
    inList.forEach((p, i) => {
      const py = Math.round(portZoneTop + ((i + 1) * portZoneH) / (inList.length + 1));
      inPorts.set(p.name, { x, y: py, port: p });
    });

    const outPorts = new Map<string, { x: number; y: number; port: SspPortInfo }>();
    outList.forEach((p, i) => {
      const py = Math.round(portZoneTop + ((i + 1) * portZoneH) / (outList.length + 1));
      outPorts.set(p.name, { x: x + w, y: py, port: p });
    });

    placed.set(comp.name, { comp, x, y, w, h, inPorts, outPorts });
  });

  const roundedOrthoPath = (pts: { x: number; y: number }[], r = 7): string => {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;
    const d: string[] = [`M ${pts[0]!.x} ${pts[0]!.y}`];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const next = pts[i + 1]!;
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const l1 = Math.hypot(dx1, dy1);
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const l2 = Math.hypot(dx2, dy2);
      const cr = Math.min(r, l1 / 2.2, l2 / 2.2);
      if (cr < 1.5) {
        d.push(`L ${curr.x} ${curr.y}`);
      } else {
        const p1x = Math.round((curr.x - (dx1 / l1) * cr) * 10) / 10;
        const p1y = Math.round((curr.y - (dy1 / l1) * cr) * 10) / 10;
        const p2x = Math.round((curr.x + (dx2 / l2) * cr) * 10) / 10;
        const p2y = Math.round((curr.y + (dy2 / l2) * cr) * 10) / 10;
        d.push(`L ${p1x} ${p1y} Q ${curr.x} ${curr.y} ${p2x} ${p2y}`);
      }
    }
    const last = pts[pts.length - 1]!;
    d.push(`L ${last.x} ${last.y}`);
    return d.join(" ");
  };

  const startCounts = new Map<string, number>();
  for (const c of connections) {
    const k = `${c.startElement}.${c.startConnector}`;
    startCounts.set(k, (startCounts.get(k) ?? 0) + 1);
  }

  const connPaths: string[] = [];
  const connLabels: string[] = [];
  const junctions = new Map<string, { x: number; y: number; color: string }>();
  const renderedFeedbackBus = new Set<string>();
  let fwdIdx = 0;

  for (const conn of connections) {
    const srcNode = placed.get(conn.startElement);
    const tgtNode = placed.get(conn.endElement);
    const srcPort = srcNode?.outPorts.get(conn.startConnector);
    const tgtPort = tgtNode?.inPorts.get(conn.endConnector);
    if (!srcNode || !tgtNode || !srcPort || !tgtPort) continue;

    const style = resolveColor(conn.type, conn.unit);
    const startKey = `${conn.startElement}.${conn.startConnector}`;
    let pts: { x: number; y: number }[] = [];
    let lx = 0;
    let ly = 0;
    let showLabel = true;

    if (tgtPort.x > srcPort.x + 20) {
      if (Math.abs(srcPort.y - tgtPort.y) <= 4) {
        pts = [
          { x: srcPort.x, y: srcPort.y },
          { x: tgtPort.x, y: tgtPort.y },
        ];
        lx = Math.round((srcPort.x + tgtPort.x) / 2);
        ly = srcPort.y - 13;
      } else {
        const midX = Math.round((srcPort.x + tgtPort.x) / 2) + ((fwdIdx++ % 2) * 8 - 4);
        pts = [
          { x: srcPort.x, y: srcPort.y },
          { x: midX, y: srcPort.y },
          { x: midX, y: tgtPort.y },
          { x: tgtPort.x, y: tgtPort.y },
        ];
        lx = midX;
        ly = Math.round((srcPort.y + tgtPort.y) / 2);
      }
    } else {
      const rightX = srcPort.x + 30;
      const busY = 448;
      const leftX = Math.max(38, tgtPort.x - 34);
      pts = [
        { x: srcPort.x, y: srcPort.y },
        { x: rightX, y: srcPort.y },
        { x: rightX, y: busY },
        { x: leftX, y: busY },
        { x: leftX, y: tgtPort.y },
        { x: tgtPort.x, y: tgtPort.y },
      ];
      lx = Math.round((rightX + leftX) / 2);
      ly = busY - 12;
      if (renderedFeedbackBus.has(startKey)) {
        showLabel = false;
        junctions.set(`${startKey}@${leftX},${tgtPort.y}`, {
          x: leftX,
          y: tgtPort.y,
          color: style.stroke,
        });
      } else {
        renderedFeedbackBus.add(startKey);
      }
    }

    const d = roundedOrthoPath(pts, 7);
    connPaths.push(
      `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="5" stroke-opacity="0.14" stroke-linecap="round" stroke-linejoin="round" />`,
      `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${style.marker})" />`,
    );

    if (showLabel) {
      const unitSuffix = conn.unit ? ` [${conn.unit}]` : "";
      const text = `${conn.startConnector}${unitSuffix}`;
      const pw = Math.max(72, Math.round(text.length * 5.9 + 14));
      connLabels.push(
        `<g transform="translate(${lx}, ${ly})">` +
          `<rect x="${-Math.round(pw / 2)}" y="-9" width="${pw}" height="17" rx="4" fill="#09101d" fill-opacity="0.93" stroke="${style.stroke}" stroke-width="1" stroke-opacity="0.55" />` +
          `<text x="0" y="3" text-anchor="middle" fill="#e2e8f0" font-size="9.2" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(text)}</text>` +
          `</g>`,
      );
    }
  }

  const junctionSvg: string[] = [];
  for (const j of junctions.values()) {
    junctionSvg.push(
      `<circle cx="${j.x}" cy="${j.y}" r="7" fill="${j.color}" fill-opacity="0.24" />`,
      `<circle cx="${j.x}" cy="${j.y}" r="4.2" fill="${j.color}" stroke="#0b111e" stroke-width="1.5" />`,
    );
  }

  const compNodesSvg: string[] = [];
  for (const p of placed.values()) {
    const { comp, x, y, w, h, inPorts, outPorts } = p;
    const shortFmu = comp.source.split("/").pop() || comp.source;
    const headerH = 44;
    const paramH = comp.parameters.length > 0 ? 44 : 26;
    const paramTop = y + h - paramH;

    const portSvg: string[] = [];
    for (const ip of inPorts.values()) {
      const st = resolveColor(ip.port.type, ip.port.unit);
      const uBadge = ip.port.unit ? ` [${ip.port.unit}]` : "";
      portSvg.push(
        `<g transform="translate(${ip.x}, ${ip.y})">` +
          `<polygon points="-6,-5.5 5,0 -6,5.5" fill="${st.stroke}" stroke="#0b111e" stroke-width="1.3" />` +
          `<text x="10" y="3.5" fill="#cbd5e1" font-size="9.8" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(ip.port.name)}<tspan fill="${st.stroke}" font-weight="700">${escapeXml(uBadge)}</tspan></text>` +
          `</g>`,
      );
    }
    for (const op of outPorts.values()) {
      const st = resolveColor(op.port.type, op.port.unit);
      const uBadge = op.port.unit ? ` [${op.port.unit}]` : "";
      portSvg.push(
        `<g transform="translate(${op.x}, ${op.y})">` +
          `<polygon points="-4,-5.5 7,0 -4,5.5" fill="#0b111e" stroke="${st.stroke}" stroke-width="1.8" />` +
          `<text x="-9" y="3.5" text-anchor="end" fill="#cbd5e1" font-size="9.8" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(op.port.name)}<tspan fill="${st.stroke}" font-weight="700">${escapeXml(uBadge)}</tspan></text>` +
          `</g>`,
      );
    }

    const paramSummary =
      comp.parameters.length > 0
        ? comp.parameters.map((pr) => `${pr.name}=${pr.value}${pr.unit ? ` ${pr.unit}` : ""}`).join(" · ")
        : `mime: ${comp.mimeType}`;

    const fmuPillW = Math.min(w - 88, Math.round(shortFmu.length * 5.2 + 12));
    compNodesSvg.push(
      `<g class="ssp-fmu-node" data-fmu="${escapeXml(comp.name)}">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#111a2e" stroke="#10b981" stroke-width="1.8" filter="url(#ssp-shadow)" />` +
        `<path d="M ${x + 8} ${y} L ${x + w - 8} ${y} Q ${x + w} ${y} ${x + w} ${y + 8} L ${x + w} ${y + headerH} L ${x} ${y + headerH} L ${x} ${y + 8} Q ${x} ${y} ${x + 8} ${y} Z" fill="url(#ssp-fmu-hdr)" />` +
        `<line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="#10b981" stroke-opacity="0.45" stroke-width="1" />` +
        `<text x="${x + 10}" y="${y + 15}" fill="#34d399" font-size="8.8" font-weight="700" letter-spacing="0.4" font-family="'Inter', system-ui, sans-serif">«FMU 3.0 CS»</text>` +
        `<rect x="${x + w - fmuPillW - 8}" y="${y + 5}" width="${fmuPillW}" height="14" rx="3" fill="#064e3b" fill-opacity="0.75" stroke="#10b981" stroke-opacity="0.4" stroke-width="0.8" />` +
        `<text x="${x + w - 13}" y="${y + 14.5}" text-anchor="end" fill="#a7f3d0" font-size="8.2" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(shortFmu)}</text>` +
        `<text x="${x + 10}" y="${y + 34}" fill="#f8fafc" font-size="12.5" font-weight="700" font-family="'Inter', system-ui, sans-serif">${escapeXml(comp.name)}</text>` +
        `<line x1="${x}" y1="${paramTop}" x2="${x + w}" y2="${paramTop}" stroke="#1e293b" stroke-width="1" />` +
        `<path d="M ${x} ${paramTop} L ${x + w} ${paramTop} L ${x + w} ${y + h - 8} Q ${x + w} ${y + h} ${x + w - 8} ${y + h} L ${x + 8} ${y + h} Q ${x} ${y + h} ${x} ${y + h - 8} Z" fill="#0b1324" fill-opacity="0.85" />` +
        `<text x="${x + 10}" y="${paramTop + 13}" fill="#64748b" font-size="7.8" font-weight="700" letter-spacing="0.5" font-family="'Inter', system-ui, sans-serif">SSV PARAMETERS</text>` +
        `<text x="${x + 10}" y="${paramTop + 27}" fill="#94a3b8" font-size="9" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(paramSummary)}</text>` +
        portSvg.join("") +
        `</g>`,
    );
  }

  const svg =
    fmuComponents.length > 0
      ? [
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
          `  </defs>`,
          `  <rect width="${W}" height="${H}" rx="10" fill="#0b111e" />`,
          `  <rect width="${W}" height="${H}" rx="10" fill="url(#ssp-grid)" />`,
          `  <rect x="14" y="12" width="${W - 28}" height="${H - 24}" rx="9" fill="none" stroke="#1e293b" stroke-width="1.6" />`,
          `  <path d="M 14 12 L 464 12 L 464 32 L 450 44 L 14 44 Z" fill="#111c33" stroke="#1e293b" stroke-width="1.4" />`,
          `  <text x="26" y="32" fill="#e2e8f0" font-size="11.5" font-weight="700" font-family="'Inter', system-ui, sans-serif">`,
          `    <tspan fill="#10b981">ssd</tspan> <tspan fill="#94a3b8" font-weight="500">[System]</tspan> ${escapeXml(systemName)} <tspan fill="#64748b" font-size="10" font-weight="500">(SSP ${escapeXml(sspVersion)} · FMI 3.0 CS)</tspan>`,
          `  </text>`,
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
          `    <text x="359" y="14.5" text-anchor="middle" fill="#a7f3d0" font-size="9.5" font-weight="700" font-family="'JetBrains Mono', ui-monospace, monospace">Δt = ${communicationStepMs.toFixed(1)} ms CS</text>`,
          `  </g>`,
          `  <g class="ssp-connections">`,
          ...connPaths.map((p) => `    ${p}`),
          ...junctionSvg.map((p) => `    ${p}`),
          `  </g>`,
          `  <g class="ssp-components">`,
          ...compNodesSvg.map((p) => `    ${p}`),
          `  </g>`,
          `  <g class="ssp-labels">`,
          ...connLabels.map((p) => `    ${p}`),
          `  </g>`,
          `  <g transform="translate(26, ${H - 44})">`,
          `    <rect x="0" y="0" width="${W - 52}" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1" />`,
          `    <circle cx="14" cy="12" r="3.5" fill="#10b981" />`,
          `    <text x="24" y="15.5" fill="#94a3b8" font-size="9.5" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">`,
          `      <tspan fill="#10b981" font-weight="700">MASTER:</tspan> ${escapeXml(masterAlgorithm)}  ·  <tspan fill="#cbd5e1">DefaultExperiment:</tspan> t = ${startTime.toFixed(1)}s → ${stopTime.toFixed(1)}s (Δt = ${communicationStepMs.toFixed(1)} ms)  ·  <tspan fill="#38bdf8">${fmuComponents.length} FMUs</tspan> · <tspan fill="#f59e0b">${connections.length} Causal Signals</tspan>`,
          `    </text>`,
          `  </g>`,
          `</svg>`,
        ].join("\n")
      : undefined;

  return {
    svg,
    systemName,
    sspVersion,
    fmiVersion: "3.0 Co-Simulation",
    masterAlgorithm,
    communicationStepMs,
    startTime,
    stopTime,
    fmuComponents,
    connections,
    parameterSets,
  };
}

export function preprocessSspArtifact(ctx: PreprocessContext): PreprocessResult {
  const sspRes = buildSspArchitectureFromSource(ctx.content, ctx.baseTitle);
  return {
    ...(sspRes.svg ? { svg: sspRes.svg } : {}),
    metadata: {
      nodeCount: sspRes.fmuComponents.length,
      connectionCount: sspRes.connections.length,
      dialect: "ssp",
      systemName: sspRes.systemName,
      sspVersion: sspRes.sspVersion,
    },
    viewConfigAdditions: {
      code: ctx.inlineCode,
      title: ctx.baseTitle,
      dialect: "ssp",
      systemName: sspRes.systemName,
      sspVersion: sspRes.sspVersion,
      fmiVersion: sspRes.fmiVersion,
      masterAlgorithm: sspRes.masterAlgorithm,
      communicationStepMs: sspRes.communicationStepMs,
      startTime: sspRes.startTime,
      stopTime: sspRes.stopTime,
      nodeCount: sspRes.fmuComponents.length,
      connectionCount: sspRes.connections.length,
      fmuComponents: sspRes.fmuComponents,
      connections: sspRes.connections,
      parameterSets: sspRes.parameterSets,
    },
  };
}
