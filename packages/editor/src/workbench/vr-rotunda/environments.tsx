// SPDX-License-Identifier: AGPL-3.0-or-later

import { Grid } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import {
  createArchitecturalWoodPbr,
  createBrushedAluminumPbr,
  createDarkBasaltPbr,
  createHonedTravertinePbr,
  createMeadowGrassPbr,
  createPolishedConcretePbr,
  createProvingPadStonePbr,
  createRadialContactShadowTexture,
  createRotundaEnvironmentHdri,
} from "./procedural-pbr.js";
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
      return { background: "#cfd9e6", isLight: true };
    case "office":
      return { background: "#e8eef5", isLight: true };
    case "outdoors":
      return { background: "#8ec5f8", isLight: true };
    case "dark-lab":
      return { background: "#050914", isLight: false };
    case "passthrough":
      return { background: null, isLight: false };
  }
}

interface SceneBackdropSyncProps {
  environment: RotundaEnvironmentId;
  background: string | null;
  fogColor?: string | undefined;
  fogNear?: number | undefined;
  fogFar?: number | undefined;
  transparent: boolean;
  exposure?: number | undefined;
  useSkyDome?: boolean | undefined;
}

/**
 * Synchronizes `THREE.Scene.background`, `THREE.Scene.fog`, WebGL clear color/alpha,
 * ACESFilmic exposure, and environment-matched procedural equirectangular HDRI PMREM IBL
 * (`scene.environment`) directly onto the root scene — zero per-frame stereo cost on Quest 2.
 */
function SceneBackdropAndHdriSync({
  environment,
  background,
  fogColor,
  fogNear,
  fogFar,
  transparent,
  exposure = 1.04,
  useSkyDome = false,
}: SceneBackdropSyncProps): ReactElement | null {
  const { gl, scene } = useThree();

  const hdri = useMemo(() => createRotundaEnvironmentHdri(gl, environment), [gl, environment]);

  useEffect(() => {
    return () => {
      hdri.dispose();
    };
  }, [hdri]);

  useEffect(() => {
    const prevBackground = scene.background;
    const prevFog = scene.fog;
    const prevEnv = scene.environment;
    const prevExposure = gl.toneMappingExposure;
    const prevClearColor = new THREE.Color();
    gl.getClearColor(prevClearColor);
    const prevClearAlpha = gl.getClearAlpha();

    gl.toneMappingExposure = exposure;
    if (hdri.envMap) {
      scene.environment = hdri.envMap;
    }

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
      scene.environment = prevEnv;
      gl.toneMappingExposure = prevExposure;
      gl.setClearColor(prevClearColor, prevClearAlpha);
      gl.setClearAlpha(prevClearAlpha);
    };
  }, [gl, scene, hdri, background, fogColor, fogNear, fogFar, transparent, exposure]);

  if (!useSkyDome || transparent) {
    return null;
  }

  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[94, 48, 28]} />
      <meshBasicMaterial map={hdri.skyTexture} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Deterministic Terrain & Utility Helpers (Offline / SSR Safe)              */
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

/** Crisp industrial safety yellow (`#eab308`) & clean slate hazard stripe texture for factory floor bays. */
function createHazardStripeTexture(repeatX: number, repeatY: number): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const band = (x + y) % 32 < 16;
      const micro = (hash2d(x, y) - 0.5) * 6;
      if (band) {
        data[idx] = Math.max(0, Math.min(255, Math.round(224 + micro)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(170 + micro)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(24 + micro)));
      } else {
        data[idx] = Math.max(0, Math.min(255, Math.round(46 + micro)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(58 + micro)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(74 + micro)));
      }
      data[idx + 3] = 255;
    }
  }
  return configureRepeatTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), repeatX, repeatY);
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

  const blend = smoothstep(flatRadius, flatRadius + 10.5, dClear);
  const rolling =
    Math.sin(x * 0.048 + 0.35) * Math.cos(z * 0.042 - 0.25) * 2.4 +
    Math.sin(x * 0.095 - z * 0.082 + 1.1) * 0.95 +
    Math.cos((x + z) * 0.028) * 1.35 +
    0.55;

  // Gentle distant bowl rise toward horizon for scenic framing
  const horizonRise = smoothstep(28, 72, dClear) * 3.8;
  const hillHeight = Math.max(-0.3, rolling) + horizonRise;
  return -0.025 + hillHeight * blend;
}

