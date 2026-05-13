import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { AnimationController } from "./cad-viewer/animation-controller";
import { AnimationTimeline } from "./cad-viewer/animation-timeline";
import { extractCadComponents } from "./cad-viewer/parse-cad-annotations";
import type { StepMeshPayload } from "./step-viewer/step-viewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

function AnimatedBody({
  mesh,
  bindingName,
  animationController,
  selected,
  onSelect,
}: {
  mesh: StepMeshPayload;
  bindingName?: string;
  animationController: AnimationController;
  selected: boolean;
  onSelect?: (id: number | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
    if (mesh.normals && mesh.normals.length > 0) {
      geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    }
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (!mesh.normals || mesh.normals.length === 0) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingSphere();
    return geo;
  }, [mesh]);

  useFrame(() => {
    if (!groupRef.current || !bindingName) return;
    if (animationController.mode === "stopped") return;

    // Get the transform components (position is easy, rotation needs special handling)
    const tf = animationController.getTransform(bindingName);

    // Apply Position
    groupRef.current.position.set(tf.position[0], tf.position[1], tf.position[2]);

    // Apply Rotation
    // In our App bindings setup, we mapped the 9 R.T matrix components to tf.rotation array indices 0..8!
    // Since tf.rotation is typed as [number, number, number], the array has been expanded but TypeScript doesn't know.
    // Let's read them safely.
    const rot = tf.rotation as unknown as number[];
    if (rot.length >= 9) {
      // rot contains the 9 elements of Modelica's R.T matrix
      // Modelica's R.T is the TRANSPOSE of the rotation matrix.
      // Three.js Matrix4 takes elements in column-major order if using .set(row1, row2, row3, row4),
      // wait, Matrix4.set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34...)
      // The arguments to .set are row-major!
      // So if rot = [T11, T12, T13, T21, T22, T23, T31, T32, T33], and it's the transpose,
      // the actual rotation matrix rows are the columns of R.T.
      // Row 1: T11, T21, T31
      // Row 2: T12, T22, T32
      // Row 3: T13, T23, T33
      const mat = new THREE.Matrix4().set(
        rot[0],
        rot[3],
        rot[6],
        0,
        rot[1],
        rot[4],
        rot[7],
        0,
        rot[2],
        rot[5],
        rot[8],
        0,
        0,
        0,
        0,
        1,
      );
      const quat = new THREE.Quaternion().setFromRotationMatrix(mat);
      groupRef.current.quaternion.copy(quat);
    }
  });

  const defaultColor = mesh.color
    ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
    : new THREE.Color("#aaaaaa");

  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(mesh.id);
        }}
        userData={{ stepId: mesh.id, type: mesh.type, name: mesh.name }}
      >
        <meshStandardMaterial
          color={selected ? "#ffaa00" : defaultColor}
          roughness={0.4}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function SceneContents({
  meshes,
  animationController,
  selectedId,
  onSelect,
  dark,
}: {
  meshes: StepMeshPayload[];
  animationController: AnimationController;
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  dark: boolean;
}) {
  const { camera } = useThree();

  useEffect(() => {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    meshes.forEach((m) => {
      for (let i = 0; i < m.vertices.length; i += 3) {
        const x = m.vertices[i];
        const y = m.vertices[i + 1];
        const z = m.vertices[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const distance = size * 1.5;

    camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
    camera.lookAt(centerX, centerY, centerZ);
    camera.updateProjectionMatrix();
  }, [meshes, camera]);

  // Drive the animation clock from the render loop
  useFrame((_, delta) => {
    animationController.tick(delta);
  });

  return (
    <>
      <ambientLight intensity={dark ? 0.4 : 0.6} />
      <directionalLight position={[100, 100, 50]} intensity={dark ? 0.8 : 1} castShadow />
      <directionalLight position={[-100, -100, -50]} intensity={0.3} />

      <group rotation={[-Math.PI / 2, 0, 0]}>
        {meshes.map((m) => {
          // The CAD component feature name usually matches the mesh name, or we just map by index/name.
          // For now, let's assume the mesh name matches the binding component name (e.g., "Link")
          return (
            <AnimatedBody
              key={m.id}
              mesh={m}
              bindingName={m.name} // Matches the componentName registered in AnimationController
              animationController={animationController}
              selected={m.id === selectedId}
              onSelect={onSelect}
            />
          );
        })}

        <ContactShadows position={[0, 0, 0]} opacity={dark ? 0.4 : 0.25} scale={100} blur={2} far={10} />
      </group>

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </>
  );
}

function App() {
  const [meshes, setMeshes] = useState<StepMeshPayload[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [isDark, setIsDark] = useState<boolean>(true);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const updateTheme = () => {
      const isDarkTheme =
        document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
      setIsDark(isDarkTheme);
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "init") {
        const { stepMeshes, cadComponents, simulationData } = message.data;

        // 1. Load Meshes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawMeshes: StepMeshPayload[] = (stepMeshes || []).map((m: any) => ({
          ...m,
          vertices: m.vertices instanceof Float32Array ? m.vertices : new Float32Array(Object.values(m.vertices || {})),
          normals: m.normals instanceof Float32Array ? m.normals : new Float32Array(Object.values(m.normals || {})),
          indices: m.indices instanceof Uint32Array ? m.indices : new Uint32Array(Object.values(m.indices || {})),
        }));
        setMeshes(rawMeshes);

        // 2. Setup AnimationController
        let ctrl = animationControllerRef.current;
        if (!ctrl) {
          ctrl = new AnimationController();
          animationControllerRef.current = ctrl;
        }

        // 3. Load Simulation Data
        if (simulationData) {
          ctrl.loadTimeseries(simulationData.t, simulationData.y, simulationData.states);
        }

        // 4. Setup Bindings from CAD Components
        const parsedCad = extractCadComponents(cadComponents || []);

        // We must map `dynamicPosition` and `dynamicRotation` to the `bindings` array expected by AnimationController.
        // Wait, AnimationController expects `property`, `index`, `variable`.
        // We will override AnimatedBody's useFrame to read the variables directly since R.T needs to be converted to a quaternion.
        // For simplicity, we just inject the raw variables into the controller's tracking.
        const bindings = parsedCad.map((c) => {
          const compBindings: { property: "position" | "rotation" | "scale"; index: number; variable: string }[] = [];

          if (c.cad.dynamicPosition) {
            // dynamicPosition is something like "{body1.frame_a.r_0[1], body1.frame_a.r_0[2], body1.frame_a.r_0[3]}"
            const match = c.cad.dynamicPosition.match(/\{([^,]+),\s*([^,]+),\s*([^}]+)\}/);
            if (match) {
              compBindings.push({ property: "position", index: 0, variable: match[1].trim() });
              compBindings.push({ property: "position", index: 1, variable: match[2].trim() });
              compBindings.push({ property: "position", index: 2, variable: match[3].trim() });
            }
          }

          if (c.cad.dynamicRotation) {
            // dynamicRotation is "body1.frame_a.R.T"
            // Modelica R.T is a 3x3 array.
            const prefix = c.cad.dynamicRotation;
            compBindings.push({ property: "rotation", index: 0, variable: `${prefix}[1,1]` });
            compBindings.push({ property: "rotation", index: 1, variable: `${prefix}[1,2]` });
            compBindings.push({ property: "rotation", index: 2, variable: `${prefix}[1,3]` });
            compBindings.push({ property: "rotation", index: 3, variable: `${prefix}[2,1]` });
            compBindings.push({ property: "rotation", index: 4, variable: `${prefix}[2,2]` });
            compBindings.push({ property: "rotation", index: 5, variable: `${prefix}[2,3]` });
            compBindings.push({ property: "rotation", index: 6, variable: `${prefix}[3,1]` });
            compBindings.push({ property: "rotation", index: 7, variable: `${prefix}[3,2]` });
            compBindings.push({ property: "rotation", index: 8, variable: `${prefix}[3,3]` });
          }

          return {
            // We use the feature name if available, otherwise the component name
            componentName: c.cad.feature || c.name,
            bindings: compBindings,
          };
        });

        ctrl.setBindings(bindings);

        forceUpdate((n) => n + 1);
      } else if (message.type === "liveValues") {
        const ctrl = animationControllerRef.current;
        if (ctrl) {
          const values = new Map<string, number>(Object.entries(message.data.values));
          ctrl.pushLiveBatch(values, message.data.time);
          if (ctrl.mode !== "live") {
            ctrl.goLive();
            forceUpdate((n) => n + 1);
          }
        }
      }
    };
    window.addEventListener("message", handleMessage);

    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
      observer.disconnect();
    };
  }, []);

  const handleSelect = (id: number | null) => {
    setSelectedId(id || undefined);
  };

  return (
    <div
      className="multibody-webview-container"
      style={{ width: "100%", height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
    >
      {meshes.length === 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isDark ? "#1e1e1e" : "#f5f5f5",
            color: isDark ? "#888" : "#aaa",
          }}
        >
          Loading 3D Animation...
        </div>
      ) : (
        <>
          <Canvas
            shadows
            camera={{ position: [100, 100, 100], fov: 50 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
            style={{ background: isDark ? "#1a1a2e" : "#f0f4f8" }}
          >
            {animationControllerRef.current && (
              <SceneContents
                meshes={meshes}
                animationController={animationControllerRef.current}
                selectedId={selectedId}
                onSelect={handleSelect}
                dark={isDark}
              />
            )}
          </Canvas>
          {animationControllerRef.current && <AnimationTimeline controller={animationControllerRef.current} />}
        </>
      )}
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
