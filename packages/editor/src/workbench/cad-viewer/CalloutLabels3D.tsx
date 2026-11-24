// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dual-mode 3D Callout Labels for CAD assemblies & showcases.
 *
 * - `mode="dom"` (Non-VR desktop): Renders crisp `<Html>` pills connected by 3D leader lines.
 * - `mode="sprite"` (VR stereo WebXR): Renders Canvas2D billboard `THREE.Sprite` pills + 3D
 *   leader lines that render natively in stereo headsets with zero DOM overhead.
 */

import { Html, Line } from "@react-three/drei";
import React, { useEffect, useMemo } from "react";
import * as THREE from "three";

export interface CalloutPin3D {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly anchor: readonly [number, number, number];
  readonly labelOffset: readonly [number, number, number];
  readonly accentColor?: string | undefined;
  readonly subsystemId?: string | undefined;
}

export interface CalloutLabels3DProps {
  readonly pins: readonly CalloutPin3D[];
  readonly visible: boolean;
  /** `"dom"` for desktop 3D viewers, `"sprite"` for stereo WebXR sessions. */
  readonly mode: "dom" | "sprite";
  readonly dark?: boolean | undefined;
  readonly activeSubsystemId?: string | null | undefined;
  readonly onSelectSubsystem?: ((subsystemId: string) => void) | undefined;
}

function createPinCanvasTexture(
  code: string,
  label: string,
  detail: string | undefined,
  accent: string,
  dark: boolean,
  highlighted: boolean,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = detail ? 128 : 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Rounded pill background
  const r = 16;
  ctx.beginPath();
  ctx.roundRect(6, 6, w - 12, h - 12, r);
  ctx.fillStyle = dark
    ? highlighted
      ? "rgba(15, 23, 42, 0.96)"
      : "rgba(15, 23, 42, 0.86)"
    : highlighted
      ? "rgba(255, 255, 255, 0.98)"
      : "rgba(248, 250, 252, 0.92)";
  ctx.fill();
  ctx.lineWidth = highlighted ? 4 : 2.5;
  ctx.strokeStyle = highlighted ? accent : dark ? "rgba(148, 163, 184, 0.55)" : "rgba(100, 116, 139, 0.45)";
  ctx.stroke();

  // Left accent code chip
  ctx.beginPath();
  ctx.roundRect(18, 18, 66, h - 36, 10);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(code, 51, h / 2 + 1);

  // Title + optional detail
  ctx.textAlign = "left";
  ctx.fillStyle = dark ? "#f8fafc" : "#0f172a";
  ctx.font = "700 28px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(label.slice(0, 22), 100, detail ? 44 : h / 2 + 1);

  if (detail) {
    ctx.fillStyle = dark ? "#94a3b8" : "#475569";
    ctx.font = "600 20px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(detail.slice(0, 30), 100, 84);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const SpriteCalloutPin: React.FC<{
  pin: CalloutPin3D;
  dark: boolean;
  highlighted: boolean;
  onSelectSubsystem?: ((subsystemId: string) => void) | undefined;
}> = ({ pin, dark, highlighted, onSelectSubsystem }) => {
  const accent = pin.accentColor ?? "#f97316";
  const texture = useMemo(
    () => createPinCanvasTexture(pin.code, pin.label, pin.detail, accent, dark, highlighted),
    [pin.code, pin.label, pin.detail, accent, dark, highlighted],
  );

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  const tip: [number, number, number] = [
    pin.anchor[0] + pin.labelOffset[0],
    pin.anchor[1] + pin.labelOffset[1],
    pin.anchor[2] + pin.labelOffset[2],
  ];
  const aspect = pin.detail ? 4.0 : 5.33;
  const spriteHeight = pin.detail ? 0.082 : 0.062;

  return (
    <group>
      <mesh position={[pin.anchor[0], pin.anchor[1], pin.anchor[2]]}>
        <sphereGeometry args={[0.009, 10, 10]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <Line
        points={[[pin.anchor[0], pin.anchor[1], pin.anchor[2]], tip]}
        color={accent}
        lineWidth={highlighted ? 1.8 : 1.1}
        transparent
        opacity={highlighted ? 0.95 : 0.72}
      />
      {texture && (
        <sprite
          position={[tip[0], tip[1] + spriteHeight * 0.55, tip[2]]}
          scale={[spriteHeight * aspect, spriteHeight, 1]}
          onClick={(e) => {
            if (pin.subsystemId && onSelectSubsystem) {
              e.stopPropagation();
              onSelectSubsystem(pin.subsystemId);
            }
          }}
        >
          <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
        </sprite>
      )}
    </group>
  );
};

export const CalloutLabels3D: React.FC<CalloutLabels3DProps> = ({
  pins,
  visible,
  mode,
  dark = true,
  activeSubsystemId = null,
  onSelectSubsystem,
}) => {
  if (!visible || pins.length === 0) return null;

  return (
    <group name="callout-labels-3d">
      {pins.map((pin) => {
        const accent = pin.accentColor ?? "#f97316";
        const highlighted = Boolean(activeSubsystemId && pin.subsystemId === activeSubsystemId);
        const tip: [number, number, number] = [
          pin.anchor[0] + pin.labelOffset[0],
          pin.anchor[1] + pin.labelOffset[1],
          pin.anchor[2] + pin.labelOffset[2],
        ];

        if (mode === "sprite") {
          return (
            <SpriteCalloutPin
              key={pin.id}
              pin={pin}
              dark={dark}
              highlighted={highlighted}
              onSelectSubsystem={onSelectSubsystem}
            />
          );
        }

        return (
          <group key={pin.id}>
            <mesh position={[pin.anchor[0], pin.anchor[1], pin.anchor[2]]}>
              <sphereGeometry args={[0.008, 10, 10]} />
              <meshBasicMaterial color={accent} />
            </mesh>
            <Line
              points={[[pin.anchor[0], pin.anchor[1], pin.anchor[2]], tip]}
              color={accent}
              lineWidth={highlighted ? 1.6 : 1.0}
              transparent
              opacity={highlighted ? 0.95 : 0.65}
            />
            <Html position={tip} center distanceFactor={2.6} style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (pin.subsystemId && onSelectSubsystem) {
                    onSelectSubsystem(pin.subsystemId);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 8px 3px 4px",
                  borderRadius: 6,
                  border: `1px solid ${highlighted ? accent : dark ? "rgba(148,163,184,0.35)" : "rgba(100,116,139,0.35)"}`,
                  background: dark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.92)",
                  color: dark ? "#f8fafc" : "#0f172a",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  cursor: pin.subsystemId ? "pointer" : "default",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                  backdropFilter: "blur(6px)",
                }}
              >
                <span
                  style={{
                    background: accent,
                    color: "#ffffff",
                    fontWeight: 700,
                    padding: "1px 4px",
                    borderRadius: 4,
                    fontSize: 9,
                  }}
                >
                  {pin.code}
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
                  <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>{pin.label}</span>
                  {pin.detail && <span style={{ fontSize: 8.5, opacity: 0.72 }}>{pin.detail}</span>}
                </span>
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
};
