// SPDX-License-Identifier: AGPL-3.0-or-later

import { Grid } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type { RotundaEnvironmentId, RotundaScaleMode } from "./types.js";

export interface RotundaEnvironmentProps {
  environment: RotundaEnvironmentId;
  plinthCenter: [number, number, number];
  scaleMode: RotundaScaleMode;
}

export interface EnvironmentSceneBackdrop {
  background: string | null;
  isLight: boolean;
}

/**
 * Returns the canonical scene background color and light/dark classification
 * for each Engineering Rotunda environment preset (used by UI chrome & tests).
 */
export function getEnvironmentSceneBackdrop(env: RotundaEnvironmentId): EnvironmentSceneBackdrop {
  switch (env) {
    case "warehouse":
      return { background: "#141923", isLight: false };
    case "office":
      return { background: "#d6e4f0", isLight: true };
    case "outdoors":
      return { background: "#8ec5f8", isLight: true };
    case "dark-lab":
      return { background: "#050914", isLight: false };
    case "passthrough":
      return { background: null, isLight: false };
  }
}

interface SceneBackdropSyncProps {
  background: string | null;
  fogColor?: string | undefined;
  fogNear?: number | undefined;
  fogFar?: number | undefined;
  transparent: boolean;
}

/**
 * Synchronizes `THREE.Scene.background`, `THREE.Scene.fog`, and WebGL clear color/alpha
 * directly onto the root scene (preventing R3F `<color attach="background" />` inside `<group>`
 * from leaving `scene.background === null` in WebXR headsets).
 */
function SceneBackdropSync({ background, fogColor, fogNear, fogFar, transparent }: SceneBackdropSyncProps): null {
  const { gl, scene } = useThree();

  useEffect(() => {
    const prevBackground = scene.background;
    const prevFog = scene.fog;
    const prevClearColor = new THREE.Color();
    gl.getClearColor(prevClearColor);
    const prevClearAlpha = gl.getClearAlpha();

    if (transparent || background === null) {
      scene.background = null;
      scene.fog = null;
      gl.setClearColor(0x000000, 0);
      gl.setClearAlpha(0);
    } else {
      const bgColor = new THREE.Color(background);
      scene.background = bgColor;
      scene.fog =
        fogColor !== undefined && fogNear !== undefined && fogFar !== undefined
          ? new THREE.Fog(fogColor, fogNear, fogFar)
          : null;
      gl.setClearColor(bgColor, 1);
      gl.setClearAlpha(1);
    }

    return () => {
      scene.background = prevBackground;
      scene.fog = prevFog;
      gl.setClearColor(prevClearColor, prevClearAlpha);
      gl.setClearAlpha(prevClearAlpha);
    };
  }, [gl, scene, background, fogColor, fogNear, fogFar, transparent]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Deterministic Procedural Texture & Geometry Builders (Offline / SSR Safe) */
/* -------------------------------------------------------------------------- */

function hash2d(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function configureRepeatTexture(tex: THREE.DataTexture, repeatX: number, repeatY: number): THREE.DataTexture {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Polished dark industrial concrete with subtle aggregate grain & expansion seams. */
function createWarehouseConcreteTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const coarse = Math.sin(x * 0.049 + 0.5) * Math.cos(y * 0.049 - 0.3) * 7 + Math.sin((x + y) * 0.098) * 4;
      const speck = (hash2d(x, y) - 0.5) * 14;
      const isSeam = x < 2 || y < 2;
      const seamDelta = isSeam ? -14 : 0;

      const r = Math.max(16, Math.min(255, Math.round(35 + coarse + speck + seamDelta)));
      const g = Math.max(20, Math.min(255, Math.round(42 + coarse + speck + seamDelta)));
      const b = Math.max(26, Math.min(255, Math.round(54 + coarse + speck + seamDelta)));

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return configureRepeatTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), 16, 16);
}

/** Diagonal amber/charcoal hazard stripe texture for industrial floor bay borders. */
function createHazardStripeTexture(repeatX: number, repeatY: number): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const band = (x + y) % 32 < 16;
      const micro = (hash2d(x, y) - 0.5) * 8;
      if (band) {
        data[idx] = Math.max(0, Math.min(255, Math.round(238 + micro)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(158 + micro)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(14 + micro)));
      } else {
        data[idx] = Math.max(0, Math.min(255, Math.round(26 + micro)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(34 + micro)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(48 + micro)));
      }
      data[idx + 3] = 255;
    }
  }
  return configureRepeatTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), repeatX, repeatY);
}

/** Warm honed travertine / architectural light concrete tile texture for Design Studio. */
function createTravertineFloorTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const vein = Math.sin(y * 0.16 + Math.sin(x * 0.04) * 2.5) * 6.5 + Math.cos(y * 0.34 - x * 0.025) * 3.2;
      const grain = (hash2d(x, y) - 0.5) * 7;
      const isGrout = x < 2 || y < 2 || (x >= 127 && x <= 128) || (y >= 127 && y <= 128);
      const groutDelta = isGrout ? -22 : 0;

      const r = Math.max(160, Math.min(250, Math.round(227 + vein + grain + groutDelta)));
      const g = Math.max(154, Math.min(246, Math.round(220 + vein + grain + groutDelta)));
      const b = Math.max(144, Math.min(238, Math.round(209 + vein * 0.8 + grain + groutDelta)));

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return configureRepeatTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), 16, 16);
}

