// SPDX-License-Identifier: AGPL-3.0-or-later

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RotundaActiveView, RotundaScaleMode } from "./types.js";

export interface RotundaStageCameraPose {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
}

/**
 * Resolves the canonical desktop vantage point for each 1:1 VR spatial stage,
 * gently pulling back and shifting slightly right when the right-docked Split Code
 * companion wing is open alongside a non-Code stage.
 */
export function resolveStageCameraPose(
  activeView: RotundaActiveView,
  scaleMode: RotundaScaleMode,
  splitCodeOpen: boolean,
): RotundaStageCameraPose {
  const withSplit = splitCodeOpen && activeView !== "code";
  const splitOffsetX = withSplit ? 0.34 : 0;
  const splitPullBackZ = withSplit ? 0.62 : 0;

  switch (activeView) {
    case "diagram":
      return {
        position: [splitOffsetX, 1.54, 0.72 + splitPullBackZ],
        target: [splitOffsetX, 1.4, -1.05],
      };
    case "simulation":
      return {
        position: [splitOffsetX, 1.52, 0.48 + splitPullBackZ],
        target: [splitOffsetX, 1.48, -1.32],
      };
    case "inspector":
      return {
        position: [splitOffsetX, 1.5, 0.42 + splitPullBackZ],
        target: [splitOffsetX, 1.46, -1.22],
      };
    case "code":
      return {
        position: [0, 1.5, 0.28],
        target: [0, 1.46, -1.16],
      };
    case "3d":
    default: {
      const isHero = scaleMode === "hero";
      return {
        position: [splitOffsetX, isHero ? 1.68 : 1.56, (isHero ? 0.72 : 0.62) + splitPullBackZ],
        target: [splitOffsetX, isHero ? 1.4 : 1.24, isHero ? -2.55 : -1.65],
      };
    }
  }
}

export interface RotundaStageCameraRigProps {
  activeView: RotundaActiveView;
  scaleMode: RotundaScaleMode;
  splitCodeOpen: boolean;
  enabled: boolean;
}

/**
 * Desktop 3D orbit rig that smoothly transitions camera & target whenever the
 * user switches VR stages (`diagram`, `3d`, `simulation`, `inspector`, `code`)
 * or toggles Split Code, while immediately yielding to manual mouse drags.
 */
export const RotundaStageCameraRig: React.FC<RotundaStageCameraRigProps> = ({
  activeView,
  scaleMode,
  splitCodeOpen,
  enabled,
}) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

  const desiredPose = useMemo(
    () => resolveStageCameraPose(activeView, scaleMode, splitCodeOpen),
    [activeView, scaleMode, splitCodeOpen],
  );

  const desiredPosVec = useMemo(() => new THREE.Vector3(...desiredPose.position), [desiredPose]);
  const desiredTargetVec = useMemo(() => new THREE.Vector3(...desiredPose.target), [desiredPose]);

  const isTransitioningRef = useRef(false);
  const isUserInteractingRef = useRef(false);
  const prevPoseKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${activeView}|${scaleMode}|${splitCodeOpen ? 1 : 0}`;
    if (prevPoseKeyRef.current === null) {
      // Snap cleanly on initial mount
      camera.position.copy(desiredPosVec);
      if (controlsRef.current) {
        controlsRef.current.target.copy(desiredTargetVec);
        controlsRef.current.update();
      }
      prevPoseKeyRef.current = key;
      return;
    }
    if (prevPoseKeyRef.current !== key) {
      prevPoseKeyRef.current = key;
      isTransitioningRef.current = true;
    }
  }, [activeView, scaleMode, splitCodeOpen, camera, desiredPosVec, desiredTargetVec]);

  useFrame((_state, rawDelta) => {
    if (!isTransitioningRef.current || isUserInteractingRef.current) return;
    const ctrl = controlsRef.current;
    if (!ctrl) return;

    const dt = Math.min(rawDelta, 0.05);
    const alpha = 1 - Math.exp(-dt * 8.5);

    camera.position.lerp(desiredPosVec, alpha);
    ctrl.target.lerp(desiredTargetVec, alpha);
    ctrl.update();

    if (camera.position.distanceTo(desiredPosVec) < 0.008 && ctrl.target.distanceTo(desiredTargetVec) < 0.008) {
      camera.position.copy(desiredPosVec);
      ctrl.target.copy(desiredTargetVec);
      ctrl.update();
      isTransitioningRef.current = false;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={enabled}
      target={desiredPose.target}
      minDistance={0.7}
      maxDistance={7.5}
      maxPolarAngle={Math.PI * 0.495}
      enableDamping
      dampingFactor={0.08}
      onStart={() => {
        isUserInteractingRef.current = true;
        isTransitioningRef.current = false;
      }}
      onEnd={() => {
        isUserInteractingRef.current = false;
      }}
    />
  );
};
