/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment */
import { Spinner, Text } from "@primer/react";
import { OrbitControls, Stage } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import Box from "../Box";
// @ts-ignore
import occtimportjs from "occt-import-js";

interface CadStepViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
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
        // Fetch the STEP file
        const response = await fetch(viewConfig.url);
        if (!response.ok) throw new Error("Failed to fetch STEP file");
        const buffer = await response.arrayBuffer();

        // Initialize OCCT
        const occt = await occtimportjs();

        // Read the file from memory
        const fileData = new Uint8Array(buffer);
        const result = occt.ReadStepFile(fileData, null);

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

          setGeometry(geo);
        } else if (active) {
          setError("No meshes found in STEP file");
        }
      } catch (err: any) {
        if (active) setError(err.message || "Error parsing STEP file");
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
        <Suspense fallback={null}>
          <Stage environment="city" intensity={0.5}>
            <mesh geometry={geometry}>
              <meshStandardMaterial color="#888888" roughness={0.4} metalness={0.6} side={THREE.DoubleSide} />
            </mesh>
          </Stage>
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </Box>
  );
};

export default CadStepViewer;
