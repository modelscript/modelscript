// SPDX-License-Identifier: AGPL-3.0-or-later

import { Html } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { type ProbeData } from "./probe-tooltip";

export interface BoundaryActionPayload {
  kind: "fix" | "force" | "inlet";
  targetId: number | string;
  dofs?: number[];
  magnitude?: number;
  vector?: [number, number, number];
}

interface BoundaryPickerProps {
  positions: number[];
  indices: number[];
  onSelectBoundary: (action: BoundaryActionPayload) => void;
  onHoverProbe?: (probe: ProbeData | null) => void;
  probeFields?: {
    stress?: number[];
    displacements?: number[];
    safetyFactor?: number;
  };
  clippingPlanes?: THREE.Plane[];
}

export function BoundaryPicker({
  positions,
  indices,
  onSelectBoundary,
  onHoverProbe,
  probeFields,
  clippingPlanes,
}: BoundaryPickerProps) {
  const [, setHoveredFace] = useState<number | null>(null);
  const [activeMenu, setActiveMenu] = useState<{
    screenX: number;
    screenY: number;
    nodeId: number;
    faceIndex: number;
    worldPos: [number, number, number];
  } | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (positions.length > 0) {
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
      geo.computeVertexNormals();
    }
    return geo;
  }, [positions, indices]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!e.faceIndex || indices.length === 0) return;

    const fIdx = e.faceIndex;
    setHoveredFace(fIdx);

    const n0 = indices[fIdx * 3 + 0];
    const n1 = indices[fIdx * 3 + 1];
    const n2 = indices[fIdx * 3 + 2];

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
    if (!e.faceIndex) return;

    const fIdx = e.faceIndex;
    const n0 = indices[fIdx * 3 + 0];
    const pt = e.point;

    setActiveMenu({
      screenX: e.clientX,
      screenY: e.clientY,
      nodeId: n0,
      faceIndex: fIdx,
      worldPos: [pt.x, pt.y, pt.z],
    });
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
          clippingPlanes={clippingPlanes}
        />
      </mesh>

      {/* Floating Radial Action Menu */}
      {activeMenu && (
        <Html position={activeMenu.worldPos}>
          <div
            style={{
              position: "absolute",
              transform: "translate(-50%, -120%)",
              background: "rgba(15, 23, 42, 0.95)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(56, 189, 248, 0.5)",
              borderRadius: "12px",
              padding: "8px",
              boxShadow: "0 12px 30px rgba(0,0,0,0.8)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minWidth: "190px",
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
                color: "#94a3b8",
                fontWeight: 600,
              }}
            >
              <span>Assign on Node #{activeMenu.nodeId}</span>
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
                background: "rgba(6, 182, 212, 0.2)",
                border: "1px solid rgba(6, 182, 212, 0.4)",
                borderRadius: "6px",
                padding: "6px 8px",
                color: "#22d3ee",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              🔒 Fix Translation (DOF 1-3)
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
                background: "rgba(59, 130, 246, 0.2)",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                borderRadius: "6px",
                padding: "6px 8px",
                color: "#60a5fa",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              🔒 Fix All Degrees (DOF 1-6)
            </button>

            <button
              onClick={() => {
                onSelectBoundary({
                  kind: "force",
                  targetId: activeMenu.nodeId,
                  magnitude: -1000.0,
                  vector: [0, 0, -1],
                });
                setActiveMenu(null);
              }}
              style={{
                background: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: "6px",
                padding: "6px 8px",
                color: "#f87171",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              ⬇ Apply Force (-1000 N, Z)
            </button>

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
                padding: "6px 8px",
                color: "#4ade80",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: 600,
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
