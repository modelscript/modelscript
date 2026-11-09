// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import { useMemo, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

export interface OtdrTraceViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
    wavelengthNm?: number | undefined;
    pulseWidthNs?: number | undefined;
    totalLengthKm?: number | undefined;
    totalLossDb?: number | undefined;
    events?:
      | Array<{
          eventNumber: number;
          distanceMeters: number;
          slopeDbPerKm: number;
          spliceLossDb: number;
          reflectanceDb: number;
          eventType: string;
          isEnd?: boolean;
        }>
      | undefined;
    dataPoints?: Array<{ distanceKm: number; powerDb: number }> | undefined;
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
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Badge = styled.span<{ $variant?: "success" | "danger" | "info" }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: ${(props) =>
    props.$variant === "danger"
      ? "var(--color-danger-subtle, rgba(207, 34, 46, 0.15))"
      : props.$variant === "success"
        ? "var(--color-success-subtle, rgba(46, 160, 67, 0.15))"
        : "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))"};
  color: ${(props) =>
    props.$variant === "danger"
      ? "var(--color-danger-fg, #cf222e)"
      : props.$variant === "success"
        ? "var(--color-success-fg, #1a7f37)"
        : "var(--color-accent-fg, #0969da)"};
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "var(--color-canvas-default)" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "var(--color-border-default)" : "transparent")};
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "600" : "400")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  cursor: pointer;
  &:hover {
    color: var(--color-fg-default);
  }
`;

const ContentArea = styled.div`
  flex: 1 1 auto;
  position: relative;
  overflow: auto;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-default);
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
  th {
    background: var(--color-canvas-subtle);
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-default);
    color: var(--color-fg-muted);
    font-weight: 600;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-muted);
    color: var(--color-fg-default);
  }
  tr:hover {
    background: var(--color-canvas-subtle);
  }
