// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  buildVrKeyboardLayout,
  computeRotundaAtlasUvRect,
  computeSiblingRotundaSlots,
  formatNodeSpecPeek,
  GLASS_PANEL_H,
  GLASS_PANEL_W,
  hitTestVrKeyboard,
  ROTUNDA_ATLAS_H,
  ROTUNDA_ATLAS_MAX_SLOTS,
  ROTUNDA_ATLAS_W,
  ROTUNDA_PACKAGE_CARD_H,
  ROTUNDA_PACKAGE_CARD_W,
  VR_KEYBOARD_CANVAS_H,
  VR_KEYBOARD_CANVAS_W,
  type GlassLibraryNode,
  type GlassStackPanelPose,
  type RotundaLibraryParameterInfo,
  type SiblingRotundaSlot,
} from "./glass-library-logic.js";
import { RealisticComponentMesh3D } from "./realistic-components-3d.js";
import { buildExtrudedIconBundle, getSharedExtrudedIconCache, hashStringFnv1a } from "./svg-extruder.js";
import { pulseEventHaptic } from "./xr-handle.js";

const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};
const UI_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

export function drawGlassRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export function drawGlassContainerEmblem(
  ctx: CanvasRenderingContext2D,
  kind: GlassLibraryNode["kind"],
  cx: number,
  cy: number,
  size: number,
  accent: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size * 0.5;

  if (kind === "library") {
    ctx.fillStyle = `${accent}33`;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2.5, size * 0.055);
    ctx.lineJoin = "round";
    drawGlassRoundedRect(ctx, -s * 0.85, -s * 0.72, s * 1.35, s * 1.44, s * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
    drawGlassRoundedRect(ctx, -s * 0.48, -s * 0.52, s * 1.34, s * 1.32, s * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = Math.max(2, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.16);
    ctx.lineTo(s * 0.56, -s * 0.16);
    ctx.moveTo(-s * 0.2, s * 0.16);
    ctx.lineTo(s * 0.36, s * 0.16);
    ctx.stroke();
  } else if (kind === "folder") {
    ctx.fillStyle = `${accent}30`;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2.5, size * 0.055);
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-s * 0.88, -s * 0.58);
    ctx.lineTo(-s * 0.22, -s * 0.58);
    ctx.lineTo(-s * 0.04, -s * 0.36);
    ctx.lineTo(s * 0.88, -s * 0.36);
    ctx.lineTo(s * 0.88, s * 0.68);
    ctx.lineTo(-s * 0.88, s * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2.5, size * 0.055);
    ctx.lineJoin = "round";
    ctx.fillStyle = `${accent}2b`;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.82);
    ctx.lineTo(s * 0.78, -s * 0.38);
    ctx.lineTo(s * 0.78, s * 0.44);
    ctx.lineTo(0, s * 0.86);
    ctx.lineTo(-s * 0.78, s * 0.44);
    ctx.lineTo(-s * 0.78, -s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.78, -s * 0.38);
    ctx.lineTo(0, s * 0.04);
    ctx.lineTo(s * 0.78, -s * 0.38);
    ctx.moveTo(0, s * 0.04);
    ctx.lineTo(0, s * 0.86);
    ctx.stroke();
  }

  ctx.restore();
}

const sharedSubSvgCache = new Map<string, HTMLImageElement | "loading" | "error">();

