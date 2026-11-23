// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide — Interactive SVG Webview Panel for Advanced Algorithm Domains.
 *
 * Renders JSON payloads emitted by `@modelscript/simulate/charts`:
 *   - LineChartPayload (Welch PSD, Balanced Truncation Hankel Singular Values, Radiation Oncology DVH)
 *   - SpectrogramPayload (STFT time-frequency heatmap)
 *   - PcbRouteOverlayPayload (Manhattan A* routed PCB nets)
 */

import type { LineChartPayload, PcbRouteOverlayPayload, SpectrogramPayload } from "@modelscript/simulate";
import React from "react";

export type AdvancedAlgoVizPayload = LineChartPayload | SpectrogramPayload | PcbRouteOverlayPayload;

export interface AdvancedAlgoPanelProps {
  readonly payload: AdvancedAlgoVizPayload;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export const AdvancedAlgoPanel: React.FC<AdvancedAlgoPanelProps> = ({ payload, width = 560, height = 300 }) => {
  const pad = 42;
  const plotW = Math.max(40, width - 2 * pad);
  const plotH = Math.max(40, height - 2 * pad);

  if (payload.kind === "line-chart") {
    const series = payload.series[0];
    if (!series || series.x.length === 0) {
      return <div style={{ color: "#94a3b8", fontSize: 12 }}>No chart data available.</div>;
    }
    const xs = series.x;
    const ys = payload.logY ? series.y.map((v) => Math.log10(Math.max(1e-12, Math.abs(v)))) : series.y;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;

    const pts = xs
      .map((x, i) => {
        const px = pad + ((x - minX) / dx) * plotW;
        const py = pad + plotH - ((ys[i]! - minY) / dy) * plotH;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");

    return (
      <svg width={width} height={height} style={{ background: "#0f172a", borderRadius: 8 }}>
        <text x={width / 2} y={20} fill="#e2e8f0" fontSize={13} textAnchor="middle" fontWeight={600}>
          {payload.title}
        </text>
        <rect x={pad} y={pad} width={plotW} height={plotH} fill="none" stroke="#334155" />
        <polyline fill="none" stroke="#38bdf8" strokeWidth={2} points={pts} />
        <text x={width / 2} y={height - 10} fill="#94a3b8" fontSize={11} textAnchor="middle">
          {payload.xLabel}
        </text>
        <text
          x={12}
          y={height / 2}
          fill="#94a3b8"
          fontSize={11}
          textAnchor="middle"
          transform={`rotate(-90 12 ${height / 2})`}
        >
          {payload.yLabel}
        </text>
      </svg>
    );
  }

  if (payload.kind === "spectrogram") {
    const frames = payload.magnitudesDb.length;
    const bins = frames > 0 ? payload.magnitudesDb[0]!.length : 0;
    const cellW = frames > 0 ? plotW / frames : 1;
    const cellH = bins > 0 ? plotH / bins : 1;

    return (
      <svg width={width} height={height} style={{ background: "#0f172a", borderRadius: 8 }}>
        <text x={width / 2} y={20} fill="#e2e8f0" fontSize={13} textAnchor="middle" fontWeight={600}>
          {payload.title}
        </text>
        {payload.magnitudesDb.map((col, ti) =>
          col.map((db, fi) => {
            const norm = Math.max(0, Math.min(1, (db + 80) / 80));
            const hue = Math.round(240 - norm * 210);
            return (
              <rect
                key={`${ti}-${fi}`}
                x={pad + ti * cellW}
                y={pad + plotH - (fi + 1) * cellH}
                width={Math.ceil(cellW)}
                height={Math.ceil(cellH)}
                fill={`hsl(${hue}, 85%, ${Math.round(15 + norm * 50)}%)`}
              />
            );
          }),
        )}
      </svg>
    );
  }

  // PCB Route 2D overlay
  let maxX = 1;
  let maxY = 1;
  for (const net of payload.nets) {
    for (const pt of net.points) {
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  return (
    <svg width={width} height={height} style={{ background: "#0f172a", borderRadius: 8 }}>
      <text x={width / 2} y={20} fill="#e2e8f0" fontSize={13} textAnchor="middle" fontWeight={600}>
        PCB Routed Nets ({payload.nets.length})
      </text>
      <rect x={pad} y={pad} width={plotW} height={plotH} fill="#1e293b" stroke="#475569" />
      {payload.nets.map((net) => {
        const pts = net.points
          .map((p) => `${(pad + (p.x / maxX) * plotW).toFixed(1)},${(pad + (p.y / maxY) * plotH).toFixed(1)}`)
          .join(" ");
        return <polyline key={net.netId} fill="none" stroke={net.color} strokeWidth={2.5} points={pts} />;
      })}
    </svg>
  );
};
