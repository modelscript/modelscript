// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared hero-grade Three.js / R3F CAD rendering helpers used by both Morsel (CadViewer)
 * and Ansatz (CadStepViewer):
 * - Procedural lathe-brushed alloy PBR maps & 7-lobe aerospace softbox studio environment
 * - Dual-pass Solid-Ahead / Feature-Edge-Wireframe-Behind split sectioning + GPU stencil cap
 * - 3D ASME Y14.5 GD&T Feature Control Frame & Datum callout overlays
 */

import {
  ALLOY_MATERIAL_PRESETS,
  SECTION_CAP_FRAGMENT_SHADER,
  SECTION_CAP_VERTEX_SHADER,
  classifyAlloyPreset,
  evaluateStudioDomeColor,
  formatMaterialModifierGlyph,
  sliceSectionContoursAtPlane,
  synthesizeBrushedAlloyTextures,
  type AlloyMaterialSpec,
  type GdtCallout3D,
  type GdtDatumFeature3D,
  type GdtOverlayPayload,
} from "@modelscript/cad";
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";

export interface HeroPbrTextures {
  normal: THREE.DataTexture;
  roughness: THREE.DataTexture;
  ao: THREE.DataTexture;
  iridescence: THREE.DataTexture;
}

const pbrTextureCache = new WeakMap<THREE.WebGLRenderer, HeroPbrTextures>();
const studioEnvCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

