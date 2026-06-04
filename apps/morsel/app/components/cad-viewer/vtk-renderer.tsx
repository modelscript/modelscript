// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface VtkRendererProps {
  /** The latest VTK buffer extracted from the CFD orchestrator */
  vtkBuffer: Uint8Array | null;
  /** Opacity of the melt front */
  opacity?: number;
}

/**
 * VtkRenderer - Parses VTK buffer payloads and renders isosurfaces.
 *
 * In a full vtk.js integration, this would pipe the Uint8Array into a vtkXMLImageDataReader,
 * run vtkImageMarchingCubes to extract the alpha.polymer=0.5 isosurface, and map the T (temperature)
 * field to a vtkColorTransferFunction.
 *
 * For this architecture, we use a custom shader on a sphere to simulate the expanding melt front.
 */
export function VtkRenderer({ vtkBuffer, opacity = 0.8 }: VtkRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [scale, setScale] = useState(0);

  // Parse the mock VTK buffer payload
  useEffect(() => {
    if (vtkBuffer && vtkBuffer.length > 4) {
      // The mock CFD provider puts a simulation progress byte at index 4 (0-255)
      const progress = vtkBuffer[4] / 255.0;
      setScale(progress * 1.5); // Melt front expands

      // Map temperature to color (Cold=Blue -> Hot=Red)
      if (materialRef.current) {
        const tempColor = new THREE.Color().setHSL((1.0 - progress) * 0.6, 1.0, 0.5);
        materialRef.current.color = tempColor;
        materialRef.current.emissive = tempColor;
        materialRef.current.emissiveIntensity = 0.4;
      }
    }
  }, [vtkBuffer]);

  useFrame((state) => {
    if (meshRef.current) {
      // Pulsating organic effect to simulate turbulent melt front
      const pulse = 1.0 + Math.sin(state.clock.elapsedTime * 10) * 0.05;
      meshRef.current.scale.setScalar(Math.max(0.01, scale * pulse));
    }
  });

  if (!vtkBuffer) return null;

  return (
    <mesh ref={meshRef} position={[0, 0.5, 0]}>
      {/* 3D marching cubes isosurface simulation */}
      <icosahedronGeometry args={[1, 4]} />
      <meshStandardMaterial ref={materialRef} transparent opacity={opacity} roughness={0.2} metalness={0.1} />
    </mesh>
  );
}
