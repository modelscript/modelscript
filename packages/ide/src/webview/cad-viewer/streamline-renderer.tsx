// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import * as THREE from "three";

interface StreamlineRendererProps {
  enabled: boolean;
  flowVelocity?: number;
  domainBounds?: { min: [number, number, number]; max: [number, number, number] };
  numLines?: number;
  clippingPlanes?: THREE.Plane[];
}

export function StreamlineRenderer({
  enabled,
  flowVelocity = 100,
  domainBounds = { min: [-0.6, -0.2, -0.15], max: [0.6, 0.2, 0.15] },
  numLines = 24,
  clippingPlanes,
}: StreamlineRendererProps) {
  const lineGeometries = useMemo(() => {
    if (!enabled) return [];

    const lines: THREE.BufferGeometry[] = [];
    const [minX, minY, minZ] = domainBounds.min;
    const [maxX, maxY, maxZ] = domainBounds.max;

    for (let i = 0; i < numLines; i++) {
      // Seed positions on inlet y-z plane
      const yFrac = (i % 6) / 5;
      const zFrac = Math.floor(i / 6) / 3;
      const y0 = minY + yFrac * (maxY - minY);
      const z0 = minZ + zFrac * (maxZ - minZ);

      const points: THREE.Vector3[] = [];
      const colors: number[] = [];

      const steps = 40;
      let curX = minX;
      let curY = y0;
      const curZ = z0;

      for (let s = 0; s <= steps; s++) {
        points.push(new THREE.Vector3(curX, curY, curZ));

        // Speed ramps up around center obstruction and slows down in wake
        const distFromCenter = Math.hypot(curX, curY, curZ);
        const localVel = distFromCenter < 0.15 ? flowVelocity * 1.3 : flowVelocity * (0.8 + 0.2 * (s / steps));
        const tNorm = Math.min(1.0, localVel / (flowVelocity * 1.4));

        // Turbo colormap approximation
        colors.push(tNorm * 0.9, 0.2 + tNorm * 0.6, 1.0 - tNorm * 0.8);

        // Advect along X with slight streamline curvature around origin
        curX += (maxX - minX) / steps;
        if (Math.abs(curX) < 0.2 && Math.abs(curY) < 0.1) {
          curY += Math.sign(curY || 1) * 0.005;
        }
      }

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      lines.push(geo);
    }

    return lines;
  }, [enabled, flowVelocity, domainBounds, numLines]);

  if (!enabled) return null;

  return (
    <group>
      {lineGeometries.map((geo, idx) => (
        <line key={`streamline-${idx}`} geometry={geo}>
          <lineBasicMaterial
            vertexColors={true}
            linewidth={2}
            transparent={true}
            opacity={0.85}
            clippingPlanes={clippingPlanes}
          />
        </line>
      ))}
    </group>
  );
}
