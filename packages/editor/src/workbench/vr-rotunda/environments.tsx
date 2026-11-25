// SPDX-License-Identifier: AGPL-3.0-or-later

import { ContactShadows, Environment, Grid, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
import { getRotundaEnvironmentExposure, type RotundaEnvironmentId, type RotundaScaleMode } from "./types.js";

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
    case "atrium":
      return { background: "#eef2f6", isLight: true };
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
  /** Explicit exposure override; defaults to the environment's tuned `toneMappingExposure` metadata. */
  exposure?: number | undefined;
  useSkyDome?: boolean | undefined;
  /**
   * When `false`, skips the procedural equirect HDRI and leaves `scene.environment` untouched
   * (used by environments that bake their own drei `<Environment>` Lightformer cube map).
   */
  applyHdri?: boolean | undefined;
}

/**
 * Synchronizes `THREE.Scene.background`, `THREE.Scene.fog`, WebGL clear color/alpha,
 * per-environment tone-mapping exposure, and environment-matched procedural equirectangular HDRI PMREM IBL
 * (`scene.environment`) directly onto the root scene — zero per-frame stereo cost on Quest 2.
 */
function SceneBackdropAndHdriSync({
  environment,
  background,
  fogColor,
  fogNear,
  fogFar,
  transparent,
  exposure: exposureOverride,
  useSkyDome = false,
  applyHdri = true,
}: SceneBackdropSyncProps): ReactElement | null {
  const { gl, scene } = useThree();
  const exposure = exposureOverride ?? getRotundaEnvironmentExposure(environment);

  const hdri = useMemo(
    () => (applyHdri ? createRotundaEnvironmentHdri(gl, environment) : null),
    [gl, environment, applyHdri],
  );

  useEffect(() => {
    return () => {
      hdri?.dispose();
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
    if (hdri?.envMap) {
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
      if (hdri) {
        scene.environment = prevEnv;
      }
      gl.toneMappingExposure = prevExposure;
      gl.setClearColor(prevClearColor, prevClearAlpha);
      gl.setClearAlpha(prevClearAlpha);
    };
  }, [gl, scene, hdri, background, fogColor, fogNear, fogFar, transparent, exposure]);

  if (!useSkyDome || transparent || !hdri) {
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
      <SceneBackdropAndHdriSync environment="passthrough" background={null} transparent={true} />
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
/*  0. Future Atrium ("atrium") — bright clean-future hero environment         */
/* -------------------------------------------------------------------------- */

/** Radius (m) of the glazing plane of the circular atrium hall. */
const ATRIUM_RADIUS = 16;
/** Inner wall face radius (fins, skirting & header are flush with this). */
const ATRIUM_WALL_R = ATRIUM_RADIUS - 0.7;
/** Hall center Z (fixed so the architecture never rebuilds when the plinth moves). */
const ATRIUM_CENTER_Z = -3.2;
const ATRIUM_SKIRT_H = 0.9;
const ATRIUM_GLAZING_TOP = 7.6;
const ATRIUM_HEADER_TOP = 9.4;
const ATRIUM_OCULUS_R = 5.6;
const ATRIUM_OCULUS_Y = 12.2;
const ATRIUM_FIN_COUNT = 48;
const ATRIUM_SPOKE_COUNT = 6;
const ATRIUM_DASH_COUNT = 72;
const ATRIUM_ACCENT = "#38bdf8";
/** Render layer seen only by the one-shot XR floor reflection probe (architecture only, no hero model). */
const ATRIUM_PROBE_LAYER = 7;

function valueNoise2d(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2d(xi, yi);
  const b = hash2d(xi + 1, yi);
  const c = hash2d(xi, yi + 1);
  const d = hash2d(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

interface AtriumFloorTextures {
  map: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  dispose(): void;
}

/**
 * Polished white epoxy floor maps for a disc (`CircleGeometry` planar UVs): soft macro mottling,
 * two faint concentric inlay seams, and a baked ambient-occlusion falloff at the wall junction.
 */
function createAtriumFloorTextures(size = 512): AtriumFloorTextures {
  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const seamRadii = [0.36, 0.62, 0.86];
  const seamHalfWidth = 1.4 / size;
  for (let y = 0; y < size; y++) {
    const py = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1;
      const r = Math.hypot(px, py);
      const mottle = valueNoise2d(px * 5 + 11, py * 5 - 7) * 0.6 + valueNoise2d(px * 21 + 3, py * 21 + 5) * 0.4 - 0.5;
      const ao = 1 - 0.24 * smoothstep(0.9, 1.0, r);
      let seam = 0;
      for (const sr of seamRadii) {
        const d = Math.abs(r - sr);
        if (d < seamHalfWidth * 2) seam = Math.max(seam, 1 - d / (seamHalfWidth * 2));
      }
      const shade = ao * (1 + mottle * 0.03) * (1 - seam * 0.07);
      const idx = (y * size + x) * 4;
      albedo[idx] = clampByte(236 * shade);
      albedo[idx + 1] = clampByte(239 * shade);
      albedo[idx + 2] = clampByte(243 * shade);
      albedo[idx + 3] = 255;
      const roughVal = clampByte((0.2 + mottle * 0.1 + seam * 0.3) * 255);
      rough[idx] = roughVal;
      rough[idx + 1] = roughVal;
      rough[idx + 2] = roughVal;
      rough[idx + 3] = 255;
    }
  }
  const finish = (tex: THREE.DataTexture, srgb: boolean): THREE.DataTexture => {
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  };
  const map = finish(new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat), true);
  const roughnessMap = finish(new THREE.DataTexture(rough, size, size, THREE.RGBAFormat), false);
  return {
    map,
    roughnessMap,
    dispose() {
      map.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * 4×128 vertical gradient DataTexture (row 0 = UV v=0). Used as a baked AO multiplier on walls/ceiling
 * junctions and as alpha ramps for holographic / light-shaft effects.
 */
function createAtriumVerticalRamp(
  stops: readonly (readonly [t: number, value: number])[],
  srgb: boolean,
  tint: readonly [number, number, number] = [1, 1, 1],
): THREE.DataTexture {
  const w = 4;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = (y + 0.5) / h;
    let value = stops[stops.length - 1]?.[1] ?? 1;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (a && b && t >= a[0] && t <= b[0]) {
        const k = smoothstep(a[0], b[0], t);
        value = a[1] + (b[1] - a[1]) * k;
        break;
      }
    }
    if (stops[0] && t < stops[0][0]) value = stops[0][1];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = clampByte(value * tint[0] * 255);
      data[idx + 1] = clampByte(value * tint[1] * 255);
      data[idx + 2] = clampByte(value * tint[2] * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Exterior seen through the tall glazing: luminous horizon haze, pale-blue sky and a distant,
 * atmospherically faded futuristic skyline (wraps seamlessly around the cylinder).
 */
function createAtriumGlazingTexture(width = 512, height = 128): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const horizon = 0.13;
  const towerCount = 96;
  for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width;
    const seg = Math.floor(u * towerCount);
    const segU = u * towerCount - seg;
    const hTower = hash2d(seg, 17.3);
    const isTower = hTower > 0.32;
    const towerTop = horizon + 0.012 + (isTower ? Math.pow(hTower, 3) * 0.26 : 0.018);
    // Slim spires / setbacks for a future skyline silhouette
    const spire = isTower && hTower > 0.86 && Math.abs(segU - 0.5) < 0.08 ? 0.06 : 0;
    const inset = isTower && (segU < 0.12 || segU > 0.88) ? 0.03 : 0;
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height;
      let r: number;
      let g: number;
      let b: number;
      if (v < horizon) {
        // Distant plaza / landscape haze
        const k = v / horizon;
        r = 0.84 + k * 0.08;
        g = 0.87 + k * 0.07;
        b = 0.9 + k * 0.06;
      } else {
        const k = Math.pow((v - horizon) / (1 - horizon), 0.7);
        r = 0.98 - k * 0.2;
        g = 0.99 - k * 0.12;
        b = 1.0 - k * 0.04;
      }
      if (v >= horizon && v < towerTop - inset + spire) {
        const fade = 0.55 + 0.45 * ((v - horizon) / 0.3);
        r = r * fade + 0.8 * (1 - fade);
        g = g * fade + 0.85 * (1 - fade);
        b = b * fade + 0.92 * (1 - fade);
      }
      const idx = (y * width + x) * 4;
      data[idx] = clampByte(r * 255);
      data[idx + 1] = clampByte(g * 255);
      data[idx + 2] = clampByte(b * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function atriumHorizontalTorus(radius: number, y: number, tube: number, segments = 192): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 6, segments);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, ATRIUM_CENTER_Z);
  return g;
}

function atriumFlatRing(inner: number, outer: number, y: number, facingUp: boolean): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, 192, 1);
  g.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, ATRIUM_CENTER_Z);
  return g;
}

function mergeOrEmpty(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.BufferGeometry();
}

interface AtriumGeometries {
  skirt: THREE.BufferGeometry;
  header: THREE.BufferGeometry;
  whiteTrim: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  glazing: THREE.BufferGeometry;
  transoms: THREE.BufferGeometry;
  coves: THREE.BufferGeometry;
  shaft: THREE.BufferGeometry;
  dispose(): void;
}

/** Builds (and merges) all static atrium architecture into a handful of draw calls. */
function createAtriumGeometries(): AtriumGeometries {
  const skirt = new THREE.CylinderGeometry(ATRIUM_WALL_R, ATRIUM_WALL_R, ATRIUM_SKIRT_H, 192, 1, true);
  skirt.translate(0, ATRIUM_SKIRT_H / 2, ATRIUM_CENTER_Z);

  const headerH = ATRIUM_HEADER_TOP - ATRIUM_GLAZING_TOP;
  const header = new THREE.CylinderGeometry(ATRIUM_WALL_R, ATRIUM_WALL_R, headerH, 192, 1, true);
  header.translate(0, ATRIUM_GLAZING_TOP + headerH / 2, ATRIUM_CENTER_Z);

  // Window sill + soffit + oculus rim + central oculus hub (single white trim draw call)
  const hub = new THREE.CylinderGeometry(0.55, 0.55, 0.22, 48, 1, false);
  hub.translate(0, ATRIUM_OCULUS_Y + 0.25, ATRIUM_CENTER_Z);
  const whiteTrim = mergeOrEmpty([
    atriumFlatRing(ATRIUM_WALL_R, ATRIUM_RADIUS + 0.05, ATRIUM_SKIRT_H, true),
    atriumFlatRing(ATRIUM_WALL_R, ATRIUM_RADIUS + 0.05, ATRIUM_GLAZING_TOP, false),
    atriumHorizontalTorus(ATRIUM_OCULUS_R, ATRIUM_OCULUS_Y, 0.16, 128),
    hub,
  ]);

  // Curved cove ceiling rising from the header into the glass oculus
  const pts: THREE.Vector2[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const radius = ATRIUM_WALL_R + (ATRIUM_OCULUS_R - ATRIUM_WALL_R) * t;
    const y = ATRIUM_HEADER_TOP + (ATRIUM_OCULUS_Y - ATRIUM_HEADER_TOP) * Math.sin((t * Math.PI) / 2);
    pts.push(new THREE.Vector2(radius, y));
  }
  const ceiling = new THREE.LatheGeometry(pts, 192);
  ceiling.translate(0, 0, ATRIUM_CENTER_Z);

  const glazingH = ATRIUM_GLAZING_TOP - ATRIUM_SKIRT_H;
  const glazing = new THREE.CylinderGeometry(ATRIUM_RADIUS + 0.06, ATRIUM_RADIUS + 0.06, glazingH, 192, 1, true);
  glazing.translate(0, ATRIUM_SKIRT_H + glazingH / 2, ATRIUM_CENTER_Z);

  const transoms = mergeOrEmpty([
    atriumHorizontalTorus(ATRIUM_RADIUS - 0.02, 3.4, 0.028),
    atriumHorizontalTorus(ATRIUM_RADIUS - 0.02, 5.9, 0.028),
  ]);

  // Thin cool-accent LED cove lines (single unlit draw call)
  const coves = mergeOrEmpty([
    atriumFlatRing(ATRIUM_WALL_R - 0.11, ATRIUM_WALL_R - 0.07, 0.004, true),
    atriumHorizontalTorus(ATRIUM_WALL_R - 0.02, ATRIUM_SKIRT_H + 0.012, 0.012),
    atriumHorizontalTorus(ATRIUM_WALL_R - 0.02, ATRIUM_GLAZING_TOP - 0.012, 0.012),
    atriumHorizontalTorus(ATRIUM_WALL_R - 0.06, ATRIUM_HEADER_TOP + 0.05, 0.014),
    atriumHorizontalTorus(ATRIUM_OCULUS_R - 0.2, ATRIUM_OCULUS_Y - 0.12, 0.02, 128),
  ]);

  // Soft volumetric daylight shaft under the oculus (desktop only)
  const shaft = new THREE.CylinderGeometry(
    ATRIUM_OCULUS_R * 0.97,
    ATRIUM_OCULUS_R * 1.18,
    ATRIUM_OCULUS_Y,
    64,
    1,
    true,
  );
  shaft.translate(0, ATRIUM_OCULUS_Y / 2, ATRIUM_CENTER_Z);

  return {
    skirt,
    header,
    whiteTrim,
    ceiling,
    glazing,
    transoms,
    coves,
    shaft,
    dispose() {
      skirt.dispose();
      header.dispose();
      whiteTrim.dispose();
      ceiling.dispose();
      glazing.dispose();
      transoms.dispose();
      coves.dispose();
      shaft.dispose();
    },
  };
}

/**
 * Enables renderer shadow maps (soft PCF) only while the atrium is mounted on desktop.
 * WebXR keeps shadow maps off (Quest 3 @ 90 Hz budget).
 */
function AtriumShadowMapController({ enabled }: { enabled: boolean }): null {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const prevEnabled = gl.shadowMap.enabled;
    const prevType = gl.shadowMap.type;
    gl.shadowMap.enabled = enabled;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.enabled = prevEnabled;
      gl.shadowMap.type = prevType;
      gl.shadowMap.needsUpdate = true;
    };
  }, [gl, enabled]);
  return null;
}

