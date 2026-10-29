// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CheckIcon, CpuIcon, FlameIcon, PlayIcon, PulseIcon, XIcon } from "@primer/octicons-react";
import { Button, Flash, Heading, Label, Spinner, Text } from "@primer/react";
import axios from "axios";
import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import { useAuth } from "../../AuthContext";
import Box from "../Box";

export interface TelemetryPoint {
  t: number;
  meas: number;
  baseline: number;
  twin: number;
}

export interface DigitalTwinHotspot {
  id: string;
  name: string;
  domain: string;
  coords: [number, number, number];
  value: number;
  nominal: number;
  unit: string;
  deltaPct: number;
  severity: "normal" | "warning" | "critical";
}

export interface DigitalTwinViewerConfig {
  twinId?: number | undefined;
  twinName?: string | undefined;
  instanceSerial?: string | undefined;
  modelicaClass?: string | undefined;
  channel?: string | undefined;
  severity?: "low" | "medium" | "high" | undefined;
  healthScore?: number | undefined;
  rulHours?: number | undefined;
  adaptationId?: number | undefined;
  proposalId?: number | undefined;
  driftEventTime?: number | undefined;
  driftEventLabel?: string | undefined;
  optimizationSummary?: string | undefined;
  driftMetrics?:
    | {
        score: number;
        direction: string;
        magnitude: number;
      }
    | undefined;
  parameterDeltas?:
    | Record<
        string,
        {
          prior: number;
          calibrated: number;
          deltaPct: number;
        }
      >
    | undefined;
  calibratedParameters?: Record<string, number> | undefined;
  alertTime?: string | undefined;
  telemetry?: TelemetryPoint[] | undefined;
  initialSeries?: TelemetryPoint[] | undefined;
  hotspots?: Partial<DigitalTwinHotspot>[] | undefined;
}

interface DigitalTwinDashboardViewerProps {
  viewConfig: DigitalTwinViewerConfig;
  isFullScreen?: boolean | undefined;
}

interface LoadedTwinData {
  proposals?: { id: number; status: "open" | "approved" | "rejected" }[] | undefined;
  activeSession?: { healthScore?: number | undefined } | undefined;
}

async function injectTwinTelemetry(
  twinId: number,
  timestamp: number,
  channels: { name: string; value: number }[],
): Promise<any> {
  const { data } = await api.post(`/twins/${twinId}/telemetry`, { timestamp, channels });
  return data;
}

