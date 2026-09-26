// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from "react";

export interface PodSurrogateDataPayload {
  numFeatures: number;
  numModes: number;
  polyDegree: number;
  parameterNames: string[];
  scalarOutputNames: string[];
  capturedEnergy: number;
  eigenvalues: number[];
  meanField: number[];
  basisModes: number[];
  latentCoeffs: number[][];
  scalarCoeffs: number[][];
}

export interface SurrogateLiveExplorerProps {
  surrogateData: PodSurrogateDataPayload | null;
  modelName?: string;
  onReconstruct: (field: Float32Array, scalars: Record<string, number>, params: Record<string, number>) => void;
  onOpenModelica?: (modelName: string) => void;
  onExportFmu?: (modelName: string) => void;
  onClose?: () => void;
}

function evalPolyBasis(p: number[], degree: number): number[] {
  const P = p.length;
  const out = [1.0];
  // Linear terms
  for (let i = 0; i < P; i++) {
    out.push(p[i] ?? 0);
  }
  // Quadratic terms
  if (degree >= 2) {
    for (let i = 0; i < P; i++) {
      for (let j = i; j < P; j++) {
        out.push((p[i] ?? 0) * (p[j] ?? 0));
      }
    }
  }
  return out;
}

export function reconstructSurrogate(
  surrogate: PodSurrogateDataPayload,
  params: Record<string, number>,
): {
  field: Float32Array;
  scalars: Record<string, number>;
  latent: Float64Array;
} {
  const P = surrogate.parameterNames.length;
  const paramVec: number[] = [];
  for (let i = 0; i < P; i++) {
    const pName = surrogate.parameterNames[i]!;
    paramVec.push(params[pName] ?? 1.0);
  }

  const basis = evalPolyBasis(paramVec, surrogate.polyDegree ?? 2);
  const k = surrogate.numModes;
  const latent = new Float64Array(k);

  for (let m = 0; m < k; m++) {
    const coeffs = surrogate.latentCoeffs[m] || [];
    let sum = 0.0;
    for (let c = 0; c < coeffs.length; c++) {
      sum += (coeffs[c] ?? 0) * (basis[c] ?? 0);
    }
    latent[m] = sum;
  }

  const scalars: Record<string, number> = {};
  for (let q = 0; q < surrogate.scalarOutputNames.length; q++) {
    const name = surrogate.scalarOutputNames[q]!;
    const coeffs = surrogate.scalarCoeffs[q] || [];
    let sum = 0.0;
    for (let c = 0; c < coeffs.length; c++) {
      sum += (coeffs[c] ?? 0) * (basis[c] ?? 0);
    }
    scalars[name] = sum;
  }

  const N = surrogate.numFeatures;
  const field = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let val = surrogate.meanField[i] ?? 0;
    for (let m = 0; m < k; m++) {
      val += latent[m]! * (surrogate.basisModes[m * N + i] ?? 0);
    }
    field[i] = val;
  }

  return { field, scalars, latent };
}

function getParamBounds(paramName: string): {
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  unit: string;
} {
  const lower = paramName.toLowerCase();
  if (lower.includes("load")) {
    return { min: 0.2, max: 2.5, step: 0.05, defaultVal: 1.0, unit: "×" };
  }
  if (lower.includes("modulus") || lower.includes("young")) {
    return { min: 100, max: 300, step: 5, defaultVal: 210, unit: "GPa" };
  }
  if (lower.includes("vel") || lower.includes("speed")) {
    return { min: 10, max: 120, step: 1, defaultVal: 50, unit: "m/s" };
  }
  if (lower.includes("aoa") || lower.includes("alpha") || lower.includes("angle")) {
    return { min: -5, max: 15, step: 0.5, defaultVal: 2.5, unit: "°" };
  }
  return { min: 0.1, max: 5.0, step: 0.1, defaultVal: 1.0, unit: "" };
}

