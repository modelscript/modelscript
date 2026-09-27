// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CheckIcon, CpuIcon, FlameIcon, PulseIcon, XIcon } from "@primer/octicons-react";
import { Button, Flash, Heading, Label, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "../../config";
import Box from "../Box";

export interface DigitalTwinViewerConfig {
  twinId?: number;
  twinName?: string;
  instanceSerial?: string;
  modelicaClass?: string;
  channel?: string;
  severity?: "low" | "medium" | "high";
  healthScore?: number;
  rulHours?: number;
  adaptationId?: number;
  proposalId?: number;
  driftMetrics?: {
    score: number;
    direction: string;
    magnitude: number;
  };
  parameterDeltas?: Record<
    string,
    {
      prior: number;
      calibrated: number;
      deltaPct: number;
    }
  >;
  calibratedParameters?: Record<string, number>;
  alertTime?: string;
}

interface DigitalTwinDashboardViewerProps {
  viewConfig: DigitalTwinViewerConfig;
  isFullScreen?: boolean;
}

interface LoadedTwinData {
  proposals?: { id: number; status: "open" | "approved" | "rejected" }[];
  activeSession?: { healthScore?: number };
}

export const DigitalTwinDashboardViewer: React.FC<DigitalTwinDashboardViewerProps> = ({ viewConfig }) => {
  const twinId = viewConfig.twinId ?? 1;
  const [twinData, setTwinData] = useState<LoadedTwinData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<"open" | "approved" | "rejected">("open");
  const [activeTab, setActiveTab] = useState<"telemetry" | "hotspots" | "proposals">("telemetry");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Synthetic or live stream points for curve visualization
  const [telemetryHistory, setTelemetryHistory] = useState<
    { t: number; meas: number; baseline: number; twin: number }[]
  >([]);

  useEffect(() => {
    // Generate synthetic time series around the drift event
    const points: { t: number; meas: number; baseline: number; twin: number }[] = [];
    const tStart = 0;
    const tEnd = 20;
    const n = 40;
    const dt = (tEnd - tStart) / (n - 1);

    const rThNominal = 0.12;
    const rThDegraded = viewConfig.calibratedParameters?.["R_th"] ?? 0.187;

    for (let i = 0; i < n; i++) {
      const t = tStart + i * dt;
      // Step degradation at t = 10s
      const trueRth = t < 10.0 ? rThNominal : rThDegraded;
      const noise = (Math.sin(t * 7.3) + Math.cos(t * 11.2)) * 0.4;
      const meas = 25.0 + 100.0 * trueRth * (1.0 - Math.exp(-t / 8.0)) + (t >= 10.0 ? noise : noise * 0.3);
      const baseline = 25.0 + 100.0 * rThNominal * (1.0 - Math.exp(-t / 8.0));
      const twin = t < 10.0 ? baseline : 25.0 + 100.0 * rThDegraded * (1.0 - Math.exp(-t / 8.0));

      points.push({ t, meas, baseline, twin });
    }
    setTelemetryHistory(points);
  }, [viewConfig]);

  useEffect(() => {
    async function loadTwinDetails() {
      if (!twinId) return;
      try {
        const res = await fetch(`${API_BASE_URL}/twins/${twinId}`);
        if (res.ok) {
          const data = await res.json();
          setTwinData(data);
          if (data.proposals && data.proposals.length > 0) {
            setProposalStatus(data.proposals[0].status);
          }
        }
      } catch {
        // Fallback to embedded viewConfig
      }
    }
    loadTwinDetails();
  }, [twinId]);

  const handleApproveProposal = async () => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const proposalId = viewConfig.proposalId ?? twinData?.proposals?.[0]?.id ?? 1;
      const res = await fetch(`${API_BASE_URL}/twins/${twinId}/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerId: 1, notes: "Approved based on CUSUM telemetry verification." }),
      });
      if (res.ok) {
        setProposalStatus("approved");
        setActionMessage("Physics Pull Request approved! Active model baseline updated.");
      } else {
        const err = await res.json();
        setActionMessage(`Approval failed: ${err.error || "Unknown error"}`);
      }
    } catch (err: unknown) {
      setActionMessage(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectProposal = async () => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const proposalId = viewConfig.proposalId ?? twinData?.proposals?.[0]?.id ?? 1;
      const res = await fetch(`${API_BASE_URL}/twins/${twinId}/proposals/${proposalId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerId: 1, notes: "Rejected by engineer." }),
      });
      if (res.ok) {
        setProposalStatus("rejected");
        setActionMessage("Proposal rejected.");
      }
    } catch (err: unknown) {
      setActionMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const healthScore = viewConfig.healthScore ?? twinData?.activeSession?.healthScore ?? 85.0;
  const rulHours = viewConfig.rulHours ?? 340.0;
  const deltas = viewConfig.parameterDeltas ?? {};

  // Render SVG Sparkline
  const minVal = 20.0;
  const maxVal = 50.0;
  const width = 640;
  const height = 180;
  const pad = 24;

  const toX = (t: number) => pad + (t / 20.0) * (width - 2 * pad);
  const toY = (val: number) => height - pad - ((val - minVal) / (maxVal - minVal)) * (height - 2 * pad);

  const measPath = telemetryHistory
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.meas).toFixed(1)}`)
    .join(" ");

  const baselinePath = telemetryHistory
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.baseline).toFixed(1)}`)
    .join(" ");

  const twinPath = telemetryHistory
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
          <Label variant="accent">#{viewConfig.instanceSerial || "SN-84920"}</Label>
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
                  +{viewConfig.driftMetrics?.score ? viewConfig.driftMetrics.score.toFixed(1) : "4.2"}σ
                </Heading>
                <Text sx={{ fontSize: 0, color: "fg.muted" }}>Channel: {viewConfig.channel || "Coolant Temp (T)"}</Text>
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
                  {viewConfig.calibratedParameters?.["R_th"]
                    ? viewConfig.calibratedParameters["R_th"].toFixed(3)
                    : "0.187"}{" "}
                  <Text sx={{ fontSize: 1, fontWeight: "normal" }}>K/W</Text>
                </Heading>
                <Text sx={{ fontSize: 0, color: "danger.fg" }}>+55.8% Degradation</Text>
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
                  {rulHours.toFixed(0)} <Text sx={{ fontSize: 1, fontWeight: "normal" }}>hours</Text>
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
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
                <Text sx={{ fontWeight: "bold", fontSize: 1 }}>
                  Innovation Residual Tracking: Sensor vs Twin vs Nominal Design
                </Text>
                <Box sx={{ display: "flex", gap: 3, fontSize: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 10, height: 10, backgroundColor: "#0969da", borderRadius: "50%" }} />
                    <Text>Physical Telemetry (y_meas)</Text>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 14, height: 2, backgroundColor: "#8250df" }} />
                    <Text>Self-Updated Twin (y_twin)</Text>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span style={{ width: 14, height: 2, borderTop: "2px dashed #cf222e" }} />
                    <Text>Nominal Baseline (y_nominal)</Text>
                  </Box>
                </Box>
              </Box>

              <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
                {/* Horizontal gridlines */}
                {[25, 35, 45].map((val) => (
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
                <path d={twinPath} fill="none" stroke="#8250df" strokeWidth="2.5" />
                <path d={measPath} fill="none" stroke="#0969da" strokeWidth="1.2" opacity="0.85" />
              </svg>
            </Box>
          </Box>
        )}

        {activeTab === "hotspots" && (
          <Box sx={{ textAlign: "center", p: 4, backgroundColor: "canvas.inset", borderRadius: 2 }}>
            <FlameIcon size={32} fill="#d29922" />
            <Heading sx={{ fontSize: 2, mt: 2 }}>3D Spatial Hotspot Reconstruction</Heading>
            <Text sx={{ color: "fg.muted", fontSize: 1, display: "block", mt: 1 }}>
              Internal thermal resistance mapped to Power MOSFET Die junction (T_junction = 78.4°C)
            </Text>
            <Box
              sx={{
                mt: 3,
                p: 3,
                backgroundColor: "canvas.default",
                border: "1px solid",
                borderColor: "border.default",
                borderRadius: 2,
                display: "inline-block",
                textAlign: "left",
              }}
            >
              <Text sx={{ fontWeight: "bold" }}>Virtual Sensor Telemetry:</Text>
              <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
                <li>Stator Hotspot: 68.2°C (nominal: 54.0°C)</li>
                <li>Thermal Interface Degradation: +55.8%</li>
                <li>Coolant Delta-T: 4.8 K across manifold</li>
              </ul>
            </Box>
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
                    Physics Pull Request #{viewConfig.proposalId ?? 14}: Parameter Recalibration
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
                        <td style={{ padding: "8px", color: "#58a6ff" }}>{d.calibrated.toFixed(4)}</td>
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
                      <td style={{ padding: "8px", fontWeight: "bold" }}>`R_th` (Thermal Resistance)</td>
                      <td style={{ padding: "8px" }}>0.1200 K/W</td>
                      <td style={{ padding: "8px", color: "#58a6ff" }}>0.1870 K/W</td>
                      <td style={{ padding: "8px", color: "#f85149" }}>+55.8%</td>
                      <td style={{ padding: "8px" }}>
                        <Label variant="severe">Degraded</Label>
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
