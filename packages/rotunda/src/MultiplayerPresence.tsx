// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasPeerPresence, SpatialSurfaceBridge } from "@modelscript/canvas";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  buildDeskSpatialPlane,
  clampNumber,
  DEFAULT_DESK_SCALE,
  resolveDeskLayout,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_BOARD_TEX_OFFSET_X,
  ROTUNDA_BOARD_TEX_OFFSET_Y,
  ROTUNDA_BOARD_TEX_SCALE,
} from "./types.js";

export interface PeerRotundaSeat {
  position: [number, number, number];
  yaw: number;
}

export interface MultiplayerPresenceProps {
  peers: readonly CanvasPeerPresence[];
  bridge: SpatialSurfaceBridge;
  podiumTiltDeg: number;
  plinthCenter: [number, number, number];
  /** Live desk size multiplier (must match `DraftingPodium`'s `deskScale`). */
  deskScale?: number | undefined;
  /** Live calibrated desk height (must match `DraftingPodium`'s `deskHeightY`). */
  deskHeightY?: number | null | undefined;
  /** Uniform plinth root scale for the active scale mode (hero ≈ 4.1) used for plinth laser targets. */
  plinthScale?: number | undefined;
}

interface PeerDeskContext {
  deskScale: number;
  deskHeightY: number | null;
  plinthScale: number;
}

const ROTUNDA_FOCAL_Z = -1.55;
const DEFAULT_PEER_ARC_RADIUS = 2.35;
const ARC_START_RAD = 0.44 * Math.PI; // ~79° right observation flank (clear of local user & wings)
const ARC_END_RAD = 1.56 * Math.PI; // ~281° left observation flank
const SINGLE_PEER_ANGLE_RAD = 0.62 * Math.PI; // ~112° front-right collaborator vantage
const HAND_LOCAL_OFFSET: [number, number, number] = [0.27, 1.18, 0.24];

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function resolvePeerColor(color: string | undefined): string {
  const trimmed = (color ?? "").trim();
  return trimmed.length > 0 ? trimmed : "#38bdf8";
}

function truncateLabel(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}

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

/**
 * Pure helper placing remote multiplayer engineers around the Rotunda observation arc
 * facing the central plinth & 45° drafting podium without colliding with the local user at `[0, 0, 0.22]`.
 */
export function computePeerRotundaSeat(
  index: number,
  total: number,
  radius = DEFAULT_PEER_ARC_RADIUS,
): PeerRotundaSeat {
  const safeTotal = Number.isFinite(total) && total >= 1 ? Math.floor(total) : 1;
  const safeIndex = clampNumber(Number.isFinite(index) ? Math.floor(index) : 0, 0, safeTotal - 1);
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_PEER_ARC_RADIUS;

  const angle =
    safeTotal === 1
      ? SINGLE_PEER_ANGLE_RAD
      : ARC_START_RAD + (safeIndex / (safeTotal - 1)) * (ARC_END_RAD - ARC_START_RAD);

  const px = normalizeZero(Math.sin(angle) * safeRadius);
  const pz = normalizeZero(ROTUNDA_FOCAL_Z + Math.cos(angle) * safeRadius);

  // Local avatar forward is +Z; yaw aims directly toward (0, 0, ROTUNDA_FOCAL_Z)
  const dx = -px;
  const dz = ROTUNDA_FOCAL_Z - pz;
  const yaw = normalizeZero(Math.atan2(dx, dz));

  return {
    position: [px, 0, pz],
    yaw,
  };
}

function computePeerHandWorldPosition(seat: PeerRotundaSeat): [number, number, number] {
  const cosY = Math.cos(seat.yaw);
  const sinY = Math.sin(seat.yaw);
  const [lx, ly, lz] = HAND_LOCAL_OFFSET;
  return [seat.position[0] + lx * cosY + lz * sinY, seat.position[1] + ly, seat.position[2] - lx * sinY + lz * cosY];
}

function resolvePeerLaserTarget(
  peer: CanvasPeerPresence,
  bridge: SpatialSurfaceBridge,
  podiumTiltDeg: number,
  plinthCenter: [number, number, number],
  desk: PeerDeskContext = { deskScale: DEFAULT_DESK_SCALE, deskHeightY: null, plinthScale: 1 },
): { target: [number, number, number]; onPodium: boolean } {
  if (peer.cursor && Number.isFinite(peer.cursor.x) && Number.isFinite(peer.cursor.y)) {
    const u = clampNumber(
      ROTUNDA_BOARD_TEX_OFFSET_X + peer.cursor.x * ROTUNDA_BOARD_TEX_SCALE,
      0,
      ROTUNDA_BOARD_CANVAS_WIDTH,
    );
    const v = clampNumber(
      ROTUNDA_BOARD_TEX_OFFSET_Y + peer.cursor.y * ROTUNDA_BOARD_TEX_SCALE,
      0,
      ROTUNDA_BOARD_CANVAS_HEIGHT,
    );

    const projected = bridge.planeUVToWorld3D("podium", u, v, 0.012);
    if (projected) {
      return { target: projected, onPodium: true };
    }

    // Fallback projection using the exact current podium tilt & desk layout if plane isn't registered yet
    const plane = buildDeskSpatialPlane(podiumTiltDeg, resolveDeskLayout(desk.deskScale, desk.deskHeightY));
    const um = u / plane.unitsPerMeter;
    const vm = v / plane.unitsPerMeter;
    return {
      target: [
        plane.origin[0] + plane.right[0] * um + plane.down[0] * vm + plane.normal[0] * 0.012,
        plane.origin[1] + plane.right[1] * um + plane.down[1] * vm + plane.normal[1] * 0.012,
        plane.origin[2] + plane.right[2] * um + plane.down[2] * vm + plane.normal[2] * 0.012,
      ],
      onPodium: true,
    };
  }

  return {
    target: [plinthCenter[0], plinthCenter[1] + 0.36 * desk.plinthScale, plinthCenter[2]],
    onPodium: false,
  };
}

