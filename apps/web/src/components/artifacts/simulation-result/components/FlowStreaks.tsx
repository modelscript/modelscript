// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export interface FlowStreaksProps {
  geometry: THREE.BufferGeometry;
  velocityData: Float32Array;
  association: "point" | "cell";
  vMin: number;
  vMax: number;
  colormapTexture: THREE.DataTexture;
  scale?: number | undefined;
  animate?: boolean | undefined;
  downsampleFactor?: number | undefined;
}

export const FlowStreaks: React.FC<FlowStreaksProps> = ({
  geometry,
  velocityData,
  association,
  vMin,
  vMax,
  colormapTexture,
  scale = 1.0,
  animate = true,
  downsampleFactor = 1,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Compute model scale to size the streaks relative to the model
  const modelScale = useMemo(() => {
    geometry.computeBoundingSphere();
    return geometry.boundingSphere?.radius || 1.0;
  }, [geometry]);

  const { instancedGeo, numInstances } = useMemo(() => {
    const posOriginal = geometry.getAttribute("position").array;
    const indices = geometry.getIndex()?.array;

    const isCellData = association === "cell";
    const totalCount = isCellData ? velocityData.length / 3 : posOriginal.length / 3;
    const count = Math.ceil(totalCount / downsampleFactor);

    // Use a small thin cylinder
    const baseCylinder = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 5);
    baseCylinder.rotateX(Math.PI / 2); // Align cylinder along Z axis locally so we can orient it easily if needed, or keep Y axis

    const instancedGeo = new THREE.InstancedBufferGeometry().copy(baseCylinder);
    baseCylinder.dispose();

    const randoms = new Float32Array(count);
    const velocityMags = new Float32Array(count);

    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0); // Cylinder default length is along Y axis
    const matrices = new Float32Array(count * 16);

    // Streak thickness relative to the overall model scale
    const thickness = modelScale * 0.003;

    for (let i = 0; i < count; i++) {
      const idx = Math.min(i * downsampleFactor, totalCount - 1);

      // eslint-disable-next-line react-hooks/purity
      randoms[i] = Math.random();

      let px: number, py: number, pz: number;
      if (isCellData && indices && idx * 3 + 2 < indices.length) {
        const a = indices[idx * 3]!;
        const b = indices[idx * 3 + 1]!;
        const c = indices[idx * 3 + 2]!;
        px = (posOriginal[a * 3]! + posOriginal[b * 3]! + posOriginal[c * 3]!) / 3.0;
        py = (posOriginal[a * 3 + 1]! + posOriginal[b * 3]! + posOriginal[c * 3]!) / 3.0;
        pz = (posOriginal[a * 3 + 2]! + posOriginal[b * 3]! + posOriginal[c * 3]!) / 3.0;
      } else {
        px = posOriginal[idx * 3]!;
        py = posOriginal[idx * 3 + 1]!;
        pz = posOriginal[idx * 3 + 2]!;
      }

      const vx = velocityData[idx * 3];
      const vy = velocityData[idx * 3 + 1];
      const vz = velocityData[idx * 3 + 2];

      const vel = new THREE.Vector3(vx, vy, vz);
      const mag = vel.length();
      velocityMags[i] = mag;

      dummy.position.set(px, py, pz);
      if (mag > 0.0001) {
        // Orient cylinder length (Y axis) along the velocity vector
        dummy.quaternion.setFromUnitVectors(up, vel.clone().normalize());
      }
      // Set the thickness. The length (Y) is 1.0 here, we'll stretch it in the shader based on velocity
      dummy.scale.set(thickness, 1.0, thickness);

      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, i * 16);
    }

    instancedGeo.setAttribute("instanceMatrix", new THREE.InstancedBufferAttribute(matrices, 16));
    instancedGeo.setAttribute("randoms", new THREE.InstancedBufferAttribute(randoms, 1));
    instancedGeo.setAttribute("velocityMag", new THREE.InstancedBufferAttribute(velocityMags, 1));

    return { instancedGeo, numInstances: count };
  }, [geometry, velocityData, association, modelScale, downsampleFactor]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        maxTime: { value: 2.0 },
        scale: { value: scale }, // global multiplier for streak speed/length
        colormap: { value: colormapTexture },
        vMin: { value: vMin },
        vMax: { value: vMax },
      },
      vertexShader: `
        attribute float randoms;
        attribute float velocityMag;
        
        uniform float time;
        uniform float maxTime;
        uniform float scale;
        uniform float vMin;
        uniform float vMax;
        
        varying float vAlpha;
        varying float vColorT;

        void main() {
          float t = mod(time + randoms * maxTime, maxTime);
          
          vec3 localPos = position;
          
          // Make the streaks much longer relative to the local velocity magnitude
          float streakLen = velocityMag * scale * 25.0; 
          localPos.y *= streakLen; 
          
          // Move the streak forward along its local Y axis (which is aligned with velocity)
          localPos.y += velocityMag * t * scale * 5.0;
          
          // Fade the tail (local Y goes from -0.5 to 0.5 before scaling)
          float tailFade = smoothstep(-0.5, 0.5, position.y);
          float timeFade = 1.0 - (t / maxTime);
          
          vAlpha = timeFade * tailFade;
          
          vColorT = (vMax > vMin) ? clamp((velocityMag - vMin) / (vMax - vMin), 0.0, 1.0) : 0.5;
          
          vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(localPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D colormap;
        varying float vAlpha;
        varying float vColorT;
        void main() {
          vec4 color = texture2D(colormap, vec2(vColorT, 0.5));
          gl_FragColor = vec4(color.rgb, vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [scale, colormapTexture, vMin, vMax]);

  useEffect(() => {
    return () => {
      instancedGeo.dispose();
    };
  }, [instancedGeo]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((state) => {
    const mat = meshRef.current?.material as THREE.ShaderMaterial | undefined;
    if (mat?.uniforms?.time) {
      mat.uniforms.time.value = state.clock.elapsedTime * 0.5;
    }
  });

  return <instancedMesh ref={meshRef} args={[instancedGeo, material, numInstances]} visible={animate} />;
};
