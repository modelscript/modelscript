// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CheckIcon, CpuIcon, FlameIcon, PlayIcon, PulseIcon, XIcon } from "@primer/octicons-react";
import { Button, Flash, Heading, Label, Text } from "@primer/react";
import axios from "axios";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api";
import { useAuth } from "../../AuthContext";
import Box from "../Box";
import Spinner from "../Spinner";

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
  unit?: string | undefined;
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

interface ActionNotice {
  text: string;
  variant: "success" | "danger" | "default";
}

async function injectTwinTelemetry(
  twinId: number,
  timestamp: number,
  channels: { name: string; value: number }[],
): Promise<any> {
  const { data } = await api.post(`/twins/${twinId}/telemetry`, { timestamp, channels });
  return data;
}

export const DigitalTwinDashboardViewer: React.FC<DigitalTwinDashboardViewerProps> = ({ viewConfig, isFullScreen }) => {
  let user: { id: number } | null = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    user = null;
  }

  const explicitTwinId = viewConfig.twinId;
  const twinId = explicitTwinId ?? 1;
  const unit = viewConfig.unit || "°C";

  const [twinData, setTwinData] = useState<LoadedTwinData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<"open" | "approved" | "rejected">("open");
  const [activeTab, setActiveTab] = useState<"telemetry" | "hotspots" | "proposals">("telemetry");
  const [actionMessage, setActionMessage] = useState<ActionNotice | null>(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);

  // Initialize telemetry from viewConfig.telemetry or viewConfig.initialSeries
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>(
    () => viewConfig.telemetry ?? viewConfig.initialSeries ?? [],
  );

  useEffect(() => {
    const initial = viewConfig.telemetry ?? viewConfig.initialSeries;
    setTelemetry(Array.isArray(initial) ? initial : []);
  }, [viewConfig.telemetry, viewConfig.initialSeries]);

  // Subscribe to live twin SSE stream only when viewConfig.twinId is explicitly provided
  useEffect(() => {
    if (!explicitTwinId || typeof EventSource === "undefined") return;
    let evtSource: EventSource | null = null;
    try {
      const baseUrl = (api.defaults.baseURL || "/api/v1").replace(/\/+$/, "");
      evtSource = new EventSource(`${baseUrl}/twins/${explicitTwinId}/stream`);
      evtSource.onerror = () => {
        evtSource?.close();
      };
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
  }, [explicitTwinId]);

  useEffect(() => {
    async function loadTwinDetails() {
      if (!explicitTwinId) return;
      try {
        const { data } = await api.get(`/twins/${explicitTwinId}`);
        setTwinData(data);
        if (data.proposals && data.proposals.length > 0) {
          setProposalStatus(data.proposals[0].status);
        }
      } catch {
        // Fallback to embedded viewConfig
      }
    }
    void loadTwinDetails();
  }, [explicitTwinId]);

  const deltas = viewConfig.parameterDeltas ?? {};
  const healthScore = viewConfig.healthScore ?? twinData?.activeSession?.healthScore ?? 85.0;
  const rulHours = viewConfig.rulHours;

  const hasProposalsOrDeltas = useMemo(() => {
    return (
      Object.keys(deltas).length > 0 ||
      viewConfig.proposalId !== undefined ||
      Boolean(twinData?.proposals && twinData.proposals.length > 0)
    );
  }, [deltas, viewConfig.proposalId, twinData]);

  const primaryParam = useMemo(() => {
    const calParams = viewConfig.calibratedParameters ?? {};
    const key =
      "R_th" in calParams
        ? "R_th"
        : "R_th" in deltas
          ? "R_th"
          : (Object.keys(calParams)[0] ?? Object.keys(deltas)[0] ?? "R_th");
    const value = calParams[key] ?? deltas[key]?.calibrated;
    const deltaPct = deltas[key]?.deltaPct;
    const paramUnit = key === "R_th" ? "K/W" : "";
    return { key, value, deltaPct, paramUnit };
  }, [viewConfig.calibratedParameters, deltas]);

  const handleInjectTestStep = async () => {
    setActionMessage(null);
    const prevPoint = telemetry[telemetry.length - 1];
    const nextT = prevPoint ? Number((prevPoint.t + 1.0).toFixed(1)) : 0.0;
    const baseVal = prevPoint?.baseline ?? 25.0;
    const nextMeas = Number(((prevPoint?.meas ?? baseVal) + 2.5).toFixed(2));
    try {
      const data = await injectTwinTelemetry(twinId, nextT, [
        { name: viewConfig.channel || "y_meas", value: nextMeas },
      ]);
      if (Array.isArray(data?.telemetry)) {
        setTelemetry(data.telemetry);
      } else if (typeof data?.meas === "number" || typeof data?.y_meas === "number") {
        const measVal = Number(data.meas ?? data.y_meas);
        const twinVal = Number(data.twin ?? data.y_twin ?? measVal);
        const nominalVal = Number(data.baseline ?? data.y_nominal ?? baseVal);
        setTelemetry((prev) => [
          ...prev,
          { t: Number(data.t ?? nextT), meas: measVal, baseline: nominalVal, twin: twinVal },
        ]);
      } else {
        setTelemetry((prev) => [
          ...prev,
          { t: nextT, meas: nextMeas, baseline: baseVal, twin: Number(((baseVal + nextMeas) * 0.5).toFixed(2)) },
        ]);
      }
      setActionMessage({
        text: `Injected step perturbation (${nextMeas} ${unit}) at t = ${nextT}s.`,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { error?: string | undefined })?.error) ||
        (err instanceof Error ? err.message : "Failed to inject telemetry step");
      setActionMessage({ text: `Telemetry injection failed: ${msg}`, variant: "danger" });
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
      setActionMessage({
        text: "Physics Pull Request approved! Active model baseline updated.",
        variant: "success",
      });
    } catch (err: unknown) {
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { error?: string | undefined })?.error) ||
        (err instanceof Error ? err.message : "Unknown error");
      setActionMessage({ text: `Approval failed: ${msg}`, variant: "danger" });
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
      setActionMessage({ text: "Proposal rejected.", variant: "default" });
    } catch (err: unknown) {
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { error?: string | undefined })?.error) ||
        (err instanceof Error ? err.message : String(err));
      setActionMessage({ text: `Error: ${msg}`, variant: "danger" });
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
          unit: h.unit || unit,
          deltaPct,
          severity,
        };
      });
  }, [viewConfig.hotspots, unit]);

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

  const { minTime, maxTime } = useMemo(() => {
    const validTimes = telemetry.map((p) => p.t).filter((t) => Number.isFinite(t));
    if (validTimes.length === 0) {
      return { minTime: 0.0, maxTime: 20.0 };
    }
    const minT = Math.min(...validTimes);
    const maxT = Math.max(minT + 1.0, ...validTimes);
    return { minTime: minT, maxTime: maxT };
  }, [telemetry]);

  const toX = useCallback(
    (t: number) => pad + ((t - minTime) / Math.max(1.0, maxTime - minTime)) * (width - 2 * pad),
    [minTime, maxTime],
  );
  const toY = useCallback(
    (val: number) => height - pad - ((val - minVal) / Math.max(1e-6, maxVal - minVal)) * (height - 2 * pad),
    [minVal, maxVal],
  );

  const { measPath, baselinePath, twinPath } = useMemo(() => {
    return {
      measPath: telemetry
        .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.meas).toFixed(1)}`)
        .join(" "),
      baselinePath: telemetry
        .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.baseline).toFixed(1)}`)
        .join(" "),
      twinPath: telemetry
        .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.twin).toFixed(1)}`)
        .join(" "),
    };
  }, [telemetry, toX, toY]);

  const clampedDriftX = useMemo(() => {
    if (typeof viewConfig.driftEventTime !== "number") return null;
    return Math.max(pad, Math.min(width - pad, toX(viewConfig.driftEventTime)));
  }, [viewConfig.driftEventTime, toX]);

  return (
    <Box
      sx={{
        backgroundColor: "canvas.default",
        border: isFullScreen ? "none" : "1px solid",
        borderColor: "border.default",
        borderRadius: isFullScreen ? 0 : 2,
        height: isFullScreen ? "100%" : undefined,
        display: "flex",
        flexDirection: "column",
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
            onClick={() => {
              setActiveTab("telemetry");
              setActionMessage(null);
            }}
          >
            Telemetry & Drift
          </Button>
          <Button
            size="small"
            variant={activeTab === "hotspots" ? "primary" : "invisible"}
            onClick={() => {
              setActiveTab("hotspots");
              setActionMessage(null);
            }}
          >
            3D Hotspots
          </Button>
          <Button
            size="small"
            variant={activeTab === "proposals" ? "primary" : "invisible"}
            onClick={() => {
              setActiveTab("proposals");
              setActionMessage(null);
            }}
          >
            Physics PR {proposalStatus === "open" && hasProposalsOrDeltas && <Label variant="severe">1</Label>}
          </Button>
        </Box>
      </Box>

      {/* Main content body */}
      <Box sx={{ p: 3, flex: 1, overflowY: "auto" }}>
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
                <Text sx={{ color: "fg.muted", fontSize: 0 }}>Calibrated {primaryParam.key}</Text>
                <Heading sx={{ fontSize: 3, color: "accent.fg", mt: 1 }}>
                  {primaryParam.value !== undefined ? (
                    <>
                      {primaryParam.value.toFixed(3)}{" "}
                      {primaryParam.paramUnit && (
                        <Text sx={{ fontSize: 1, fontWeight: "normal" }}>{primaryParam.paramUnit}</Text>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </Heading>
                <Text
                  sx={{
                    fontSize: 0,
                    color:
                      primaryParam.deltaPct !== undefined && Math.abs(primaryParam.deltaPct) > 5
                        ? "danger.fg"
                        : "fg.muted",
                  }}
                >
                  {primaryParam.deltaPct !== undefined
                    ? `${primaryParam.deltaPct >= 0 ? "+" : ""}${primaryParam.deltaPct.toFixed(1)}% Degradation`
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
                <Flash variant={actionMessage.variant} sx={{ mb: 2 }}>
                  {actionMessage.text}
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
                        {val}
                        {unit}
                      </text>
                    </g>
                  ))}

                  {/* Optional vertical drift detection boundary */}
                  {clampedDriftX !== null && (
                    <>
                      <line
                        x1={clampedDriftX}
                        y1={pad}
                        x2={clampedDriftX}
                        y2={height - pad}
                        stroke="var(--color-danger-fg)"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={clampedDriftX > width - 160 ? clampedDriftX - 4 : clampedDriftX + 4}
                        y={pad + 12}
                        fill="var(--color-danger-fg)"
                        fontSize="10"
                        fontWeight="bold"
                        textAnchor={clampedDriftX > width - 160 ? "end" : "start"}
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

                  {/* Render circle markers when <= 2 points so single injected points are visible */}
                  {telemetry.length <= 2 &&
                    telemetry.map((p, idx) => (
                      <g key={`pt-${idx}`}>
                        <circle cx={toX(p.t)} cy={toY(p.baseline)} r={3.5} fill="var(--color-danger-fg)" />
                        <circle cx={toX(p.t)} cy={toY(p.twin)} r={4} fill="var(--color-accent-purple)" />
                        <circle cx={toX(p.t)} cy={toY(p.meas)} r={4} fill="var(--color-accent-cyan)" />
                      </g>
                    ))}
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
                {/* Visual 2D/Isometric Spatial Hotspot Map */}
                <Box
                  sx={{
                    mb: 3,
                    p: 2,
                    borderRadius: 2,
                    backgroundColor: "canvas.default",
                    border: "1px solid",
                    borderColor: "border.default",
                  }}
                >
                  <svg width="100%" height={150} viewBox="0 0 600 150" role="img" aria-label="3D Spatial Hotspot Map">
                    <polygon
                      points="90,115 260,30 520,30 350,115"
                      fill="rgba(6, 182, 212, 0.04)"
                      stroke="var(--color-border-default)"
                      strokeDasharray="4 4"
                    />
                    <line x1={175} y1={72} x2={435} y2={72} stroke="var(--color-border-muted)" strokeDasharray="2 3" />
                    <line x1={305} y1={30} x2={135} y2={115} stroke="var(--color-border-muted)" strokeDasharray="2 3" />
                    {computedHotspots.map((hs, idx) => {
                      const xs = computedHotspots.map((h) => h.coords[0]);
                      const ys = computedHotspots.map((h) => h.coords[1]);
                      const zs = computedHotspots.map((h) => h.coords[2]);
                      const minX = Math.min(...xs);
                      const maxX = Math.max(minX + 1, ...xs);
                      const minY = Math.min(...ys);
                      const maxY = Math.max(minY + 1, ...ys);
                      const minZ = Math.min(...zs);
                      const maxZ = Math.max(minZ + 1, ...zs);
                      const nx = computedHotspots.length === 1 ? 0.5 : (hs.coords[0] - minX) / (maxX - minX);
                      const ny = computedHotspots.length === 1 ? 0.5 : (hs.coords[1] - minY) / (maxY - minY);
                      const nz = computedHotspots.length === 1 ? 0.5 : (hs.coords[2] - minZ) / (maxZ - minZ);
                      const cx = 140 + nx * 280 + ny * 60 + idx * 8;
                      const cy = 105 - ny * 55 - nz * 25;
                      const isSel = activeHotspot?.id === hs.id;
                      const color =
                        hs.severity === "critical" ? "#ef4444" : hs.severity === "warning" ? "#f59e0b" : "#10b981";
                      return (
                        <g key={hs.id} style={{ cursor: "pointer" }} onClick={() => setSelectedHotspotId(hs.id)}>
                          {isSel && (
                            <circle cx={cx} cy={cy} r={14} fill="none" stroke={color} strokeWidth={1.5} opacity={0.6} />
                          )}
                          <circle cx={cx} cy={cy} r={isSel ? 7 : 5.5} fill={color} />
                          <text
                            x={cx + 10}
                            y={cy + 4}
                            fill="var(--color-fg-default)"
                            fontSize="10"
                            fontWeight={isSel ? "bold" : "normal"}
                          >
                            {hs.name} ({hs.value.toFixed(1)}
                            {hs.unit})
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </Box>

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
                              color: Math.abs(hs.deltaPct) > 10 ? "var(--color-danger-fg)" : "var(--color-success-fg)",
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
                    Object.entries(deltas).map(([name, d]) => {
                      const absDelta = Math.abs(d.deltaPct);
                      const statusLabel = absDelta > 20 ? "Critical Drift" : absDelta > 5 ? "Degraded" : "Calibrated";
                      const statusVariant = absDelta > 20 ? "danger" : absDelta > 5 ? "severe" : "success";
                      return (
                        <tr key={name} style={{ borderBottom: "1px solid var(--color-border-muted, #21262d)" }}>
                          <td style={{ padding: "8px", fontWeight: "bold" }}>
                            <code>{name}</code>
                          </td>
                          <td style={{ padding: "8px" }}>{d.prior.toFixed(4)}</td>
                          <td style={{ padding: "8px", color: "var(--color-accent-cyan, #06b6d4)" }}>
                            {d.calibrated.toFixed(4)}
                          </td>
                          <td style={{ padding: "8px", color: absDelta > 5 ? "#f85149" : "#3fb950" }}>
                            {d.deltaPct >= 0 ? "+" : ""}
                            {d.deltaPct.toFixed(1)}%
                          </td>
                          <td style={{ padding: "8px" }}>
                            <Label variant={statusVariant}>{statusLabel}</Label>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr style={{ borderBottom: "1px solid var(--color-border-muted, #21262d)" }}>
                      <td colSpan={5} style={{ padding: "12px 8px", textAlign: "center", color: "#8b949e" }}>
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {actionMessage && (
                <Flash variant={actionMessage.variant} sx={{ mb: 3 }}>
                  {actionMessage.text}
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
                  {proposalStatus === "approved" ? <CheckCircleFillIcon size={16} /> : <XIcon size={16} />}
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