interface PeerNamePillProps {
  userName: string;
  activeTool?: string | undefined;
  color: string;
}

/**
 * High-DPI floating name pill rendered onto a persistent `THREE.CanvasTexture`
 * (disposed cleanly on unmount) and billboarded toward the viewer camera.
 */
function PeerNamePill({ userName, activeTool, color }: PeerNamePillProps): React.ReactElement {
  const pillRef = useRef<THREE.Mesh | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 112;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
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

    // Translucent obsidian pill backdrop
    drawRoundedRectPath(ctx, 8, 10, w - 16, h - 20, 46);
    ctx.fillStyle = "rgba(9, 15, 29, 0.92)";
    ctx.fill();

    // Crisp peer-colored outer border
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Live presence status dot
    ctx.beginPath();
    ctx.arc(54, h / 2, 13, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(54, h / 2, 20, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Engineer name typography
    const safeName = truncateLabel(userName || "Engineer", 18);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 34px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(safeName, 88, activeTool ? h / 2 - 14 : h / 2 + 1);

    if (activeTool) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "600 20px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillText(truncateLabel(activeTool, 26), 88, h / 2 + 20);
    }

    tex.needsUpdate = true;
  }, [userName, activeTool, color, texture]);

  useFrame((state) => {
    if (pillRef.current) {
      pillRef.current.lookAt(state.camera.position);
    }
  });

  return (
    <mesh ref={pillRef} position={[0, 1.9, 0]}>
      <planeGeometry args={[0.52, 0.114]} />
      {texture ? (
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      ) : (
        <meshBasicMaterial color="#0f172a" transparent opacity={0.85} depthWrite={false} />
      )}
    </mesh>
  );
}

interface PeerAvatarProps {
  peer: CanvasPeerPresence;
  index: number;
  total: number;
  bridge: SpatialSurfaceBridge;
  podiumTiltDeg: number;
  plinthCenter: [number, number, number];
  deskScale: number;
  deskHeightY: number | null;
  plinthScale: number;
}