/**
 * Matched high-dynamic-range IBL baked ONCE (frames=1) into a 256² cube map from emissive
 * Lightformers that mirror the room: oculus disc, glazing bays, epoxy floor bounce, cyan cove ring.
 */
const AtriumLightformerEnvironment = memo(function AtriumLightformerEnvironment(): ReactElement {
  const glazingBays = useMemo(() => {
    const out: { key: number; position: [number, number, number] }[] = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      out.push({ key: i, position: [Math.cos(a) * 10, 3.6, Math.sin(a) * 10] });
    }
    return out;
  }, []);

  const coveRingColor = useMemo(() => new THREE.Color(ATRIUM_ACCENT).multiplyScalar(2.2), []);

  return (
    <Environment frames={1} resolution={256} background={false}>
      <color attach="background" args={["#d9e0e8"]} />
      {/* Glass oculus daylight disc overhead */}
      <Lightformer form="circle" intensity={3.2} color="#ffffff" position={[0, 9, 0]} scale={9} />
      {/* Tall glazing bays between fins (bright, slightly cool daylight) */}
      {glazingBays.map((bay) => (
        <Lightformer
          key={bay.key}
          form="rect"
          intensity={1.7}
          color="#f4f8ff"
          position={bay.position}
          scale={[3.4, 5.4, 1]}
          target={[0, 3.6, 0]}
        />
      ))}
      {/* Polished white epoxy floor bounce */}
      <Lightformer
        form="rect"
        intensity={0.85}
        color="#eef1f5"
        position={[0, -2.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[34, 34, 1]}
      />
      {/* Thin cool-accent LED cove ring (gives models a subtle cyan horizon line) */}
      <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[12.6, 13, 128]} />
        <meshBasicMaterial color={coveRingColor} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </Environment>
  );
});

