// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import { useState } from "react";

export interface SurrogateExportTargets {
  modelicaMo: boolean;
  fmi3Fmu: boolean;
  daeBuilder: boolean;
}

export interface SurrogateTrainConfig {
  energyThreshold: number;
  maxModes: number;
  polynomialDegree: 1 | 2 | 3;
  targetChannels: string[];
  exportTargets: SurrogateExportTargets;
}

export interface SurrogateTrainingMetrics {
  capturedEnergy: number;
  numModes: number;
  r2: number;
  maxRelativeError?: number | undefined;
  trainingTimeMs?: number | undefined;
}

export interface SurrogateTrainDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Primary training callback (e.g., cloud or local POD-Galerkin training). */
  onTrain: (config: SurrogateTrainConfig) => void;
  /** Optional dedicated local browser training callback (e.g., trainLocalPodSurrogateAsync). */
  onTrainLocal?: ((config: SurrogateTrainConfig) => void) | undefined;
  /** Optional direct export callbacks once trained. */
  onExportModelica?: ((config: SurrogateTrainConfig) => void) | undefined;
  onExportFmu?: ((config: SurrogateTrainConfig) => void) | undefined;
  onExportDaeBuilder?: ((config: SurrogateTrainConfig) => void) | undefined;
  availableChannels?: string[] | undefined;
  defaultChannels?: string[] | undefined;
  isTraining?: boolean | undefined;
  trainingMetrics?: SurrogateTrainingMetrics | null | undefined;
}

const DEFAULT_CHANNELS = ["vonMisesMpa", "dispMagnitudeMm", "velocityMs", "pressurePa", "temperatureK"];

