import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export interface StepMeshPayload {
  id: number;
  name: string;
  type: string;
  color?: [number, number, number];
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

interface StepViewerProps {
  meshes: StepMeshPayload[];
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  dark?: boolean;
  isLoading?: boolean;
}

function StepModel({
  payload,
  selected,
  onSelect,
}: {
  payload: StepMeshPayload;
  selected: boolean;
  onSelect?: (id: number | null) => void;
  explosionFactor?: number;
  assemblyCenter?: THREE.Vector3;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(payload.vertices, 3));
    if (payload.normals && payload.normals.length > 0) {
      geo.setAttribute("normal", new THREE.BufferAttribute(payload.normals, 3));
    }
    geo.setIndex(new THREE.BufferAttribute(payload.indices, 1));
    if (!payload.normals || payload.normals.length === 0) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingSphere();
    return geo;
  }, [payload]);

  const defaultColor = payload.color
    ? new THREE.Color(payload.color[0], payload.color[1], payload.color[2])
    : new THREE.Color("#aaaaaa");

  const explosionOffset = useMemo(() => {
    if (!assemblyCenter || !explosionFactor) return new THREE.Vector3();
    const center = geometry.boundingSphere?.center || new THREE.Vector3();
    return center.clone().sub(assemblyCenter).multiplyScalar(explosionFactor);
  }, [geometry, assemblyCenter, explosionFactor]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={explosionOffset}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(payload.id);
      }}
      userData={{ stepId: payload.id, type: payload.type, name: payload.name }}
    >
      <meshStandardMaterial
        color={selected ? "#ffaa00" : defaultColor}
        roughness={0.4}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function SceneContents({
  meshes,
  selectedId,
  onSelect,
  dark,
}: {
  meshes: StepMeshPayload[];
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  dark: boolean;
  explosionFactor: number;
}) {
  const { camera } = useThree();
  const assemblyCenterRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useEffect(() => {
    if (!meshes || meshes.length === 0) return;

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
    assemblyCenterRef.current.set(centerX, centerY, centerZ);

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const distance = size * 1.5;

    camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
    camera.lookAt(centerX, centerY, centerZ);
    camera.updateProjectionMatrix();
  }, [meshes, camera]);

  return (
    <>
      <ambientLight intensity={dark ? 0.4 : 0.6} />
      <directionalLight position={[100, 100, 50]} intensity={dark ? 0.8 : 1} castShadow />
      <directionalLight position={[-100, -100, -50]} intensity={0.3} />

      <group rotation={[-Math.PI / 2, 0, 0]}>
        {meshes.map((m) => (
          <StepModel
            key={m.id}
            payload={m}
            selected={m.id === selectedId}
            onSelect={onSelect}
            explosionFactor={explosionFactor}
            assemblyCenter={assemblyCenterRef.current}
          />
        ))}

        <ContactShadows position={[0, 0, 0]} opacity={dark ? 0.4 : 0.25} scale={100} blur={2} far={10} />
      </group>

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </>
  );
}

export default function StepViewer({ meshes, selectedId, onSelect, dark = false, isLoading = false }: StepViewerProps) {
  const [explosionFactor, setExplosionFactor] = useState(0);

  if (!meshes || meshes.length === 0) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#1e1e1e" : "#f5f5f5",
          color: dark ? "#888" : "#aaa",
          fontFamily: "system-ui, sans-serif",
          gap: "1rem",
        }}
      >
        {isLoading ? (
          <>
            <div
              className="spinner"
              style={{
                width: "30px",
                height: "30px",
                border: "3px solid rgba(136, 136, 136, 0.3)",
                borderTop: "3px solid #007acc",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            ></div>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
            <div>Loading CAD Meshes...</div>
          </>
        ) : (
          <div>No CAD Meshes Loaded</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", position: "relative" }}>
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 100,
            background: dark ? "rgba(30, 30, 30, 0.8)" : "rgba(255, 255, 255, 0.8)",
            padding: "5px 10px",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: dark ? "#ccc" : "#333",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="spinner"
            style={{
              width: "12px",
              height: "12px",
              border: "2px solid rgba(136, 136, 136, 0.3)",
              borderTop: `2px solid ${dark ? "#4daafc" : "#007acc"}`,
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          ></div>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          Updating...
        </div>
      )}
      {/* Slider overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          background: dark ? "rgba(30, 30, 30, 0.8)" : "rgba(255, 255, 255, 0.8)",
          padding: "10px 20px",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          color: dark ? "#ccc" : "#333",
          backdropFilter: "blur(4px)",
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600 }}>Explode</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={explosionFactor}
          onChange={(e) => setExplosionFactor(parseFloat(e.target.value))}
          style={{ width: "150px" }}
        />
      </div>

      <Canvas
        shadows
        camera={{ position: [100, 100, 100], fov: 50 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
      >
        <Suspense fallback={null}>
          <SceneContents
            meshes={meshes}
            selectedId={selectedId}
            onSelect={onSelect}
            dark={dark}
            explosionFactor={explosionFactor}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
