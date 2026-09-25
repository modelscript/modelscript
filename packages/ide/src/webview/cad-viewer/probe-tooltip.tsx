// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ProbeData {
  screenX: number;
  screenY: number;
  worldPos: [number, number, number];
  nodeId?: number;
  faceIndex?: number;
  stressMPa?: number;
  displacementMm?: number;
  displacementVector?: [number, number, number];
  safetyFactor?: number;
  velocityMagnitude?: number;
  pressurePa?: number;
}

export interface ProbeTooltipProps {
  probe: ProbeData | null;
}

export function ProbeTooltip({ probe }: ProbeTooltipProps) {
  if (!probe) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: `${probe.screenX + 15}px`,
        top: `${probe.screenY + 15}px`,
        pointerEvents: "none",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(56, 189, 248, 0.4)",
        borderRadius: "8px",
        padding: "10px 14px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "11px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
        zIndex: 1000,
        minWidth: "180px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "6px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          paddingBottom: "4px",
        }}
      >
        <span style={{ fontWeight: 700, color: "#38bdf8" }}>
          {probe.nodeId !== undefined ? `Node #${probe.nodeId}` : `Face #${probe.faceIndex ?? "Surface"}`}
        </span>
        <span style={{ color: "#94a3b8", fontSize: "10px" }}>
          ({probe.worldPos[0].toFixed(3)}, {probe.worldPos[1].toFixed(3)}, {probe.worldPos[2].toFixed(3)})
        </span>
      </div>

      {probe.stressMPa !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span style={{ color: "#94a3b8" }}>Von Mises:</span>
          <span style={{ fontWeight: 600, color: "#f87171" }}>{probe.stressMPa.toFixed(2)} MPa</span>
        </div>
      )}

      {probe.displacementMm !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span style={{ color: "#94a3b8" }}>Displacement:</span>
          <span style={{ fontWeight: 600, color: "#34d399" }}>{probe.displacementMm.toFixed(3)} mm</span>
        </div>
      )}

      {probe.safetyFactor !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span style={{ color: "#94a3b8" }}>Safety Factor:</span>
          <span
            style={{
              fontWeight: 600,
              color: probe.safetyFactor < 1.5 ? "#ef4444" : "#10b981",
            }}
          >
            {probe.safetyFactor.toFixed(2)}
          </span>
        </div>
      )}

      {probe.velocityMagnitude !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span style={{ color: "#94a3b8" }}>Velocity:</span>
          <span style={{ fontWeight: 600, color: "#38bdf8" }}>{probe.velocityMagnitude.toFixed(2)} m/s</span>
        </div>
      )}

      {probe.pressurePa !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#94a3b8" }}>Pressure:</span>
          <span style={{ fontWeight: 600, color: "#a78bfa" }}>{(probe.pressurePa / 1000).toFixed(2)} kPa</span>
        </div>
      )}
    </div>
  );
}
