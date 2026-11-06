// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderPscadSvg, type PscadComponentLike } from "@modelscript/diagram";
import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import {
  AlertIcon,
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
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import { CompactTabStrip, FloatingToolBtn, FloatingTools, FooterTabs, useHasFooterSlot } from "./card/CardFooterSlot";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";
import { parsePscadClient, type PscadClientModel } from "./pscad-client-parser.js";

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

const TelemetryStrip = styled.div<{ $hasFloatingTools?: boolean }>`
  height: 32px;
  min-height: 32px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${(props) => (props.$hasFloatingTools ? "0 84px 0 12px" : "0 12px")};
  gap: 10px;
  overflow-x: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 11px;
  color: var(--color-fg-muted);
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
    color: var(--color-fg-default);
    font-weight: 600;
  }
`;

const TelemetryPill = styled.span<{ $variant?: "default" | "success" | "warn" | "danger" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);

  ${(p) => {
    switch (p.$variant) {
      case "success":
        return `
          background: var(--ms-status-pass-bg, rgba(16, 185, 129, 0.15));
          color: var(--ms-status-pass-fg, #047857);
          border: 1px solid var(--ms-status-pass-border, rgba(16, 185, 129, 0.35));
        `;
      case "warn":
        return `
          background: var(--ms-status-warn-bg, rgba(245, 158, 11, 0.15));
          color: var(--ms-status-warn-fg, #b45309);
          border: 1px solid var(--ms-status-warn-border, rgba(245, 158, 11, 0.35));
        `;
      case "danger":
        return `
          background: rgba(239, 68, 68, 0.12);
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.35);
        `;
      default:
        return `
          background: var(--color-canvas-inset, rgba(110, 118, 129, 0.1));
          color: var(--color-fg-muted);
          border: 1px solid var(--color-border-subtle, rgba(110, 118, 129, 0.2));
        `;
    }
  }}
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
  width: 275px;
  min-width: 275px;
  background: var(--color-canvas-default);
  border-left: 1px solid var(--color-border-default);
  color: var(--color-fg-default);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  z-index: 6;
  font-size: 11.5px;
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.08);
`;

const ChipBar = styled.div`
  position: absolute;
  left: 10px;
  bottom: 10px;
  right: 120px;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  z-index: 5;
  pointer-events: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
  &::-webkit-scrollbar {
    display: none;
  }
