// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, SquareFillIcon } from "@primer/octicons-react";
import { IconButton, Text } from "@primer/react";
import { Environment, Html, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import React, { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GCodeLoader } from "three/examples/jsm/loaders/GCodeLoader.js";
import { getErrorMessage } from "../../util/error";
import Box from "../Box";
import Spinner from "../Spinner";
import AutoThumbnailCapture from "./AutoThumbnailCapture";
import { registerArtifactRotundaGeometry } from "./RotundaGeometryBridge";
import SafeOrbitControls from "./SafeOrbitControls";
import ViewportCameraControls, { type CameraPreset } from "./ViewportCameraControls";
import { XrSceneBridge, XrViewportOverlay } from "./XrViewportOverlay";

type GCodeLineObject = THREE.Line | THREE.LineSegments;

function isGCodeLineObject(obj: THREE.Object3D): obj is GCodeLineObject {
  return (obj as THREE.Line).isLine === true || (obj as THREE.LineSegments).isLineSegments === true;
}

export interface GCodeViewConfig {
  data?: string | undefined;
  code?: string | undefined;
  gcode?: string | undefined;
  url?: string | undefined;
  downloadUrl?: string | undefined;
  fileUrl?: string | undefined;
  artifactId?: string | number | undefined;
  thumbnailUrl?: string | undefined;
  thumbnail_url?: string | undefined;
  [key: string]: unknown;
}

interface GCodeViewerProps {
  artifactId?: number | undefined;
  viewConfig: GCodeViewConfig;
  isFullScreen?: boolean | undefined;
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

function CameraController({
  controlsRef,
  presetTrigger,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  presetTrigger: { preset: CameraPreset; timestamp: number } | null;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!presetTrigger || !controlsRef.current) return;
    const controls = controlsRef.current;
    const target = controls.target || new THREE.Vector3(0, 0, 0);
    const dist = 100;

    switch (presetTrigger.preset) {
      case "iso": {
        const d = dist / Math.sqrt(3);
        camera.position.set(target.x + d, target.y + d, target.z + d);
        break;
      }
      case "top": {
        camera.position.set(target.x, target.y + dist, target.z + 0.001);
        break;
      }
      case "front": {
        camera.position.set(target.x, target.y, target.z + dist);
        break;
      }
      case "right": {
        camera.position.set(target.x + dist, target.y, target.z);
        break;
      }
      case "reset": {
        camera.position.set(0, 0, 100);
        target.set(0, 0, 0);
        break;
      }
    }
    camera.lookAt(target);
    controls.update();
  }, [presetTrigger, camera, controlsRef]);

  return null;
}

