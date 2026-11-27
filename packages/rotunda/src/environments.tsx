// SPDX-License-Identifier: AGPL-3.0-or-later

import { Environment, Grid, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import {
  AtriumEnvironmentProps,
  DarkLabEnvironmentProps,
  OfficeEnvironmentProps,
  OutdoorsEnvironmentProps,
  WarehouseEnvironmentProps,
} from "./environment-props.js";
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
  exposure?: number | undefined;
  useSkyDome?: boolean | undefined;
  applyHdri?: boolean | undefined;
}

/**
 * Synchronizes `THREE.Scene.background`, `THREE.Scene.fog`, WebGL clear color/alpha,
 * per-environment tone-mapping exposure, and environment-matched procedural equirectangular HDRI PMREM IBL
 * (`scene.environment`) directly onto the root scene — zero per-frame stereo cost on Quest 2/3.
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
    () => (applyHdri || useSkyDome ? createRotundaEnvironmentHdri(applyHdri ? gl : null, environment) : null),
    [gl, environment, applyHdri, useSkyDome],
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
    if (applyHdri && hdri?.envMap) {
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
      if (applyHdri && hdri) {
        scene.environment = prevEnv;
      }
      gl.toneMappingExposure = prevExposure;
      gl.setClearColor(prevClearColor, prevClearAlpha);
      gl.setClearAlpha(prevClearAlpha);
    };
  }, [gl, scene, hdri, applyHdri, background, fogColor, fogNear, fogFar, transparent, exposure]);

  if (!useSkyDome || transparent || !hdri) {
    return null;
  }

  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[168, 48, 28]} />
      <meshBasicMaterial map={hdri.skyTexture} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Deterministic Terrain & Utility Helpers (Offline / SSR Safe)              */
/* -------------------------------------------------------------------------- */

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates lakeside park elevation at world `(x, z)`.
 *  - Broad, flat manicured park plateau (`y = -0.02`) across `flatRadius` (~30m) so the lawn feels spacious and calm.
 *  - Smooth sandy/pebble shoreline sloping into a tranquil alpine lake basin (`x > 11m`).
 *  - Gentle distant park hills pushed well out toward the horizon (`34..95m`).
 */
function sampleLakesideParkHeight(x: number, z: number, plinthX: number, plinthZ: number, flatRadius: number): number {
  // Carve tranquil lake basin on the east/forward-east vista (`x > 10.5`, `z` in `[-64, 24]`)
  const lakeBandZ = 1 - smoothstep(16, 30, z) - (1 - smoothstep(-74, -56, z));
  const lakeShoreBlend = smoothstep(9.2, 16.5, x) * Math.max(0, Math.min(1, lakeBandZ));
  if (lakeShoreBlend > 0.001) {
    const lakeBed = -0.78 - smoothstep(16, 36, x) * 0.45;
    const baseFlat = -0.02;
    return baseFlat + (lakeBed - baseFlat) * lakeShoreBlend;
  }

  const dClear = Math.min(Math.hypot(x - plinthX, z - plinthZ), Math.hypot(x, z));
  if (dClear <= flatRadius) {
    return -0.02;
  }

  const blend = smoothstep(flatRadius, flatRadius + 24.0, dClear);
  const gentleKnolls =
    Math.sin(x * 0.032 + 0.4) * Math.cos(z * 0.028 - 0.2) * 1.35 + Math.cos((x - z) * 0.022) * 0.85 + 0.45;
  const horizonRise = smoothstep(46, 98, dClear) * 4.6;
  return -0.02 + (Math.max(0, gentleKnolls) + horizonRise) * blend;
}

/**
 * Builds expansive lakeside park terrain with sunlit grass, shoreline sand-pebble transition,
 * and distant hillside tinting.
 */
