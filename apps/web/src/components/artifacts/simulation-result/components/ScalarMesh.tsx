// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORMAP_FRAGMENT_SHADER, COLORMAP_VERTEX_SHADER } from "../../../../util/colormap";
import type { SpatialPin } from "../types";

export interface ScalarMeshProps {
  geometry: THREE.BufferGeometry;
  scalarData: Float32Array;
  scalarMin: number;
  scalarMax: number;
  colormapTexture: THREE.DataTexture;
  displacementData: Float32Array | null;
  displacementScale: number;
  loadFactor: number;
  onPinCreated?: ((pin: SpatialPin) => void) | undefined;
  activeField: string;
  isWireframe?: boolean | undefined;
  onProbePoint?: ((data: { point: [number, number, number]; value: number } | null) => void) | undefined;
}

export const ScalarMesh: React.FC<ScalarMeshProps> = ({
  geometry,
  scalarData,
  scalarMin,
  scalarMax,
  colormapTexture,
  displacementData,
  displacementScale,
  loadFactor,
  onPinCreated,
  activeField,
  isWireframe = false,
  onProbePoint,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: COLORMAP_VERTEX_SHADER,
      fragmentShader: COLORMAP_FRAGMENT_SHADER,
      uniforms: {
        colormap: { value: colormapTexture },
        scalarMin: { value: scalarMin },
        scalarMax: { value: scalarMax },
        opacity: { value: 1.0 },
        loadFactor: { value: loadFactor / 100.0 },
      },
      side: THREE.DoubleSide,
      transparent: false,
      wireframe: Boolean(isWireframe),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colormapTexture, scalarMin, scalarMax, isWireframe]);

  // Update the scalar attribute on the geometry
  const displayGeometry = useMemo(() => {
    const geo = geometry.clone();

    // Set scalar attribute
    geo.setAttribute("scalar", new THREE.Float32BufferAttribute(scalarData, 1));

    // Apply displacement if available
    if (displacementData && displacementScale > 0) {
      const positions = geo.getAttribute("position");
      const posArray = (positions as THREE.BufferAttribute).array as Float32Array;
      const newPositions = new Float32Array(posArray.length);

      for (let i = 0; i < posArray.length / 3; i++) {
        if (displacementData.length === posArray.length) {
          // 3D vector displacement
          newPositions[i * 3] = posArray[i * 3]! + displacementData[i * 3]! * displacementScale;
          newPositions[i * 3 + 1] = posArray[i * 3 + 1]! + displacementData[i * 3 + 1]! * displacementScale;
          newPositions[i * 3 + 2] = posArray[i * 3 + 2]! + displacementData[i * 3 + 2]! * displacementScale;
        } else if (displacementData.length > i) {
          // Scalar displacement: apply along the normal (approximated as Z)
          newPositions[i * 3] = posArray[i * 3]!;
          newPositions[i * 3 + 1] = posArray[i * 3 + 1]!;
          newPositions[i * 3 + 2] = posArray[i * 3 + 2]! + displacementData[i]! * displacementScale;
        } else {
          newPositions[i * 3] = posArray[i * 3]!;
          newPositions[i * 3 + 1] = posArray[i * 3 + 1]!;
          newPositions[i * 3 + 2] = posArray[i * 3 + 2]!;
        }
      }
      geo.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
      geo.computeVertexNormals();
    }

    return geo;
  }, [geometry, scalarData, displacementData, displacementScale]);

  // Clean up WebGL resources when displayGeometry or material changes or unmounts
  useEffect(() => {
    return () => {
      displayGeometry.dispose();
    };
  }, [displayGeometry]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // Update uniforms when they change
  useEffect(() => {
    const mat = meshRef.current?.material as THREE.ShaderMaterial | undefined;
    if (mat && mat.uniforms) {
      if (mat.uniforms.scalarMin) mat.uniforms.scalarMin.value = scalarMin;
      if (mat.uniforms.scalarMax) mat.uniforms.scalarMax.value = scalarMax;
      if (mat.uniforms.colormap) mat.uniforms.colormap.value = colormapTexture;
      if (mat.uniforms.loadFactor) mat.uniforms.loadFactor.value = loadFactor / 100.0;
      mat.needsUpdate = true;
    }
  }, [scalarMin, scalarMax, colormapTexture, loadFactor]);

  // Handle double click for spatial pinning
  const handleDoubleClick = (e: any) => {
    e.stopPropagation();

    // Find scalar value at this face (approximate by taking the first vertex of the face)
    let scalarValue = 0;
    if (e.face && e.face.a !== undefined && scalarData) {
      scalarValue = scalarData[e.face.a]!;
    }

    // Determine camera target (simplified: look directly along the ray from camera to point)
    const cameraTarget = [e.point.x, e.point.y, e.point.z] as [number, number, number];

    const pin: SpatialPin = {
      worldPosition: [e.point.x, e.point.y, e.point.z],
      cameraPosition: [e.camera.position.x, e.camera.position.y, e.camera.position.z],
      cameraTarget,
      fieldName: activeField,
      scalarValue,
    };

    if (onPinCreated) {
      onPinCreated(pin);
    }
  };

  const handlePointerMove = (e: any) => {
    e.stopPropagation();
    let scalarValue = 0;
    if (e.face && e.face.a !== undefined && scalarData) {
      scalarValue = scalarData[e.face.a]!;
    }
    onProbePoint?.({
      point: [e.point.x, e.point.y, e.point.z],
      value: scalarValue,
    });
  };

  const handlePointerOut = () => {
    onProbePoint?.(null);
  };

  return (
    <mesh
      ref={meshRef}
      geometry={displayGeometry}
      material={material}
      onDoubleClick={handleDoubleClick}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    />
  );
};
