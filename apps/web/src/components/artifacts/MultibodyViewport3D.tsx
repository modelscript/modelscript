// SPDX-License-Identifier: AGPL-3.0-or-later

import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { useEffect, useMemo } from "react";
import styled from "styled-components";
import * as THREE from "three";

export interface MultibodyNode3D {
  id: string;
  name: string;
  type: "body" | "marker" | "wheelset" | "track";
  position: [number, number, number];
  rotation?: [number, number, number] | undefined;
  dimensions?: [number, number, number] | undefined;
  color?: string | undefined;
}

export interface MultibodyLink3D {
  id: string;
  name: string;
  type: "joint" | "spring_damper" | "rail";
  from: [number, number, number];
  to: [number, number, number];
  color?: string | undefined;
}

export interface MultibodyViewport3DProps {
  nodes: MultibodyNode3D[];
  links?: MultibodyLink3D[] | undefined;
  height?: string | number | undefined;
}

const ViewportContainer = styled.div<{ $height: string | number }>`
  width: 100%;
  height: ${(p) => (typeof p.$height === "number" ? `${p.$height}px` : p.$height)};
  background: radial-gradient(circle at center, #161b22 0%, #0d1117 100%);
  border-radius: 6px;
  border: 1px solid var(--color-border-default, #30363d);
  overflow: hidden;
  position: relative;
`;

const FallbackContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-fg-muted, #8b949e);
  font-size: 13px;
  gap: 8px;
`;

const SceneContent: React.FC<{ nodes: MultibodyNode3D[]; links: MultibodyLink3D[] }> = ({ nodes, links }) => {
  const linkGeometries = useMemo(() => {
    return links.map((link) => {
      const [x1, y1, z1] = link.from;
      const [x2, y2, z2] = link.to;
      const p1 = new THREE.Vector3(x1, z1, -y1);
      const p2 = new THREE.Vector3(x2, z2, -y2);
      const curve = new THREE.LineCurve3(p1, p2);
      const geom = new THREE.TubeGeometry(curve, 1, 0.03, 8, false);
      return { link, geom };
    });
  }, [links]);

  useEffect(() => {
    return () => {
      for (const item of linkGeometries) {
        item.geom.dispose();
      }
    };
  }, [linkGeometries]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 20, 15]} intensity={1.2} />
      <directionalLight position={[-10, -10, -5]} intensity={0.4} />

      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.0}
        cellColor="#21262d"
        sectionColor="#30363d"
        fadeDistance={40}
        position={[0, 0, 0]}
      />

      {/* Render Bodies & Markers */}
      {nodes.map((node) => {
        const [x, y, z] = node.position;
        const [dx, dy, dz] = node.dimensions || (node.type === "body" ? [1.2, 0.6, 0.4] : [0.15, 0.15, 0.15]);
        const color =
          node.color || (node.type === "body" ? "#58a6ff" : node.type === "wheelset" ? "#d29922" : "#3fb950");

        return (
          <group key={node.id} position={[x, z, -y]}>
            {node.type === "body" || node.type === "wheelset" ? (
              <mesh>
                <boxGeometry args={[dx, dz, dy]} />
                <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} transparent opacity={0.85} />
              </mesh>
            ) : (
              <mesh>
                <sphereGeometry args={[dx * 0.5, 16, 16]} />
                <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
              </mesh>
            )}
            <axesHelper args={[0.5]} />
          </group>
        );
      })}

      {/* Render Joint/Spring links */}
      {linkGeometries.map(({ link, geom }) => (
        <mesh key={link.id} geometry={geom}>
          <meshStandardMaterial color={link.color || (link.type === "joint" ? "#f0883e" : "#a371f7")} roughness={0.3} />
        </mesh>
      ))}

      <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={["#f85149", "#3fb950", "#58a6ff"]} labelColor="#ffffff" />
      </GizmoHelper>
    </>
  );
};

export const MultibodyViewport3D: React.FC<MultibodyViewport3DProps> = ({ nodes, links = [], height = "320px" }) => {
  // Check if WebGL canvas is supported in current environment
  const isWebGLAvailable = useMemo(() => {
    try {
      const canvas = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      );
    } catch {
      return false;
    }
  }, []);

  return (
    <ViewportContainer $height={height}>
      {isWebGLAvailable ? (
        <Canvas camera={{ position: [5, 4, 6], fov: 45 }} style={{ width: "100%", height: "100%" }}>
          <SceneContent nodes={nodes} links={links} />
        </Canvas>
      ) : (
        <FallbackContainer>
          <span>3D WebGL Multibody Canvas</span>
          <span style={{ fontSize: "11px" }}>
            ({nodes.length} bodies/markers, {links.length} couplings indexed)
          </span>
        </FallbackContainer>
      )}
    </ViewportContainer>
  );
};

export default MultibodyViewport3D;
