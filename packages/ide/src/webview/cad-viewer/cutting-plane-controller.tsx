// SPDX-License-Identifier: AGPL-3.0-or-later

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

export type CuttingPlaneAxis = "none" | "x" | "y" | "z";

export interface CuttingPlaneOptions {
  enabled: boolean;
  axis: CuttingPlaneAxis;
  offset: number;
  inverted?: boolean;
}

export function useCuttingPlane(options: CuttingPlaneOptions): THREE.Plane[] {
  const { gl } = useThree();

  useEffect(() => {
    gl.localClippingEnabled = options.enabled;
  }, [gl, options.enabled]);

  const planes = useMemo(() => {
    if (!options.enabled || options.axis === "none") {
      return [];
    }

    const normal = new THREE.Vector3(0, 0, 1);
    if (options.axis === "x") normal.set(1, 0, 0);
    else if (options.axis === "y") normal.set(0, 1, 0);
    else if (options.axis === "z") normal.set(0, 0, 1);

    if (options.inverted) {
      normal.negate();
    }

    // Plane equation: normal . p + constant = 0
    return [new THREE.Plane(normal, -options.offset)];
  }, [options.enabled, options.axis, options.offset, options.inverted]);

  return planes;
}

export function CuttingPlaneVisualizer({ options }: { options: CuttingPlaneOptions }) {
  if (!options.enabled || options.axis === "none") return null;

  const normal = new THREE.Vector3(0, 0, 1);
  if (options.axis === "x") normal.set(1, 0, 0);
  else if (options.axis === "y") normal.set(0, 1, 0);
  else if (options.axis === "z") normal.set(0, 0, 1);

  if (options.inverted) normal.negate();

  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const pos = normal.clone().multiplyScalar(options.offset);

  return (
    <group position={pos} quaternion={quat}>
      <mesh>
        <planeGeometry args={[0.5, 0.5]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent={true}
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Wireframe border */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(0.5, 0.5)]} />
        <lineBasicMaterial color="#38bdf8" transparent={true} opacity={0.6} />
      </lineSegments>
    </group>
  );
}
