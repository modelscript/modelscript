// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type PsseBranchLike,
  type PsseBusLike,
  type PsseCaseLike,
  type PsseFixedShuntLike,
  type PsseGeneratorLike,
  type PsseLoadLike,
  type PssePowerFlowOverlay,
  type PsseSwitchedShuntLike,
  type PsseTransformerLike,
  renderPsseSldSvg,
} from "@modelscript/diagram";
import { compressAnsatzPayload } from "@modelscript/editor/workbench/util/permalink";
import {
  type PowerFlowResult,
  type PsseCase,
  ensurePsseWasmParser,
  isPsseWasmParserReady,
  parseRaw,
  solvePowerFlow,
  solvePowerFlowAsync,
} from "@modelscript/psse";
import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, ZapIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import Spinner from "../Spinner";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

const SimulationResults = React.lazy(() =>
  import("@modelscript/editor/workbench/SimulationResults.js").then((m) => ({ default: m.SimulationResults })),
);

export interface PsseSldViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    files?: Record<string, string> | undefined;
    dyrText?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    cfctSec?: number | undefined;
    transientSummary?:
      | {
          stable?: boolean;
          maxFreqDeviationHz?: number;
          maxRotorAngleSpreadDeg?: number;
          minBusVoltagePu?: number;
        }
      | undefined;
    transientChannels?:
      | {
          t: number[];
          series: Record<string, number[]>;
        }
      | undefined;
    metrics?:
      | {
          busCount?: number;
          generatorCount?: number;
          branchCount?: number;
          transformerCount?: number;
          totalGenMw?: number;
          totalLoadMw?: number;
          lossesMw?: number;
        }
      | undefined;
    buses?: { id: number; name: string; baseKv: number; vm: number; va: number }[];
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

export type PsseOverlayMode = "powerflow" | "voltage" | "impedance" | "interconnection";

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "460px")};
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

const TelemetryRibbon = styled.div`
  min-height: 30px;
  background: var(--color-canvas-inset, var(--color-canvas-subtle));
  border-bottom: 1px solid var(--color-border-muted, var(--color-border-default));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 12px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-fg-muted);
  overflow-x: auto;
  white-space: nowrap;
`;

const TelemetryMetricsGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const MetricItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;

  strong {
    color: var(--color-fg-default);
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

const PillBadge = styled.span`
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
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success-fg, var(--color-fg-default));
  border: 1px solid rgba(16, 185, 129, 0.35);
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

function stripInlineComment(line: string): string {
  let inQuotes = false;
  let qChar = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === qChar) inQuotes = false;
    } else if (ch === "'" || ch === '"') {
      inQuotes = true;
      qChar = ch;
    } else if (ch === "/") {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

function parsePsseRawClient(code: string) {
  const lines = code.split(/\r?\n/);
  // Find first non-comment line and check if it's a PSS/E Case Identification header
  let firstDataIdx = 0;
  while (firstDataIdx < lines.length) {
    const t = (lines[firstDataIdx] ?? "").trim();
    if (!t || t.startsWith("@!") || t.startsWith("//")) {
      firstDataIdx++;
    } else {
      break;
    }
  }
  let startIdx = firstDataIdx;
  if (firstDataIdx < lines.length) {
    const firstParts = stripInlineComment(lines[firstDataIdx] ?? "")
      .split(",")
      .map((p) => p.trim());
    const icRaw = firstParts[0] ?? "";
    const ic = icRaw === "" ? 0 : Number.parseInt(icRaw, 10);
    const secondIsQuote = (firstParts[1] ?? "").startsWith("'");
    if ((ic === 0 || ic === 1) && !secondIsQuote) {
      startIdx = firstDataIdx + 3;
    }
  }

  let section = 0; // 0 = bus, 1 = load, 2 = fixed shunt, 3 = generator, 4 = branch, 5 = transformer, 8 = switched shunt
  const buses: PsseBusLike[] = [];
  const loads: PsseLoadLike[] = [];
  const fixedShunts: PsseFixedShuntLike[] = [];
  const switchedShunts: PsseSwitchedShuntLike[] = [];
  const generators: PsseGeneratorLike[] = [];
  const branches: PsseBranchLike[] = [];
  const transformers: PsseTransformerLike[] = [];
  let loadMw = 0;
  let genMw = 0;
  let shuntMvar = 0;
  let minVm = Number.POSITIVE_INFINITY;
  let maxVm = Number.NEGATIVE_INFINITY;

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = (lines[i] ?? "").trim();
    if (!rawLine || rawLine.startsWith("@!") || rawLine.startsWith("//") || rawLine.startsWith("/")) continue;
    // 'Q' is the PSS/E end-of-file sentinel
    if (/^\s*Q(?:\s*,|\s*\/|\s*$)/i.test(rawLine)) {
      break;
    }
    if (/^0(?:\s*,|\s*\/|\s*$)/.test(rawLine)) {
      section++;
      continue;
    }
    const line = stripInlineComment(rawLine);
    const parts = line.split(",").map((p) => p.trim());
    if (section === 0 && parts.length >= 8) {
      const id = Number.parseInt(parts[0] || "0", 10);
      const name = (parts[1] || `BUS ${id}`).replace(/^'|'$/g, "").trim();
      const rawBaseKv = Number.parseFloat(parts[2] ?? "");
      const baseKv = Number.isFinite(rawBaseKv) && rawBaseKv >= 0 ? rawBaseKv : 138;
      const rawType = Number.parseInt(parts[3] ?? "", 10);
      const type = Number.isFinite(rawType) ? rawType : 1;
      const vm = Number.parseFloat(parts[7] ?? "1.0");
      const rawVa = Number.parseFloat(parts[8] ?? "0.0");
      const va = Number.isFinite(rawVa) ? rawVa : 0;
      const nvhi = parts[9] ? Number.parseFloat(parts[9]) : undefined;
      const nvlo = parts[10] ? Number.parseFloat(parts[10]) : undefined;
      const evhi = parts[11] ? Number.parseFloat(parts[11]) : undefined;
      const evlo = parts[12] ? Number.parseFloat(parts[12]) : undefined;
      if (id > 0) {
        buses.push({
          i: id,
          name,
          baseKv,
          ide: type,
          vm: Number.isNaN(vm) ? 1.0 : vm,
          va,
          nvhi: nvhi && !Number.isNaN(nvhi) ? nvhi : undefined,
          nvlo: nvlo && !Number.isNaN(nvlo) ? nvlo : undefined,
          evhi: evhi && !Number.isNaN(evhi) ? evhi : undefined,
          evlo: evlo && !Number.isNaN(evlo) ? evlo : undefined,
        });
      }
      if (!Number.isNaN(vm) && vm > 0) {
        if (vm < minVm) minVm = vm;
        if (vm > maxVm) maxVm = vm;
      }
    } else if (section === 1 && parts.length >= 6) {
      const bus = Number.parseInt(parts[0] || "0", 10);
      const id = (parts[1] || "1").replace(/^'|'$/g, "").trim() || "1";
      const status = Number.parseInt(parts[2] || "1", 10);
      const pl = Number.parseFloat(parts[5] || "0");
      const rawQl = Number.parseFloat(parts[6] ?? "0");
      const ql = Number.isFinite(rawQl) ? rawQl : 0;
      if (!Number.isNaN(pl)) {
        if (status !== 0) loadMw += pl;
        if (bus > 0) loads.push({ i: bus, id, pl, ql, status: Number.isNaN(status) ? 1 : status });
      }
    } else if (section === 2 && parts.length >= 5) {
      const bus = Number.parseInt(parts[0] || "0", 10);
      const id = (parts[1] || "1").replace(/^'|'$/g, "").trim() || "1";
      const status = Number.parseInt(parts[2] || "1", 10);
      const rawGl = Number.parseFloat(parts[3] ?? "0");
      const gl = Number.isFinite(rawGl) ? rawGl : 0;
      const rawBl = Number.parseFloat(parts[4] ?? "0");
      const bl = Number.isFinite(rawBl) ? rawBl : 0;
      if (bus > 0) {
        if (status !== 0) shuntMvar += bl;
        fixedShunts.push({ i: bus, id, status: Number.isNaN(status) ? 1 : status, gl, bl });
      }
    } else if (section === 3 && parts.length >= 3) {
      const bus = Number.parseInt(parts[0] || "0", 10);
      const id = (parts[1] || "1").replace(/^'|'$/g, "").trim() || "1";
      const pg = Number.parseFloat(parts[2] || "0");
      const rawQg = Number.parseFloat(parts[3] ?? "0");
      const qg = Number.isFinite(rawQg) ? rawQg : 0;
      const stat = parts[14] !== undefined ? Number.parseInt(parts[14], 10) : 1;
      const pt = parts[16] !== undefined ? Number.parseFloat(parts[16]) : undefined;
      const pb = parts[17] !== undefined ? Number.parseFloat(parts[17]) : undefined;
      if (!Number.isNaN(pg)) {
        if (stat !== 0) genMw += pg;
        if (bus > 0) {
          generators.push({
            i: bus,
            id,
            pg,
            qg,
            stat: Number.isNaN(stat) ? 1 : stat,
            pt: pt !== undefined && !Number.isNaN(pt) ? pt : undefined,
            pb: pb !== undefined && !Number.isNaN(pb) ? pb : undefined,
          });
        }
      }
    } else if (section === 4 && parts.length >= 5) {
      const fromBus = Number.parseInt(parts[0] || "0", 10);
      const toBus = Math.abs(Number.parseInt(parts[1] || "0", 10));
      const ckt = (parts[2] || "1").replace(/^'|'$/g, "").trim() || "1";
      const rawR = Number.parseFloat(parts[3] ?? "");
      const r = Number.isFinite(rawR) ? rawR : 0.01;
      const rawX = Number.parseFloat(parts[4] ?? "");
      const x = Number.isFinite(rawX) ? rawX : 0.05;
      const rawB = Number.parseFloat(parts[5] ?? "");
      const b = Number.isFinite(rawB) ? rawB : 0;
      const rawRateA = Number.parseFloat(parts[6] ?? "");
      const rateA = Number.isFinite(rawRateA) ? rawRateA : 0;
      const st = parts[13] !== undefined ? Number.parseInt(parts[13], 10) : 1;
      if (fromBus > 0 && toBus > 0) {
        branches.push({
          i: fromBus,
          j: toBus,
          ckt,
          r,
          x,
          b,
          rateA,
          st: Number.isNaN(st) ? 1 : st,
        });
      }
    } else if (section === 5 && parts.length >= 2) {
      const bus1 = Number.parseInt(parts[0] || "0", 10);
      const bus2 = Number.parseInt(parts[1] || "0", 10);
      const rawBus3 = Number.parseInt(parts[2] ?? "0", 10);
      const bus3 = Number.isFinite(rawBus3) ? rawBus3 : 0;
      const ckt = (parts[3] || "1").replace(/^'|'$/g, "").trim() || "1";
      const stat = parts[11] !== undefined ? Number.parseInt(parts[11], 10) : 1;
      const line2 = stripInlineComment(lines[i + 1] ?? "")
        .split(",")
        .map((p) => p.trim());
      const line3 = stripInlineComment(lines[i + 2] ?? "")
        .split(",")
        .map((p) => p.trim());
      const rawR12 = Number.parseFloat(line2[0] ?? "");
      const r12 = Number.isFinite(rawR12) ? rawR12 : 0;
      const rawX12 = Number.parseFloat(line2[1] ?? "");
      const x12 = Number.isFinite(rawX12) ? rawX12 : 0.05;
      const rawWindv1 = Number.parseFloat(line3[0] ?? "");
      const windv1 = Number.isFinite(rawWindv1) && rawWindv1 > 0 ? rawWindv1 : 1.0;
      if (bus1 > 0 && bus2 > 0) {
        transformers.push({
          i: bus1,
          j: bus2,
          k: bus3,
          ckt,
          windv1,
          r12,
          x12,
          stat: Number.isNaN(stat) ? 1 : stat,
        });
      }
      // Advance past the 3 (for 2-winding) or 4 (for 3-winding) continuation lines
      i += bus3 !== 0 ? 4 : 3;
    } else if (section === 8 && parts.length >= 10) {
      const bus = Number.parseInt(parts[0] || "0", 10);
      const stat = Number.parseInt(parts[3] || "1", 10);
      const rawBinit = Number.parseFloat(parts[9] ?? "0");
      const binit = Number.isFinite(rawBinit) ? rawBinit : 0;
      if (bus > 0 && Math.abs(binit) > 0) {
        if (stat !== 0) shuntMvar += binit;
        switchedShunts.push({ i: bus, stat: Number.isNaN(stat) ? 1 : stat, binit });
      }
    }
  }
  return {
    buses,
    loads,
    fixedShunts,
    switchedShunts,
    generators,
    branches,
    transformers,
    busCount: buses.length > 0 ? buses.length : undefined,
    totalLoadMw: loadMw > 0 ? Number(loadMw.toFixed(1)) : undefined,
    totalGenMw: genMw > 0 ? Number(genMw.toFixed(1)) : undefined,
    totalShuntMvar: Math.abs(shuntMvar) > 0 ? Number(shuntMvar.toFixed(1)) : undefined,
    branchCount: branches.length > 0 ? branches.length : undefined,
    minVm: Number.isFinite(minVm) ? minVm : undefined,
    maxVm: Number.isFinite(maxVm) ? maxVm : undefined,
  };
}

export const PsseSldViewer: React.FC<PsseSldViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const filesRawEntry = viewConfig.files
    ? Object.entries(viewConfig.files).find(([k]) => k.toLowerCase().endsWith(".raw"))?.[1]
    : undefined;
  const effectiveDyrText =
    viewConfig.dyrText ??
    (viewConfig.files
      ? Object.entries(viewConfig.files).find(([k]) => k.toLowerCase().endsWith(".dyr"))?.[1]
      : undefined);
  const [rawText, setRawText] = useState(filesRawEntry || viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code" | "stability">("diagram");
  const [overlayMode, setOverlayMode] = useState<PsseOverlayMode>("powerflow");
  const [focusBusId, setFocusBusId] = useState<string>("");
  const [hopDepth, setHopDepth] = useState<number>(2);
  const [animateFlows, setAnimateFlows] = useState<boolean>(false);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [geoLayout, setGeoLayout] = useState<boolean>(false);
  const [highlightedBuses, setHighlightedBuses] = useState<number[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ buses?: number[] }>).detail;
      setHighlightedBuses(Array.isArray(detail?.buses) ? detail.buses : []);
    };
    window.addEventListener("modelscript:psse-highlight", handler);
    return () => window.removeEventListener("modelscript:psse-highlight", handler);
  }, []);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = viewConfig.title || "PSS/E Power Flow Case (.raw)";

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      const controller = new AbortController();
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl, { signal: controller.signal })
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setRawText(txt);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          console.warn("[PsseSldViewer] Failed to fetch source:", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
      return () => controller.abort();
    }
    return undefined;
  }, [viewConfig.code, viewConfig.url]);

  useEffect(() => {
    if (!loading && typeof window !== "undefined") {
      window.__ARTIFACT_READY = true;
    }
  }, [loading, rawText]);

  const [asyncPowerflow, setAsyncPowerflow] = useState<PowerFlowResult | null>(null);
  const [psseParserReady, setPsseParserReady] = useState<boolean>(() => isPsseWasmParserReady());

  useEffect(() => {
    if (psseParserReady) return;
    let cancelled = false;
    void ensurePsseWasmParser()
      .then(() => {
        if (!cancelled) setPsseParserReady(true);
      })
      .catch(() => {
        // Fallback client parser remains active if WASM binary cannot be fetched
      });
    return () => {
      cancelled = true;
    };
  }, [psseParserReady]);

  const parsedData = useMemo(() => {
    let parsedCase: PsseCase | null = null;
    let syncPowerflow: PowerFlowResult | null = null;
    const parsedClient = rawText ? parsePsseRawClient(rawText) : undefined;

    if (rawText.trim() && psseParserReady) {
      try {
        const candidate = parseRaw(rawText);
        if (candidate.buses.size > 0) {
          parsedCase = candidate;
          if (candidate.buses.size <= 500) {
            syncPowerflow = solvePowerFlow(candidate);
          }
        }
      } catch (err) {
        console.warn("[PsseSldViewer] parseRaw / solvePowerFlow fallback:", err);
      }
    }
    return { parsedCase, syncPowerflow, parsedClient };
  }, [rawText, psseParserReady]);

  useEffect(() => {
    let cancelled = false;
    const c = parsedData.parsedCase;
    if (c && c.buses.size > 500) {
      solvePowerFlowAsync(c)
        .then((sol) => {
          if (!cancelled) setAsyncPowerflow(sol);
        })
        .catch(() => {});
    } else {
      setAsyncPowerflow(null);
    }
    return () => {
      cancelled = true;
    };
  }, [parsedData.parsedCase]);

  const psseAnalysis = useMemo(() => {
    const { parsedCase, syncPowerflow, parsedClient } = parsedData;
    const powerflow = syncPowerflow ?? asyncPowerflow;
    const parsedCaseBuses = parsedCase ? Array.from(parsedCase.buses.values()) : [];

    const buses: PsseBusLike[] =
      parsedCaseBuses.length > 0
        ? parsedCaseBuses
        : parsedClient?.buses && parsedClient.buses.length > 0
          ? parsedClient.buses
          : (viewConfig.buses || []).map((b) => ({
              i: b.id,
              name: b.name,
              baseKv: b.baseKv,
              ide: 1,
              vm: b.vm,
              va: b.va,
            }));

    const loads = parsedCase?.loads ?? parsedClient?.loads ?? [];
    const fixedShunts = parsedCase?.fixedShunts ?? parsedClient?.fixedShunts ?? [];
    const switchedShunts = parsedCase?.switchedShunts ?? parsedClient?.switchedShunts ?? [];
    const generators = parsedCase?.generators ?? parsedClient?.generators ?? [];
    const branches = parsedCase?.branches ?? parsedClient?.branches ?? [];
    const transformers = parsedCase?.transformers ?? parsedClient?.transformers ?? [];

    const solvedVms =
      powerflow && powerflow.buses.length > 0
        ? powerflow.buses.map((b) => b.vm).filter((v) => Number.isFinite(v) && v > 0)
        : buses.map((b) => b.vm).filter((v): v is number => v !== undefined && Number.isFinite(v) && v > 0);

    const minVm = solvedVms.length > 0 ? Math.min(...solvedVms) : 1.0;
    const maxVm = solvedVms.length > 0 ? Math.max(...solvedVms) : 1.0;

    const totalGenMw =
      viewConfig.metrics?.totalGenMw ??
      (powerflow
        ? Number(powerflow.buses.reduce((s, b) => s + (b.pgMw ?? (b as { pGen?: number }).pGen ?? 0), 0).toFixed(1))
        : (parsedClient?.totalGenMw ?? 0));
    const totalLoadMw =
      viewConfig.metrics?.totalLoadMw ??
      (powerflow
        ? Number(powerflow.buses.reduce((s, b) => s + (b.plMw ?? (b as { pLoad?: number }).pLoad ?? 0), 0).toFixed(1))
        : (parsedClient?.totalLoadMw ?? 0));
    const lossesMw =
      viewConfig.metrics?.lossesMw ??
      (powerflow ? Number(powerflow.totalLossMw.toFixed(2)) : Number(Math.max(0, totalGenMw - totalLoadMw).toFixed(2)));

    return {
      parsedCase,
      powerflow,
      buses,
      loads,
      fixedShunts,
      switchedShunts,
      generators,
      branches,
      transformers,
      summary: {
        busCount: viewConfig.metrics?.busCount ?? buses.length,
        generatorCount: viewConfig.metrics?.generatorCount ?? generators.length,
        branchCount: viewConfig.metrics?.branchCount ?? branches.length + transformers.length,
        totalGenMw,
        totalLoadMw,
        lossesMw,
        minVm,
        maxVm,
        converged: powerflow?.converged ?? true,
      },
    };
  }, [parsedData, asyncPowerflow, viewConfig.buses, viewConfig.metrics]);

  const sanitizedSvg = useMemo(() => {
    if (psseAnalysis.buses.length > 0) {
      try {
        const { powerflow } = psseAnalysis;
        const effectiveOverlay: PssePowerFlowOverlay | undefined =
          overlayMode === "impedance" || !powerflow
            ? undefined
            : overlayMode === "voltage"
              ? {
                  converged: powerflow.converged,
                  iterations: powerflow.iterations,
                  totalLossMw: powerflow.totalLossMw,
                  totalLossMvar: powerflow.totalLossMvar,
                  buses: powerflow.buses,
                  branches: [],
                }
              : powerflow;

        const parsedFocus = Number.parseInt(focusBusId.trim(), 10);
        const hasFocusBus =
          Number.isFinite(parsedFocus) &&
          focusBusId.trim() !== "" &&
          psseAnalysis.buses.some((b) => b.i === parsedFocus);

        let visibleBuses = psseAnalysis.buses;
        let visibleLoads = psseAnalysis.loads;
        let visibleFixedShunts = psseAnalysis.fixedShunts;
        let visibleSwitchedShunts = psseAnalysis.switchedShunts;
        let visibleGenerators = psseAnalysis.generators;
        let visibleBranches = psseAnalysis.branches;
        let visibleTransformers = psseAnalysis.transformers;

        if (hasFocusBus) {
          const adj = new Map<number, number[]>();
          const addEdge = (a: number, b: number) => {
            if (!adj.has(a)) adj.set(a, []);
            if (!adj.has(b)) adj.set(b, []);
            adj.get(a)!.push(b);
            adj.get(b)!.push(a);
          };
          for (const br of psseAnalysis.branches) addEdge(br.i, br.j);
          for (const xf of psseAnalysis.transformers) {
            addEdge(xf.i, xf.j);
            if (xf.k && xf.k > 0) {
              addEdge(xf.i, xf.k);
              addEdge(xf.j, xf.k);
            }
          }
          const visited = new Set<number>([parsedFocus]);
          let frontier = [parsedFocus];
          for (let d = 0; d < hopDepth && frontier.length > 0; d++) {
            const nextFrontier: number[] = [];
            for (const cur of frontier) {
              for (const nb of adj.get(cur) ?? []) {
                if (!visited.has(nb)) {
                  visited.add(nb);
                  nextFrontier.push(nb);
                }
              }
            }
            frontier = nextFrontier;
          }
          visibleBuses = psseAnalysis.buses.filter((b) => visited.has(b.i));
          visibleLoads = psseAnalysis.loads.filter((l) => visited.has(l.i));
          visibleFixedShunts = psseAnalysis.fixedShunts.filter((s) => visited.has(s.i));
          visibleSwitchedShunts = psseAnalysis.switchedShunts.filter((s) => visited.has(s.i));
          visibleGenerators = psseAnalysis.generators.filter((g) => visited.has(g.i));
          visibleBranches = psseAnalysis.branches.filter((br) => visited.has(br.i) && visited.has(br.j));
          visibleTransformers = psseAnalysis.transformers.filter(
            (xf) => visited.has(xf.i) && visited.has(xf.j) && (!xf.k || visited.has(xf.k)),
          );
        }

        if (overlayMode === "interconnection") {
          const areaByBus = new Map<number, number>();
          for (const b of visibleBuses) {
            if (typeof b.area === "number") areaByBus.set(b.i, b.area);
          }
          const tieBranches = visibleBranches.filter((br) => {
            const a1 = areaByBus.get(br.i);
            const a2 = areaByBus.get(br.j);
            return a1 !== undefined && a2 !== undefined && a1 !== a2;
          });
          if (tieBranches.length > 0) {
            const tieBusSet = new Set<number>();
            for (const br of tieBranches) {
              tieBusSet.add(br.i);
              tieBusSet.add(br.j);
            }
            visibleBranches = tieBranches;
            visibleBuses = visibleBuses.filter((b) => tieBusSet.has(b.i));
            visibleLoads = visibleLoads.filter((l) => tieBusSet.has(l.i));
            visibleFixedShunts = visibleFixedShunts.filter((s) => tieBusSet.has(s.i));
            visibleSwitchedShunts = visibleSwitchedShunts.filter((s) => tieBusSet.has(s.i));
            visibleGenerators = visibleGenerators.filter((g) => tieBusSet.has(g.i));
            visibleTransformers = visibleTransformers.filter(
              (xf) => tieBusSet.has(xf.i) && tieBusSet.has(xf.j) && (!xf.k || tieBusSet.has(xf.k)),
            );
          }
        }

        if (geoLayout && psseAnalysis.parsedCase?.substations && psseAnalysis.parsedCase.substations.length > 0) {
          const busToSub = new Map<number, { lati: number; long: number }>();
          for (const sub of psseAnalysis.parsedCase.substations) {
            if (!Number.isFinite(sub.lati) || !Number.isFinite(sub.long)) continue;
            for (const nd of sub.nodes) {
              busToSub.set(nd.ibus, { lati: sub.lati, long: sub.long });
            }
          }
          if (busToSub.size > 0) {
            const lats = Array.from(busToSub.values()).map((v) => v.lati);
            const lons = Array.from(busToSub.values()).map((v) => v.long);
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLon = Math.min(...lons);
            const maxLon = Math.max(...lons);
            const spanLat = Math.max(1e-4, maxLat - minLat);
            const spanLon = Math.max(1e-4, maxLon - minLon);
            visibleBuses = visibleBuses.map((b) => {
              const coord = busToSub.get(b.i);
              if (!coord) return b;
              return {
                ...b,
                x: Math.round(120 + ((coord.long - minLon) / spanLon) * 1400),
                y: Math.round(120 + (1 - (coord.lati - minLat) / spanLat) * 900),
              };
            });
          }
        }

        const model: PsseCaseLike = {
          title1: title,
          buses: visibleBuses,
          loads: visibleLoads,
          fixedShunts: visibleFixedShunts,
          switchedShunts: visibleSwitchedShunts,
          generators: visibleGenerators,
          branches: visibleBranches,
          transformers: visibleTransformers,
          ...(effectiveOverlay ? { powerflow: effectiveOverlay } : {}),
        };

        const built = renderPsseSldSvg(
          model,
          {
            ...(effectiveOverlay ?? {}),
            powerflow,
            overlayMode: overlayMode === "interconnection" ? "powerflow" : overlayMode,
          } as unknown as PssePowerFlowOverlay,
          {
            lodBusThreshold: 500,
            ...(visibleBuses.length > 1500 ? { viewport: { minX: 0, minY: 0, maxX: 4000, maxY: 3000 } } : {}),
          },
        );
        let svgOut = built;
        if (animateFlows && overlayMode === "powerflow") {
          const animStyle = `<style>@keyframes psseFlowDash{to{stroke-dashoffset:-24;}} path[data-edge], line[data-edge]{stroke-dasharray:6 6;animation:psseFlowDash 1.2s linear infinite;}</style>`;
          svgOut = svgOut.replace("</svg>", `${animStyle}</svg>`);
        }
        if (showHeatmap && overlayMode === "voltage") {
          const heatStyle = `<style>g[data-bus] rect, g[data-bus] circle{filter:drop-shadow(0 0 10px currentColor);}</style>`;
          svgOut = svgOut.replace("</svg>", `${heatStyle}</svg>`);
        }
        if (highlightedBuses.length > 0) {
          const sel = highlightedBuses.map((b) => `g[data-bus="${b}"] rect, g[data-bus="${b}"] circle`).join(",");
          const hlStyle = `<style>${sel}{stroke:var(--ms-danger, #f85149) !important;stroke-width:3px !important;filter:drop-shadow(0 0 8px var(--ms-danger, #f85149));}</style>`;
          svgOut = svgOut.replace("</svg>", `${hlStyle}</svg>`);
        }
        return sanitizeSvgMarkup(svgOut, { isFullScreen, isDark });
      } catch {
        // Fallback to pre-rendered svg if available
      }
    }
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, isDark });
    }
    return "";
  }, [
    viewConfig.svg,
    psseAnalysis,
    overlayMode,
    focusBusId,
    hopDepth,
    animateFlows,
    showHeatmap,
    geoLayout,
    highlightedBuses,
    title,
    isFullScreen,
    isDark,
  ]);

  const hasStabilityBundle = Boolean(
    effectiveDyrText || viewConfig.transientSummary || viewConfig.transientChannels || viewConfig.cfctSec !== undefined,
  );
  const stabilityRows = useMemo(() => {
    const ch = viewConfig.transientChannels;
    if (!ch || !Array.isArray(ch.t) || ch.t.length === 0) return null;
    const vars = Object.keys(ch.series ?? {}).slice(0, 16);
    if (vars.length === 0) return null;
    return {
      vars,
      rows: ch.t.map((tVal, i) => {
        const row: Record<string, number> = { time: tVal };
        for (const k of vars) {
          row[k] = ch.series[k]?.[i] ?? 0;
        }
        return row;
      }),
    };
  }, [viewConfig.transientChannels]);

  const effectiveViewMode: "diagram" | "code" | "stability" =
    viewMode === "stability" && hasStabilityBundle
      ? "stability"
      : viewMode === "diagram" && sanitizedSvg
        ? "diagram"
        : "code";

  const handleCopy = () => {
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportSvg = () => {
    if (!sanitizedSvg) return;
    const blob = new Blob([sanitizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-sld.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInAnsatzEditor = () => {
    const hash = compressAnsatzPayload({
      v: 1,
      lang: "psse",
      code: rawText,
      title,
    });
    const fromParam = viewConfig.artifactId ? `?fromArtifact=${encodeURIComponent(viewConfig.artifactId)}` : "";
    navigate(`/editor${fromParam}#m=${hash}`);
  };

  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);
  const { summary } = psseAnalysis;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ZapIcon size={16} fill="var(--color-success-fg, currentColor)" />
          <PillBadge>PSS/E RAW SLD</PillBadge>
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          {(sanitizedSvg || hasStabilityBundle) && (
            <SegmentedControl>
              {sanitizedSvg && (
                <SegmentBtn
                  type="button"
                  $active={effectiveViewMode === "diagram"}
                  onClick={() => setViewMode("diagram")}
                >
                  <ZapIcon size={12} /> SLD
                </SegmentBtn>
              )}
              {hasStabilityBundle && (
                <SegmentBtn
                  type="button"
                  $active={effectiveViewMode === "stability"}
                  onClick={() => setViewMode("stability")}
                >
                  Stability
                </SegmentBtn>
              )}
              <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                <CodeIcon size={12} /> Raw Data
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
            <Button size="small" leadingVisual={DraftingTriangleIcon} onClick={handleOpenInAnsatzEditor}>
              Open in Ansatz
            </Button>
          )}
        </Box>
      </Toolbar>

      <TelemetryRibbon>
        <TelemetryMetricsGroup>
          <MetricItem>
            Buses: <strong>{summary.busCount}</strong>
          </MetricItem>
          <MetricItem>
            Gens: <strong>{summary.generatorCount}</strong>
          </MetricItem>
          <MetricItem>
            Branches: <strong>{summary.branchCount}</strong>
          </MetricItem>
          <MetricItem>
            Gen: <strong>{summary.totalGenMw.toFixed(1)} MW</strong>
          </MetricItem>
          <MetricItem>
            Load: <strong>{summary.totalLoadMw.toFixed(1)} MW</strong>
          </MetricItem>
          <MetricItem>
            Losses: <strong>{summary.lossesMw.toFixed(2)} MW</strong>
          </MetricItem>
          <MetricItem>
            V:{" "}
            <strong>
              {summary.minVm.toFixed(3)}–{summary.maxVm.toFixed(3)} pu
            </strong>
          </MetricItem>
        </TelemetryMetricsGroup>

        {effectiveViewMode === "diagram" && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              Focus Bus
              <input
                type="text"
                placeholder="all"
                value={focusBusId}
                onChange={(e) => setFocusBusId(e.target.value)}
                style={{
                  width: 48,
                  padding: "1px 4px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                }}
              />
            </label>
            {focusBusId.trim() !== "" && (
              <select
                value={hopDepth}
                onChange={(e) => setHopDepth(Number(e.target.value))}
                style={{
                  padding: "1px 4px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                }}
              >
                <option value={1}>1-hop</option>
                <option value={2}>2-hop</option>
                <option value={3}>3-hop</option>
                <option value={4}>4-hop</option>
              </select>
            )}
            {overlayMode === "powerflow" && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input type="checkbox" checked={animateFlows} onChange={(e) => setAnimateFlows(e.target.checked)} />
                Flow
              </label>
            )}
            {overlayMode === "voltage" && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
                Heatmap
              </label>
            )}
            {psseAnalysis.parsedCase?.substations && psseAnalysis.parsedCase.substations.length > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input type="checkbox" checked={geoLayout} onChange={(e) => setGeoLayout(e.target.checked)} />
                Geo
              </label>
            )}
            <SegmentedControl>
              <SegmentBtn
                type="button"
                $active={overlayMode === "powerflow"}
                onClick={() => setOverlayMode("powerflow")}
              >
                Power Flow
              </SegmentBtn>
              <SegmentBtn type="button" $active={overlayMode === "voltage"} onClick={() => setOverlayMode("voltage")}>
                Voltage
              </SegmentBtn>
              <SegmentBtn
                type="button"
                $active={overlayMode === "impedance"}
                onClick={() => setOverlayMode("impedance")}
              >
                Impedance
              </SegmentBtn>
              <SegmentBtn
                type="button"
                $active={overlayMode === "interconnection"}
                onClick={() => setOverlayMode("interconnection")}
              >
                Tie-Lines
              </SegmentBtn>
            </SegmentedControl>
          </div>
        )}
      </TelemetryRibbon>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "stability" ? (
          <Box p={3} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, fontFamily: "monospace" }}>
              {viewConfig.transientSummary?.stable !== undefined && (
                <span>
                  Status:{" "}
                  <strong
                    style={{
                      color: viewConfig.transientSummary.stable
                        ? "var(--ms-success, #3fb950)"
                        : "var(--ms-danger, #f85149)",
                    }}
                  >
                    {viewConfig.transientSummary.stable ? "STABLE" : "UNSTABLE"}
                  </strong>
                </span>
              )}
              {viewConfig.cfctSec !== undefined && (
                <span>
                  CFCT: <strong>{viewConfig.cfctSec.toFixed(3)} s</strong>
                </span>
              )}
              {viewConfig.transientSummary?.maxFreqDeviationHz !== undefined && (
                <span>
                  Max |Δf|: <strong>{viewConfig.transientSummary.maxFreqDeviationHz.toFixed(3)} Hz</strong>
                </span>
              )}
              {viewConfig.transientSummary?.maxRotorAngleSpreadDeg !== undefined && (
                <span>
                  Max Angle Spread: <strong>{viewConfig.transientSummary.maxRotorAngleSpreadDeg.toFixed(1)}°</strong>
                </span>
              )}
              {viewConfig.transientSummary?.minBusVoltagePu !== undefined && (
                <span>
                  Min V: <strong>{viewConfig.transientSummary.minBusVoltagePu.toFixed(3)} pu</strong>
                </span>
              )}
            </div>
            {stabilityRows && (
              <div style={{ height: isFullScreen ? 420 : 280 }}>
                <React.Suspense fallback={<Spinner size="medium" />}>
                  <SimulationResults
                    localData={stabilityRows.rows}
                    simulationVariables={stabilityRows.vars}
                    colorMode={isDark ? "dark" : "light"}
                    modelName="psse-artifact-stability"
                  />
                </React.Suspense>
              </div>
            )}
            {effectiveDyrText && (
              <CodePre style={{ maxHeight: 180 }}>
                {effectiveDyrText.split(/\r?\n/).map((line, idx) => (
                  <CodeLine key={idx}>
                    <LineNo>{idx + 1}</LineNo>
                    <span>{highlightPolyglotLine(line, "psse")}</span>
                  </CodeLine>
                ))}
              </CodePre>
            )}
          </Box>
        ) : effectiveViewMode === "code" || !sanitizedSvg ? (
          <CodePre>
            {lines.length > 0 ? (
              lines.map((line, idx) => (
                <CodeLine key={idx}>
                  <LineNo>{idx + 1}</LineNo>
                  <span>{highlightPolyglotLine(line, "psse")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No PSS/E RAW source loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <InteractiveSvgStage svgMarkup={sanitizedSvg} isFullScreen={isFullScreen} />
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default PsseSldViewer;
