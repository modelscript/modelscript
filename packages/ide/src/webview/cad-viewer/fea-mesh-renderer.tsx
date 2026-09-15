// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FeaMeshRenderer — Three.js component for rendering 3D structural FEA
 * mesh results received from the co-simulation stream via LSP.
 *
 * Renders displaced surface geometry with scientific Turbo/Viridis colormapping
 * proportional to local Von Mises stress.
 */

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export interface FeaMeshPayload {
  type: "fea-mesh";
  participantId?: string;
  time: number;
  geometry: {
    positions: number[];
    indices: number[];
    normals?: number[];
  };
  fields: {
    vonMisesStress: number[];
    displacements: number[];
  };
  stats: {
    maxStress: number;
    maxDisplacement: number;
    safetyFactor?: number;
  };
}

/**
 * High-accuracy Turbo colormap approximation.
 * Maps normalized scalar t in [0, 1] to RGB [0, 1].
 */
function turboColormap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r =
    0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503327 + x * (4.27729857 + x * 2.82956604))));
  const b =
    0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

interface FeaMeshRendererProps {
  /** The latest FEA mesh payload, or null if none received yet */
  payload: FeaMeshPayload | null;
  /** Position offset in scene space */
  position?: [number, number, number];
  /** Multiplier for visualizing small physical displacements */
  displacementScale?: number;
}

export type FeaFieldType = "vonMises" | "dispMagnitude" | "dispX" | "dispY" | "dispZ";