export const DigitalTwinDashboardViewer: React.FC<DigitalTwinDashboardViewerProps> = ({ viewConfig }) => {
  let user: { id: number } | null = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    user = null;
  }

  const twinId = viewConfig.twinId ?? 1;
  const [twinData, setTwinData] = useState<LoadedTwinData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<"open" | "approved" | "rejected">("open");
  const [activeTab, setActiveTab] = useState<"telemetry" | "hotspots" | "proposals">("telemetry");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);

  // Initialize telemetry from viewConfig.telemetry or viewConfig.initialSeries (or empty array waiting for live MQTT/WebSocket stream)
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>(
    () => viewConfig.telemetry ?? viewConfig.initialSeries ?? [],
  );

  useEffect(() => {
    const initial = viewConfig.telemetry ?? viewConfig.initialSeries;
    setTelemetry(Array.isArray(initial) ? initial : []);
  }, [viewConfig.telemetry, viewConfig.initialSeries]);

  // Subscribe to live twin SSE / WebSocket stream when available
  useEffect(() => {
    if (!twinId || typeof EventSource === "undefined") return;
    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource(`/api/v1/twins/${twinId}/stream`);
      evtSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && typeof payload.t === "number" && typeof payload.meas === "number") {
            setTelemetry((prev) => [
              ...prev.slice(-199),
              {
                t: payload.t,
                meas: payload.meas,
                baseline: typeof payload.baseline === "number" ? payload.baseline : payload.meas,
                twin: typeof payload.twin === "number" ? payload.twin : payload.meas,
              },
            ]);
          }
        } catch {
          // Ignore malformed stream frame
        }
      };
    } catch {
      // Ignore stream connection errors in offline mode
    }
    return () => {
      evtSource?.close();
    };
  }, [twinId]);

  useEffect(() => {
    async function loadTwinDetails() {
      if (!twinId) return;
      try {
        const { data } = await api.get(`/twins/${twinId}`);
        setTwinData(data);
        if (data.proposals && data.proposals.length > 0) {
          setProposalStatus(data.proposals[0].status);
        }
      } catch {
        // Fallback to embedded viewConfig
      }
    }
    loadTwinDetails();
  }, [twinId]);

  const deltas = viewConfig.parameterDeltas ?? {};
  const healthScore = viewConfig.healthScore ?? twinData?.activeSession?.healthScore ?? 85.0;
  const rulHours = viewConfig.rulHours;

  const handleInjectTestStep = async () => {
    setActionMessage(null);
    const nextT = telemetry.length > 0 ? Number((telemetry[telemetry.length - 1]!.t + 1.0).toFixed(1)) : 0.0;
    try {
      const data = await injectTwinTelemetry(twinId, nextT, [
        { name: viewConfig.channel || "y_meas", value: telemetry[telemetry.length - 1]?.meas ?? 0 },
      ]);
      if (Array.isArray(data?.telemetry)) {
        setTelemetry(data.telemetry);
      } else if (typeof data?.meas === "number" || typeof data?.y_meas === "number") {
        const measVal = Number(data.meas ?? data.y_meas);
        const twinVal = Number(data.twin ?? data.y_twin ?? measVal);
        const baseVal = Number(data.baseline ?? data.y_nominal ?? twinVal);
        setTelemetry((prev) => [
          ...prev,
          { t: Number(data.t ?? nextT), meas: measVal, baseline: baseVal, twin: twinVal },
        ]);
      }
    } catch (err: unknown) {
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { error?: string | undefined })?.error) ||
        (err instanceof Error ? err.message : "Failed to inject telemetry step");
      setActionMessage(`Telemetry injection failed: ${msg}`);
    }
  };

  const reviewGovernanceProposal = async (action: "approve" | "reject", notes: string) => {
    const proposalId = viewConfig.proposalId ?? twinData?.proposals?.[0]?.id ?? 1;
    await api.post(`/twins/${twinId}/proposals/${proposalId}/${action}`, {
      reviewerId: user?.id ?? 0,
      notes,
    });
  };

  const handleApproveProposal = async () => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      await reviewGovernanceProposal("approve", "Approved based on CUSUM telemetry verification.");
      setProposalStatus("approved");
      setActionMessage("Physics Pull Request approved! Active model baseline updated.");
    } catch (err: unknown) {
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { error?: string | undefined })?.error) ||
        (err instanceof Error ? err.message : "Unknown error");
      setActionMessage(`Approval failed: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectProposal = async () => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      await reviewGovernanceProposal("reject", "Rejected by engineer.");
      setProposalStatus("rejected");
      setActionMessage("Proposal rejected.");
    } catch (err: unknown) {
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { error?: string | undefined })?.error) ||
        (err instanceof Error ? err.message : String(err));
      setActionMessage(`Error: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Compute spatial hotspots from viewConfig.hotspots
  const computedHotspots = useMemo<DigitalTwinHotspot[]>(() => {
    if (!Array.isArray(viewConfig.hotspots) || viewConfig.hotspots.length === 0) {
      return [];
    }
    return viewConfig.hotspots
      .filter((h): h is Partial<DigitalTwinHotspot> & { value: number } => typeof h.value === "number")
      .map((h, idx) => {
        const value = h.value;
        const nominal = h.nominal ?? value;
        const deltaPct = h.deltaPct ?? (nominal !== 0 ? ((value - nominal) / Math.abs(nominal)) * 100 : 0);
        const severity: DigitalTwinHotspot["severity"] =
          h.severity ?? (Math.abs(deltaPct) > 25 ? "critical" : Math.abs(deltaPct) > 10 ? "warning" : "normal");
        return {
          id: h.id || `hotspot-${idx}`,
          name: h.name || `Node #${idx + 1}`,
          domain: h.domain || "modelica",
          coords: h.coords || [0, 0, 0],
          value,
          nominal,
          unit: h.unit || "°C",
          deltaPct,
          severity,
        };
      });
  }, [viewConfig.hotspots]);

  const activeHotspot = useMemo(
    () => computedHotspots.find((h) => h.id === selectedHotspotId) ?? computedHotspots[0] ?? null,
    [computedHotspots, selectedHotspotId],
  );

  // Render SVG Sparkline with dynamic parameter-aware bounds
  const { minVal, maxVal, gridLevels } = useMemo(() => {
    const allVals: number[] = [];
    for (const p of telemetry) {
      if (Number.isFinite(p.meas)) allVals.push(p.meas);
      if (Number.isFinite(p.baseline)) allVals.push(p.baseline);
      if (Number.isFinite(p.twin)) allVals.push(p.twin);
    }
    if (allVals.length === 0) {
      return { minVal: 20.0, maxVal: 50.0, gridLevels: [25, 35, 45] };
    }
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const span = Math.max(10.0, rawMax - rawMin);
    const lo = Math.floor(rawMin - span * 0.15);
    const hi = Math.ceil(rawMax + span * 0.15);
    const mid = Math.round((lo + hi) / 2);
    return {
      minVal: lo,
      maxVal: hi,
      gridLevels: [Math.round(lo + (hi - lo) * 0.2), mid, Math.round(lo + (hi - lo) * 0.8)],
    };
  }, [telemetry]);
  const width = 640;
  const height = 180;
  const pad = 24;
  const maxTime = useMemo(() => Math.max(20.0, ...telemetry.map((p) => (Number.isFinite(p.t) ? p.t : 0))), [telemetry]);

  const toX = (t: number) => pad + (t / maxTime) * (width - 2 * pad);
  const toY = (val: number) => height - pad - ((val - minVal) / Math.max(1e-6, maxVal - minVal)) * (height - 2 * pad);

  const measPath = telemetry
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.meas).toFixed(1)}`)
    .join(" ");

  const baselinePath = telemetry
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.baseline).toFixed(1)}`)
    .join(" ");

  const twinPath = telemetry
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.twin).toFixed(1)}`)
    .join(" ");

  return (
    <Box
      sx={{
        backgroundColor: "canvas.default",
        border: "1px solid",
        borderColor: "border.default",
        borderRadius: 2,
        overflow: "hidden",
        fontFamily: "sans-serif",
      }}
    >
      {/* Header bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 3,
          backgroundColor: "canvas.subtle",
          borderBottom: "1px solid",
          borderColor: "border.default",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <PulseIcon size={18} fill="var(--color-success-fg)" />
          <Heading sx={{ fontSize: 2, fontWeight: "bold" }}>
            {viewConfig.twinName || "Operational Digital Twin"}
          </Heading>
          <Label variant="accent">
            {viewConfig.instanceSerial ? `#${viewConfig.instanceSerial.replace(/^#/, "")}` : "—"}
          </Label>
          <Label variant={healthScore < 80 ? "attention" : "success"}>Health: {healthScore.toFixed(0)}%</Label>
        </Box>

        {/* Tab switcher */}
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="small"
            variant={activeTab === "telemetry" ? "primary" : "invisible"}
            onClick={() => setActiveTab("telemetry")}
          >
            Telemetry & Drift
          </Button>
          <Button
            size="small"
            variant={activeTab === "hotspots" ? "primary" : "invisible"}
            onClick={() => setActiveTab("hotspots")}
          >
            3D Hotspots
          </Button>
          <Button
            size="small"
            variant={activeTab === "proposals" ? "primary" : "invisible"}
            onClick={() => setActiveTab("proposals")}
          >
            Physics PR {proposalStatus === "open" && <Label variant="severe">1</Label>}
          </Button>
        </Box>
      </Box>

      {/* Main content body */}
      <Box sx={{ p: 3 }}>
        {activeTab === "telemetry" && (
          <Box>
            {/* KPI Badges */}
            <Box sx={{ display: "flex", gap: 3, mb: 3 }}>
              <Box
                sx={{
                  flex: 1,
                  p: 2,
                  backgroundColor: "canvas.inset",
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "border.subtle",
                }}
              >
                <Text sx={{ color: "fg.muted", fontSize: 0 }}>CUSUM Residual Shift</Text>
                <Heading sx={{ fontSize: 3, color: "danger.fg", mt: 1 }}>
                  {viewConfig.driftMetrics?.score !== undefined ? `+${viewConfig.driftMetrics.score.toFixed(1)}σ` : "—"}
                </Heading>
                <Text sx={{ fontSize: 0, color: "fg.muted" }}>Channel: {viewConfig.channel || "—"}</Text>
              </Box>

              <Box
                sx={{
                  flex: 1,
                  p: 2,
                  backgroundColor: "canvas.inset",
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "border.subtle",
                }}
              >
                <Text sx={{ color: "fg.muted", fontSize: 0 }}>Calibrated R_th</Text>
                <Heading sx={{ fontSize: 3, color: "accent.fg", mt: 1 }}>
                  {viewConfig.calibratedParameters?.["R_th"] !== undefined ? (
                    <>
                      {viewConfig.calibratedParameters["R_th"].toFixed(3)}{" "}
                      <Text sx={{ fontSize: 1, fontWeight: "normal" }}>K/W</Text>
                    </>
                  ) : (
                    "—"
                  )}
                </Heading>
                <Text sx={{ fontSize: 0, color: deltas["R_th"]?.deltaPct !== undefined ? "danger.fg" : "fg.muted" }}>
                  {deltas["R_th"]?.deltaPct !== undefined
                    ? `${deltas["R_th"].deltaPct >= 0 ? "+" : ""}${deltas["R_th"].deltaPct.toFixed(1)}% Degradation`
                    : "—"}
                </Text>
              </Box>

              <Box
                sx={{
                  flex: 1,
                  p: 2,
                  backgroundColor: "canvas.inset",
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "border.subtle",
                }}
              >
                <Text sx={{ color: "fg.muted", fontSize: 0 }}>Projected RUL</Text>
                <Heading sx={{ fontSize: 3, color: "severe.fg", mt: 1 }}>
                  {rulHours !== undefined ? (
                    <>
                      {rulHours.toFixed(0)} <Text sx={{ fontSize: 1, fontWeight: "normal" }}>hours</Text>
                    </>
                  ) : (
                    "—"
                  )}
                </Heading>
                <Text sx={{ fontSize: 0, color: "fg.muted" }}>Confidence: P10-P90</Text>
              </Box>
            </Box>

            {/* Live Dual Plot */}
            <Box
              sx={{
                p: 2,
                backgroundColor: "canvas.inset",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "border.default",
                mb: 2,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 2,
                  flexWrap: "wrap",
                  gap: 2,
                }}
              >
                <Text sx={{ fontWeight: "bold", fontSize: 1 }}>
                  Innovation Residual Tracking: Sensor vs Twin vs Nominal Design
                </Text>
                <Box sx={{ display: "flex", alignItems: "center", gap: 3, fontSize: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        backgroundColor: "var(--color-accent-cyan)",
                        borderRadius: "50%",
                      }}
                    />
                    <Text>Physical Telemetry (y_meas)</Text>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 14, height: 2, backgroundColor: "var(--color-accent-purple)" }} />
                    <Text>Self-Updated Twin (y_twin)</Text>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 14, height: 2, borderTop: "2px dashed var(--color-danger-fg)" }} />
                    <Text>Nominal Baseline (y_nominal)</Text>
                  </Box>
                  <Button size="small" leadingVisual={PlayIcon} onClick={handleInjectTestStep}>
                    Inject Test Step
                  </Button>
                </Box>
              </Box>

              {actionMessage && activeTab === "telemetry" && (
                <Flash variant="danger" sx={{ mb: 2 }}>
                  {actionMessage}
                </Flash>
              )}

              {telemetry.length === 0 ? (
                <Box
                  sx={{
                    py: 4,
                    px: 3,
                    textAlign: "center",
                    border: "1px dashed",
                    borderColor: "border.subtle",
                    borderRadius: 2,
                  }}
                >
                  <Text sx={{ color: "fg.muted", display: "block", mb: 2, fontSize: 1 }}>
                    Waiting for live MQTT / WebSocket telemetry stream on channel{" "}
                    <strong>{viewConfig.channel || "—"}</strong>...
                  </Text>
                  <Button size="small" variant="primary" leadingVisual={PlayIcon} onClick={handleInjectTestStep}>
                    Inject Test Step
                  </Button>
                </Box>
              ) : (
                <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
                  {/* Horizontal gridlines */}
                  {gridLevels.map((val) => (
                    <g key={val}>
                      <line
                        x1={pad}
                        y1={toY(val)}
                        x2={width - pad}
                        y2={toY(val)}
                        stroke="var(--color-border-default)"
                        strokeDasharray="2 4"
                        strokeWidth="0.5"
                      />
                      <text x={pad - 4} y={toY(val) + 4} fill="var(--color-fg-muted)" fontSize="9" textAnchor="end">
                        {val}°C
                      </text>
                    </g>
                  ))}

                  {/* Optional vertical drift detection boundary */}
                  {typeof viewConfig.driftEventTime === "number" && (
                    <>
                      <line
                        x1={toX(viewConfig.driftEventTime)}
                        y1={pad}
                        x2={toX(viewConfig.driftEventTime)}
                        y2={height - pad}
                        stroke="var(--color-danger-fg)"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={toX(viewConfig.driftEventTime) + 4}
                        y={pad + 12}
                        fill="var(--color-danger-fg)"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        {viewConfig.driftEventLabel || `CUSUM Drift Event (t = ${viewConfig.driftEventTime}s)`}
                      </text>
                    </>
                  )}

                  {/* Trajectories */}
                  <path
                    d={baselinePath}
                    fill="none"
                    stroke="var(--color-danger-fg)"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <path d={twinPath} fill="none" stroke="var(--color-accent-purple)" strokeWidth="2.5" />
                  <path d={measPath} fill="none" stroke="var(--color-accent-cyan)" strokeWidth="1.5" opacity="0.9" />
                </svg>
              )}
            </Box>
          </Box>
        )}

        {activeTab === "hotspots" && (
          <Box
            sx={{
              p: 3,
              backgroundColor: "canvas.inset",
              borderRadius: 2,
              border: "1px solid",
              borderColor: "border.default",
            }}
          >
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 3,
                flexWrap: "wrap",
                gap: 2,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <FlameIcon size={20} fill="var(--color-attention-fg)" />
                <Box>
                  <Heading sx={{ fontSize: 2 }}>3D Spatial Thermal &amp; Stress Hotspot Map</Heading>
                  <Text sx={{ color: "fg.muted", fontSize: 0 }}>
                    Reconstructed from Reduced-Order FEA/CFD &amp; Digital Thread Twin Bindings
                  </Text>
                </Box>
              </Box>
              {activeHotspot && (
                <Label
                  variant={
                    activeHotspot.severity === "critical"
                      ? "danger"
                      : activeHotspot.severity === "warning"
                        ? "attention"
                        : "success"
                  }
                >
                  Active Node: {activeHotspot.name} ({activeHotspot.value.toFixed(1)} {activeHotspot.unit})
                </Label>
              )}
            </Box>

            {computedHotspots.length === 0 ? (
              <Box
                sx={{
                  py: 4,
                  px: 3,
                  textAlign: "center",
                  border: "1px dashed",
                  borderColor: "border.subtle",
                  borderRadius: 2,
                }}
              >
                <Text sx={{ color: "fg.muted", fontSize: 1 }}>No 3D thermal or stress hotspots available.</Text>
              </Box>
            ) : (
              <>
                {activeHotspot && (
                  <Box
                    sx={{
                      mb: 3,
                      p: 2,
                      borderRadius: 2,
                      backgroundColor: "canvas.subtle",
                      border: "1px solid",
                      borderColor: "border.default",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 0,
                      flexWrap: "wrap",
                      gap: 2,
                    }}
                  >
                    <Text>
                      <strong>3D Node Inspection:</strong> {activeHotspot.name} [{activeHotspot.domain.toUpperCase()}]
                      at ({activeHotspot.coords[0]}, {activeHotspot.coords[1]}, {activeHotspot.coords[2]}) mm
                    </Text>
                    <Text>
                      Field:{" "}
                      <strong>
                        {activeHotspot.value.toFixed(1)} {activeHotspot.unit}
                      </strong>{" "}
                      vs Nominal {activeHotspot.nominal.toFixed(1)} {activeHotspot.unit} (
                      {activeHotspot.deltaPct >= 0 ? "+" : ""}
                      {activeHotspot.deltaPct.toFixed(1)}%)
                    </Text>
                  </Box>
                )}

                {/* Hotspot Table */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--color-border-default)",
                        textAlign: "left",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      <th style={{ padding: "6px 8px" }}>Hotspot Node</th>
                      <th style={{ padding: "6px 8px" }}>Domain</th>
                      <th style={{ padding: "6px 8px" }}>Spatial Coords (mm)</th>
                      <th style={{ padding: "6px 8px" }}>Reconstructed Field</th>
                      <th style={{ padding: "6px 8px" }}>Nominal</th>
                      <th style={{ padding: "6px 8px" }}>Delta</th>
                      <th style={{ padding: "6px 8px" }}>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computedHotspots.map((hs) => {
                      const isSelected = activeHotspot?.id === hs.id;
                      return (
                        <tr
                          key={hs.id}
                          onClick={() => setSelectedHotspotId(hs.id)}
                          style={{
                            borderBottom: "1px solid var(--color-border-muted)",
                            cursor: "pointer",
                            backgroundColor: isSelected ? "var(--color-accent-subtle)" : "transparent",
                          }}
                        >
                          <td style={{ padding: "8px", fontWeight: "bold" }}>{hs.name}</td>
                          <td style={{ padding: "8px", textTransform: "uppercase", color: "var(--color-fg-muted)" }}>
                            {hs.domain}
                          </td>
                          <td style={{ padding: "8px", fontFamily: "monospace" }}>
                            ({hs.coords[0]}, {hs.coords[1]}, {hs.coords[2]})
                          </td>
                          <td style={{ padding: "8px", fontWeight: "bold", color: "var(--color-accent-cyan)" }}>
                            {hs.value.toFixed(1)} {hs.unit}
                          </td>
                          <td style={{ padding: "8px" }}>
                            {hs.nominal.toFixed(1)} {hs.unit}
                          </td>
                          <td
                            style={{
                              padding: "8px",
                              color: hs.deltaPct > 10 ? "var(--color-danger-fg)" : "var(--color-success-fg)",
                            }}
                          >
                            {hs.deltaPct >= 0 ? "+" : ""}
                            {hs.deltaPct.toFixed(1)}%
                          </td>
                          <td style={{ padding: "8px" }}>
                            <Label
                              variant={
                                hs.severity === "critical"
                                  ? "danger"
                                  : hs.severity === "warning"
                                    ? "attention"
                                    : "success"
                              }
                            >
                              {hs.severity.toUpperCase()}
                            </Label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </Box>
        )}

        {activeTab === "proposals" && (
          <Box>
            <Box
              sx={{
                p: 3,
                backgroundColor: "canvas.inset",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "border.default",
              }}
            >
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <CpuIcon size={18} />
                  <Text sx={{ fontWeight: "bold", fontSize: 2 }}>
                    Physics Pull Request {viewConfig.proposalId !== undefined ? `#${viewConfig.proposalId}` : "—"}:
                    Parameter Recalibration
                  </Text>
                </Box>
                <Label
                  variant={
                    proposalStatus === "approved" ? "success" : proposalStatus === "rejected" ? "danger" : "attention"
                  }
                >
                  {proposalStatus.toUpperCase()}
                </Label>
              </Box>

              {viewConfig.optimizationSummary && (
                <Text sx={{ fontSize: 1, color: "fg.muted", mb: 3, display: "block" }}>
                  {viewConfig.optimizationSummary}
                </Text>
              )}

              {/* Parameter Delta Table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--color-border-default)",
                      textAlign: "left",
                      color: "var(--color-fg-muted)",
                    }}
                  >
                    <th style={{ padding: "6px 8px" }}>Parameter</th>
                    <th style={{ padding: "6px 8px" }}>Nominal Design</th>
                    <th style={{ padding: "6px 8px" }}>Calibrated Field</th>
                    <th style={{ padding: "6px 8px" }}>Delta</th>
                    <th style={{ padding: "6px 8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(deltas).length > 0 ? (
                    Object.entries(deltas).map(([name, d]) => (
                      <tr key={name} style={{ borderBottom: "1px solid #21262d" }}>
                        <td style={{ padding: "8px", fontWeight: "bold" }}>`{name}`</td>
                        <td style={{ padding: "8px" }}>{d.prior.toFixed(4)}</td>
                        <td style={{ padding: "8px", color: "var(--color-accent-cyan, #06b6d4)" }}>
                          {d.calibrated.toFixed(4)}
                        </td>
                        <td style={{ padding: "8px", color: d.deltaPct >= 0 ? "#f85149" : "#3fb950" }}>
                          {d.deltaPct >= 0 ? "+" : ""}
                          {d.deltaPct.toFixed(1)}%
                        </td>
                        <td style={{ padding: "8px" }}>
                          <Label variant="severe">Degraded</Label>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr style={{ borderBottom: "1px solid #21262d" }}>
                      <td colSpan={5} style={{ padding: "12px 8px", textAlign: "center", color: "#8b949e" }}>
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {actionMessage && (
                <Flash variant={proposalStatus === "approved" ? "success" : "default"} sx={{ mb: 3 }}>
                  {actionMessage}
                </Flash>
              )}

              {/* Action buttons */}
              {proposalStatus === "open" ? (
                <Box sx={{ display: "flex", gap: 2 }}>
                  <Button
                    variant="primary"
                    leadingVisual={CheckIcon}
                    onClick={handleApproveProposal}
                    disabled={actionLoading}
                  >
                    {actionLoading ? <Spinner size="small" /> : "Approve Adaptation Baseline"}
                  </Button>
                  <Button
                    variant="danger"
                    leadingVisual={XIcon}
                    onClick={handleRejectProposal}
                    disabled={actionLoading}
                  >
                    Reject Proposal
                  </Button>
                </Box>
              ) : (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    color: proposalStatus === "approved" ? "success.fg" : "danger.fg",
                  }}
                >
                  <CheckCircleFillIcon size={16} />
                  <Text sx={{ fontWeight: "bold" }}>
                    {proposalStatus === "approved"
                      ? "Proposal approved: Baseline committed to asset thread."
                      : "Proposal rejected."}
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default DigitalTwinDashboardViewer;