interface AtriumFloorProps {
  floorTex: AtriumFloorTextures;
}

/** Desktop: drei `MeshReflectorMaterial` (512² blurred planar reflection) + soft shadow receiving. */
function AtriumReflectorFloor({ floorTex }: AtriumFloorProps): ReactElement {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ATRIUM_CENTER_Z]} receiveShadow>
      <circleGeometry args={[ATRIUM_WALL_R, 160]} />
      <MeshReflectorMaterial
        map={floorTex.map}
        roughnessMap={floorTex.roughnessMap}
        color="#ffffff"
        roughness={0.55}
        metalness={0}
        envMapIntensity={0.9}
        resolution={512}
        blur={[360, 120]}
        mixBlur={1.1}
        mixStrength={0.75}
        mixContrast={1.0}
        mirror={0.32}
        depthScale={0.8}
        minDepthThreshold={0.35}
        maxDepthThreshold={1.25}
        depthToBlurRatioBias={0.3}
        reflectorOffset={0.001}
      />
    </mesh>
  );
}

/** WebXR (Quest 2/3): lightweight epoxy floor reflecting scene HDRI IBL with zero offscreen CubeCamera passes. */
function AtriumProbeFloor({ floorTex }: AtriumFloorProps): ReactElement {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ATRIUM_CENTER_Z]}>
      <circleGeometry args={[ATRIUM_WALL_R, 64]} />
      <meshStandardMaterial
        map={floorTex.map}
        roughnessMap={floorTex.roughnessMap}
        color="#ffffff"
        envMapIntensity={0.9}
        roughness={0.58}
        metalness={0.08}
      />
    </mesh>
  );
}