/**
 * Builds vertex-displaced rolling alpine meadow terrain with subtle photometric elevation tinting
 * meant to multiply cleanly with `createMeadowGrassPbr` (avoiding neon plastic greens).
 */
function createMeadowTerrainGeometry(plinthX: number, plinthZ: number, flatRadius: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(164, 164, 72, 72);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes["position"];
  if (!pos) return geom;

  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const valleyTint = new THREE.Color("#dbe5d0");
  const meadowTint = new THREE.Color("#f4f6ea");
  const sunlitSlope = new THREE.Color("#fffbe6");
  const scratch = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = sampleMeadowHeight(x, z, plinthX, plinthZ, flatRadius);
    pos.setY(i, y);

    const patchNoise = 0.5 + 0.5 * Math.sin(x * 0.09 + 0.7) * Math.cos(z * 0.11 - 0.4);
    const elevationFactor = smoothstep(0.15, 4.2, y);

    scratch.copy(valleyTint);
    scratch.lerp(meadowTint, 0.45 + patchNoise * 0.45);
    scratch.lerp(sunlitSlope, elevationFactor * 0.45);

    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  pos.needsUpdate = true;
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

/* -------------------------------------------------------------------------- */
/*  1. Photorealistic Modern Aerospace Factory / Robotics Hangar ("warehouse")*/
/* -------------------------------------------------------------------------- */

const WAREHOUSE_BAY_Z = [-18, -10, -2, 6] as const;

interface SubEnvProps {
  plinthX: number;
  plinthZ: number;
  bayScale: number;
}

function WarehouseEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const concretePbr = useMemo(() => createPolishedConcretePbr(16, 16, 256), []);
  const steelPbr = useMemo(() => createBrushedAluminumPbr(2, 6, "#8e9baa", 128), []);
  const columnShadowTex = useMemo(() => createRadialContactShadowTexture(0.36, 0.14, 64), []);
  const hazardTexLong = useMemo(() => createHazardStripeTexture(22, 1), []);
  const hazardTexShort = useMemo(() => createHazardStripeTexture(18, 1), []);

  useEffect(() => {
    return () => {
      concretePbr.dispose();
      steelPbr.dispose();
      columnShadowTex.dispose();
      hazardTexLong.dispose();
      hazardTexShort.dispose();
    };
  }, [concretePbr, steelPbr, columnShadowTex, hazardTexLong, hazardTexShort]);

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
      <SceneBackdropAndHdriSync
        environment="warehouse"
        background="#cfd9e6"
        fogColor="#cfd9e6"
        fogNear={22}
        fogFar={66}
        transparent={false}
        exposure={1.04}
      />

      {/* High-bay architectural daylight key + skylight fill */}
      <hemisphereLight args={["#f1f5f9", "#94a3b8", 1.15]} />
      <directionalLight position={[10, 14, 7]} intensity={1.55} color="#fff7ed" />
      <directionalLight position={[-10, 9, -8]} intensity={0.62} color="#dbeafe" />

      {/* Polished architectural factory concrete floor (albedo + normal + roughness specular map) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -4]}>
        <planeGeometry args={[68, 68]} />
        <meshStandardMaterial
          map={concretePbr.map}
          normalMap={concretePbr.normalMap}
          normalScale={new THREE.Vector2(0.45, 0.45)}
          roughnessMap={concretePbr.roughnessMap}
          roughness={1.0}
          metalness={0.08}
          envMapIntensity={0.85}
        />
      </mesh>

      {/* Painted industrial safety yellow & steel-blue circular assembly bay ring */}
      <group position={[plinthX, 0.004, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringRadiusOuter - 0.095, ringRadiusOuter, 64]} />
          <meshStandardMaterial color="#d99f18" roughness={0.44} metalness={0.05} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[ringRadiusInner - 0.05, ringRadiusInner, 64]} />
          <meshStandardMaterial color="#0369a1" roughness={0.38} metalness={0.1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
          <circleGeometry args={[ringRadiusInner - 0.055, 64]} />
          <meshStandardMaterial
            map={concretePbr.map}
            normalMap={concretePbr.normalMap}
            normalScale={new THREE.Vector2(0.35, 0.35)}
            roughnessMap={concretePbr.roughnessMap}
            color="#c6d0dc"
            roughness={0.82}
            metalness={0.12}
          />
        </mesh>
      </group>

      {/* 12 painted industrial yellow alignment ticks */}
      <instancedMesh ref={ringTicksRef} args={[undefined, undefined, 12]}>
        <planeGeometry args={[0.18, 0.044]} />
        <meshStandardMaterial color="#d99f18" roughness={0.46} />
      </instancedMesh>

      {/* Striped safety yellow/slate hazard floor bay borders + steel-blue walkway guide lines */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, bayMinZ]}>
        <planeGeometry args={[bayHalfW * 2 + 0.22, 0.22]} />
        <meshStandardMaterial map={hazardTexShort} roughness={0.48} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, bayMaxZ]}>
        <planeGeometry args={[bayHalfW * 2 + 0.22, 0.22]} />
        <meshStandardMaterial map={hazardTexShort} roughness={0.48} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-bayHalfW, 0.005, bayCenterZ]}>
        <planeGeometry args={[bayDepth, 0.22]} />
        <meshStandardMaterial map={hazardTexLong} roughness={0.48} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[bayHalfW, 0.005, bayCenterZ]}>
        <planeGeometry args={[bayDepth, 0.22]} />
        <meshStandardMaterial map={hazardTexLong} roughness={0.48} />
      </mesh>
      {[-bayHalfW - 0.48, bayHalfW + 0.48].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, bayCenterZ - 1.5]}>
          <planeGeometry args={[0.09, bayDepth + 6.5]} />
          <meshStandardMaterial color="#0369a1" roughness={0.42} />
        </mesh>
      ))}

      {/* Structural steel flanged I-beam columns, bolted base plates, floor AO & overhead trusses */}
      {WAREHOUSE_BAY_Z.map((z) => (
        <group key={z} position={[0, 0, z]}>
          {[-11.2, 11.2].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              {/* Baked floor contact shadow under column base plate */}
              <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.92, 20]} />
                <meshBasicMaterial map={columnShadowTex} transparent depthWrite={false} />
              </mesh>
              {/* Bolted steel floor anchor plate */}
              <mesh position={[0, 0.025, 0]}>
                <boxGeometry args={[0.74, 0.05, 0.74]} />
                <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.34} />
              </mesh>
              {/* Structural steel I-beam web + twin flanges */}
              <mesh position={[0, 4.4, 0]}>
                <boxGeometry args={[0.14, 8.8, 0.44]} />
                <meshStandardMaterial
                  map={steelPbr.map}
                  normalMap={steelPbr.normalMap}
                  roughnessMap={steelPbr.roughnessMap}
                  metalness={0.68}
                  roughness={0.85}
                />
              </mesh>
              <mesh position={[-0.2, 4.4, 0]}>
                <boxGeometry args={[0.08, 8.8, 0.48]} />
                <meshStandardMaterial
                  map={steelPbr.map}
                  normalMap={steelPbr.normalMap}
                  roughnessMap={steelPbr.roughnessMap}
                  metalness={0.72}
                  roughness={0.8}
                />
              </mesh>
              <mesh position={[0.2, 4.4, 0]}>
                <boxGeometry args={[0.08, 8.8, 0.48]} />
                <meshStandardMaterial
                  map={steelPbr.map}
                  normalMap={steelPbr.normalMap}
                  roughnessMap={steelPbr.roughnessMap}
                  metalness={0.72}
                  roughness={0.8}
                />
              </mesh>
              {/* Powder-coated industrial safety base guard */}
              <mesh position={[0, 0.56, 0]}>
                <boxGeometry args={[0.56, 1.04, 0.56]} />
                <meshStandardMaterial color="#d99f18" metalness={0.18} roughness={0.38} />
              </mesh>
            </group>
          ))}
          {/* Brushed steel truss bottom & top chords */}
          <mesh position={[0, 7.6, 0]}>
            <boxGeometry args={[22.8, 0.24, 0.26]} />
            <meshStandardMaterial
              map={steelPbr.map}
              normalMap={steelPbr.normalMap}
              roughnessMap={steelPbr.roughnessMap}
              metalness={0.62}
              roughness={0.8}
            />
          </mesh>
          <mesh position={[0, 8.7, 0]}>
            <boxGeometry args={[22.8, 0.24, 0.26]} />
            <meshStandardMaterial color="#8e9baa" metalness={0.64} roughness={0.38} />
          </mesh>
        </group>
      ))}

      {/* Instanced light steel diagonal truss web bracing */}
      <instancedMesh ref={strutsRef} args={[undefined, undefined, strutsCount]}>
        <boxGeometry args={[0.1, 1.38, 0.14]} />
        <meshStandardMaterial color="#b4c0ce" metalness={0.58} roughness={0.36} />
      </instancedMesh>

      {/* Longitudinal overhead roof purlins */}
      {[-11.2, -5.6, 0, 5.6, 11.2].map((x) => (
        <mesh key={x} position={[x, 8.88, -6]}>
          <boxGeometry args={[0.2, 0.2, 28]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.48} roughness={0.4} />
        </mesh>
      ))}

      {/* Diffused architectural daylight LED high-bay luminaires */}
      {[-14, -6, 2].map((z) => (
        <group key={z} position={[0, 8.52, z]}>
          {[-4.2, 4.2].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 0.06, 0]}>
                <boxGeometry args={[5.6, 0.09, 0.88]} />
                <meshStandardMaterial color="#64748b" metalness={0.74} roughness={0.3} />
              </mesh>
              <mesh>
                <boxGeometry args={[5.36, 0.05, 0.72]} />
                <meshBasicMaterial color="#ffffff" toneMapped={false} fog={false} />
              </mesh>
            </group>
          ))}
        </group>
      ))}

      {/* Architectural hangar side walls with mullioned sunlit clerestory glazing */}
      {[-11.6, 11.6].map((x) => {
        const inwardSign = x < 0 ? 1 : -1;
        return (
          <group key={x} position={[x, 0, -6]}>
            <mesh position={[0, 2.35, 0]}>
              <boxGeometry args={[0.22, 4.7, 32]} />
              <meshStandardMaterial
                map={concretePbr.map}
                normalMap={concretePbr.normalMap}
                normalScale={new THREE.Vector2(0.25, 0.25)}
                color="#dde4ee"
                roughness={0.68}
                metalness={0.08}
              />
            </mesh>
            <mesh position={[inwardSign * 0.13, 1.25, 0]}>
              <boxGeometry args={[0.04, 0.18, 31.6]} />
              <meshStandardMaterial color="#0369a1" roughness={0.4} metalness={0.12} />
            </mesh>
            <mesh position={[inwardSign * 0.13, 1.08, 0]}>
              <boxGeometry args={[0.04, 0.08, 31.6]} />
              <meshStandardMaterial color="#d99f18" roughness={0.42} metalness={0.1} />
            </mesh>
            <mesh position={[inwardSign * 0.04, 5.95, 0]} rotation={[0, inwardSign * (Math.PI / 2), 0]}>
              <planeGeometry args={[30.8, 2.35]} />
              <meshBasicMaterial color="#fffbeb" toneMapped={false} fog={false} />
            </mesh>
            <mesh position={[inwardSign * 0.08, 4.76, 0]}>
              <boxGeometry args={[0.16, 0.14, 31.6]} />
              <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
            </mesh>
            <mesh position={[inwardSign * 0.08, 7.16, 0]}>
              <boxGeometry args={[0.16, 0.14, 31.6]} />
              <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
            </mesh>
          </group>
        );
      })}

      {/* Rear architectural hangar bulkhead */}
      <group position={[0, 0, -23.5]}>
        <mesh position={[0, 2.4, 0]}>
          <boxGeometry args={[24, 4.8, 0.36]} />
          <meshStandardMaterial color="#dce3ed" roughness={0.68} metalness={0.08} />
        </mesh>
        <mesh position={[0, 8.1, 0]}>
          <boxGeometry args={[24, 2.0, 0.36]} />
          <meshStandardMaterial color="#dce3ed" roughness={0.68} metalness={0.08} />
        </mesh>
        <mesh position={[0, 5.95, 0.12]}>
          <planeGeometry args={[22.4, 2.3]} />
          <meshBasicMaterial color="#fffbeb" toneMapped={false} fog={false} />
        </mesh>
        <mesh position={[0, 1.32, 0.21]}>
          <boxGeometry args={[23.2, 0.2, 0.04]} />
          <meshStandardMaterial color="#0369a1" roughness={0.4} metalness={0.12} />
        </mesh>
        <mesh position={[0, 1.12, 0.21]}>
          <boxGeometry args={[23.2, 0.1, 0.04]} />
          <meshStandardMaterial color="#d99f18" roughness={0.42} metalness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Photorealistic Architectural Design Studio ("office")                  */
