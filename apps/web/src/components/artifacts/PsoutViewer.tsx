// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface PsoutViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    title?: string | undefined;
    code?: string | undefined;
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
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
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
  padding: 16px;
  background: var(--color-canvas-inset, #010409);
  overflow: hidden;
`;

const LINE_COLORS = ["#38bdf8", "#f59e0b", "#10b981", "#a855f7", "#ec4899", "#06b6d4"];

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
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"plot" | "code">("plot");
  const title = viewConfig.title || "PSCAD Simulation Waveforms (.psout)";

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
        .catch((err) => console.warn("[PsoutViewer] Failed to fetch PSOUT data:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const { waveformData, channels, timeKey } = useMemo(() => {
    if (viewConfig.data && Array.isArray(viewConfig.data) && viewConfig.data.length > 0) {
      const keys = Object.keys(viewConfig.data[0] || {});
      const tKey = keys.find((k) => /^(t|time)$/i.test(k)) || keys[0] || "time";
      const chs = viewConfig.channels?.length ? viewConfig.channels : keys.filter((k) => k !== tKey);
      return { waveformData: viewConfig.data, channels: chs, timeKey: tKey };
    }
    const parsed = parsePsoutText(rawText);
    return { waveformData: parsed.rows, channels: parsed.channels, timeKey: parsed.timeKey };
  }, [viewConfig.data, viewConfig.channels, rawText]);

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="#c084fc" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>PSOUT Waveform ({channels.length} ch)</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
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

          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "pscad" as any,
                  code: rawText || `# ${title}\n`,
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

      <ChartContainer>
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="medium" />
          </Box>
        ) : viewMode === "plot" && waveformData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={waveformData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey={timeKey} stroke="#8b949e" tick={{ fontSize: 11 }} />
              <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#161b22",
                  borderColor: "#30363d",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              {channels.slice(0, 6).map((ch, idx) => (
                <Line
                  key={ch}
                  type="monotone"
                  dataKey={ch}
                  stroke={LINE_COLORS[idx % LINE_COLORS.length] || "#38bdf8"}
                  dot={false}
                  strokeWidth={1.8}
                  name={ch}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
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