function makeRepeatDataTexture(
  data: Uint8Array,
  width: number,
  height: number,
  anisotropy: number,
  repeat = true,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = repeat;
  if (repeat) tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Returns cached procedural brushed-alloy PBR textures scoped to a WebGLRenderer.
 */
export function getCachedHeroPbrTextures(gl: THREE.WebGLRenderer): HeroPbrTextures {
  const cached = pbrTextureCache.get(gl);
  if (cached) return cached;

  const maxAniso = Math.min(gl.capabilities.getMaxAnisotropy(), 8);
  const bufs = synthesizeBrushedAlloyTextures(256);

  const normal = makeRepeatDataTexture(bufs.normalRgba, bufs.size, bufs.size, maxAniso, true);
  const roughness = makeRepeatDataTexture(bufs.roughnessRgba, bufs.size, bufs.size, maxAniso, true);
  const ao = makeRepeatDataTexture(bufs.aoRgba, bufs.aoWidth, 1, 1, false);
  ao.channel = 1;
  const iridescence = makeRepeatDataTexture(bufs.iridescenceRgba, bufs.iridescenceSize, bufs.iridescenceSize, 1, true);
  iridescence.generateMipmaps = false;
  iridescence.minFilter = THREE.LinearFilter;

  const result: HeroPbrTextures = { normal, roughness, ao, iridescence };
  pbrTextureCache.set(gl, result);
  return result;
}

/**
 * Synthesizes and caches the 7-lobe aerospace photography studio PMREM environment
 * completely in-memory (zero network fetches, immune to offline HDRI errors).
 */
export function getCachedHeroStudioEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  const cached = studioEnvCache.get(gl);
  if (cached) return cached;

  const pmrem = new THREE.PMREMGenerator(gl);
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x05070a);

  const domeGeo = new THREE.SphereGeometry(16, 96, 48);
  const domePos = domeGeo.getAttribute("position") as THREE.BufferAttribute;
  const domeColors = new Float32Array(domePos.count * 3);

  for (let i = 0; i < domePos.count; i++) {
    const [r, g, b] = evaluateStudioDomeColor(domePos.getX(i), domePos.getY(i), domePos.getZ(i));
    domeColors[i * 3] = r;
    domeColors[i * 3 + 1] = g;
    domeColors[i * 3 + 2] = b;
  }

  domeGeo.setAttribute("color", new THREE.BufferAttribute(domeColors, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  studio.add(domeMesh);

  const envTex = pmrem.fromScene(studio, 0.01).texture;
  domeGeo.dispose();
  domeMat.dispose();
  pmrem.dispose();

  studioEnvCache.set(gl, envTex);
  return envTex;
}

/**
 * Assigns cylindrical/planar UVs onto CAD geometries lacking `uv` attributes so
 * procedural brushed-metal normal and roughness maps render cleanly on STEP & SCAD meshes.
 */
export function ensureGeometryBrushedUvs(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute("uv")) return;
  const pos = geo.getAttribute("position");
  if (!pos || pos.count === 0) return;

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const theta = Math.atan2(z, y) / (Math.PI * 2) + 0.5;
    uv[i * 2] = x * 0.65;
    uv[i * 2 + 1] = theta * 3.0;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export interface HeroPhysicalMaterialConfig {
  color: number;
  metalness: number;
  roughness: number;
  anisotropy: number;
  anisotropyRotation: number;
  clearcoat: number;
  clearcoatRoughness: number;
  normalMap: THREE.DataTexture | null;
  normalScale: THREE.Vector2;
  roughnessMap: THREE.DataTexture | null;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessRange: [number, number];
  iridescenceThicknessMap: THREE.DataTexture | null;
  emissive: number;
  emissiveIntensity: number;
  envMapIntensity: number;
}

const COLOR_PRESERVING_PRESETS = new Set<string>([
  "default-machined",
  "molded-abs-plastic",
  "matte-polymer",
  "elastomer-rubber",
  "gloss-paint",
  "clear-polycarbonate",
  "anodized-aluminum",
  "cast-aluminum",
  "stainless-steel",
]);

/**
 * Resolves calibrated MeshPhysicalMaterial properties for any CAD part.
 */
export function resolveHeroAlloyConfig(
  gl: THREE.WebGLRenderer,
  partName?: string | null,
  colorRgba?: readonly number[],
  dark = true,
  materialHint?: string | null,
): HeroPhysicalMaterialConfig {
  const maps = getCachedHeroPbrTextures(gl);
  const presetKey = classifyAlloyPreset(partName, colorRgba, materialHint);
  const spec: AlloyMaterialSpec = ALLOY_MATERIAL_PRESETS[presetKey];
  const useBrushed = spec.useBrushedMaps !== false;

  let colorHex = dark ? spec.colorDark : spec.colorLight;
  if (COLOR_PRESERVING_PRESETS.has(presetKey) && colorRgba && colorRgba.length >= 3) {
    const c = new THREE.Color(colorRgba[0]!, colorRgba[1]!, colorRgba[2]!);
    colorHex = c.getHex();
  }

  return {
    color: colorHex,
    metalness: spec.metalness,
    roughness: spec.roughness,
    anisotropy: spec.anisotropy,
    anisotropyRotation: spec.anisotropyRotation,
    clearcoat: spec.clearcoat ?? 0.14,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0.25,
    normalMap: useBrushed ? maps.normal : null,
    normalScale: new THREE.Vector2(spec.normalScale[0], spec.normalScale[1]),
    roughnessMap: useBrushed ? maps.roughness : null,
    iridescence: spec.iridescence ?? 0,
    iridescenceIOR: spec.iridescenceIOR ?? 1.3,
    iridescenceThicknessRange: spec.iridescenceThicknessRange
      ? [spec.iridescenceThicknessRange[0], spec.iridescenceThicknessRange[1]]
      : [100, 400],
    iridescenceThicknessMap: spec.iridescence ? maps.iridescence : null,
    emissive: (dark ? spec.emissiveDark : spec.emissiveLight) ?? 0x000000,
    emissiveIntensity: spec.emissiveIntensity ?? 0,
    envMapIntensity: spec.metalness > 0.5 ? (dark ? 1.5 : 1.55) : dark ? 0.95 : 1.05,
  };
}

/**
 * Attaches the procedural 7-lobe aerospace photography environment IBL + 3-point
 * studio key/rim/fill lighting to the active R3F scene.
 */
export const HeroStudioEnvironment: React.FC<{ dark?: boolean }> = ({ dark = true }) => {
  const { gl, scene } = useThree();

  useEffect(() => {
    const prevEnv = scene.environment;
    const prevToneMapping = gl.toneMapping;
    const prevExposure = gl.toneMappingExposure;

    scene.environment = getCachedHeroStudioEnv(gl);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = dark ? 1.05 : 1.04;

    return () => {
      scene.environment = prevEnv;
      gl.toneMapping = prevToneMapping;
      gl.toneMappingExposure = prevExposure;
    };
  }, [gl, scene, dark]);

  return (
    <>
      <directionalLight color="#fffaf0" position={[-5.2, 6.2, 5.0]} intensity={0.75} />
      <directionalLight color="#bae6fd" position={[4.2, 5.2, -5.5]} intensity={0.85} />
      <directionalLight color="#e0f2fe" position={[-6.5, -1.8, 3.8]} intensity={0.35} />
    </>
  );
};

/**
 * Renders the two-pass WebGL stencil-buffer mask and opposing cyan CAD feature-edge
 * wireframe for arbitrary closed CAD geometries when in `"section"` (Split) mode.
 */
export const SplitSectionGeometryPasses: React.FC<{
  geometry: THREE.BufferGeometry;
  solidPlane: THREE.Plane | null;
  wirePlane: THREE.Plane | null;
  position?: [number, number, number];
  dark?: boolean;
  showStencilMask?: boolean;
  showWireOpposite?: boolean;
}> = ({
  geometry,
  solidPlane,
  wirePlane,
  position = [0, 0, 0],
  dark = true,
  showStencilMask = true,
  showWireOpposite = true,
}) => {
  const edgeGeometry = useMemo(() => {
    if (!showWireOpposite) return null;
    return new THREE.EdgesGeometry(geometry, 22);
  }, [geometry, showWireOpposite]);

  useEffect(() => {
    return () => {
      edgeGeometry?.dispose();
    };
  }, [edgeGeometry]);

  const wireColor = dark ? "#22d3ee" : "#0e7490";
  const contourColor = dark ? "#7dd3fc" : "#0284c7";

  const contourGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    return g;
  }, []);
  const lastPlaneKeyRef = useRef<string>("");

  useEffect(() => {
    lastPlaneKeyRef.current = "";
  }, [geometry, position[0], position[1], position[2]]);

  useEffect(() => {
    return () => {
      contourGeometry.dispose();
    };
  }, [contourGeometry]);

  useFrame(() => {
    if (!showStencilMask || !solidPlane) return;
    const nx = solidPlane.normal.x;
    const ny = solidPlane.normal.y;
    const nz = solidPlane.normal.z;
    const localC = solidPlane.constant + nx * position[0] + ny * position[1] + nz * position[2];
    const key = `${nx.toFixed(4)}:${ny.toFixed(4)}:${nz.toFixed(4)}:${localC.toFixed(4)}`;
    if (key === lastPlaneKeyRef.current) return;
    lastPlaneKeyRef.current = key;

    const posAttr = geometry.getAttribute("position");
    if (!posAttr?.array) return;
    const idxAttr = geometry.getIndex();
    const segs = sliceSectionContoursAtPlane(posAttr.array, idxAttr?.array, [nx, ny, nz], localC);
    contourGeometry.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    contourGeometry.computeBoundingSphere();
  });

  return (
    <group position={position}>
      {showStencilMask && solidPlane && (
        <>
          <mesh geometry={geometry} renderOrder={1} frustumCulled={false}>
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              side={THREE.BackSide}
              clippingPlanes={[solidPlane]}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.IncrementWrapStencilOp}
              stencilZFail={THREE.IncrementWrapStencilOp}
              stencilZPass={THREE.IncrementWrapStencilOp}
            />
          </mesh>
          <mesh geometry={geometry} renderOrder={2} frustumCulled={false}>
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              side={THREE.FrontSide}
              clippingPlanes={[solidPlane]}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.DecrementWrapStencilOp}
              stencilZFail={THREE.DecrementWrapStencilOp}
              stencilZPass={THREE.DecrementWrapStencilOp}
            />
          </mesh>
          <lineSegments geometry={contourGeometry} renderOrder={4} frustumCulled={false}>
            <lineBasicMaterial color={contourColor} transparent opacity={0.92} depthWrite={false} />
          </lineSegments>
        </>
      )}

      {showWireOpposite && edgeGeometry && wirePlane && (
        <lineSegments geometry={edgeGeometry} renderOrder={3}>
          <lineBasicMaterial
            color={wireColor}
            transparent
            opacity={dark ? 0.42 : 0.52}
            depthWrite={false}
            clippingPlanes={[wirePlane]}
          />
        </lineSegments>
      )}
    </group>
  );
};