const GCodeViewer: React.FC<GCodeViewerProps> = ({ artifactId, viewConfig, isFullScreen }) => {
  const [object, setObject] = useState<THREE.Group | null>(null);
  const [gcodeLines, setGcodeLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Create a mutable ref to hold progress, avoiding React re-renders for every frame
  const progressRef = useRef(0);

  // We'll sync this state occasionally so the slider can update, but we won't do it every frame
  const [sliderValue, setSliderValue] = useState(0);
  const [presetTrigger, setPresetTrigger] = useState<{ preset: CameraPreset; timestamp: number } | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => {
    let active = true;

    async function loadGCode() {
      setLoading(true);
      setError(null);
      try {
        let text = "";
        const inlineCode = viewConfig?.data || viewConfig?.code || viewConfig?.gcode;
        const targetUrl = viewConfig?.url || viewConfig?.downloadUrl || viewConfig?.fileUrl;

        if (typeof inlineCode === "string" && inlineCode.trim().length > 0) {
          text = inlineCode;
        } else if (targetUrl) {
          const response = await fetch(targetUrl);
          if (!response.ok) throw new Error("Failed to fetch GCode file");
          text = await response.text();
        } else {
          if (active) {
            setGcodeLines([]);
            setObject(null);
            setLoading(false);
          }
          window.__ARTIFACT_READY = true;
          return;
        }

        if (active && text) {
          setGcodeLines(text.split(/\r?\n/));
          const loader = new GCodeLoader();
          const obj = loader.parse(text);

          // Robust centering using center-of-mass to ignore long outlier travel moves
          const center = new THREE.Vector3();
          let totalVertices = 0;

          obj.traverse((child: THREE.Object3D) => {
            if (isGCodeLineObject(child) && child.geometry?.attributes?.position) {
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

            obj.traverse((child: THREE.Object3D) => {
              if (isGCodeLineObject(child) && child.geometry) {
                child.geometry.translate(-center.x, -center.y, -center.z);
              }
            });

            // Robust scaling using 99th percentile radius
            const dists = new Float32Array(totalVertices);
            let idx = 0;
            obj.traverse((child: THREE.Object3D) => {
              if (isGCodeLineObject(child) && child.geometry?.attributes?.position) {
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
          setLoading(false);
          setTimeout(() => {
            window.__ARTIFACT_READY = true;
          }, 1500);
        } else if (active) {
          setGcodeLines([]);
          setObject(null);
          setLoading(false);
          window.__ARTIFACT_READY = true;
        }
      } catch (err: unknown) {
        if (active) {
          setError(getErrorMessage(err, "Error parsing GCode"));
          setLoading(false);
        }
        window.__ARTIFACT_READY = true;
      }
    }

    loadGCode();

    return () => {
      active = false;
    };
  }, [viewConfig]);

  useEffect(() => {
    if (!object) return;
    const rawViewArtifactId = viewConfig?.artifactId;
    const bridgeKey =
      (artifactId !== undefined && artifactId !== 0 ? artifactId : undefined) ??
      (rawViewArtifactId !== undefined &&
      rawViewArtifactId !== null &&
      String(rawViewArtifactId).trim() !== "" &&
      String(rawViewArtifactId) !== "0"
        ? (rawViewArtifactId as string | number)
        : undefined) ??
      (typeof viewConfig?.url === "string" && viewConfig.url.trim().length > 0 ? viewConfig.url.trim() : undefined);

    if (bridgeKey === undefined) return;

    object.updateMatrixWorld(true);
    const cutSegments: [number, number, number][] = [];
    const rapidSegments: [number, number, number][] = [];
    const tmpVec = new THREE.Vector3();
    const MAX_POINTS_PER_BUCKET = 24000;

    object.traverse((child: THREE.Object3D) => {
      const lineObj = child as THREE.LineSegments;
      if (!(lineObj.isLine || lineObj.isLineSegments) || !lineObj.geometry?.attributes?.position) return;
      const pos = lineObj.geometry.attributes.position;
      const mat = Array.isArray(lineObj.material) ? lineObj.material[0] : lineObj.material;
      const matName = (mat?.name || "").toLowerCase();
      const target = matName === "extruded" ? cutSegments : rapidSegments;
      const remaining = MAX_POINTS_PER_BUCKET - target.length;
      if (remaining < 2) return;

      const usableCount = Math.min(pos.count - (pos.count % 2), remaining - (remaining % 2));
      for (let i = 0; i < usableCount; i++) {
        tmpVec.fromBufferAttribute(pos, i).applyMatrix4(lineObj.matrixWorld);
        target.push([tmpVec.x, tmpVec.y, tmpVec.z]);
      }
    });

    // Pure CNC G-code without extrusion (E) places linear moves in the path bucket; promote to cutSegments
    const resolvedCut = cutSegments.length > 0 ? cutSegments : rapidSegments;
    const resolvedRapid = cutSegments.length > 0 ? rapidSegments : [];

    if (resolvedCut.length === 0 && resolvedRapid.length === 0) return;

    // Retain snapshot across unmount (LRU-capped in registry) so switching to VR Rotunda renders live G-code toolpaths
    registerArtifactRotundaGeometry(bridgeKey, {
      kind: "gcode-path",
      cutSegments: resolvedCut,
      rapidSegments: resolvedRapid,
    });
  }, [artifactId, viewConfig?.artifactId, viewConfig?.url, object]);

  useEffect(() => {
    return () => {
      if (!object) return;
      object.traverse((child: THREE.Object3D) => {
        const disposable = child as THREE.Object3D & {
          geometry?: THREE.BufferGeometry;
          material?: THREE.Material | THREE.Material[];
        };
        if (disposable.geometry && typeof disposable.geometry.dispose === "function") {
          disposable.geometry.dispose();
        }
        if (disposable.material) {
          if (Array.isArray(disposable.material)) {
            disposable.material.forEach((m) => m?.dispose?.());
          } else if (typeof disposable.material.dispose === "function") {
            disposable.material.dispose();
          }
        }
      });
    };
  }, [object]);

  if (error) {
    return (
      <Box p={3} backgroundColor="var(--color-danger-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">{error}</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box
        p={4}
        display="flex"
        justifyContent="center"
        alignItems="center"
        height={isFullScreen ? "100%" : "450px"}
        bg="var(--color-canvas-subtle)"
        borderRadius="0"
      >
        <Spinner size="medium" />
        <Text ml={3}>Parsing GCode...</Text>
      </Box>
    );
  }

  if (!object || gcodeLines.length === 0) {
    return (
      <Box
        p={4}
        display="flex"
        justifyContent="center"
        alignItems="center"
        height={isFullScreen ? "100%" : "450px"}
        bg="var(--color-canvas-subtle)"
        borderRadius="0"
      >
        <Text color="var(--color-fg-muted)">No G-Code toolpath provided</Text>
      </Box>
    );
  }

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "450px"}
      borderRadius="0"
      overflow="hidden"
      position="relative"
      style={{ background: "transparent" }}
    >
      <ViewportCameraControls onPresetSelect={(preset) => setPresetTrigger({ preset, timestamp: Date.now() })} />

      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 100], fov: 50 }}>
        <AutoThumbnailCapture
          artifactId={artifactId}
          hasThumbnail={Boolean(viewConfig.thumbnailUrl || viewConfig.thumbnail_url)}
        />
        <XrSceneBridge>
          <ambientLight intensity={0.5} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={0.5} />

          <Suspense fallback={null}>
            <Environment files="/hdri/studio.hdr" />
          </Suspense>
          <Suspense fallback={<Loader />}>
            <AnimatedGCode
              object={object}
              isPlaying={isPlaying}
              speed={speed}
              progressRef={progressRef}
              onProgressUpdate={setSliderValue}
              onCompleted={() => setIsPlaying(false)}
            />
            <CameraController controlsRef={controlsRef} presetTrigger={presetTrigger} />
          </Suspense>
          <SafeOrbitControls controlsRef={controlsRef} isFullScreen={isFullScreen} />
        </XrSceneBridge>
      </Canvas>
      <XrViewportOverlay position="top-right" />

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
        maxWidth="440px"
      >
        <IconButton
          icon={isPlaying ? SquareFillIcon : PlayIcon}
          aria-label={isPlaying ? "Pause" : "Play"}
          variant="invisible"
          size="small"
          onClick={() => {
            if (!isPlaying && progressRef.current >= 1) {
              progressRef.current = 0;
              setSliderValue(0);
            }
            setIsPlaying(!isPlaying);
          }}
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
        <button
          type="button"
          onClick={() => {
            const speeds = [0.5, 1, 2, 5];
            const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
            setSpeed(speeds[nextIdx]!);
          }}
          style={{
            background: "rgba(6, 182, 212, 0.15)",
            border: "1px solid rgba(6, 182, 212, 0.35)",
            borderRadius: "4px",
            color: "var(--color-accent-cyan, #06b6d4)",
            fontSize: "10.5px",
            fontWeight: 700,
            fontFamily: "var(--font-mono, monospace)",
            padding: "2px 6px",
            cursor: "pointer",
          }}
          title="Cycle playback speed"
          aria-label={`Playback speed: ${speed}x`}
        >
          {speed}×
        </button>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--color-accent-cyan, #06b6d4)",
            minWidth: "36px",
            textAlign: "right",
          }}
        >
          {(sliderValue * 100).toFixed(0)}%
        </span>
      </Box>
    </Box>
  );
};

