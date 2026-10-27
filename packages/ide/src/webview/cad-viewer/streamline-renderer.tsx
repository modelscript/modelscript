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

      const steps = 48;
      const dx = (maxX - minX) / steps;
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const charR = Math.max(0.04, Math.min(maxY - minY, maxZ - minZ) * 0.28);
      const r2 = charR * charR;

      let curX = minX;
      let curY = y0;
      let curZ = z0;

      for (let s = 0; s <= steps; s++) {
        points.push(new THREE.Vector3(curX, curY, curZ));

        const rx = curX - cx;
        const ry = curY - cy;
        const rz = curZ - cz;
        const distSq = Math.max(r2 * 0.35, rx * rx + ry * ry + rz * rz);

        // Potential flow around 3D body: u_x = U*(1 + r^2*(y^2+z^2 - x^2)/d^4), u_y = U*2*r^2*x*y/d^4
        const invD4 = 1.0 / (distSq * distSq);
        const uxRatio = Math.max(0.25, 1.0 + r2 * (ry * ry + rz * rz - rx * rx) * invD4);
        const uyRatio = -2.0 * r2 * rx * ry * invD4;
        const uzRatio = -2.0 * r2 * rx * rz * invD4;

        const localVel = flowVelocity * Math.hypot(uxRatio, uyRatio, uzRatio);
        const tNorm = Math.min(1.0, Math.max(0.0, localVel / (flowVelocity * 1.4)));

        // Turbo colormap approximation
        colors.push(tNorm * 0.9, 0.2 + tNorm * 0.6, 1.0 - tNorm * 0.8);

        curX += dx;
        curY += (uyRatio / uxRatio) * dx;
        curZ += (uzRatio / uxRatio) * dx;
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
