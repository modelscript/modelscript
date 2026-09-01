import { Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import React, { Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { GCodeLoader } from "three/examples/jsm/loaders/GCodeLoader.js";

// @ts-expect-error acquireVsCodeApi is injected
const vscode = (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi?.();

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "var(--vscode-foreground)" }}
      >
        <div style={{ marginTop: "8px" }}>{progress.toFixed(0)}% loaded</div>
      </div>
    </Html>
  );
}

function GCodeApp() {
  const [object, setObject] = useState<THREE.Group | null>(null);
  const [error] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Create a mutable ref to hold progress
  const progressRef = React.useRef(0);

  // Throttle syncing this state occasionally so the slider can update
  const [sliderValue, setSliderValue] = useState(0);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "gcodeData") {
        try {
          const loader = new GCodeLoader();
          const obj = loader.parse(message.data);

          // Center the geometry
          const box = new THREE.Box3().setFromObject(obj);
          const center = new THREE.Vector3();
          box.getCenter(center);
          obj.position.sub(center);

          // Scale it to fit nicely within standard camera range if it's too big
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            const scale = 50 / maxDim;
            obj.scale.setScalar(scale);
          }

          setObject(obj);
        } catch (err: unknown) {
          vscode.postMessage({ type: "error", message: err instanceof Error ? err.message : "Failed to parse GCode" });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    // @ts-expect-error acquireVsCodeApi is injected
    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  if (error) {
    return <div style={{ padding: "20px", color: "var(--vscode-errorForeground)" }}>Error: {error}</div>;
  }

  if (!object) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
          color: "var(--vscode-foreground)",
        }}
      >
        <span style={{ marginLeft: "10px" }}>Parsing GCode...</span>
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 100], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={0.5} />
        <Suspense fallback={<Loader />}>
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
      <div
        style={{
          position: "absolute",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          backgroundColor: "var(--vscode-editorWidget-background, #252526)",
          border: "1px solid var(--vscode-editorWidget-border, #454545)",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          borderRadius: "8px",
          padding: "8px 16px",
          gap: "12px",
          width: "80%",
          maxWidth: "400px",
        }}
      >
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          style={{
            background: "none",
            border: "none",
            color: "var(--vscode-button-foreground, #ffffff)",
            cursor: "pointer",
            fontSize: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            borderRadius: "4px",
            backgroundColor: "var(--vscode-button-background, #0e639c)",
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
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
      </div>
    </div>
  );
}

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
  const lastUpdateRef = React.useRef(0);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    object.traverse((child: any) => {
      if ((child.isLine || child.isLineSegments) && child.geometry?.attributes?.position) {
        totalVertices += child.geometry.attributes.position.count;
      }
    });

    let currentVertices = Math.floor(totalVertices * progressRef.current);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    object.traverse((child: any) => {
      if ((child.isLine || child.isLineSegments) && child.geometry?.attributes?.position) {
        const count = child.geometry.attributes.position.count;
        if (currentVertices >= count) {
          child.geometry.setDrawRange(0, count);
          currentVertices -= count;
        } else if (currentVertices > 0) {
          child.geometry.setDrawRange(0, currentVertices);
          currentVertices = 0;
        } else {
          child.geometry.setDrawRange(0, 0);
        }
      }
    });
  });

  return <primitive object={object} />;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<GCodeApp />);
}
