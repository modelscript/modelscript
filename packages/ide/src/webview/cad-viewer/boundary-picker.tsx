// SPDX-License-Identifier: AGPL-3.0-or-later

import { Html } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { type ProbeData } from "./probe-tooltip";

export interface StressProbeMarker {
  id: string;
  label: string;
  nodeIndex: number;
  position: [number, number, number];
}

export interface BoundaryActionPayload {
  kind: "fix" | "force" | "inlet" | "stress-probe";
  targetId: number | string;
  dofs?: number[];
  magnitude?: number;
  vector?: [number, number, number];
  forceVector?: [number, number, number];
  label?: string;
  worldPos?: [number, number, number];
}

interface BoundaryPickerProps {
  positions: number[];
  indices: number[];
  onSelectBoundary: (action: BoundaryActionPayload) => void;
  onHoverProbe?: (probe: ProbeData | null) => void;
  onAddStressProbe?: (probe: StressProbeMarker) => void;
  stressProbes?: StressProbeMarker[];
  probeFields?: {
    stress?: number[];
    displacements?: number[];
    safetyFactor?: number;
  };
  clippingPlanes?: THREE.Plane[] | undefined;
  onCommitFaceTag?: (payload: {
    portName: string;
    portType: string;
    normal?: [number, number, number] | undefined;
    worldPos: [number, number, number];
  }) => void;
}

