// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { DynamicClearanceVectorEntry } from "@modelscript/cad";

export interface DynamicClearanceVectorProps {
  clearanceHistory?: DynamicClearanceVectorEntry[] | undefined;
  currentTime?: number | undefined;
  visible?: boolean | undefined;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * DynamicClearanceVector — Visualizes closest-point clearance vectors in real-time.
 *
 * Renders an animated connecting cylinder and distance tag between the closest parts,
 * highlighting dynamic proximity and flashing red on clearance violations.
 */
export const DynamicClearanceVector: React.FC<DynamicClearanceVectorProps> = ({
  clearanceHistory,
  currentTime = 0,
  visible = true,
}) => {
  // Find entry closest to currentTime
  const currentEntry = useMemo(() => {
    if (!visible || !clearanceHistory || clearanceHistory.length === 0) return null;
    let closest = clearanceHistory[0]!;
    let minDt = Math.abs(closest.time - currentTime);

    for (let i = 1; i < clearanceHistory.length; i++) {
      const dt = Math.abs(clearanceHistory[i]!.time - currentTime);
      if (dt < minDt) {
        minDt = dt;
        closest = clearanceHistory[i]!;
      }
    }
    return closest;
  }, [clearanceHistory, currentTime, visible]);

  const segment = useMemo(() => {
    if (!currentEntry) return null;
    const p1 = new THREE.Vector3(...currentEntry.pointA);
    const p2 = new THREE.Vector3(...currentEntry.pointB);
    const dir = p2.clone().sub(p1);
    const dist = dir.length();
    if (dist < 1e-4) return null;

    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());

    return {
      mid,
      quat,
      length: dist,
      p1,
      p2,
      isViolation: currentEntry.isViolation,
      distance: currentEntry.distance,
      partA: currentEntry.partA,
      partB: currentEntry.partB,
    };
  }, [currentEntry]);

  if (!visible || !segment) return null;

  const color = segment.isViolation ? "#ef4444" : "#10b981";

  return (
    <group name="dynamic-clearance-vector">
      {/* Connecting distance beam */}
      <mesh position={segment.mid} quaternion={segment.quat}>
        <cylinderGeometry args={[0.003, 0.003, segment.length, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          roughness={0.2}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Point A contact disc */}
      <mesh position={segment.p1}>
        <sphereGeometry args={[0.006, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>

      {/* Point B contact disc */}
      <mesh position={segment.p2}>
        <sphereGeometry args={[0.006, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>

      {/* 3D Billboarded distance tag */}
      <Html position={segment.mid} center distanceFactor={15}>
        <div
          style={{
            background: segment.isViolation ? "rgba(185, 28, 28, 0.9)" : "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(6px)",
            border: `1px solid ${color}`,
            borderRadius: "4px",
            padding: "2px 6px",
            color: "#f8fafc",
            fontSize: "11px",
            fontFamily: "monospace",
            fontWeight: 600,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          {segment.distance.toFixed(2)} mm
        </div>
      </Html>
    </group>
  );
};
