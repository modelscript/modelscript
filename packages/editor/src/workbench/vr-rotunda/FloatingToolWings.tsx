// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame } from "@react-three/fiber";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  clampNumber,
  ROTUNDA_ENVIRONMENTS,
  type RotundaAction,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaEnvironmentMeta,
  type RotundaRenderStyle,
  type RotundaState,
} from "./types.js";

export interface FloatingToolWingsProps {
  state: RotundaState;
  activeModelTitle: string;
  modelCount: number;
  visible: boolean;
  dispatch: React.Dispatch<RotundaAction>;
  onPlayCue?: ((kind: "tick" | "page" | "snap" | "click" | "env") => void) | undefined;
}

const WING_WIDTH = 0.88;
const WING_HEIGHT = 0.78;
const WING_YAW_RAD = (26 * Math.PI) / 180;
const LEFT_WING_POS: [number, number, number] = [-1.18, 1.36, -1.32];
const RIGHT_WING_POS: [number, number, number] = [1.18, 1.36, -1.32];

const CAE_OVERLAY_OPTIONS: readonly { id: RotundaCaeOverlay; label: string; color: string }[] = [
  { id: "none", label: "None", color: "#38bdf8" },
  { id: "fea-stress", label: "FEA Stress", color: "#f97316" },
  { id: "cfd-flow", label: "CFD Flow", color: "#06b6d4" },
  { id: "thermal", label: "Thermal", color: "#ef4444" },
] as const;

const RENDER_STYLE_OPTIONS: readonly { id: RotundaRenderStyle; label: string; color: string }[] = [
  { id: "shaded", label: "Shaded", color: "#38bdf8" },
  { id: "wireframe", label: "Wireframe", color: "#a855f7" },
  { id: "xray", label: "X-Ray", color: "#22d3ee" },
] as const;

