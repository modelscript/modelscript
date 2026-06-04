/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CfdAnimationViewer
 *
 * Interactive 3D viewer for CFD melt-front animations.
 * Plays back time-stepped mesh frames with per-vertex scalar coloring,
 * a timeline scrubber, playback controls, and a color legend.
 */

import { Spinner, Text } from "@primer/react";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Box from "../Box";

// ── Types ───────────────────────────────────────────────────────

interface CfdAnimationViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

interface CfdFrame {
  time: number;
  geometry?: {
    positions: number[];
    normals: number[];
    indices: number[];
  };
  fields: {
    "alpha.polymer": number[];
    temperature: number[];
  };
}

// ── Color Ramp ──────────────────────────────────────────────────

/** Convert alpha.polymer (0→1) and temperature to a color */
function alphaToColor(alpha: number, temp: number, target: THREE.Color): void {
  if (alpha < 0.01) {
    // Empty cavity — dark blue-gray
    target.setRGB(0.1, 0.1, 0.2);
  } else {
    // Map temperature to jet color map (300K -> 513K)
    const t = Math.max(0, Math.min(1, (temp - 300) / 213));
    const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
    const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
    const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
    target.setRGB(r, g, b);

    // Smooth transition at the melt front
    if (alpha < 0.5) {
      const edgeFactor = alpha / 0.5;
      const emptyColor = new THREE.Color(0.1, 0.1, 0.2);
      target.lerp(emptyColor, 1 - edgeFactor);
    }
  }
}

// ── Animated Mesh ───────────────────────────────────────────────

const AnimatedMesh: React.FC<{
  baseGeometry: THREE.BufferGeometry;
  colorArrays: Float32Array[];
  frameIndex: number;
}> = ({ baseGeometry, colorArrays, frameIndex }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!meshRef.current) return;
    const geo = meshRef.current.geometry;
    const colors = colorArrays[frameIndex];
    if (!colors) return;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }, [frameIndex, colorArrays]);

  return (
    <mesh ref={meshRef} geometry={baseGeometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.1} />
    </mesh>
  );
};

// ── Mold Outline ────────────────────────────────────────────────

const MoldOutline: React.FC<{
  length: number;
  width: number;
  height: number;
  center: THREE.Vector3;
}> = ({ length, width, height, center }) => {
  const geo = useMemo(() => new THREE.BoxGeometry(length, width, height), [length, width, height]);

  return (
    <lineSegments position={center}>
      <edgesGeometry args={[geo]} />
      <lineBasicMaterial color="#4a90d9" transparent opacity={0.35} />
    </lineSegments>
  );
};

// ── Gate Inlet Indicator ────────────────────────────────────────

const GateInlet: React.FC<{ position: [number, number, number] }> = ({ position }) => (
  <mesh position={position}>
    <cylinderGeometry args={[0.003, 0.003, 0.025, 8]} />
    <meshStandardMaterial color="#ff6b35" emissive="#ff6b35" emissiveIntensity={0.5} />
  </mesh>
);

// ── Playback Controller ─────────────────────────────────────────

const PlaybackController: React.FC<{
  playing: boolean;
  frameIndex: number;
  totalFrames: number;
  speed: number;
  setFrameIndex: (i: number) => void;
}> = ({ playing, frameIndex, totalFrames, speed, setFrameIndex }) => {
  const elapsed = useRef(0);
  const frameDuration = 0.08 / speed; // Base: ~80ms per frame at 1×

  useFrame((_, delta) => {
    if (!playing || totalFrames <= 1) return;
    elapsed.current += delta;
    if (elapsed.current >= frameDuration) {
      elapsed.current = 0;
      setFrameIndex((frameIndex + 1) % totalFrames);
    }
  });

  return null;
};

// ── Color Legend ────────────────────────────────────────────────

const colorLegendStops = [
  { t: 1.0, color: "rgb(127, 0, 0)", label: "513 K (Melt)" },
  { t: 0.875, color: "rgb(255, 0, 0)" },
  { t: 0.625, color: "rgb(255, 255, 0)", label: "400 K" },
  { t: 0.375, color: "rgb(0, 255, 255)" },
  { t: 0.125, color: "rgb(0, 0, 255)" },
  { t: 0.0, color: "rgb(25, 25, 51)", label: "300 K (Mold)" },
];

