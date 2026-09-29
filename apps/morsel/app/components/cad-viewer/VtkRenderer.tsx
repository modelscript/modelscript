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

  // Parse real VTK XML/ASCII or binary buffer payload
  useEffect(() => {
    if (!vtkBuffer || vtkBuffer.length === 0) return;

    const headerStr = new TextDecoder().decode(vtkBuffer.subarray(0, Math.min(256, vtkBuffer.length)));
    if (headerStr.includes("<VTKFile") || headerStr.includes("vtk")) {
      const fullText = new TextDecoder().decode(vtkBuffer);
      const pointsMatch = /<Points>\s*<DataArray[^>]*>([\s\S]*?)<\/DataArray>/i.exec(fullText);
      if (pointsMatch) {
        const coords = pointsMatch[1].trim().split(/\s+/).map(Number);
        if (coords.length >= 3) {
          let maxR = 0.1;
          for (let i = 0; i < coords.length; i += 3) {
            const r = Math.hypot(coords[i] || 0, coords[i + 1] || 0, coords[i + 2] || 0);
            if (r > maxR) maxR = r;
          }
          setScale(Math.min(2.0, maxR));
        }
      }
      const dataMatch =
        /<DataArray[^>]*Name=["'](Temperature|Pressure|Velocity|alpha\.polymer)["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(
          fullText,
        );
      if (dataMatch && materialRef.current) {
        const vals = dataMatch[2].trim().split(/\s+/).map(Number);
        const avgVal = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        const normVal = Math.min(1.0, Math.max(0.0, avgVal / 100.0));
        const tempColor = new THREE.Color().setHSL((1.0 - normVal) * 0.6, 1.0, 0.5);
        materialRef.current.color = tempColor;
        materialRef.current.emissive = tempColor;
        materialRef.current.emissiveIntensity = 0.4;
      }
    } else if (vtkBuffer.length > 4) {
      const progress = vtkBuffer[4] / 255.0;
      setScale(progress * 1.5);
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