export function FeaMeshRenderer({ payload, position = [0, 0, 0], displacementScale = 50.0 }: FeaMeshRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [activeScale, setActiveScale] = useState(displacementScale);
  const [selectedField, setSelectedField] = useState<FeaFieldType>("vonMises");

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute([], 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
    geo.setIndex(new THREE.Uint32BufferAttribute([], 1));
    return geo;
  }, []);

  useEffect(() => {
    if (!payload) return;

    const { positions, indices } = payload.geometry;
    const { vonMisesStress, displacements } = payload.fields;
    const maxStress = Math.max(1e-3, payload.stats.maxStress);
    const maxDisp = Math.max(1e-6, payload.stats.maxDisplacement);
    const vertCount = positions.length / 3;

    // 1. Calculate displaced positions
    const displacedPositions = new Float32Array(positions.length);
    for (let i = 0; i < vertCount; i++) {
      const ux = displacements[i * 3 + 0] ?? 0;
      const uy = displacements[i * 3 + 1] ?? 0;
      const uz = displacements[i * 3 + 2] ?? 0;

      displacedPositions[i * 3 + 0] = positions[i * 3 + 0] + ux * activeScale;
      displacedPositions[i * 3 + 1] = positions[i * 3 + 1] + uy * activeScale;
      displacedPositions[i * 3 + 2] = positions[i * 3 + 2] + uz * activeScale;
    }

    // 2. Compute vertex colors from chosen scalar field
    const colors = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      let scalar = 0;
      let norm = 1;

      if (selectedField === "vonMises") {
        scalar = vonMisesStress[i] ?? 0;
        norm = maxStress;
      } else if (selectedField === "dispMagnitude") {
        const ux = displacements[i * 3 + 0] ?? 0;
        const uy = displacements[i * 3 + 1] ?? 0;
        const uz = displacements[i * 3 + 2] ?? 0;
        scalar = Math.hypot(ux, uy, uz);
        norm = maxDisp;
      } else if (selectedField === "dispX") {
        scalar = Math.abs(displacements[i * 3 + 0] ?? 0);
        norm = maxDisp;
      } else if (selectedField === "dispY") {
        scalar = Math.abs(displacements[i * 3 + 1] ?? 0);
        norm = maxDisp;
      } else if (selectedField === "dispZ") {
        scalar = Math.abs(displacements[i * 3 + 2] ?? 0);
        norm = maxDisp;
      }

      const t = Math.max(0, Math.min(1, scalar / norm));
      const [r, g, b] = turboColormap(t);
      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    // 3. Update geometry attributes in-place to avoid GPU buffer reallocations
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    const idxAttr = geometry.getIndex();

    if (posAttr && posAttr.array.length === displacedPositions.length) {
      (posAttr.array as Float32Array).set(displacedPositions);
      posAttr.needsUpdate = true;
    } else {
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(displacedPositions, 3));
    }

    if (colAttr && colAttr.array.length === colors.length) {
      (colAttr.array as Float32Array).set(colors);
      colAttr.needsUpdate = true;
    } else {
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }

    if (!idxAttr || idxAttr.array.length !== indices.length) {
      geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    }

    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }, [payload, geometry, activeScale, selectedField]);

  const maxWarpScale = useMemo(() => {
    if (!payload?.stats.maxDisplacement) return 500;
    return Math.min(2000, Math.max(50, Math.round(0.2 / Math.max(1e-6, payload.stats.maxDisplacement))));
  }, [payload?.stats.maxDisplacement]);

  if (!payload) return null;

  const maxStressMpa = (payload.stats.maxStress / 1e6).toFixed(2);
  const maxDispMm = (payload.stats.maxDisplacement * 1000).toFixed(3);

  return (
    <group position={position}>
      {/* Deformed & Stress-colored FEA Mesh */}
      <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} metalness={0.2} roughness={0.4} />
      </mesh>

      {/* Wireframe overlay for element edges */}
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.15} />
      </mesh>

      {/* Screen-Space Floating HUD Legend */}
      <Html
        calculatePosition={(_el, _camera, size) => [Math.max(10, size.width - 230), 20]}
        style={{ pointerEvents: "auto" }}
      >
        <div
          style={{
            background: "rgba(13, 17, 23, 0.88)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "#c9d1d9",
            fontFamily: "monospace",
            fontSize: "11px",
            width: "200px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            userSelect: "none",
          }}
        >
          <div style={{ fontWeight: "bold", color: "#58a6ff", marginBottom: 4 }}>FEA: Multi-Physics</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span>Time:</span>
            <span style={{ color: "#79c0ff" }}>{payload.time.toFixed(3)} s</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span>Max Stress:</span>
            <span style={{ color: "#ff7b72", fontWeight: "bold" }}>{maxStressMpa} MPa</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Deflection:</span>
            <span style={{ color: "#d2a8ff" }}>{maxDispMm} mm</span>
          </div>

          {/* Scalar field selector */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: "10px", color: "#8b949e", display: "block", marginBottom: 2 }}>Field:</label>
            <select
              value={selectedField}
              onChange={(e) => setSelectedField(e.target.value as FeaFieldType)}
              style={{
                width: "100%",
                background: "#21262d",
                border: "1px solid #30363d",
                borderRadius: "4px",
                color: "#c9d1d9",
                padding: "2px 4px",
                fontSize: "10px",
                fontFamily: "monospace",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="vonMises">Von Mises Stress</option>
              <option value="dispMagnitude">Total Deflection |U|</option>
              <option value="dispX">Displacement Ux</option>
              <option value="dispY">Displacement Uy</option>
              <option value="dispZ">Displacement Uz</option>
            </select>
          </div>

          {/* Colorbar gradient */}
          <div
            style={{
              height: "8px",
              borderRadius: "4px",
              background:
                "linear-gradient(to right, rgb(34, 48, 141), rgb(43, 126, 219), rgb(80, 203, 114), rgb(240, 217, 43), rgb(233, 73, 23), rgb(130, 20, 10))",
              marginBottom: "4px",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "9px",
              color: "#8b949e",
            }}
          >
            <span>0 MPa</span>
            <span>{maxStressMpa} MPa</span>
          </div>

          {/* Scale Control */}
          <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
              <span>Warp Scale:</span>
              <span>{activeScale}x</span>
            </div>
            <input
              type="range"
              min="1"
              max={maxWarpScale}
              value={activeScale}
              onChange={(e) => setActiveScale(Number(e.target.value))}
              style={{ width: "100%", height: "4px", cursor: "pointer", accentColor: "#58a6ff" }}
            />
          </div>
        </div>
      </Html>
    </group>
  );
}