export const SurrogateTrainDialog: React.FC<SurrogateTrainDialogProps> = ({
  isOpen,
  onClose,
  onTrain,
  onTrainLocal,
  onExportModelica,
  onExportFmu,
  onExportDaeBuilder,
  availableChannels = DEFAULT_CHANNELS,
  defaultChannels,
  isTraining = false,
  trainingMetrics,
}) => {
  const [energyThreshold, setEnergyThreshold] = useState<number>(0.999);
  const [maxModes, setMaxModes] = useState<number>(8);
  const [polynomialDegree, setPolynomialDegree] = useState<1 | 2 | 3>(2);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    defaultChannels && defaultChannels.length > 0 ? defaultChannels : availableChannels.slice(0, 3),
  );
  const [exportMo, setExportMo] = useState<boolean>(true);
  const [exportFmu, setExportFmu] = useState<boolean>(true);
  const [exportDae, setExportDae] = useState<boolean>(true);

  if (!isOpen) return null;

  const toggleChannel = (channel: string) => {
    setSelectedChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  };

  const buildConfig = (): SurrogateTrainConfig => ({
    energyThreshold,
    maxModes,
    polynomialDegree,
    targetChannels: selectedChannels.length > 0 ? selectedChannels : availableChannels.slice(0, 1),
    exportTargets: {
      modelicaMo: exportMo,
      fmi3Fmu: exportFmu,
      daeBuilder: exportDae,
    },
  });

  return (
    <div
      style={{
        position: "absolute",
        top: "60px",
        right: "16px",
        width: "390px",
        maxHeight: "86vh",
        overflowY: "auto",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.35)",
        borderRadius: "12px",
        padding: "18px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 20px 44px rgba(0,0,0,0.65)",
        zIndex: 60,
        pointerEvents: "auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "#38bdf8" }}>Train POD-Galerkin ROM</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close surrogate training dialog"
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          ✕
        </button>
      </div>

      <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 14px 0", lineHeight: "1.45" }}>
        Project 3D FEA/CFD snapshots onto a Proper Orthogonal Decomposition (POD) manifold for sub-millisecond
        co-simulation in Modelica, FMI 3.0, and the DAE arena.
      </p>

      {/* Energy Capture Threshold Slider */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#cbd5e1" }}>Energy Capture Threshold:</span>
          <span style={{ fontWeight: 700, color: "#38bdf8", fontFamily: "monospace" }}>
            {(energyThreshold * 100).toFixed(2)}%
          </span>
        </div>
        <input
          type="range"
          min={0.95}
          max={0.9999}
          step={0.0005}
          value={energyThreshold}
          onChange={(e) => setEnergyThreshold(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Max Modes K */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#cbd5e1" }}>Max Spatial Modes (K):</span>
          <span style={{ fontWeight: 700, color: "#38bdf8", fontFamily: "monospace" }}>{maxModes}</span>
        </div>
        <input
          type="range"
          min={2}
          max={24}
          step={1}
          value={maxModes}
          onChange={(e) => setMaxModes(parseInt(e.target.value, 10))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Polynomial Regression Degree (1–3) */}
      <div style={{ marginBottom: "14px" }}>
        <label style={{ display: "block", fontSize: "11px", color: "#cbd5e1", marginBottom: "5px" }}>
          Latent Regression Basis (Polynomial Degree):
        </label>
        <div style={{ display: "flex", gap: "6px" }}>
          {([1, 2, 3] as const).map((deg) => (
            <button
              key={deg}
              type="button"
              onClick={() => setPolynomialDegree(deg)}
              style={{
                flex: 1,
                padding: "6px",
                background: polynomialDegree === deg ? "#0284c7" : "#1e293b",
                border:
                  polynomialDegree === deg ? "1px solid rgba(56, 189, 248, 0.7)" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {deg === 1 ? "Linear (1)" : deg === 2 ? "Quadratic (2)" : "Cubic (3)"}
            </button>
          ))}
        </div>
      </div>

      {/* Target Output Channels */}
      {availableChannels.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "12px" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "6px" }}>
            Target Output Channels ({selectedChannels.length} selected):
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {availableChannels.map((ch) => {
              const active = selectedChannels.includes(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "12px",
                    fontSize: "10px",
                    fontFamily: "monospace",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: active ? "rgba(56, 189, 248, 0.22)" : "rgba(30, 41, 59, 0.85)",
                    border: active ? "1px solid rgba(56, 189, 248, 0.65)" : "1px solid rgba(148, 163, 184, 0.25)",
                    color: active ? "#38bdf8" : "#94a3b8",
                  }}
                >
                  {active ? "✓ " : ""}
                  {ch}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Synthesis / Export Targets */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "14px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "6px" }}>
          Synthesis &amp; Export Targets:
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={exportMo} onChange={(e) => setExportMo(e.target.checked)} />
            <span>Modelica 1D Component (.mo)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={exportFmu} onChange={(e) => setExportFmu(e.target.checked)} />
            <span>FMI 3.0 Co-Simulation FMU (.fmu)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={exportDae} onChange={(e) => setExportDae(e.target.checked)} />
            <span>Direct DAEBuilder Arena Lowering</span>
          </label>
        </div>
      </div>

      {/* Training Metrics Summary */}
      {trainingMetrics && (
        <div
          style={{
            background: "rgba(16, 185, 129, 0.14)",
            border: "1px solid rgba(16, 185, 129, 0.55)",
            borderRadius: "8px",
            padding: "8px 10px",
            marginBottom: "12px",
            fontSize: "11px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
            <span style={{ color: "#cbd5e1" }}>Captured Energy:</span>
            <span style={{ fontWeight: 700, color: "#34d399", fontFamily: "monospace" }}>
              {(trainingMetrics.capturedEnergy * 100).toFixed(2)}% ({trainingMetrics.numModes} modes)
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
            <span style={{ color: "#cbd5e1" }}>Regression R²:</span>
            <span style={{ fontWeight: 700, color: "#34d399", fontFamily: "monospace" }}>
              {trainingMetrics.r2.toFixed(4)}
            </span>
          </div>
          {trainingMetrics.maxRelativeError !== undefined && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
              <span style={{ color: "#cbd5e1" }}>Max Rel. Error:</span>
              <span style={{ fontWeight: 600, color: "#fbbf24", fontFamily: "monospace" }}>
                {(trainingMetrics.maxRelativeError * 100).toFixed(2)}%
              </span>
            </div>
          )}
          {trainingMetrics.trainingTimeMs !== undefined && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#cbd5e1" }}>Fit Time:</span>
              <span style={{ fontWeight: 600, color: "#94a3b8", fontFamily: "monospace" }}>
                {trainingMetrics.trainingTimeMs.toFixed(1)} ms
              </span>
            </div>
          )}
        </div>
      )}

      {/* Train Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {onTrainLocal && (
          <button
            type="button"
            onClick={() => onTrainLocal(buildConfig())}
            disabled={isTraining || selectedChannels.length === 0}
            style={{
              width: "100%",
              padding: "9px",
              background: isTraining ? "#475569" : "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
              border: "none",
              borderRadius: "7px",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "12px",
              cursor: isTraining || selectedChannels.length === 0 ? "not-allowed" : "pointer",
              boxShadow: "0 4px 12px rgba(2, 132, 199, 0.35)",
            }}
          >
            {isTraining ? "⚡ Computing Sirovich Eigen-Modes..." : "⚡ Train Local Browser POD Surrogate"}
          </button>
        )}

        <button
          type="button"
          onClick={() => onTrain(buildConfig())}
          disabled={isTraining || selectedChannels.length === 0}
          style={{
            width: "100%",
            padding: "9px",
            background: onTrainLocal
              ? "#1e293b"
              : isTraining
                ? "#475569"
                : "linear-gradient(135deg, #0284c7 0%, #6366f1 100%)",
            border: onTrainLocal ? "1px solid rgba(56, 189, 248, 0.35)" : "none",
            borderRadius: "7px",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "12px",
            cursor: isTraining || selectedChannels.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {isTraining
            ? "⚡ Training Surrogate..."
            : onTrainLocal
              ? "☁️ Train & Synthesize Pipeline"
              : "⚡ Train POD Surrogate ROM"}
        </button>

        {/* Direct Post-Training Export Buttons */}
        {(onExportModelica || onExportFmu || onExportDaeBuilder) && (
          <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
            {onExportModelica && (
              <button
                type="button"
                onClick={() => onExportModelica(buildConfig())}
                disabled={isTraining}
                style={{
                  flex: 1,
                  padding: "6px",
                  background: "rgba(30, 41, 59, 0.9)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: "6px",
                  color: "#e2e8f0",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: isTraining ? "not-allowed" : "pointer",
                }}
              >
                📄 Export .mo
              </button>
            )}
            {onExportFmu && (
              <button
                type="button"
                onClick={() => onExportFmu(buildConfig())}
                disabled={isTraining}
                style={{
                  flex: 1,
                  padding: "6px",
                  background: "rgba(30, 41, 59, 0.9)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: "6px",
                  color: "#e2e8f0",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: isTraining ? "not-allowed" : "pointer",
                }}
              >
                📦 FMI 3.0
              </button>
            )}
            {onExportDaeBuilder && (
              <button
                type="button"
                onClick={() => onExportDaeBuilder(buildConfig())}
                disabled={isTraining}
                style={{
                  flex: 1,
                  padding: "6px",
                  background: "rgba(30, 41, 59, 0.9)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: "6px",
                  color: "#e2e8f0",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: isTraining ? "not-allowed" : "pointer",
                }}
              >
                ⚙️ DAEBuilder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
