// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MateConnectorTool — Interactive 3D triad snapping and assembly mating tool.
 *
 * Renders local coordinate frames (X=red, Y=green, Z=blue) on component CADPorts
 * and geometric reference points. Clicking Frame A then Frame B initiates
 * kinematic joint alignment and Modelica MultiBody code generation.
 */

import { Html } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import type { CadComponent } from "./cad-viewer";
import type { MateFrameSelection } from "./mate-modal";

export interface MateConnectorToolProps {
  components: CadComponent[];
  active: boolean;
  onSelectPair: (frameA: MateFrameSelection, frameB: MateFrameSelection) => void;
  scale?: number | undefined;
}

interface TriadProps {
  position: [number, number, number];
  rotation?: [number, number, number] | undefined;
  scale?: number | undefined;
  label?: string | undefined;
  badge?: string | undefined;
  badgeColor?: string | undefined;
  isHovered?: boolean | undefined;
  onClick?: ((e: ThreeEvent<MouseEvent>) => void) | undefined;
  onPointerOver?: ((e: ThreeEvent<PointerEvent>) => void) | undefined;
  onPointerOut?: ((e: ThreeEvent<PointerEvent>) => void) | undefined;
}

function Triad({
  position,
  rotation = [0, 0, 0],
  scale = 0.08,
  label,
  badge,
  badgeColor = "#38bdf8",
  isHovered = false,
  onClick,
  onPointerOver,
  onPointerOut,
}: TriadProps) {
  const rotEuler = useMemo(
    () => new THREE.Euler((rotation[0] * Math.PI) / 180, (rotation[1] * Math.PI) / 180, (rotation[2] * Math.PI) / 180),
    [rotation],
  );

  const axisLength = scale;
  const axisRadius = scale * 0.07;
  const coneRadius = scale * 0.16;
  const coneHeight = scale * 0.28;

  return (
    <group
      position={position}
      rotation={rotEuler}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onPointerOver?.(e);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onPointerOut?.(e);
      }}
    >
      {/* Central Origin Anchor Sphere */}
      <mesh>
        <sphereGeometry args={[scale * 0.16, 16, 16]} />
        <meshStandardMaterial
          color={isHovered ? "#facc15" : "#f8fafc"}
          emissive={isHovered ? "#facc15" : "#94a3b8"}
          emissiveIntensity={isHovered ? 0.9 : 0.4}
        />
      </mesh>

      {/* +X Axis (Red) */}
      <group rotation={[0, 0, -Math.PI / 2]} position={[axisLength / 2, 0, 0]}>
        <mesh>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 8]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        <mesh position={[0, axisLength / 2 + coneHeight / 2, 0]}>
          <coneGeometry args={[coneRadius, coneHeight, 12]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      </group>

      {/* +Y Axis (Green) */}
      <group position={[0, axisLength / 2, 0]}>
        <mesh>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 8]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
        <mesh position={[0, axisLength / 2 + coneHeight / 2, 0]}>
          <coneGeometry args={[coneRadius, coneHeight, 12]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      </group>

      {/* +Z Axis (Blue) */}
      <group rotation={[Math.PI / 2, 0, 0]} position={[0, 0, axisLength / 2]}>
        <mesh>
          <cylinderGeometry args={[axisRadius, axisRadius, axisLength, 8]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
        <mesh position={[0, axisLength / 2 + coneHeight / 2, 0]}>
          <coneGeometry args={[coneRadius, coneHeight, 12]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
      </group>

      {/* Floating HUD Label / Selection Badge */}
      {(badge || isHovered) && (
        <Html position={[0, scale * 1.2, 0]} center style={{ pointerEvents: "none", zIndex: 100 }}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.92)",
              backdropFilter: "blur(6px)",
              color: "#f8fafc",
              border: `1px solid ${badge ? badgeColor : "rgba(255, 255, 255, 0.2)"}`,
              borderRadius: "6px",
              padding: "3px 8px",
              fontSize: "10px",
              fontFamily: "monospace",
              fontWeight: 600,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
            }}
          >
            {badge ? <span style={{ color: badgeColor }}>{badge}</span> : <span>{label ?? "Mate Frame"}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

export function MateConnectorTool({ components, active, onSelectPair, scale = 0.12 }: MateConnectorToolProps) {
  const [selectedFrameA, setSelectedFrameA] = useState<MateFrameSelection | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (!active) return null;

  // Extract all available candidate mate frames from CADPorts or component origins
  const candidateFrames = useMemo(() => {
    const list: Array<{
      key: string;
      partName: string;
      frameName?: string | undefined;
      worldPos: [number, number, number];
      rotation: [number, number, number];
      label: string;
    }> = [];

    for (const comp of components) {
      const partPos: [number, number, number] = comp.cad.position ?? [0, 0, 0];
      const partRot: [number, number, number] = comp.cad.rotation ?? [0, 0, 0];

      // Explicit CADPorts
      if (comp.ports && comp.ports.length > 0) {
        for (const p of comp.ports) {
          const off = p.port.offsetPosition ?? [0, 0, 0];
          const worldX = partPos[0] + off[0];
          const worldY = partPos[1] + off[1];
          const worldZ = partPos[2] + off[2];
          list.push({
            key: `${comp.name}.${p.name}`,
            partName: comp.name,
            frameName: p.name,
            worldPos: [worldX, worldY, worldZ],
            rotation: p.port.offsetRotation ?? partRot,
            label: `${comp.name}.${p.name}`,
          });
        }
      } else {
        // Fallback: Default origin frame for component
        list.push({
          key: `${comp.name}.frame_a`,
          partName: comp.name,
          frameName: undefined,
          worldPos: partPos,
          rotation: partRot,
          label: `${comp.name}`,
        });
      }
    }

    return list;
  }, [components]);

  const handleFrameClick = (frame: {
    key: string;
    partName: string;
    frameName?: string | undefined;
    worldPos: [number, number, number];
  }) => {
    const sel: MateFrameSelection = {
      partName: frame.partName,
      frameName: frame.frameName,
      worldPosition: frame.worldPos,
    };

    if (!selectedFrameA) {
      setSelectedFrameA(sel);
    } else {
      if (selectedFrameA.partName === frame.partName && selectedFrameA.frameName === frame.frameName) {
        // Deselect if clicking the same frame
        setSelectedFrameA(null);
        return;
      }
      onSelectPair(selectedFrameA, sel);
      setSelectedFrameA(null);
    }
  };

  return (
    <group>
      {/* Visual Alignment Link Line if Frame A is selected */}
      {selectedFrameA && (
        <group>
          {candidateFrames
            .filter(
              (f) =>
                f.partName !== selectedFrameA.partName || (f.frameName && f.frameName !== selectedFrameA.frameName),
            )
            .map((f) => {
              const pA = new THREE.Vector3(...selectedFrameA.worldPosition);
              const pB = new THREE.Vector3(...f.worldPos);
              const points = [pA, pB];
              const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
              return (
                <primitive
                  key={`line_${f.key}`}
                  object={
                    new THREE.Line(
                      lineGeo,
                      new THREE.LineDashedMaterial({
                        color: "#38bdf8",
                        dashSize: 0.05,
                        gapSize: 0.03,
                        transparent: true,
                        opacity: 0.35,
                      }),
                    )
                  }
                />
              );
            })}
        </group>
      )}

      {/* Render Triads for all Candidate Frames */}
      {candidateFrames.map((f) => {
        const isSelectedA = selectedFrameA?.partName === f.partName && selectedFrameA?.frameName === f.frameName;
        const isHovered = hoveredKey === f.key;

        let badge: string | undefined;
        let badgeColor: string | undefined;
        if (isSelectedA) {
          badge = `Frame A: ${f.label}`;
          badgeColor = "#38bdf8";
        } else if (isHovered && selectedFrameA) {
          badge = `Click to Mate with ${selectedFrameA.partName}`;
          badgeColor = "#4ade80";
        }

        return (
          <Triad
            key={f.key}
            position={f.worldPos}
            rotation={f.rotation}
            scale={isSelectedA || isHovered ? scale * 1.3 : scale}
            label={f.label}
            badge={badge}
            badgeColor={badgeColor}
            isHovered={isHovered || isSelectedA}
            onClick={() => handleFrameClick(f)}
            onPointerOver={() => setHoveredKey(f.key)}
            onPointerOut={() => setHoveredKey((prev) => (prev === f.key ? null : prev))}
          />
        );
      })}
    </group>
  );
}