interface AtriumPlinthFxProps {
  plinthX: number;
  plinthZ: number;
  bayScale: number;
  isInXr: boolean;
}

/**
 * Periodically re-baked contact shadow under the plinth on desktop; in WebXR, unmounts
 * `<ContactShadows>` completely (no offscreen render target) and uses a single static radial AO decal.
 */
function AtriumContactShadow({ plinthX, plinthZ, bayScale, isInXr }: AtriumPlinthFxProps): ReactElement {
  const [bakeTick, setBakeTick] = useState(0);
  const decalTex = useMemo(() => createRadialContactShadowTexture(0.34, 0.16, 128), []);

  useEffect(() => {
    return () => {
      decalTex.dispose();
    };
  }, [decalTex]);

  useEffect(() => {
    if (isInXr) return;
    const id = window.setInterval(() => setBakeTick((t) => (t + 1) % 1_000_000), 1000);
    return () => window.clearInterval(id);
  }, [isInXr]);

  // Keep the shadow square strictly inside the holographic ring so it never captures the light curtain.
  const holoR = 3.2 * (bayScale > 1.2 ? 1.2 : 1);
  const size = holoR * 1.38;

  if (isInXr) {
    return (
      <mesh position={[plinthX, 0.005, plinthZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[size * 0.5, 40]} />
        <meshBasicMaterial map={decalTex} transparent depthWrite={false} />
      </mesh>
    );
  }

  return (
    <ContactShadows
      position={[plinthX, 0.006, plinthZ]}
      scale={size}
      resolution={512}
      blur={2.6}
      far={4.2}
      opacity={0.52}
      color="#1e293b"
      frames={1}
      userData={{ bakeTick }}
    />
  );
}

/** Subtle holographic rings + rotating dash ring + faint light curtain around the plinth (radius ≥ 3 m clear). */
function AtriumHoloRings({ plinthX, plinthZ, bayScale }: Omit<AtriumPlinthFxProps, "isInXr">): ReactElement {
  const holoR = 3.2 * (bayScale > 1.2 ? 1.2 : 1);
  const dashesRef = useRef<THREE.InstancedMesh | null>(null);
  const spinRef = useRef<THREE.Group | null>(null);
  const curtainAlpha = useMemo(
    () =>
      createAtriumVerticalRamp(
        [
          [0, 1],
          [0.15, 0.7],
          [1, 0],
        ],
        false,
      ),
    [],
  );

  useEffect(() => {
    return () => {
      curtainAlpha.dispose();
    };
  }, [curtainAlpha]);

  useLayoutEffect(() => {
    const mesh = dashesRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const dashR = holoR + 0.18;
    for (let i = 0; i < ATRIUM_DASH_COUNT; i++) {
      const angle = (i / ATRIUM_DASH_COUNT) * Math.PI * 2;
      const cardinal = i % (ATRIUM_DASH_COUNT / 4) === 0;
      dummy.position.set(Math.cos(angle) * dashR, 0, Math.sin(angle) * dashR);
      dummy.rotation.set(-Math.PI / 2, 0, -angle + Math.PI / 2);
      dummy.scale.set(cardinal ? 2.2 : 1, cardinal ? 1.6 : 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [holoR]);

  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * 0.045;
  });

  return (
    <group position={[plinthX, 0, plinthZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[holoR - 0.02, holoR, 160]} />
        <meshBasicMaterial color={ATRIUM_ACCENT} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[holoR + 0.34, holoR + 0.35, 160]} />
        <meshBasicMaterial color={ATRIUM_ACCENT} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={spinRef} position={[0, 0.006, 0]}>
        <instancedMesh ref={dashesRef} args={[undefined, undefined, ATRIUM_DASH_COUNT]} frustumCulled={false}>
          <planeGeometry args={[0.14, 0.02]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      </group>
      {/* Faint holographic light curtain rising off the inlay ring */}
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[holoR, holoR, 0.34, 160, 1, true]} />
        <meshBasicMaterial
          color={ATRIUM_ACCENT}
          alphaMap={curtainAlpha}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
          fog={false}
        />
      </mesh>
    </group>
  );
}

function AtriumEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const isInXr = useXR((s) => s.session != null);
  const geoms = useMemo(() => createAtriumGeometries(), []);
  const floorTex = useMemo(() => createAtriumFloorTextures(512), []);
  const glazingTex = useMemo(() => createAtriumGlazingTexture(), []);
  const skirtAo = useMemo(
    () =>
      createAtriumVerticalRamp(
        [
          [0, 0.74],
          [0.45, 0.94],
          [1, 1],
        ],
        true,
      ),
    [],
  );
  const headerAo = useMemo(
    () =>
      createAtriumVerticalRamp(
        [
          [0, 1],
          [0.7, 0.95],
          [1, 0.8],
        ],
        true,
      ),
    [],
  );
  const ceilingAo = useMemo(
    () =>
      createAtriumVerticalRamp(
        [
          [0, 0.78],
          [0.12, 0.93],
          [0.9, 1],
          [1, 0.92],
        ],
        true,
      ),
    [],
  );
  const shaftAlpha = useMemo(
    () =>
      createAtriumVerticalRamp(
        [
          [0, 0.0],
          [0.35, 0.35],
          [1, 1],
        ],
        false,
      ),
    [],
  );
  const glazingColor = useMemo(() => new THREE.Color(1.3, 1.3, 1.3), []);
  const oculusSkyColor = useMemo(() => new THREE.Color(1.55, 1.62, 1.75), []);

  useEffect(() => {
    return () => {
      geoms.dispose();
      floorTex.dispose();
      glazingTex.dispose();
      skirtAo.dispose();
      headerAo.dispose();
      ceilingAo.dispose();
      shaftAlpha.dispose();
    };
  }, [geoms, floorTex, glazingTex, skirtAo, headerAo, ceilingAo, shaftAlpha]);

  // Instanced vertical glazing fins (1 draw call)
  const finsRef = useRef<THREE.InstancedMesh | null>(null);
  useLayoutEffect(() => {
    const mesh = finsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const finR = ATRIUM_RADIUS - 0.35;
    const finY = (ATRIUM_SKIRT_H + ATRIUM_GLAZING_TOP) / 2;
    for (let i = 0; i < ATRIUM_FIN_COUNT; i++) {
      const a = (i / ATRIUM_FIN_COUNT) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * finR, finY, ATRIUM_CENTER_Z + Math.sin(a) * finR);
      dummy.rotation.set(0, Math.PI / 2 - a, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  // Instanced radial oculus mullion spokes (1 draw call)
  const spokesRef = useRef<THREE.InstancedMesh | null>(null);
  useLayoutEffect(() => {
    const mesh = spokesRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < ATRIUM_SPOKE_COUNT; i++) {
      dummy.position.set(0, ATRIUM_OCULUS_Y + 0.22, ATRIUM_CENTER_Z);
      dummy.rotation.set(0, (i / ATRIUM_SPOKE_COUNT) * Math.PI, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  // Architecture is also visible to the one-shot XR reflection probe layer
  const archRef = useRef<THREE.Group | null>(null);
  useLayoutEffect(() => {
    archRef.current?.traverse((obj) => obj.layers.enable(ATRIUM_PROBE_LAYER));
  }, []);

  // Oculus key light (target must live in the scene graph so its matrixWorld updates)
  const keyTarget = useMemo(() => new THREE.Object3D(), []);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  useLayoutEffect(() => {
    const light = keyLightRef.current;
    if (!light) return;
    const cam = light.shadow.camera;
    cam.left = -17;
    cam.right = 17;
    cam.top = 17;
    cam.bottom = -17;
    cam.near = 1;
    cam.far = 70;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }, [isInXr]);

  return (
    <group name="rotunda-env-atrium">
      <SceneBackdropAndHdriSync environment="atrium" background="#eef2f6" transparent={false} applyHdri={isInXr} />
      {!isInXr && <AtriumLightformerEnvironment />}
      <AtriumShadowMapController enabled={!isInXr} />

      {/* Soft sky fill (most ambient comes from the baked Lightformer IBL) */}
      <hemisphereLight args={["#f8fbff", "#dde3ea", 0.3]} />
      {/* Strong soft daylight key through the oculus: casts a sun pool via the ceiling on desktop */}
      <primitive object={keyTarget} position={[-0.6, 0, ATRIUM_CENTER_Z - 1.0]} />
      <directionalLight
        ref={keyLightRef}
        target={keyTarget}
        position={[1.4, 30, ATRIUM_CENTER_Z + 1.4]}
        intensity={isInXr ? 1.05 : 1.7}
        color="#fff8ee"
        castShadow={!isInXr}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-radius={4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />

      {/* Polished white epoxy floor */}
      {isInXr ? <AtriumProbeFloor floorTex={floorTex} /> : <AtriumReflectorFloor floorTex={floorTex} />}

      <group ref={archRef}>
        {/* Skirting wall with baked floor-junction AO */}
        <mesh geometry={geoms.skirt}>
          <meshStandardMaterial map={skirtAo} color="#f3f5f8" roughness={0.5} metalness={0} side={THREE.BackSide} />
        </mesh>
        {/* Header band with baked ceiling-junction AO */}
        <mesh geometry={geoms.header}>
          <meshStandardMaterial map={headerAo} color="#f3f5f8" roughness={0.55} metalness={0} side={THREE.BackSide} />
        </mesh>
        {/* Sill, soffit, oculus rim & hub */}
        <mesh geometry={geoms.whiteTrim} castShadow={!isInXr}>
          <meshStandardMaterial color="#f6f8fa" roughness={0.32} metalness={0} side={THREE.DoubleSide} />
        </mesh>
        {/* Curved cove ceiling rising into the oculus (casts the oculus sun pool) */}
        <mesh geometry={geoms.ceiling} castShadow={!isInXr}>
          <meshStandardMaterial
            map={ceilingAo}
            color="#f4f6f9"
            roughness={0.75}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Exterior daylight + distant skyline through the tall glazing */}
        <mesh geometry={geoms.glazing}>
          <meshBasicMaterial map={glazingTex} color={glazingColor} side={THREE.BackSide} fog={false} />
        </mesh>
        {/* 48 tall vertical white fins */}
        <instancedMesh ref={finsRef} args={[undefined, undefined, ATRIUM_FIN_COUNT]} frustumCulled={false}>
          <boxGeometry args={[0.14, ATRIUM_GLAZING_TOP - ATRIUM_SKIRT_H, 0.7]} />
          <meshStandardMaterial color="#f1f4f7" roughness={0.38} metalness={0} />
        </instancedMesh>
        {/* Satin aluminium glazing transoms */}
        <mesh geometry={geoms.transoms}>
          <meshStandardMaterial color="#cfd6de" roughness={0.3} metalness={0.85} />
        </mesh>
        {/* Glass oculus sky */}
        <mesh position={[0, ATRIUM_OCULUS_Y + 0.36, ATRIUM_CENTER_Z]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[ATRIUM_OCULUS_R + 0.1, 96]} />
          <meshBasicMaterial color={oculusSkyColor} fog={false} />
        </mesh>
        <instancedMesh ref={spokesRef} args={[undefined, undefined, ATRIUM_SPOKE_COUNT]} frustumCulled={false}>
          <boxGeometry args={[0.09, 0.14, ATRIUM_OCULUS_R * 2]} />
          <meshStandardMaterial color="#e8edf2" roughness={0.35} metalness={0.2} />
        </instancedMesh>
        {/* Cool-accent LED cove lines */}
        <mesh geometry={geoms.coves}>
          <meshBasicMaterial color={ATRIUM_ACCENT} toneMapped={false} fog={false} />
        </mesh>
      </group>

      {/* Soft volumetric daylight shaft (desktop only — no transparent overdraw in XR) */}
      {!isInXr && (
        <mesh geometry={geoms.shaft} renderOrder={2}>
          <meshBasicMaterial
            color="#ffffff"
            alphaMap={shaftAlpha}
            transparent
            opacity={0.05}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            fog={false}
          />
        </mesh>
      )}

      <AtriumContactShadow plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} isInXr={isInXr} />
      <AtriumHoloRings plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />
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
export const RotundaEnvironment = memo(
  function RotundaEnvironment({ environment, plinthCenter, scaleMode }: RotundaEnvironmentProps): ReactElement {
    const plinthX = plinthCenter[0];
    const plinthZ = plinthCenter[2];
    const bayScale = scaleMode === "real-scale" ? 1.45 : 1.0;

    switch (environment) {
      case "atrium":
        return <AtriumEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
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
  },
  (prev, next) =>
    prev.environment === next.environment &&
    prev.scaleMode === next.scaleMode &&
    prev.plinthCenter[0] === next.plinthCenter[0] &&
    prev.plinthCenter[1] === next.plinthCenter[1] &&
    prev.plinthCenter[2] === next.plinthCenter[2],
);
