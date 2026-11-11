// SPDX-License-Identifier: AGPL-3.0-or-later

import { Html } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CadComponent, CadSourceMetadata } from "./cad-viewer";

export interface CommitDimensionPayload {
  componentName: string;
  dimensionIndex: number;
  newValue: number;
  primitiveType?: string | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

interface DimensionHandlesProps {
  component: CadComponent;
  onCommitDimension: (payload: CommitDimensionPayload) => void;
  visible?: boolean | undefined;
}

interface DragState {
  axisIndex: number; // 0: X, 1: Y, 2: Z
  startPointerWorld: THREE.Vector3;
  initialDimension: number;
  currentDimension: number;
  axisDirection: THREE.Vector3;
  label: string;
}

const AXIS_COLORS = [
  "#ef4444", // X (Red)
  "#22c55e", // Y (Green)
  "#3b82f6", // Z (Blue)
];

const AXIS_HOVER_COLORS = ["#f87171", "#4ade80", "#60a5fa"];

export function DimensionHandles({ component, onCommitDimension, visible = true }: DimensionHandlesProps) {
  const { camera, raycaster } = useThree();
  const [hoveredAxis, setHoveredAxis] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());

  const dims = component.sourceMetadata?.dimensions;
  if (!visible || !dims || dims.length < 3) return null;

  const shapeType = (component.shapeType ?? "").toLowerCase();
  const isCylinder = shapeType === "cylinder" || component.name.toLowerCase().includes("cylinder");
  const isSphere = shapeType === "sphere" || component.name.toLowerCase().includes("sphere");

  const [dimX, dimY, dimZ] = dims;

