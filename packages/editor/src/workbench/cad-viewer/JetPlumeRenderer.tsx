// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single-draw-call GPU Particle Fluid Jet / Siphon Plume Renderer.
 *
 * Updates particle advection, radial turbulent cone spread, buoyancy shimmer,
 * and velocity-mapped color/alpha entirely in the vertex/fragment shader.
 * Automatically caps particle budget when `isInXr` is true (1,000 VR vs 4,000 Desktop)
 * to preserve locked 72/90 FPS stereo frame pacing.
 */

import { useFrame } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export interface JetPlumeRendererProps {
  /** Nozzle exit origin in local assembly coordinates. */
  readonly position: readonly [number, number, number];
  /** Outward unit jet direction vector. */
  readonly direction: readonly [number, number, number];
  /** Normalized thrust / flow intensity (`0..1`). When `<= 0.02`, plume fades smoothly out. */
  readonly thrustNorm: number;
  /** Physical jet exit speed in m/s (e.g. `2.68` for subsea siphon burst). */
  readonly jetVelocity?: number | undefined;
  /** Maximum plume reach in meters. */
  readonly plumeLength?: number | undefined;
  /** Nozzle exit aperture radius in meters. */
  readonly nozzleRadius?: number | undefined;
  /** Optional ref for zero-React-churn 72/90 FPS updates inside useFrame. */
  readonly thrustNormRef?: React.RefObject<number> | undefined;
  /** Optional live simulation time ref (synchronized with AnimationController / Rotunda clock). */
  readonly simulationTimeRef?: React.RefObject<number> | undefined;
  /** Enables stereo-safe particle count cap (`1000` vs `4000`). */
  readonly isInXr?: boolean | undefined;
  /** Core & outer plume tint colors. */
  readonly coreColor?: string | undefined;
  readonly edgeColor?: string | undefined;
  readonly visible?: boolean | undefined;
}

const JET_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aSeed; // x: phase01, y: radial01, z: angleRad, w: sizeScale
  uniform float uTime;
  uniform float uThrust;
  uniform float uVelocity;
  uniform float uLength;
  uniform float uNozzleRadius;
  uniform float uPointSize;

  varying float vAge;
  varying float vRadial;
  varying float vThrust;

  void main() {
    float speed = max(0.35, uVelocity) * (0.65 + 0.65 * uThrust);
    float age = fract(aSeed.x + uTime * speed * 0.85);
    vAge = age;
    vRadial = aSeed.y;
    vThrust = uThrust;

    // Turbulent expanding jet cone along local +Z
    float dist = age * uLength * (0.28 + 0.72 * uThrust);
    float swirl = aSeed.z + age * 4.5 + uTime * 2.2;
    float coneRadius = uNozzleRadius + dist * (0.18 + 0.16 * aSeed.y);
    float jitter = sin(uTime * 7.0 + aSeed.x * 31.4) * 0.008 * age;

    vec3 localPos = vec3(
      cos(swirl) * coneRadius * sqrt(aSeed.y) + jitter,
      sin(swirl) * coneRadius * sqrt(aSeed.y) + age * age * 0.025,
      dist
    );

    vec4 mvPos = modelViewMatrix * vec4(localPos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float sizeFade = sin(age * 3.14159265);
    gl_PointSize = clamp((uPointSize * aSeed.w * (0.55 + 0.9 * sizeFade)) / max(0.35, -mvPos.z), 1.5, 28.0);
  }
`;

const JET_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;

  varying float vAge;
  varying float vRadial;
  varying float vThrust;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float r2 = dot(centered, centered);
    if (r2 > 0.25) discard;

    float softDisc = smoothstep(0.25, 0.015, r2);
    float lifeAlpha = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge));
    float alpha = softDisc * lifeAlpha * clamp(vThrust * 1.15, 0.0, 0.85) * 0.62;
    if (alpha < 0.01) discard;

    vec3 col = mix(uCoreColor, uEdgeColor, clamp(vAge * 0.75 + vRadial * 0.35, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
  }
`;

export const JetPlumeRenderer: React.FC<JetPlumeRendererProps> = ({
  position,
  direction,
  thrustNorm,
  jetVelocity = 2.68,
  plumeLength = 0.48,
  nozzleRadius = 0.024,
  thrustNormRef,
  simulationTimeRef,
  isInXr = false,
  coreColor = "#e0f2fe",
  edgeColor = "#38bdf8",
  visible = true,
}) => {
  const particleCount = isInXr ? 1000 : 3600;
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const localClockRef = useRef(0);

  const orientationQuat = useMemo(() => {
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
    if (dir.lengthSq() < 1e-8) {
      dir.set(0, 0, -1);
    } else {
      dir.normalize();
    }
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    return q;
  }, [direction[0], direction[1], direction[2]]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount * 4);

    // Deterministic LCG for reproducible renders and zero runtime allocations
    let seed = 133791;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (let i = 0; i < particleCount; i++) {
      seeds[i * 4 + 0] = rand();
      seeds[i * 4 + 1] = rand();
      seeds[i * 4 + 2] = rand() * Math.PI * 2;
      seeds[i * 4 + 3] = 0.55 + rand() * 0.9;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    // Generous bounding sphere so GPU-displaced plume is never wrongly frustum-culled
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, plumeLength * 0.5), plumeLength * 1.25);
    return geo;
  }, [particleCount, plumeLength]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uThrust: { value: thrustNorm },
      uVelocity: { value: jetVelocity },
      uLength: { value: plumeLength },
      uNozzleRadius: { value: nozzleRadius },
      uPointSize: { value: isInXr ? 18.0 : 22.0 },
      uCoreColor: { value: new THREE.Color(coreColor) },
      uEdgeColor: { value: new THREE.Color(edgeColor) },
    }),
    [coreColor, edgeColor, isInXr],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, rawDelta) => {
    const mat = matRef.current;
    if (!mat) return;
    const dt = Math.min(rawDelta, 0.05);
    localClockRef.current += dt;
    const t = simulationTimeRef?.current ?? localClockRef.current;
    const activeThrust = thrustNormRef?.current ?? thrustNorm;

    mat.uniforms.uTime!.value = t;
    mat.uniforms.uThrust!.value = Math.max(0, Math.min(1.25, activeThrust));
    mat.uniforms.uVelocity!.value = jetVelocity;
    mat.uniforms.uLength!.value = plumeLength;
    mat.uniforms.uNozzleRadius!.value = nozzleRadius;
  });

  if (!visible) return null;

  return (
    <points
      position={[position[0], position[1], position[2]]}
      quaternion={orientationQuat}
      geometry={geometry}
      frustumCulled={false}
      renderOrder={5}
    >
      <shaderMaterial
        ref={matRef}
        vertexShader={JET_VERTEX_SHADER}
        fragmentShader={JET_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};