// Extracted inner component to use useFrame hook
function AnimatedGCode({
  object,
  isPlaying,
  speed = 1,
  progressRef,
  onProgressUpdate,
  onCompleted,
}: {
  object: THREE.Group;
  isPlaying: boolean;
  speed?: number;
  progressRef: React.MutableRefObject<number>;
  onProgressUpdate: (val: number) => void;
  onCompleted?: () => void;
}) {
  const lastUpdateRef = useRef(0);
  const spindleRef = useRef<THREE.Group>(null);
  const spindlePos = useRef(new THREE.Vector3());

  useFrame((_state, delta) => {
    if (isPlaying) {
      // 20 seconds for full animation at 1x
      progressRef.current += delta * 0.05 * speed;
      if (progressRef.current >= 1) {
        progressRef.current = 1;
        onCompleted?.();
      }

      // Throttle state updates to avoid excessive re-renders (e.g., 10 times a second)
      const now = performance.now();
      if (now - lastUpdateRef.current > 100) {
        onProgressUpdate(progressRef.current);
        lastUpdateRef.current = now;
      }
    }

    let totalVertices = 0;
    object.traverse((child: THREE.Object3D) => {
      if (isGCodeLineObject(child) && child.geometry?.attributes?.position) {
        totalVertices += child.geometry.attributes.position.count;
      }
    });

    let currentVertices = Math.floor(totalVertices * progressRef.current);
    let foundSpindlePos = false;

    object.traverse((child: THREE.Object3D) => {
      if (isGCodeLineObject(child) && child.geometry?.attributes?.position) {
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
