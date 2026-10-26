// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import type { CameraPreset, SpatialPin } from "../types";

export interface CameraControllerProps {
  orbitControlsRef: any;
  presetTrigger?: { preset: CameraPreset; timestamp: number } | null | undefined;
}

export const CameraController: React.FC<CameraControllerProps> = ({ orbitControlsRef, presetTrigger }) => {
  const { camera } = useThree();
  const [targetPin, setTargetPin] = useState<SpatialPin | null>(null);

  useEffect(() => {
    if (!presetTrigger || !orbitControlsRef.current) return;
    const controls = orbitControlsRef.current;
    const target = controls.target || new THREE.Vector3(0, 0, 0);
    const dist = 50;

    switch (presetTrigger.preset) {
      case "iso": {
        const d = dist / Math.sqrt(3);
        camera.position.set(target.x + d, target.y + d, target.z + d);
        break;
      }
      case "top": {
        camera.position.set(target.x, target.y + dist, target.z + 0.001);
        break;
      }
      case "front": {
        camera.position.set(target.x, target.y, target.z + dist);
        break;
      }
      case "right": {
        camera.position.set(target.x + dist, target.y, target.z);
        break;
      }
      case "reset": {
        camera.position.set(0, 0, 50);
        target.set(0, 0, 0);
        break;
      }
    }
    camera.lookAt(target);
    controls.update();
  }, [presetTrigger, camera, orbitControlsRef]);

  useEffect(() => {
    const handleFocus = (e: Event) => {
      const pin = (e as CustomEvent<SpatialPin>).detail;
      if (!pin || !orbitControlsRef.current) return;
      setTargetPin(pin);
    };

    window.addEventListener("focus-spatial-pin", handleFocus);
    return () => window.removeEventListener("focus-spatial-pin", handleFocus);
  }, [orbitControlsRef]);

  useFrame(() => {
    if (targetPin && orbitControlsRef.current) {
      // Lerp camera position
      camera.position.lerp(new THREE.Vector3(...targetPin.cameraPosition), 0.05);
      // Lerp camera target
      orbitControlsRef.current.target.lerp(new THREE.Vector3(...targetPin.cameraTarget), 0.05);
      orbitControlsRef.current.update();

      // Check if arrived (approx)
      if (camera.position.distanceTo(new THREE.Vector3(...targetPin.cameraPosition)) < 0.1) {
        setTargetPin(null);
      }
    }
  });

  return null;
};
