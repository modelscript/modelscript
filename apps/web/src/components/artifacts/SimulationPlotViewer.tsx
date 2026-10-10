// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownloadIcon, GraphIcon, PlayIcon, SearchIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import Papa from "papaparse";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styled from "styled-components";
import Box from "../Box";
import VegaViewer from "./VegaViewer";

const SIM_COLORS = ["#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6"];

interface SimulationPlotViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "380px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
`;

const OverridePill = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary, #8b949e);
  border: 1px solid var(--color-border, #30363d);
`;

const SimulationPlotViewer: React.FC<SimulationPlotViewerProps> = ({ viewConfig, isFullScreen }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, number>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenVars, setHiddenVars] = useState<Set<string>>(new Set());
  const [refAreaLeft, setRefAreaLeft] = useState<number | string>("");
  const [refAreaRight, setRefAreaRight] = useState<number | string>("");
  const [left, setLeft] = useState<number | string>("dataMin");
  const [right, setRight] = useState<number | string>("dataMax");
  const [isLogScale, setIsLogScale] = useState(false);

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === "") {
      setRefAreaLeft("");
      setRefAreaRight("");
      return;
    }
    let [l, r] = [Number(refAreaLeft), Number(refAreaRight)];
    if (l > r) [l, r] = [r, l];
    setLeft(l);
    setRight(r);
    setRefAreaLeft("");
    setRefAreaRight("");
  };

  const zoomOut = () => {
    setLeft("dataMin");
    setRight("dataMax");
    setRefAreaLeft("");
    setRefAreaRight("");
  };

  const exportCsv = () => {
    if (!data || data.length === 0) return;
    const csvString = Papa.unparse(data);
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `${(viewConfig?.model || viewConfig?.title || "simulation_results").replace(/\s+/g, "_")}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    let active = true;

    async function loadData() {
      // 1. Direct data array supplied
      if (Array.isArray(viewConfig?.data) && viewConfig.data.length > 0) {
        setData(viewConfig.data);
        return;
      }

      // 2. CSV URL supplied
      const csvUrl = viewConfig?.csvUrl || viewConfig?.url;
      if (csvUrl && typeof csvUrl === "string" && (csvUrl.endsWith(".csv") || viewConfig?.format === "csv")) {
        setLoading(true);
        try {
          const res = await fetch(csvUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching simulation CSV`);
          const text = await res.text();
          const parsed = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
          });

          if (active && parsed.data && parsed.data.length > 0) {
            setData(parsed.data as any[]);
          }
        } catch (err: any) {
          if (active) setError(err.message || "Failed to load simulation CSV");
        } finally {
          if (active) setLoading(false);
        }
        return;
      }

      // 3. Fallback: generate sample parametric step/frequency response if model specified
      if (viewConfig?.model || viewConfig?.overrides) {
        const samplePoints: Record<string, number>[] = [];
        const nSteps = 50;
        const tEnd = 10;
        const damping = 0.2;
        const freq = 1.5;

        for (let i = 0; i <= nSteps; i++) {
          const t = (i / nSteps) * tEnd;
          const x = 1.0 - Math.exp(-damping * t) * Math.cos(freq * t);
          const v = Math.exp(-damping * t) * (damping * Math.cos(freq * t) + freq * Math.sin(freq * t));
          samplePoints.push({
            time: Number(t.toFixed(2)),
            position: Number(x.toFixed(4)),
            velocity: Number(v.toFixed(4)),
          });
        }
        setData(samplePoints);
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [viewConfig]);

  // Extract plottable variables (keys other than 'time' or 't')
  const variables = useMemo(() => {
    if (!data || data.length === 0) return [];
    const keys = Object.keys(data[0] || {});
    return keys.filter((k) => k !== "time" && k !== "t" && typeof data[0]?.[k] === "number");
  }, [data]);

  const toggleVariable = (varName: string) => {
    setHiddenVars((prev) => {
      const next = new Set(prev);
      if (next.has(varName)) {
        next.delete(varName);
      } else {
        next.add(varName);
      }
      return next;
    });
  };

  const modelName = viewConfig?.model || viewConfig?.title || "Modelica Parametric Simulation";

  // If a Vega specification is provided, delegate directly to VegaViewer
  if (viewConfig?.spec) {
    return <VegaViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
  }

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2}>
          <GraphIcon size={16} fill="var(--color-accent-emphasis, #06b6d4)" />
          <Text fontWeight="bold" fontSize="13px" color="var(--color-text-primary)">
            {modelName}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          {(left !== "dataMin" || right !== "dataMax") && (
            <Button
              size="small"
              onClick={zoomOut}
              style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <SearchIcon size={12} /> Reset Zoom
            </Button>
          )}
          <Button
            size="small"
            onClick={() => setIsLogScale(!isLogScale)}
            title="Toggle Logarithmic Y-axis scale"
            style={{
              background: isLogScale ? "rgba(6, 182, 212, 0.15)" : undefined,
              borderColor: isLogScale ? "rgba(6, 182, 212, 0.4)" : undefined,
              color: isLogScale ? "#06b6d4" : undefined,
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
          >
            {isLogScale ? "Log Y" : "Linear Y"}
          </Button>
          <Button size="small" leadingVisual={DownloadIcon} onClick={exportCsv} title="Download trajectory as CSV">
            CSV
          </Button>
          {viewConfig?.model && (
            <Button
              size="small"
              leadingVisual={PlayIcon}
              onClick={() => {
                const fromArtifact = viewConfig?.artifactId ? `&fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/playground?model=${encodeURIComponent(viewConfig.model)}${fromArtifact}`);
              }}
            >
              Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      {/* Overrides Bar */}
      {viewConfig?.overrides && Object.keys(viewConfig.overrides).length > 0 && (
        <Box
          px={3}
          py={2}
          bg="var(--color-canvas-subtle)"
          borderBottom="1px solid var(--color-border-subtle)"
          display="flex"
          alignItems="center"
          gap={2}
          flexWrap="wrap"
        >
          <Text fontSize="11px" color="var(--color-text-muted)">
            Overrides:
          </Text>
          {Object.entries(viewConfig.overrides).map(([k, v]) => (
            <OverridePill key={k}>
              {k} = {String(v)}
            </OverridePill>
          ))}
        </Box>
      )}

      {/* Main Chart Area */}
      <Box flex={1} p={2} position="relative" minHeight="240px">
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="small" />
          </Box>
        ) : error ? (
          <Box p={4} textAlign="center" color="var(--color-danger-fg)">
            <Text>{error}</Text>
          </Box>
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 10, right: 25, left: 0, bottom: 5 }}
              onMouseDown={(e) => e && e.activeLabel !== undefined && setRefAreaLeft(e.activeLabel)}
              onMouseMove={(e) =>
                refAreaLeft !== "" && e && e.activeLabel !== undefined && setRefAreaRight(e.activeLabel)
              }
              onMouseUp={zoom}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis
                dataKey="time"
                domain={[left, right]}
                type="number"
                allowDataOverflow
                stroke="var(--color-text-muted, #8b949e)"
                fontSize={11}
                tickFormatter={(val) => `${Number(val).toFixed(2)}s`}
              />
              <YAxis
                stroke="var(--color-text-muted, #8b949e)"
                fontSize={11}
                allowDataOverflow
                scale={isLogScale ? "log" : "auto"}
                domain={isLogScale ? ["auto", "auto"] : undefined}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(14, 20, 36, 0.95)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#fff",
                }}
                labelFormatter={(label) => `Time: ${Number(label).toFixed(3)}s`}
              />
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                onClick={(e) => {
                  if (e.dataKey) toggleVariable(String(e.dataKey));
                }}
              />
              {variables.map((v, idx) => (
                <Line
                  key={v}
                  type="monotone"
                  dataKey={v}
                  stroke={SIM_COLORS[idx % SIM_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                  hide={hiddenVars.has(v)}
                />
              ))}
              {refAreaLeft !== "" && refAreaRight !== "" ? (
                <ReferenceArea
                  x1={Number(refAreaLeft)}
                  x2={Number(refAreaRight)}
                  strokeOpacity={0.3}
                  fill="#06b6d4"
                  fillOpacity={0.25}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Text color="var(--color-text-muted)">No simulation trajectory data available.</Text>
          </Box>
        )}
      </Box>
    </Wrapper>
  );
};

export default SimulationPlotViewer;