export const SurrogateLiveExplorer: React.FC<SurrogateLiveExplorerProps> = ({
  surrogateData,
  modelName = "SurrogateModel",
  onReconstruct,
  onOpenModelica,
  onExportFmu,
  onClose,
}) => {
  const [params, setParams] = useState<Record<string, number>>({});
  const [currentScalars, setCurrentScalars] = useState<Record<string, number>>({});

  // Initialize parameter values
  useEffect(() => {
    if (!surrogateData) return;
    const initial: Record<string, number> = {};
    for (const pName of surrogateData.parameterNames) {
      const bounds = getParamBounds(pName);
      initial[pName] = bounds.defaultVal;
    }
    setParams(initial);

    // Initial evaluation
    const res = reconstructSurrogate(surrogateData, initial);
    setCurrentScalars(res.scalars);
    onReconstruct(res.field, res.scalars, initial);
  }, [surrogateData]);

  if (!surrogateData) return null;

  const handleSliderChange = (pName: string, val: number) => {
    const updated = { ...params, [pName]: val };
    setParams(updated);
    const res = reconstructSurrogate(surrogateData, updated);
    setCurrentScalars(res.scalars);
    onReconstruct(res.field, res.scalars, updated);
  };

  const formatParamDisplay = (pName: string, val: number) => {
    const lower = pName.toLowerCase();
    if (lower.includes("modulus") || lower.includes("young")) {
      const gpa = val > 1e6 ? val / 1e9 : val;
      return `${gpa.toFixed(0)} GPa`;
    }
    if (lower.includes("load")) {
      return `${val.toFixed(2)}×`;
    }
    if (lower.includes("aoa") || lower.includes("alpha") || lower.includes("angle")) {
      return `${val.toFixed(1)}°`;
    }
    if (lower.includes("vel") || lower.includes("speed")) {
      return `${val.toFixed(0)} m/s`;
    }
    return val.toFixed(2);
  };

  const formatScalarDisplay = (sName: string, val: number) => {
    const lower = sName.toLowerCase();
    if (lower.includes("stress")) {
      return `${(val / 1e6).toFixed(1)} MPa`;
    }
    if (lower.includes("disp")) {
      return `${(val * 1000).toFixed(3)} mm`;
    }
    if (lower.includes("force") || lower.includes("drag") || lower.includes("lift")) {
      return `${val.toFixed(1)} N`;
    }
    if (lower.includes("safety")) {
      return val.toFixed(2);
    }
    return val.toFixed(4);
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        right: "20px",
        width: "360px",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.4)",
        borderRadius: "12px",
        padding: "16px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
        zIndex: 40,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>⚡</span>
          <div>
            <span style={{ fontWeight: 700, fontSize: "13px", color: "#38bdf8" }}>Digital Twin ROM Explorer</span>
            <div style={{ fontSize: "10px", color: "#34d399", fontWeight: 600 }}>
              ● 60 FPS Client-Side Live Reconstruction
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Model Stats Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 8px",
          background: "rgba(0, 0, 0, 0.35)",
          borderRadius: "6px",
          fontSize: "10px",
          color: "#94a3b8",
          marginBottom: "12px",
        }}
      >
        <span>
          Modes: <strong style={{ color: "#e2e8f0" }}>{surrogateData.numModes}</strong>
        </span>
        <span>
          Energy: <strong style={{ color: "#34d399" }}>{(surrogateData.capturedEnergy * 100).toFixed(2)}%</strong>
        </span>
        <span>
          Points: <strong style={{ color: "#e2e8f0" }}>{surrogateData.numFeatures}</strong>
        </span>
      </div>

      {/* Parameter Sliders */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}>
          Operating Conditions:
        </div>
        {surrogateData.parameterNames.map((pName) => {
          const bounds = getParamBounds(pName);
          const currentVal = params[pName] ?? bounds.defaultVal;
          return (
            <div key={pName} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                <span style={{ color: "#94a3b8" }}>{pName}:</span>
                <span style={{ fontWeight: 700, color: "#38bdf8" }}>{formatParamDisplay(pName, currentVal)}</span>
              </div>
              <input
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={currentVal}
                onChange={(e) => handleSliderChange(pName, parseFloat(e.target.value))}
                style={{ width: "100%", cursor: "ew-resize" }}
              />
            </div>
          );
        })}
      </div>

      {/* Real-Time Predicted Scalar Gauges */}
      {surrogateData.scalarOutputNames.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}>
            Predicted Physical Responses:
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            {surrogateData.scalarOutputNames.map((sName) => {
              const val = currentScalars[sName] ?? 0;
              return (
                <div
                  key={sName}
                  style={{
                    background: "rgba(0, 0, 0, 0.4)",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                  }}
                >
                  <div style={{ fontSize: "10px", color: "#94a3b8" }}>{sName}</div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc", marginTop: "2px" }}>
                    {formatScalarDisplay(sName, val)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px" }}>
        {onOpenModelica && (
          <button
            onClick={() => onOpenModelica(modelName)}
            style={{
              flex: 1,
              padding: "7px 10px",
              background: "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
              border: "none",
              borderRadius: "6px",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            📄 Open .mo Model
          </button>
        )}
        {onExportFmu && (
          <button
            onClick={() => onExportFmu(modelName)}
            style={{
              flex: 1,
              padding: "7px 10px",
              background: "#1e293b",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "6px",
              color: "#e2e8f0",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            📦 FMI 3.0 Source
          </button>
        )}
      </div>
    </div>
  );
};