/* -------------------------------------------------------------------------- */

const LOUVER_COUNT = 32;

function OfficeEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const travertinePbr = useMemo(() => createHonedTravertinePbr(16, 16, 256), []);
  const oakPbr = useMemo(() => createArchitecturalWoodPbr(1, 3, 128), []);
  const mullionPbr = useMemo(() => createBrushedAluminumPbr(1, 4, "#5a6675", 128), []);

  useEffect(() => {
    return () => {
      travertinePbr.dispose();
      oakPbr.dispose();
      mullionPbr.dispose();
    };
  }, [travertinePbr, oakPbr, mullionPbr]);

  const louversRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const mesh = louversRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const toneA = new THREE.Color("#f6e7d4");
    const toneB = new THREE.Color("#e0c4a0");
    const color = new THREE.Color();
    const arcRadius = 9.0;
    const arcCenterZ = -1.8;

    for (let i = 0; i < LOUVER_COUNT; i++) {
      const frac = i / (LOUVER_COUNT - 1);
      const theta = -1.08 + frac * 2.16;
      const x = Math.sin(theta) * arcRadius;
      const z = arcCenterZ - Math.cos(theta) * arcRadius;

      dummy.position.set(x, 2.7, z);
      dummy.rotation.set(0, -theta + 0.16, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const grainMix = 0.5 + 0.5 * Math.sin(i * 1.9);
      color.copy(toneA).lerp(toneB, grainMix * 0.45);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  const inlayRadius = 1.82 * bayScale;

  return (
    <group name="rotunda-env-office">
      <SceneBackdropAndHdriSync
        environment="office"
        background="#e8eef5"
        fogColor="#e8eef5"
        fogNear={18}
        fogFar={52}
        transparent={false}
        exposure={1.04}
      />

      {/* Airy architectural daylight studio key + cool sky window fill */}
      <hemisphereLight args={["#ffffff", "#d9d0c1", 1.1]} />
      <directionalLight position={[11, 12, 6]} intensity={1.5} color="#fff8eb" />
      <directionalLight position={[-8, 8, -6]} intensity={0.62} color="#dbeafe" />

      {/* Honed warm travertine stone floor with real veining normal + specular roughness maps */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -3]}>
        <planeGeometry args={[56, 56]} />
        <meshStandardMaterial
          map={travertinePbr.map}
          normalMap={travertinePbr.normalMap}
          normalScale={new THREE.Vector2(0.42, 0.42)}
          roughnessMap={travertinePbr.roughnessMap}
          roughness={1.0}
          metalness={0.04}
          envMapIntensity={0.85}
        />
      </mesh>

      {/* Recessed brushed architectural brass & satin steel circular floor inlay */}
      <group position={[plinthX, 0.004, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[inlayRadius - 0.042, inlayRadius, 64]} />
          <meshStandardMaterial color="#c8a86b" metalness={0.86} roughness={0.26} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[inlayRadius * 0.72 - 0.018, inlayRadius * 0.72, 64]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.3} />
        </mesh>
      </group>

      {/* Smooth matte architectural Venetian plaster curved wall + natural oiled white-oak louvers */}
      <mesh position={[0, 2.7, -1.8]}>
        <cylinderGeometry args={[9.32, 9.32, 5.4, 48, 1, true, Math.PI - 1.15, 2.3]} />
        <meshStandardMaterial color="#e2e6ec" roughness={0.84} metalness={0.02} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 5.45, -1.8]}>
        <cylinderGeometry args={[9.4, 9.4, 0.35, 48, 1, true, Math.PI - 1.18, 2.36]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.72} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={louversRef} args={[undefined, undefined, LOUVER_COUNT]}>
        <boxGeometry args={[0.11, 5.1, 0.24]} />
        <meshStandardMaterial
          map={oakPbr.map}
          normalMap={oakPbr.normalMap}
          normalScale={new THREE.Vector2(0.35, 0.35)}
          roughnessMap={oakPbr.roughnessMap}
          color="#ffffff"
          roughness={1.0}
          metalness={0.03}
        />
      </instancedMesh>

      {/* Floor-to-ceiling daylight glass curtain walls with satin brushed anodized mullions */}
      {[-9.6, 9.6].map((x) => {
        const inwardSign = x < 0 ? 1 : -1;
        return (
          <group key={x} position={[x, 0, -2.5]}>
            <mesh position={[0, 2.8, 0]} rotation={[0, inwardSign * (Math.PI / 2), 0]}>
              <planeGeometry args={[17.6, 5.1]} />
              <meshBasicMaterial color="#eef6ff" transparent opacity={0.88} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.14, 0]}>
              <boxGeometry args={[0.16, 0.28, 18.0]} />
              <meshStandardMaterial
                map={mullionPbr.map}
                normalMap={mullionPbr.normalMap}
                roughnessMap={mullionPbr.roughnessMap}
                metalness={0.78}
                roughness={0.82}
              />
            </mesh>
            <mesh position={[0, 5.38, 0]}>
              <boxGeometry args={[0.18, 0.24, 18.0]} />
              <meshStandardMaterial
                map={mullionPbr.map}
                normalMap={mullionPbr.normalMap}
                roughnessMap={mullionPbr.roughnessMap}
                metalness={0.78}
                roughness={0.82}
              />
            </mesh>
            {[-8.8, -5.28, -1.76, 1.76, 5.28, 8.8].map((zOff) => (
              <mesh key={zOff} position={[0, 2.75, zOff]}>
                <boxGeometry args={[0.14, 5.3, 0.09]} />
                <meshStandardMaterial
                  map={mullionPbr.map}
                  normalMap={mullionPbr.normalMap}
                  roughnessMap={mullionPbr.roughnessMap}
                  metalness={0.78}
                  roughness={0.8}
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Soft sunlit window light-wash patches on the honed stone floor */}
      {[-5.5, -2.0, 1.5].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[5.6, 0.003, z]}>
          <planeGeometry args={[3.4, 2.7]} />
          <meshBasicMaterial color="#fffbeb" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ))}

      {/* Minimalist ceiling baffles with linear diffused daylight coves */}
      {[-7.2, -3.6, 0, 3.6].map((z) => (
        <group key={z} position={[0, 5.55, z]}>
          <mesh>
            <boxGeometry args={[19.4, 0.18, 0.24]} />
            <meshStandardMaterial color="#f4f6f9" roughness={0.62} metalness={0.06} />
          </mesh>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[14.5, 0.03, 0.12]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Photorealistic Sunlit Proving Ground & Meadow ("outdoors")             */
/* -------------------------------------------------------------------------- */

const MOTE_COUNT = 48;

function OutdoorsEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const flatRadius = bayScale > 1.2 ? 5.2 : 4.2;

  const terrainGeom = useMemo(
    () => createMeadowTerrainGeometry(plinthX, plinthZ, flatRadius),
    [plinthX, plinthZ, flatRadius],
  );
  const grassPbr = useMemo(() => createMeadowGrassPbr(38, 38, 256), []);
  const padStonePbr = useMemo(() => createProvingPadStonePbr(4, 4, 256), []);
  const curbMetalPbr = useMemo(() => createBrushedAluminumPbr(8, 1, "#c4ceda", 128), []);

  // Subtle sunlit atmospheric dust / breeze motes
  const { motesGeom, moteBasePositions, motePhases } = useMemo(() => {
    const positions = new Float32Array(MOTE_COUNT * 3);
    const basePositions = new Float32Array(MOTE_COUNT * 3);
    const phases = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const angle = hash2d(i, 1.3) * Math.PI * 2;
      const radius = 2.2 + hash2d(i, 2.7) * 14.0;
      const x = plinthX + Math.cos(angle) * radius;
      const y = 0.55 + hash2d(i, 4.1) * 4.0;
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
      grassPbr.dispose();
      padStonePbr.dispose();
      curbMetalPbr.dispose();
      motesGeom.dispose();
    };
  }, [terrainGeom, grassPbr, padStonePbr, curbMetalPbr, motesGeom]);

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
      arr[i * 3] = bx + Math.sin(t * 0.32 + phase) * 0.45;
      arr[i * 3 + 1] = by + Math.sin(t * 0.48 + phase * 1.3) * 0.18;
      arr[i * 3 + 2] = bz + Math.cos(t * 0.25 + phase * 0.9) * 0.38;
    }
    attr.needsUpdate = true;
  });

  const padRadius = 2.48 * bayScale;

  return (
    <group name="rotunda-env-outdoors">
      <SceneBackdropAndHdriSync
        environment="outdoors"
        background="#8ec5f8"
        fogColor="#cfe2f2"
        fogNear={22}
        fogFar={88}
        transparent={false}
        exposure={1.0}
        useSkyDome={true}
      />

      {/* Physically balanced outdoor daylight key sun + natural sky/turf bounce hemisphere */}
      <hemisphereLight args={["#cbe4ff", "#6a7d52", 0.95]} />
      <directionalLight position={[26, 28, -28]} intensity={1.75} color="#fff6e0" />
      <directionalLight position={[-14, 10, 16]} intensity={0.44} color="#c7dffe" />

      {/* Natural rolling alpine meadow terrain with normal + roughness PBR turf maps */}
      <mesh geometry={terrainGeom}>
        <meshStandardMaterial
          map={grassPbr.map}
          normalMap={grassPbr.normalMap}
          normalScale={new THREE.Vector2(0.85, 0.85)}
          roughnessMap={grassPbr.roughnessMap}
          vertexColors
          roughness={1.0}
          metalness={0.01}
          envMapIntensity={0.55}
        />
      </mesh>

      {/* Architectural broom-finished precast stone proving pad with chamfered anodized rim */}
      <group position={[plinthX, 0, plinthZ]}>
        <mesh position={[0, -0.022, 0]}>
          <cylinderGeometry args={[padRadius, padRadius + 0.14, 0.064, 64]} />
          <meshStandardMaterial
            map={padStonePbr.map}
            normalMap={padStonePbr.normalMap}
            normalScale={new THREE.Vector2(0.55, 0.55)}
            roughnessMap={padStonePbr.roughnessMap}
            roughness={1.0}
            metalness={0.04}
          />
        </mesh>
        {/* Brushed stainless architectural perimeter drainage trim */}
        <mesh position={[0, 0.008, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[padRadius - 0.02, 0.018, 12, 64]} />
          <meshStandardMaterial
            map={curbMetalPbr.map}
            normalMap={curbMetalPbr.normalMap}
            roughnessMap={curbMetalPbr.roughnessMap}
            metalness={0.82}
            roughness={0.85}
          />
        </mesh>
        {/* Subtle inset anodized slate compass ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[padRadius * 0.74 - 0.022, padRadius * 0.74, 64]} />
          <meshStandardMaterial color="#475569" metalness={0.68} roughness={0.34} />
        </mesh>
      </group>

      {/* Broom-finished precast concrete walkway apron under drafting podium */}
      <mesh position={[plinthX * 0.5, -0.024, plinthZ * 0.35]}>
        <boxGeometry args={[2.6, 0.052, Math.abs(plinthZ) + 1.8]} />
        <meshStandardMaterial
          map={padStonePbr.map}
          normalMap={padStonePbr.normalMap}
          normalScale={new THREE.Vector2(0.5, 0.5)}
          roughnessMap={padStonePbr.roughnessMap}
          roughness={1.0}
          metalness={0.04}
        />
      </mesh>

      {/* Subtle sunlit floating breeze motes */}
      <points geometry={motesGeom}>
        <pointsMaterial color="#fffbeb" size={0.036} sizeAttenuation transparent opacity={0.45} depthWrite={false} />
      </points>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Photorealistic KeyShot Precision Dark Metrology Lab ("dark-lab")       */
/* -------------------------------------------------------------------------- */

const LAB_TICK_COUNT = 24;
const LAB_PYLON_COUNT = 8;

function DarkLabEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const basaltPbr = useMemo(() => createDarkBasaltPbr(16, 16, 256), []);
  const titaniumPbr = useMemo(() => createBrushedAluminumPbr(1, 4, "#243044", 128), []);

  useEffect(() => {
    return () => {
      basaltPbr.dispose();
      titaniumPbr.dispose();
    };
  }, [basaltPbr, titaniumPbr]);

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
      <SceneBackdropAndHdriSync
        environment="dark-lab"
        background="#050914"
        fogColor="#050914"
        fogNear={15}
        fogFar={46}
        transparent={false}
        exposure={1.1}
      />

      {/* Precision KeyShot dark-studio key + cyan/indigo architectural rim lights */}
      <hemisphereLight args={["#1e293b", "#020617", 0.48]} />
      <directionalLight position={[5, 11, 7]} intensity={1.65} color="#f8fafc" />
      <directionalLight position={[-8, 5.2, -6]} intensity={1.05} color="#38bdf8" />
      <directionalLight position={[8, 4.8, -8]} intensity={0.92} color="#6366f1" />
      <pointLight position={[plinthX, 0.55, plinthZ]} intensity={0.6} distance={7} color="#06b6d4" />

      {/* Honed obsidian basalt metrology floor (catches crisp studio softbox reflections) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
        <planeGeometry args={[64, 64]} />
        <meshStandardMaterial
          map={basaltPbr.map}
          normalMap={basaltPbr.normalMap}
          normalScale={new THREE.Vector2(0.35, 0.35)}
          roughnessMap={basaltPbr.roughnessMap}
          roughness={1.0}
          metalness={0.22}
          envMapIntensity={1.15}
        />
      </mesh>

      {/* Overhead KeyShot linear studio softboxes (matching HDRI specular reflections) */}
      {[-3.2, 0, 3.2].map((x) => (
        <group key={x} position={[x, 6.4, -2.1]}>
          <mesh position={[0, 0.08, 0]}>
            <boxGeometry args={[0.92, 0.1, 6.4]} />
            <meshStandardMaterial color="#0f172a" metalness={0.78} roughness={0.32} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.78, 0.04, 6.1]} />
            <meshBasicMaterial color="#e2f1ff" toneMapped={false} />
          </mesh>
        </group>
      ))}

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
          <ringGeometry args={[innerRadius - 0.022, innerRadius, 72]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[midRadius - 0.02, midRadius, 72]} />
          <meshBasicMaterial color="#6366f1" transparent opacity={0.58} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[outerRadius - 0.014, outerRadius, 72]} />
          <meshBasicMaterial color="#0891b2" transparent opacity={0.34} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <planeGeometry args={[outerRadius * 2.1, 0.014]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.001, 0]}>
          <planeGeometry args={[outerRadius * 2.1, 0.014]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>

      {/* 24 graduated radial metrology tick marks */}
      <instancedMesh ref={ticksRef} args={[undefined, undefined, LAB_TICK_COUNT]}>
        <planeGeometry args={[0.12, 0.02]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.62} depthWrite={false} toneMapped={false} />
      </instancedMesh>

      {/* Far-perimeter brushed-titanium orientation pylons */}
      {pylons.map((p, idx) => (
        <group key={idx} position={[p.x, 2.4, p.z]} rotation={[0, p.yaw, 0]}>
          <mesh>
            <boxGeometry args={[0.3, 4.8, 0.24]} />
            <meshStandardMaterial
              map={titaniumPbr.map}
              normalMap={titaniumPbr.normalMap}
              roughnessMap={titaniumPbr.roughnessMap}
              metalness={0.78}
              roughness={0.85}
            />
          </mesh>
          <mesh position={[0, 0, 0.13]}>
            <boxGeometry args={[0.036, 3.6, 0.02]} />
            <meshBasicMaterial color={p.accent} transparent opacity={0.55} toneMapped={false} />
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
      <SceneBackdropAndHdriSync environment="passthrough" background={null} transparent={true} exposure={1.0} />
      {/* Grounded studio key + fill lighting for real-world AR passthrough */}
      <hemisphereLight args={["#f8fafc", "#475569", 0.92]} />
      <directionalLight position={[6, 10, 6]} intensity={1.55} color="#ffffff" />
      <directionalLight position={[-6, 6, -5]} intensity={0.65} color="#bae6fd" />

      {/* Minimalist translucent floor anchor ring around the central plinth */}
      <group position={[plinthX, 0.003, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[outerRadius - 0.032, outerRadius, 64]} />
          <meshBasicMaterial color="#a855f7" transparent opacity={0.34} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[innerRadius - 0.016, innerRadius, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.42} depthWrite={false} toneMapped={false} />
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
            <meshBasicMaterial color="#c084fc" transparent opacity={0.52} depthWrite={false} toneMapped={false} />
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
 * Renders the active photorealistic procedural PBR 3D environment + matched equirectangular
 * HDRI/PMREM IBL for the Engineering Rotunda VR Mode with zero external asset dependencies
 * and full GPU resource disposal on switch/unmount.
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
