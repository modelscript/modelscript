// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CfdMeshRenderer — Three.js component for rendering CFD volumetric data
 * received from the co-simulation VTK stream.
 *
 * Renders a surface mesh colored by the `alpha.polymer` field to visualize
 * the melt front progression during injection molding simulation.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/** Parsed CFD mesh payload from the WasmOpenFoamProvider */
export interface CfdMeshPayload {
  type: "cfd-mesh";
  time: number;
  geometry: {
    positions: number[];
    normals: number[];
    indices: number[];
  };
  fields: {
    "alpha.polymer": number[];
    temperature: number[];
  };
  metadata: {
    moldLength: number;
    moldWidth: number;
    moldHeight: number;
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

  // Blend with alpha for partial fill at the front
  return [r * alpha, g * alpha, b * alpha];
}

interface CfdMeshRendererProps {
  /** The latest CFD mesh payload, or null if none received yet */
  payload: CfdMeshPayload | null;
  /** Position offset for the mesh in the scene */
  position?: [number, number, number];
}

export function CfdMeshRenderer({ payload, position = [0, 0, 0] }: CfdMeshRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  // Create geometry once, update per-frame
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    // Pre-allocate with reasonable defaults — will be replaced on first payload
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

    // Compute per-vertex colors from the alpha and temperature fields
    const vertCount = positions.length / 3;
    const colors = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      const [r, g, b] = alphaToColor(alphaField[i] || 0, tempField[i] || 400);
      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }, [payload, geometry]);

  // Subtle emissive pulse on the melt front for visual interest
  useFrame(() => {
    if (materialRef.current && payload) {
      const fillFraction = Math.min(payload.time * 5.0, 1.0);
      materialRef.current.emissiveIntensity = 0.1 + 0.05 * Math.sin(Date.now() * 0.003) * fillFraction;
    }
  });

  if (!payload) return null;

  return (
    <group position={position}>
      {/* Semi-transparent mold outline */}
      <mesh
        position={[payload.metadata.moldLength / 2, payload.metadata.moldWidth / 2, payload.metadata.moldHeight / 2]}
      >
        <boxGeometry
          args={[
            payload.metadata.moldLength * 1.02,
            payload.metadata.moldWidth * 1.02,
            payload.metadata.moldHeight * 1.1,
          ]}
        />
        <meshStandardMaterial color="#3a4a5c" transparent opacity={0.08} side={THREE.DoubleSide} wireframe />
      </mesh>

      {/* CFD field mesh */}
      <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          ref={materialRef}
          vertexColors
          side={THREE.DoubleSide}
          metalness={0.15}
          roughness={0.6}
          emissive="#ff6633"
          emissiveIntensity={0.1}
        />
      </mesh>

      {/* Gate inlet indicator */}
      <mesh position={[0, payload.metadata.moldWidth / 2, payload.metadata.moldHeight / 2]}>
        <cylinderGeometry args={[0.005, 0.005, payload.metadata.moldHeight * 1.5, 8]} />
        <meshStandardMaterial color="#4fc3f7" emissive="#4fc3f7" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}