/**
 * Draws a plane-aligned cross-hatched blueprint cap across all pixels where the
 * WebGL stencil buffer is non-zero, clearing the stencil buffer back to 0 as it renders.
 */
export const StencilSectionCapQuad: React.FC<{
  plane: THREE.Plane;
  center?: [number, number, number];
  size?: number;
  dark?: boolean;
}> = ({ plane, center = [0, 0, 0], size = 80, dark = true }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const accentHex = dark ? 0x67e8f9 : 0x0891b2;

  const shaderMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: SECTION_CAP_VERTEX_SHADER,
      fragmentShader: SECTION_CAP_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(accentHex) },
        uOpacity: { value: 0.9 },
        uPitch: { value: Math.max(0.03, size * 0.012) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ZeroStencilOp,
      stencilZFail: THREE.ZeroStencilOp,
      stencilZPass: THREE.ZeroStencilOp,
    });
  }, [accentHex, size]);

  useEffect(() => {
    return () => {
      shaderMat.dispose();
    };
  }, [shaderMat]);

  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const targetCenter = useMemo(() => new THREE.Vector3(...center), [center]);

  useFrame(() => {
    if (!meshRef.current) return;
    // Project `targetCenter` onto `plane` so the finite cap quad always covers the clipped assembly
    const projected = plane.projectPoint(targetCenter, new THREE.Vector3());
    meshRef.current.position.copy(projected);
    meshRef.current.quaternion.setFromUnitVectors(zAxis, plane.normal);
  });

  return (
    <mesh ref={meshRef} renderOrder={4} frustumCulled={false} material={shaderMat}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
};