function PeerAvatar({
  peer,
  index,
  total,
  bridge,
  podiumTiltDeg,
  plinthCenter,
  deskScale,
  deskHeightY,
  plinthScale,
}: PeerAvatarProps): React.ReactElement {
  const bodyRef = useRef<THREE.Group | null>(null);
  const haloRef = useRef<THREE.Mesh | null>(null);

  const peerColor = resolvePeerColor(peer.color);
  const seat = useMemo(() => computePeerRotundaSeat(index, total), [index, total]);
  const handWorldPos = useMemo(() => computePeerHandWorldPosition(seat), [seat]);

  const [laserInfo, setLaserInfo] = useState<{
    target: [number, number, number];
    onPodium: boolean;
  }>(() => resolvePeerLaserTarget(peer, bridge, podiumTiltDeg, plinthCenter, { deskScale, deskHeightY, plinthScale }));

  // Refresh laser world target after DraftingPodium registers any podiumTiltDeg change on bridge
  const cursorX = peer.cursor?.x;
  const cursorY = peer.cursor?.y;
  const plinthX = plinthCenter[0];
  const plinthY = plinthCenter[1];
  const plinthZ = plinthCenter[2];

  useEffect(() => {
    setLaserInfo(
      resolvePeerLaserTarget(peer, bridge, podiumTiltDeg, [plinthX, plinthY, plinthZ], {
        deskScale,
        deskHeightY,
        plinthScale,
      }),
    );
  }, [peer, cursorX, cursorY, bridge, podiumTiltDeg, plinthX, plinthY, plinthZ, deskScale, deskHeightY, plinthScale]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const phase = index * 1.37;
    if (bodyRef.current) {
      bodyRef.current.position.y = Math.sin(t * 1.9 + phase) * 0.022;
    }
    if (haloRef.current) {
      haloRef.current.rotation.z = t * 0.65 + phase;
    }
  });

  const laserPoints = useMemo<Array<[number, number, number]>>(
    () => [handWorldPos, laserInfo.target],
    [handWorldPos, laserInfo.target],
  );

  return (
    <group name={`rotunda-peer-${peer.peerId}`}>
      {/* Positioned & Oriented VR Engineer Avatar */}
      <group position={seat.position} rotation={[0, seat.yaw, 0]}>
        {/* Floor spatial presence ring */}
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.26, 0.31, 40]} />
          <meshBasicMaterial
            color={peerColor}
            transparent
            opacity={0.45}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Gently breathing floating head/visor + holographic torso */}
        <group ref={bodyRef}>
          {/* Stylized VR Head Shell */}
          <mesh position={[0, 1.56, 0]} castShadow>
            <sphereGeometry args={[0.125, 24, 20]} />
            <meshStandardMaterial
              color="#111827"
              emissive={peerColor}
              emissiveIntensity={0.14}
              metalness={0.55}
              roughness={0.28}
              transparent
              opacity={0.86}
            />
          </mesh>

          {/* Glowing Stylized Headset Visor facing +Z */}
          <mesh position={[0, 1.565, 0.088]}>
            <boxGeometry args={[0.205, 0.086, 0.085]} />
            <meshStandardMaterial
              color={peerColor}
              emissive={peerColor}
              emissiveIntensity={1.25}
              metalness={0.3}
              roughness={0.15}
              transparent
              opacity={0.88}
              toneMapped={false}
            />
          </mesh>

          {/* Subtle Temple Head-Strap Accent Band */}
          <mesh position={[0, 1.57, -0.005]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.132, 0.01, 10, 32]} />
            <meshStandardMaterial
              color={peerColor}
              emissive={peerColor}
              emissiveIntensity={0.7}
              metalness={0.4}
              roughness={0.25}
              transparent
              opacity={0.78}
            />
          </mesh>

          {/* Sleek Translucent Floating Torso Bust */}
          <mesh position={[0, 1.15, 0]}>
            <cylinderGeometry args={[0.17, 0.11, 0.44, 24]} />
            <meshStandardMaterial
              color="#0f172a"
              emissive={peerColor}
              emissiveIntensity={0.35}
              metalness={0.35}
              roughness={0.26}
              transparent
              opacity={0.48}
              depthWrite={false}
            />
          </mesh>

          {/* Floating Luminous Torso Halo Ring */}
          <mesh ref={haloRef} position={[0, 1.23, 0]} rotation={[Math.PI / 2 - 0.14, 0, 0]}>
            <torusGeometry args={[0.25, 0.012, 12, 48]} />
            <meshStandardMaterial
              color={peerColor}
              emissive={peerColor}
              emissiveIntensity={1.35}
              transparent
              opacity={0.85}
              toneMapped={false}
            />
          </mesh>

          {/* Subtle Shoulder Collar Arc */}
          <mesh position={[0, 1.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.165, 0.008, 10, 36]} />
            <meshStandardMaterial
              color={peerColor}
              emissive={peerColor}
              emissiveIntensity={0.85}
              transparent
              opacity={0.62}
            />
          </mesh>

          {/* Floating Right-Hand Controller Emitter Orb */}
          <mesh position={HAND_LOCAL_OFFSET}>
            <sphereGeometry args={[0.036, 16, 16]} />
            <meshStandardMaterial
              color={peerColor}
              emissive={peerColor}
              emissiveIntensity={1.45}
              transparent
              opacity={0.9}
              toneMapped={false}
            />
          </mesh>
        </group>

        {/* Crisp High-DPI Billboarded Name Pill above Visor */}
        <PeerNamePill userName={peer.userName} activeTool={peer.activeTool} color={peerColor} />
      </group>

      {/* Translucent Laser Pointer Ray from Peer's Hand to Podium Cursor or Central Plinth */}
      <Line
        points={laserPoints}
        color={peerColor}
        lineWidth={2.2}
        transparent
        opacity={laserInfo.onPodium ? 0.78 : 0.48}
      />

      {/* Glowing Laser Impact Reticle Dot at Target */}
      <mesh position={laserInfo.target}>
        <sphereGeometry args={[laserInfo.onPodium ? 0.016 : 0.022, 14, 14]} />
        <meshBasicMaterial
          color={peerColor}
          transparent
          opacity={laserInfo.onPodium ? 0.92 : 0.65}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Renders live multiplayer remote engineers from `CanvasCrdtStore` as translucent 3D VR
 * engineer avatars arranged around the Rotunda observation arc with live laser pointers
 * aimed onto the 45° Drafting Podium (or Circular Plinth when cursor is unset).
 */
export function MultiplayerPresence({
  peers,
  bridge,
  podiumTiltDeg,
  plinthCenter,
  deskScale = DEFAULT_DESK_SCALE,
  deskHeightY = null,
  plinthScale = 1,
}: MultiplayerPresenceProps): React.ReactElement | null {
  if (peers.length === 0) return null;

  return (
    <group name="rotunda-multiplayer-presence">
      {peers.map((peer, idx) => (
        <PeerAvatar
          key={peer.peerId}
          peer={peer}
          index={idx}
          total={peers.length}
          bridge={bridge}
          podiumTiltDeg={podiumTiltDeg}
          plinthCenter={plinthCenter}
          deskScale={deskScale}
          deskHeightY={deskHeightY}
          plinthScale={plinthScale}
        />
      ))}
    </group>
  );
}