  // Determine handle anchor points and direction vectors
  const handles = useMemo(() => {
    if (isSphere) {
      const r = dimX;
      return [
        {
          axisIndex: 0,
          position: [r, 0, 0] as [number, number, number],
          direction: new THREE.Vector3(1, 0, 0),
          rotation: [0, 0, -Math.PI / 2] as [number, number, number],
          label: "Radius",
          currentVal: r,
          primitiveType: "sphere",
        },
      ];
    }

    if (isCylinder) {
      const r = dimX;
      const h = dimY;
      return [
        {
          axisIndex: 0,
          position: [r, 0, 0] as [number, number, number],
          direction: new THREE.Vector3(1, 0, 0),
          rotation: [0, 0, -Math.PI / 2] as [number, number, number],
          label: "Radius",
          currentVal: r,
          primitiveType: "cylinder",
        },
        {
          axisIndex: 1,
          position: [0, h / 2, 0] as [number, number, number],
          direction: new THREE.Vector3(0, 1, 0),
          rotation: [0, 0, 0] as [number, number, number],
          label: "Height",
          currentVal: h,
          primitiveType: "cylinder",
        },
      ];
    }

    // Default: Box / general 3D extents
    return [
      {
        axisIndex: 0,
        position: [dimX / 2, 0, 0] as [number, number, number],
        direction: new THREE.Vector3(1, 0, 0),
        rotation: [0, 0, -Math.PI / 2] as [number, number, number],
        label: "Width (X)",
        currentVal: dimX,
        primitiveType: "cube",
      },
      {
        axisIndex: 1,
        position: [0, dimY / 2, 0] as [number, number, number],
        direction: new THREE.Vector3(0, 1, 0),
        rotation: [0, 0, 0] as [number, number, number],
        label: "Height (Y)",
        currentVal: dimY,
        primitiveType: "cube",
      },
      {
        axisIndex: 2,
        position: [0, 0, dimZ / 2] as [number, number, number],
        direction: new THREE.Vector3(0, 0, 1),
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        label: "Depth (Z)",
        currentVal: dimZ,
        primitiveType: "cube",
      },
    ];
  }, [dimX, dimY, dimZ, isCylinder, isSphere]);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, axisIndex: number, label: string, currentVal: number, dir: THREE.Vector3) => {
      e.stopPropagation();
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);

      // Create a drag plane passing through handle point facing camera
      const planeNormal = camera.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, e.point);
      dragPlaneRef.current = plane;

      setDragState({
        axisIndex,
        startPointerWorld: e.point.clone(),
        initialDimension: currentVal,
        currentDimension: currentVal,
        axisDirection: dir.clone(),
        label,
      });
    },
    [camera],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragState) return;
      e.stopPropagation();

      const intersectionPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionPoint);

      const deltaVec = intersectionPoint.clone().sub(dragState.startPointerWorld);
      const projectedDelta = deltaVec.dot(dragState.axisDirection);

      // Sizing is symmetrical or single-sided depending on primitive; for standard box/cylinder radius, direct delta applies
      const factor = isCylinder && dragState.axisIndex === 0 ? 1 : 2;
      const rawNewVal = Math.max(0.1, dragState.initialDimension + projectedDelta * factor);
      const snappedNewVal = e.shiftKey ? Math.round(rawNewVal) : Number(rawNewVal.toFixed(2));

      setDragState((prev) => (prev ? { ...prev, currentDimension: snappedNewVal } : null));
    },
    [dragState, isCylinder, raycaster.ray],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>, primitiveType: string) => {
      if (!dragState) return;
      e.stopPropagation();
      try {
        (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
      } catch {
        // Fallback
      }

      const finalVal = dragState.currentDimension;
      setDragState(null);

      if (Math.abs(finalVal - dragState.initialDimension) > 0.01) {
        onCommitDimension({
          componentName: component.name,
          dimensionIndex: dragState.axisIndex,
          newValue: finalVal,
          primitiveType,
          sourceMetadata: component.sourceMetadata,
        });
      }
    },
    [component.name, component.sourceMetadata, dragState, onCommitDimension],
  );

  return (
    <group name={`dimension-handles-${component.name}`}>
      {handles.map((h) => {
        const isHovered = hoveredAxis === h.axisIndex;
        const isDraggingThis = dragState?.axisIndex === h.axisIndex;
        const color: string =
          (isDraggingThis || isHovered ? AXIS_HOVER_COLORS[h.axisIndex] : AXIS_COLORS[h.axisIndex]) ?? "#3b82f6";
        const displayVal = isDraggingThis ? dragState.currentDimension : h.currentVal;
        const delta = isDraggingThis ? displayVal - dragState.initialDimension : 0;

        return (
          <group key={h.axisIndex} position={h.position}>
            {/* Cone handle pointer */}
            <mesh
              rotation={h.rotation}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredAxis(h.axisIndex);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                setHoveredAxis((cur) => (cur === h.axisIndex ? null : cur));
              }}
              onPointerDown={(e) => handlePointerDown(e, h.axisIndex, h.label, h.currentVal, h.direction)}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => handlePointerUp(e, h.primitiveType)}
            >
              <coneGeometry args={[0.08, 0.25, 16]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isHovered || isDraggingThis ? 0.6 : 0.2}
                roughness={0.2}
              />
            </mesh>

            {/* Stem cylinder */}
            <mesh rotation={h.rotation} position={[0, 0, 0]}>
              <cylinderGeometry args={[0.015, 0.015, 0.2, 8]} />
              <meshBasicMaterial color={color} />
            </mesh>

            {/* Floating Numerical HUD Badge when hovered or dragging */}
            {(isHovered || isDraggingThis) && (
              <Html distanceFactor={10} style={{ pointerEvents: "none" }}>
                <div
                  style={{
                    background: "rgba(15, 23, 42, 0.92)",
                    backdropFilter: "blur(8px)",
                    border: `1px solid ${color}`,
                    borderRadius: "6px",
                    padding: "4px 8px",
                    color: "#f8fafc",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: "11px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    transform: "translate3d(-50%, -120%, 0)",
                  }}
                >
                  <span style={{ color }}>{h.label}: </span>
                  <span>{displayVal.toFixed(2)} mm</span>
                  {isDraggingThis && Math.abs(delta) > 0.01 && (
                    <span style={{ color: delta > 0 ? "#4ade80" : "#f87171", marginLeft: "6px" }}>
                      ({delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)})
                    </span>
                  )}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
