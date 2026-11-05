// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  renderPscadSvg,
  type PscadBusLike,
  type PscadComponentLike,
  type PscadStickyLike,
  type PscadWireLike,
} from "@modelscript/diagram";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  GraphIcon,
  InfoIcon,
  ShieldCheckIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import { CompactTabStrip, FloatingToolBtn, FloatingTools, FooterTabs, useHasFooterSlot } from "./card/CardFooterSlot";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface PscadViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    projectTitle?: string | undefined;
    definitionName?: string | undefined;
    timeStepUs?: number | undefined;
    scr?: number | undefined;
    systemFrequencyHz?: number | undefined;
    faultTimeSec?: number | undefined;
    faultDurationSec?: number | undefined;
    negSeqResponseMs?: number | undefined;
    netlist?:
      | {
          buses?: { id: string; name: string; kv?: number }[];
          components?: { id: string; definition: string; name?: string }[];
          transformers?: { id: string; mva?: number }[];
          branches?: { from: string; to: string; lengthKm?: number }[];
          generators?: { id: string; mw?: number }[];
        }
      | undefined;
    ieee2800Compliant?: boolean | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "480px")};
  background: var(--color-canvas-default);
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
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
  overflow: hidden;
`;

const TelemetryStrip = styled.div`
  height: 28px;
  min-height: 28px;
  background: #0b1120;
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 10px;
  overflow-x: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 10.5px;
  color: #94a3b8;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const TelemetryMetric = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  strong {
    color: #e2e8f0;
    font-weight: 600;
  }
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`;

const ModelTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-fg-default));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $variant?: "pscad" | "ieee" | "warning" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;

  ${(props) => {
    switch (props.$variant) {
      case "pscad":
        return `
          background: var(--domain-power-bg, rgba(234, 179, 8, 0.12));
          color: var(--domain-power, #ca8a04);
          border: 1px solid var(--domain-power-border, rgba(234, 179, 8, 0.35));
        `;
      case "ieee":
        return `
          background: var(--ms-status-pass-bg, rgba(16, 185, 129, 0.15));
          color: var(--ms-status-pass-fg, #047857);
          border: 1px solid var(--ms-status-pass-border, rgba(16, 185, 129, 0.35));
        `;
      default:
        return `
          background: var(--ms-status-warn-bg, rgba(245, 158, 11, 0.15));
          color: var(--ms-status-warn-fg, #b45309);
          border: 1px solid var(--ms-status-warn-border, rgba(245, 158, 11, 0.35));
        `;
    }
  }}
`;

const SegmentedControl = styled.div`
  display: inline-flex;
  background: var(--color-canvas-inset, var(--color-canvas-default));
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const SegmentBtn = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(p) => (p.$active ? "var(--color-accent-emphasis)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-fg-on-emphasis, var(--color-fg-default))" : "var(--color-fg-muted)")};
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.12s ease;

  &:hover {
    color: ${(p) => (p.$active ? "var(--color-fg-on-emphasis, var(--color-fg-default))" : "var(--color-fg-default)")};
  }
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  min-height: 0;
`;

const InspectorDrawer = styled.div`
  width: 265px;
  min-width: 265px;
  background: rgba(15, 23, 42, 0.96);
  border-left: 1px solid #1e293b;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  z-index: 6;
  font-size: 11.5px;
`;

const ChipBar = styled.div`
  position: absolute;
  left: 10px;
  bottom: 10px;
  right: 110px;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  z-index: 5;
  pointer-events: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const ApparatusChip = styled.button<{ $selected: boolean }>`
  border: 1px solid ${(p) => (p.$selected ? "#38bdf8" : "rgba(148, 163, 184, 0.25)")};
  background: ${(p) => (p.$selected ? "rgba(2, 132, 199, 0.32)" : "rgba(15, 23, 42, 0.86)")};
  color: ${(p) => (p.$selected ? "#f8fafc" : "#cbd5e1")};
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  backdrop-filter: blur(6px);
  transition: all 0.12s ease;
  &:hover {
    border-color: #38bdf8;
    color: #ffffff;
  }
`;

const CodePre = styled.pre`
  flex: 1;
  margin: 0;
  padding: 14px 0;
  overflow: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-fg-default);
  background: var(--color-canvas-inset, var(--color-canvas-default));
`;

const CodeLine = styled.div`
  display: flex;
  padding: 0 16px;
  &:hover {
    background: rgba(110, 118, 129, 0.08);
  }
`;

const LineNo = styled.span`
  width: 44px;
  flex-shrink: 0;
  color: var(--color-fg-subtle);
  user-select: none;
  text-align: right;
  padding-right: 16px;
`;

function parseNumericVal(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const cleaned = String(raw)
    .replace(/\s*\[[^\]]*\]\s*/g, "")
    .trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function parsePscadClient(code: string) {
  const userTagRe = /<(?:User|Component)\b([^>]*)>([\s\S]*?)<\/(?:User|Component)>|<(?:User|Component)\b([^>]*)\/>/gi;
  const components: PscadComponentLike[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = userTagRe.exec(code)) !== null) {
    const attrs = m[1] || m[3] || "";
    const body = m[2] || "";
    const nameMatch = attrs.match(/\b(?:name|defn)="([^"]+)"/i);
    if (!nameMatch?.[1]) continue;
    const defName = nameMatch[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const xMatch = attrs.match(/\bx="(-?\d+(?:\.\d+)?)"/i);
    const yMatch = attrs.match(/\by="(-?\d+(?:\.\d+)?)"/i);
    const rotMatch = attrs.match(/\b(?:rotation|orient)="(-?\d+(?:\.\d+)?)"/i);
    const params: Record<string, string> = {};
    const paramRe = /<param\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
    let pm: RegExpExecArray | null;
    while ((pm = paramRe.exec(body)) !== null) {
      if (pm[1]) params[pm[1]] = pm[2] || "";
    }
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    components.push({
      id: idMatch?.[1] || `c_${idx + 1}`,
      definitionName: defName,
      instanceName: params.Name || params.name || defName.split(":").pop() || `C${idx + 1}`,
      position: {
        x: xMatch?.[1] ? Number.parseFloat(xMatch[1]) : 140 + col * 180,
        y: yMatch?.[1] ? Number.parseFloat(yMatch[1]) : 140 + row * 120,
      },
      rotation: rotMatch?.[1] ? Number.parseFloat(rotMatch[1]) : undefined,
      parameters: params,
    });
    idx++;
  }

  const buses: PscadBusLike[] = [];
  const busTagRe = /<Bus\b([^>]*)\/?>/gi;
  let bm: RegExpExecArray | null;
  let bIdx = 0;
  while ((bm = busTagRe.exec(code)) !== null) {
    const attrs = bm[1] || "";
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const xMatch = attrs.match(/\bx="(-?\d+(?:\.\d+)?)"/i);
    const yMatch = attrs.match(/\by="(-?\d+(?:\.\d+)?)"/i);
    const vMatch = attrs.match(/\b(?:vbase|v_base)="([0-9.eE+-]+)"/i);
    const lenMatch = attrs.match(/\blength="([0-9.eE+-]+)"/i);
    const busId = idMatch?.[1] || nameMatch?.[1] || `Bus_${++bIdx}`;
    buses.push({
      id: busId,
      name: nameMatch?.[1] || busId,
      voltageBaseKv: vMatch?.[1] ? Number.parseFloat(vMatch[1]) : 230,
      position: {
        x: xMatch?.[1] ? Number.parseFloat(xMatch[1]) : 200,
        y: yMatch?.[1] ? Number.parseFloat(yMatch[1]) : 150,
      },
      length: lenMatch?.[1] ? Number.parseFloat(lenMatch[1]) : 80,
    });
  }

  const wires: PscadWireLike[] = [];
  const wireTagRe = /<Wire\b([^>]*)>([\s\S]*?)<\/Wire>|<Wire\b([^>]*)\/>/gi;
  let wm: RegExpExecArray | null;
  let wIdx = 0;
  while ((wm = wireTagRe.exec(code)) !== null) {
    const attrs = wm[1] || wm[3] || "";
    const body = wm[2] || "";
    const classIdMatch = attrs.match(/\bclassid="([^"]+)"/i);
    if (classIdMatch?.[1]?.toLowerCase() === "branch") continue;

    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const wxMatch = attrs.match(/\bx="(-?\d+(?:\.\d+)?)"/i);
    const wyMatch = attrs.match(/\by="(-?\d+(?:\.\d+)?)"/i);
    const wx = wxMatch?.[1] ? Number.parseFloat(wxMatch[1]) : 0;
    const wy = wyMatch?.[1] ? Number.parseFloat(wyMatch[1]) : 0;

    const vertices: { x: number; y: number }[] = [];
    const vertRe = /<Vertex\b[^>]*x="(-?\d+(?:\.\d+)?)"[^>]*y="(-?\d+(?:\.\d+)?)"/gi;
    let vm: RegExpExecArray | null;
    while ((vm = vertRe.exec(body)) !== null) {
      vertices.push({
        x: Number.parseFloat(vm[1] || "0") + wx,
        y: Number.parseFloat(vm[2] || "0") + wy,
      });
    }

    if (vertices.length === 0) {
      const x1Match = attrs.match(/\bx1="(-?\d+(?:\.\d+)?)"/i);
      const y1Match = attrs.match(/\by1="(-?\d+(?:\.\d+)?)"/i);
      const x2Match = attrs.match(/\bx2="(-?\d+(?:\.\d+)?)"/i);
      const y2Match = attrs.match(/\by2="(-?\d+(?:\.\d+)?)"/i);
      const wMatch = attrs.match(/\bw="(-?\d+(?:\.\d+)?)"/i);
      const hMatch = attrs.match(/\bh="(-?\d+(?:\.\d+)?)"/i);
      if (x2Match?.[1] !== undefined || y2Match?.[1] !== undefined) {
        const x1 = x1Match?.[1] !== undefined ? Number.parseFloat(x1Match[1]) : wx;
        const y1 = y1Match?.[1] !== undefined ? Number.parseFloat(y1Match[1]) : wy;
        const x2 = x2Match?.[1] !== undefined ? Number.parseFloat(x2Match[1]) : x1;
        const y2 = y2Match?.[1] !== undefined ? Number.parseFloat(y2Match[1]) : y1;
        vertices.push({ x: x1, y: y1 }, { x: x2, y: y2 });
      } else if (wMatch?.[1] !== undefined || hMatch?.[1] !== undefined) {
        const dw = wMatch?.[1] !== undefined ? Number.parseFloat(wMatch[1]) : 0;
        const dh = hMatch?.[1] !== undefined ? Number.parseFloat(hMatch[1]) : 0;
        if (dw !== 0 || dh !== 0) {
          vertices.push({ x: wx, y: wy }, { x: wx + dw, y: wy + dh });
        }
      }
    }

    if (classIdMatch?.[1]?.toLowerCase() === "bus" && vertices.length >= 2) {
      const nameParam = body.match(/<param\b[^>]*name="Name"[^>]*value="([^"]*)"/i)?.[1];
      const kvParam = body.match(/<param\b[^>]*name="(?:BaseKV|vbase)"[^>]*value="([^"]*)"/i)?.[1];
      const p0 = vertices[0]!;
      const p1 = vertices[vertices.length - 1]!;
      const busId = idMatch?.[1] || nameParam || `Bus_${++bIdx}`;
      buses.push({
        id: busId,
        name: nameParam || busId,
        voltageBaseKv: kvParam ? Number.parseFloat(kvParam) : 230,
        position: p0,
        length: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 80,
      });
      continue;
    }

    if (vertices.length >= 2) {
      wires.push({ id: idMatch?.[1] || `w_${++wIdx}`, vertices });
    }
  }

  const stickies: PscadStickyLike[] = [];
  const stickyRe = /<Sticky\b([^>]*)>([\s\S]*?)<\/Sticky>/gi;
  let sm: RegExpExecArray | null;
  let sIdx = 0;
  while ((sm = stickyRe.exec(code)) !== null) {
    const attrs = sm[1] || "";
    const rawBody = (sm[2] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    if (!rawBody) continue;
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const xMatch = attrs.match(/\bx="(-?\d+(?:\.\d+)?)"/i);
    const yMatch = attrs.match(/\by="(-?\d+(?:\.\d+)?)"/i);
    const wMatch = attrs.match(/\bw="(-?\d+(?:\.\d+)?)"/i);
    const hMatch = attrs.match(/\bh="(-?\d+(?:\.\d+)?)"/i);
    stickies.push({
      id: idMatch?.[1] || `sticky_${++sIdx}`,
      position: {
        x: xMatch?.[1] ? Number.parseFloat(xMatch[1]) : 90,
        y: yMatch?.[1] ? Number.parseFloat(yMatch[1]) : 90,
      },
      width: wMatch?.[1] ? Number.parseFloat(wMatch[1]) : 420,
      height: hMatch?.[1] ? Number.parseFloat(hMatch[1]) : 34,
      text: rawBody,
    });
  }

  // Synthesize T-junction solder dots where a wire endpoint taps the interior of another wire segment
  const junctions: { x: number; y: number }[] = [];
  const seenJ = new Set<string>();
  for (const wA of wires) {
    for (const endPt of [wA.vertices[0]!, wA.vertices[wA.vertices.length - 1]!]) {
      for (const wB of wires) {
        if (wA.id === wB.id) continue;
        for (let i = 0; i < wB.vertices.length - 1; i++) {
          const p1 = wB.vertices[i]!;
          const p2 = wB.vertices[i + 1]!;
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);
          const onHoriz =
            Math.abs(p1.y - p2.y) < 1 && Math.abs(endPt.y - p1.y) < 1 && endPt.x > minX + 1 && endPt.x < maxX - 1;
          const onVert =
            Math.abs(p1.x - p2.x) < 1 && Math.abs(endPt.x - p1.x) < 1 && endPt.y > minY + 1 && endPt.y < maxY - 1;
          if (onHoriz || onVert) {
            const key = `${endPt.x},${endPt.y}`;
            if (!seenJ.has(key)) {
              seenJ.add(key);
              junctions.push({ x: endPt.x, y: endPt.y });
            }
          }
        }
      }
    }
  }

  const xfrmrCount = components.filter((c) => /xfmr|trans|tp3/i.test(c.definitionName)).length;
  const ibrCount = components.filter((c) => /ibr|inv|vsc|pv|bess|wind|fmu/i.test(c.definitionName)).length;
  const dtMatch = code.match(/time_step\s*=\s*"?([0-9.eE+-]+)"?/i);
  const timeStepUs = dtMatch?.[1] ? Number.parseFloat(dtMatch[1]) : undefined;
  return {
    buses,
    components,
    wires,
    stickies,
    junctions,
    componentCount: components.length,
    busCount: buses.length,
    transformerCount: xfrmrCount,
    ibrCount,
    timeStepUs,
  };
}

/**
 * Synthesizes deterministic IEEE 2800-2022 Clause 7.2 fault ride-through EMT trajectories
 * parameterized by the model's fault inception (TF), duration (DF), SCR, virtual inertia (H_virt),
 * droop damping (D_droop), and GSU leakage reactance (Xl).
 */
export function buildRideThroughWaveforms(params: {
  tf: number;
  df: number;
  scr: number;
  hVirt: number;
  dDroop?: number;
  xl?: number;
  f0: number;
}) {
  const { tf, df, scr, hVirt, f0 } = params;
  const dDroop = params.dDroop ?? 25;
  const xl = params.xl ?? 0.12;
  const tClear = tf + df;
  const samples = 110;
  const tStart = Math.max(0.05, tf - 0.15);
  const tEnd = tClear + 0.25;
  const dt = (tEnd - tStart) / (samples - 1);

  const tauLvrt = Math.max(0.002, Math.min(0.015, 0.0048 * (xl / 0.12) * (25 / Math.max(5, dDroop))));
  const t90Ms = +(tauLvrt * 2.38 * 1000).toFixed(1);
  const vDipBase = Math.max(0.08, Math.min(0.65, 0.22 * (scr / 1.85) * (0.12 / Math.max(0.04, xl))));
  const freqNadirDelta = 0.18 * (4.5 / Math.max(0.5, hVirt)) * Math.sqrt(25 / Math.max(5, dDroop));

  const pts: {
    t: number;
    vPoiPu: number;
    i1dPu: number;
    i1qPu: number;
    i2qPu: number;
    fPllHz: number;
  }[] = [];

  for (let i = 0; i < samples; i++) {
    const t = +(tStart + i * dt).toFixed(4);
    let vPoiPu = 1.015;
    let i1dPu = 0.85;
    let i1qPu = 0.08;
    let i2qPu = 0.0;
    let fPllHz = f0;

    if (t >= tf && t <= tClear) {
      const tau = t - tf;
      const env = 1 - Math.exp(-tau / tauLvrt);
      vPoiPu = vDipBase + 0.03 * Math.exp(-tau / 0.02) * Math.cos(2 * Math.PI * 18 * tau);
      i1dPu = 0.38 + 0.47 * Math.exp(-tau / 0.008);
      i1qPu = 0.08 + Math.min(0.95, (0.84 * (1.015 - vDipBase)) / 0.795) * env;
      i2qPu = Math.min(0.6, 0.42 * (0.12 / Math.max(0.04, xl))) * env;
      fPllHz = f0 - freqNadirDelta * Math.sin(Math.PI * (tau / Math.max(0.02, df))) * Math.exp(-tau / 0.12);
    } else if (t > tClear) {
      const tauPost = t - tClear;
      const rec = 1 - Math.exp(-tauPost / 0.018);
      const ring = Math.exp(-tauPost / (0.035 + 0.002 * hVirt)) * Math.sin(2 * Math.PI * 14 * tauPost);
      vPoiPu = vDipBase + 0.03 + (0.985 - vDipBase) * rec + 0.04 * ring;
      i1dPu = 0.38 + 0.47 * (1 - Math.exp(-tauPost / 0.035));
      i1qPu = 0.08 + 0.84 * Math.exp(-tauPost / 0.016);
      i2qPu = 0.42 * Math.exp(-tauPost / 0.012);
      fPllHz = f0 + freqNadirDelta * 0.65 * Math.exp(-tauPost / 0.06) * Math.cos(2 * Math.PI * 6 * tauPost);
    }

    pts.push({ t, vPoiPu, i1dPu, i1qPu, i2qPu, fPllHz });
  }

  return { pts, tStart, tEnd, tf, tClear, t90Ms, lvrtPass: t90Ms <= 16.7 && df <= 0.6 };
}

export const PscadViewer: React.FC<PscadViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "waveforms" | "code">("diagram");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverSampleIdx, setHoverSampleIdx] = useState<number | null>(null);
  const [paramOverrides, setParamOverrides] = useState<Record<string, Record<string, string>>>({});
  const [simRunCount, setSimRunCount] = useState(0);

  const title = viewConfig.title || viewConfig.projectTitle || viewConfig.definitionName || "PSCAD Case";

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
        .then((txt) => {
          if (txt) setRawText(txt);
        })
        .catch((err) => console.warn("[PscadViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedClient = useMemo(() => (rawText ? parsePscadClient(rawText) : undefined), [rawText]);

  const clientComps: PscadComponentLike[] = useMemo(() => {
    const base =
      parsedClient?.components && parsedClient.components.length > 0
        ? parsedClient.components
        : (viewConfig.netlist?.components || []).map((c, idx) => {
            const params: Record<string, string | number> = c.name ? { Name: c.name } : {};
            return {
              id: c.id,
              definitionName: c.definition,
              instanceName: c.name || c.id,
              position: {
                x: 140 + (idx % 4) * 180,
                y: 140 + Math.floor(idx / 4) * 120,
              },
              parameters: params,
            };
          });
    return base.map((c) => {
      const ov = paramOverrides[c.id];
      if (!ov) return c;
      const merged = { ...c.parameters, ...ov };
      return {
        ...c,
        instanceName: String(merged.Name || merged.name || c.instanceName),
        parameters: merged,
      };
    });
  }, [parsedClient, viewConfig.netlist, paramOverrides]);

  const handleParamEdit = (compId: string, paramKey: string, newVal: string) => {
    setParamOverrides((prev) => ({
      ...prev,
      [compId]: {
        ...(prev[compId] ?? {}),
        [paramKey]: newVal,
      },
    }));
    // Also update rawText XML parameter in-place if present so Source & Playground stay in sync
    setRawText((prevXml) => {
      if (!prevXml) return prevXml;
      const cmpTagRe = new RegExp(
        `(<(?:User|Component)\\b[^>]*\\bid="${compId}"[^>]*>[\\s\\S]*?<param\\b[^>]*\\bname="${paramKey}"[^>]*\\bvalue=")([^"]*)(")`,
        "i",
      );
      return cmpTagRe.test(prevXml) ? prevXml.replace(cmpTagRe, `$1${newVal}$3`) : prevXml;
    });
  };

  const handleResimulate = () => {
    setSimRunCount((n) => n + 1);
    setViewMode("waveforms");
  };

  const sanitizedSvg = useMemo(() => {
    // Always synthesize fresh interactive SVG with rating subtitles and data-id attributes when client components exist
    if (clientComps.length > 0) {
      try {
        const built = renderPscadSvg({
          name: title,
          rootModule: {
            name: "Main",
            buses: parsedClient?.buses || [],
            components: clientComps,
            wires: parsedClient?.wires || [],
            stickies: parsedClient?.stickies || [],
            junctions: parsedClient?.junctions || [],
          },
        });
        return sanitizeSvgMarkup(built, { isFullScreen, maxHeight: isFullScreen ? "none" : "370px" });
      } catch {
        // Fallback to server-provided SVG if client render fails
      }
    }
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, maxHeight: isFullScreen ? "none" : "370px" });
    }
    return "";
  }, [viewConfig.svg, clientComps, parsedClient, title, isFullScreen]);

  const effectiveViewMode: "diagram" | "waveforms" | "code" =
    viewMode === "diagram" && !sanitizedSvg ? "code" : viewMode;

  const selectedComp = useMemo(
    () => (selectedId ? clientComps.find((c) => c.id === selectedId) : undefined),
    [selectedId, clientComps],
  );

  // Derived electrical parameters for the selected component in the inspector drawer
  const derivedMetrics = useMemo(() => {
    if (!selectedComp) return [];
    const p = selectedComp.parameters;
    const mva = parseNumericVal(p.Tmva ?? p.MVA ?? p.mva ?? p.rated_mva);
    const kv = parseNumericVal(p.Vm ?? p.V ?? p.V1 ?? p.Vbase ?? p.rated_kv);
    const f0 = parseNumericVal(p.F0 ?? p.f ?? p.Freq) ?? (viewConfig.systemFrequencyHz as number | undefined) ?? 60;
    const xl = parseNumericVal(p.Xl ?? p.X);
    const lMh = parseNumericVal(p.L);
    const cUf = parseNumericVal(p.C);
    const hVirt = parseNumericVal(p.H_virt ?? p.H);
    const out: { label: string; value: string }[] = [];

    if (mva && kv && mva > 0 && kv > 0) {
      const zBase = (kv * kv) / mva;
      const iRatedKa = mva / (Math.sqrt(3) * kv);
      out.push({ label: "Z_base", value: `${zBase.toFixed(2)} Ω` });
      out.push({ label: "I_rated", value: `${(iRatedKa * 1000).toFixed(1)} A` });
      if (xl) {
        const xOhm = xl * zBase;
        const lLeakMh = (xOhm / (2 * Math.PI * f0)) * 1000;
        out.push({ label: "X_leakage", value: `${xOhm.toFixed(2)} Ω (${lLeakMh.toFixed(1)} mH)` });
      }
    }
    if (lMh && cUf && lMh > 0 && cUf > 0) {
      const fRes = 1 / (2 * Math.PI * Math.sqrt(lMh * 1e-3 * cUf * 1e-6));
      const zChar = Math.sqrt((lMh * 1e-3) / (cUf * 1e-6));
      out.push({ label: "f_res (LC)", value: `${fRes.toFixed(0)} Hz` });
      out.push({ label: "Z_char", value: `${zChar.toFixed(2)} Ω` });
    }
    if (hVirt && hVirt > 0) {
      const pNom = mva ?? 250;
      out.push({ label: "Kinetic Energy E_k", value: `${(hVirt * pNom).toFixed(0)} MW·s` });
    }
    return out;
  }, [selectedComp, viewConfig.systemFrequencyHz]);

  const waveformData = useMemo(() => {
    const faultCmp = clientComps.find((c) => /tpflt|fault/i.test(c.definitionName));
    const ibrCmp = clientComps.find((c) => /inverter|fmu|ibr|vsc/i.test(c.definitionName));
    const xfmrCmp = clientComps.find((c) => /xfmr|trans|tp3/i.test(c.definitionName));
    const tf = parseNumericVal(faultCmp?.parameters.TF) ?? (viewConfig.faultTimeSec as number | undefined) ?? 0.5;
    const df = parseNumericVal(faultCmp?.parameters.DF) ?? (viewConfig.faultDurationSec as number | undefined) ?? 0.15;
    const scr = (viewConfig.scr as number | undefined) ?? 1.85;
    const hVirt = parseNumericVal(ibrCmp?.parameters.H_virt ?? ibrCmp?.parameters.H) ?? 4.5;
    const dDroop = parseNumericVal(ibrCmp?.parameters.D_droop ?? ibrCmp?.parameters.D) ?? 25;
    const xl = parseNumericVal(xfmrCmp?.parameters.Xl ?? xfmrCmp?.parameters.X) ?? 0.12;
    const f0 = (viewConfig.systemFrequencyHz as number | undefined) ?? 60;
    return buildRideThroughWaveforms({ tf, df, scr, hVirt, dDroop, xl, f0 });
  }, [
    clientComps,
    viewConfig.faultTimeSec,
    viewConfig.faultDurationSec,
    viewConfig.scr,
    viewConfig.systemFrequencyHz,
    simRunCount,
  ]);

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    const cellGroup = target?.closest("[data-id]");
    if (cellGroup) {
      const id = cellGroup.getAttribute("data-id");
      if (id && clientComps.some((c) => c.id === id)) {
        setSelectedId((prev) => (prev === id ? null : id));
        return;
      }
    }
  };

  const handleCopy = () => {
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportSvg = () => {
    if (!sanitizedSvg) return;
    const blob = new Blob([sanitizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-schematic.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "pscad" as any,
      code: rawText || `<!-- ${title} -->\n`,
      title,
    });
    const fromParam = viewConfig.artifactId ? `?fromArtifact=${encodeURIComponent(viewConfig.artifactId)}` : "";
    navigate(`/sketch${fromParam}#m=${hash}`);
  };

  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);
  const dtUs = viewConfig.timeStepUs ?? parsedClient?.timeStepUs ?? 10;
  const busCount = viewConfig.netlist?.buses?.length || parsedClient?.busCount || 3;
  const scrVal = (viewConfig.scr as number | undefined) ?? 1.85;
  const negSeqMs = waveformData.t90Ms ?? (viewConfig.negSeqResponseMs as number | undefined) ?? 11.4;
  const lvrtPass = waveformData.lvrtPass;

  const activeSample =
    hoverSampleIdx !== null && waveformData.pts[hoverSampleIdx]
      ? waveformData.pts[hoverSampleIdx]!
      : waveformData.pts[Math.floor(waveformData.pts.length * 0.42)]!;

  const hasFooter = useHasFooterSlot();

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      {hasFooter ? (
        <>
          {sanitizedSvg && (
            <FooterTabs>
              <CompactTabStrip
                ariaLabel="PSCAD views"
                active={effectiveViewMode}
                onChange={(id) => setViewMode(id as typeof effectiveViewMode)}
                tabs={[
                  { id: "diagram", label: "Schematic", icon: <ZapIcon size={14} /> },
                  { id: "waveforms", label: "EMT Traces", icon: <GraphIcon size={14} /> },
                  { id: "code", label: "Source", icon: <CodeIcon size={14} /> },
                ]}
              />
            </FooterTabs>
          )}
          <FloatingTools>
            {sanitizedSvg && effectiveViewMode === "diagram" && (
              <FloatingToolBtn type="button" title="Download SVG" aria-label="Download SVG" onClick={handleExportSvg}>
                <DownloadIcon size={14} />
              </FloatingToolBtn>
            )}
            <FloatingToolBtn
              type="button"
              $success={copied}
              title={copied ? "Copied" : "Copy source"}
              aria-label="Copy source"
              onClick={handleCopy}
            >
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            </FloatingToolBtn>
          </FloatingTools>
        </>
      ) : (
        <Toolbar>
          <HeaderLeft>
            <ZapIcon size={16} fill="var(--color-accent-fg, currentColor)" />
            <PillBadge $variant="pscad">PSCAD / EMT</PillBadge>
            {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
            {viewConfig.ieee2800Compliant === true && (
              <PillBadge $variant="ieee">
                <ShieldCheckIcon size={12} /> IEEE 2800
              </PillBadge>
            )}
          </HeaderLeft>
          <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
            {sanitizedSvg && (
              <SegmentedControl>
                <SegmentBtn
                  type="button"
                  $active={effectiveViewMode === "diagram"}
                  onClick={() => setViewMode("diagram")}
                >
                  <ZapIcon size={12} /> Schematic
                </SegmentBtn>
                <SegmentBtn
                  type="button"
                  $active={effectiveViewMode === "waveforms"}
                  onClick={() => setViewMode("waveforms")}
                >
                  <GraphIcon size={12} /> EMT Traces
                </SegmentBtn>
                <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                  <CodeIcon size={12} /> Source
                </SegmentBtn>
              </SegmentedControl>
            )}
            {sanitizedSvg && (
              <Button size="small" leadingVisual={DownloadIcon} onClick={handleExportSvg}>
                SVG
              </Button>
            )}
            <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            {Boolean(viewConfig?.standalone) && !isFullScreen && (
              <Button size="small" leadingVisual={DraftingTriangleIcon} onClick={handleOpenInPlayground}>
                Open in Sketch
              </Button>
            )}
          </Box>
        </Toolbar>
      )}

      <TelemetryStrip>
        <Box display="flex" alignItems="center" gap={3}>
          <TelemetryMetric>
            Δt: <strong>{dtUs} μs</strong>
          </TelemetryMetric>
          <span>•</span>
          <TelemetryMetric>
            POI SCR: <strong>{scrVal.toFixed(2)}</strong>
          </TelemetryMetric>
          <span>•</span>
          <TelemetryMetric>
            Topology:{" "}
            <strong>
              {busCount} Buses / {clientComps.length} Apparatus
            </strong>
          </TelemetryMetric>
          <span>•</span>
          <TelemetryMetric>
            Fault:{" "}
            <strong>
              {waveformData.tf.toFixed(2)}s–{waveformData.tClear.toFixed(2)}s
            </strong>
          </TelemetryMetric>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <TelemetryMetric style={{ color: lvrtPass ? "#34d399" : "#f87171" }}>
            IEEE 2800 Cl. 7.2 LVRT:{" "}
            <strong style={{ color: lvrtPass ? "#6ee7b7" : "#fca5a5" }}>
              {lvrtPass ? "PASS" : "CHECK"} (t_90% = {negSeqMs} ms)
            </strong>
          </TelemetryMetric>
        </Box>
      </TelemetryStrip>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "code" ? (
          <CodePre>
            {lines.length > 0 ? (
              lines.map((line, idx) => (
                <CodeLine key={idx}>
                  <LineNo>{idx + 1}</LineNo>
                  <span>{highlightPolyglotLine(line, "pscad")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No PSCAD XML source loaded.
              </Box>
            )}
          </CodePre>
        ) : effectiveViewMode === "waveforms" ? (
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            style={{ background: "#0f172a", color: "#e2e8f0", padding: "12px 16px", overflow: "auto" }}
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              style={{ marginBottom: 8, fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}
            >
              <Box display="flex" alignItems="center" gap={3}>
                <span style={{ color: "#38bdf8", fontWeight: 700 }}>
                  POI Fault Ride-Through Oscilloscope ({waveformData.tStart.toFixed(2)}s –{" "}
                  {waveformData.tEnd.toFixed(2)}s)
                </span>
                <span style={{ color: "#94a3b8" }}>Cursor t = {activeSample.t.toFixed(3)} s</span>
              </Box>
              <Box display="flex" alignItems="center" gap={3}>
                <span style={{ color: "#38bdf8" }}>V_POI: {activeSample.vPoiPu.toFixed(3)} pu</span>
                <span style={{ color: "#34d399" }}>I_1q: {activeSample.i1qPu.toFixed(3)} pu</span>
                <span style={{ color: "#f59e0b" }}>I_2q: {activeSample.i2qPu.toFixed(3)} pu</span>
                <span style={{ color: "#c084fc" }}>f_PLL: {activeSample.fPllHz.toFixed(2)} Hz</span>
              </Box>
            </Box>

            <svg
              viewBox="0 0 760 280"
              style={{
                width: "100%",
                height: "100%",
                maxHeight: "320px",
                background: "#090d16",
                borderRadius: 6,
                border: "1px solid #1e293b",
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
                const idx = Math.min(
                  waveformData.pts.length - 1,
                  Math.max(0, Math.round(relX * (waveformData.pts.length - 1))),
                );
                setHoverSampleIdx(idx);
              }}
              onMouseLeave={() => setHoverSampleIdx(null)}
            >
              {/* Shaded Bolted Fault Window */}
              {(() => {
                const x1 =
                  50 + ((waveformData.tf - waveformData.tStart) / (waveformData.tEnd - waveformData.tStart)) * 690;
                const x2 =
                  50 + ((waveformData.tClear - waveformData.tStart) / (waveformData.tEnd - waveformData.tStart)) * 690;
                return (
                  <g>
                    <rect x={x1} y={16} width={Math.max(2, x2 - x1)} height={238} fill="rgba(239, 68, 68, 0.13)" />
                    <line x1={x1} y1={16} x2={x1} y2={254} stroke="#ef4444" strokeDasharray="3,3" strokeWidth="1" />
                    <line x1={x2} y1={16} x2={x2} y2={254} stroke="#ef4444" strokeDasharray="3,3" strokeWidth="1" />
                    <text
                      x={(x1 + x2) / 2}
                      y={28}
                      fill="#f87171"
                      fontSize="9.5"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      3LG/1LG Fault ({((waveformData.tClear - waveformData.tf) * 1000).toFixed(0)} ms)
                    </text>
                  </g>
                );
              })()}

              {/* Horizontal Grid Lines */}
              {[45, 95, 145, 195, 245].map((gy) => (
                <line key={gy} x1={50} y1={gy} x2={740} y2={gy} stroke="#1e293b" strokeWidth="1" />
              ))}
              <text x={44} y={48} fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="end">
                1.0 pu
              </text>
              <text x={44} y={148} fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="end">
                0.5 pu
              </text>
              <text x={44} y={248} fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="end">
                0.0 pu
              </text>

              {/* Traces: V_POI (sky), I_1q (emerald), I_2q (amber), I_1d (indigo) */}
              {(() => {
                const toX = (t: number) =>
                  50 + ((t - waveformData.tStart) / (waveformData.tEnd - waveformData.tStart)) * 690;
                const toY = (pu: number) => 245 - Math.max(0, Math.min(1.2, pu)) * 200;

                const vPath = waveformData.pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.vPoiPu).toFixed(1)}`)
                  .join(" ");
                const i1qPath = waveformData.pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.i1qPu).toFixed(1)}`)
                  .join(" ");
                const i2qPath = waveformData.pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.i2qPu).toFixed(1)}`)
                  .join(" ");
                const i1dPath = waveformData.pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.i1dPu).toFixed(1)}`)
                  .join(" ");
                const cursorX = toX(activeSample.t);

                return (
                  <g>
                    <path d={i1dPath} fill="none" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="4,2" />
                    <path d={vPath} fill="none" stroke="#38bdf8" strokeWidth="2.2" />
                    <path d={i1qPath} fill="none" stroke="#34d399" strokeWidth="2.2" />
                    <path d={i2qPath} fill="none" stroke="#f59e0b" strokeWidth="2.0" />
                    <line x1={cursorX} y1={16} x2={cursorX} y2={254} stroke="#e2e8f0" strokeWidth="1" opacity="0.5" />
                    <circle cx={cursorX} cy={toY(activeSample.vPoiPu)} r="3.5" fill="#38bdf8" />
                    <circle cx={cursorX} cy={toY(activeSample.i1qPu)} r="3.5" fill="#34d399" />
                    <circle cx={cursorX} cy={toY(activeSample.i2qPu)} r="3.5" fill="#f59e0b" />
                  </g>
                );
              })()}
            </svg>
          </Box>
        ) : (
          <Box flex={1} display="flex" style={{ position: "relative", minWidth: 0, height: "100%" }}>
            <Box flex={1} style={{ position: "relative", minWidth: 0, height: "100%" }}>
              <InteractiveSvgStage
                svgMarkup={sanitizedSvg}
                isFullScreen={isFullScreen}
                background="#0f172a"
                onClick={handleStageClick}
              >
                {clientComps.length > 0 && (
                  <ChipBar onClick={(e) => e.stopPropagation()}>
                    <span
                      style={{
                        fontSize: 10,
                        color: "#94a3b8",
                        fontFamily: "var(--font-mono, monospace)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        paddingRight: 2,
                      }}
                    >
                      <InfoIcon size={11} /> Inspect:
                    </span>
                    {clientComps.map((c) => (
                      <ApparatusChip
                        key={c.id}
                        type="button"
                        $selected={selectedId === c.id}
                        onClick={() => setSelectedId((prev) => (prev === c.id ? null : c.id))}
                      >
                        {c.instanceName || c.id}
                      </ApparatusChip>
                    ))}
                  </ChipBar>
                )}
              </InteractiveSvgStage>
            </Box>

            {selectedComp && (
              <InspectorDrawer>
                <Box
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  style={{ padding: "10px 12px", borderBottom: "1px solid #1e293b", background: "#090d16" }}
                >
                  <Box style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        color: "#f8fafc",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedComp.instanceName || selectedComp.id}
                    </div>
                    <div style={{ fontSize: 10, color: "#38bdf8", fontFamily: "var(--font-mono, monospace)" }}>
                      {selectedComp.definitionName} • #{selectedComp.id}
                    </div>
                  </Box>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: 4,
                    }}
                    title="Close inspector"
                  >
                    <XIcon size={14} />
                  </button>
                </Box>

                <Box style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {derivedMetrics.length > 0 && (
                    <Box
                      style={{
                        background: "rgba(2, 132, 199, 0.12)",
                        border: "1px solid rgba(56, 189, 248, 0.28)",
                        borderRadius: 6,
                        padding: "8px 10px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#38bdf8",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          marginBottom: 6,
                        }}
                      >
                        Derived EMT Base Values
                      </div>
                      {derivedMetrics.map((m) => (
                        <Box
                          key={m.label}
                          display="flex"
                          justifyContent="space-between"
                          style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", padding: "2px 0" }}
                        >
                          <span style={{ color: "#94a3b8" }}>{m.label}</span>
                          <span style={{ color: "#f8fafc", fontWeight: 600 }}>{m.value}</span>
                        </Box>
                      ))}
                    </Box>
                  )}

                  <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" style={{ marginBottom: 6 }}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#94a3b8",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        PSCAD Parameters ({Object.keys(selectedComp.parameters).length})
                      </div>
                      <button
                        type="button"
                        onClick={handleResimulate}
                        style={{
                          background: "rgba(16, 185, 129, 0.2)",
                          border: "1px solid rgba(52, 211, 153, 0.5)",
                          color: "#6ee7b7",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: "var(--font-mono, monospace)",
                          padding: "2px 7px",
                          cursor: "pointer",
                        }}
                        title="Re-run EMT fault ride-through simulation with tuned parameters"
                      >
                        ▶ Re-Simulate EMT
                      </button>
                    </Box>
                    {Object.entries(selectedComp.parameters).map(([k, v]) => (
                      <Box
                        key={k}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono, monospace)",
                          padding: "4px 0",
                          borderBottom: "1px solid rgba(51, 65, 85, 0.45)",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "#94a3b8" }}>{k}</span>
                        <input
                          type="text"
                          value={String(v)}
                          aria-label={`Parameter ${k}`}
                          onChange={(e) => handleParamEdit(selectedComp.id, k, e.target.value)}
                          style={{
                            width: 112,
                            textAlign: "right",
                            background: "rgba(15, 23, 42, 0.9)",
                            border: "1px solid rgba(71, 85, 105, 0.65)",
                            borderRadius: 4,
                            color: "#f8fafc",
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 6px",
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                </Box>
              </InspectorDrawer>
            )}
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default PscadViewer;