export function BoundaryPicker({
  positions,
  indices,
  onSelectBoundary,
  onHoverProbe,
  onAddStressProbe,
  stressProbes,
  probeFields,
  clippingPlanes,
  onCommitFaceTag,
}: BoundaryPickerProps) {
  const [, setHoveredFace] = useState<number | null>(null);
  const [activeMenu, setActiveMenu] = useState<{
    screenX: number;
    screenY: number;
    nodeId: number;
    faceIndex: number;
    worldPos: [number, number, number];
    normal?: [number, number, number] | undefined;
  } | null>(null);

  const [forceX, setForceX] = useState<string>("0");
  const [forceY, setForceY] = useState<string>("0");
  const [forceZ, setForceZ] = useState<string>("-1000");
  const [probeLabel, setProbeLabel] = useState<string>("");
  const [portName, setPortName] = useState<string>("flange_1");
  const [portType, setPortType] = useState<string>("mechanical_flange");

  const { geometry, markerRadius } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    let rad = 0.012;
    if (positions.length > 0) {
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      if (geo.boundingSphere && geo.boundingSphere.radius > 0) {
        rad = Math.max(0.004, geo.boundingSphere.radius * 0.03);
      }
    }
    return { geometry: geo, markerRadius: rad };
  }, [positions, indices]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.faceIndex === undefined || e.faceIndex === null || indices.length === 0) return;

    const fIdx = e.faceIndex;
    setHoveredFace(fIdx);

    const n0 = indices[fIdx * 3 + 0] ?? 0;
    const n1 = indices[fIdx * 3 + 1] ?? n0;
    const n2 = indices[fIdx * 3 + 2] ?? n0;

    const pt = e.point;
    const worldPos: [number, number, number] = [pt.x, pt.y, pt.z];

    let stressMPa: number | undefined;
    let dispMm: number | undefined;

    if (probeFields?.stress && n0 < probeFields.stress.length) {
      const s0 = probeFields.stress[n0] ?? 0;
      const s1 = probeFields.stress[n1] ?? s0;
      const s2 = probeFields.stress[n2] ?? s0;
      stressMPa = (s0 + s1 + s2) / (3 * 1e6); // average in MPa
    }

    if (probeFields?.displacements && n0 * 3 < probeFields.displacements.length) {
      const dx = probeFields.displacements[n0 * 3 + 0] ?? 0;
      const dy = probeFields.displacements[n0 * 3 + 1] ?? 0;
      const dz = probeFields.displacements[n0 * 3 + 2] ?? 0;
      dispMm = Math.hypot(dx, dy, dz) * 1000;
    }

    onHoverProbe?.({
      screenX: e.clientX,
      screenY: e.clientY,
      worldPos,
      nodeId: n0,
      faceIndex: fIdx,
      stressMPa,
      displacementMm: dispMm,
      safetyFactor: probeFields?.safetyFactor,
    });
  };

  const handlePointerOut = () => {
    setHoveredFace(null);
    onHoverProbe?.(null);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.faceIndex === undefined || e.faceIndex === null) return;

    const fIdx = e.faceIndex;
    const n0 = indices[fIdx * 3 + 0] ?? 0;
    const pt = e.point;
    const norm = e.face?.normal;

    setProbeLabel(`Stress Pt #${(stressProbes?.length ?? 0) + 1} (N${n0 + 1})`);
    setActiveMenu({
      screenX: e.clientX,
      screenY: e.clientY,
      nodeId: n0,
      faceIndex: fIdx,
      worldPos: [pt.x, pt.y, pt.z],
      normal: norm ? [norm.x, norm.y, norm.z] : undefined,
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(30, 41, 59, 0.9)",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: "4px",
    color: "#f8fafc",
    fontSize: "10px",
    padding: "3px 5px",
    fontFamily: "monospace",
  };

  return (
    <group>
      <mesh
        geometry={geometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
      >
        <meshStandardMaterial
          color="#38bdf8"
          transparent={true}
          opacity={0.01} // Invisible raycast proxy sitting directly on the surface
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes ?? null}
        />
      </mesh>

      {/* 3D Stress Probe Point Markers (Glowing Amber/Cyan Pins) */}
      {stressProbes?.map((probe) => (
        <group key={probe.id} position={probe.position}>
          <mesh>
            <octahedronGeometry args={[markerRadius, 1]} />
            <meshStandardMaterial color="#f59e0b" emissive="#d97706" emissiveIntensity={0.65} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* Floating Radial Action Menu */}
      {activeMenu && (
        <Html position={activeMenu.worldPos}>
          <div
            style={{
              position: "absolute",
              transform: "translate(-50%, -115%)",
              background: "rgba(15, 23, 42, 0.96)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(56, 189, 248, 0.5)",
              borderRadius: "12px",
              padding: "10px",
              boxShadow: "0 12px 30px rgba(0,0,0,0.8)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minWidth: "225px",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: "11px",
              zIndex: 2000,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: "4px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                color: "#38bdf8",
                fontWeight: 700,
              }}
            >
              <span>Node #{activeMenu.nodeId + 1}</span>
              <button
                onClick={() => setActiveMenu(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: "10px", fontFamily: "monospace", color: "#94a3b8" }}>
              XYZ: ({activeMenu.worldPos[0].toFixed(3)}, {activeMenu.worldPos[1].toFixed(3)},{" "}
              {activeMenu.worldPos[2].toFixed(3)})
            </div>

            <div style={{ display: "flex", gap: "4px" }}>
              <button
                onClick={() => {
                  onSelectBoundary({
                    kind: "fix",
                    targetId: activeMenu.nodeId,
                    dofs: [1, 2, 3],
                  });
                  setActiveMenu(null);
                }}
                style={{
                  flex: 1,
                  background: "rgba(6, 182, 212, 0.2)",
                  border: "1px solid rgba(6, 182, 212, 0.4)",
                  borderRadius: "6px",
                  padding: "5px 6px",
                  color: "#22d3ee",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                🔒 Fix DOF 1-3
              </button>

              <button
                onClick={() => {
                  onSelectBoundary({
                    kind: "fix",
                    targetId: activeMenu.nodeId,
                    dofs: [1, 2, 3, 4, 5, 6],
                  });
                  setActiveMenu(null);
                }}
                style={{
                  flex: 1,
                  background: "rgba(59, 130, 246, 0.2)",
                  border: "1px solid rgba(59, 130, 246, 0.4)",
                  borderRadius: "6px",
                  padding: "5px 6px",
                  color: "#60a5fa",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                🔒 Clamp All
              </button>
            </div>

            {/* Custom 3D Force Vector (Fx, Fy, Fz) */}
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.08)",
                paddingTop: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "10px", color: "#cbd5e1", fontWeight: 600 }}>3D Nodal Force Vector (N)</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
                <div>
                  <label style={{ fontSize: "9px", color: "#94a3b8" }}>Fx</label>
                  <input type="number" value={forceX} onChange={(e) => setForceX(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: "9px", color: "#94a3b8" }}>Fy</label>
                  <input type="number" value={forceY} onChange={(e) => setForceY(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: "9px", color: "#94a3b8" }}>Fz</label>
                  <input type="number" value={forceZ} onChange={(e) => setForceZ(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <button
                onClick={() => {
                  const fx = parseFloat(forceX) || 0;
                  const fy = parseFloat(forceY) || 0;
                  const fz = parseFloat(forceZ) || 0;
                  const mag = Math.hypot(fx, fy, fz) || 1;
                  onSelectBoundary({
                    kind: "force",
                    targetId: activeMenu.nodeId,
                    magnitude: mag,
                    vector: [fx / mag, fy / mag, fz / mag],
                    forceVector: [fx, fy, fz],
                  });
                  setActiveMenu(null);
                }}
                style={{
                  background: "rgba(239, 68, 68, 0.22)",
                  border: "1px solid rgba(239, 68, 68, 0.45)",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  color: "#f87171",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                ⚡ Apply Force ({forceX}, {forceY}, {forceZ}) N
              </button>
            </div>

            {/* Stress Probe Point Registration */}
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.08)",
                paddingTop: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "10px", color: "#fcd34d", fontWeight: 600 }}>Stress Probe Point</span>
              <input
                type="text"
                value={probeLabel}
                onChange={(e) => setProbeLabel(e.target.value)}
                placeholder="e.g. Fillet Root Stress Pt"
                style={inputStyle}
              />
              <button
                onClick={() => {
                  const label = probeLabel.trim() || `Probe N${activeMenu.nodeId + 1}`;
                  const probe: StressProbeMarker = {
                    id: `probe-${activeMenu.nodeId}-${Date.now()}`,
                    label,
                    nodeIndex: activeMenu.nodeId,
                    position: activeMenu.worldPos,
                  };
                  onAddStressProbe?.(probe);
                  onSelectBoundary({
                    kind: "stress-probe",
                    targetId: activeMenu.nodeId,
                    label,
                    worldPos: activeMenu.worldPos,
                  });
                  setActiveMenu(null);
                }}
                style={{
                  background: "rgba(245, 158, 11, 0.22)",
                  border: "1px solid rgba(245, 158, 11, 0.5)",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  color: "#fbbf24",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                🎯 Add Stress Probe Point
              </button>
            </div>

            {/* Physical Port / Frame Tagging */}
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.08)",
                paddingTop: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "10px", color: "#38bdf8", fontWeight: 600 }}>Tag Physical Port / Frame</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                <div>
                  <label style={{ fontSize: "9px", color: "#94a3b8" }}>Port Name</label>
                  <input
                    type="text"
                    value={portName}
                    onChange={(e) => setPortName(e.target.value)}
                    placeholder="flange_1"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "9px", color: "#94a3b8" }}>Port Type</label>
                  <select
                    value={portType}
                    onChange={(e) => setPortType(e.target.value)}
                    style={{
                      ...inputStyle,
                      cursor: "pointer",
                    }}
                  >
                    <option value="mechanical_flange">mechanical_flange</option>
                    <option value="fixed_support">fixed_support</option>
                    <option value="frame">frame</option>
                    <option value="fluid">fluid</option>
                    <option value="thermal">thermal</option>
                  </select>
                </div>
              </div>
              <button
                onClick={() => {
                  const name = portName.trim() || "flange_1";
                  onCommitFaceTag?.({
                    portName: name,
                    portType,
                    normal: activeMenu.normal,
                    worldPos: activeMenu.worldPos,
                  });
                  setActiveMenu(null);
                }}
                style={{
                  background: "rgba(56, 189, 248, 0.22)",
                  border: "1px solid rgba(56, 189, 248, 0.5)",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  color: "#38bdf8",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                🏷️ Tag Port / Frame ({portName})
              </button>
            </div>

            <button
              onClick={() => {
                onSelectBoundary({
                  kind: "inlet",
                  targetId: `patch_${activeMenu.faceIndex}`,
                });
                setActiveMenu(null);
              }}
              style={{
                background: "rgba(34, 197, 94, 0.2)",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                borderRadius: "6px",
                padding: "5px 8px",
                color: "#4ade80",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "10px",
              }}
            >
              🌊 Set Fluid Boundary Marker
            </button>
          </div>
        </Html>
      )}
    </group>
  );
}
