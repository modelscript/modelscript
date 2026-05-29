/* eslint-disable @typescript-eslint/no-explicit-any */
import { PlayIcon, SquareFillIcon } from "@primer/octicons-react";
import { IconButton, Spinner, Text } from "@primer/react";
import { Environment, Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import React, { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GCodeLoader } from "three/examples/jsm/loaders/GCodeLoader.js";
import Box from "../Box";

interface GCodeViewerProps {
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

const GCodeViewer: React.FC<GCodeViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [object, setObject] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Create a mutable ref to hold progress, avoiding React re-renders for every frame
  const progressRef = useRef(0);

  // We'll sync this state occasionally so the slider can update, but we won't do it every frame
  const [sliderValue, setSliderValue] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadGCode() {
      if (!viewConfig.url) {
        setError("No URL provided in viewConfig");
        return;
      }
      try {
        const response = await fetch(viewConfig.url);
        if (!response.ok) throw new Error("Failed to fetch GCode");
        const text = await response.text();

        if (active) {
          const loader = new GCodeLoader();
          const obj = loader.parse(text);

          // Robust centering using center-of-mass to ignore long outlier travel moves
          const center = new THREE.Vector3();
          let totalVertices = 0;

          obj.traverse((child: any) => {
            if ((child.isLine || child.isLineSegments) && child.geometry?.attributes?.position) {
              const pos = child.geometry.attributes.position;
              for (let i = 0; i < pos.count; i++) {
                center.x += pos.getX(i);
                center.y += pos.getY(i);
                center.z += pos.getZ(i);
                totalVertices++;
              }
            }
          });

          if (totalVertices > 0) {
            center.divideScalar(totalVertices);

            obj.traverse((child: any) => {
              if ((child.isLine || child.isLineSegments) && child.geometry) {
                child.geometry.translate(-center.x, -center.y, -center.z);
              }
            });

            // Robust scaling using 99th percentile radius
            const dists = new Float32Array(totalVertices);
            let idx = 0;
            obj.traverse((child: any) => {
              if ((child.isLine || child.isLineSegments) && child.geometry?.attributes?.position) {
                const pos = child.geometry.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                  const x = pos.getX(i);
                  const y = pos.getY(i);
                  const z = pos.getZ(i);
                  dists[idx++] = Math.sqrt(x * x + y * y + z * z);
                }
              }
            });

            dists.sort();
            const radius = dists[Math.floor(totalVertices * 0.99)] || 1;
            const maxDim = radius * 2;

            const scale = 80 / maxDim;
            obj.scale.setScalar(scale);
          }

          setObject(obj);
          setTimeout(() => {
            (window as any).__ARTIFACT_READY = true;
          }, 1500);
        }
      } catch (err: any) {
        if (active) setError(err.message || "Error parsing GCode");
        (window as any).__ARTIFACT_READY = true;
      }
    }

    loadGCode();

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

  if (!object) {
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
        <Text ml={3}>Parsing GCode...</Text>
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
      position="relative"
    >
      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 100], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={0.5} />

        <Suspense fallback={<Loader />}>
          <Environment files="/hdri/studio.hdr" />
          <AnimatedGCode
            object={object}
            isPlaying={isPlaying}
            progressRef={progressRef}
            onProgressUpdate={setSliderValue}
          />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>

      {/* Animation Controls Overlay */}
      <Box
        position="absolute"
        bottom="16px"
        left="50%"
        style={{ transform: "translateX(-50%)" }}
        display="flex"
        alignItems="center"
        bg="var(--color-canvas-overlay)"
        boxShadow="var(--color-shadow-medium)"
        borderRadius="20px"
        px={3}
        py={2}
        gap={3}
        width="80%"
        maxWidth="400px"
      >
        <IconButton
          icon={isPlaying ? SquareFillIcon : PlayIcon}
          aria-label={isPlaying ? "Pause" : "Play"}
          variant="invisible"
          size="small"
          onClick={() => setIsPlaying(!isPlaying)}
        />
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={sliderValue}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            progressRef.current = val;
            setSliderValue(val);
          }}
          style={{ flexGrow: 1, cursor: "pointer" }}
        />
      </Box>
    </Box>
  );
};

// Extracted inner component to use useFrame hook
function AnimatedGCode({
  object,
  isPlaying,
  progressRef,
  onProgressUpdate,
}: {
  object: THREE.Group;
  isPlaying: boolean;
  progressRef: React.MutableRefObject<number>;
  onProgressUpdate: (val: number) => void;
}) {
  const lastUpdateRef = useRef(0);
  const spindleRef = useRef<THREE.Group>(null);
  const spindlePos = useRef(new THREE.Vector3());

  useFrame((_state, delta) => {
    if (isPlaying) {
      // 20 seconds for full animation
      progressRef.current += delta * 0.05;
      if (progressRef.current >= 1) {
        progressRef.current = 1;
      }

      // Throttle state updates to avoid excessive re-renders (e.g., 10 times a second)
      const now = performance.now();
      if (now - lastUpdateRef.current > 100) {
        onProgressUpdate(progressRef.current);
        lastUpdateRef.current = now;
      }
    }

    let totalVertices = 0;
    object.traverse((child: any) => {
      if ((child.isLine || child.isLineSegments) && child.geometry?.attributes?.position) {
        totalVertices += child.geometry.attributes.position.count;
      }
    });

    let currentVertices = Math.floor(totalVertices * progressRef.current);
    let foundSpindlePos = false;

    object.traverse((child: any) => {
      if ((child.isLine || child.isLineSegments) && child.geometry?.attributes?.position) {
        const count = child.geometry.attributes.position.count;
        if (currentVertices >= count) {
          child.geometry.setDrawRange(0, count);
          currentVertices -= count;

          if (currentVertices === 0 && !foundSpindlePos) {
            const attr = child.geometry.attributes.position;
            spindlePos.current.fromBufferAttribute(attr, count - 1);
            child.updateWorldMatrix(true, false);
            spindlePos.current.applyMatrix4(child.matrixWorld);
            foundSpindlePos = true;
          }
        } else if (currentVertices > 0) {
          child.geometry.setDrawRange(0, currentVertices);
          if (!foundSpindlePos) {
            const attr = child.geometry.attributes.position;
            spindlePos.current.fromBufferAttribute(attr, currentVertices - 1);
            child.updateWorldMatrix(true, false);
            spindlePos.current.applyMatrix4(child.matrixWorld);
            foundSpindlePos = true;
          }
          currentVertices = 0;
        } else {
          child.geometry.setDrawRange(0, 0);
        }
      }
    });

    if (foundSpindlePos && spindleRef.current) {
      spindleRef.current.position.copy(spindlePos.current);
    }
  });

  return (
    <>
      <primitive object={object} />
      <group ref={spindleRef}>
        <mesh rotation={[Math.PI, 0, 0]} position={[0, 2, 0]}>
          <coneGeometry args={[0.5, 4, 16]} />
          <meshStandardMaterial color="#e74c3c" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh rotation={[0, 0, 0]} position={[0, 6, 0]}>
          <cylinderGeometry args={[1.5, 1.5, 4, 16]} />
          <meshStandardMaterial color="#7f8c8d" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
    </>
  );
}

export default GCodeViewer;