const ColorLegend: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 16,
      top: 16,
      bottom: 60,
      width: 48,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      pointerEvents: "none",
      zIndex: 5,
    }}
  >
    <div
      style={{
        fontSize: 9,
        fontWeight: 600,
        color: "var(--color-fg-default)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 4,
        textAlign: "center",
        lineHeight: 1.2,
      }}
    >
      Temperature
    </div>
    <div
      style={{
        flex: 1,
        width: 16,
        borderRadius: 4,
        border: "1px solid var(--color-border)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(to bottom, ${colorLegendStops.map((s) => s.color).join(", ")})`,
      }}
    />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
        position: "absolute",
        right: 52,
        top: 20,
        bottom: 8,
      }}
    >
      {colorLegendStops
        .filter((s) => s.label)
        .map((s) => (
          <span key={s.t} style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>
            {s.label}
          </span>
        ))}
    </div>
  </div>
);

// ── Control Bar Styles ──────────────────────────────────────────

const controlBarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  display: "flex",
  gap: 12,
  alignItems: "center",
  background: "var(--color-canvas-default)",
  borderTop: "1px solid var(--color-border-default)",
  padding: "8px 16px",
  zIndex: 5,
};

const btnStyle: React.CSSProperties = {
  background: "var(--color-canvas-overlay)",
  color: "var(--color-fg-default)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 600,
  lineHeight: 1,
};

const selectStyle: React.CSSProperties = {
  background: "var(--color-canvas-overlay)",
  color: "var(--color-fg-default)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 11,
  cursor: "pointer",
  outline: "none",
};

// ── Main Component ──────────────────────────────────────────────