/** Brushed outdoor stone/concrete aggregate texture for the circular proving pad. */
function createProvingPadTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const aggregate = (hash2d(x, y) - 0.5) * 18;
      const brush = Math.sin(x * 0.12 + y * 0.04) * 4;
      const isJoint = x === 0 || y === 0 || x === 128 || y === 128;
      const jointDelta = isJoint ? -18 : 0;

      const r = Math.max(110, Math.min(220, Math.round(166 + aggregate + brush + jointDelta)));
      const g = Math.max(114, Math.min(222, Math.round(170 + aggregate + brush + jointDelta)));
      const b = Math.max(118, Math.min(226, Math.round(174 + aggregate + brush + jointDelta)));

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return configureRepeatTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), 4, 4);
}

/**
 * Evaluates procedural rolling meadow elevation at world `(x, z)`.
 * Guaranteed strictly flat (`-0.025`) inside at least a 4 m radius around the rotunda
 * (both user standing center and plinth center) so the workstation rests cleanly on level ground.
 */
function sampleMeadowHeight(x: number, z: number, plinthX: number, plinthZ: number, flatRadius: number): number {
  const distToPlinth = Math.hypot(x - plinthX, z - plinthZ);
  const distToOrigin = Math.hypot(x, z);
  const distToMid = Math.hypot(x - plinthX * 0.5, z - plinthZ * 0.5);
  const dClear = Math.min(distToPlinth, distToOrigin, distToMid);

  if (dClear <= flatRadius) {
    return -0.025;
  }

  const blend = smoothstep(flatRadius, flatRadius + 9.5, dClear);
  const rolling =
    Math.sin(x * 0.052 + 0.35) * Math.cos(z * 0.046 - 0.25) * 2.6 +
    Math.sin(x * 0.105 - z * 0.088 + 1.1) * 1.15 +
    Math.cos((x + z) * 0.031) * 1.45 +
    0.7;

  // Gentle distant bowl rise toward horizon for scenic framing
  const horizonRise = smoothstep(26, 68, dClear) * 3.2;
  const hillHeight = Math.max(-0.35, rolling) + horizonRise;
  return -0.025 + hillHeight * blend;
}

/** Builds vertex-displaced rolling meadow terrain geometry with natural green/olive vertex colors. */
function createMeadowTerrainGeometry(plinthX: number, plinthZ: number, flatRadius: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(156, 156, 96, 96);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes["position"];
  if (!pos) return geom;

  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const baseGreen = new THREE.Color("#4d8a41");
  const sunlitGrass = new THREE.Color("#73a94b");
  const olivePatch = new THREE.Color("#577537");
  const padEdgeTint = new THREE.Color("#6b8347");
  const scratch = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = sampleMeadowHeight(x, z, plinthX, plinthZ, flatRadius);
    pos.setY(i, y);

    const patchNoise = 0.5 + 0.5 * Math.sin(x * 0.13 + 0.7) * Math.cos(z * 0.15 - 0.4);
    const elevationFactor = smoothstep(0.15, 3.8, y);
    const distToPlinth = Math.hypot(x - plinthX, z - plinthZ);
    const edgeFactor = 1 - smoothstep(flatRadius - 0.8, flatRadius + 2.2, distToPlinth);

    scratch.copy(baseGreen);
    scratch.lerp(olivePatch, patchNoise * 0.48);
    scratch.lerp(sunlitGrass, elevationFactor * 0.52);
    if (edgeFactor > 0) {
      scratch.lerp(padEdgeTint, edgeFactor * 0.25);
    }

    const jitter = (hash2d(Math.round(x * 2), Math.round(z * 2)) - 0.5) * 0.035;
    colors[i * 3] = Math.max(0, Math.min(1, scratch.r + jitter));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, scratch.g + jitter));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, scratch.b + jitter * 0.6));
  }

  pos.needsUpdate = true;
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

/** Builds a procedural gradient sky dome sphere (deep azure zenith -> soft sunlit horizon). */
function createSkyDomeGeometry(): THREE.BufferGeometry {
  const radius = 84;
  const geom = new THREE.SphereGeometry(radius, 32, 20);
  const pos = geom.attributes["position"];
  if (!pos) return geom;

  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const zenith = new THREE.Color("#1b5fb5");
  const midSky = new THREE.Color("#73b7f5");
  const horizon = new THREE.Color("#e8f4fd");
  const sunGlow = new THREE.Color("#fff5dd");
  const belowHorizon = new THREE.Color("#b5d1be");
  const sunDir = new THREE.Vector3(24, 28, -22).normalize();
  const dir = new THREE.Vector3();
  const scratch = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    dir.set(vx, vy, vz).normalize();
    const ny = dir.y;

    if (ny < 0) {
      scratch.copy(horizon).lerp(belowHorizon, smoothstep(0, -0.25, ny));
    } else if (ny < 0.24) {
      scratch.copy(horizon).lerp(midSky, smoothstep(0, 0.24, ny));
    } else {
      scratch.copy(midSky).lerp(zenith, smoothstep(0.24, 0.88, ny));
    }

    const sunAlign = Math.max(0, dir.dot(sunDir));
    const halo = Math.pow(sunAlign, 8) * 0.42 + Math.pow(sunAlign, 3) * 0.14 * (1 - Math.abs(ny));
    scratch.lerp(sunGlow, Math.min(0.65, halo));

    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geom;
}

