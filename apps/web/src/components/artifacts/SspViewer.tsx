// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  FileZipIcon,
  GitCommitIcon,
  PackageIcon,
  PlayIcon,
  SlidersIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Button, Spinner } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface SspPortMeta {
  name: string;
  kind: "input" | "output" | "inout" | "parameter";
  type: string;
  unit?: string | undefined;
}

export interface SspParamMeta {
  name: string;
  value: string | number;
  unit?: string | undefined;
}

export interface SspFmuComponentMeta {
  name: string;
  source: string;
  mimeType?: string | undefined;
  fmiType?: string | undefined;
  inputs?: string[] | undefined;
  outputs?: string[] | undefined;
  ports?: SspPortMeta[] | undefined;
  parameters?: SspParamMeta[] | undefined;
}

export interface SspConnectionMeta {
  startElement: string;
  startConnector: string;
  endElement: string;
  endConnector: string;
  type?: string | undefined;
  unit?: string | undefined;
}

export interface SspViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    systemName?: string | undefined;
    sspVersion?: string | undefined;
    fmiVersion?: string | undefined;
    masterAlgorithm?: string | undefined;
    communicationStepMs?: number | undefined;
    startTime?: number | undefined;
    stopTime?: number | undefined;
    fmuComponents?: SspFmuComponentMeta[] | undefined;
    connections?: SspConnectionMeta[] | undefined;
    parameterSets?: (string | { name: string; parameters?: Record<string, string | number> })[] | undefined;
    nodeCount?: number | undefined;
    connectionCount?: number | undefined;
    standalone?: boolean | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

type SspTabMode = "topology" | "fmus" | "signals" | "parameters" | "xml";

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "520px")};
  background: #0b111e;
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 40px;
  min-height: 40px;
  background: var(--surface-hud, rgba(13, 19, 33, 0.92));
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
`;

const ModelTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $tone?: "emerald" | "purple" | "cyan" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  background: ${(p) =>
    p.$tone === "emerald"
      ? "rgba(16, 185, 129, 0.16)"
      : p.$tone === "cyan"
        ? "rgba(56, 189, 248, 0.15)"
        : "rgba(139, 92, 246, 0.16)"};
  color: ${(p) => (p.$tone === "emerald" ? "#6ee7b7" : p.$tone === "cyan" ? "#7dd3fc" : "#c4b5fd")};
  border: 1px solid
    ${(p) =>
      p.$tone === "emerald"
        ? "rgba(16, 185, 129, 0.38)"
        : p.$tone === "cyan"
          ? "rgba(56, 189, 248, 0.35)"
          : "rgba(139, 92, 246, 0.38)"};
`;

const TabGroup = styled.div`
  display: flex;
  align-items: center;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "rgba(16, 185, 129, 0.22)" : "transparent")};
  color: ${(p) => (p.$active ? "#6ee7b7" : "#94a3b8")};
  border: ${(p) => (p.$active ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid transparent")};
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    color: #e2e8f0;
    background: ${(p) => (p.$active ? "rgba(16, 185, 129, 0.28)" : "rgba(148, 163, 184, 0.1)")};
  }
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  background: #0b111e;
`;

const DiagramStage = styled.div<{ $selectedFmu?: string | null; $dragging?: boolean }>`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #111c33 0%, #0b111e 75%);
  user-select: none;
  cursor: ${(p) => (p.$dragging ? "grabbing" : "grab")};

  svg {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    display: block;
  }

  .ssp-fmu-node {
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .ssp-fmu-node:hover rect:first-of-type {
    stroke: #34d399;
    stroke-width: 2.5px;
  }

  ${(p) => {
    if (!p.$selectedFmu) return "";
    const escapedFmu = p.$selectedFmu.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `
    .ssp-fmu-node:not([data-fmu="${escapedFmu}"]) {
      opacity: 0.45;
    }
    .ssp-fmu-node[data-fmu="${escapedFmu}"] rect:first-of-type {
      stroke: #34d399;
      stroke-width: 3px;
      filter: drop-shadow(0 0 8px rgba(52, 211, 153, 0.45));
    }
  `;
  }}
`;

const StageOverlayBottomLeft = styled.div`
  position: absolute;
  left: 12px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  z-index: 5;
`;

const FmuChip = styled.button<{ $selected: boolean }>`
  background: ${(p) => (p.$selected ? "rgba(16, 185, 129, 0.24)" : "rgba(15, 23, 42, 0.85)")};
  color: ${(p) => (p.$selected ? "#6ee7b7" : "#cbd5e1")};
  border: 1px solid ${(p) => (p.$selected ? "#10b981" : "rgba(148, 163, 184, 0.24)")};
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s ease;

  &:hover {
    border-color: #10b981;
    color: #f8fafc;
  }
`;

const ZoomControls = styled.div`
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  padding: 2px;
  z-index: 5;
  backdrop-filter: blur(8px);
`;

const ZoomBtn = styled.button`
  background: transparent;
  color: #cbd5e1;
  border: none;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
    color: #ffffff;
  }
`;

const InspectorSidebar = styled.div`
  width: 265px;
  min-width: 265px;
  border-left: 1px solid rgba(148, 163, 184, 0.16);
  background: #0d1526;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 12px 14px;
  gap: 10px;
  color: #e2e8f0;

  @media (max-width: 768px) {
    display: none;
  }
`;