function getGdtStatusColor(status?: GdtCallout3D["status"]): string {
  if (status === "FAIL") return "#ef4444";
  if (status === "MARGINAL") return "#f59e0b";
  return "#22d3ee";
}

/**
 * Renders 3D ASME Y14.5 GD&T Feature Control Frames, datum feature flags, and
 * leader lines anchored directly to 3D geometry coordinates.
 */
export const Gdt3dOverlay: React.FC<{
  payload: GdtOverlayPayload;
  lift?: number;
  dark?: boolean;
  onSelectCallout?: ((callout: GdtCallout3D) => void) | undefined;
}> = ({ payload, lift = 1.15, dark = true, onSelectCallout }) => {
  const bg = dark ? "rgba(11, 16, 27, 0.92)" : "rgba(255, 255, 255, 0.94)";
  const fg = dark ? "#f8fafc" : "#0f172a";

  return (
    <group>
      {payload.datums.map((d: GdtDatumFeature3D) => {
        const end: [number, number, number] = [d.anchor[0], d.anchor[1] - lift * 0.85, d.anchor[2]];
        return (
          <group key={`datum-${d.label}-${d.sourceRef ?? d.name}`}>
            <mesh position={d.anchor}>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
            <Line points={[d.anchor, end]} color="#38bdf8" lineWidth={1.25} dashed dashSize={0.08} gapSize={0.05} />
            <Html position={end} center style={{ pointerEvents: "none" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: bg,
                  border: "1.5px solid #38bdf8",
                  color: fg,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: "#38bdf8" }}>▲</span>
                <span>{d.label}</span>
              </div>
            </Html>
          </group>
        );
      })}

      {payload.callouts.map((c: GdtCallout3D, idx: number) => {
        const color = getGdtStatusColor(c.status);
        const dirY = idx % 2 === 0 ? lift : -lift;
        const end: [number, number, number] = [c.anchor[0], c.anchor[1] + dirY, c.anchor[2]];
        const mod = formatMaterialModifierGlyph(c.materialCondition);

        return (
          <group key={c.id}>
            <mesh position={c.anchor}>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Line points={[c.anchor, end]} color={color} lineWidth={1.3} dashed dashSize={0.08} gapSize={0.05} />
            <Html position={end} center>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCallout?.(c);
                }}
                title={c.note || c.label}
                style={{
                  display: "inline-flex",
                  alignItems: "stretch",
                  border: `1.5px solid ${color}`,
                  borderRadius: 4,
                  background: bg,
                  color: fg,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  lineHeight: 1.2,
                  padding: 0,
                  cursor: onSelectCallout ? "pointer" : "default",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    padding: "2px 5px",
                    borderRight: `1px solid ${color}`,
                    fontWeight: 700,
                    color,
                  }}
                >
                  {c.symbol}
                </span>
                <span
                  style={{
                    padding: "2px 6px",
                    borderRight: c.datums.length > 0 ? `1px solid ${color}` : undefined,
                    fontWeight: 600,
                  }}
                >
                  {c.diametrical ? "⌀" : ""}
                  {c.tolerance}
                  {mod ? ` ${mod}` : ""}
                </span>
                {c.datums.map((d, dIdx) => (
                  <span
                    key={`${c.id}-d-${dIdx}`}
                    style={{
                      padding: "2px 5px",
                      borderRight: dIdx < c.datums.length - 1 ? `1px solid ${color}` : undefined,
                      fontWeight: 700,
                    }}
                  >
                    {d.label}
                    {formatMaterialModifierGlyph(d.modifier)}
                  </span>
                ))}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
};

/**
 * Renders crisp Onshape-style CAD feature/crease edges over shaded geometry.
 * Automatically disposes the derived EdgesGeometry on unmount or geometry change.
 */
export const CadEdgeOverlay: React.FC<{
  geometry: THREE.BufferGeometry;
  position?: [number, number, number];
  thresholdAngle?: number;
  dark?: boolean;
  color?: string;
  opacity?: number;
  clippingPlanes?: THREE.Plane[];
}> = ({
  geometry,
  position = [0, 0, 0],
  thresholdAngle = 20,
  dark = true,
  color,
  opacity = 0.85,
  clippingPlanes = [],
}) => {
  const edgeGeometry = useMemo(() => new THREE.EdgesGeometry(geometry, thresholdAngle), [geometry, thresholdAngle]);

  useEffect(() => {
    return () => {
      edgeGeometry.dispose();
    };
  }, [edgeGeometry]);

  const edgeColor = color ?? (dark ? "#0f172a" : "#111827");

  return (
    <lineSegments geometry={edgeGeometry} position={position} renderOrder={1}>
      <lineBasicMaterial
        color={edgeColor}
        transparent={opacity < 1.0}
        opacity={opacity}
        clippingPlanes={clippingPlanes}
      />
    </lineSegments>
  );
};

/**
 * Screen-Space Ambient Occlusion (SSAO) post-processing pass for CAD cavities,
 * louvers, and contact seams. Only hijacks R3F rendering when `enabled` is true.
 */
export const StudioSsaoPass: React.FC<{
  enabled?: boolean;
  kernelRadius?: number;
  minDistance?: number;
  maxDistance?: number;
}> = ({ enabled = true, kernelRadius = 0.25, minDistance = 0.001, maxDistance = 0.08 }) => {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const ssaoRef = useRef<SSAOPass | null>(null);

  useEffect(() => {
    if (!enabled) {
      composerRef.current?.dispose();
      composerRef.current = null;
      ssaoRef.current = null;
      return;
    }

    const composer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const ssaoPass = new SSAOPass(scene, camera, Math.max(1, size.width), Math.max(1, size.height));
    ssaoPass.kernelRadius = kernelRadius;
    ssaoPass.minDistance = minDistance;
    ssaoPass.maxDistance = maxDistance;
    ssaoPass.output = SSAOPass.OUTPUT.Default;
    const outputPass = new OutputPass();

    composer.addPass(renderPass);
    composer.addPass(ssaoPass);
    composer.addPass(outputPass);

    composerRef.current = composer;
    ssaoRef.current = ssaoPass;

    return () => {
      composer.dispose();
      composerRef.current = null;
      ssaoRef.current = null;
    };
  }, [enabled, gl, scene, camera, kernelRadius, minDistance, maxDistance]);

  useEffect(() => {
    if (!enabled || !composerRef.current) return;
    composerRef.current.setSize(Math.max(1, size.width), Math.max(1, size.height));
    ssaoRef.current?.setSize(Math.max(1, size.width), Math.max(1, size.height));
  }, [enabled, size.width, size.height]);

  useFrame(
    () => {
      if (enabled && composerRef.current) {
        composerRef.current.render();
      }
    },
    enabled ? 1 : 0,
  );

  return null;
};
