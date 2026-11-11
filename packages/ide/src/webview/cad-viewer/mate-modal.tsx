// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MateModal — Kinematic assembly joint configuration dialog for 3D CAD models.
 *
 * Allows users to configure MultiBody joint constraints (Revolute, Prismatic,
 * Cylindrical, Spherical, Fixed) between two selected mate reference frames.
 */

import type { AssemblyJointSpec, MultiBodyJointType } from "@modelscript/cad";
import { useState } from "react";

export interface MateFrameSelection {
  partName: string;
  frameName?: string | undefined;
  worldPosition: [number, number, number];
  normal?: [number, number, number] | undefined;
}

export interface MateModalProps {
  isOpen: boolean;
  onClose: () => void;
  frameA: MateFrameSelection | null;
  frameB: MateFrameSelection | null;
  onCommitJoint: (spec: AssemblyJointSpec) => void;
  dark?: boolean;
}

export function MateModal({ isOpen, onClose, frameA, frameB, onCommitJoint, dark = true }: MateModalProps) {
  const [jointType, setJointType] = useState<MultiBodyJointType>("Revolute");
  const [jointName, setJointName] = useState<string>("revJoint1");
  const [axisZ, setAxisZ] = useState<string>("0, 0, 1");
  const [phiOffset, setPhiOffset] = useState<string>("0");
  const [sOffset, setSOffset] = useState<string>("0");

  if (!isOpen || !frameA || !frameB) return null;

  const bgModal = dark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.97)";
  const borderCol = dark ? "rgba(56, 189, 248, 0.35)" : "rgba(14, 165, 233, 0.35)";
  const textPrimary = dark ? "#f8fafc" : "#0f172a";
  const textSecondary = dark ? "#94a3b8" : "#64748b";
  const inputBg = dark ? "rgba(30, 41, 59, 0.8)" : "rgba(241, 245, 249, 0.9)";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    background: inputBg,
    color: textPrimary,
    border: `1px solid ${borderCol}`,
    borderRadius: "6px",
    fontSize: "12px",
    fontFamily: "monospace",
    boxSizing: "border-box",
  };

  const handleTypeChange = (newType: MultiBodyJointType) => {
    setJointType(newType);
    const prefix =
      newType === "Revolute"
        ? "revJoint"
        : newType === "Prismatic"
          ? "prismJoint"
          : newType === "Cylindrical"
            ? "cylJoint"
            : newType === "Spherical"
              ? "sphereJoint"
              : "fixedJoint";
    setJointName(`${prefix}1`);
  };

  const handleSubmit = () => {
    let axisParsed: [number, number, number] | undefined;
    if (jointType === "Revolute" || jointType === "Prismatic" || jointType === "Cylindrical") {
      const parts = axisZ.split(",").map((s) => parseFloat(s.trim()));
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        axisParsed = [parts[0]!, parts[1]!, parts[2]!];
      } else {
        axisParsed = [0, 0, 1];
      }
    }

    const phi = parseFloat(phiOffset);
    const s = parseFloat(sOffset);

    const spec: AssemblyJointSpec = {
      jointName: jointName.trim() || "joint1",
      jointType,
      partA: frameA.partName,
      frameA: frameA.frameName,
      partB: frameB.partName,
      frameB: frameB.frameName,
      axis: axisParsed,
      phi_offset: Number.isFinite(phi) && phi !== 0 ? phi : undefined,
      s_offset: Number.isFinite(s) && s !== 0 ? s : undefined,
    };

    onCommitJoint(spec);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "92vw",
          background: bgModal,
          border: `1px solid ${borderCol}`,
          borderRadius: "14px",
          padding: "20px",
          boxShadow: "0 20px 45px rgba(0, 0, 0, 0.6)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>🔗</span>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: textPrimary }}>
              Create Kinematic Assembly Mate
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: textSecondary,
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Mated Frame Summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            padding: "10px",
            background: inputBg,
            borderRadius: "8px",
            border: `1px solid ${borderCol}`,
          }}
        >
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#38bdf8" }}>Reference Frame A</div>
            <div style={{ fontSize: "12px", color: textPrimary, fontWeight: 500, fontFamily: "monospace" }}>
              {frameA.partName}.{frameA.frameName ?? "frame_b"}
            </div>
            <div style={{ fontSize: "10px", color: textSecondary, marginTop: "2px", fontFamily: "monospace" }}>
              [{frameA.worldPosition.map((v) => v.toFixed(2)).join(", ")}]
            </div>
          </div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#4ade80" }}>Reference Frame B</div>
            <div style={{ fontSize: "12px", color: textPrimary, fontWeight: 500, fontFamily: "monospace" }}>
              {frameB.partName}.{frameB.frameName ?? "frame_a"}
            </div>
            <div style={{ fontSize: "10px", color: textSecondary, marginTop: "2px", fontFamily: "monospace" }}>
              [{frameB.worldPosition.map((v) => v.toFixed(2)).join(", ")}]
            </div>
          </div>
        </div>

        {/* Joint Type Selector */}
        <div>
          <label style={{ fontSize: "11px", fontWeight: 600, color: textSecondary, display: "block", marginBottom: 6 }}>
            Kinematic Joint Type
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
            {(["Revolute", "Prismatic", "Cylindrical", "Spherical", "Fixed"] as MultiBodyJointType[]).map((type) => {
              const active = jointType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleTypeChange(type)}
                  style={{
                    padding: "8px 4px",
                    background: active ? "#0284c7" : inputBg,
                    border: `1px solid ${active ? "#38bdf8" : borderCol}`,
                    borderRadius: "6px",
                    color: active ? "#ffffff" : textPrimary,
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.15s ease",
                  }}
                >
                  {type === "Revolute"
                    ? "↻ Rev"
                    : type === "Prismatic"
                      ? "⇄ Prism"
                      : type === "Cylindrical"
                        ? "⤱ Cyl"
                        : type === "Spherical"
                          ? "⚽ Sphere"
                          : "🔒 Fixed"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Joint Name & Parameters */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <div>
            <label
              style={{ fontSize: "11px", fontWeight: 600, color: textSecondary, display: "block", marginBottom: 4 }}
            >
              Joint Identifier
            </label>
            <input type="text" value={jointName} onChange={(e) => setJointName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label
              style={{ fontSize: "11px", fontWeight: 600, color: textSecondary, display: "block", marginBottom: 4 }}
            >
              Joint Axis vector (n)
            </label>
            <input
              type="text"
              value={axisZ}
              onChange={(e) => setAxisZ(e.target.value)}
              disabled={jointType === "Spherical" || jointType === "Fixed"}
              style={{
                ...inputStyle,
                opacity: jointType === "Spherical" || jointType === "Fixed" ? 0.4 : 1,
              }}
            />
          </div>
        </div>

        {/* Offsets (phi_offset, s_offset) */}
        {(jointType === "Revolute" || jointType === "Prismatic" || jointType === "Cylindrical") && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label
                style={{ fontSize: "11px", fontWeight: 600, color: textSecondary, display: "block", marginBottom: 4 }}
              >
                Initial Angle φ (rad)
              </label>
              <input
                type="number"
                step="0.01"
                value={phiOffset}
                onChange={(e) => setPhiOffset(e.target.value)}
                disabled={jointType === "Prismatic"}
                style={{
                  ...inputStyle,
                  opacity: jointType === "Prismatic" ? 0.4 : 1,
                }}
              />
            </div>
            <div>
              <label
                style={{ fontSize: "11px", fontWeight: 600, color: textSecondary, display: "block", marginBottom: 4 }}
              >
                Initial Translation s (m)
              </label>
              <input
                type="number"
                step="0.01"
                value={sOffset}
                onChange={(e) => setSOffset(e.target.value)}
                disabled={jointType === "Revolute"}
                style={{
                  ...inputStyle,
                  opacity: jointType === "Revolute" ? 0.4 : 1,
                }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 14px",
              background: "transparent",
              border: `1px solid ${borderCol}`,
              borderRadius: "6px",
              color: textSecondary,
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              padding: "7px 16px",
              background: "#0284c7",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
            }}
          >
            Assemble &amp; Connect
          </button>
        </div>
      </div>
    </div>
  );
}