const CLIP_AXES: readonly { axis: RotundaClipAxis; label: string }[] = [
  { axis: "x", label: "X" },
  { axis: "y", label: "Y" },
  { axis: "z", label: "Z" },
] as const;

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function setDocumentCursor(cursor: string): void {
  if (typeof document !== "undefined" && document.body) {
    document.body.style.cursor = cursor;
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * Shared dark translucent glass backing panel (`#0b1120`, opacity `0.90`) with
 * glowing 1px cyan perimeter frame border and beveled hardware depth.
 */
function DiegeticWingFrame({ width, height }: { width: number; height: number }): React.ReactElement {
  const borderThickness = 0.0045;
  const borderDepth = 0.006;
  const cornerLen = 0.055;
  const halfW = width / 2;
  const halfH = height / 2;

  return (
    <group>
      {/* Translucent dark obsidian glass main panel */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#0b1120"
          transparent
          opacity={0.9}
          roughness={0.22}
          metalness={0.18}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Subtle recessed anodized rear housing for physical VR thickness */}
      <mesh position={[0, 0, -0.008]}>
        <boxGeometry args={[width + 0.012, height + 0.012, 0.012]} />
        <meshStandardMaterial color="#060a14" roughness={0.42} metalness={0.72} />
      </mesh>

      {/* Glowing 1px cyan perimeter frame border */}
      <mesh position={[0, halfH, 0.002]}>
        <boxGeometry args={[width + borderThickness * 2, borderThickness, borderDepth]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.15} toneMapped={false} />
      </mesh>
      <mesh position={[0, -halfH, 0.002]}>
        <boxGeometry args={[width + borderThickness * 2, borderThickness, borderDepth]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.15} toneMapped={false} />
      </mesh>
      <mesh position={[-halfW, 0, 0.002]}>
        <boxGeometry args={[borderThickness, height, borderDepth]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.05} toneMapped={false} />
      </mesh>
      <mesh position={[halfW, 0, 0.002]}>
        <boxGeometry args={[borderThickness, height, borderDepth]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.05} toneMapped={false} />
      </mesh>

      {/* Crisp illuminated corner accent brackets */}
      {(
        [
          [-1, 1],
          [1, 1],
          [-1, -1],
          [1, -1],
        ] as const
      ).map(([sx, sy]) => (
        <group key={`corner-${sx}-${sy}`} position={[sx * halfW, sy * halfH, 0.004]}>
          <mesh position={[-sx * (cornerLen / 2), 0, 0]}>
            <boxGeometry args={[cornerLen, 0.007, 0.005]} />
            <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          <mesh position={[0, -sy * (cornerLen / 2), 0]}>
            <boxGeometry args={[0.007, cornerLen, 0.005]} />
            <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function WingDivider({ y, width = 0.78 }: { y: number; width?: number | undefined }): React.ReactElement {
  return (
    <mesh position={[0, y, 0.003]}>
      <boxGeometry args={[width, 0.0022, 0.002]} />
      <meshBasicMaterial color="#1e3a5f" transparent opacity={0.75} />
    </mesh>
  );
}

interface WingHeaderPlateProps {
  title: string;
  subtitle: string;
  badge?: string | undefined;
  accentColor: string;
  position: [number, number, number];
  width: number;
  height: number;
}

/** High-DPI CanvasTexture header banner for the top of each floating wing. */
function WingHeaderPlate({
  title,
  subtitle,
  badge,
  accentColor,
  position,
  width,
  height,
}: WingHeaderPlateProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 112;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    canvasRef.current = canvas;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Subtle header glass wash
    drawRoundedRectPath(ctx, 2, 2, w - 4, h - 4, 14);
    ctx.fillStyle = "rgba(15, 28, 48, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Illuminated status dot
    ctx.beginPath();
    ctx.arc(28, 36, 7, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();

    // Primary uppercase title
    ctx.fillStyle = "#38bdf8";
    ctx.font = "700 26px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 48, 36);

    // Optional right-aligned model counter badge
    if (badge) {
      ctx.font = "600 22px Inter, system-ui, -apple-system, sans-serif";
      const metrics = ctx.measureText(badge);
      const pillW = metrics.width + 28;
      drawRoundedRectPath(ctx, w - pillW - 18, 17, pillW, 36, 10);
      ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
      ctx.fill();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.48)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#bae6fd";
      ctx.textAlign = "center";
      ctx.fillText(badge, w - pillW / 2 - 18, 36);
    }

    // Subtitle readout
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "500 24px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(truncateText(subtitle, 42), 24, 80);

    tex.needsUpdate = true;
  }, [title, subtitle, badge, accentColor, texture]);

  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      {texture ? (
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      ) : (
        <meshBasicMaterial transparent opacity={0} />
      )}
    </mesh>
  );
}

interface WingSectionLabelProps {
  text: string;
  position: [number, number, number];
  width?: number | undefined;
}

/** Crisp uppercase section sub-label rendered via persistent CanvasTexture. */
function WingSectionLabel({ text, position, width = 0.78 }: WingSectionLabelProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 44;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    canvasRef.current = canvas;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 22px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 4, canvas.height / 2);
    tex.needsUpdate = true;
  }, [text, texture]);

  return (
    <mesh position={position}>
      <planeGeometry args={[width, 0.036]} />
      {texture ? (
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      ) : (
        <meshBasicMaterial transparent opacity={0} />
      )}
    </mesh>
  );
}

interface DiegeticButton3DProps {
  label: string;
  position: [number, number, number];
  width: number;
  height: number;
  active?: boolean | undefined;
  accentColor?: string | undefined;
  fontSizePx?: number | undefined;
  onPress: () => void;
}

/**
 * Tactile 3D glass button for WebXR and desktop 3D interaction with hover lift,
 * glowing active border, and zero-leak persistent CanvasTexture.
 */
function DiegeticButton3D({
  label,
  position,
  width,
  height,
  active = false,
  accentColor = "#38bdf8",
  fontSizePx = 28,
  onPress,
}: DiegeticButton3DProps): React.ReactElement {
  const groupRef = useRef<THREE.Group | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const pxWidth = Math.max(160, Math.round(width * 900));
  const pxHeight = Math.max(72, Math.round(height * 900));

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    canvasRef.current = canvas;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, [pxWidth, pxHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (pressed) {
      grad.addColorStop(0, "#17253d");
      grad.addColorStop(1, "#0d1626");
    } else if (active) {
      grad.addColorStop(0, "rgba(18, 48, 76, 0.96)");
      grad.addColorStop(1, "rgba(10, 26, 46, 0.96)");
    } else if (hovered) {
      grad.addColorStop(0, "rgba(26, 42, 68, 0.95)");
      grad.addColorStop(1, "rgba(14, 24, 42, 0.95)");
    } else {
      grad.addColorStop(0, "rgba(17, 27, 46, 0.92)");
      grad.addColorStop(1, "rgba(11, 18, 32, 0.92)");
    }

    drawRoundedRectPath(ctx, 4, 4, w - 8, h - 8, 14);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle top highlight sheen
    drawRoundedRectPath(ctx, 10, 8, w - 20, Math.max(8, h * 0.16), 6);
    ctx.fillStyle = hovered || active ? "rgba(255, 255, 255, 0.13)" : "rgba(255, 255, 255, 0.05)";
    ctx.fill();

    // Illuminated border
    drawRoundedRectPath(ctx, 4, 4, w - 8, h - 8, 14);
    ctx.lineWidth = active || hovered ? 3.5 : 2;
    ctx.strokeStyle = active ? accentColor : hovered ? "#7dd3fc" : "rgba(148, 163, 184, 0.30)";
    ctx.stroke();

    // Active indicator accent bar at bottom edge
    if (active) {
      const barW = Math.min(w * 0.42, 72);
      drawRoundedRectPath(ctx, (w - barW) / 2, h - 11, barW, 4, 2);
      ctx.fillStyle = accentColor;
      ctx.fill();
    }

    // Crisp centered typography
    ctx.fillStyle = active || hovered ? "#f8fafc" : "#cbd5e1";
    ctx.font = `600 ${fontSizePx}px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, w / 2, active ? h / 2 - 2 : h / 2 + 1);

    tex.needsUpdate = true;
  }, [label, active, accentColor, fontSizePx, hovered, pressed, texture]);

  useEffect(() => {
    return () => {
      setDocumentCursor("auto");
    };
  }, []);

  useFrame((_, delta) => {
    const grp = groupRef.current;
    if (!grp) return;
    const targetZ = pressed ? 0.004 : hovered ? 0.016 : active ? 0.012 : 0.008;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 18);
    grp.position.z += (targetZ - grp.position.z) * alpha;
  });

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1], position[2]]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        setDocumentCursor("pointer");
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
        setPressed(false);
        setDocumentCursor("auto");
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setPressed(true);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (pressed) {
          setPressed(false);
          onPress();
        }
      }}
    >
      <mesh position={[0, 0, -0.004]}>
        <boxGeometry args={[width, height, 0.01]} />
        <meshStandardMaterial
          color={active ? "#122943" : "#0e1726"}
          emissive={active || hovered ? accentColor : "#020617"}
          emissiveIntensity={hovered ? 0.3 : active ? 0.2 : 0.04}
          roughness={0.28}
          metalness={0.45}
        />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[width - 0.004, height - 0.004]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#0f172a" />
        )}
      </mesh>
    </group>
  );
}

interface EnvironmentPortalOrbProps {
  env: RotundaEnvironmentMeta;
  active: boolean;
  position: [number, number, number];
  onSelect: () => void;
}

/**
 * Clickable miniature 3D Environment Portal Orb with spinning illuminated torus ring
 * around the active environment and crisp CanvasTexture label directly beneath.
 */
function EnvironmentPortalOrb({ env, active, position, onSelect }: EnvironmentPortalOrbProps): React.ReactElement {
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const ringPrimaryRef = useRef<THREE.Mesh | null>(null);
  const ringSecondaryRef = useRef<THREE.Mesh | null>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const [labelTex, setLabelTex] = useState<THREE.CanvasTexture | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 224;
    canvas.height = 56;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    labelCanvasRef.current = canvas;
    labelTexRef.current = tex;
    setLabelTex(tex);

    return () => {
      labelCanvasRef.current = null;
      labelTexRef.current = null;
      setLabelTex(null);
      tex.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = labelCanvasRef.current;
    const tex = labelTexRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (active || hovered) {
      drawRoundedRectPath(ctx, 8, 6, w - 16, h - 12, 10);
      ctx.fillStyle = active ? "rgba(18, 42, 68, 0.9)" : "rgba(22, 34, 56, 0.72)";
      ctx.fill();
      ctx.strokeStyle = active ? env.accentColor : "rgba(125, 211, 252, 0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.fillStyle = active ? "#f8fafc" : hovered ? "#e2e8f0" : "#94a3b8";
    ctx.font = `${active ? "700" : "500"} 26px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(env.shortLabel, w / 2, h / 2 + 1);

    tex.needsUpdate = true;
  }, [env.shortLabel, env.accentColor, active, hovered, labelTex]);

  useEffect(() => {
    return () => {
      setDocumentCursor("auto");
    };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    const sphere = sphereRef.current;
    if (sphere) {
      const targetScale = active ? 1.12 : hovered ? 1.16 : 1.0;
      const alpha = 1 - Math.exp(-dt * 12);
      const s = sphere.scale.x + (targetScale - sphere.scale.x) * alpha;
      sphere.scale.setScalar(s);
      sphere.rotation.y += dt * (active ? 0.8 : 0.25);
    }

    const r1 = ringPrimaryRef.current;
    if (r1) {
      r1.rotation.z += dt * 1.65;
      r1.rotation.x = Math.PI * 0.34 + Math.sin(t * 1.4) * 0.18;
    }

    const r2 = ringSecondaryRef.current;
    if (r2) {
      r2.rotation.z -= dt * 1.05;
      r2.rotation.y = Math.cos(t * 1.1) * 0.3;
    }
  });

  const isPassthrough = env.id === "passthrough";

  return (
    <group
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        setDocumentCursor("pointer");
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
        setDocumentCursor("auto");
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Subtle dark circular pedestal socket on glass behind orb */}
      <mesh position={[0, 0, 0.005]}>
        <ringGeometry args={[0.044, 0.052, 28]} />
        <meshBasicMaterial
          color={active || hovered ? env.accentColor : "#334155"}
          transparent
          opacity={active ? 0.85 : hovered ? 0.65 : 0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Miniature glowing 3D Environment Portal Sphere */}
      <mesh ref={sphereRef} position={[0, 0, 0.048]}>
        <sphereGeometry args={[0.039, 24, 24]} />
        <meshStandardMaterial
          color={env.orbColor}
          emissive={env.accentColor}
          emissiveIntensity={active ? 0.62 : hovered ? 0.42 : 0.2}
          roughness={isPassthrough ? 0.1 : env.id === "office" ? 0.24 : 0.3}
          metalness={env.id === "dark-lab" ? 0.65 : env.id === "warehouse" ? 0.5 : 0.2}
          transparent={isPassthrough}
          opacity={isPassthrough ? 0.78 : 1}
        />
      </mesh>

      {/* Spinning illuminated torus ring around the currently active environment */}
      {active && (
        <group position={[0, 0, 0.048]}>
          <mesh ref={ringPrimaryRef}>
            <torusGeometry args={[0.054, 0.0042, 14, 36]} />
            <meshStandardMaterial
              color={env.accentColor}
              emissive={env.accentColor}
              emissiveIntensity={1.65}
              toneMapped={false}
            />
          </mesh>
          <mesh ref={ringSecondaryRef} rotation={[Math.PI * 0.5, 0, 0]}>
            <torusGeometry args={[0.061, 0.0022, 10, 36]} />
            <meshBasicMaterial color="#e0f2fe" transparent opacity={0.65} toneMapped={false} />
          </mesh>
        </group>
      )}

      {/* Subtle hover ring for inactive environments */}
      {!active && hovered && (
        <mesh position={[0, 0, 0.048]}>
          <torusGeometry args={[0.052, 0.0026, 10, 32]} />
          <meshBasicMaterial color={env.accentColor} transparent opacity={0.75} toneMapped={false} />
        </mesh>
      )}

      {/* Crisp CanvasTexture label beneath the portal orb */}
      <mesh position={[0, -0.078, 0.006]}>
        <planeGeometry args={[0.146, 0.037]} />
        {labelTex ? (
          <meshBasicMaterial map={labelTex} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial transparent opacity={0} />
        )}
      </mesh>
    </group>
  );
}