/* -------------------------------------------------------------------------- */
/*  1. Industrial Hangar ("warehouse")                                        */
/* -------------------------------------------------------------------------- */

const WAREHOUSE_BAY_Z = [-18, -10, -2, 6] as const;

interface SubEnvProps {
  plinthX: number;
  plinthZ: number;
  bayScale: number;
}

function WarehouseEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const concreteTex = useMemo(() => createWarehouseConcreteTexture(), []);
  const hazardTexLong = useMemo(() => createHazardStripeTexture(22, 1), []);
  const hazardTexShort = useMemo(() => createHazardStripeTexture(18, 1), []);

  useEffect(() => {
    return () => {
      concreteTex.dispose();
      hazardTexLong.dispose();
      hazardTexShort.dispose();
    };
  }, [concreteTex, hazardTexLong, hazardTexShort]);

  // Instanced diagonal web struts across all 4 overhead trusses
  const strutsRef = useRef<THREE.InstancedMesh | null>(null);
  const strutsCount = WAREHOUSE_BAY_Z.length * 10;

  useEffect(() => {
    const mesh = strutsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const z of WAREHOUSE_BAY_Z) {
      for (let s = 0; s < 10; s++) {
        const x = -9.9 + s * 2.2;
        const tilt = s % 2 === 0 ? 0.56 : -0.56;
        dummy.position.set(x, 8.15, z);
        dummy.rotation.set(0, 0, tilt);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // Radial alignment ticks around the circular safety bay ring
  const ringTicksRef = useRef<THREE.InstancedMesh | null>(null);
  const ringRadiusOuter = 1.92 * bayScale;
  const ringRadiusInner = 1.56 * bayScale;

  useEffect(() => {
    const mesh = ringTicksRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const tickRadius = (ringRadiusOuter + ringRadiusInner) * 0.5;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      dummy.position.set(plinthX + Math.cos(angle) * tickRadius, 0.006, plinthZ + Math.sin(angle) * tickRadius);
      dummy.rotation.set(-Math.PI / 2, 0, -angle);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [plinthX, plinthZ, ringRadiusOuter, ringRadiusInner]);

  const bayHalfW = 3.8 * (bayScale > 1.2 ? 1.18 : 1.0);
  const bayMinZ = plinthZ - 2.6 * bayScale;
  const bayMaxZ = 1.5;
  const bayCenterZ = (bayMinZ + bayMaxZ) * 0.5;
  const bayDepth = bayMaxZ - bayMinZ;

  return (
    <group name="rotunda-env-warehouse">
      <SceneBackdropSync background="#141923" fogColor="#141923" fogNear={15} fogFar={50} transparent={false} />

      {/* Warm industrial key light + cool fill + high-bay plinth accent */}
      <hemisphereLight args={["#94a3b8", "#18202c", 0.58]} />
      <ambientLight intensity={0.28} color="#cbd5e1" />
      <directionalLight
        position={[9, 13, 6]}
        intensity={1.75}
        color="#ffedd5"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-9, 7, -8]} intensity={0.72} color="#7dd3fc" />
      <pointLight position={[plinthX, 6.2, plinthZ]} intensity={1.15} distance={16} color="#fed7aa" />

      {/* Polished dark concrete hangar floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -4]} receiveShadow>
        <planeGeometry args={[68, 68]} />
        <meshStandardMaterial map={concreteTex} roughness={0.42} metalness={0.18} />
      </mesh>

      {/* Painted amber + cyan circular safety bay ring around plinth */}
      <group position={[plinthX, 0.004, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringRadiusOuter - 0.1, ringRadiusOuter, 64]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.5} metalness={0.08} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[ringRadiusInner - 0.045, ringRadiusInner, 64]} />
          <meshStandardMaterial color="#06b6d4" emissive="#0891b2" emissiveIntensity={0.45} roughness={0.35} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
          <circleGeometry args={[ringRadiusInner - 0.05, 64]} />
          <meshStandardMaterial color="#18202d" roughness={0.38} metalness={0.22} />
        </mesh>
      </group>

      {/* 12 painted amber alignment ticks */}
      <instancedMesh ref={ringTicksRef} args={[undefined, undefined, 12]}>
        <planeGeometry args={[0.18, 0.045]} />
        <meshStandardMaterial color="#fbbf24" roughness={0.5} />
      </instancedMesh>

      {/* Striped hazard floor bay borders */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, bayMinZ]}>
        <planeGeometry args={[bayHalfW * 2 + 0.22, 0.22]} />
        <meshStandardMaterial map={hazardTexShort} roughness={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, bayMaxZ]}>
        <planeGeometry args={[bayHalfW * 2 + 0.22, 0.22]} />
        <meshStandardMaterial map={hazardTexShort} roughness={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-bayHalfW, 0.005, bayCenterZ]}>
        <planeGeometry args={[bayDepth, 0.22]} />
        <meshStandardMaterial map={hazardTexLong} roughness={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[bayHalfW, 0.005, bayCenterZ]}>
        <planeGeometry args={[bayDepth, 0.22]} />
        <meshStandardMaterial map={hazardTexLong} roughness={0.55} />
      </mesh>

      {/* Distant steel columns, safety base collars, and overhead high-bay truss rafters */}
      {WAREHOUSE_BAY_Z.map((z) => (
        <group key={z} position={[0, 0, z]}>
          {[-11.2, 11.2].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 4.4, 0]}>
                <boxGeometry args={[0.48, 8.8, 0.48]} />
                <meshStandardMaterial color="#273244" metalness={0.72} roughness={0.42} />
              </mesh>
              <mesh position={[0, 0.55, 0]}>
                <boxGeometry args={[0.56, 1.1, 0.56]} />
                <meshStandardMaterial color="#d97706" metalness={0.25} roughness={0.55} />
              </mesh>
            </group>
          ))}
          {/* Truss bottom & top chords */}
          <mesh position={[0, 7.6, 0]}>
            <boxGeometry args={[22.8, 0.24, 0.26]} />
            <meshStandardMaterial color="#2e3a4d" metalness={0.72} roughness={0.4} />
          </mesh>
          <mesh position={[0, 8.7, 0]}>
            <boxGeometry args={[22.8, 0.24, 0.26]} />
            <meshStandardMaterial color="#243041" metalness={0.72} roughness={0.42} />
          </mesh>
        </group>
      ))}

      {/* Instanced diagonal truss web bracing */}
      <instancedMesh ref={strutsRef} args={[undefined, undefined, strutsCount]}>
        <boxGeometry args={[0.1, 1.38, 0.14]} />
        <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.42} />
      </instancedMesh>

      {/* Longitudinal overhead roof purlins */}
      {[-11.2, -5.6, 0, 5.6, 11.2].map((x) => (
        <mesh key={x} position={[x, 8.88, -6]}>
          <boxGeometry args={[0.2, 0.2, 28]} />
          <meshStandardMaterial color="#1f2937" metalness={0.7} roughness={0.48} />
        </mesh>
      ))}

      {/* Glowing high-bay skylight / LED luminaire strips */}
      {[-14, -6, 2].map((z) => (
        <group key={z} position={[0, 8.55, z]}>
          {[-4.2, 4.2].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <boxGeometry args={[5.4, 0.08, 0.72]} />
              <meshStandardMaterial color="#f0f9ff" emissive="#bae6fd" emissiveIntensity={1.65} roughness={0.2} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Distant hangar rear bulkhead & amber bay accent stripe */}
      <group position={[0, 0, -23.5]}>
        <mesh position={[0, 4.6, 0]}>
          <boxGeometry args={[28, 9.2, 0.4]} />
          <meshStandardMaterial color="#1b2230" roughness={0.78} metalness={0.35} />
        </mesh>
        <mesh position={[0, 1.35, 0.24]}>
          <boxGeometry args={[26, 0.16, 0.04]} />
          <meshStandardMaterial color="#f59e0b" emissive="#b45309" emissiveIntensity={0.35} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Sunlit Design Studio ("office")                                        */
/* -------------------------------------------------------------------------- */

const LOUVER_COUNT = 36;

function OfficeEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const travertineTex = useMemo(() => createTravertineFloorTexture(), []);

  useEffect(() => {
    return () => {
      travertineTex.dispose();
    };
  }, [travertineTex]);

  const louversRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const mesh = louversRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const toneA = new THREE.Color("#b98755");
    const toneB = new THREE.Color("#9e6f42");
    const color = new THREE.Color();
    const arcRadius = 9.0;
    const arcCenterZ = -1.8;

    for (let i = 0; i < LOUVER_COUNT; i++) {
      const frac = i / (LOUVER_COUNT - 1);
      // Curved rear perimeter behind the plinth (-62 deg to +62 deg around -Z)
      const theta = -1.08 + frac * 2.16;
      const x = Math.sin(theta) * arcRadius;
      const z = arcCenterZ - Math.cos(theta) * arcRadius;

      dummy.position.set(x, 2.7, z);
      dummy.rotation.set(0, -theta + 0.16, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const grainMix = 0.5 + 0.5 * Math.sin(i * 1.9);
      color.copy(toneA).lerp(toneB, grainMix * 0.55);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  const inlayRadius = 1.82 * bayScale;

  return (
    <group name="rotunda-env-office">
      <SceneBackdropSync background="#d6e4f0" fogColor="#d6e4f0" fogNear={16} fogFar={46} transparent={false} />

      {/* Warm sunlit key daylight + crisp cool architectural fill */}
      <hemisphereLight args={["#f0f9ff", "#d4cbbd", 0.95]} />
      <ambientLight intensity={0.45} color="#ffffff" />
      <directionalLight
        position={[11, 11.5, 5.5]}
        intensity={1.85}
        color="#fff7ed"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-8, 7, -6]} intensity={0.68} color="#bae6fd" />

      {/* Warm matte travertine / light-concrete architectural floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -3]} receiveShadow>
        <planeGeometry args={[56, 56]} />
        <meshStandardMaterial map={travertineTex} roughness={0.74} metalness={0.04} />
      </mesh>

      {/* Recessed architectural brass/slate circular inlay ring around plinth */}
      <group position={[plinthX, 0.004, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[inlayRadius - 0.045, inlayRadius, 64]} />
          <meshStandardMaterial color="#b49464" metalness={0.55} roughness={0.35} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[inlayRadius * 0.72 - 0.02, inlayRadius * 0.72, 64]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.35} roughness={0.5} />
        </mesh>
      </group>

      {/* Curved rear acoustic shadow wall + oak vertical louver fins */}
      <mesh position={[0, 2.7, -1.8]}>
        <cylinderGeometry args={[9.32, 9.32, 5.4, 48, 1, true, Math.PI - 1.15, 2.3]} />
        <meshStandardMaterial color="#334155" roughness={0.92} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 5.45, -1.8]}>
        <cylinderGeometry args={[9.4, 9.4, 0.35, 48, 1, true, Math.PI - 1.18, 2.36]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.78} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={louversRef} args={[undefined, undefined, LOUVER_COUNT]} castShadow receiveShadow>
        <boxGeometry args={[0.11, 5.1, 0.24]} />
        <meshStandardMaterial color="#ffffff" roughness={0.62} metalness={0.05} />
      </instancedMesh>

      {/* Sunlit glass window wall bays on both left & right perimeters */}
      {[-9.6, 9.6].map((x) => {
        const inwardSign = x < 0 ? 1 : -1;
        return (
          <group key={x} position={[x, 0, -2.5]}>
            {/* Translucent sunlit sky-glow glass glazing */}
            <mesh position={[0, 2.8, 0]} rotation={[0, inwardSign * (Math.PI / 2), 0]}>
              <planeGeometry args={[17.6, 5.1]} />
              <meshStandardMaterial
                color="#e0f2fe"
                emissive="#f0f9ff"
                emissiveIntensity={0.55}
                roughness={0.15}
                transparent
                opacity={0.76}
              />
            </mesh>
            {/* Top & bottom anodized aluminum window transoms */}
            <mesh position={[0, 0.14, 0]}>
              <boxGeometry args={[0.16, 0.28, 18.0]} />
              <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.38} />
            </mesh>
            <mesh position={[0, 5.38, 0]}>
              <boxGeometry args={[0.18, 0.24, 18.0]} />
              <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.38} />
            </mesh>
            {/* Vertical window bay mullions */}
            {[-8.8, -5.28, -1.76, 1.76, 5.28, 8.8].map((zOff) => (
              <mesh key={zOff} position={[0, 2.75, zOff]}>
                <boxGeometry args={[0.14, 5.3, 0.1]} />
                <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.35} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Soft sunlit window light-wash patches on the travertine floor */}
      {[-5.5, -2.0, 1.5].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[5.6, 0.003, z]}>
          <planeGeometry args={[3.4, 2.7]} />
          <meshBasicMaterial color="#fffbeb" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ))}

      {/* Clean minimalist ceiling canopy ribs with diffused architectural light strips */}
      {[-7.2, -3.6, 0, 3.6].map((z) => (
        <group key={z} position={[0, 5.55, z]}>
          <mesh>
            <boxGeometry args={[19.4, 0.18, 0.24]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[14.5, 0.03, 0.12]} />
            <meshStandardMaterial color="#ffffff" emissive="#fef9c3" emissiveIntensity={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Grassy Proving Ground ("outdoors")                                     */
/* -------------------------------------------------------------------------- */

const PINE_TREE_COUNT = 28;
const DECIDUOUS_TREE_COUNT = 18;
const MOTE_COUNT = 140;

interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tint: number;
}

function OutdoorsEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const flatRadius = bayScale > 1.2 ? 5.2 : 4.2;

  const terrainGeom = useMemo(
    () => createMeadowTerrainGeometry(plinthX, plinthZ, flatRadius),
    [plinthX, plinthZ, flatRadius],
  );
  const skyDomeGeom = useMemo(() => createSkyDomeGeometry(), []);
  const padTex = useMemo(() => createProvingPadTexture(), []);

  // Deterministic floating pollen / breeze motes geometry
  const { motesGeom, moteBasePositions, motePhases } = useMemo(() => {
    const positions = new Float32Array(MOTE_COUNT * 3);
    const basePositions = new Float32Array(MOTE_COUNT * 3);
    const phases = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const angle = hash2d(i, 1.3) * Math.PI * 2;
      const radius = 1.6 + hash2d(i, 2.7) * 14.5;
      const x = plinthX + Math.cos(angle) * radius;
      const y = 0.45 + hash2d(i, 4.1) * 4.2;
      const z = plinthZ + Math.sin(angle) * radius;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      basePositions[i * 3] = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = z;
      phases[i] = hash2d(i, 7.9) * Math.PI * 2;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { motesGeom: geom, moteBasePositions: basePositions, motePhases: phases };
  }, [plinthX, plinthZ]);

  useEffect(() => {
    return () => {
      terrainGeom.dispose();
      skyDomeGeom.dispose();
      padTex.dispose();
      motesGeom.dispose();
    };
  }, [terrainGeom, skyDomeGeom, padTex, motesGeom]);

  // Subtle gentle floating ambient pollen / breeze motes animation (zero allocations)
  useFrame((state) => {
    const attr = motesGeom.attributes["position"] as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const phase = motePhases[i] ?? 0;
      const bx = moteBasePositions[i * 3] ?? 0;
      const by = moteBasePositions[i * 3 + 1] ?? 1;
      const bz = moteBasePositions[i * 3 + 2] ?? 0;
      arr[i * 3] = bx + Math.sin(t * 0.35 + phase) * 0.55;
      arr[i * 3 + 1] = by + Math.sin(t * 0.55 + phase * 1.3) * 0.24;
      arr[i * 3 + 2] = bz + Math.cos(t * 0.28 + phase * 0.9) * 0.45;
    }
    attr.needsUpdate = true;
  });

  // Procedural distant ring of pine & deciduous treeline placements seated on terrain
  const { pines, deciduous } = useMemo(() => {
    const pineList: TreePlacement[] = [];
    for (let i = 0; i < PINE_TREE_COUNT; i++) {
      const angle = (i / PINE_TREE_COUNT) * Math.PI * 2 + (hash2d(i, 11.1) - 0.5) * 0.16;
      const dist = 21 + hash2d(i, 17.3) * 24;
      const x = plinthX + Math.cos(angle) * dist;
      const z = plinthZ + Math.sin(angle) * dist;
      const y = sampleMeadowHeight(x, z, plinthX, plinthZ, flatRadius);
      pineList.push({
        x,
        y,
        z,
        scale: 0.85 + hash2d(i, 23.5) * 0.95,
        yaw: hash2d(i, 29.7) * Math.PI * 2,
        tint: hash2d(i, 31.3),
      });
    }
    const decList: TreePlacement[] = [];
    for (let i = 0; i < DECIDUOUS_TREE_COUNT; i++) {
      const angle = ((i + 0.45) / DECIDUOUS_TREE_COUNT) * Math.PI * 2 + (hash2d(i, 41.2) - 0.5) * 0.2;
      const dist = 24 + hash2d(i, 47.8) * 22;
      const x = plinthX + Math.cos(angle) * dist;
      const z = plinthZ + Math.sin(angle) * dist;
      const y = sampleMeadowHeight(x, z, plinthX, plinthZ, flatRadius);
      decList.push({
        x,
        y,
        z,
        scale: 0.9 + hash2d(i, 53.1) * 0.85,
        yaw: hash2d(i, 59.4) * Math.PI * 2,
        tint: hash2d(i, 61.9),
      });
    }
    return { pines: pineList, deciduous: decList };
  }, [plinthX, plinthZ, flatRadius]);

  const pineTrunkRef = useRef<THREE.InstancedMesh | null>(null);
  const pineLowerRef = useRef<THREE.InstancedMesh | null>(null);
  const pineUpperRef = useRef<THREE.InstancedMesh | null>(null);
  const decTrunkRef = useRef<THREE.InstancedMesh | null>(null);
  const decCrownRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const pineDark = new THREE.Color("#264f33");
    const pineLight = new THREE.Color("#3a6e43");
    const decDark = new THREE.Color("#3c6e37");
    const decLight = new THREE.Color("#639644");

    const pTrunk = pineTrunkRef.current;
    const pLower = pineLowerRef.current;
    const pUpper = pineUpperRef.current;
    if (pTrunk && pLower && pUpper) {
      for (let i = 0; i < pines.length; i++) {
        const tree = pines[i];
        if (!tree) continue;
        const s = tree.scale;

        dummy.position.set(tree.x, tree.y + 0.75 * s, tree.z);
        dummy.rotation.set(0, tree.yaw, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        pTrunk.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 2.35 * s, tree.z);
        dummy.updateMatrix();
        pLower.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 3.85 * s, tree.z);
        dummy.scale.set(s * 0.72, s * 0.82, s * 0.72);
        dummy.updateMatrix();
        pUpper.setMatrixAt(i, dummy.matrix);

        color.copy(pineDark).lerp(pineLight, tree.tint);
        pLower.setColorAt(i, color);
        color.offsetHSL(0, 0.02, 0.04);
        pUpper.setColorAt(i, color);
      }
      pTrunk.instanceMatrix.needsUpdate = true;
      pLower.instanceMatrix.needsUpdate = true;
      pUpper.instanceMatrix.needsUpdate = true;
      if (pLower.instanceColor) pLower.instanceColor.needsUpdate = true;
      if (pUpper.instanceColor) pUpper.instanceColor.needsUpdate = true;
    }

    const dTrunk = decTrunkRef.current;
    const dCrown = decCrownRef.current;
    if (dTrunk && dCrown) {
      for (let i = 0; i < deciduous.length; i++) {
        const tree = deciduous[i];
        if (!tree) continue;
        const s = tree.scale;

        dummy.position.set(tree.x, tree.y + 0.9 * s, tree.z);
        dummy.rotation.set(0, tree.yaw, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        dTrunk.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 2.75 * s, tree.z);
        dummy.scale.set(s * 1.12, s * 0.96, s * 1.05);
        dummy.updateMatrix();
        dCrown.setMatrixAt(i, dummy.matrix);

        color.copy(decDark).lerp(decLight, tree.tint);
        dCrown.setColorAt(i, color);
      }
      dTrunk.instanceMatrix.needsUpdate = true;
      dCrown.instanceMatrix.needsUpdate = true;
      if (dCrown.instanceColor) dCrown.instanceColor.needsUpdate = true;
    }
  }, [pines, deciduous]);

  const padRadius = 2.45 * bayScale;

  return (
    <group name="rotunda-env-outdoors">
      <SceneBackdropSync background="#8ec5f8" fogColor="#cde6fa" fogNear={22} fogFar={82} transparent={false} />

      {/* Natural daylight sky + meadow bounce + directional sunlight */}
      <hemisphereLight args={["#93c5fd", "#4d7c3f", 0.88]} />
      <ambientLight intensity={0.32} color="#f0f9ff" />
      <directionalLight
        position={[24, 28, -22]}
        intensity={2.15}
        color="#fff8e3"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-14, 9, 16]} intensity={0.45} color="#bfdbfe" />

      {/* Procedural gradient sky dome */}
      <mesh geometry={skyDomeGeom} renderOrder={-10}>
        <meshBasicMaterial vertexColors side={THREE.BackSide} depthWrite={false} fog={false} />
      </mesh>

      {/* Sun disc & soft atmospheric solar halo */}
      <group position={[42, 49, -38]}>
        <mesh>
          <sphereGeometry args={[2.6, 20, 20]} />
          <meshBasicMaterial color="#fffbeb" fog={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[5.4, 20, 20]} />
          <meshBasicMaterial color="#fef08a" transparent opacity={0.22} depthWrite={false} fog={false} />
        </mesh>
      </group>

      {/* Rolling procedural meadow terrain (flat inside >=4m radius around rotunda) */}
      <mesh geometry={terrainGeom} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.94} metalness={0.02} />
      </mesh>

      {/* Circular stone/concrete proving test pad under plinth + workstation apron */}
      <group position={[plinthX, 0, plinthZ]}>
        <mesh position={[0, -0.02, 0]} receiveShadow>
          <cylinderGeometry args={[padRadius, padRadius + 0.16, 0.06, 64]} />
          <meshStandardMaterial map={padTex} roughness={0.86} metalness={0.04} />
        </mesh>
        {/* Chamfered outer stone curb ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
          <ringGeometry args={[padRadius - 0.12, padRadius, 64]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.8} />
        </mesh>
        {/* Subtle compass heading ring on the test pad */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.013, 0]}>
          <ringGeometry args={[padRadius * 0.74 - 0.025, padRadius * 0.74, 64]} />
          <meshStandardMaterial color="#475569" roughness={0.72} />
        </mesh>
      </group>

      {/* Stone walkway apron connecting the plinth pad to the 45-degree drafting podium */}
      <mesh position={[plinthX * 0.5, -0.022, plinthZ * 0.35]} receiveShadow>
        <boxGeometry args={[2.6, 0.05, Math.abs(plinthZ) + 1.8]} />
        <meshStandardMaterial map={padTex} roughness={0.88} metalness={0.03} />
      </mesh>

      {/* Stylized low-poly pine treeline silhouettes */}
      <instancedMesh ref={pineTrunkRef} args={[undefined, undefined, PINE_TREE_COUNT]}>
        <cylinderGeometry args={[0.14, 0.22, 1.5, 6]} />
        <meshStandardMaterial color="#5b4331" roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={pineLowerRef} args={[undefined, undefined, PINE_TREE_COUNT]}>
        <coneGeometry args={[1.35, 3.2, 7]} />
        <meshStandardMaterial color="#ffffff" roughness={0.88} flatShading />
      </instancedMesh>
      <instancedMesh ref={pineUpperRef} args={[undefined, undefined, PINE_TREE_COUNT]}>
        <coneGeometry args={[1.05, 2.5, 7]} />
        <meshStandardMaterial color="#ffffff" roughness={0.88} flatShading />
      </instancedMesh>

      {/* Stylized low-poly deciduous treeline silhouettes */}
      <instancedMesh ref={decTrunkRef} args={[undefined, undefined, DECIDUOUS_TREE_COUNT]}>
        <cylinderGeometry args={[0.15, 0.24, 1.8, 6]} />
        <meshStandardMaterial color="#664c38" roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={decCrownRef} args={[undefined, undefined, DECIDUOUS_TREE_COUNT]}>
        <icosahedronGeometry args={[1.48, 0]} />
        <meshStandardMaterial color="#ffffff" roughness={0.86} flatShading />
      </instancedMesh>

      {/* Gentle floating ambient pollen / breeze motes */}
      <points geometry={motesGeom}>
        <pointsMaterial color="#fefce8" size={0.048} sizeAttenuation transparent opacity={0.62} depthWrite={false} />
      </points>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Precision Dark Lab ("dark-lab")                                        */