`;

export default function OtdrTraceViewer({ viewConfig, isFullScreen = false }: OtdrTraceViewerProps) {
  const [activeTab, setActiveTab] = useState<"trace" | "events" | "summary">("trace");
  const [copied, setCopied] = useState(false);

  const wavelength = viewConfig.wavelengthNm ?? 1550;
  const pulseWidth = viewConfig.pulseWidthNs ?? 100;
  const totalLengthKm = viewConfig.totalLengthKm ?? 25.0;
  const totalLossDb = viewConfig.totalLossDb ?? 5.25;

  const defaultEvents = useMemo(
    () => [
      {
        eventNumber: 1,
        distanceMeters: 0,
        slopeDbPerKm: 0.2,
        spliceLossDb: 0.45,
        reflectanceDb: -42.5,
        eventType: "Front Connector",
      },
      {
        eventNumber: 2,
        distanceMeters: 8500,
        slopeDbPerKm: 0.19,
        spliceLossDb: 0.08,
        reflectanceDb: -65.0,
        eventType: "Fusion Splice",
      },
      {
        eventNumber: 3,
        distanceMeters: 17200,
        slopeDbPerKm: 0.21,
        spliceLossDb: 0.12,
        reflectanceDb: -63.0,
        eventType: "Fusion Splice",
      },
      {
        eventNumber: 4,
        distanceMeters: 25000,
        slopeDbPerKm: 0.2,
        spliceLossDb: 28.0,
        reflectanceDb: -14.2,
        eventType: "End of Fiber (Reflection)",
        isEnd: true,
      },
    ],
    [],
  );

  const events = viewConfig.events && viewConfig.events.length > 0 ? viewConfig.events : defaultEvents;

  // Generate synthetic backscatter points if not provided
  const tracePoints = useMemo(() => {
    if (viewConfig.dataPoints && viewConfig.dataPoints.length > 0) {
      return viewConfig.dataPoints;
    }
    const pts: { distanceKm: number; powerDb: number }[] = [];
    const maxKm = totalLengthKm * 1.1;
    const stepKm = maxKm / 200;

    let currentLoss = 0.0;
    for (let km = 0; km <= maxKm; km += stepKm) {
      // Base Rayleigh backscatter slope (approx 0.20 dB/km)
      const basePower = -10.0 - km * 0.2 - currentLoss;

      // Check for event spikes / drops
      const m = km * 1000;
      let spike = 0.0;
      for (const ev of events) {
        if (Math.abs(m - ev.distanceMeters) < (stepKm * 1000) / 2) {
          if (ev.reflectanceDb > -50.0) {
            spike = Math.min(25.0, -ev.reflectanceDb * 0.25);
          }
          currentLoss += ev.spliceLossDb;
        }
      }

      // Deterministic pseudo-noise for pure rendering without Math.random
      const pseudoNoise = (seed: number) => {
        const x = Math.sin(seed * 12345.67) * 43758.5453;
        return x - Math.floor(x) - 0.5;
      };

      // Past fiber end drops to noise floor (-45 dB)
      if (km > totalLengthKm) {
        pts.push({ distanceKm: km, powerDb: -42.0 + pseudoNoise(km * 9.87) * 1.5 });
      } else {
        const noise = pseudoNoise(km * 17.13) * 0.15;
        pts.push({ distanceKm: km, powerDb: basePower + spike + noise });
      }
    }
    return pts;
  }, [viewConfig.dataPoints, totalLengthKm, events]);

  const hasHighLossEvent = events.some((e) => !e.isEnd && e.spliceLossDb > 0.3);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify({ events, totalLengthKm, totalLossDb }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <ToolbarGroup>
          <Box style={{ fontWeight: 600, fontSize: 13 }}>
            {viewConfig.title ?? "Telcordia GR-196 OTDR Optical Trace"}
          </Box>
          <Badge $variant="info">{wavelength} nm</Badge>
          <Badge $variant="info">{pulseWidth} ns</Badge>
          <Badge $variant={hasHighLossEvent ? "danger" : "success"}>
            {hasHighLossEvent ? "Fault Detected" : "Pass (GR-196)"}
          </Badge>
        </ToolbarGroup>
        <ToolbarGroup>
          <TabButton $active={activeTab === "trace"} onClick={() => setActiveTab("trace")}>
            Trace Graph
          </TabButton>
          <TabButton $active={activeTab === "events"} onClick={() => setActiveTab("events")}>
            Event Table ({events.length})
          </TabButton>
          <TabButton $active={activeTab === "summary"} onClick={() => setActiveTab("summary")}>
            Summary
          </TabButton>
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <ContentArea>
        {activeTab === "trace" && (
          <div style={{ width: "100%", height: "100%", padding: 16, boxSizing: "border-box" }}>
            <svg
              viewBox="0 0 800 360"
              style={{ width: "100%", height: "100%", background: "var(--color-canvas-subtle)", borderRadius: 6 }}
            >
              {/* Grid Lines */}
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const y = 30 + i * 55;
                const db = (0 - i * 8).toFixed(0);
                return (
                  <g key={`y-${i}`}>
                    <line x1={60} y1={y} x2={760} y2={y} stroke="var(--color-border-muted)" strokeDasharray="3 3" />
                    <text x={45} y={y + 4} fontSize={10} fill="var(--color-fg-muted)" textAnchor="end">
                      {db} dB
                    </text>
                  </g>
                );
              })}
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const x = 60 + i * 140;
                const km = ((i * totalLengthKm * 1.1) / 5).toFixed(1);
                return (
                  <g key={`x-${i}`}>
                    <line x1={x} y1={30} x2={x} y2={305} stroke="var(--color-border-muted)" strokeDasharray="3 3" />
                    <text x={x} y={325} fontSize={10} fill="var(--color-fg-muted)" textAnchor="middle">
                      {km} km
                    </text>
                  </g>
                );
              })}

              {/* Axis Labels */}
              <text x={410} y={345} fontSize={11} fontWeight={600} fill="var(--color-fg-default)" textAnchor="middle">
                Distance (km)
              </text>
              <text
                x={18}
                y={170}
                fontSize={11}
                fontWeight={600}
                fill="var(--color-fg-default)"
                transform="rotate(-90, 18, 170)"
                textAnchor="middle"
              >
                Relative Power (dB)
              </text>

              {/* Trace Polyline */}
              {tracePoints.length > 1 && (
                <polyline
                  fill="none"
                  stroke="var(--color-accent-fg, #0969da)"
                  strokeWidth="2"
                  points={tracePoints
                    .map((pt) => {
                      const x = 60 + (pt.distanceKm / (totalLengthKm * 1.1)) * 700;
                      // Power scale: 0 dB at y=30, -45 dB at y=305
                      const y = 30 + (Math.abs(pt.powerDb) / 45) * 275;
                      return `${Math.max(60, Math.min(760, x))},${Math.max(30, Math.min(305, y))}`;
                    })
                    .join(" ")}
                />
              )}

              {/* Event Markers */}
              {events.map((ev) => {
                const km = ev.distanceMeters / 1000;
                const x = 60 + (km / (totalLengthKm * 1.1)) * 700;
                return (
                  <g key={`marker-${ev.eventNumber}`}>
                    <line
                      x1={x}
                      y1={30}
                      x2={x}
                      y2={305}
                      stroke="var(--color-danger-fg, #cf222e)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <circle cx={x} cy={60} r={4} fill="var(--color-danger-fg, #cf222e)" />
                    <text
                      x={x}
                      y={22}
                      fontSize={10}
                      fontWeight={600}
                      fill="var(--color-danger-fg, #cf222e)"
                      textAnchor="middle"
                    >
                      E{ev.eventNumber}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {activeTab === "events" && (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Distance (km)</th>
                <th>Splice Loss (dB)</th>
                <th>Reflectance (dB)</th>
                <th>Slope (dB/km)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const isFail = !ev.isEnd && ev.spliceLossDb > 0.3;
                return (
                  <tr key={ev.eventNumber}>
                    <td style={{ fontWeight: 600 }}>E{ev.eventNumber}</td>
                    <td>{ev.eventType}</td>
                    <td>{(ev.distanceMeters / 1000).toFixed(3)}</td>
                    <td
                      style={{ color: isFail ? "var(--color-danger-fg)" : "inherit", fontWeight: isFail ? 600 : 400 }}
                    >
                      {ev.spliceLossDb.toFixed(2)} dB
                    </td>
                    <td>{ev.reflectanceDb <= -60 ? "<-60 dB" : `${ev.reflectanceDb.toFixed(1)} dB`}</td>
                    <td>{ev.slopeDbPerKm.toFixed(3)}</td>
                    <td>
                      <Badge $variant={isFail ? "danger" : "success"}>{isFail ? "Fail (>0.3dB)" : "Pass"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {activeTab === "summary" && (
          <div style={{ padding: 20 }}>
            <h4 style={{ margin: "0 0 16px 0" }}>Fiber Span Metrics & Compliance</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <div style={{ padding: 12, background: "var(--color-canvas-subtle)", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>Total Optical Length</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{totalLengthKm.toFixed(3)} km</div>
              </div>
              <div style={{ padding: 12, background: "var(--color-canvas-subtle)", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>End-to-End Cumulative Loss</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{totalLossDb.toFixed(2)} dB</div>
              </div>
              <div style={{ padding: 12, background: "var(--color-canvas-subtle)", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>Mean Attenuation</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{(totalLossDb / totalLengthKm).toFixed(3)} dB/km</div>
              </div>
              <div style={{ padding: 12, background: "var(--color-canvas-subtle)", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>Telcordia GR-196 Status</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: hasHighLossEvent ? "var(--color-danger-fg)" : "var(--color-success-fg)",
                  }}
                >
                  {hasHighLossEvent ? "REJECT (Excess Loss)" : "ACCEPT (Within Spec)"}
                </div>
              </div>
            </div>
          </div>
        )}
      </ContentArea>
    </CardWrapper>
  );
}