const CfdAnimationViewer: React.FC<CfdAnimationViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);

  const isThumbnail = new URLSearchParams(window.location.search).get("thumbnail") === "true";

  // Parse frames from viewConfig
  const frames: CfdFrame[] = useMemo(() => {
    try {
      return viewConfig.frames || [];
    } catch {
      return [];
    }
  }, [viewConfig.frames]);

  // Build geometry from frame 0
  const baseGeometry = useMemo(() => {
    if (frames.length === 0) return null;
    const f0 = frames[0];
    if (!f0.geometry) return null;

    try {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(f0.geometry.positions, 3));
      if (f0.geometry.normals && f0.geometry.normals.length > 0) {
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(f0.geometry.normals, 3));
      }
      if (f0.geometry.indices && f0.geometry.indices.length > 0) {
        geo.setIndex(new THREE.Uint32BufferAttribute(f0.geometry.indices, 1));
      }
      geo.computeVertexNormals();

      // Center and scale for viewing
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        const center = new THREE.Vector3();
        geo.boundingBox.getCenter(center);
        geo.translate(-center.x, -center.y, -center.z);
      }
      geo.computeBoundingSphere();

      return geo;
    } catch (e) {
      setTimeout(() => setError(`Failed to build geometry: ${e}`), 0);
      return null;
    }
  }, [frames]);

  // Precompute vertex color arrays for all frames
  const colorArrays: Float32Array[] = useMemo(() => {
    if (frames.length === 0) return [];

    return frames.map((frame) => {
      const alphaField = frame.fields["alpha.polymer"] || [];
      const tempField = frame.fields.temperature || [];
      const numVerts = alphaField.length;
      const colors = new Float32Array(numVerts * 3);
      const c = new THREE.Color();

      for (let i = 0; i < numVerts; i++) {
        alphaToColor(alphaField[i], tempField[i] || 400, c);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }

      return colors;
    });
  }, [frames]);

  // Compute fill percentage for current frame
  const fillPercent = useMemo(() => {
    if (frames.length === 0) return 0;
    const alphaField = frames[frameIndex]?.fields["alpha.polymer"];
    if (!alphaField) return 0;
    const filled = alphaField.filter((a: number) => a > 0.01).length;
    return (filled / alphaField.length) * 100;
  }, [frames, frameIndex]);

  // Get vertex count
  const vertexCount = useMemo(() => {
    if (frames.length === 0) return 0;
    return frames[0].fields["alpha.polymer"]?.length || 0;
  }, [frames]);

  // Get mold geometry for outline
  const moldGeo = viewConfig.moldGeometry || { length: 0.15, width: 0.1, height: 0.02 };

  // Handle non-looping stop
  const handleSetFrame = useCallback(
    (nextIdx: number) => {
      if (!loop && nextIdx === 0 && frameIndex === frames.length - 1) {
        setPlaying(false);
        return;
      }
      setFrameIndex(nextIdx);
    },
    [loop, frameIndex, frames.length],
  );

  // Signal loading complete
  useEffect(() => {
    if (baseGeometry && colorArrays.length > 0) {
      setLoading(false);
      setTimeout(() => {
        (window as any).__ARTIFACT_READY = true;
      }, 800);
    }
  }, [baseGeometry, colorArrays]);

  // ── Error / Loading states ──

  if (error) {
    return (
      <Box p={3} backgroundColor="var(--color-danger-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">{error}</Text>
      </Box>
    );
  }

  if (loading || !baseGeometry) {
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
        <Text ml={3}>Loading CFD animation...</Text>
      </Box>
    );
  }

  const currentTime = frames[frameIndex]?.time ?? 0;

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "450px"}
      bg="var(--color-canvas-default)"
      borderRadius={isFullScreen ? "0" : "8px"}
      overflow="hidden"
      position="relative"
    >
      {/* Header info bar */}
      {!isThumbnail && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "8px 16px",
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--color-fg-muted)", fontFamily: "monospace" }}>
            {vertexCount.toLocaleString()} vertices · {frames.length} frames
          </span>
          {viewConfig.solverInfo && (
            <span
              style={{
                fontSize: 10,
                color: "var(--color-accent-fg)",
                background: "var(--color-accent-subtle)",
                padding: "1px 8px",
                borderRadius: 10,
                border: "1px solid var(--color-accent-emphasis)",
                fontWeight: 600,
              }}
            >
              {viewConfig.solverInfo.name}
            </span>
          )}
          {viewConfig.modelDescription && (
            <span style={{ fontSize: 10, color: "var(--color-fg-muted)", fontStyle: "italic" }}>
              {viewConfig.modelDescription}
            </span>
          )}
        </div>
      )}

      {/* Color legend */}
      {!isThumbnail && <ColorLegend />}

      {/* 3D Canvas */}
      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 0.35], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[1, 2, 3]} intensity={0.6} />
        <directionalLight position={[-1, -1, 2]} intensity={0.3} />

        <AnimatedMesh baseGeometry={baseGeometry} colorArrays={colorArrays} frameIndex={frameIndex} />

        <MoldOutline
          length={moldGeo.length}
          width={moldGeo.width}
          height={moldGeo.height}
          center={new THREE.Vector3(0, 0, 0)}
        />

        <GateInlet position={[-moldGeo.length / 2, 0, 0]} />

        <PlaybackController
          playing={playing}
          frameIndex={frameIndex}
          totalFrames={frames.length}
          speed={speed}
          setFrameIndex={handleSetFrame}
        />

        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      </Canvas>

      {/* Bottom control bar */}
      {!isThumbnail && (
        <div style={controlBarStyle}>
          {/* Play/Pause */}
          <button
            style={btnStyle}
            onClick={() => {
              if (!playing && frameIndex === frames.length - 1 && !loop) {
                setFrameIndex(0);
              }
              setPlaying(!playing);
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>

          {/* Timeline scrubber */}
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            onChange={(e) => {
              setFrameIndex(Number(e.target.value));
              setPlaying(false);
            }}
            style={{ flex: 1, cursor: "pointer", accentColor: "#ff6b35" }}
          />

          {/* Time display */}
          <span style={{ fontSize: 11, color: "var(--color-fg-default)", fontFamily: "monospace", minWidth: 60 }}>
            t={currentTime.toFixed(3)}s
          </span>

          {/* Fill % */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: fillPercent > 90 ? "#22c55e" : fillPercent > 50 ? "#eab308" : "var(--color-fg-muted)",
              minWidth: 55,
            }}
          >
            Fill: {fillPercent.toFixed(0)}%
          </span>

          {/* Speed selector */}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={selectStyle}>
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>

          {/* Loop toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
              style={{ accentColor: "#8b5cf6", cursor: "pointer", width: 14, height: 14 }}
            />
            <span style={{ color: "var(--color-fg-muted)" }}>Loop</span>
          </label>
        </div>
      )}
    </Box>
  );
};

export default CfdAnimationViewer;