export function requestSharedGlassSvg(svgString: string, onReady: () => void): HTMLImageElement | null {
  if (typeof window === "undefined" || typeof Image === "undefined") return null;
  const normalized = svgString.replace(/currentColor/gi, "#e2e8f0");
  const key = hashStringFnv1a(normalized);
  const cached = sharedSubSvgCache.get(key);
  if (cached instanceof HTMLImageElement) return cached;
  if (cached === "loading" || cached === "error") return null;

  sharedSubSvgCache.set(key, "loading");
  try {
    const img = new Image();
    img.onload = () => {
      sharedSubSvgCache.set(key, img);
      onReady();
    };
    img.onerror = () => {
      sharedSubSvgCache.set(key, "error");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
  } catch {
    sharedSubSvgCache.set(key, "error");
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  #2 Real 3D Extruded SVG Miniature Wafer (via shared svg-extruder cache)   */
/* -------------------------------------------------------------------------- */

export function ExtrudedSvgMiniWafer3D({
  svg,
  accentColor,
  scale = 0.62,
}: {
  svg: string;
  accentColor: string;
  scale?: number | undefined;
}): React.ReactElement | null {
  const bundle = useMemo(() => {
    try {
      const key = `glass-holo:${hashStringFnv1a(svg)}`;
      return getSharedExtrudedIconCache().acquire(key, () =>
        buildExtrudedIconBundle(
          { kind: "svg", svg, width: 80, height: 56 },
          {
            dark: true,
            currentColor: "#e2e8f0",
            waferStyle: "tactile-tile",
            targetSpanMeters: 0.135,
            curveSegments: 8,
          },
        ),
      );
    } catch {
      return null;
    }
  }, [svg]);

  if (!bundle) return null;

  return (
    <group scale={scale}>
      {bundle.waferGeometry && (
        <mesh geometry={bundle.waferGeometry} raycast={NOOP_RAYCAST}>
          <meshStandardMaterial color="#0f172a" roughness={0.25} metalness={0.3} transparent opacity={0.86} />
        </mesh>
      )}
      {bundle.rimGeometry && (
        <mesh geometry={bundle.rimGeometry} raycast={NOOP_RAYCAST}>
          <meshBasicMaterial color={accentColor} toneMapped={false} />
        </mesh>
      )}
      {bundle.opaqueGeometry && (
        <mesh geometry={bundle.opaqueGeometry} raycast={NOOP_RAYCAST}>
          <meshStandardMaterial vertexColors roughness={0.28} metalness={0.22} />
        </mesh>
      )}
      {bundle.translucentGeometry && (
        <mesh geometry={bundle.translucentGeometry} raycast={NOOP_RAYCAST}>
          <meshStandardMaterial vertexColors transparent opacity={0.55} roughness={0.2} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pushed-Out Ghost Panel (Ancestor Above / Remembered Child Below)          */
/* -------------------------------------------------------------------------- */

export function GlassSkeletonGhostPanel({
  pose,
  title,
  accentColor,
  skeletonTexture,
  geometry,
  onHoverDepth,
  onSelectDepth,
}: {
  pose: GlassStackPanelPose;
  title: string;
  accentColor: string;
  skeletonTexture: THREE.CanvasTexture | null;
  geometry: THREE.PlaneGeometry;
  onHoverDepth: (levelIndex: number | null) => void;
  onSelectDepth: (levelIndex: number) => void;
}): React.ReactElement {
  const groupRef = useRef<THREE.Group | null>(null);
  const [hovered, setHovered] = useState(false);

  const labelTex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 72;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const isDescendant = pose.role === "descendant";
    const rim = isDescendant ? "#10b981" : accentColor;
    drawGlassRoundedRect(ctx, 4, 4, 504, 64, 18);
    ctx.fillStyle = isDescendant ? "rgba(6, 40, 32, 0.92)" : "rgba(12, 22, 42, 0.92)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = hovered ? "#38bdf8" : rim;
    ctx.stroke();

    ctx.fillStyle = isDescendant ? "#6ee7b7" : "#7dd3fc";
    ctx.font = `800 18px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(isDescendant ? "▼ REMEMBERED:" : "▲ PARENT:", 22, 37);

    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 22px ${UI_FONT}`;
    const shortTitle = title.length > 20 ? `${title.slice(0, 19)}…` : title;
    ctx.fillText(shortTitle, isDescendant ? 182 : 138, 37);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [pose.role, title, accentColor, hovered]);

  useEffect(() => () => labelTex?.dispose(), [labelTex]);

  useFrame((_, rawDelta) => {
    const grp = groupRef.current;
    if (!grp) return;
    const dt = Math.min(rawDelta, 0.05);
    const alpha = 1 - Math.exp(-dt * 12);
    grp.position.x += (pose.position[0] - grp.position.x) * alpha;
    grp.position.y += (pose.position[1] - grp.position.y) * alpha;
    grp.position.z += (pose.position[2] - grp.position.z) * alpha;
    grp.rotation.x += (pose.pitchRad - grp.rotation.x) * alpha;
    const targetScale = pose.scale * (hovered ? 1.03 : 1);
    grp.scale.setScalar(grp.scale.x + (targetScale - grp.scale.x) * alpha);
  });

  const rimColor = pose.role === "descendant" ? "#10b981" : accentColor;

  return (
    <group
      ref={groupRef}
      position={[pose.position[0], pose.position[1], pose.position[2]]}
      rotation={[pose.pitchRad, 0, 0]}
      scale={pose.scale}
    >
      <mesh
        geometry={geometry}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          onHoverDepth(pose.levelIndex);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          onHoverDepth(null);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          pulseEventHaptic(e, 0.22, 12);
          onSelectDepth(pose.levelIndex);
        }}
      >
        {skeletonTexture ? (
          <meshBasicMaterial
            map={skeletonTexture}
            transparent
            opacity={hovered ? Math.min(0.95, pose.opacity + 0.16) : pose.opacity}
            depthWrite={false}
            toneMapped={false}
          />
        ) : (
          <meshBasicMaterial color="#1e293b" transparent opacity={pose.opacity * 0.7} depthWrite={false} />
        )}
      </mesh>

      <mesh position={[0, 0, -0.006]} raycast={NOOP_RAYCAST}>
        <planeGeometry args={[GLASS_PANEL_W + 0.016, GLASS_PANEL_H + 0.016]} />
        <meshBasicMaterial
          color={hovered ? "#38bdf8" : rimColor}
          transparent
          opacity={hovered ? 0.32 : 0.12}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {labelTex && (
        <mesh
          position={[0, pose.role === "descendant" ? -GLASS_PANEL_H * 0.44 : GLASS_PANEL_H * 0.44, 0.022]}
          raycast={NOOP_RAYCAST}
        >
          <planeGeometry args={[0.56, 0.078]} />
          <meshBasicMaterial map={labelTex} transparent opacity={Math.min(1, pose.opacity + 0.22)} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  #2 + #8 Hover-to-Pop 3D Hologram (Hardware OR Extruded SVG) + Spec Peek   */
/* -------------------------------------------------------------------------- */

const sharedLiveParamsCache = new Map<string, readonly RotundaLibraryParameterInfo[]>();

export function HoverTileHologram3D({
  node,
  localPos,
  loadParameters,
}: {
  node: GlassLibraryNode;
  localPos: readonly [number, number, number];
  loadParameters?: ((className: string) => Promise<readonly RotundaLibraryParameterInfo[]>) | undefined;
}): React.ReactElement {
  const spinRef = useRef<THREE.Group | null>(null);
  const [liveParams, setLiveParams] = useState<readonly RotundaLibraryParameterInfo[] | undefined>(() =>
    sharedLiveParamsCache.get(node.fqn),
  );

  useEffect(() => {
    const cached = sharedLiveParamsCache.get(node.fqn);
    if (cached) {
      setLiveParams(cached);
      return;
    }
    setLiveParams(undefined);
    if (!loadParameters || !node.fqn) return;
    let cancelled = false;
    void loadParameters(node.fqn)
      .then((params) => {
        sharedLiveParamsCache.set(node.fqn, params);
        if (!cancelled && params.length > 0) setLiveParams(params);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [node.fqn, loadParameters]);

  const spec = useMemo(() => formatNodeSpecPeek(node, liveParams), [node, liveParams]);

  const specTex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 420;
    c.height = 104;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    drawGlassRoundedRect(ctx, 4, 4, 412, 96, 18);
    ctx.fillStyle = "rgba(8, 16, 34, 0.94)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#38bdf8";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#38bdf8";
    ctx.font = `800 18px monospace`;
    ctx.fillText(spec.portsLabel.slice(0, 32), 210, 34);

    ctx.fillStyle = "#cbd5e1";
    ctx.font = `600 16px ${UI_FONT}`;
    ctx.fillText(spec.paramsLabel.slice(0, 34), 210, 70);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [spec]);

  useEffect(() => () => specTex?.dispose(), [specTex]);

  useFrame((state, rawDelta) => {
    const grp = spinRef.current;
    if (!grp) return;
    const dt = Math.min(rawDelta, 0.05);
    grp.rotation.y += dt * 1.1;
    const bob = Math.sin(state.clock.elapsedTime * 3.2) * 0.004;
    grp.position.set(localPos[0], localPos[1] + bob, localPos[2] + 0.062);
    grp.scale.setScalar(grp.scale.x + (1 - grp.scale.x) * (1 - Math.exp(-dt * 16)));
  });

  return (
    <group>
      {/* Spinning 3D Hologram (Hardware Mesh OR Real Extruded SVG Wafer!) */}
      <group ref={spinRef} position={[localPos[0], localPos[1], localPos[2] + 0.062]} scale={0.2}>
        <mesh position={[0, -0.048, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
          <ringGeometry args={[0.034, 0.044, 24]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.65} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>

        {node.realisticKind ? (
          <RealisticComponentMesh3D
            kind={node.realisticKind}
            scale={0.95}
            emissiveColor="#0284c7"
            emissiveIntensity={0.35}
            disableRaycast
          />
        ) : node.iconSvg ? (
          <ExtrudedSvgMiniWafer3D svg={node.iconSvg} accentColor={node.accentColor || "#38bdf8"} scale={0.76} />
        ) : (
          <mesh raycast={NOOP_RAYCAST}>
            <boxGeometry args={[0.068, 0.048, 0.014]} />
            <meshStandardMaterial
              color={node.accentColor || "#38bdf8"}
              emissive={node.accentColor || "#38bdf8"}
              emissiveIntensity={0.45}
              roughness={0.22}
              metalness={0.35}
              transparent
              opacity={0.88}
            />
          </mesh>
        )}
      </group>

      {/* #8 Non-spinning crisp Port & Parameter Spec Peek Chip floating directly above the hologram */}
      {specTex && (
        <mesh position={[localPos[0], localPos[1] + 0.088, localPos[2] + 0.072]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[0.25, 0.062]} />
          <meshBasicMaterial map={specTex} transparent toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  #1 O(1) VRAM Pooled Shared Atlas for Flanking Sibling Rotunda             */
/* -------------------------------------------------------------------------- */

function createAtlasPoolGeometry(poolIdx: number): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(ROTUNDA_PACKAGE_CARD_W, ROTUNDA_PACKAGE_CARD_H, 1, 1);
  const rect = computeRotundaAtlasUvRect(poolIdx);
  const uv = geom.attributes["uv"];
  if (uv) {
    uv.setXY(0, rect.u0, rect.vTop);
    uv.setXY(1, rect.u1, rect.vTop);
    uv.setXY(2, rect.u0, rect.vBot);
    uv.setXY(3, rect.u1, rect.vBot);
    uv.needsUpdate = true;
  }
  return geom;
}

function paintRotundaAtlasSlot(
  ctx: CanvasRenderingContext2D,
  poolIdx: number,
  slot: SiblingRotundaSlot,
  hovered: boolean,
  onSvgReady: () => void,
): void {
  const rect = computeRotundaAtlasUvRect(poolIdx);
  const { px: ox, py: oy, size } = rect;
  ctx.clearRect(ox, oy, size, size);

  ctx.save();
  ctx.translate(ox, oy);

  const node = slot.node;
  const accent = node.accentColor || "#38bdf8";
  const hasRealistic3D = !slot.isContainer && Boolean(node.realisticKind);
  const hasExtruded3D = !slot.isContainer && !hasRealistic3D && Boolean(node.iconSvg);

  if (slot.isContainer) {
    // Package / Folder / Library: smaller polished translucent glass panel with icon LARGE & CENTERED
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, hovered ? "rgba(22, 48, 84, 0.90)" : "rgba(15, 23, 42, 0.84)");
    grad.addColorStop(1, "rgba(8, 14, 28, 0.88)");
    drawGlassRoundedRect(ctx, 8, 8, size - 16, size - 16, 28);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = hovered ? 4.5 : 2.5;
    ctx.strokeStyle = hovered ? "#38bdf8" : `${accent}aa`;
    ctx.stroke();

    const img = node.iconSvg ? requestSharedGlassSvg(node.iconSvg, onSvgReady) : null;
    if (img) {
      const iconMax = 168;
      const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      const dw = aspect >= 1 ? iconMax : iconMax * aspect;
      const dh = aspect >= 1 ? iconMax / aspect : iconMax;
      ctx.drawImage(img, (size - dw) * 0.5, 42 + (170 - dh) * 0.5, dw, dh);
    } else {
      drawGlassContainerEmblem(ctx, node.kind, size * 0.5, size * 0.43, 152, accent);
    }

    ctx.fillStyle = "#f8fafc";
    ctx.font = `800 24px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lbl = node.name.length > 15 ? `${node.name.slice(0, 14)}…` : node.name;
    ctx.fillText(lbl, size * 0.5, size - 52);

    ctx.fillStyle = hovered ? "#38bdf8" : "#94a3b8";
    ctx.font = `700 14px monospace`;
    ctx.fillText(hovered ? "OPEN SIBLING" : (node.subtitle ?? "PACKAGE").slice(0, 18), size * 0.5, size - 26);
  } else if (hasRealistic3D || hasExtruded3D) {
    // Leaf component with live 3D hardware mesh OR 3D extruded SVG wafer: sleek glowing label pill underneath
    drawGlassRoundedRect(ctx, 20, size - 78, size - 40, 56, 18);
    ctx.fillStyle = hovered ? "rgba(2, 132, 199, 0.92)" : "rgba(15, 23, 42, 0.86)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = hovered ? "#7dd3fc" : hasRealistic3D ? "#10b981" : accent;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 22px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lbl = node.name.length > 14 ? `${node.name.slice(0, 13)}…` : node.name;
    ctx.fillText(lbl, size * 0.5, size - 50);
  } else {
    // Plain fallback 2D badge
    drawGlassRoundedRect(ctx, 18, 28, size - 36, size - 56, 24);
    ctx.fillStyle = hovered ? "rgba(18, 44, 78, 0.90)" : "rgba(15, 23, 42, 0.78)";
    ctx.fill();
    ctx.lineWidth = hovered ? 4 : 2;
    ctx.strokeStyle = hovered ? "#38bdf8" : `${accent}99`;
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    drawGlassRoundedRect(ctx, 88, 84, 144, 96, 12);
    ctx.stroke();
    ctx.fillStyle = "#f8fafc";
    ctx.font = `800 22px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lbl = node.name.length > 15 ? `${node.name.slice(0, 14)}…` : node.name;
    ctx.fillText(lbl, size * 0.5, size - 58);
  }

  ctx.restore();
}

export function RotundaSiblingAtlasRing({
  visible,
  parentItems,
  activeSourceNodeId,
  livePanIndexRef,
  hoveredNodeId,
  onHoverNode,
  onActivateNode,
}: {
  visible: boolean;
  parentItems: readonly GlassLibraryNode[];
  activeSourceNodeId: string | null;
  livePanIndexRef: React.MutableRefObject<number>;
  hoveredNodeId: string | null;
  onHoverNode: (node: GlassLibraryNode | null, worldPos?: THREE.Vector3) => void;
  onActivateNode: (node: GlassLibraryNode, worldPos: THREE.Vector3, e: ThreeEvent<PointerEvent>) => void;
}): React.ReactElement | null {
  const poolGroupRefs = useRef<(THREE.Group | null)[]>(Array(ROTUNDA_ATLAS_MAX_SLOTS).fill(null));
  const poolMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>(Array(ROTUNDA_ATLAS_MAX_SLOTS).fill(null));
  const poolSlotsRef = useRef<(SiblingRotundaSlot | null)[]>(Array(ROTUNDA_ATLAS_MAX_SLOTS).fill(null));
  const lastAtlasSigRef = useRef("");
  const [poolNodes, setPoolNodes] = useState<(GlassLibraryNode | null)[]>(() =>
    Array(ROTUNDA_ATLAS_MAX_SLOTS).fill(null),
  );
  const [svgTick, setSvgTick] = useState(0);

  const poolGeometries = useMemo(
    () => Array.from({ length: ROTUNDA_ATLAS_MAX_SLOTS }, (_, i) => createAtlasPoolGeometry(i)),
    [],
  );
  useEffect(() => () => poolGeometries.forEach((g) => g.dispose()), [poolGeometries]);

  const atlasBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = ROTUNDA_ATLAS_W;
    canvas.height = ROTUNDA_ATLAS_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);
  useEffect(() => () => atlasBundle?.texture.dispose(), [atlasBundle]);

  // Force repaint when hoveredNodeId or async SVG arrives
  useEffect(() => {
    lastAtlasSigRef.current = "";
  }, [hoveredNodeId, svgTick, parentItems, activeSourceNodeId]);

  useFrame((_, rawDelta) => {
    if (!visible || parentItems.length <= 1) return;
    const dt = Math.min(rawDelta, 0.05);
    const alpha = 1 - Math.exp(-dt * 15);

    const visibleSlots = computeSiblingRotundaSlots(parentItems, activeSourceNodeId, livePanIndexRef.current).slice(
      0,
      ROTUNDA_ATLAS_MAX_SLOTS,
    );

    // Build signature of which nodes occupy which pool slots
    const sig = visibleSlots.map((s) => `${s.node.id}:${s.node.id === hoveredNodeId ? 1 : 0}`).join("|");
    if (sig !== lastAtlasSigRef.current) {
      lastAtlasSigRef.current = sig;
      if (atlasBundle?.ctx) {
        atlasBundle.ctx.clearRect(0, 0, ROTUNDA_ATLAS_W, ROTUNDA_ATLAS_H);
        for (let i = 0; i < visibleSlots.length; i++) {
          const s = visibleSlots[i]!;
          paintRotundaAtlasSlot(atlasBundle.ctx, i, s, s.node.id === hoveredNodeId, () => setSvgTick((t) => t + 1));
        }
        atlasBundle.texture.needsUpdate = true;
      }
      // Update React 3D-child node list ONLY when the set of visible IDs actually changes
      const nextNodes = Array.from({ length: ROTUNDA_ATLAS_MAX_SLOTS }, (_, i) => visibleSlots[i]?.node ?? null);
      setPoolNodes((prev) => {
        for (let i = 0; i < ROTUNDA_ATLAS_MAX_SLOTS; i++) {
          if (prev[i]?.id !== nextNodes[i]?.id) return nextNodes;
        }
        return prev;
      });
    }

    // Imperatively update all 10 pooled slot transforms at 90Hz (ZERO React re-renders!)
    for (let i = 0; i < ROTUNDA_ATLAS_MAX_SLOTS; i++) {
      const slot = visibleSlots[i] ?? null;
      poolSlotsRef.current[i] = slot;
      const grp = poolGroupRefs.current[i];
      const mat = poolMatRefs.current[i];
      if (!grp) continue;
      if (!slot) {
        grp.visible = false;
        continue;
      }
      const isHov = slot.node.id === hoveredNodeId;
      if (!grp.visible) {
        grp.visible = true;
        grp.position.set(slot.position[0], slot.position[1], slot.position[2]);
        grp.rotation.set(0, slot.yawRad, 0);
        grp.scale.setScalar(slot.scale);
      } else {
        grp.position.x += (slot.position[0] - grp.position.x) * alpha;
        grp.position.y += (slot.position[1] - grp.position.y) * alpha;
        grp.position.z += (slot.position[2] - grp.position.z) * alpha;
        grp.rotation.y += (slot.yawRad - grp.rotation.y) * alpha;
        const targetS = slot.scale * (isHov ? 1.09 : 1);
        grp.scale.setScalar(grp.scale.x + (targetS - grp.scale.x) * alpha);
      }
      if (mat) {
        mat.opacity = isHov ? 1 : slot.opacity;
      }
    }
  });

  if (!visible || parentItems.length <= 1) return null;

  return (
    <group name="rotunda-sibling-atlas-ring">
      {Array.from({ length: ROTUNDA_ATLAS_MAX_SLOTS }, (_, i) => {
        const node = poolNodes[i];
        const isContainer = node ? node.hasChildren || node.kind !== "component" : true;
        const isHov = Boolean(node && node.id === hoveredNodeId);
        return (
          <group
            key={`rot-pool-${i}`}
            ref={(el) => {
              poolGroupRefs.current[i] = el;
            }}
            visible={false}
          >
            <mesh
              geometry={poolGeometries[i]}
              onPointerOver={(e) => {
                e.stopPropagation();
                const cur = poolSlotsRef.current[i];
                if (cur) onHoverNode(cur.node, e.point.clone());
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                onHoverNode(null);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                const cur = poolSlotsRef.current[i];
                if (cur) onActivateNode(cur.node, e.point.clone(), e);
              }}
            >
              {atlasBundle ? (
                <meshBasicMaterial
                  ref={(m) => {
                    poolMatRefs.current[i] = m;
                  }}
                  map={atlasBundle.texture}
                  transparent
                  opacity={0.92}
                  depthWrite={false}
                  toneMapped={false}
                />
              ) : (
                <meshBasicMaterial color="#1e293b" transparent opacity={0.7} depthWrite={false} />
              )}
            </mesh>

            {/* Leaf sibling 3D shape: Realistic 3D hardware mesh OR Real 3D Extruded SVG Wafer! */}
            {node && !isContainer && node.realisticKind && (
              <group position={[0, 0.03, 0.055]} rotation={[0.14, 0.24, 0]}>
                <RealisticComponentMesh3D
                  kind={node.realisticKind}
                  scale={1.32}
                  emissiveColor={isHov ? "#0284c7" : "#000000"}
                  emissiveIntensity={isHov ? 0.35 : 0}
                  disableRaycast
                />
              </group>
            )}
            {node && !isContainer && !node.realisticKind && node.iconSvg && (
              <group position={[0, 0.035, 0.045]} rotation={[0.08, 0.16, 0]}>
                <ExtrudedSvgMiniWafer3D
                  svg={node.iconSvg}
                  accentColor={isHov ? "#38bdf8" : node.accentColor || "#38bdf8"}
                  scale={1.18}
                />
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  #5 Compact Translucent VR Glass Keyboard for In-Headset Search            */
/* -------------------------------------------------------------------------- */

export function VrGlassKeyboard3D({
  visible,
  query,
  voiceListening,
  position,
  onKeyPress,
}: {
  visible: boolean;
  query: string;
  voiceListening: boolean;
  position: readonly [number, number, number];
  onKeyPress: (key: string) => void;
}): React.ReactElement | null {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const rects = useMemo(() => buildVrKeyboardLayout(), []);

  const bundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = VR_KEYBOARD_CANVAS_W;
    canvas.height = VR_KEYBOARD_CANVAS_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);
  useEffect(() => () => bundle?.texture.dispose(), [bundle]);

  useEffect(() => {
    if (!visible || !bundle?.ctx) return;
    const ctx = bundle.ctx;
    ctx.clearRect(0, 0, VR_KEYBOARD_CANVAS_W, VR_KEYBOARD_CANVAS_H);

    drawGlassRoundedRect(ctx, 4, 4, VR_KEYBOARD_CANVAS_W - 8, VR_KEYBOARD_CANVAS_H - 8, 22);
    ctx.fillStyle = "rgba(9, 15, 30, 0.92)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
    ctx.stroke();

    for (const r of rects) {
      const isHov = hoveredKey === r.key;
      const isVoice = r.key === "🎙";
      const isAction = r.key === "⌫" || r.key === "CLR";
      drawGlassRoundedRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fillStyle =
        isVoice && voiceListening
          ? "#dc2626"
          : isHov
            ? "#0284c7"
            : isAction
              ? "rgba(51, 65, 85, 0.85)"
              : "rgba(30, 41, 59, 0.85)";
      ctx.fill();
      ctx.lineWidth = isHov ? 3 : 1.5;
      ctx.strokeStyle = isHov ? "#7dd3fc" : isVoice && voiceListening ? "#fca5a5" : "rgba(148, 163, 184, 0.35)";
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.font = `800 ${r.key.length > 2 ? 20 : 26}px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(r.key, r.x + r.w * 0.5, r.y + r.h * 0.52);
    }

    bundle.texture.needsUpdate = true;
  }, [visible, bundle, rects, hoveredKey, voiceListening, query]);

  if (!visible || !bundle) return null;

  const hitKey = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return null;
    return hitTestVrKeyboard(rects, e.uv.x * VR_KEYBOARD_CANVAS_W, (1 - e.uv.y) * VR_KEYBOARD_CANVAS_H);
  };

  return (
    <group name="vr-glass-search-keyboard" position={[position[0], position[1], position[2]]} rotation={[-0.22, 0, 0]}>
      <mesh
        onPointerMove={(e) => {
          e.stopPropagation();
          setHoveredKey(hitKey(e)?.key ?? null);
        }}
        onPointerOut={() => setHoveredKey(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          const k = hitKey(e);
          if (!k) return;
          pulseEventHaptic(e, 0.14, 10);
          onKeyPress(k.key);
        }}
      >
        <planeGeometry args={[0.72, 0.21]} />
        <meshBasicMaterial map={bundle.texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
