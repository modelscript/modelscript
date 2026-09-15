// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CfdMeshRenderer — Three.js component for rendering CFD volumetric data
 * received from the co-simulation VTK stream.
 *
 * Renders a surface mesh colored by the `alpha.polymer` field to visualize
 * the melt front progression during injection molding simulation.
 */

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/** Parsed CFD mesh payload from WasmOpenFoamProvider or LbmCoSimParticipant */
export interface CfdMeshPayload {
  type: "cfd-mesh";
  participantId?: string;
  time: number;
  geometry: {
    positions: number[];
    normals: number[];
    indices: number[];
  };
  fields: {
    "alpha.polymer"?: number[];
    temperature?: number[];
    velocityMagnitude?: number[];
    pressure?: number[];
  };
  metadata?: {
    moldLength?: number;
    moldWidth?: number;
    moldHeight?: number;
    dragForce?: [number, number, number];
    maxVelocity?: number;
    pressureDrop?: number;
  };
}

/** Polymer melt color ramp: transparent → yellow → orange → red */
function alphaToColor(alpha: number, temperature: number): [number, number, number] {
  if (alpha < 0.01) {
    // Empty cavity — show as translucent dark blue-gray
    return [0.12, 0.15, 0.22];
  }
  // Normalize temperature: 350K (cold) → 513K (hot)
  const tNorm = Math.max(0, Math.min((temperature - 350) / (513 - 350), 1.0));

  // Hot polymer: bright orange-red, cooling polymer: darker amber
  const r = 0.9 + tNorm * 0.1;
  const g = 0.2 + tNorm * 0.5;
  const b = 0.05 + (1.0 - tNorm) * 0.15;

  return [r * alpha, g * alpha, b * alpha];
}

function turboColormap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r =
    0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503327 + x * (4.27729857 + x * 2.82956604))));
  const b =
    0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

interface CfdMeshRendererProps {
  /** The latest CFD mesh payload, or null if none received yet */
  payload: CfdMeshPayload | null;
  /** Position offset for the mesh in the scene */
  position?: [number, number, number];
  /** Field to visualize ('auto', 'velocity', 'pressure', 'alpha') */
  field?: CfdFieldType;
}

export type CfdFieldType = "auto" | "velocity" | "pressure" | "alpha";

