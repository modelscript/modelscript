/* eslint-disable @typescript-eslint/no-explicit-any */
import { Spinner, Text } from "@primer/react";
import { Environment, Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import Box from "../Box";
interface CadStepViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <Box
        p={4}
        display="flex"
        justifyContent="center"
        alignItems="center"
        bg="var(--color-canvas-subtle)"
        borderRadius="8px"
        width="200px"
      >
        <Spinner size="medium" />
        <Text ml={3}>{progress.toFixed(0)}% loaded</Text>
      </Box>
    </Html>
  );
}

const CadStepViewer: React.FC<CadStepViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStep() {
      if (!viewConfig.url) {
        setError("No URL provided in viewConfig");
        return;
      }
      try {
        // Fetch the cached/converted CAD geometry from the backend
        const response = await fetch(`/api/v1/cad/convert?url=${encodeURIComponent(viewConfig.url)}`);
        if (!response.ok) throw new Error("Failed to fetch converted CAD geometry from server");

        const result = await response.json();

        if (result && result.meshes && result.meshes.length > 0 && active) {
          // Merge multiple meshes into one BufferGeometry
          const mergedPositions: number[] = [];
          const mergedNormals: number[] = [];
          const mergedIndices: number[] = [];
          let indexOffset = 0;

          for (const meshData of result.meshes) {
            const positions = meshData.attributes.position.array;
            for (let i = 0; i < positions.length; i++) mergedPositions.push(positions[i]);

            if (meshData.attributes.normal) {
              const normals = meshData.attributes.normal.array;
              for (let i = 0; i < normals.length; i++) mergedNormals.push(normals[i]);
            }

            if (meshData.index) {
              const indices = meshData.index.array;
              for (let i = 0; i < indices.length; i++) mergedIndices.push(indices[i] + indexOffset);
            }

            indexOffset += positions.length / 3;
          }

          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(mergedPositions, 3));

          if (mergedNormals.length > 0) {
            geo.setAttribute("normal", new THREE.Float32BufferAttribute(mergedNormals, 3));
          } else {
            geo.computeVertexNormals();
          }

          if (mergedIndices.length > 0) {
            geo.setIndex(new THREE.Uint32BufferAttribute(mergedIndices, 1));
          }

          // Center the geometry and normalize its scale to fit the camera
          geo.computeBoundingBox();
          if (geo.boundingBox) {
            const center = new THREE.Vector3();
            geo.boundingBox.getCenter(center);
            geo.translate(-center.x, -center.y, -center.z);
          }
          geo.computeBoundingSphere();
          if (geo.boundingSphere && geo.boundingSphere.radius > 0) {
            const scale = 20 / geo.boundingSphere.radius;
            geo.scale(scale, scale, scale);
          }

          setGeometry(geo);
          setTimeout(() => {
            (window as any).__ARTIFACT_READY = true;
          }, 100);
        } else if (active) {
          setError("No meshes found in STEP file");
        }
      } catch (err: any) {
        if (active) setError(err.message || "Error parsing STEP file");
        (window as any).__ARTIFACT_READY = true;
      }
    }

    loadStep();

    return () => {
      active = false;
    };
  }, [viewConfig.url]);

  if (error) {
    return (
      <Box p={3} backgroundColor="var(--color-danger-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">{error}</Text>
      </Box>
    );
  }

  if (!geometry) {
    return (
      <Box
        p={4}
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="300px"
        bg="var(--color-canvas-subtle)"
        borderRadius="8px"
      >
        <Spinner size="medium" />
        <Text ml={3}>Parsing CAD model...</Text>
      </Box>
    );
  }

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "400px"}
      bg="var(--color-canvas-subtle)"
      borderRadius={isFullScreen ? "0" : "8px"}
      overflow="hidden"
    >
      <Canvas camera={{ position: [0, 0, 50], fov: 50 }}>
        <ambientLight intensity={0.3} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={0.3} castShadow />

        <Suspense fallback={<Loader />}>
          {/* Local HDRI Texture */}
          <Environment files="/hdri/studio.hdr" />
          <mesh geometry={geometry}>
            <meshPhysicalMaterial
              color="#8a929a"
              metalness={0.15}
              roughness={0.65}
              clearcoat={0.0}
              side={THREE.DoubleSide}
            />
          </mesh>
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </Box>
  );
};

export default CadStepViewer;