const SectionHeader = styled.div`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin-top: 2px;
`;

const StatItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  color: #94a3b8;

  strong {
    color: #f1f5f9;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
`;

const PaneScroll = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: #0b111e;
  color: #e2e8f0;
`;

const FmuGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 12px;
`;

const FmuCard = styled.div`
  background: #111a2e;
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SignalTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th {
    text-align: left;
    padding: 8px 10px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.6);
  }

  td {
    padding: 9px 10px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    color: #e2e8f0;
  }

  tr:hover td {
    background: rgba(30, 41, 59, 0.45);
  }
`;

function escapeXmlText(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getXmlAttr(tag: string, attr: string): string | undefined {
  const m = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : undefined;
}

/**
 * Parse `.ssd` XML on the client to enrich missing metadata or synthesize an SSP 1.0 schematic SVG.
 */
function parseSsdClientModel(xml: string, viewConfig: SspViewerProps["viewConfig"]) {
  const ssdMatch = /<(?:ssd:)?SystemStructureDescription\b([^>]*)>/i.exec(xml);
  const sysMatch = /<(?:ssd:)?System\b([^>]*)>/i.exec(xml);
  const expMatch = /<(?:ssd:)?DefaultExperiment\b([^>]*)\/?>/i.exec(xml);

  const systemName =
    viewConfig.systemName ||
    (sysMatch && getXmlAttr(sysMatch[1]!, "name")) ||
    (ssdMatch && getXmlAttr(ssdMatch[1]!, "name")) ||
    viewConfig.title ||
    "SystemStructure.ssd";

  const sspVersion = viewConfig.sspVersion || (ssdMatch && getXmlAttr(ssdMatch[1]!, "version")) || "1.0";
  const fmiVersion = viewConfig.fmiVersion || "3.0 Co-Simulation";
  const masterAlgorithm =
    viewConfig.masterAlgorithm || (expMatch && getXmlAttr(expMatch[1]!, "algorithm")) || "Fixed-Step Gauss-Seidel";
  const stepSize =
    expMatch && getXmlAttr(expMatch[1]!, "stepSize") ? Number(getXmlAttr(expMatch[1]!, "stepSize")) : 0.002;
  const communicationStepMs = viewConfig.communicationStepMs ?? Number((stepSize * 1000).toFixed(1));
  const startTime =
    viewConfig.startTime ??
    (expMatch && getXmlAttr(expMatch[1]!, "startTime") ? Number(getXmlAttr(expMatch[1]!, "startTime")) : 0.0);
  const stopTime =
    viewConfig.stopTime ??
    (expMatch && getXmlAttr(expMatch[1]!, "stopTime") ? Number(getXmlAttr(expMatch[1]!, "stopTime")) : 600.0);

  // Extract inline SSV parameter bindings
  const paramsByComp = new Map<string, SspParamMeta[]>();
  const parameterSetNames: string[] = [];
  if (xml) {
    const bindRe = /<(?:ssd:)?ParameterBinding\b([^>]*)>([\s\S]*?)<\/(?:ssd:)?ParameterBinding>/gi;
    let bm: RegExpExecArray | null;
    while ((bm = bindRe.exec(xml)) !== null) {
      const prefix = (getXmlAttr(bm[1]!, "prefix") || "").replace(/\.$/, "");
      const body = bm[2]!;
      const setMatch = /<(?:ssv:)?ParameterSet\b([^>]*)>/i.exec(body);
      if (setMatch) {
        const sName = getXmlAttr(setMatch[1]!, "name");
        if (sName) parameterSetNames.push(sName.endsWith(".ssv") ? sName : `${sName}.ssv`);
      }
      const pRe = /<(?:ssv:)?Parameter\b([^>]*)>([\s\S]*?)<\/(?:ssv:)?Parameter>/gi;
      let pm: RegExpExecArray | null;
      while ((pm = pRe.exec(body)) !== null) {
        const pName = getXmlAttr(pm[1]!, "name") || "param";
        const valM = /<(?:ssv:)?(Real|Integer|Boolean|String|Enumeration)\b([^>]*)\/?>/i.exec(pm[2]!);
        if (valM) {
          const val = getXmlAttr(valM[2]!, "value") ?? "";
          const unit = getXmlAttr(valM[2]!, "unit");
          if (!paramsByComp.has(prefix)) paramsByComp.set(prefix, []);
          paramsByComp.get(prefix)!.push({ name: pName, value: val, unit });
        }
      }
    }
  }

  // Extract components from XML or fallback to viewConfig.fmuComponents
  const fmus: SspFmuComponentMeta[] = [];
  if (xml && /<(?:ssd:)?Component\b/i.test(xml)) {
    const compRe = /<(?:ssd:)?Component\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Component>)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = compRe.exec(xml)) !== null) {
      const attrs = cm[1]!;
      const body = cm[2] || "";
      const name = getXmlAttr(attrs, "name") || `FMU_${fmus.length + 1}`;
      const source = getXmlAttr(attrs, "source") || `resources/${name}.fmu`;
      const mimeType = getXmlAttr(attrs, "type") || "application/x-fmu-sharedlibrary";
      const ports: SspPortMeta[] = [];
      const cRe = /<(?:ssd:)?Connector\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Connector>)/gi;
      let connM: RegExpExecArray | null;
      while ((connM = cRe.exec(body)) !== null) {
        const cAttrs = connM[1]!;
        const cBody = connM[2] || "";
        const cName = getXmlAttr(cAttrs, "name") || "port";
        const rawKind = (getXmlAttr(cAttrs, "kind") || "inout").toLowerCase();
        const kind: SspPortMeta["kind"] =
          rawKind === "input" || rawKind === "output" || rawKind === "parameter" ? rawKind : "inout";
        const typeM = /<(?:ssc:)?(Real|Integer|Boolean|String|Enumeration)\b([^>]*)\/?>/i.exec(cBody);
        const type = typeM ? typeM[1]! : "Real";
        let unit = typeM ? getXmlAttr(typeM[2]!, "unit") : undefined;
        if (!unit) {
          if (cName.endsWith("_W")) unit = "W";
          else if (cName.endsWith("_K")) unit = "K";
        }
        ports.push({ name: cName, kind, type, unit });
      }
      const cfgFmu = viewConfig.fmuComponents?.find((f) => f.name === name);
      const parameters = paramsByComp.get(name) ?? cfgFmu?.parameters ?? [];
      fmus.push({
        name,
        source,
        mimeType,
        fmiType: "FMI 3.0 CS",
        inputs: ports.filter((p) => p.kind === "input").map((p) => p.name),
        outputs: ports.filter((p) => p.kind === "output" || p.kind === "inout").map((p) => p.name),
        ports,
        parameters,
      });
    }
  } else if (Array.isArray(viewConfig.fmuComponents)) {
    for (const fc of viewConfig.fmuComponents) {
      const ports: SspPortMeta[] = fc.ports ?? [
        ...(fc.inputs ?? []).map((n) => ({
          name: n,
          kind: "input" as const,
          type: "Real",
          unit: n.endsWith("_W") ? "W" : n.endsWith("_K") ? "K" : undefined,
        })),
        ...(fc.outputs ?? []).map((n) => ({
          name: n,
          kind: "output" as const,
          type: "Real",
          unit: n.endsWith("_W") ? "W" : n.endsWith("_K") ? "K" : undefined,
        })),
      ];
      fmus.push({
        ...fc,
        mimeType: fc.mimeType || "application/x-fmu-sharedlibrary",
        fmiType: fc.fmiType || "FMI 3.0 CS",
        ports,
        parameters: fc.parameters ?? [],
      });
    }
  }

  // Extract connections from XML (ensuring all 5 connections are captured) or fallback to viewConfig
  const connections: SspConnectionMeta[] = [];
  if (xml && /<(?:ssd:)?Connection\b/i.test(xml)) {
    const edgeRe = /<(?:ssd:)?Connection\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Connection>)/gi;
    let em: RegExpExecArray | null;
    while ((em = edgeRe.exec(xml)) !== null) {
      const attrs = em[1]!;
      const startElement = getXmlAttr(attrs, "startElement") || "";
      const startConnector = getXmlAttr(attrs, "startConnector") || "";
      const endElement = getXmlAttr(attrs, "endElement") || "";
      const endConnector = getXmlAttr(attrs, "endConnector") || "";
      const srcPort = fmus.find((f) => f.name === startElement)?.ports?.find((p) => p.name === startConnector);
      const tgtPort = fmus.find((f) => f.name === endElement)?.ports?.find((p) => p.name === endConnector);
      const type = srcPort?.type || tgtPort?.type || "Real";
      const unit =
        srcPort?.unit ||
        tgtPort?.unit ||
        (startConnector.endsWith("_W") ? "W" : startConnector.endsWith("_K") ? "K" : undefined);
      connections.push({ startElement, startConnector, endElement, endConnector, type, unit });
    }
  } else if (Array.isArray(viewConfig.connections)) {
    for (const c of viewConfig.connections) {
      const unit =
        c.unit || (c.startConnector.endsWith("_W") ? "W" : c.startConnector.endsWith("_K") ? "K" : undefined);
      connections.push({ ...c, type: c.type || "Real", unit });
    }
  }

  return {
    systemName,
    sspVersion,
    fmiVersion,
    masterAlgorithm,
    communicationStepMs,
    startTime,
    stopTime,
    fmus,
    connections,
    parameterSetNames:
      parameterSetNames.length > 0
        ? parameterSetNames
        : fmus.filter((f) => (f.parameters?.length ?? 0) > 0).map((f) => `${f.name}_Params.ssv`),
  };
}

function synthesizeClientSspSvg(model: ReturnType<typeof parseSsdClientModel>): string {
  const { systemName, sspVersion, masterAlgorithm, communicationStepMs, startTime, stopTime, fmus, connections } =
    model;
  if (fmus.length === 0) return "";
  const W = 980;
  const H = 540;

  const resolveColor = (type?: string, unit?: string) => {
    if (type === "Boolean") return { stroke: "#ec4899", marker: "ssp-arr-pink" };
    if (type === "Integer") return { stroke: "#f97316", marker: "ssp-arr-orange" };
    if (unit === "W" || unit === "kW") return { stroke: "#f59e0b", marker: "ssp-arr-amber" };
    return { stroke: "#38bdf8", marker: "ssp-arr-cyan" };
  };

  const boxes =
    fmus.length === 4
      ? [
          { x: 76, y: 72, w: 242, h: 160 },
          { x: 76, y: 268, w: 242, h: 150 },
          { x: 398, y: 146, w: 258, h: 192 },
          { x: 726, y: 146, w: 218, h: 170 },
        ]
      : fmus.map((_, idx) => {
          const cols = Math.min(3, Math.max(1, fmus.length));
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          return { x: 76 + col * 296, y: 80 + row * 184, w: 242, h: 156 };
        });

  const placed = new Map<
    string,
    {
      comp: SspFmuComponentMeta;
      x: number;
      y: number;
      w: number;
      h: number;
      inPorts: Map<string, { x: number; y: number; port: SspPortMeta }>;
      outPorts: Map<string, { x: number; y: number; port: SspPortMeta }>;
    }
  >();

  fmus.forEach((comp, idx) => {
    const b = boxes[idx] ?? { x: 76, y: 80, w: 240, h: 156 };
    const headerH = 44;
    const paramH = (comp.parameters?.length ?? 0) > 0 ? 44 : 26;
    const portTop = b.y + headerH;
    const portH = Math.max(48, b.h - headerH - paramH);
    const ports = comp.ports ?? [];
    const ins = ports.filter((p) => p.kind === "input");
    const outs = ports.filter((p) => p.kind === "output" || p.kind === "inout");

    const inPorts = new Map<string, { x: number; y: number; port: SspPortMeta }>();
    ins.forEach((p, i) => {
      inPorts.set(p.name, { x: b.x, y: Math.round(portTop + ((i + 1) * portH) / (ins.length + 1)), port: p });
    });

    const outPorts = new Map<string, { x: number; y: number; port: SspPortMeta }>();
    outs.forEach((p, i) => {
      outPorts.set(p.name, { x: b.x + b.w, y: Math.round(portTop + ((i + 1) * portH) / (outs.length + 1)), port: p });
    });

    placed.set(comp.name, { comp, ...b, inPorts, outPorts });
  });

  const orthoPath = (pts: { x: number; y: number }[], r = 7) => {
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
        d.push(
          `L ${Math.round((curr.x - (dx1 / l1) * cr) * 10) / 10} ${Math.round((curr.y - (dy1 / l1) * cr) * 10) / 10} Q ${curr.x} ${curr.y} ${Math.round((curr.x + (dx2 / l2) * cr) * 10) / 10} ${Math.round((curr.y + (dy2 / l2) * cr) * 10) / 10}`,
        );
      }
    }
    const last = pts[pts.length - 1]!;
    d.push(`L ${last.x} ${last.y}`);
    return d.join(" ");
  };

  const connPaths: string[] = [];
  const connLabels: string[] = [];
  const junctions: string[] = [];
  const seenFeedback = new Set<string>();
  let fwdIdx = 0;

  for (const conn of connections) {
    const srcNode = placed.get(conn.startElement);
    const tgtNode = placed.get(conn.endElement);
    const srcPort = srcNode?.outPorts.get(conn.startConnector);
    const tgtPort = tgtNode?.inPorts.get(conn.endConnector);
    if (!srcNode || !tgtNode || !srcPort || !tgtPort) continue;

    const st = resolveColor(conn.type, conn.unit);
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
      if (seenFeedback.has(startKey)) {
        showLabel = false;
        junctions.push(
          `<circle cx="${leftX}" cy="${tgtPort.y}" r="7" fill="${st.stroke}" fill-opacity="0.24" />`,
          `<circle cx="${leftX}" cy="${tgtPort.y}" r="4.2" fill="${st.stroke}" stroke="#0b111e" stroke-width="1.5" />`,
        );
      } else {
        seenFeedback.add(startKey);
      }
    }

    const d = orthoPath(pts, 7);
    connPaths.push(
      `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="5" stroke-opacity="0.14" stroke-linecap="round" stroke-linejoin="round" />`,
      `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${st.marker})" />`,
    );

    if (showLabel) {
      const text = `${conn.startConnector}${conn.unit ? ` [${conn.unit}]` : ""}`;
      const pw = Math.max(72, Math.round(text.length * 5.9 + 14));
      connLabels.push(
        `<g transform="translate(${lx}, ${ly})">` +
          `<rect x="${-Math.round(pw / 2)}" y="-9" width="${pw}" height="17" rx="4" fill="#09101d" fill-opacity="0.93" stroke="${st.stroke}" stroke-width="1" stroke-opacity="0.55" />` +
          `<text x="0" y="3" text-anchor="middle" fill="#e2e8f0" font-size="9.2" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXmlText(text)}</text>` +
          `</g>`,
      );
    }
  }

  const compSvg: string[] = [];
  for (const p of placed.values()) {
    const { comp, x, y, w, h, inPorts, outPorts } = p;
    const shortFmu = comp.source.split("/").pop() || comp.source;
    const headerH = 44;
    const paramH = (comp.parameters?.length ?? 0) > 0 ? 44 : 26;
    const paramTop = y + h - paramH;

    const portItems: string[] = [];
    for (const ip of inPorts.values()) {
      const st = resolveColor(ip.port.type, ip.port.unit);
      const u = ip.port.unit ? ` [${ip.port.unit}]` : "";
      portItems.push(
        `<g transform="translate(${ip.x}, ${ip.y})">` +
          `<polygon points="-6,-5.5 5,0 -6,5.5" fill="${st.stroke}" stroke="#0b111e" stroke-width="1.3" />` +
          `<text x="10" y="3.5" fill="#cbd5e1" font-size="9.8" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXmlText(ip.port.name)}<tspan fill="${st.stroke}" font-weight="700">${escapeXmlText(u)}</tspan></text>` +
          `</g>`,
      );
    }
    for (const op of outPorts.values()) {
      const st = resolveColor(op.port.type, op.port.unit);
      const u = op.port.unit ? ` [${op.port.unit}]` : "";
      portItems.push(
        `<g transform="translate(${op.x}, ${op.y})">` +
          `<polygon points="-4,-5.5 7,0 -4,5.5" fill="#0b111e" stroke="${st.stroke}" stroke-width="1.8" />` +
          `<text x="-9" y="3.5" text-anchor="end" fill="#cbd5e1" font-size="9.8" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXmlText(op.port.name)}<tspan fill="${st.stroke}" font-weight="700">${escapeXmlText(u)}</tspan></text>` +
          `</g>`,
      );
    }

    const paramText =
      (comp.parameters?.length ?? 0) > 0
        ? comp.parameters!.map((pr) => `${pr.name}=${pr.value}${pr.unit ? ` ${pr.unit}` : ""}`).join(" · ")
        : `mime: ${comp.mimeType || "application/x-fmu-sharedlibrary"}`;
    const pillW = Math.min(w - 88, Math.round(shortFmu.length * 5.2 + 12));

    compSvg.push(
      `<g class="ssp-fmu-node" data-fmu="${escapeXmlText(comp.name)}">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#111a2e" stroke="#10b981" stroke-width="1.8" />` +
        `<path d="M ${x + 8} ${y} L ${x + w - 8} ${y} Q ${x + w} ${y} ${x + w} ${y + 8} L ${x + w} ${y + headerH} L ${x} ${y + headerH} L ${x} ${y + 8} Q ${x} ${y} ${x + 8} ${y} Z" fill="url(#ssp-fmu-hdr)" />` +
        `<line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="#10b981" stroke-opacity="0.45" stroke-width="1" />` +
        `<text x="${x + 10}" y="${y + 15}" fill="#34d399" font-size="8.8" font-weight="700" letter-spacing="0.4" font-family="'Inter', system-ui, sans-serif">«FMU 3.0 CS»</text>` +
        `<rect x="${x + w - pillW - 8}" y="${y + 5}" width="${pillW}" height="14" rx="3" fill="#064e3b" fill-opacity="0.75" stroke="#10b981" stroke-opacity="0.4" stroke-width="0.8" />` +
        `<text x="${x + w - 13}" y="${y + 14.5}" text-anchor="end" fill="#a7f3d0" font-size="8.2" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXmlText(shortFmu)}</text>` +
        `<text x="${x + 10}" y="${y + 34}" fill="#f8fafc" font-size="12.5" font-weight="700" font-family="'Inter', system-ui, sans-serif">${escapeXmlText(comp.name)}</text>` +
        `<line x1="${x}" y1="${paramTop}" x2="${x + w}" y2="${paramTop}" stroke="#1e293b" stroke-width="1" />` +
        `<path d="M ${x} ${paramTop} L ${x + w} ${paramTop} L ${x + w} ${y + h - 8} Q ${x + w} ${y + h} ${x + w - 8} ${y + h} L ${x + 8} ${y + h} Q ${x} ${y + h} ${x} ${y + h - 8} Z" fill="#0b1324" fill-opacity="0.85" />` +
        `<text x="${x + 10}" y="${paramTop + 13}" fill="#64748b" font-size="7.8" font-weight="700" letter-spacing="0.5" font-family="'Inter', system-ui, sans-serif">SSV PARAMETERS</text>` +
        `<text x="${x + 10}" y="${paramTop + 27}" fill="#94a3b8" font-size="9" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXmlText(paramText)}</text>` +
        portItems.join("") +
        `</g>`,
    );
  }

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
    `    <tspan fill="#10b981">ssd</tspan> <tspan fill="#94a3b8" font-weight="500">[System]</tspan> ${escapeXmlText(systemName)} <tspan fill="#64748b" font-size="10" font-weight="500">(SSP ${escapeXmlText(sspVersion)} · FMI 3.0 CS)</tspan>`,
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
    ...junctions.map((p) => `    ${p}`),
    `  </g>`,
    `  <g class="ssp-components">`,
    ...compSvg.map((p) => `    ${p}`),
    `  </g>`,
    `  <g class="ssp-labels">`,
    ...connLabels.map((p) => `    ${p}`),
    `  </g>`,
    `  <g transform="translate(26, ${H - 44})">`,
    `    <rect x="0" y="0" width="${W - 52}" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1" />`,
    `    <circle cx="14" cy="12" r="3.5" fill="#10b981" />`,
    `    <text x="24" y="15.5" fill="#94a3b8" font-size="9.5" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">`,
    `      <tspan fill="#10b981" font-weight="700">MASTER:</tspan> ${escapeXmlText(masterAlgorithm)}  ·  <tspan fill="#cbd5e1">DefaultExperiment:</tspan> t = ${startTime.toFixed(1)}s → ${stopTime.toFixed(1)}s (Δt = ${communicationStepMs.toFixed(1)} ms)  ·  <tspan fill="#38bdf8">${fmus.length} FMUs</tspan> · <tspan fill="#f59e0b">${connections.length} Causal Signals</tspan>`,
    `    </text>`,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}