export function CfdMeshRenderer({ payload, position = [0, 0, 0], field = "auto" }: CfdMeshRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [selectedField, setSelectedField] = useState<CfdFieldType>(field);

  // Create geometry once, update per-frame
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute([], 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
    geo.setIndex(new THREE.Uint32BufferAttribute([], 1));
    return geo;
  }, []);

  // Update geometry when payload changes
  useEffect(() => {
    if (!payload) return;

    const { positions, normals, indices } = payload.geometry;
    const alphaField = payload.fields["alpha.polymer"];
    const tempField = payload.fields.temperature;
    const velField = payload.fields.velocityMagnitude;
    const pressField = payload.fields.pressure;

    const vertCount = positions.length / 3;
    const colors = new Float32Array(vertCount * 3);

    const isLbm = velField && velField.length > 0;
    const mode = selectedField === "auto" ? (isLbm ? "velocity" : "alpha") : selectedField;

    if (mode === "velocity" && velField) {
      const maxV = Math.max(0.1, payload.metadata?.maxVelocity ?? Math.max(...velField));
      for (let i = 0; i < vertCount; i++) {
        const t = Math.max(0, Math.min(1, (velField[i] ?? 0) / maxV));
        const [r, g, b] = turboColormap(t);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
    } else if (mode === "pressure" && pressField) {
      let minP = Infinity,
        maxP = -Infinity;
      for (let i = 0; i < vertCount; i++) {
        const p = pressField[i] ?? 0;
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
      const rangeP = Math.max(1e-3, maxP - minP);
      for (let i = 0; i < vertCount; i++) {
        const t = Math.max(0, Math.min(1, ((pressField[i] ?? 0) - minP) / rangeP));
        const [r, g, b] = turboColormap(t);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
    } else {
      for (let i = 0; i < vertCount; i++) {
        const [r, g, b] = alphaToColor(alphaField?.[i] || 0, tempField?.[i] || 400);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
    }

    // In-place buffer updates to prevent GPU reallocations
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const normAttr = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    const idxAttr = geometry.getIndex();

    if (posAttr && posAttr.array.length === positions.length) {
      (posAttr.array as Float32Array).set(positions);
      posAttr.needsUpdate = true;
    } else {
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    }

    if (normals && normals.length === positions.length) {
      if (normAttr && normAttr.array.length === normals.length) {
        (normAttr.array as Float32Array).set(normals);
        normAttr.needsUpdate = true;
      } else {
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      }
    } else {
      geometry.computeVertexNormals();
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
    geometry.computeBoundingSphere();
  }, [payload, geometry, selectedField]);

  // Subtle emissive pulse on the melt front for visual interest
  useFrame(() => {
    if (materialRef.current && payload) {
      const fillFraction = Math.min(payload.time * 5.0, 1.0);
      materialRef.current.emissiveIntensity = 0.1 + 0.05 * Math.sin(Date.now() * 0.003) * fillFraction;
    }
  });

  if (!payload) return null;

  const hasMold =
    payload.metadata?.moldLength !== undefined &&
    payload.metadata?.moldWidth !== undefined &&
    payload.metadata?.moldHeight !== undefined;

  return (
    <group position={position}>
      {/* Semi-transparent mold outline when present */}
      {hasMold && payload.metadata && (
        <>
          <mesh
            position={[
              (payload.metadata.moldLength ?? 0) / 2,
              (payload.metadata.moldWidth ?? 0) / 2,
              (payload.metadata.moldHeight ?? 0) / 2,
            ]}
          >
            <boxGeometry
              args={[
                (payload.metadata.moldLength ?? 1) * 1.02,
                (payload.metadata.moldWidth ?? 1) * 1.02,
                (payload.metadata.moldHeight ?? 1) * 1.1,
              ]}
            />
            <meshStandardMaterial color="#3a4a5c" transparent opacity={0.08} side={THREE.DoubleSide} wireframe />
          </mesh>

          {/* Gate inlet indicator */}
          <mesh position={[0, (payload.metadata.moldWidth ?? 0) / 2, (payload.metadata.moldHeight ?? 0) / 2]}>
            <cylinderGeometry args={[0.005, 0.005, (payload.metadata.moldHeight ?? 0.05) * 1.5, 8]} />
            <meshStandardMaterial color="#4fc3f7" emissive="#4fc3f7" emissiveIntensity={0.5} />
          </mesh>
        </>
      )}

      {/* CFD field mesh */}
      <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          ref={materialRef}
          vertexColors
          side={THREE.DoubleSide}
          metalness={0.15}
          roughness={0.6}
          emissive="#ff6633"
          emissiveIntensity={0.05}
        />
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
          <div style={{ fontWeight: "bold", color: "#4fc3f7", marginBottom: 4 }}>CFD: Fluid Flow</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span>Time:</span>
            <span style={{ color: "#79c0ff" }}>{payload.time.toFixed(3)} s</span>
          </div>
          {payload.metadata?.maxVelocity !== undefined && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span>Max Vel:</span>
              <span style={{ color: "#58a6ff", fontWeight: "bold" }}>
                {payload.metadata.maxVelocity.toFixed(2)} m/s
              </span>
            </div>
          )}
          {payload.metadata?.dragForce && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span>Drag:</span>
              <span style={{ color: "#ff7b72" }}>{Math.hypot(...payload.metadata.dragForce).toFixed(2)} N</span>
            </div>
          )}

          {/* Field selector */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: "10px", color: "#8b949e", display: "block", marginBottom: 2 }}>Field:</label>
            <select
              value={selectedField}
              onChange={(e) => setSelectedField(e.target.value as CfdFieldType)}
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
              <option value="auto">Auto (Default)</option>
              <option value="velocity">Velocity Magnitude</option>
              <option value="pressure">Pressure Field</option>
              <option value="alpha">Phase / Polymer</option>
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
            <span>Min</span>
            <span>Max</span>
          </div>
        </div>
      </Html>
    </group>
  );
}
