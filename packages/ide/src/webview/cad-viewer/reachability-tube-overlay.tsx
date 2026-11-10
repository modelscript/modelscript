// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ReachabilityTubeSegment } from "@modelscript/cad";

export interface ReachabilityTubeOverlayProps {
  segments?: ReachabilityTubeSegment[] | undefined;
  color?: string | undefined;
  opacity?: number | undefined;
  visible?: boolean | undefined;
  /** Minimum radius for the tube */
  baseRadius?: number | undefined;
}

/**
 * ReachabilityTubeOverlay — Renders 3D continuous reachability flowpipes.
 *
 * Extrudes time-parameterized reachability bounds / zonotope cross-sections
 * into continuous 3D tube geometry with vertex coloring according to STL robustness.
 */
export const ReachabilityTubeOverlay: React.FC<ReachabilityTubeOverlayProps> = ({
  segments,
  color,
  opacity = 0.45,
  visible = true,
  baseRadius,
}) => {
  const geometry = useMemo(() => {
    if (!visible || !segments || segments.length < 2) return null;

    const points = segments.map((s) => new THREE.Vector3(s.center[0], s.center[1], s.center[2]));
    const curve = new THREE.CatmullRomCurve3(points);

    // Compute average radius from segments
    let avgRadius = 0.01;
    if (baseRadius !== undefined) {
      avgRadius = baseRadius;
    } else {
      let sum = 0;
      for (const s of segments) {
        sum += (s.radii[0] + s.radii[1] + s.radii[2]) / 3;
      }
      avgRadius = Math.max(0.005, sum / segments.length);
    }

    const tubularSegments = Math.max(32, segments.length * 4);
    const radialSegments = 12;
    const geo = new THREE.TubeGeometry(curve, tubularSegments, avgRadius, radialSegments, false);

    // Apply vertex colors based on segment robustness rho(t)
    const pos = geo.attributes["position"];
    if (pos) {
      const colors = new Float32Array(pos.count * 3);
      const safeColor = new THREE.Color("#10b981"); // green
      const warnColor = new THREE.Color("#f59e0b"); // amber
      const violColor = new THREE.Color("#ef4444"); // crimson

      for (let i = 0; i < pos.count; i++) {
        // Approximate time fraction along the tube
        const u = Math.min(1.0, Math.max(0.0, i / pos.count));
        const segIdx = Math.min(segments.length - 1, Math.floor(u * segments.length));
        const rho = segments[segIdx]?.robustness ?? 1.0;

        let col = safeColor;
        if (rho < 0) {
          col = violColor;
        } else if (rho < 0.2) {
          col = warnColor;
        }

        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }

    return geo;
  }, [segments, visible, baseRadius]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (!visible || !geometry) return null;

  return (
    <mesh geometry={geometry} renderOrder={10}>
      <meshStandardMaterial
        {...(color ? { color: new THREE.Color(color) } : {})}
        vertexColors={!color}
        transparent
        opacity={opacity}
        roughness={0.3}
        metalness={0.1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
};