interface DiegeticSlider3DProps {
  label: string;
  readout: string;
  value: number;
  min: number;
  max: number;
  trackWidth: number;
  position: [number, number, number];
  accentColor: string;
  bipolar?: boolean | undefined;
  dimmed?: boolean | undefined;
  onChange: (nextValue: number) => void;
  onDetentTick?: (() => void) | undefined;
}

/**
 * Interactive 3D diegetic slider bar supporting click & drag anywhere along the track
 * in both Desktop 3D mode and WebXR VR controllers.
 */
function DiegeticSlider3D({
  label,
  readout,
  value,
  min,
  max,
  trackWidth,
  position,
  accentColor,
  bipolar = false,
  dimmed = false,
  onChange,
  onDetentTick,
}: DiegeticSlider3DProps): React.ReactElement {
  const sliderGroupRef = useRef<THREE.Group | null>(null);
  const thumbRef = useRef<THREE.Mesh | null>(null);
  const scratchLocalVecRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const draggingRef = useRef(false);
  const lastDetentRef = useRef<number>(-1);

  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const [labelTex, setLabelTex] = useState<THREE.CanvasTexture | null>(null);
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const range = Math.max(1e-6, max - min);
  const norm = clampNumber((value - min) / range, 0, 1);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 48;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    labelCanvasRef.current = canvas;
    labelTexRef.current = tex;
    setLabelTex(tex);

    return () => {
      labelCanvasRef.current = null;
      labelTexRef.current = null;
      setLabelTex(null);
      tex.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = labelCanvasRef.current;
    const tex = labelTexRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = dimmed ? "#64748b" : "#94a3b8";
    ctx.font = "700 22px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 2, h / 2);

    ctx.fillStyle = dimmed ? "#94a3b8" : hovered || isDragging ? "#f8fafc" : "#e2e8f0";
    ctx.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(readout, w - 2, h / 2);

    tex.needsUpdate = true;
  }, [label, readout, dimmed, hovered, isDragging, labelTex]);

  useEffect(() => {
    if (!isDragging || typeof window === "undefined") return;
    const handleWindowPointerUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
    };
  }, [isDragging]);

  useEffect(() => {
    return () => {
      setDocumentCursor("auto");
    };
  }, []);

  useFrame((_, delta) => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const targetScale = isDragging ? 1.28 : hovered ? 1.16 : 1.0;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 16);
    const s = thumb.scale.x + (targetScale - thumb.scale.x) * alpha;
    thumb.scale.set(s, s, 1);
  });

  const applyHitPoint = useCallback(
    (worldPoint: THREE.Vector3) => {
      const grp = sliderGroupRef.current;
      if (!grp) return;
      const localPt = grp.worldToLocal(scratchLocalVecRef.current.copy(worldPoint));
      const nextNorm = clampNumber((localPt.x + trackWidth / 2) / trackWidth, 0, 1);
      const nextVal = min + nextNorm * range;
      const detent = Math.round(nextNorm * 10);
      if (detent !== lastDetentRef.current) {
        lastDetentRef.current = detent;
        onDetentTick?.();
      }
      onChange(nextVal);
    },
    [trackWidth, min, range, onChange, onDetentTick],
  );

  const thumbX = -trackWidth / 2 + norm * trackWidth;
  const activeColor = dimmed ? "#475569" : accentColor;

  // Compute fill segment geometry (either left-to-thumb or center-to-thumb for bipolar -1..+1)
  const zeroNorm = bipolar ? clampNumber((0 - min) / range, 0, 1) : 0;
  const fillStartNorm = Math.min(zeroNorm, norm);
  const fillEndNorm = Math.max(zeroNorm, norm);
  const fillWidth = Math.max(0.004, (fillEndNorm - fillStartNorm) * trackWidth);
  const fillCenterX = -trackWidth / 2 + ((fillStartNorm + fillEndNorm) / 2) * trackWidth;

  return (
    <group ref={sliderGroupRef} position={position}>
      {/* Crisp label + live value readout strip */}
      <mesh position={[0, 0.028, 0.004]}>
        <planeGeometry args={[trackWidth, 0.036]} />
        {labelTex ? (
          <meshBasicMaterial map={labelTex} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial transparent opacity={0} />
        )}
      </mesh>

      {/* Recessed track channel */}
      <mesh position={[0, -0.01, 0.004]}>
        <boxGeometry args={[trackWidth, 0.015, 0.006]} />
        <meshStandardMaterial color="#0f1b2e" roughness={0.5} metalness={0.35} />
      </mesh>

      {/* Optional center tick mark for bipolar sliders */}
      {bipolar && (
        <mesh position={[-trackWidth / 2 + zeroNorm * trackWidth, -0.01, 0.008]}>
          <boxGeometry args={[0.003, 0.024, 0.003]} />
          <meshBasicMaterial color="#64748b" />
        </mesh>
      )}

      {/* Glowing active fill bar */}
      <mesh position={[fillCenterX, -0.01, 0.008]}>
        <boxGeometry args={[fillWidth, 0.011, 0.005]} />
        <meshStandardMaterial
          color={activeColor}
          emissive={activeColor}
          emissiveIntensity={dimmed ? 0.2 : isDragging || hovered ? 1.35 : 0.9}
          toneMapped={false}
        />
      </mesh>

      {/* Tactile 3D pill thumb */}
      <mesh ref={thumbRef} position={[thumbX, -0.01, 0.014]}>
        <boxGeometry args={[0.022, 0.036, 0.014]} />
        <meshStandardMaterial
          color={isDragging || hovered ? "#f8fafc" : "#e2e8f0"}
          emissive={activeColor}
          emissiveIntensity={dimmed ? 0.15 : isDragging ? 1.2 : hovered ? 0.8 : 0.45}
          roughness={0.2}
          metalness={0.35}
        />
      </mesh>

      {/* Invisible generous interactive hit target covering the full slider bar */}
      <mesh
        position={[0, -0.01, 0.018]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          setDocumentCursor("ew-resize");
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          if (!draggingRef.current) {
            setDocumentCursor("auto");
          }
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          draggingRef.current = true;
          setIsDragging(true);
          applyHitPoint(e.point);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          applyHitPoint(e.point);
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          draggingRef.current = false;
          setIsDragging(false);
        }}
      >
        <planeGeometry args={[trackWidth + 0.03, 0.064]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Left & Right Curved Diegetic 3D Floating Tool Wings — 100% native Three.js meshes
 * and high-DPI `CanvasTexture` controls (zero HTML DOM overlays) working identically
 * inside WebXR VR/AR headsets and Desktop 3D mode.
 */
export function FloatingToolWings({
  state,
  activeModelTitle,
  modelCount,
  visible,
  dispatch,
  onPlayCue,
}: FloatingToolWingsProps): React.ReactElement | null {
  if (!visible) {
    return null;
  }

  const activeEnvMeta = ROTUNDA_ENVIRONMENTS.find((env) => env.id === state.environment) ?? ROTUNDA_ENVIRONMENTS[0];
  const simDuration = Math.max(0.1, state.simulationDuration);
  const modelBadge = modelCount > 0 ? `${Math.min(modelCount, state.activeModelIndex + 1)} / ${modelCount}` : undefined;

  return (
    <group name="rotunda-floating-tool-wings">
      {/* ── LEFT WING: Environments & Physics ─────────────────────────────── */}
      <group name="rotunda-left-wing" position={LEFT_WING_POS} rotation={[0, WING_YAW_RAD, 0]}>
        <DiegeticWingFrame width={WING_WIDTH} height={WING_HEIGHT} />

        <WingHeaderPlate
          title="ENVIRONMENTS & PHYSICS"
          subtitle={activeEnvMeta ? `${activeEnvMeta.label} · ${activeEnvMeta.shortLabel}` : "Engineering Rotunda"}
          accentColor={activeEnvMeta?.accentColor ?? "#38bdf8"}
          position={[0, 0.325, 0.005]}
          width={0.8}
          height={0.095}
        />

        {/* 5 Clickable 3D Environment Portal Orbs */}
        {ROTUNDA_ENVIRONMENTS.map((env, index) => {
          const x = (index - 2) * 0.156;
          return (
            <EnvironmentPortalOrb
              key={env.id}
              env={env}
              active={state.environment === env.id}
              position={[x, 0.172, 0]}
              onSelect={() => {
                dispatch({ type: "setEnvironment", environment: env.id });
                onPlayCue?.("env");
              }}
            />
          );
        })}

        <WingDivider y={0.042} />
        <WingSectionLabel text="CAE FIELD OVERLAY" position={[0, 0.012, 0.005]} />

        {/* 4 CAE Field Overlay Buttons (2x2 Grid for crisp VR legibility) */}
        {CAE_OVERLAY_OPTIONS.map((opt, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const x = col === 0 ? -0.198 : 0.198;
          const y = row === 0 ? -0.056 : -0.138;
          return (
            <DiegeticButton3D
              key={opt.id}
              label={opt.label}
              position={[x, y, 0.008]}
              width={0.382}
              height={0.068}
              active={state.caeOverlay === opt.id}
              accentColor={opt.color}
              fontSizePx={27}
              onPress={() => {
                dispatch({ type: "setCaeOverlay", overlay: opt.id });
                onPlayCue?.("click");
              }}
            />
          );
        })}

        <WingDivider y={-0.194} />
        <WingSectionLabel text="RENDER STYLE" position={[0, -0.224, 0.005]} />

        {/* 3 Render Style Buttons (Shaded, Wireframe, X-Ray) */}
        {RENDER_STYLE_OPTIONS.map((opt, idx) => {
          const x = (idx - 1) * 0.264;
          return (
            <DiegeticButton3D
              key={opt.id}
              label={opt.label}
              position={[x, -0.296, 0.008]}
              width={0.248}
              height={0.074}
              active={state.renderStyle === opt.id}
              accentColor={opt.color}
              fontSizePx={27}
              onPress={() => {
                dispatch({ type: "setRenderStyle", style: opt.id });
                onPlayCue?.("click");
              }}
            />
          );
        })}
      </group>

      {/* ── RIGHT WING: Inspection & Stage ────────────────────────────────── */}
      <group name="rotunda-right-wing" position={RIGHT_WING_POS} rotation={[0, -WING_YAW_RAD, 0]}>
        <DiegeticWingFrame width={WING_WIDTH} height={WING_HEIGHT} />

        <WingHeaderPlate
          title="INSPECTION & STAGE"
          subtitle={activeModelTitle || "Active Engineering Assembly"}
          badge={modelBadge}
          accentColor="#38bdf8"
          position={[0, 0.325, 0.005]}
          width={0.8}
          height={0.095}
        />

        {/* Interactive 3D Explode Slider (0% → 100%) */}
        <DiegeticSlider3D
          label="EXPLODE ASSEMBLY"
          readout={`${Math.round(state.explodeFactor * 100)}%`}
          value={state.explodeFactor}
          min={0}
          max={1}
          trackWidth={0.78}
          position={[0, 0.212, 0.004]}
          accentColor="#38bdf8"
          onChange={(factor) => dispatch({ type: "setExplode", factor })}
          onDetentTick={() => onPlayCue?.("tick")}
        />

        <WingDivider y={0.152} />

        {/* Section Cut Toggle + Axis Selector (X, Y, Z) */}
        <DiegeticButton3D
          label={state.sectionCutEnabled ? "Section Cut ON" : "Section Cut OFF"}
          position={[-0.202, 0.098, 0.008]}
          width={0.376}
          height={0.064}
          active={state.sectionCutEnabled}
          accentColor="#f59e0b"
          fontSizePx={25}
          onPress={() => {
            dispatch({ type: "toggleSectionCut" });
            onPlayCue?.("click");
          }}
        />
        {CLIP_AXES.map((item, idx) => (
          <DiegeticButton3D
            key={item.axis}
            label={item.label}
            position={[0.068 + idx * 0.128, 0.098, 0.008]}
            width={0.114}
            height={0.064}
            active={state.sectionCutAxis === item.axis}
            accentColor={state.sectionCutEnabled ? "#f59e0b" : "#38bdf8"}
            fontSizePx={28}
            onPress={() => {
              dispatch({ type: "setSectionCutAxis", axis: item.axis });
              onPlayCue?.("tick");
            }}
          />
        ))}

        {/* Interactive Section Cut Offset Slider (-1..+1) */}
        <DiegeticSlider3D
          label="SECTION CUT OFFSET"
          readout={`${state.sectionCutOffset >= 0 ? "+" : ""}${state.sectionCutOffset.toFixed(2)}`}
          value={state.sectionCutOffset}
          min={-1}
          max={1}
          trackWidth={0.78}
          position={[0, 0.002, 0.004]}
          accentColor="#f59e0b"
          bipolar
          dimmed={!state.sectionCutEnabled}
          onChange={(offset) => dispatch({ type: "setSectionCutOffset", offset })}
          onDetentTick={() => onPlayCue?.("tick")}
        />

        <WingDivider y={-0.06} />

        {/* Scale Mode Toggle (Tabletop ↔ 1:1 Real Scale) */}
        <DiegeticButton3D
          label={
            state.scaleMode === "real-scale"
              ? "Scale: 1:1 Real Scale  ⇄  Tabletop"
              : "Scale: Tabletop  ⇄  1:1 Real Scale"
          }
          position={[0, -0.112, 0.008]}
          width={0.78}
          height={0.066}
          active={state.scaleMode === "real-scale"}
          accentColor={state.scaleMode === "real-scale" ? "#10b981" : "#38bdf8"}
          fontSizePx={25}
          onPress={() => {
            dispatch({ type: "toggleScaleMode" });
            onPlayCue?.("snap");
          }}
        />

        {/* Plinth Controls Row: ⟲ -45°, Reset, +45° ⟳, Zoom −, Zoom + */}
        <DiegeticButton3D
          label="⟲ -45°"
          position={[-0.318, -0.198, 0.008]}
          width={0.144}
          height={0.064}
          accentColor="#38bdf8"
          fontSizePx={24}
          onPress={() => {
            dispatch({ type: "rotatePlinth", deltaYaw: -Math.PI / 4 });
            onPlayCue?.("tick");
          }}
        />
        <DiegeticButton3D
          label="Reset"
          position={[-0.159, -0.198, 0.008]}
          width={0.144}
          height={0.064}
          accentColor="#a855f7"
          fontSizePx={24}
          onPress={() => {
            dispatch({ type: "resetPlinthView" });
            onPlayCue?.("snap");
          }}
        />
        <DiegeticButton3D
          label="+45° ⟳"
          position={[0, -0.198, 0.008]}
          width={0.144}
          height={0.064}
          accentColor="#38bdf8"
          fontSizePx={24}
          onPress={() => {
            dispatch({ type: "rotatePlinth", deltaYaw: Math.PI / 4 });
            onPlayCue?.("tick");
          }}
        />
        <DiegeticButton3D
          label="Zoom −"
          position={[0.159, -0.198, 0.008]}
          width={0.144}
          height={0.064}
          accentColor="#38bdf8"
          fontSizePx={23}
          onPress={() => {
            dispatch({ type: "adjustZoom", delta: -0.2 });
            onPlayCue?.("tick");
          }}
        />
        <DiegeticButton3D
          label="Zoom +"
          position={[0.318, -0.198, 0.008]}
          width={0.144}
          height={0.064}
          accentColor="#38bdf8"
          fontSizePx={23}
          onPress={() => {
            dispatch({ type: "adjustZoom", delta: 0.2 });
            onPlayCue?.("tick");
          }}
        />

        <WingDivider y={-0.25} />

        {/* Simulation Time Scrubber Row: Play/Pause + Interactive 3D Timeline Bar */}
        <DiegeticButton3D
          label={state.isPlaying ? "⏸ Pause" : "▶ Play"}
          position={[-0.292, -0.314, 0.008]}
          width={0.196}
          height={0.07}
          active={state.isPlaying}
          accentColor={state.isPlaying ? "#10b981" : "#f59e0b"}
          fontSizePx={25}
          onPress={() => {
            dispatch({ type: "togglePlaying" });
            onPlayCue?.("click");
          }}
        />
        <DiegeticSlider3D
          label="SIMULATION TIME"
          readout={`t = ${state.simulationTime.toFixed(1)}s`}
          value={state.simulationTime}
          min={0}
          max={simDuration}
          trackWidth={0.556}
          position={[0.112, -0.31, 0.004]}
          accentColor="#10b981"
          onChange={(time) => dispatch({ type: "setSimulationTime", time })}
          onDetentTick={() => onPlayCue?.("tick")}
        />
      </group>
    </group>
  );
}
