// SPDX-License-Identifier: AGPL-3.0-or-later

import { compressMorselPayload } from "@modelscript/editor/workbench/util/permalink";
import { readPscadPsout } from "@modelscript/pscad";
import type { IndexedDataset } from "@modelscript/simulate/charts";
import { CodeIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import Spinner from "../Spinner";
import IndexedCanvasPlot from "./IndexedCanvasPlot";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface PsoutViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    title?: string | undefined;
    code?: string | undefined;
    psoutBase64?: string | undefined;
    timeStepSec?: number | undefined;
    durationSec?: number | undefined;
    channels?: string[] | undefined;
    data?: Record<string, number>[] | undefined;
    url?: string | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "480px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  min-height: 38px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 12px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
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
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.35);
`;

const ChartContainer = styled.div`
  flex: 1;
  min-height: 0;
  padding: 10px 14px;
  background: var(--color-canvas-inset, #010409);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const LINE_COLORS = ["#38bdf8", "#f59e0b", "#10b981", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16"];

function decodePsoutBinary(
  bytes: Uint8Array,
  runIndex: number = 0,
  overlayAllRuns: boolean = false,
): {
  dataset: IndexedDataset;
  channels: string[];
  timeKey: string;
  summaryText: string;
  numRuns: number;
  sampleCount: number;
} {
  const doc = readPscadPsout(bytes);
  const targetRuns =
    overlayAllRuns && doc.numRuns > 1
      ? Array.from({ length: Math.min(doc.numRuns, 12) }, (_, r) => doc.run(r))
      : [doc.run(Math.max(0, Math.min(doc.numRuns - 1, runIndex)))];

  const baseRun = targetRuns[0]!;
  const baseTraces = Array.from(baseRun.traces.values()).filter((t) => t.id !== 3 && !/^(domain|time)$/i.test(t.name));
  const timeArr =
    Array.from(baseRun.traces.values()).find((t) => (t.id === 3 || /^(domain|time)$/i.test(t.name)) && t.time?.length)
      ?.time ?? baseTraces.find((t) => t.time && t.time.length > 0)?.time;
  const nSamples = baseTraces.reduce((m, t) => Math.max(m, t.values.length), 0);
  const indexValues = timeArr ? Array.from(timeArr) : Array.from({ length: nSamples }, (_, i) => i);

  const series: IndexedDataset["series"] = [];
  const channels: string[] = [];

  for (let rIdx = 0; rIdx < targetRuns.length; rIdx++) {
    const r = targetRuns[rIdx]!;
    const rTraces = Array.from(r.traces.values()).filter((t) => t.id !== 3 && !/^(domain|time)$/i.test(t.name));
    for (const tr of rTraces) {
      const baseName = tr.name || `Trace_${tr.id}`;
      const name = targetRuns.length > 1 ? `${baseName} [Run #${r.index + 1}]` : baseName;
      channels.push(name);
      series.push({
        name,
        unit: tr.unit || undefined,
        values: Array.from(tr.values),
      });
    }
  }

  const previewStride = Math.max(1, Math.ceil(nSamples / 200));
  const previewNames = baseTraces.slice(0, 12).map((t) => t.name || `Trace_${t.id}`);
  const previewRows: string[] = [];
  for (let i = 0; i < nSamples; i += previewStride) {
    previewRows.push([indexValues[i] ?? i, ...baseTraces.slice(0, 12).map((t) => t.values[i] ?? 0)].join(","));
  }
  const summaryText = [
    `# PSCAD V5 .psout Binary Container (v${doc.header.version}, runs=${doc.numRuns}, run=#${runIndex + 1}, samples=${nSamples}, pageSize=${doc.header.pageSize}, pages=${doc.header.pageCount})`,
    `# Channels (${channels.length}): ${channels.join(", ")}`,
    ["time", ...previewNames].join(","),
    ...previewRows,
  ].join("\n");

  return {
    dataset: {
      sourceFormat: "psout",
      indexAxis: { key: "time", label: "Time", unit: "s", inverted: false },
      indexValues,
      series,
    },
    channels,
    timeKey: "time",
    summaryText,
    numRuns: doc.numRuns,
    sampleCount: nSamples,
  };
}

function parsePsoutText(raw: string): { rows: Record<string, number>[]; channels: string[]; timeKey: string } {
  if (!raw.trim()) return { rows: [], channels: [], timeKey: "time" };
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json) && json.length > 0 && typeof json[0] === "object") {
      const keys = Object.keys(json[0]);
      const timeKey = keys.find((k) => /^(t|time)$/i.test(k)) || keys[0] || "time";
      return { rows: json, channels: keys.filter((k) => k !== timeKey), timeKey };
    }
  } catch {
    // Parse as CSV / whitespace-delimited PSOUT trace
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("!"));
  if (lines.length < 2) return { rows: [], channels: [], timeKey: "time" };
  const sep = lines[0]!.includes(",") ? "," : /\s+/;
  const headers = lines[0]!
    .split(sep)
    .map((h) => h.trim())
    .filter(Boolean);
  const timeKey = headers[0] || "time";
  const channels = headers.slice(1);
  const rows: Record<string, number>[] = [];
  for (let i = 1; i < Math.min(lines.length, 2000); i++) {
    const vals = lines[i]!.split(sep).map((v) => Number(v.trim()));
    if (vals.length >= 2 && vals.every((v) => Number.isFinite(v))) {
      const row: Record<string, number> = { [timeKey]: vals[0]! };
      for (let c = 0; c < channels.length; c++) {
        if (vals[c + 1] !== undefined) row[channels[c]!] = vals[c + 1]!;
      }
      rows.push(row);
    }
  }
  return { rows, channels, timeKey };
}

