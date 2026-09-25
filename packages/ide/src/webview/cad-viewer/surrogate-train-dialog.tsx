// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";

export interface SurrogateTrainConfig {
  energyThreshold: number;
  maxModes: number;
  polynomialDegree: number;
  exportTargets: {
    modelicaMo: boolean;
    fmi3Fmu: boolean;
  };
}

export interface SurrogateTrainDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onTrain: (config: SurrogateTrainConfig) => void;
  isTraining?: boolean;
  trainingMetrics?: {
    capturedEnergy: number;
    numModes: number;
    r2: number;
  };
}

export const SurrogateTrainDialog: React.FC<SurrogateTrainDialogProps> = ({
  isOpen,
  onClose,
  onTrain,
  isTraining = false,
  trainingMetrics,
}) => {
  const [energyThreshold, setEnergyThreshold] = useState(0.999);
  const [maxModes, setMaxModes] = useState(8);
  const [polynomialDegree, setPolynomialDegree] = useState(2);
  const [exportMo, setExportMo] = useState(true);
  const [exportFmu, setExportFmu] = useState(true);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: "60px",
        right: "16px",
        width: "360px",
        background: "rgba(15, 23, 42, 0.94)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(56, 189, 248, 0.3)",
        borderRadius: "12px",
        padding: "18px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "#38bdf8" }}>Train Surrogate ROM</span>
        </div>
        <button
          onClick={onClose}
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

      <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 14px 0", lineHeight: "1.4" }}>
        Project 3D continuum physics onto a POD-Galerkin manifold (&lt;0.05 ms evaluation in 1D Modelica loops).
      </p>

      {/* Energy Threshold Slider */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#cbd5e1" }}>Kinetic/Strain Energy Threshold:</span>
          <span style={{ fontWeight: 600, color: "#38bdf8" }}>{(energyThreshold * 100).toFixed(1)}%</span>
        </div>
        <input
          type="range"
          min="0.95"
          max="0.9999"
          step="0.0005"
          value={energyThreshold}
          onChange={(e) => setEnergyThreshold(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Maximum Modes */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#cbd5e1" }}>Max Spatial Modes (K):</span>
          <span style={{ fontWeight: 600, color: "#38bdf8" }}>{maxModes}</span>
        </div>
        <input
          type="range"
          min="2"
          max="16"
          step="1"
          value={maxModes}
          onChange={(e) => setMaxModes(parseInt(e.target.value, 10))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Polynomial Monomial Degree */}
      <div style={{ marginBottom: "14px" }}>
        <label style={{ display: "block", fontSize: "11px", color: "#cbd5e1", marginBottom: "4px" }}>
          Latent Regression Basis:
        </label>
        <div style={{ display: "flex", gap: "6px" }}>
          {[1, 2, 3].map((deg) => (
            <button
              key={deg}
              onClick={() => setPolynomialDegree(deg)}
              style={{
                flex: 1,
                padding: "6px",
                background: polynomialDegree === deg ? "#0284c7" : "#1e293b",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {deg === 1 ? "Linear" : deg === 2 ? "Quadratic (Poly2)" : "Cubic (Poly3)"}
            </button>
          ))}
        </div>
      </div>

      {/* Export Targets */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "14px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "6px" }}>
          Automated Synthesis Targets:
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={exportMo} onChange={(e) => setExportMo(e.target.checked)} />
            <span>Generate 1D Modelica Component (.mo)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={exportFmu} onChange={(e) => setExportFmu(e.target.checked)} />
            <span>Export Standalone FMI 3.0 Co-Simulation FMU (.fmu)</span>
          </label>
        </div>
      </div>

      {/* Real-Time Metrics Badge */}
      {trainingMetrics && (
        <div
          style={{
            background: "rgba(16, 185, 129, 0.15)",
            border: "1px solid #10b981",
            borderRadius: "6px",
            padding: "8px",
            marginBottom: "12px",
            fontSize: "11px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
            <span>Captured Energy:</span>
            <span style={{ fontWeight: 700, color: "#34d399" }}>
              {(trainingMetrics.capturedEnergy * 100).toFixed(2)}% ({trainingMetrics.numModes} modes)
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Accuracy (R²):</span>
            <span style={{ fontWeight: 700, color: "#34d399" }}>{trainingMetrics.r2.toFixed(4)}</span>
          </div>
        </div>
      )}

      {/* Train Button */}
      <button
        onClick={() =>
          onTrain({
            energyThreshold,
            maxModes,
            polynomialDegree,
            exportTargets: {
              modelicaMo: exportMo,
              fmi3Fmu: exportFmu,
            },
          })
        }
        disabled={isTraining}
        style={{
          width: "100%",
          padding: "10px",
          background: isTraining ? "#64748b" : "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
          border: "none",
          borderRadius: "6px",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: "12px",
          cursor: isTraining ? "not-allowed" : "pointer",
          boxShadow: "0 4px 12px rgba(2, 132, 199, 0.4)",
        }}
      >
        {isTraining ? "⚡ Computing Sirovich Eigen-Modes..." : "⚡ Train Surrogate ROM"}
      </button>
    </div>
  );
};
