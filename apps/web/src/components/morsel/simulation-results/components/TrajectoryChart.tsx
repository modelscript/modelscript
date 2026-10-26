// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CustomInspectionTooltip } from "./CustomInspectionTooltip";

export interface TrajectoryChartProps {
  mergedChartData: Record<string, number | string>[];
  xAxisVar: string;
  isNormalized: boolean;
  isLogScale: boolean;
  colorMode: "light" | "dark";
  minMaxMap: Record<string, { min: number; max: number }>;
  isComparingBaseline: boolean;
  cursorMode: boolean;
  cursor1Time: number | null;
  cursor2Time: number | null;
  activeVariables: string[];
  selectedVariables: string[];
  sweepResults?: { value: number; y: number[][] }[] | null | undefined;
  baselineData: Record<string, number | string>[] | null;
  colors: string[];
  onChartClick: (e: any) => void;
}

export const TrajectoryChart: React.FC<TrajectoryChartProps> = ({
  mergedChartData,
  xAxisVar,
  isNormalized,
  isLogScale,
  colorMode,
  minMaxMap,
  isComparingBaseline,
  cursorMode,
  cursor1Time,
  cursor2Time,
  activeVariables,
  selectedVariables,
  sweepResults,
  baselineData,
  colors,
  onChartClick,
}) => {
  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={mergedChartData}
            onClick={onChartClick}
            margin={{
              top: 10,
              right: 30,
              left: 20,
              bottom: 35,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={
                colorMode === "dark" ? "var(--color-border-muted, #30363d)" : "var(--color-border-default, #e1e4e8)"
              }
              opacity={0.6}
            />
            <XAxis
              dataKey={xAxisVar}
              type="number"
              domain={["dataMin", "dataMax"]}
              stroke="var(--color-fg-muted, #8b949e)"
              tick={{ fill: "var(--color-fg-muted, #8b949e)", fontSize: 11 }}
              tickFormatter={(val) => (typeof val === "number" ? val.toFixed(2) : String(val))}
              label={{
                value: xAxisVar === "time" ? "time (s)" : xAxisVar,
                position: "insideBottom",
                offset: -20,
                fill: "var(--color-fg-muted, #8b949e)",
              }}
            />
            <YAxis
              scale={isLogScale ? "log" : "auto"}
              domain={isNormalized ? [0, 100] : isLogScale ? ["auto", "auto"] : ["auto", "auto"]}
              stroke="var(--color-fg-muted, #8b949e)"
              tick={{ fill: "var(--color-fg-muted, #8b949e)", fontSize: 11 }}
              tickFormatter={(val) => (isNormalized ? `${val}%` : Number(val).toFixed(2))}
              label={
                isNormalized
                  ? {
                      value: "Normalized (0–100%)",
                      angle: -90,
                      position: "insideLeft",
                      offset: -5,
                      fill: "var(--color-fg-muted, #8b949e)",
                    }
                  : isLogScale
                    ? {
                        value: "Logarithmic Scale",
                        angle: -90,
                        position: "insideLeft",
                        offset: -5,
                        fill: "var(--color-fg-muted, #8b949e)",
                      }
                    : undefined
              }
            />
            <Tooltip
              cursor={{
                stroke: "var(--color-accent-fg, #58a6ff)",
                strokeWidth: 1.5,
                strokeDasharray: "3 3",
              }}
              content={
                <CustomInspectionTooltip
                  xAxisVar={xAxisVar}
                  minMaxMap={minMaxMap}
                  isNormalized={isNormalized}
                  isComparingBaseline={isComparingBaseline}
                  colorMode={colorMode}
                />
              }
            />

            {/* Interactive Dual Cursors */}
            {cursorMode && cursor1Time !== null && (
              <ReferenceLine
                x={cursor1Time}
                stroke="#06b6d4"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: "C1", fill: "#06b6d4", fontSize: 11, position: "top", fontWeight: 700 }}
              />
            )}
            {cursorMode && cursor2Time !== null && (
              <ReferenceLine
                x={cursor2Time}
                stroke="#ec4899"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: "C2", fill: "#ec4899", fontSize: 11, position: "top", fontWeight: 700 }}
              />
            )}

            {activeVariables.flatMap((v) => {
              if (sweepResults && sweepResults.length > 0) {
                return sweepResults.map((sweep, j) => {
                  const key = `${v} (${sweep.value})`;
                  const colorIdx = (selectedVariables.indexOf(v) * sweepResults.length + j) % colors.length;
                  return (
                    <Line
                      key={key}
                      type="linear"
                      dataKey={key}
                      name={key}
                      stroke={colors[colorIdx]}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  );
                });
              }
              const lines = [
                <Line
                  key={v}
                  type="linear"
                  dataKey={v}
                  name={v}
                  stroke={colors[selectedVariables.indexOf(v) % colors.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />,
              ];
              if (baselineData && isComparingBaseline) {
                const bKey = `${v} [Baseline]`;
                lines.push(
                  <Line
                    key={bKey}
                    type="linear"
                    dataKey={bKey}
                    name={bKey}
                    stroke={colors[selectedVariables.indexOf(v) % colors.length]}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    strokeOpacity={0.55}
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  />,
                );
              }
              return lines;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