export const SspViewer: React.FC<SspViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [activeTab, setActiveTab] = useState<SspTabMode>("topology");
  const [selectedFmuName, setSelectedFmuName] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const title = viewConfig.title || viewConfig.systemName || "System Structure Package (.ssp)";

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => setRawText(txt))
        .catch((err) => console.warn("[SspViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const ssdModel = useMemo(() => parseSsdClientModel(rawText, viewConfig), [rawText, viewConfig]);

  const sanitizedSvg = useMemo(() => {
    const serverSvg = typeof viewConfig.svg === "string" ? viewConfig.svg.trim() : "";
    // Upgrade legacy 440x280 portless polyglot SVG stubs automatically to full SSP 1.0 schematic
    const isLegacyStub = serverSvg.includes('viewBox="0 0 440 280"') || !serverSvg.includes("ssp-fmu-node");
    const chosenSvg = !serverSvg || isLegacyStub ? synthesizeClientSspSvg(ssdModel) : serverSvg;
    if (!chosenSvg) return "";
    return DOMPurify.sanitize(chosenSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_ATTR: ["target", "marker-end", "marker-start", "data-fmu"],
    });
  }, [viewConfig.svg, ssdModel]);

  const selectedFmu = useMemo(
    () => ssdModel.fmus.find((f) => f.name === selectedFmuName) ?? null,
    [ssdModel.fmus, selectedFmuName],
  );

  const allParameters = useMemo(() => {
    const list: { fmu: string; set: string; name: string; value: string | number; unit?: string | undefined }[] = [];
    for (const fmu of ssdModel.fmus) {
      for (const p of fmu.parameters ?? []) {
        list.push({
          fmu: fmu.name,
          set: `${fmu.name}_Params.ssv`,
          name: p.name,
          value: p.value,
          unit: p.unit,
        });
      }
    }
    return list;
  }, [ssdModel.fmus]);

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current?.moved) return;
    const target = e.target as HTMLElement | null;
    const fmuGroup = target?.closest?.("[data-fmu]") as HTMLElement | null;
    if (fmuGroup) {
      const fmuName = fmuGroup.getAttribute("data-fmu");
      if (fmuName) {
        setSelectedFmuName((prev) => (prev === fmuName ? null : fmuName));
        setShowInspector(true);
      }
    }
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PackageIcon size={16} fill="#10b981" />
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
          <PillBadge $tone="emerald">SSP {ssdModel.sspVersion}</PillBadge>
          <PillBadge $tone="cyan">FMI 3.0 CS</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          <TabGroup>
            <TabButton type="button" $active={activeTab === "topology"} onClick={() => setActiveTab("topology")}>
              <WorkflowIcon size={12} /> Topology
            </TabButton>
            <TabButton type="button" $active={activeTab === "fmus"} onClick={() => setActiveTab("fmus")}>
              <CpuIcon size={12} /> FMUs ({ssdModel.fmus.length})
            </TabButton>
            <TabButton type="button" $active={activeTab === "signals"} onClick={() => setActiveTab("signals")}>
              <GitCommitIcon size={12} /> Signals ({ssdModel.connections.length})
            </TabButton>
            <TabButton type="button" $active={activeTab === "parameters"} onClick={() => setActiveTab("parameters")}>
              <SlidersIcon size={12} /> SSV ({allParameters.length})
            </TabButton>
            <TabButton type="button" $active={activeTab === "xml"} onClick={() => setActiveTab("xml")}>
              <CodeIcon size={12} /> SSD XML
            </TabButton>
            <TabButton
              type="button"
              $active={showInspector}
              onClick={() => setShowInspector((v) => !v)}
              title="Toggle SSP Co-Simulation Inspector"
            >
              Inspector
            </TabButton>
          </TabGroup>

          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "ssp" as any,
                  code: rawText || `<ssd:SystemStructureDescription name="${title}"/>\n`,
                  title,
                });
                const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/playground${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : activeTab === "topology" && sanitizedSvg ? (
          <DiagramStage
            $selectedFmu={selectedFmuName}
            $dragging={dragging}
            onClick={handleStageClick}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false };
              setDragging(true);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
            onPointerMove={(e) => {
              if (!dragRef.current || !dragging) return;
              const dx = e.clientX - dragRef.current.startX;
              const dy = e.clientY - dragRef.current.startY;
              if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
              setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
            }}
            onPointerUp={(e) => {
              if (!dragging) return;
              setDragging(false);
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                padding: "8px 10px 38px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: dragging ? "none" : "transform 0.15s ease",
              }}
              dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
            />

            <StageOverlayBottomLeft onClick={(e) => e.stopPropagation()}>
              <FmuChip type="button" $selected={selectedFmuName === null} onClick={() => setSelectedFmuName(null)}>
                All System ({ssdModel.fmus.length} FMUs)
              </FmuChip>
              {ssdModel.fmus.map((fmu) => (
                <FmuChip
                  key={fmu.name}
                  type="button"
                  $selected={selectedFmuName === fmu.name}
                  onClick={() => {
                    setSelectedFmuName((prev) => (prev === fmu.name ? null : fmu.name));
                    setShowInspector(true);
                  }}
                >
                  {fmu.name}
                </FmuChip>
              ))}
            </StageOverlayBottomLeft>

            <ZoomControls onClick={(e) => e.stopPropagation()}>
              <ZoomBtn type="button" onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.15).toFixed(2))))}>
                −
              </ZoomBtn>
              <ZoomBtn
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                {Math.round(zoom * 100)}%
              </ZoomBtn>
              <ZoomBtn type="button" onClick={() => setZoom((z) => Math.min(2.25, Number((z + 0.15).toFixed(2))))}>
                +
              </ZoomBtn>
            </ZoomControls>
          </DiagramStage>
        ) : activeTab === "fmus" ? (
          <PaneScroll>
            <FmuGrid>
              {ssdModel.fmus.map((fmu) => (
                <FmuCard key={fmu.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: "#34d399", letterSpacing: "0.04em" }}>
                        «{fmu.fmiType || "FMI 3.0 CS"}»
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>{fmu.name}</div>
                    </div>
                    <PillBadge $tone="emerald">{fmu.source}</PillBadge>
                  </div>

                  <div>
                    <SectionHeader>Connectors ({(fmu.ports ?? []).length})</SectionHeader>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {(fmu.ports ?? []).map((pt) => (
                        <div
                          key={pt.name}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "rgba(15, 23, 42, 0.7)",
                            padding: "4px 8px",
                            borderRadius: 4,
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "11px",
                          }}
                        >
                          <span>
                            <span style={{ color: pt.kind === "input" ? "#38bdf8" : "#f59e0b", marginRight: 6 }}>
                              {pt.kind === "input" ? "▶ IN " : "OUT ▶"}
                            </span>
                            {pt.name}
                          </span>
                          <span style={{ color: pt.unit === "W" ? "#fbbf24" : "#38bdf8", fontWeight: 600 }}>
                            {pt.type}
                            {pt.unit ? ` [${pt.unit}]` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(fmu.parameters?.length ?? 0) > 0 && (
                    <div>
                      <SectionHeader>SSV Bound Parameters</SectionHeader>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {fmu.parameters!.map((pr) => (
                          <span
                            key={pr.name}
                            style={{
                              background: "#09101d",
                              border: "1px solid rgba(148, 163, 184, 0.2)",
                              borderRadius: 4,
                              padding: "2px 7px",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: "10.5px",
                              color: "#cbd5e1",
                            }}
                          >
                            <strong style={{ color: "#6ee7b7" }}>{pr.name}</strong> = {pr.value}
                            {pr.unit ? ` ${pr.unit}` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </FmuCard>
              ))}
            </FmuGrid>
          </PaneScroll>
        ) : activeTab === "signals" ? (
          <PaneScroll>
            <SignalTable>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Source FMU · Output Port</th>
                  <th>Target FMU · Input Port</th>
                  <th>SSC Type &amp; Unit</th>
                  <th>Causality Check</th>
                </tr>
              </thead>
              <tbody>
                {ssdModel.connections.map((c, idx) => (
                  <tr key={`${c.startElement}.${c.startConnector}->${c.endElement}.${c.endConnector}-${idx}`}>
                    <td style={{ color: "#64748b" }}>{idx + 1}</td>
                    <td>
                      <span style={{ color: "#34d399", fontWeight: 600 }}>{c.startElement}</span>
                      <span style={{ color: "#64748b" }}>.</span>
                      <span style={{ color: "#f8fafc" }}>{c.startConnector}</span>
                    </td>
                    <td>
                      <span style={{ color: "#38bdf8", fontWeight: 600 }}>{c.endElement}</span>
                      <span style={{ color: "#64748b" }}>.</span>
                      <span style={{ color: "#f8fafc" }}>{c.endConnector}</span>
                    </td>
                    <td>
                      <PillBadge $tone={c.unit === "W" ? "purple" : "cyan"}>
                        ssc:{c.type || "Real"}
                        {c.unit ? ` [${c.unit}]` : ""}
                      </PillBadge>
                    </td>
                    <td style={{ color: "#6ee7b7", fontWeight: 600 }}>✓ Output → Input</td>
                  </tr>
                ))}
              </tbody>
            </SignalTable>
          </PaneScroll>
        ) : activeTab === "parameters" ? (
          <PaneScroll>
            <SignalTable>
              <thead>
                <tr>
                  <th>Parameter Set (.ssv)</th>
                  <th>Component Prefix</th>
                  <th>Parameter Name</th>
                  <th>Value</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {allParameters.map((p, idx) => (
                  <tr key={`${p.fmu}.${p.name}-${idx}`}>
                    <td style={{ color: "#a7f3d0" }}>{p.set}</td>
                    <td style={{ color: "#38bdf8", fontWeight: 600 }}>{p.fmu}</td>
                    <td style={{ color: "#f8fafc", fontWeight: 600 }}>{p.name}</td>
                    <td style={{ color: "#fbbf24" }}>{p.value}</td>
                    <td style={{ color: "#94a3b8" }}>{p.unit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </SignalTable>
          </PaneScroll>
        ) : (
          <Box
            flex={1}
            py={2}
            overflow="auto"
            bg="#070c17"
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "12px",
              lineHeight: 1.55,
              position: "relative",
            }}
          >
            <div style={{ position: "sticky", top: 6, right: 14, float: "right", zIndex: 4, marginRight: 12 }}>
              <Button
                size="small"
                leadingVisual={copied ? CheckIcon : CopyIcon}
                onClick={() => {
                  navigator.clipboard?.writeText(rawText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? "Copied" : "Copy SSD"}
              </Button>
            </div>
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "36px",
                      minWidth: "36px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "#475569",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre", color: "#e2e8f0" }}>{highlightPolyglotLine(line, "ssp")}</span>
                </div>
              ))
            ) : (
              <Box p={4} color="#94a3b8" textAlign="center">
                No SSP/SSD source available.
              </Box>
            )}
          </Box>
        )}

        {showInspector && (
          <InspectorSidebar>
            {selectedFmu ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <SectionHeader>FMU Inspector</SectionHeader>
                  <button
                    type="button"
                    onClick={() => setSelectedFmuName(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#38bdf8",
                      fontSize: "11px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    ← System
                  </button>
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{selectedFmu.name}</div>
                <StatItem>
                  <span>Archive</span>
                  <strong>{selectedFmu.source.split("/").pop()}</strong>
                </StatItem>
                <StatItem>
                  <span>Interface</span>
                  <strong>{selectedFmu.fmiType || "FMI 3.0 CS"}</strong>
                </StatItem>

                <SectionHeader>Ports ({(selectedFmu.ports ?? []).length})</SectionHeader>
                {(selectedFmu.ports ?? []).map((pt) => (
                  <StatItem key={pt.name}>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>
                      <span style={{ color: pt.kind === "input" ? "#38bdf8" : "#f59e0b" }}>
                        {pt.kind === "input" ? "IN " : "OUT "}
                      </span>
                      {pt.name}
                    </span>
                    <strong>{pt.unit ? `${pt.type} [${pt.unit}]` : pt.type}</strong>
                  </StatItem>
                ))}

                {(selectedFmu.parameters?.length ?? 0) > 0 && (
                  <>
                    <SectionHeader>SSV Parameters</SectionHeader>
                    {selectedFmu.parameters!.map((pr) => (
                      <StatItem key={pr.name}>
                        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>{pr.name}</span>
                        <strong>
                          {pr.value}
                          {pr.unit ? ` ${pr.unit}` : ""}
                        </strong>
                      </StatItem>
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                <SectionHeader>Co-Simulation Harness</SectionHeader>
                <StatItem>
                  <span>System</span>
                  <strong>{ssdModel.systemName}</strong>
                </StatItem>
                <StatItem>
                  <span>Standard</span>
                  <strong>SSP {ssdModel.sspVersion} · FMI 3.0</strong>
                </StatItem>
                <StatItem>
                  <span>Master Solver</span>
                  <strong>Gauss-Seidel</strong>
                </StatItem>
                <StatItem>
                  <span>Comm Step (Δt)</span>
                  <strong>{ssdModel.communicationStepMs.toFixed(1)} ms (500 Hz)</strong>
                </StatItem>
                <StatItem>
                  <span>Experiment</span>
                  <strong>
                    {ssdModel.startTime.toFixed(0)}s → {ssdModel.stopTime.toFixed(0)}s
                  </strong>
                </StatItem>
                <StatItem>
                  <span>FMU Instances</span>
                  <strong>{ssdModel.fmus.length}</strong>
                </StatItem>
                <StatItem>
                  <span>Causal Signals</span>
                  <strong>{ssdModel.connections.length}</strong>
                </StatItem>

                <SectionHeader>SSP Archive Contents</SectionHeader>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    background: "rgba(2, 6, 23, 0.55)",
                    border: "1px solid rgba(148, 163, 184, 0.14)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "10.5px",
                  }}
                >
                  <div style={{ color: "#6ee7b7", display: "flex", alignItems: "center", gap: 6 }}>
                    <FileZipIcon size={12} /> SystemStructure.ssd
                  </div>
                  {ssdModel.fmus.map((f) => (
                    <div
                      key={f.name}
                      onClick={() => setSelectedFmuName(f.name)}
                      style={{
                        color: "#cbd5e1",
                        paddingLeft: 10,
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>├─ {f.source}</span>
                      <span style={{ color: "#38bdf8" }}>{(f.ports ?? []).length}p</span>
                    </div>
                  ))}
                  {ssdModel.parameterSetNames.length > 0 && (
                    <div style={{ color: "#fde68a", paddingLeft: 10 }}>
                      └─ resources/{ssdModel.parameterSetNames.length}×.ssv
                    </div>
                  )}
                </div>
              </>
            )}
          </InspectorSidebar>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default SspViewer;