/* -------------------------------------------------------------------------- */

const LAB_TICK_COUNT = 24;
const LAB_PYLON_COUNT = 8;

function DarkLabEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const ticksRef = useRef<THREE.InstancedMesh | null>(null);
  const innerRadius = 1.48 * bayScale;
  const midRadius = 1.92 * bayScale;
  const outerRadius = 2.55 * bayScale;

  useEffect(() => {
    const mesh = ticksRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const tickRadius = (innerRadius + midRadius) * 0.5;
    for (let i = 0; i < LAB_TICK_COUNT; i++) {
      const angle = (i / LAB_TICK_COUNT) * Math.PI * 2;
      const isCardinal = i % 6 === 0;
      dummy.position.set(plinthX + Math.cos(angle) * tickRadius, 0.006, plinthZ + Math.sin(angle) * tickRadius);
      dummy.rotation.set(-Math.PI / 2, 0, -angle);
      dummy.scale.set(isCardinal ? 1.75 : 1.0, isCardinal ? 1.4 : 1.0, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [plinthX, plinthZ, innerRadius, midRadius]);

  const pylons = useMemo(() => {
    const out: { x: number; z: number; yaw: number; accent: string }[] = [];
    for (let i = 0; i < LAB_PYLON_COUNT; i++) {
      const angle = (i / LAB_PYLON_COUNT) * Math.PI * 2 + Math.PI / 8;
      const r = 15.5;
      out.push({
        x: Math.cos(angle) * r,
        z: -2 + Math.sin(angle) * r,
        yaw: -angle + Math.PI / 2,
        accent: i % 2 === 0 ? "#38bdf8" : "#6366f1",
      });
    }
    return out;
  }, []);

  return (
    <group name="rotunda-env-dark-lab">
      <SceneBackdropSync background="#050914" fogColor="#050914" fogNear={15} fogFar={44} transparent={false} />

      {/* Precision studio key + cyan (#38bdf8) & indigo (#6366f1) rim lights */}
      <hemisphereLight args={["#1e293b", "#020617", 0.45]} />
      <ambientLight intensity={0.4} color="#e2e8f0" />
      <directionalLight
        position={[5, 11, 7]}
        intensity={1.38}
        color="#f8fafc"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-8, 5.2, -6]} intensity={0.98} color="#38bdf8" />
      <directionalLight position={[8, 4.8, -8]} intensity={0.88} color="#6366f1" />
      <pointLight position={[plinthX, 0.55, plinthZ]} intensity={0.65} distance={7} color="#06b6d4" />

      {/* Obsidian matte floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]} receiveShadow>
        <planeGeometry args={[64, 64]} />
        <meshStandardMaterial color="#050914" roughness={0.9} metalness={0.14} />
      </mesh>

      {/* Illuminated 10 cm / 1 m cyan & slate metrology grid */}
      <Grid
        position={[0, 0.001, 0]}
        args={[32, 32]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={1.0}
        sectionThickness={1.2}
        sectionColor="#0891b2"
        fadeDistance={26}
        fadeStrength={1.65}
        infiniteGrid
      />

      {/* Glowing radial telemetry floor rings around the central plinth */}
      <group position={[plinthX, 0.005, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[innerRadius - 0.025, innerRadius, 72]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.72} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[midRadius - 0.022, midRadius, 72]} />
          <meshBasicMaterial color="#6366f1" transparent opacity={0.58} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[outerRadius - 0.016, outerRadius, 72]} />
          <meshBasicMaterial color="#0891b2" transparent opacity={0.34} depthWrite={false} />
        </mesh>
        {/* Subtle cardinal metrology crosshair axes */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <planeGeometry args={[outerRadius * 2.1, 0.014]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.001, 0]}>
          <planeGeometry args={[outerRadius * 2.1, 0.014]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      </group>

      {/* 24 graduated radial metrology tick marks */}
      <instancedMesh ref={ticksRef} args={[undefined, undefined, LAB_TICK_COUNT]}>
        <planeGeometry args={[0.12, 0.022]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.62} depthWrite={false} />
      </instancedMesh>

      {/* Subtle far-perimeter architectural orientation pylons */}
      {pylons.map((p, idx) => (
        <group key={idx} position={[p.x, 2.4, p.z]} rotation={[0, p.yaw, 0]}>
          <mesh>
            <boxGeometry args={[0.28, 4.8, 0.22]} />
            <meshStandardMaterial color="#0b1222" roughness={0.75} metalness={0.35} />
          </mesh>
          <mesh position={[0, 0, 0.12]}>
            <boxGeometry args={[0.04, 3.6, 0.02]} />
            <meshBasicMaterial color={p.accent} transparent opacity={0.45} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Mixed Reality Passthrough ("passthrough")                              */
/* -------------------------------------------------------------------------- */

function PassthroughEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const outerRadius = 1.68 * bayScale;
  const innerRadius = 1.44 * bayScale;

  return (
    <group name="rotunda-env-passthrough">
      <SceneBackdropSync background={null} transparent={true} />
      {/* Grounded studio key + fill lighting for real-world AR passthrough */}
      <hemisphereLight args={["#f8fafc", "#475569", 0.82]} />
      <ambientLight intensity={0.5} color="#ffffff" />
      <directionalLight position={[6, 10, 6]} intensity={1.48} color="#ffffff" castShadow />
      <directionalLight position={[-6, 6, -5]} intensity={0.65} color="#bae6fd" />

      {/* Minimalist translucent floor anchor ring around the central plinth */}
      <group position={[plinthX, 0.003, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[outerRadius - 0.032, outerRadius, 64]} />
          <meshBasicMaterial color="#a855f7" transparent opacity={0.34} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[innerRadius - 0.016, innerRadius, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.42} depthWrite={false} />
        </mesh>
        {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((angle, idx) => (
          <mesh
            key={idx}
            rotation={[-Math.PI / 2, 0, -angle]}
            position={[
              Math.cos(angle) * ((innerRadius + outerRadius) * 0.5),
              0.001,
              Math.sin(angle) * ((innerRadius + outerRadius) * 0.5),
            ]}
          >
            <planeGeometry args={[0.18, 0.028]} />
            <meshBasicMaterial color="#c084fc" transparent opacity={0.52} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Public RotundaEnvironment Component                                       */
/* -------------------------------------------------------------------------- */

/**
 * Renders the active procedural 3D environment for the Engineering Rotunda VR Mode
 * with zero external asset dependencies and full GPU resource disposal on switch/unmount.
 */
export function RotundaEnvironment({ environment, plinthCenter, scaleMode }: RotundaEnvironmentProps): ReactElement {
  const plinthX = plinthCenter[0];
  const plinthZ = plinthCenter[2];
  const bayScale = scaleMode === "real-scale" ? 1.45 : 1.0;

  switch (environment) {
    case "warehouse":
      return <WarehouseEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
    case "office":
      return <OfficeEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
    case "outdoors":
      return <OutdoorsEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
    case "dark-lab":
      return <DarkLabEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
    case "passthrough":
      return <PassthroughEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
  }
}