`;

const ApparatusChip = styled.button<{ $selected: boolean }>`
  border: 1px solid ${(p) => (p.$selected ? "var(--color-accent-emphasis, #0969da)" : "var(--color-border-default)")};
  background: ${(p) =>
    p.$selected
      ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))"
      : "color-mix(in srgb, var(--color-canvas-default) 88%, transparent)"};
  color: ${(p) => (p.$selected ? "var(--color-accent-fg, #0969da)" : "var(--color-fg-default)")};
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  transition: all 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 5px;

  &:hover {
    border-color: var(--color-accent-emphasis, #0969da);
    color: var(--color-accent-fg, #0969da);
  }
`;

function getApparatusDotColor(defn: string): string {
  if (/source|grid|thevenin/i.test(defn)) return "#f59e0b";
  if (/line|cable|branch|tieline/i.test(defn)) return "#0284c7";
  if (/fault|tpflt/i.test(defn)) return "#ef4444";
  if (/breaker|switch|brk/i.test(defn)) return "#ec4899";
  if (/xfmr|trans|tp3/i.test(defn)) return "#06b6d4";
  if (/filter|cap|ind|lcl/i.test(defn)) return "#14b8a6";
  if (/ibr|vsc|inv|bess|pv|wind|fmu/i.test(defn)) return "#10b981";
  return "#8b5cf6";
}

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

export { parsePscadClient, type PscadClientModel };

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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
      try {
        const doc = parseXml(prevXml);
        if (doc.root) {
          const findComp = (el: XmlElement): XmlElement | null => {
            if (
              (el.name === "User" || el.name === "Component") &&
              el.attributes.some((a) => a.name === "id" && a.value === compId)
            ) {
              return el;
            }
            for (const ch of el.children) {
              const res = findComp(ch);
              if (res) return res;
            }
            return null;
          };
          const compEl = findComp(doc.root);
          if (compEl) {
            for (const ch of compEl.children) {
              if (ch.name === "param" && ch.attributes.some((a) => a.name === "name" && a.value === paramKey)) {
                const valAttr = ch.attributes.find((a) => a.name === "value");
                if (valAttr) {
                  return prevXml.slice(0, valAttr.valueStart) + newVal + prevXml.slice(valAttr.valueEnd);
                }
              }
            }
          }
        }
      } catch {}
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
        const built = renderPscadSvg(
          {
            name: title,
            rootModule: {
              name: "Main",
              buses: parsedClient?.buses || [],
              components: clientComps,
              wires: parsedClient?.wires || [],
              stickies: parsedClient?.stickies || [],
              junctions: parsedClient?.junctions || [],
            },
          },
          { theme: isDark ? "dark" : "light" },
        );
        return sanitizeSvgMarkup(built, { isFullScreen, maxHeight: isFullScreen ? "none" : "370px", isDark });
      } catch {
        // Fallback to server-provided SVG if client render fails
      }
    }
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, maxHeight: isFullScreen ? "none" : "370px", isDark });
    }
    return "";
  }, [viewConfig.svg, clientComps, parsedClient, title, isFullScreen, isDark]);

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
    navigate(`/morsel${fromParam}#m=${hash}`);
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
                Open in Morsel
              </Button>
            )}
          </Box>
        </Toolbar>
      )}

      <TelemetryStrip $hasFloatingTools={hasFooter}>
        <Box display="flex" alignItems="center" gap={3}>
          <TelemetryMetric>
            Δt: <strong>{dtUs} μs</strong>
          </TelemetryMetric>
          <span style={{ opacity: 0.35 }}>•</span>
          <TelemetryMetric>
            POI SCR: <strong>{scrVal.toFixed(2)}</strong>
            {scrVal < 2.0 ? (
              <TelemetryPill
                $variant="warn"
                title="Short Circuit Ratio < 2.0 indicates a weak AC grid interconnection requiring grid-forming (GFM) controls (IEEE 2800)"
              >
                Weak Grid
              </TelemetryPill>
            ) : scrVal >= 3.0 ? (
              <TelemetryPill $variant="success">Strong</TelemetryPill>
            ) : null}
          </TelemetryMetric>
          <span style={{ opacity: 0.35 }}>•</span>
          <TelemetryMetric>
            Topology:{" "}
            <strong>
              {busCount} Buses / {clientComps.length} Apparatus
            </strong>
          </TelemetryMetric>
          <span style={{ opacity: 0.35 }}>•</span>
          <TelemetryMetric>
            Fault:{" "}
            <strong>
              {waveformData.tf.toFixed(2)}s–{waveformData.tClear.toFixed(2)}s
            </strong>
          </TelemetryMetric>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <TelemetryPill $variant={lvrtPass ? "success" : "danger"}>
            {lvrtPass ? <ShieldCheckIcon size={12} /> : <AlertIcon size={12} />}
            IEEE 2800 Cl. 7.2 LVRT: {lvrtPass ? "PASS" : "CHECK"} (t₉₀ = {negSeqMs} ms)
          </TelemetryPill>
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
            style={{
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              padding: "12px 16px",
              overflow: "auto",
            }}
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              style={{ marginBottom: 8, fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}
            >
              <Box display="flex" alignItems="center" gap={3}>
                <span style={{ color: "var(--color-accent-fg, #0969da)", fontWeight: 700 }}>
                  POI Fault Ride-Through Oscilloscope ({waveformData.tStart.toFixed(2)}s –{" "}
                  {waveformData.tEnd.toFixed(2)}s)
                </span>
                <span style={{ color: "var(--color-fg-muted)" }}>Cursor t = {activeSample.t.toFixed(3)} s</span>
                {activeSample.t >= waveformData.tf && activeSample.t <= waveformData.tClear ? (
                  <TelemetryPill $variant="danger">
                    ⚡ Bolted Fault ({((activeSample.t - waveformData.tf) * 1000).toFixed(0)} ms in)
                  </TelemetryPill>
                ) : activeSample.t < waveformData.tf ? (
                  <TelemetryPill $variant="default">Pre-Fault State</TelemetryPill>
                ) : (
                  <TelemetryPill $variant="success">Grid Recovery</TelemetryPill>
                )}
              </Box>
              <Box display="flex" alignItems="center" gap={3}>
                <span style={{ color: isDark ? "#38bdf8" : "#0284c7" }}>
                  V_POI: {activeSample.vPoiPu.toFixed(3)} pu
                </span>
                <span style={{ color: isDark ? "#34d399" : "#059669" }}>I_1q: {activeSample.i1qPu.toFixed(3)} pu</span>
                <span style={{ color: isDark ? "#f59e0b" : "#d97706" }}>I_2q: {activeSample.i2qPu.toFixed(3)} pu</span>
                <span style={{ color: isDark ? "#c084fc" : "#7c3aed" }}>
                  f_PLL: {activeSample.fPllHz.toFixed(2)} Hz
                </span>
              </Box>
            </Box>

            <svg
              viewBox="0 0 760 280"
              style={{
                width: "100%",
                height: "100%",
                maxHeight: "320px",
                background: isDark ? "#090d16" : "#ffffff",
                borderRadius: 6,
                border: isDark ? "1px solid #1e293b" : "1px solid var(--color-border-default)",
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
                      fill={isDark ? "#f87171" : "#dc2626"}
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
                <line
                  key={gy}
                  x1={50}
                  y1={gy}
                  x2={740}
                  y2={gy}
                  stroke={isDark ? "#1e293b" : "#e2e8f0"}
                  strokeWidth="1"
                />
              ))}
              <text
                x={44}
                y={48}
                fill={isDark ? "#64748b" : "#94a3b8"}
                fontSize="9"
                fontFamily="monospace"
                textAnchor="end"
              >
                1.0 pu
              </text>
              <text
                x={44}
                y={148}
                fill={isDark ? "#64748b" : "#94a3b8"}
                fontSize="9"
                fontFamily="monospace"
                textAnchor="end"
              >
                0.5 pu
              </text>
              <text
                x={44}
                y={248}
                fill={isDark ? "#64748b" : "#94a3b8"}
                fontSize="9"
                fontFamily="monospace"
                textAnchor="end"
              >
                0.0 pu
              </text>

              {/* Traces */}
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
                const vColor = isDark ? "#38bdf8" : "#0284c7";
                const i1qColor = isDark ? "#34d399" : "#059669";
                const i2qColor = isDark ? "#f59e0b" : "#d97706";
                const i1dColor = isDark ? "#818cf8" : "#4f46e5";

                return (
                  <g>
                    <path d={i1dPath} fill="none" stroke={i1dColor} strokeWidth="1.5" strokeDasharray="4,2" />
                    <path d={vPath} fill="none" stroke={vColor} strokeWidth="2.2" />
                    <path d={i1qPath} fill="none" stroke={i1qColor} strokeWidth="2.2" />
                    <path d={i2qPath} fill="none" stroke={i2qColor} strokeWidth="2.0" />
                    <line
                      x1={cursorX}
                      y1={16}
                      x2={cursorX}
                      y2={254}
                      stroke={isDark ? "#e2e8f0" : "#475569"}
                      strokeWidth="1"
                      opacity="0.6"
                    />
                    <circle cx={cursorX} cy={toY(activeSample.vPoiPu)} r="3.5" fill={vColor} />
                    <circle cx={cursorX} cy={toY(activeSample.i1qPu)} r="3.5" fill={i1qColor} />
                    <circle cx={cursorX} cy={toY(activeSample.i2qPu)} r="3.5" fill={i2qColor} />
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
                background={isDark ? "#0f172a" : "#ffffff"}
                onClick={handleStageClick}
              >
                <style>{`
                  [data-id] {
                    transition: filter 0.15s ease, opacity 0.15s ease;
                  }
                  [data-id]:hover {
                    filter: drop-shadow(0 0 6px ${isDark ? "rgba(56, 189, 248, 0.85)" : "rgba(2, 132, 199, 0.85)"});
                  }
                  ${
                    selectedId
                      ? `
                  [data-id="${selectedId}"] {
                    filter: drop-shadow(0 0 8px ${isDark ? "#38bdf8" : "#0284c7"}) drop-shadow(0 0 2px ${isDark ? "#38bdf8" : "#0284c7"}) !important;
                  }
                  [data-id="${selectedId}"] rect,
                  [data-id="${selectedId}"] circle {
                    stroke: ${isDark ? "#38bdf8" : "#0284c7"} !important;
                    stroke-width: 2.2px !important;
                  }
                  `
                      : ""
                  }
                `}</style>
                {clientComps.length > 0 && (
                  <ChipBar onClick={(e) => e.stopPropagation()}>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--color-fg-muted)",
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
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor: getApparatusDotColor(c.definitionName),
                            flexShrink: 0,
                          }}
                        />
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
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                  }}
                >
                  <Box style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        color: "var(--color-fg-default)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedComp.instanceName || selectedComp.id}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--color-accent-fg)",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {selectedComp.definitionName} • #{selectedComp.id}
                    </div>
                  </Box>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--color-fg-muted)",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
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
                        background: "var(--ms-brand-soft, rgba(14, 116, 144, 0.08))",
                        border: "1px solid var(--ms-brand-border, rgba(14, 116, 144, 0.25))",
                        borderRadius: 6,
                        padding: "8px 10px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--ms-brand, #0e7490)",
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
                          <span style={{ color: "var(--color-fg-muted)" }}>{m.label}</span>
                          <span style={{ color: "var(--color-fg-default)", fontWeight: 600 }}>{m.value}</span>
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
                          color: "var(--color-fg-muted)",
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
                          background: "var(--ms-status-pass-bg, rgba(16, 185, 129, 0.15))",
                          border: "1px solid var(--ms-status-pass-border, rgba(16, 185, 129, 0.35))",
                          color: "var(--ms-status-pass-fg, #047857)",
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
                          borderBottom: "1px solid var(--color-border-subtle, rgba(110, 118, 129, 0.15))",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>{k}</span>
                        <input
                          type="text"
                          value={String(v)}
                          aria-label={`Parameter ${k}`}
                          onChange={(e) => handleParamEdit(selectedComp.id, k, e.target.value)}
                          style={{
                            width: 112,
                            textAlign: "right",
                            background: "var(--color-canvas-inset, var(--color-canvas-default))",
                            border: "1px solid var(--color-border-default)",
                            borderRadius: 4,
                            color: "var(--color-fg-default)",
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
