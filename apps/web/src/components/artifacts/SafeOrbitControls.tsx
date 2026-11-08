// SPDX-License-Identifier: AGPL-3.0-or-later

import { OrbitControls as DreiOrbitControls, Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import React, { useEffect, useRef, useState } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export interface SafeOrbitControlsProps {
  isFullScreen?: boolean | undefined;
  controlsRef?: React.RefObject<OrbitControlsImpl | null> | undefined;
  enableDamping?: boolean | undefined;
  dampingFactor?: number | undefined;
  minDistance?: number | undefined;
  maxDistance?: number | undefined;
}

export const SafeOrbitControls: React.FC<SafeOrbitControlsProps> = ({
  isFullScreen = false,
  controlsRef,
  enableDamping = true,
  dampingFactor = 0.08,
  minDistance,
  maxDistance,
}) => {
  const { gl } = useThree();
  const [isZoomAllowed, setIsZoomAllowed] = useState(Boolean(isFullScreen));
  const [showHint, setShowHint] = useState(false);
  const hintTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isFullScreen) {
      setIsZoomAllowed(true);
      return;
    }

    const canvas = gl.domElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setIsZoomAllowed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        setIsZoomAllowed(false);
      }
    };

    const handleBlur = () => {
      setIsZoomAllowed(false);
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setIsZoomAllowed(true);
      } else {
        setIsZoomAllowed(false);
        // Feed scroll protection: show hint that Ctrl/Cmd is required to zoom model
        setShowHint(true);
        if (hintTimeoutRef.current) {
          clearTimeout(hintTimeoutRef.current);
        }
        hintTimeoutRef.current = setTimeout(() => {
          setShowHint(false);
        }, 1800);
      }
    };

    canvas.setAttribute("style", `${canvas.getAttribute("style") || ""}; touch-action: none;`);

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        setIsZoomAllowed(true);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && !isFullScreen) {
        setIsZoomAllowed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    canvas.addEventListener("wheel", handleWheel, { passive: true });
    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchend", handleTouchEnd);
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
    };
  }, [gl.domElement, isFullScreen]);

  return (
    <>
      <DreiOrbitControls
        ref={controlsRef as any}
        makeDefault
        enableZoom={isZoomAllowed}
        enableDamping={enableDamping}
        dampingFactor={dampingFactor}
        minDistance={minDistance}
        maxDistance={maxDistance}
        touches={{
          ONE: 0, // THREE.TOUCH.ROTATE
          TWO: 1, // THREE.TOUCH.DOLLY_PAN
        }}
      />
      {showHint && !isZoomAllowed && (
        <Html center style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.88)",
              backdropFilter: "blur(8px)",
              color: "#f8fafc",
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
            }}
          >
            💡 Hold ⌘/Ctrl to zoom 3D model
          </div>
        </Html>
      )}
    </>
  );
};

export default SafeOrbitControls;
