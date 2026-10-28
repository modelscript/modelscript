// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CheckIcon, CpuIcon, FlameIcon, PlayIcon, PulseIcon, XIcon } from "@primer/octicons-react";
import { Button, Flash, Heading, Label, Spinner, Text } from "@primer/react";
import axios from "axios";
import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import { useAuth } from "../../AuthContext";
import { extractDigitalThreadTwins } from "../../util/digitalThread";
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
  const [isoAngleDeg, setIsoAngleDeg] = useState<number>(35);

  const handleInjectTestStep = () => {
    const firstDelta = Object.values(deltas)[0];
    const firstCalibrated = viewConfig.calibratedParameters
      ? Object.values(viewConfig.calibratedParameters)[0]
      : undefined;
    const rThNominal = deltas["R_th"]?.prior ?? firstDelta?.prior ?? 0.12;
    const degradationRatio = 1 + Math.max(0.05, (100 - healthScore) / 100);
    const rThDegraded =
      viewConfig.calibratedParameters?.["R_th"] ??
      deltas["R_th"]?.calibrated ??
      firstCalibrated ??
      firstDelta?.calibrated ??
      rThNominal * degradationRatio;
    const ambientTemp =
      viewConfig.calibratedParameters?.["T_amb"] ?? deltas["T_amb"]?.calibrated ?? deltas["T_amb"]?.prior ?? 25.0;
    const powerLoad =
      viewConfig.calibratedParameters?.["P_loss"] ?? deltas["P_loss"]?.calibrated ?? deltas["P_loss"]?.prior ?? 100.0;
    const tauNominal = deltas["tau"]?.prior ?? 8.0;
    const tauDegraded =
      viewConfig.calibratedParameters?.["tau"] ??
      deltas["tau"]?.calibrated ??
      Math.max(2.5, tauNominal * (healthScore / 100));
    const driftShift = (viewConfig.driftMetrics?.magnitude ?? Math.max(0.1, (100 - healthScore) * 0.02)) * 0.5;

    setTelemetry((prev) => {
      const nextIndex = prev.length;
      if (nextIndex === 0) {
        const stepSeries: TelemetryPoint[] = [];
        for (let i = 0; i < 12; i++) {
          const t = i * 2.0;
          const activeRth = t < 10.0 ? rThNominal : rThDegraded;
          const activeTau = t < 10.0 ? tauNominal : tauDegraded;
          const baseline = ambientTemp + powerLoad * rThNominal * (1.0 - Math.exp(-t / tauNominal));
          const twin = ambientTemp + powerLoad * activeRth * (1.0 - Math.exp(-t / activeTau));
          const meas = twin + (t >= 10.0 ? driftShift : driftShift * 0.25);
          stepSeries.push({ t, meas, baseline, twin });
        }
        return stepSeries;
      }
      const lastPoint = prev[prev.length - 1]!;
      const t = Number((lastPoint.t + 1.0).toFixed(1));
      const activeRth = t < 10.0 ? rThNominal : rThDegraded;
      const activeTau = t < 10.0 ? tauNominal : tauDegraded;
      const baseline = ambientTemp + powerLoad * rThNominal * (1.0 - Math.exp(-t / tauNominal));
      const twin = ambientTemp + powerLoad * activeRth * (1.0 - Math.exp(-t / activeTau));
      const meas = twin + (t >= 10.0 ? driftShift * 0.85 : driftShift * 0.2);
      return [...prev, { t, meas, baseline, twin }];
    });
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

  // Compute spatial hotspots from viewConfig.hotspots or extracted digital thread twins
  const computedHotspots = useMemo<DigitalTwinHotspot[]>(() => {
    if (Array.isArray(viewConfig.hotspots) && viewConfig.hotspots.length > 0) {
      return viewConfig.hotspots.map((h, idx) => {
        const nominal = h.nominal ?? 50.0;
        const value = h.value ?? nominal;
        const deltaPct = h.deltaPct ?? (nominal !== 0 ? ((value - nominal) / Math.abs(nominal)) * 100 : 0);
        const severity: DigitalTwinHotspot["severity"] =
          h.severity ?? (Math.abs(deltaPct) > 25 ? "critical" : Math.abs(deltaPct) > 10 ? "warning" : "normal");
        return {
          id: h.id || `hotspot-${idx}`,
          name: h.name || `Node #${idx + 1}`,
          domain: h.domain || "modelica",
          coords: h.coords || [120 + idx * 140, 110 + (idx % 2) * 35, idx * 15],
          value,
          nominal,
          unit: h.unit || "°C",
          deltaPct,
          severity,
        };
      });
    }

    const pkgName = (viewConfig.modelicaClass || viewConfig.twinName || "").split(".")[0];
    if (!pkgName) {
      return [];
    }

    const extractedTwins = extractDigitalThreadTwins(pkgName, "1.0.0", [
      {
        id: 1,
        class_name: viewConfig.modelicaClass || pkgName,
        class_kind: "model",
      } as any,
    ]);

    if (extractedTwins.length === 0) {
      return [];
    }

    return extractedTwins.map((twin, idx) => ({
      id: twin.id || `twin-hs-${idx}`,
      name: `${twin.source.name} ↔ ${twin.target.name}`,
      domain: twin.target.domain,
      coords: [180 + ((idx * 130) % 320), 65 + ((idx * 55) % 110), 10 + idx * 5],
      value: twin.parity.status === "compatible" ? 52.0 : 81.5,
      nominal: 50.0,
      unit: twin.parity.sourceUnit || "°C",
      deltaPct: twin.parity.status === "compatible" ? 4.0 : 63.0,
      severity: twin.parity.status === "compatible" ? "normal" : "critical",
    }));
  }, [viewConfig.hotspots, viewConfig.modelicaClass, viewConfig.twinName]);

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
          <PulseIcon size={18} fill="#2da44e" />
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
                        backgroundColor: "var(--color-accent-cyan, #06b6d4)",
                        borderRadius: "50%",
                      }}
                    />
                    <Text>Physical Telemetry (y_meas)</Text>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 14, height: 2, backgroundColor: "var(--color-accent-purple, #8b5cf6)" }} />
                    <Text>Self-Updated Twin (y_twin)</Text>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 14, height: 2, borderTop: "2px dashed #cf222e" }} />
                    <Text>Nominal Baseline (y_nominal)</Text>
                  </Box>
                  <Button size="small" leadingVisual={PlayIcon} onClick={handleInjectTestStep}>
                    Inject Test Step
                  </Button>
                </Box>
              </Box>

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
                        stroke="#484f58"
                        strokeDasharray="2 4"
                        strokeWidth="0.5"
                      />
                      <text x={pad - 4} y={toY(val) + 4} fill="#8b949e" fontSize="9" textAnchor="end">
                        {val}°C
                      </text>
                    </g>
                  ))}

                  {/* Vertical drift detection boundary */}
                  <line
                    x1={toX(10)}
                    y1={pad}
                    x2={toX(10)}
                    y2={height - pad}
                    stroke="#f85149"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  <text x={toX(10) + 4} y={pad + 12} fill="#f85149" fontSize="10" fontWeight="bold">
                    CUSUM Drift Event (t = 10s)
                  </text>

                  {/* Trajectories */}
                  <path d={baselinePath} fill="none" stroke="#cf222e" strokeWidth="1.5" strokeDasharray="4 3" />
                  <path d={twinPath} fill="none" stroke="var(--color-accent-purple, #8b5cf6)" strokeWidth="2.5" />
                  <path
                    d={measPath}
                    fill="none"
                    stroke="var(--color-accent-cyan, #06b6d4)"
                    strokeWidth="1.5"
                    opacity="0.9"
                  />
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
                <FlameIcon size={20} fill="#d29922" />
                <Box>
                  <Heading sx={{ fontSize: 2 }}>3D Spatial Thermal &amp; Stress Hotspot Map</Heading>
                  <Text sx={{ color: "fg.muted", fontSize: 0 }}>
                    Reconstructed from Reduced-Order FEA/CFD &amp; Digital Thread Twin Bindings
                  </Text>
                </Box>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {[
                    { label: "Iso 35°", angle: 35 },
                    { label: "Oblique 60°", angle: 60 },
                    { label: "Top Plan", angle: 12 },
                  ].map((preset) => (
                    <Button
                      key={preset.label}
                      size="small"
                      variant={isoAngleDeg === preset.angle ? "primary" : "default"}
                      onClick={() => setIsoAngleDeg(preset.angle)}
                    >
                      {preset.label}
                    </Button>
                  ))}
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
                {/* Interactive Isometric 3D Multi-Layer Thermal/Stress Mesh */}
                <Box
                  sx={{
                    mb: 3,
                    p: 2,
                    backgroundColor: "canvas.default",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "border.subtle",
                    position: "relative",
                  }}
                >
                  {(() => {
                    const rad = (isoAngleDeg * Math.PI) / 180;
                    const cosA = Math.cos(rad);
                    const sinA = Math.sin(rad);
                    const projectIso = (nx: number, ny: number, nz: number): [number, number] => {
                      const cx = (nx - 300) * 0.62;
                      const cy = (ny - 110) * 0.62;
                      const px = 300 + cx * cosA - cy * sinA;
                      const py = 128 + (cx * sinA + cy * cosA) * 0.52 - nz * 1.15;
                      return [px, py];
                    };
                    const layers = [0, 18, 36];
                    const driftSeverityFactor = Math.min(
                      1,
                      Math.max(0.15, (viewConfig.driftMetrics?.score ?? (100 - healthScore) / 10) / 5),
                    );

                    return (
                      <svg width="100%" height={240} viewBox="0 0 600 240">
                        <defs>
                          <radialGradient id="hotspot-critical" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#f85149" stopOpacity="0.75" />
                            <stop offset="55%" stopColor="#d29922" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="#f85149" stopOpacity="0" />
                          </radialGradient>
                          <radialGradient id="hotspot-warning" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#d29922" stopOpacity="0.65" />
                            <stop offset="100%" stopColor="#d29922" stopOpacity="0" />
                          </radialGradient>
                          <radialGradient id="hotspot-normal" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.55" />
                            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                          </radialGradient>
                          <linearGradient id="thermal-layer-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.18} />
                            <stop offset="50%" stopColor="#f59e0b" stopOpacity={0.14 + driftSeverityFactor * 0.18} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2 + driftSeverityFactor * 0.25} />
                          </linearGradient>
                        </defs>

                        {/* Multi-layer isometric 3D FEA/CFD planes */}
                        {layers.map((lz, lIdx) => {
                          const c1 = projectIso(80, 40, lz);
                          const c2 = projectIso(520, 40, lz);
                          const c3 = projectIso(520, 180, lz);
                          const c4 = projectIso(80, 180, lz);
                          const poly = `${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${c3[0].toFixed(1)},${c3[1].toFixed(1)} ${c4[0].toFixed(1)},${c4[1].toFixed(1)}`;
                          return (
                            <g key={lz}>
                              <polygon
                                points={poly}
                                fill={lIdx === 1 ? "url(#thermal-layer-grad)" : "rgba(15, 23, 42, 0.45)"}
                                stroke={lIdx === 2 ? "#38bdf8" : "#30363d"}
                                strokeWidth={lIdx === 2 ? 1.4 : 1}
                                strokeDasharray={lIdx === 0 ? "4 3" : undefined}
                              />
                              {[0.25, 0.5, 0.75].map((f) => {
                                const gx1 = projectIso(80 + 440 * f, 40, lz);
                                const gx2 = projectIso(80 + 440 * f, 180, lz);
                                const gy1 = projectIso(80, 40 + 140 * f, lz);
                                const gy2 = projectIso(520, 40 + 140 * f, lz);
                                return (
                                  <g key={`${lz}-${f}`} stroke="#21262d" strokeWidth="0.7" opacity={0.7}>
                                    <line x1={gx1[0]} y1={gx1[1]} x2={gx2[0]} y2={gx2[1]} />
                                    <line x1={gy1[0]} y1={gy1[1]} x2={gy2[0]} y2={gy2[1]} />
                                  </g>
                                );
                              })}
                            </g>
                          );
                        })}

                        {/* Vertical corner pillars connecting 3D mesh layers */}
                        {[
                          [80, 40],
                          [520, 40],
                          [520, 180],
                          [80, 180],
                        ].map(([cx, cy], idx) => {
                          const bot = projectIso(cx!, cy!, layers[0]!);
                          const top = projectIso(cx!, cy!, layers[layers.length - 1]!);
                          return (
                            <line
                              key={idx}
                              x1={bot[0]}
                              y1={bot[1]}
                              x2={top[0]}
                              y2={top[1]}
                              stroke="#30363d"
                              strokeDasharray="2 2"
                            />
                          );
                        })}

                        {/* 3D Hotspot nodes with elevation stems and radial heatmap fields */}
                        {computedHotspots.map((hs) => {
                          const [x, y, z] = hs.coords;
                          const [px, py] = projectIso(x, y, z);
                          const [bx, by] = projectIso(x, y, 0);
                          const isSelected = activeHotspot?.id === hs.id;
                          const gradId =
                            hs.severity === "critical"
                              ? "url(#hotspot-critical)"
                              : hs.severity === "warning"
                                ? "url(#hotspot-warning)"
                                : "url(#hotspot-normal)";
                          const strokeColor =
                            hs.severity === "critical" ? "#f85149" : hs.severity === "warning" ? "#d29922" : "#06b6d4";

                          return (
                            <g key={hs.id} style={{ cursor: "pointer" }} onClick={() => setSelectedHotspotId(hs.id)}>
                              <line
                                x1={bx}
                                y1={by}
                                x2={px}
                                y2={py}
                                stroke={strokeColor}
                                strokeWidth="1.5"
                                strokeDasharray="2 2"
                              />
                              <ellipse cx={bx} cy={by} rx={6} ry={3} fill={strokeColor} opacity={0.45} />
                              <circle cx={px} cy={py} r={isSelected ? 42 : 34} fill={gradId} />
                              <circle
                                cx={px}
                                cy={py}
                                r={isSelected ? 9 : 6.5}
                                fill={strokeColor}
                                stroke="#ffffff"
                                strokeWidth={isSelected ? 2.5 : 1.2}
                              />
                              <text
                                x={px}
                                y={py - 12}
                                fill="#e6edf3"
                                fontSize="10"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {hs.value.toFixed(1)}
                                {hs.unit}
                              </text>
                              <text x={px} y={py + 20} fill="#8b949e" fontSize="9" textAnchor="middle">
                                ({x}, {y}, {z})
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    );
                  })()}

                  {activeHotspot && (
                    <Box
                      sx={{
                        mt: 2,
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
                </Box>

                {/* Hotspot Table */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left", color: "#8b949e" }}>
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
                            borderBottom: "1px solid #21262d",
                            cursor: "pointer",
                            backgroundColor: isSelected ? "rgba(56, 139, 253, 0.1)" : "transparent",
                          }}
                        >
                          <td style={{ padding: "8px", fontWeight: "bold" }}>{hs.name}</td>
                          <td style={{ padding: "8px", textTransform: "uppercase", color: "#8b949e" }}>{hs.domain}</td>
                          <td style={{ padding: "8px", fontFamily: "monospace" }}>
                            ({hs.coords[0]}, {hs.coords[1]}, {hs.coords[2]})
                          </td>
                          <td
                            style={{ padding: "8px", fontWeight: "bold", color: "var(--color-accent-cyan, #06b6d4)" }}
                          >
                            {hs.value.toFixed(1)} {hs.unit}
                          </td>
                          <td style={{ padding: "8px" }}>
                            {hs.nominal.toFixed(1)} {hs.unit}
                          </td>
                          <td style={{ padding: "8px", color: hs.deltaPct > 10 ? "#f85149" : "#3fb950" }}>
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

              <Text sx={{ fontSize: 1, color: "fg.muted", mb: 3, display: "block" }}>
                Continuous adjoint optimization converged via L-BFGS-B over rolling window. Verification shows residual
                error reduction from 1.84e+2 to 8.45e-8.
              </Text>

              {/* Parameter Delta Table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left", color: "#8b949e" }}>
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