export const PsoutViewer: React.FC<PsoutViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [binaryBytes, setBinaryBytes] = useState<Uint8Array | null>(null);
  const [selectedRun, setSelectedRun] = useState(0);
  const [overlayAllRuns, setOverlayAllRuns] = useState(false);
  const [numRuns, setNumRuns] = useState(1);
  const [cursorMode, setCursorMode] = useState(false);
  const [chartMode, setChartMode] = useState<"overlay" | "histogram">("overlay");
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());
  const [binaryParsed, setBinaryParsed] = useState<{
    dataset: IndexedDataset;
    channels: string[];
    sampleCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"plot" | "code">("plot");
  const title = viewConfig.title || "PSCAD Simulation Waveforms (.psout)";

  useEffect(() => {
    if (viewConfig.psoutBase64) {
      try {
        const bin = atob(viewConfig.psoutBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        setBinaryBytes(bytes);
        return;
      } catch (err) {
        console.warn("[PsoutViewer] Failed to decode psoutBase64:", err);
      }
    }
    if (viewConfig.code) {
      setBinaryBytes(null);
      setBinaryParsed(null);
      setNumRuns(1);
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
        .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          if (bytes.length >= 160) {
            setBinaryBytes(bytes);
            return;
          }
          setBinaryBytes(null);
          setBinaryParsed(null);
          setNumRuns(1);
          setRawText(new TextDecoder().decode(bytes));
        })
        .catch((err) => console.warn("[PsoutViewer] Failed to fetch PSOUT data:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url, viewConfig.psoutBase64]);

  useEffect(() => {
    if (!binaryBytes) return;
    try {
      const decoded = decodePsoutBinary(binaryBytes, selectedRun, overlayAllRuns);
      setNumRuns(decoded.numRuns);
      setBinaryParsed({
        dataset: decoded.dataset,
        channels: decoded.channels,
        sampleCount: decoded.sampleCount,
      });
      setRawText(decoded.summaryText);
    } catch {
      setBinaryParsed(null);
      setNumRuns(1);
      setRawText(new TextDecoder().decode(binaryBytes));
    }
  }, [binaryBytes, selectedRun, overlayAllRuns]);

  const { dataset, channels, sampleCount } = useMemo<{
    dataset: IndexedDataset | null;
    channels: string[];
    sampleCount: number;
  }>(() => {
    if (viewConfig.data && Array.isArray(viewConfig.data) && viewConfig.data.length > 0) {
      const keys = Object.keys(viewConfig.data[0] || {});
      const tKey = keys.find((k) => /^(t|time)$/i.test(k)) || keys[0] || "time";
      const chs = viewConfig.channels?.length ? viewConfig.channels : keys.filter((k) => k !== tKey);
      const indexValues = viewConfig.data.map((r, i) => Number(r[tKey] ?? i));
      const series = chs.map((name) => ({
        name,
        values: viewConfig.data!.map((r) => Number(r[name] ?? 0)),
      }));
      return {
        dataset: {
          sourceFormat: "psout",
          indexAxis: { key: tKey, label: "Time", unit: "s", inverted: false },
          indexValues,
          series,
        },
        channels: chs,
        sampleCount: indexValues.length,
      };
    }
    if (binaryParsed) {
      return binaryParsed;
    }
    const parsed = parsePsoutText(rawText);
    if (parsed.rows.length === 0 || parsed.channels.length === 0) {
      return { dataset: null, channels: [], sampleCount: 0 };
    }
    const indexValues = parsed.rows.map((r, i) => Number(r[parsed.timeKey] ?? i));
    const series = parsed.channels.map((name) => ({
      name,
      values: parsed.rows.map((r) => Number(r[name] ?? 0)),
    }));
    return {
      dataset: {
        sourceFormat: "psout",
        indexAxis: { key: parsed.timeKey, label: "Time", unit: "s", inverted: false },
        indexValues,
        series,
      },
      channels: parsed.channels,
      sampleCount: indexValues.length,
    };
  }, [viewConfig.data, viewConfig.channels, binaryParsed, rawText]);

  const visibleChannels = useMemo(() => channels.filter((c) => !hiddenChannels.has(c)), [channels, hiddenChannels]);

  const seriesColors = useMemo(() => {
    const map: Record<string, string> = {};
    channels.forEach((ch, idx) => {
      map[ch] = LINE_COLORS[idx % LINE_COLORS.length] || "#38bdf8";
    });
    return map;
  }, [channels]);

  useEffect(() => {
    if (!loading && typeof window !== "undefined") {
      (window as unknown as { __ARTIFACT_READY?: boolean }).__ARTIFACT_READY = true;
    }
  }, [loading, dataset]);

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={15} fill="#c084fc" />
          {!isFullScreen && <ModelTitle>{title}</ModelTitle>}
          <PillBadge>
            PSOUT ({channels.length} ch · {sampleCount.toLocaleString()} pts)
          </PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Box
            display="flex"
            bg="rgba(0,0,0,0.25)"
            borderRadius="6px"
            p="2px"
            border="1px solid var(--color-border-default)"
          >
            <button
              type="button"
              onClick={() => setViewMode("plot")}
              style={{
                background: viewMode === "plot" ? "rgba(168, 85, 247, 0.25)" : "transparent",
                color: viewMode === "plot" ? "#c084fc" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <PulseIcon size={12} /> Waveforms
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              style={{
                background: viewMode === "code" ? "rgba(168, 85, 247, 0.25)" : "transparent",
                color: viewMode === "code" ? "#c084fc" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <CodeIcon size={12} /> Raw Data
            </button>
          </Box>

          {viewMode === "plot" && (
            <>
              <button
                type="button"
                onClick={() => setCursorMode((v) => !v)}
                style={{
                  fontSize: "11px",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: cursorMode ? "rgba(56, 189, 248, 0.2)" : "transparent",
                  color: cursorMode ? "#38bdf8" : "var(--color-fg-muted)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Toggle Dual Cursors C1/C2"
              >
                Cursors
              </button>
              <button
                type="button"
                onClick={() => setChartMode((m) => (m === "overlay" ? "histogram" : "overlay"))}
                style={{
                  fontSize: "11px",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: chartMode === "histogram" ? "rgba(168, 85, 247, 0.2)" : "transparent",
                  color: chartMode === "histogram" ? "#c084fc" : "var(--color-fg-muted)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Toggle Histogram distribution of primary channel"
              >
                {chartMode === "histogram" ? "Histogram" : "Time"}
              </button>
            </>
          )}

          {numRuns > 1 && (
            <>
              <select
                value={selectedRun}
                disabled={overlayAllRuns}
                onChange={(e) => setSelectedRun(Number(e.target.value))}
                aria-label="Select PSOUT Run"
                style={{
                  fontSize: "11px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg-alt)",
                  color: "var(--color-fg-default)",
                  opacity: overlayAllRuns ? 0.5 : 1,
                }}
              >
                {Array.from({ length: numRuns }, (_, idx) => (
                  <option key={idx} value={idx}>
                    Run #{idx + 1}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOverlayAllRuns((v) => !v)}
                style={{
                  fontSize: "11px",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  background: overlayAllRuns ? "rgba(168, 85, 247, 0.25)" : "transparent",
                  color: overlayAllRuns ? "#c084fc" : "var(--color-fg-muted)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Overlay all runs on the same plot"
              >
                Overlay All ({numRuns})
              </button>
            </>
          )}

          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={DraftingTriangleIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "pscad" as any,
                  code: rawText || `# ${title}\n`,
                  title,
                });
                const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/editor${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Ansatz
            </Button>
          )}
        </Box>
      </Toolbar>

      <ChartContainer>
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="medium" />
          </Box>
        ) : viewMode === "plot" ? (
          dataset && dataset.indexValues.length > 0 && channels.length > 0 ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", maxHeight: "48px", overflowY: "auto" }}>
                {channels.map((ch) => {
                  const active = !hiddenChannels.has(ch);
                  const col = seriesColors[ch]!;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => {
                        setHiddenChannels((prev) => {
                          const next = new Set(prev);
                          if (next.has(ch)) next.delete(ch);
                          else next.add(ch);
                          return next;
                        });
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: "10.5px",
                        padding: "1px 7px",
                        borderRadius: "9999px",
                        border: `1px solid ${active ? col : "var(--color-border-default)"}`,
                        background: active ? "rgba(56, 189, 248, 0.08)" : "transparent",
                        color: active ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                        opacity: active ? 1 : 0.55,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: col }} />
                      {ch}
                    </button>
                  );
                })}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <IndexedCanvasPlot
                  dataset={dataset}
                  mode={chartMode}
                  isDark={true}
                  cursorMode={cursorMode}
                  overlay={{
                    visibleSeries: visibleChannels,
                    seriesColors,
                  }}
                  histogram={{
                    seriesName: visibleChannels[0] ?? channels[0]!,
                    binCount: 24,
                  }}
                />
              </div>
            </>
          ) : (
            <Box
              display="flex"
              flexDirection="column"
              justifyContent="center"
              alignItems="center"
              height="100%"
              color="var(--color-fg-muted)"
              textAlign="center"
              p={4}
            >
              <PulseIcon size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
              <Text style={{ fontSize: "12px" }}>No waveform channels or time series points found in PSOUT data.</Text>
            </Box>
          )
        ) : (
          <Box
            height="100%"
            overflow="auto"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          >
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 10px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "36px",
                      minWidth: "36px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "var(--color-fg-subtle)",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                    {highlightPolyglotLine(line, "csv")}
                  </span>
                </div>
              ))
            ) : (
              <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                height="100%"
                color="var(--color-fg-muted)"
              >
                <Text style={{ fontSize: "12px" }}>No PSOUT waveform trajectory data loaded.</Text>
              </Box>
            )}
          </Box>
        )}
      </ChartContainer>
    </CardWrapper>
  );
};

export default PsoutViewer;
