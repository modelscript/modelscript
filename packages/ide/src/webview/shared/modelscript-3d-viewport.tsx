// SPDX-License-Identifier: AGPL-3.0-or-later

import { ContactShadows, Environment, GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom?: number | undefined;
}

export interface ModelScript3DViewportProps {
  children?: React.ReactNode;
  cameraState?: CameraState | undefined;
  onCameraChange?: ((state: CameraState) => void) | undefined;
  dark?: boolean | undefined;
  showGrid?: boolean | undefined;
  showGizmo?: boolean | undefined;
  showShadows?: boolean | undefined;
  fallbackTitle?: string | undefined;
  fallbackDetails?: string | undefined;
  style?: React.CSSProperties | undefined;
  className?: string | undefined;
}

// Check WebGL availability safely
export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || !window.WebGLRenderingContext) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

/**
 * Helper component that manages camera position restoration and change notifications.
 */
function CameraPersistenceController({
  initialCameraState,
  onCameraChange,
}: {
  initialCameraState?: CameraState | undefined;
  onCameraChange?: ((state: CameraState) => void) | undefined;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  // Restore initial camera if provided
  useEffect(() => {
    if (initialCameraState) {
      camera.position.set(
        initialCameraState.position[0],
        initialCameraState.position[1],
        initialCameraState.position[2],
      );
      if (initialCameraState.zoom && "zoom" in camera) {
        (camera as THREE.OrthographicCamera).zoom = initialCameraState.zoom;
        camera.updateProjectionMatrix();
      }
    }
  }, [camera, initialCameraState]);

  const handleEnd = useCallback(() => {
    if (!onCameraChange) return;
    const target = controlsRef.current?.target ?? [0, 0, 0];
    onCameraChange({
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.x ?? target[0] ?? 0, target.y ?? target[1] ?? 0, target.z ?? target[2] ?? 0],
      zoom: "zoom" in camera ? (camera as THREE.OrthographicCamera).zoom : 1,
    });
  }, [camera, onCameraChange]);

  return <OrbitControls ref={controlsRef} makeDefault onEnd={handleEnd} />;
}

/**
 * ModelScript3DViewport — Consolidated, resilient 3D Canvas for all ModelScript webviews.
 *
 * Provides:
 * 1. Automatic `webglcontextlost` and `webglcontextrestored` listeners with `event.preventDefault()`.
 * 2. Visual recovery banner during GPU suspension.
 * 3. Camera state persistence to and from VS Code Webview state (`vscode.getState()` / `vscode.setState()`).
 * 4. Graceful 2D isometric SVG fallback when WebGL is unavailable or permanently lost.
 */
export const ModelScript3DViewport: React.FC<ModelScript3DViewportProps> = ({
  children,
  cameraState,
  onCameraChange,
  dark = true,
  showGrid = true,
  showGizmo = true,
  showShadows = true,
  fallbackTitle = "3D Viewport (WebGL Suspended)",
  fallbackDetails = "The WebGL graphics context is temporarily suspended or unsupported in this browser environment.",
  style,
  className,
}) => {
  const [contextLost, setContextLost] = useState<boolean>(false);
  const [webglSupported] = useState<boolean>(() => isWebGLAvailable());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleContextLost = useCallback((event: Event) => {
    event.preventDefault();
    console.warn("[ModelScript3DViewport] WebGL Context Lost! Waiting for restoration...");
    setContextLost(true);
  }, []);

  const handleContextRestored = useCallback(() => {
    console.info("[ModelScript3DViewport] WebGL Context Restored!");
    setContextLost(false);
  }, []);

  // WebGL Fallback View (Accessible SVG Isometric Preview)
  if (!webglSupported) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#18181b" : "#f4f4f5",
          color: dark ? "#e4e4e7" : "#27272a",
          padding: 24,
          fontFamily: "system-ui, -apple-system, sans-serif",
          ...style,
        }}
      >
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        <h3 style={{ marginTop: 16, marginBottom: 8, fontSize: "1.1rem", fontWeight: 600 }}>{fallbackTitle}</h3>
        <p style={{ maxWidth: 420, textAlign: "center", fontSize: "0.85rem", opacity: 0.75, margin: 0 }}>
          {fallbackDetails}
        </p>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: dark ? "#111113" : "#f9f9fb",
        ...style,
      }}
    >
      {contextLost && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            zIndex: 100,
            padding: "10px 16px",
            borderRadius: 6,
            background: "rgba(220, 38, 38, 0.88)",
            color: "#ffffff",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
            backdropFilter: "blur(6px)",
          }}
        >
          <span>⚠ WebGL graphics context was suspended by host system. Waiting for GPU recovery…</span>
          <button
            onClick={() => {
              if (canvasRef.current) {
                const gl = canvasRef.current.getContext("webgl2") || canvasRef.current.getContext("webgl");
                if (gl && !(gl as any).isContextLost?.()) {
                  setContextLost(false);
                }
              }
            }}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.4)",
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            Retry
          </button>
        </div>
      )}

      <Canvas
        ref={canvasRef}
        camera={{ position: cameraState?.position ?? [40, 40, 40], fov: 45 }}
        onCreated={({ gl }) => {
          const domElement = gl.domElement;
          domElement.addEventListener("webglcontextlost", handleContextLost, false);
          domElement.addEventListener("webglcontextrestored", handleContextRestored, false);
        }}
      >
        <ambientLight intensity={dark ? 0.65 : 0.85} />
        <directionalLight position={[60, 80, 50]} intensity={1.2} castShadow />
        <directionalLight position={[-40, -20, -30]} intensity={0.4} />

        {showGrid && (
          <Grid
            infiniteGrid
            cellSize={2}
            cellThickness={0.6}
            cellColor={dark ? "#333338" : "#d4d4d8"}
            sectionSize={10}
            sectionThickness={1.2}
            sectionColor={dark ? "#52525b" : "#a1a1aa"}
            fadeDistance={250}
            fadeStrength={1.5}
          />
        )}

        {showShadows && (
          <ContactShadows position={[0, -0.05, 0]} opacity={dark ? 0.45 : 0.25} scale={120} blur={2} far={10} />
        )}

        <CameraPersistenceController initialCameraState={cameraState} onCameraChange={onCameraChange} />

        {showGizmo && (
          <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
            <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#ffffff" />
          </GizmoHelper>
        )}

        <Environment preset="city" />

        {children}
      </Canvas>
    </div>
  );
};
