/* eslint-disable @typescript-eslint/no-explicit-any */
import { PlayIcon } from "@primer/octicons-react";
import { Button, Dialog, FormControl, Spinner, Text, TextInput } from "@primer/react";
import { Environment, Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [geometries, setGeometries] = useState<THREE.BufferGeometry[] | null>(null);
  const [assemblyCenter, setAssemblyCenter] = useState<THREE.Vector3 | null>(null);
  const [assemblyScale, setAssemblyScale] = useState<number>(1);
  const [explosionFactor, setExplosionFactor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Physics Config State
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [className, setClassName] = useState("SimulationConfig");
  const [config, setConfig] = useState<any>({ parameters: {} });
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadConfig = async () => {
    setIsLoadingConfig(true);
    try {
      const res = await fetch(`/api/v1/physics/flattenStudy?className=${encodeURIComponent(className)}`);
      if (!res.ok) throw new Error("Failed to load study configuration");
      const data = await res.json();
      setConfig(data);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const updateField = (key: string, value: unknown) => {
    setConfig((prev: any) => ({
      ...prev,
      parameters: {
        ...prev.parameters,
        [key]: value,
      },
    }));
  };

  const runSimulation = async () => {
    setIsSubmitting(true);
    try {
      const runConfig = {
        type: config.workflowClass?.includes("FEA") ? "FEA" : config.workflowClass?.includes("CFD") ? "CFD" : "unknown",
        version: 1,
        className: className,
        stepFile: viewConfig.url.split("/").pop() || "geometry.step",
        parameters: config.parameters || {},
      };

      // 1. Fetch step file blob
      const stepRes = await fetch(viewConfig.url);
      const stepBlob = await stepRes.blob();

      // 2. Upload geometry to get hash
      const formData = new FormData();
      formData.append("file", stepBlob, config.stepFile);
      const uploadRes = await fetch("/api/v1/physics/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload geometry");
      const { hash: geometryHash } = await uploadRes.json();

      // 3. Submit physics run
      const runRes = await fetch("/api/v1/physics/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometryHash, config: runConfig }),
      });
      if (!runRes.ok) throw new Error("Failed to submit physics job");
      const { jobId } = await runRes.json();

      setIsConfigOpen(false);
      navigate(`/scripts/${jobId}`);
    } catch (err: any) {
      alert(err.message || "Failed to run simulation");
    } finally {
      setIsSubmitting(false);
    }
  };

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
          const geos: THREE.BufferGeometry[] = [];
          const boundingBox = new THREE.Box3();

          for (const meshData of result.meshes) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.Float32BufferAttribute(meshData.attributes.position.array, 3));
            if (meshData.attributes.normal) {
              geo.setAttribute("normal", new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3));
            } else {
              geo.computeVertexNormals();
            }
            if (meshData.index) {
              geo.setIndex(new THREE.Uint32BufferAttribute(meshData.index.array, 1));
            }
            geo.computeBoundingSphere();
            geo.computeBoundingBox();
            if (geo.boundingBox) {
              boundingBox.union(geo.boundingBox);
            }
            geos.push(geo);
          }

          const center = new THREE.Vector3();
          boundingBox.getCenter(center);

          const sphere = new THREE.Sphere();
          boundingBox.getBoundingSphere(sphere);
          const scale = sphere.radius > 0 ? 20 / sphere.radius : 1;

          setGeometries(geos);
          setAssemblyCenter(center);
          setAssemblyScale(scale);

          setTimeout(() => {
            (window as any).__ARTIFACT_READY = true;
          }, 1500);
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

  if (!geometries) {
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
      position="relative"
    >
      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 50], fov: 50 }}>
        <ambientLight intensity={0.3} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={0.3} castShadow />

        <Suspense fallback={<Loader />}>
          {/* Local HDRI Texture */}
          <Environment files="/hdri/studio.hdr" />
          <group
            scale={[assemblyScale, assemblyScale, assemblyScale]}
            position={
              assemblyCenter
                ? [
                    -assemblyCenter.x * assemblyScale,
                    -assemblyCenter.y * assemblyScale,
                    -assemblyCenter.z * assemblyScale,
                  ]
                : [0, 0, 0]
            }
          >
            {geometries.map((geo, idx) => {
              const meshCenter = geo.boundingSphere?.center || new THREE.Vector3();
              const offset =
                assemblyCenter && explosionFactor > 0
                  ? meshCenter.clone().sub(assemblyCenter).multiplyScalar(explosionFactor)
                  : new THREE.Vector3();

              return (
                <mesh key={idx} geometry={geo} position={offset}>
                  <meshPhysicalMaterial
                    color="#8a929a"
                    metalness={0.15}
                    roughness={0.65}
                    clearcoat={0.0}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              );
            })}
          </group>
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
      <Box
        position="absolute"
        bottom={16}
        left="50%"
        style={{ transform: "translateX(-50%)" }}
        display="flex"
        alignItems="center"
        bg="var(--color-canvas-overlay)"
        p={2}
        borderRadius="8px"
        boxShadow="var(--color-shadow-medium)"
        sx={{ gap: 2 }}
      >
        <Text fontSize="12px" fontWeight="bold">
          Explode
        </Text>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={explosionFactor}
          onChange={(e) => setExplosionFactor(parseFloat(e.target.value))}
          style={{ width: "150px" }}
        />
      </Box>
      <Box position="absolute" bottom={16} right={16}>
        <Button variant="primary" leadingVisual={PlayIcon} onClick={() => setIsConfigOpen(true)}>
          Create Simulation
        </Button>
      </Box>

      {isConfigOpen && (
        <Dialog
          isOpen={isConfigOpen}
          onDismiss={() => setIsConfigOpen(false)}
          title="Create Physics Configuration"
          width="medium"
        >
          <Box p={3} display="flex" flexDirection="column" sx={{ gap: 3 }}>
            <FormControl>
              <FormControl.Label>Study Class Name</FormControl.Label>
              <Box display="flex" sx={{ gap: 2 }}>
                <TextInput
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="e.g. DroneCAD.StaticTest"
                  sx={{ flex: 1 }}
                />
                <Button onClick={loadConfig} disabled={isLoadingConfig}>
                  {isLoadingConfig ? <Spinner size="small" /> : "Load Properties"}
                </Button>
              </Box>
              <FormControl.Caption>Enter the Modelica study class name to load its parameters.</FormControl.Caption>
            </FormControl>

            {Object.keys(config.parameters || {}).length > 0 && (
              <Box
                mt={3}
                p={3}
                bg="var(--color-canvas-subtle)"
                borderRadius="6px"
                sx={{ display: "flex", flexDirection: "column", gap: 3 }}
              >
                <Text fontWeight="bold" display="block">
                  Study Parameters
                </Text>
                {Object.keys(config.parameters).map((key) => (
                  <FormControl key={key}>
                    <FormControl.Label>{key}</FormControl.Label>
                    <TextInput
                      type={typeof config.parameters[key] === "number" ? "number" : "text"}
                      value={config.parameters[key]}
                      onChange={(e) => {
                        const val =
                          typeof config.parameters[key] === "number" ? parseFloat(e.target.value) : e.target.value;
                        updateField(key, val);
                      }}
                      sx={{ width: "100%" }}
                    />
                  </FormControl>
                ))}
              </Box>
            )}
            <Box mt={3} display="flex" justifyContent="flex-end" sx={{ gap: 2 }}>
              <Button onClick={() => setIsConfigOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={runSimulation} disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Run Simulation"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default CadStepViewer;
