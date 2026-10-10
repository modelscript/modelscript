// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * InstancedCadAssembly — High-performance Three.js InstancedMesh renderer
 * for large CAD assemblies in the VS Code IDE webview.
 *
 * Clusters repeated CAD models into GPU InstancedMesh batches, bypasses
 * scene-graph overhead during animations via direct Float32Array matrix updates,
 * and maintains instance selection and hover parity.
 */

import {
  AssemblyClusteringEngine,
  composeTransformMatrixDirect,
  type InstanceCluster,
  type InstancedPartDescriptor,
} from "@modelscript/cad";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import type { CadComponent } from "./cad-viewer";

function resolveModelicaUri(uri: string, baseUrl: string): string {
  const match = uri.match(/^modelica:\/\/([^/]+)\/(.+)$/);
  if (!match) return uri;
  const [, libraryName, resourcePath] = match;
  return `${baseUrl}/${libraryName}/latest/resources/${resourcePath}`;
}

interface InstancedCadClusterProps {
  cluster: InstanceCluster;
  assetBaseUrl: string;
  selectedName?: string | null;
  onSelect?: (name: string | null) => void;
  animationController?: AnimationController | null;
}

function InstancedCadCluster({
  cluster,
  assetBaseUrl,
  selectedName,
  onSelect,
  animationController,
}: InstancedCadClusterProps) {
  const url = useMemo(() => resolveModelicaUri(cluster.geometryKey, assetBaseUrl), [cluster.geometryKey, assetBaseUrl]);

  const { scene } = useGLTF(url);
  const instancedMeshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Extract all sub-meshes from the loaded template GLTF model
  const templateMeshes = useMemo(() => {
    const meshes: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const mat = child.material
          ? Array.isArray(child.material)
            ? child.material.map((m) => m.clone())[0]
            : child.material.clone()
          : new THREE.MeshStandardMaterial({ color: "#cccccc" });
        meshes.push({
          geometry: child.geometry,
          material: mat,
        });
      }
    });
    return meshes;
  }, [scene]);

  // Initial matrix and color buffer upload to GPU InstancedMesh
  useEffect(() => {
    const selectedIdx = selectedName ? cluster.instanceNames.indexOf(selectedName) : -1;

    for (const mesh of instancedMeshRefs.current) {
      if (!mesh) continue;

      const count = cluster.count;
      const mat = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        mat.fromArray(cluster.batchBuffer.matrixBuffer, i * 16);
        mesh.setMatrixAt(i, mat);
      }
      mesh.instanceMatrix.needsUpdate = true;

      const col = new THREE.Color();
      for (let i = 0; i < count; i++) {
        if (i === selectedIdx) {
          col.set("#38bdf8"); // Highlight sky-blue in IDE theme
        } else if (i === hoveredIndex) {
          col.set("#f97316"); // Hover orange
        } else {
          col.setRGB(
            cluster.batchBuffer.colorBuffer[i * 3 + 0],
            cluster.batchBuffer.colorBuffer[i * 3 + 1],
            cluster.batchBuffer.colorBuffer[i * 3 + 2],
          );
        }
        mesh.setColorAt(i, col);
      }
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }, [cluster, selectedName, hoveredIndex]);

  // Animation frame update: direct Float32Array writing
  useFrame(() => {
    if (!animationController || animationController.mode === "stopped") return;

    let hasUpdate = false;
    const count = cluster.count;
    const matrixBuf = cluster.batchBuffer.matrixBuffer;

    for (let i = 0; i < count; i++) {
      const name = cluster.instanceNames[i];
      const tf = animationController.getTransform(name);

      composeTransformMatrixDirect(matrixBuf, i * 16, tf.position, tf.quaternion ?? tf.rotation, tf.scale);
      hasUpdate = true;
    }

    if (hasUpdate) {
      const mat = new THREE.Matrix4();
      for (const mesh of instancedMeshRefs.current) {
        if (!mesh) continue;
        for (let i = 0; i < count; i++) {
          mat.fromArray(matrixBuf, i * 16);
          mesh.setMatrixAt(i, mat);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  const handleClick = useCallback(
    (e: any) => {
      e.stopPropagation();
      const instanceId = e.instanceId;
      if (instanceId !== undefined && instanceId < cluster.instanceNames.length) {
        onSelect?.(cluster.instanceNames[instanceId]);
      }
    },
    [cluster.instanceNames, onSelect],
  );

  const handlePointerOver = useCallback((e: any) => {
    e.stopPropagation();
    const instanceId = e.instanceId;
    if (instanceId !== undefined) {
      setHoveredIndex(instanceId);
    }
  }, []);

  const handlePointerOut = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  return (
    <group name={`cluster:${cluster.geometryKey}`}>
      {templateMeshes.map((m, idx) => (
        <instancedMesh
          key={idx}
          ref={(el) => {
            instancedMeshRefs.current[idx] = el;
          }}
          args={[m.geometry, m.material, cluster.count]}
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
      ))}
    </group>
  );
}

export interface InstancedCadAssemblyProps {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null;
  onSelect?: (name: string | null) => void;
  animationController?: AnimationController | null;
  minInstanceCount?: number;
  renderSingleton: (component: CadComponent) => React.ReactNode;
}

export function InstancedCadAssembly({
  components,
  assetBaseUrl,
  selectedName,
  onSelect,
  animationController,
  minInstanceCount = 2,
  renderSingleton,
}: InstancedCadAssemblyProps) {
  const { clusters, singletonComponents } = useMemo(() => {
    const descriptors: InstancedPartDescriptor[] = components.map((comp) => ({
      name: comp.name,
      geometryKey: comp.cad.uri,
      position: comp.cad.position ?? [0, 0, 0],
      rotation: comp.cad.rotation ?? [0, 0, 0],
      scale: comp.cad.scale ?? [1, 1, 1],
    }));

    const result = AssemblyClusteringEngine.cluster(descriptors, { minInstanceCount });

    const singletonMap = new Map(components.map((c) => [c.name, c]));
    const singletonComps = result.singletons
      .map((s) => singletonMap.get(s.name))
      .filter((c): c is CadComponent => c !== undefined);

    return {
      clusters: result.clusters,
      singletonComponents: singletonComps,
    };
  }, [components, minInstanceCount]);

  return (
    <group name="instanced-assembly">
      {clusters.map((cluster) => (
        <InstancedCadCluster
          key={cluster.geometryKey}
          cluster={cluster}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          onSelect={onSelect}
          animationController={animationController}
        />
      ))}

      {singletonComponents.map((comp) => renderSingleton(comp))}
    </group>
  );
}