function createLakesideParkTerrainGeometry(plinthX: number, plinthZ: number, flatRadius: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(210, 210, 72, 72);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes["position"];
  if (!pos) return geom;

  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const lawnBase = new THREE.Color("#e4eedb");
  const sunlitLawn = new THREE.Color("#f3f7e6");
  const shoreSand = new THREE.Color("#dfd5c3");
  const lakeBedTint = new THREE.Color("#568296");
  const distantHill = new THREE.Color("#dce8d6");
  const scratch = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = sampleLakesideParkHeight(x, z, plinthX, plinthZ, flatRadius);
    pos.setY(i, y);

    const meadowPatch = 0.5 + 0.5 * Math.sin(x * 0.055 + 0.5) * Math.cos(z * 0.06 - 0.3);
    scratch.copy(lawnBase).lerp(sunlitLawn, meadowPatch * 0.65);

    if (y < -0.04) {
      const shoreT = smoothstep(-0.03, -0.26, y);
      const deepT = smoothstep(-0.26, -0.78, y);
      scratch.lerp(shoreSand, shoreT);
      scratch.lerp(lakeBedTint, deepT);
    } else if (y > 0.25) {
      scratch.lerp(distantHill, smoothstep(0.25, 4.5, y) * 0.45);
    }

    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  pos.needsUpdate = true;
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

/** Synthesizes a subtle animated water ripple normal/specular DataTexture for the lake & infinity pool. */
function createWaterRippleNormalMap(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const dx = Math.cos(u * 3 + Math.sin(v * 2)) * 0.14 + Math.cos(u * 7 - v * 5) * 0.07;
      const dy = Math.sin(v * 4 + Math.cos(u * 2)) * 0.14 + Math.sin(v * 6 + u * 4) * 0.07;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

interface SubEnvProps {
  plinthX: number;
  plinthZ: number;
  bayScale: number;
}

/* -------------------------------------------------------------------------- */
/*  0. Horizon Waterfront Pavilion ("atrium") — Quest 3 Home Boot Environment */
/* -------------------------------------------------------------------------- */

const PAVILION_CENTER_Z = -2.2;
const PAVILION_RADIUS = 12.6;
const PAVILION_RIB_COUNT = 24;
const PAVILION_COLUMN_ANGLES = [-2.55, -2.05, -1.55, -1.02, 1.02, 1.55, 2.05, 2.55] as const;

const AtriumLightformerEnvironment = memo(function AtriumLightformerEnvironment(): ReactElement {
  return (
    <Environment frames={1} resolution={256} background={false}>
      <color attach="background" args={["#e6ecf3"]} />
      {/* Sunlit overhead glass oculus */}
      <Lightformer form="circle" intensity={2.9} color="#fffaf0" position={[0, 10, -2]} scale={8.5} />
      {/* Open panoramic lakefront horizon softbox */}
      <Lightformer form="rect" intensity={2.1} color="#eef6ff" position={[0, 3.8, -14]} scale={[22, 7.5, 1]} />
      <Lightformer
        form="rect"
        intensity={1.35}
        color="#fff7ed"
        position={[11, 3.6, -4]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[14, 5.5, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.35}
        color="#f0f7ff"
        position={[-11, 3.6, -4]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[14, 5.5, 1]}
      />
      {/* Warm honed travertine terrace bounce */}
      <Lightformer
        form="rect"
        intensity={0.95}
        color="#f3eee6"
        position={[0, -2.2, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[30, 30, 1]}
      />
    </Environment>
  );
});

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

function AtriumContactShadow({
  plinthX,
  plinthZ,
  bayScale,
}: {
  plinthX: number;
  plinthZ: number;
  bayScale: number;
}): ReactElement {
  const decalTex = useMemo(() => createRadialContactShadowTexture(0.22, 0.08, 128), []);
  useEffect(() => {
    return () => decalTex.dispose();
  }, [decalTex]);

  const size = 3.4 * (bayScale > 1.2 ? 1.2 : 1);
  return (
    <mesh position={[plinthX, 0.0035, plinthZ]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[size * 0.5, 48]} />
      <meshBasicMaterial map={decalTex} transparent depthWrite={false} />
    </mesh>
  );
}

function AtriumEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const isInXr = useXR((s) => s.session != null);
  const travertinePbr = useMemo(() => createHonedTravertinePbr(10, 10, 256), []);
  const oakPbr = useMemo(() => createArchitecturalWoodPbr(1, 3, 128), []);
  const waterNormal = useMemo(() => createWaterRippleNormalMap(128), []);

  // Curved dome canopy lathe + curved radial oak rib geometry hugging the exact dome soffit curve
  const { canopyGeom, curvedRibGeom } = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    const ribPts: THREE.Vector3[] = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = PAVILION_RADIUS + 0.35 + (4.4 - (PAVILION_RADIUS + 0.35)) * t;
      const y = 4.65 + (8.4 - 4.65) * Math.sin((t * Math.PI) / 2);
      pts.push(new THREE.Vector2(r, y));
      ribPts.push(new THREE.Vector3(0, y - 0.06, r));
    }
    const g = new THREE.LatheGeometry(pts, 72);
    g.translate(0, 0, PAVILION_CENTER_Z);
    g.computeVertexNormals();

    const ribCurve = new THREE.CatmullRomCurve3(ribPts);
    const rg = new THREE.TubeGeometry(ribCurve, 18, 0.055, 6, false);
    return { canopyGeom: g, curvedRibGeom: rg };
  }, []);

  useEffect(() => {
    return () => {
      travertinePbr.dispose();
      oakPbr.dispose();
      waterNormal.dispose();
      canopyGeom.dispose();
      curvedRibGeom.dispose();
    };
  }, [travertinePbr, oakPbr, waterNormal, canopyGeom, curvedRibGeom]);

  // 24 Curved Radial Warm White-Oak Timber Ribs hugging the exact dome soffit
  const ribsRef = useRef<THREE.InstancedMesh | null>(null);
  useLayoutEffect(() => {
    const mesh = ribsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < PAVILION_RIB_COUNT; i++) {
      const a = (i / PAVILION_RIB_COUNT) * Math.PI * 2;
      dummy.position.set(0, 0, PAVILION_CENTER_Z);
      dummy.rotation.set(0, a, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    waterNormal.offset.x = (waterNormal.offset.x + delta * 0.012) % 1;
    waterNormal.offset.y = (waterNormal.offset.y + delta * 0.008) % 1;
  });

  const inlayR = 2.05 * (bayScale > 1.2 ? 1.22 : 1);

  return (
    <group name="rotunda-env-atrium">
      <SceneBackdropAndHdriSync
        environment="atrium"
        background="#eef2f6"
        fogColor="#dce7f3"
        fogNear={48}
        fogFar={165}
        transparent={false}
        useSkyDome={true}
        applyHdri={isInXr}
      />
      {!isInXr && <AtriumLightformerEnvironment />}
      <AtriumShadowMapController enabled={!isInXr} />

      <hemisphereLight args={["#fffdf9", "#e5ddd0", 0.55]} />
      <directionalLight
        position={[14, 24, -18]}
        intensity={isInXr ? 1.15 : 1.55}
        color="#fff6e6"
        castShadow={!isInXr}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0004}
      />

      {/* Panoramic Infinity-Edge Reflecting Pool & Serene Alpine Lake surrounding the Waterfront Pavilion */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.38, PAVILION_CENTER_Z]}>
        <ringGeometry args={[PAVILION_RADIUS - 0.2, 136, 96]} />
        <meshStandardMaterial
          color="#5ca4c4"
          normalMap={waterNormal}
          normalScale={new THREE.Vector2(0.18, 0.18)}
          roughness={0.14}
          metalness={0.18}
          envMapIntensity={1.15}
        />
      </mesh>

      {/* Main Circular Honed Warm-Ivory Travertine Pavilion Terrace */}
      {isInXr ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, PAVILION_CENTER_Z]}>
          <circleGeometry args={[PAVILION_RADIUS, 72]} />
          <meshStandardMaterial
            map={travertinePbr.map}
            normalMap={travertinePbr.normalMap}
            normalScale={new THREE.Vector2(0.22, 0.22)}
            roughnessMap={travertinePbr.roughnessMap}
            color="#fbf9f5"
            roughness={0.62}
            metalness={0.04}
            envMapIntensity={0.85}
          />
        </mesh>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, PAVILION_CENTER_Z]} receiveShadow>
          <circleGeometry args={[PAVILION_RADIUS, 96]} />
          <MeshReflectorMaterial
            map={travertinePbr.map}
            roughnessMap={travertinePbr.roughnessMap}
            color="#fcfaf6"
            roughness={0.62}
            metalness={0.02}
            envMapIntensity={0.85}
            resolution={512}
            blur={[380, 140]}
            mixBlur={1.1}
            mixStrength={0.42}
            mirror={0.2}
            depthScale={0.6}
            reflectorOffset={0.001}
          />
        </mesh>
      )}

      {/* Chamfered Travertine Terrace Slab Rim + Recessed Warm Cove */}
      <mesh position={[0, -0.22, PAVILION_CENTER_Z]}>
        <cylinderGeometry args={[PAVILION_RADIUS + 0.08, PAVILION_RADIUS - 0.15, 0.44, 72]} />
        <meshStandardMaterial color="#e8e2d8" roughness={0.65} metalness={0.04} />
      </mesh>

      {/* Open Forward Panoramic Glass Balustrade (`-108° .. +108°` facing the lake & mountain vista) */}
      <mesh position={[0, 0.52, PAVILION_CENTER_Z]}>
        <cylinderGeometry
          args={[PAVILION_RADIUS - 0.12, PAVILION_RADIUS - 0.12, 1.02, 64, 1, true, Math.PI - 1.9, 3.8]}
        />
        <meshBasicMaterial color="#e0f2fe" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.04, PAVILION_CENTER_Z]} rotation={[Math.PI / 2, 0, Math.PI - 1.9]}>
        <torusGeometry args={[PAVILION_RADIUS - 0.12, 0.024, 10, 64, 3.8]} />
        <meshStandardMaterial color="#d4c3a3" metalness={0.68} roughness={0.28} />
      </mesh>

      {/* Cozy Curved Rear & Side Venetian Plaster Pavilion Alcove Wall (`+Z` hemisphere) + Warm Cove */}
      <mesh position={[0, 2.32, PAVILION_CENTER_Z]}>
        <cylinderGeometry args={[PAVILION_RADIUS - 0.05, PAVILION_RADIUS - 0.05, 4.65, 64, 1, true, -1.18, 2.36]} />
        <meshStandardMaterial color="#f5f1ea" roughness={0.82} metalness={0.02} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 4.58, PAVILION_CENTER_Z]} rotation={[Math.PI / 2, 0, -1.18]}>
        <torusGeometry args={[PAVILION_RADIUS - 0.12, 0.022, 8, 48, 2.36]} />
        <meshBasicMaterial color="#fffbeb" toneMapped={false} />
      </mesh>

      {/* Slender Tapered Champagne-Anodized Perimeter Columns supporting the Floating Canopy */}
      {PAVILION_COLUMN_ANGLES.map((ang, idx) => (
        <mesh
          key={idx}
          position={[
            Math.sin(ang) * (PAVILION_RADIUS - 0.25),
            2.32,
            PAVILION_CENTER_Z + Math.cos(ang) * (PAVILION_RADIUS - 0.25),
          ]}
          castShadow={!isInXr}
        >
          <cylinderGeometry args={[0.11, 0.15, 4.65, 18]} />
          <meshStandardMaterial color="#e5dec9" metalness={0.42} roughness={0.36} />
        </mesh>
      ))}

      {/* Sweeping Curved Pavilion Dome Canopy + 24 Warm White-Oak Radial Ribs + Skylight Oculus Ring */}
      <mesh geometry={canopyGeom} castShadow={!isInXr}>
        <meshStandardMaterial color="#f8f5ef" roughness={0.76} metalness={0.02} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 4.65, PAVILION_CENTER_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[PAVILION_RADIUS + 0.32, 0.14, 12, 72]} />
        <meshStandardMaterial color="#ede8df" roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, 8.4, PAVILION_CENTER_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.4, 0.14, 12, 64]} />
        <meshStandardMaterial color="#e5dec9" roughness={0.42} metalness={0.35} />
      </mesh>
      <instancedMesh ref={ribsRef} args={[curvedRibGeom, undefined, PAVILION_RIB_COUNT]} frustumCulled={false}>
        <meshStandardMaterial
          map={oakPbr.map}
          roughnessMap={oakPbr.roughnessMap}
          color="#e8cfab"
          roughness={0.62}
          metalness={0.04}
        />
      </instancedMesh>

      {/* Whisper-Thin Flush Champagne-Gold Architectural Floor Inlay around the Hero Stage (zero visual clutter) */}
      <group position={[plinthX, 0.003, plinthZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[inlayR - 0.018, inlayR, 96]} />
          <meshStandardMaterial color="#cbb282" metalness={0.78} roughness={0.28} />
        </mesh>
      </group>

      <AtriumContactShadow plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />
      <AtriumEnvironmentProps />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  1. Aerospace & Robotics R&D Hangar ("warehouse")                          */
/* -------------------------------------------------------------------------- */

const WAREHOUSE_BAY_Z = [-18, -10, -2, 6] as const;

function WarehouseEnvironment({ plinthZ, bayScale }: SubEnvProps): ReactElement {
  const concretePbr = useMemo(() => createPolishedConcretePbr(14, 14, 256), []);
  const steelPbr = useMemo(() => createBrushedAluminumPbr(2, 4, "#9aa6b4", 128), []);
  const columnShadowTex = useMemo(() => createRadialContactShadowTexture(0.32, 0.12, 64), []);

  useEffect(() => {
    return () => {
      concretePbr.dispose();
      steelPbr.dispose();
      columnShadowTex.dispose();
    };
  }, [concretePbr, steelPbr, columnShadowTex]);

  const bayHalfW = 3.9 * (bayScale > 1.2 ? 1.18 : 1.0);
  const bayMinZ = plinthZ - 2.6 * bayScale;
  const bayMaxZ = 1.6;
  const bayCenterZ = (bayMinZ + bayMaxZ) * 0.5;
  const bayDepth = bayMaxZ - bayMinZ;

  return (
    <group name="rotunda-env-warehouse">
      <SceneBackdropAndHdriSync
        environment="warehouse"
        background="#cfd9e6"
        fogColor="#cfd9e6"
        fogNear={28}
        fogFar={78}
        transparent={false}
      />

      <hemisphereLight args={["#f8fafc", "#94a3b8", 1.12]} />
      <directionalLight position={[12, 15, 6]} intensity={1.5} color="#fff7ed" />
      <directionalLight position={[-10, 9, -8]} intensity={0.58} color="#dbeafe" />

      {/* Smooth Satin Epoxy Hangar Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -4]}>
        <planeGeometry args={[72, 72]} />
        <meshStandardMaterial
          map={concretePbr.map}
          normalMap={concretePbr.normalMap}
          normalScale={new THREE.Vector2(0.18, 0.18)}
          roughnessMap={concretePbr.roughnessMap}
          roughness={0.92}
          metalness={0.06}
          envMapIntensity={0.82}
        />
      </mesh>

      {/* Clean Minimalist Painted Safety-Line Bay Perimeter (no cluttered radial ticks) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, bayMinZ]}>
        <planeGeometry args={[bayHalfW * 2, 0.07]} />
        <meshStandardMaterial color="#eab308" roughness={0.45} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, bayMaxZ]}>
        <planeGeometry args={[bayHalfW * 2, 0.07]} />
        <meshStandardMaterial color="#eab308" roughness={0.45} />
      </mesh>
      {[-bayHalfW, bayHalfW].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.003, bayCenterZ]}>
          <planeGeometry args={[0.07, bayDepth]} />
          <meshStandardMaterial color="#eab308" roughness={0.45} />
        </mesh>
      ))}

      {/* Structural Steel Columns & Overhead High-Bay Roof Trusses */}
      {WAREHOUSE_BAY_Z.map((z) => (
        <group key={z} position={[0, 0, z]}>
          {[-11.2, 11.2].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.85, 20]} />
                <meshBasicMaterial map={columnShadowTex} transparent depthWrite={false} />
              </mesh>
              <mesh position={[0, 4.4, 0]}>
                <boxGeometry args={[0.32, 8.8, 0.42]} />
                <meshStandardMaterial
                  map={steelPbr.map}
                  roughnessMap={steelPbr.roughnessMap}
                  metalness={0.65}
                  roughness={0.55}
                />
              </mesh>
              <mesh position={[0, 0.52, 0]}>
                <boxGeometry args={[0.48, 1.0, 0.5]} />
                <meshStandardMaterial color="#eab308" roughness={0.4} metalness={0.15} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 8.1, 0]}>
            <boxGeometry args={[22.8, 0.34, 0.28]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.58} roughness={0.42} />
          </mesh>
        </group>
      ))}

      {/* Diffused Skylight Ceiling Bays */}
      {[-14, -6, 2].map((z) => (
        <group key={z} position={[0, 8.5, z]}>
          {[-4.4, 4.4].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <boxGeometry args={[5.8, 0.06, 1.1]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} fog={false} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Left Architectural Hangar Wall + Clerestory Glazing */}
      <group position={[-11.6, 0, -6]}>
        <mesh position={[0, 2.5, 0]}>
          <boxGeometry args={[0.24, 5.0, 34]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.72} metalness={0.05} />
        </mesh>
        <mesh position={[0.06, 6.2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[32, 2.2]} />
          <meshBasicMaterial color="#f8fafc" toneMapped={false} fog={false} />
        </mesh>
      </group>

      {/* Right Hangar Wall with Partially-Open Sunlit Roll-Up Hangar Door (`z = -10..-2m`) */}
      <group position={[11.6, 0, -6]}>
        <mesh position={[0, 2.5, -10.5]}>
          <boxGeometry args={[0.24, 5.0, 13]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.72} metalness={0.05} />
        </mesh>
        <mesh position={[0, 2.5, 8.5]}>
          <boxGeometry args={[0.24, 5.0, 9]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.72} metalness={0.05} />
        </mesh>
        {/* Raised Segmented Hangar Door Header + Sunlit Outdoor Apron Vista */}
        <mesh position={[-0.08, 4.15, -0.5]}>
          <boxGeometry args={[0.32, 1.7, 9.0]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.35} />
        </mesh>
        <mesh position={[3.2, 2.0, -0.5]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[9.4, 4.2]} />
          <meshBasicMaterial color="#e0f2fe" toneMapped={false} fog={false} />
        </mesh>
        {/* Warm Sunlight Wedge Spilling onto the Hangar Floor */}
        <mesh position={[-3.2, 0.004, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[5.8, 7.6]} />
          <meshBasicMaterial color="#fffbeb" transparent opacity={0.26} depthWrite={false} />
        </mesh>
      </group>

      {/* Rear Bulkhead behind Mezzanine */}
      <mesh position={[0, 4.4, -22.8]}>
        <boxGeometry args={[24, 8.8, 0.36]} />
        <meshStandardMaterial color="#dde4ee" roughness={0.72} metalness={0.06} />
      </mesh>

      <WarehouseEnvironmentProps />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Engineering Campus Floor ("office") — Cubicles, Glass Rooms & Windows  */
/* -------------------------------------------------------------------------- */

function OfficeEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const travertinePbr = useMemo(() => createHonedTravertinePbr(12, 12, 256), []);
  const oakPbr = useMemo(() => createArchitecturalWoodPbr(1, 3, 128), []);
  const mullionPbr = useMemo(() => createBrushedAluminumPbr(1, 4, "#64748b", 128), []);

  useEffect(() => {
    return () => {
      travertinePbr.dispose();
      oakPbr.dispose();
      mullionPbr.dispose();
    };
  }, [travertinePbr, oakPbr, mullionPbr]);

  const inlayRadius = 1.95 * (bayScale > 1.2 ? 1.2 : 1);

  return (
    <group name="rotunda-env-office">
      <SceneBackdropAndHdriSync
        environment="office"
        background="#e8eef5"
        fogColor="#e8eef5"
        fogNear={26}
        fogFar={68}
        transparent={false}
      />

      <hemisphereLight args={["#ffffff", "#e4dcd0", 1.08]} />
      <directionalLight position={[14, 13, 5]} intensity={1.45} color="#fff7e8" />
      <directionalLight position={[-10, 8, -6]} intensity={0.62} color="#e0f2fe" />

      {/* Warm Honed Travertine & Oak Perimeter Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -3]}>
        <planeGeometry args={[52, 52]} />
        <meshStandardMaterial
          map={travertinePbr.map}
          normalMap={travertinePbr.normalMap}
          normalScale={new THREE.Vector2(0.18, 0.18)}
          roughnessMap={travertinePbr.roughnessMap}
          roughness={0.78}
          metalness={0.03}
          envMapIntensity={0.78}
        />
      </mesh>

      {/* Whisper-Thin Brushed Brass Floor Inlay around the Hero Stage */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plinthX, 0.004, plinthZ]}>
        <ringGeometry args={[inlayRadius - 0.022, inlayRadius, 72]} />
        <meshStandardMaterial color="#c8a86b" metalness={0.78} roughness={0.28} />
      </mesh>

      {/* Rear Architectural Wall Backing the Conference Room, Break Nook & Principal Office (`z = -13.0m`) */}
      <mesh position={[0, 2.25, -13.0]}>
        <boxGeometry args={[20.8, 4.5, 0.28]} />
        <meshStandardMaterial color="#f1f4f8" roughness={0.82} metalness={0.02} />
      </mesh>
      {/* Warm White-Oak Acoustic Slat Accent Panel behind Break Nook */}
      <mesh position={[0, 2.25, -12.82]}>
        <boxGeometry args={[3.6, 4.1, 0.06]} />
        <meshStandardMaterial
          map={oakPbr.map}
          roughnessMap={oakPbr.roughnessMap}
          color="#e5c8a2"
          roughness={0.68}
          metalness={0.02}
        />
      </mesh>

      {/* Rear-of-User Entry Wall (`z = +7.8m`) so the office feels like a complete indoor floor */}
      <mesh position={[0, 2.25, 7.8]}>
        <boxGeometry args={[20.8, 4.5, 0.28]} />
        <meshStandardMaterial color="#f1f4f8" roughness={0.82} metalness={0.02} />
      </mesh>

      {/* Coffered Acoustic Studio Ceiling (`y = 4.45m`) + Suspended Linear Daylight Luminaires */}
      <mesh position={[0, 4.52, -2.6]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20.8, 21.0]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.85} metalness={0.02} />
      </mesh>
      {[-9.6, -5.6, -1.6, 2.4, 5.8].map((z) => (
        <group key={z} position={[0, 4.12, z]}>
          <mesh>
            <boxGeometry args={[15.6, 0.09, 0.2]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.5} metalness={0.2} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <boxGeometry args={[14.8, 0.02, 0.14]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Left & Right Transparent Floor-to-Ceiling Curtain Walls looking out onto Campus Courtyard Trees */}
      {[-10.2, 10.2].map((x) => {
        const inwardSign = x < 0 ? 1 : -1;
        return (
          <group key={x} position={[x, 0, -2.6]}>
            <mesh position={[0, 2.25, 0]} rotation={[0, inwardSign * (Math.PI / 2), 0]}>
              <planeGeometry args={[20.6, 4.3]} />
              <meshBasicMaterial color="#dff0ff" transparent opacity={0.18} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.12, 0]}>
              <boxGeometry args={[0.16, 0.24, 20.8]} />
              <meshStandardMaterial map={mullionPbr.map} metalness={0.68} roughness={0.42} />
            </mesh>
            <mesh position={[0, 4.42, 0]}>
              <boxGeometry args={[0.18, 0.2, 20.8]} />
              <meshStandardMaterial map={mullionPbr.map} metalness={0.68} roughness={0.42} />
            </mesh>
            {[-10.2, -6.8, -3.4, 0, 3.4, 6.8, 10.2].map((zOff) => (
              <mesh key={zOff} position={[0, 2.25, zOff]}>
                <boxGeometry args={[0.14, 4.4, 0.08]} />
                <meshStandardMaterial map={mullionPbr.map} metalness={0.68} roughness={0.42} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Warm Sunlit Window Light-Pools across the Right Floor */}
      {[-5.2, -1.6, 2.0].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[7.4, 0.004, z]}>
          <planeGeometry args={[3.2, 2.5]} />
          <meshBasicMaterial color="#fffbeb" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ))}

      <OfficeEnvironmentProps />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Lakeside Proving Park ("outdoors") — Flat Lawn, Lake, Trees & Turbines */
/* -------------------------------------------------------------------------- */

function OutdoorsEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  // Broad 30m+ flat manicured park terrace — zero lumpy moguls around the user!
  const flatRadius = bayScale > 1.2 ? 32.0 : 30.0;

  const sampleGroundY = useCallback(
    (x: number, z: number) => sampleLakesideParkHeight(x, z, plinthX, plinthZ, flatRadius),
    [plinthX, plinthZ, flatRadius],
  );

  const terrainGeom = useMemo(
    () => createLakesideParkTerrainGeometry(plinthX, plinthZ, flatRadius),
    [plinthX, plinthZ, flatRadius],
  );
  const grassPbr = useMemo(() => createMeadowGrassPbr(32, 32, 256), []);
  const padStonePbr = useMemo(() => createProvingPadStonePbr(3, 3, 256), []);
  const waterNormal = useMemo(() => createWaterRippleNormalMap(128), []);

  useEffect(() => {
    return () => {
      terrainGeom.dispose();
      grassPbr.dispose();
      padStonePbr.dispose();
      waterNormal.dispose();
    };
  }, [terrainGeom, grassPbr, padStonePbr, waterNormal]);

  useFrame((_, delta) => {
    waterNormal.offset.x = (waterNormal.offset.x + delta * 0.015) % 1;
    waterNormal.offset.y = (waterNormal.offset.y + delta * 0.009) % 1;
  });

  const patioRadius = 4.6 * (bayScale > 1.2 ? 1.18 : 1.0);

  return (
    <group name="rotunda-env-outdoors">
      <SceneBackdropAndHdriSync
        environment="outdoors"
        background="#8ec5f8"
        fogColor="#d4e6f5"
        fogNear={52}
        fogFar={165}
        transparent={false}
        useSkyDome={true}
      />

      <hemisphereLight args={["#d8ecff", "#758f5e", 0.98]} />
      <directionalLight position={[28, 30, -28]} intensity={1.68} color="#fff7e2" />
      <directionalLight position={[-16, 12, 16]} intensity={0.45} color="#cfe4ff" />

      {/* Expansive Flat Manicured Lawn + Gentle Far Hills + Shoreline Basin */}
      <mesh geometry={terrainGeom}>
        <meshStandardMaterial
          map={grassPbr.map}
          normalMap={grassPbr.normalMap}
          normalScale={new THREE.Vector2(0.32, 0.32)}
          roughnessMap={grassPbr.roughnessMap}
          vertexColors
          roughness={0.95}
          metalness={0.01}
          envMapIntensity={0.5}
        />
      </mesh>

      {/* Tranquil Reflective Alpine Park Lake (`x = 10..96m, z = -72..24m`) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[52, -0.32, -24]}>
        <planeGeometry args={[86, 98]} />
        <meshStandardMaterial
          color="#4c93b8"
          normalMap={waterNormal}
          normalScale={new THREE.Vector2(0.22, 0.22)}
          roughness={0.12}
          metalness={0.22}
          envMapIntensity={1.25}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Flush Warm-Limestone Lakeside Patio around Standing Zone & Stage (zero clunky raised concrete curbs) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plinthX * 0.5, -0.012, plinthZ * 0.55]}>
        <circleGeometry args={[patioRadius, 64]} />
        <meshStandardMaterial
          map={padStonePbr.map}
          normalMap={padStonePbr.normalMap}
          normalScale={new THREE.Vector2(0.22, 0.22)}
          roughnessMap={padStonePbr.roughnessMap}
          color="#f7f4ed"
          roughness={0.72}
          metalness={0.03}
        />
      </mesh>
      {/* Subtle Flush Warm-Bronze Patio Border Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plinthX * 0.5, -0.01, plinthZ * 0.55]}>
        <ringGeometry args={[patioRadius - 0.045, patioRadius, 72]} />
        <meshStandardMaterial color="#b89f78" metalness={0.55} roughness={0.38} />
      </mesh>

      <OutdoorsEnvironmentProps sampleGroundY={sampleGroundY} plinthX={plinthX} plinthZ={plinthZ} />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Obsidian Acoustic Keynote Studio ("dark-lab")                          */
/* -------------------------------------------------------------------------- */

const DARK_SLAT_COUNT = 44;

function DarkLabEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const basaltPbr = useMemo(() => createDarkBasaltPbr(14, 14, 256), []);

  useEffect(() => {
    return () => {
      basaltPbr.dispose();
    };
  }, [basaltPbr]);

  const slatsRef = useRef<THREE.InstancedMesh | null>(null);
  useLayoutEffect(() => {
    const mesh = slatsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < DARK_SLAT_COUNT; i++) {
      const a = (i / DARK_SLAT_COUNT) * Math.PI * 2;
      // Leave rear control-booth window gap open around z = -12.6
      if (Math.cos(a) < -0.82) {
        dummy.scale.set(0, 0, 0);
      } else {
        dummy.position.set(Math.sin(a) * 12.8, 2.4, -2.0 + Math.cos(a) * 12.8);
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(1, 1, 1);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  const ringRadius = 1.95 * (bayScale > 1.2 ? 1.2 : 1);

  return (
    <group name="rotunda-env-dark-lab">
      <SceneBackdropAndHdriSync
        environment="dark-lab"
        background="#050914"
        fogColor="#050914"
        fogNear={18}
        fogFar={48}
        transparent={false}
      />

      <hemisphereLight args={["#1e293b", "#020617", 0.52]} />
      <directionalLight position={[5, 11, 7]} intensity={1.6} color="#f8fafc" />
      <directionalLight position={[-8, 5.2, -6]} intensity={0.95} color="#38bdf8" />
      <directionalLight position={[8, 4.8, -8]} intensity={0.85} color="#818cf8" />

      {/* Satin Honed Obsidian Basalt Studio Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
        <planeGeometry args={[64, 64]} />
        <meshStandardMaterial
          map={basaltPbr.map}
          normalMap={basaltPbr.normalMap}
          normalScale={new THREE.Vector2(0.16, 0.16)}
          roughnessMap={basaltPbr.roughnessMap}
          roughness={0.88}
          metalness={0.18}
          envMapIntensity={1.1}
        />
      </mesh>

      {/* Overhead Linear Architectural Softboxes */}
      {[-3.2, 0, 3.2].map((x) => (
        <group key={x} position={[x, 6.2, -2.1]}>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.72, 0.08, 6.4]} />
            <meshStandardMaterial color="#0f172a" metalness={0.72} roughness={0.35} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.58, 0.03, 6.1]} />
            <meshBasicMaterial color="#e2f1ff" toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Curved Slatted Charcoal-Walnut Acoustic Studio Perimeter */}
      <instancedMesh ref={slatsRef} args={[undefined, undefined, DARK_SLAT_COUNT]} frustumCulled={false}>
        <boxGeometry args={[0.16, 4.8, 0.28]} />
        <meshStandardMaterial color="#1e2433" roughness={0.68} metalness={0.18} />
      </instancedMesh>

      {/* Subtle Precision 1 m Metrology Grid */}
      <Grid
        position={[0, 0.001, 0]}
        args={[32, 32]}
        cellSize={0.25}
        cellThickness={0.35}
        cellColor="#111827"
        sectionSize={1.0}
        sectionThickness={0.9}
        sectionColor="#0e7490"
        fadeDistance={22}
        fadeStrength={1.8}
        infiniteGrid
      />

      {/* Single Hairline Cyan Stage Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plinthX, 0.004, plinthZ]}>
        <ringGeometry args={[ringRadius - 0.016, ringRadius, 96]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>

      <DarkLabEnvironmentProps />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Mixed Reality Passthrough ("passthrough")                              */
/* -------------------------------------------------------------------------- */

function PassthroughEnvironment({ plinthX, plinthZ, bayScale }: SubEnvProps): ReactElement {
  const outerRadius = 1.72 * bayScale;

  return (
    <group name="rotunda-env-passthrough">
      <SceneBackdropAndHdriSync environment="passthrough" background={null} transparent={true} />
      <hemisphereLight args={["#f8fafc", "#475569", 0.95]} />
      <directionalLight position={[6, 10, 6]} intensity={1.55} color="#ffffff" />
      <directionalLight position={[-6, 6, -5]} intensity={0.65} color="#bae6fd" />

      <mesh position={[plinthX, 0.003, plinthZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[outerRadius - 0.02, outerRadius, 72]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.36} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Public RotundaEnvironment Component                                       */
/* -------------------------------------------------------------------------- */

const NOOP_ENV_RAYCAST: THREE.Object3D["raycast"] = () => {};

/**
 * Renders the active photorealistic procedural 3D environment + matched equirectangular
 * HDRI/PMREM IBL for the Engineering Rotunda VR Mode with zero external asset dependencies
 * and full GPU resource disposal on switch/unmount.
 */
export const RotundaEnvironment = memo(
  function RotundaEnvironment({ environment, plinthCenter, scaleMode }: RotundaEnvironmentProps): ReactElement {
    const envRootRef = useRef<THREE.Group | null>(null);
    const plinthX = plinthCenter[0];
    const plinthZ = plinthCenter[2];
    const bayScale = scaleMode === "real-scale" ? 1.45 : 1.0;

    // Disable pointer/laser raycasting on all passive background scenery (massive Quest 2/3 CPU win)
    useLayoutEffect(() => {
      const root = envRootRef.current;
      if (!root) return;
      root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
          obj.raycast = NOOP_ENV_RAYCAST;
        }
      });
    }, [environment, scaleMode]);

    let content: ReactElement;
    switch (environment) {
      case "atrium":
        content = <AtriumEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
        break;
      case "warehouse":
        content = <WarehouseEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
        break;
      case "office":
        content = <OfficeEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
        break;
      case "outdoors":
        content = <OutdoorsEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
        break;
      case "dark-lab":
        content = <DarkLabEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
        break;
      case "passthrough":
        content = <PassthroughEnvironment plinthX={plinthX} plinthZ={plinthZ} bayScale={bayScale} />;
        break;
    }

    return (
      <group ref={envRootRef} name="rotunda-environment-root">
        {content}
      </group>
    );
  },
  (prev, next) =>
    prev.environment === next.environment &&
    prev.scaleMode === next.scaleMode &&
    prev.plinthCenter[0] === next.plinthCenter[0] &&
    prev.plinthCenter[1] === next.plinthCenter[1] &&
    prev.plinthCenter[2] === next.plinthCenter[2],
);
