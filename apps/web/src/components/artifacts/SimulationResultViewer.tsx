/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SimulationResultViewer
 *
 * Interactive 3D viewer for FEA/CFD simulation results.
 * Renders VTU meshes with scalar field overlays using custom
 * colormap shaders, with field selection, colormap presets,
 * deformation scaling, and a color legend bar.
 */

import { Spinner, Text } from "@primer/react";
import { Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  COLORMAP_FRAGMENT_SHADER,
  COLORMAP_NAMES,
  COLORMAP_VERTEX_SHADER,
  type ColormapPreset,
  createColormapTexture,
  sampleColormapCss,
} from "../../util/colormap";
import { type VtuField, type VtuParseResult, parseVtu } from "../../util/vtu-parser";
import Box from "../Box";
import type { SpatialPin } from "./spatial-pin";

// ── Types ───────────────────────────────────────────────────────

interface SimulationResultViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
  onPinCreated?: (pin: SpatialPin) => void;
}

interface FieldMeta {
  name: string;
  association: "point" | "cell";
  numComponents: number;
  range: [number, number];
  unit?: string;
}

// ── Loader ──────────────────────────────────────────────────────

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

// ── Scalar Mesh ─────────────────────────────────────────────────

const ScalarMesh: React.FC<{
  geometry: THREE.BufferGeometry;
  scalarData: Float32Array;
  scalarMin: number;
  scalarMax: number;
  colormapTexture: THREE.DataTexture;
  displacementData: Float32Array | null;
  displacementScale: number;
  loadFactor: number;
  onPinCreated?: (pin: SpatialPin) => void;
  activeField: string;
}> = ({
  geometry,
  scalarData,
  scalarMin,
  scalarMax,
  colormapTexture,
  displacementData,
  displacementScale,
  loadFactor,
  onPinCreated,
  activeField,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: COLORMAP_VERTEX_SHADER,
      fragmentShader: COLORMAP_FRAGMENT_SHADER,
      uniforms: {
        colormap: { value: colormapTexture },
        scalarMin: { value: scalarMin },
        scalarMax: { value: scalarMax },
        opacity: { value: 1.0 },
        loadFactor: { value: loadFactor / 100.0 },
      },
      side: THREE.DoubleSide,
      transparent: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colormapTexture, scalarMin, scalarMax]);

  // Update the scalar attribute on the geometry
  const displayGeometry = useMemo(() => {
    const geo = geometry.clone();

    // Set scalar attribute
    geo.setAttribute("scalar", new THREE.Float32BufferAttribute(scalarData, 1));

    // Apply displacement if available
    if (displacementData && displacementScale > 0) {
      const positions = geo.getAttribute("position");
      const posArray = (positions as THREE.BufferAttribute).array as Float32Array;
      const newPositions = new Float32Array(posArray.length);

      for (let i = 0; i < posArray.length / 3; i++) {
        if (displacementData.length === posArray.length) {
          // 3D vector displacement
          newPositions[i * 3] = posArray[i * 3] + displacementData[i * 3] * displacementScale;
          newPositions[i * 3 + 1] = posArray[i * 3 + 1] + displacementData[i * 3 + 1] * displacementScale;
          newPositions[i * 3 + 2] = posArray[i * 3 + 2] + displacementData[i * 3 + 2] * displacementScale;
        } else if (displacementData.length > i) {
          // Scalar displacement: apply along the normal (approximated as Z)
          newPositions[i * 3] = posArray[i * 3];
          newPositions[i * 3 + 1] = posArray[i * 3 + 1];
          newPositions[i * 3 + 2] = posArray[i * 3 + 2] + displacementData[i] * displacementScale;
        } else {
          newPositions[i * 3] = posArray[i * 3];
          newPositions[i * 3 + 1] = posArray[i * 3 + 1];
          newPositions[i * 3 + 2] = posArray[i * 3 + 2];
        }
      }
      geo.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
      geo.computeVertexNormals();
    }

    return geo;
  }, [geometry, scalarData, displacementData, displacementScale]);

  // Update uniforms when they change
  useEffect(() => {
    material.uniforms.scalarMin.value = scalarMin;
    material.uniforms.scalarMax.value = scalarMax;
    material.uniforms.colormap.value = colormapTexture;
    material.uniforms.loadFactor.value = loadFactor / 100.0;
    material.needsUpdate = true;
  }, [material, scalarMin, scalarMax, colormapTexture, loadFactor]);

  // Handle double click for spatial pinning
  const handleDoubleClick = (e: any) => {
    e.stopPropagation();

    // Find scalar value at this face (approximate by taking the first vertex of the face)
    let scalarValue = 0;
    if (e.face && e.face.a !== undefined && scalarData) {
      scalarValue = scalarData[e.face.a];
    }

    // Determine camera target (simplified: look directly along the ray from camera to point)
    const cameraTarget = [e.point.x, e.point.y, e.point.z] as [number, number, number];

    const pin: SpatialPin = {
      worldPosition: [e.point.x, e.point.y, e.point.z],
      cameraPosition: [e.camera.position.x, e.camera.position.y, e.camera.position.z],
      cameraTarget,
      fieldName: activeField,
      scalarValue,
    };

    if (onPinCreated) {
      onPinCreated(pin);
    }
  };

  return <mesh ref={meshRef} geometry={displayGeometry} material={material} onDoubleClick={handleDoubleClick} />;
};

// ── Flow Streaks ───────────────────────────────────────────────

const FlowStreaks: React.FC<{
  geometry: THREE.BufferGeometry;
  velocityData: Float32Array;
  association: "point" | "cell";
  vMin: number;
  vMax: number;
  colormapTexture: THREE.DataTexture;
  scale?: number;
  animate?: boolean;
}> = ({ geometry, velocityData, association, vMin, vMax, colormapTexture, scale = 1.0, animate = true }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Compute model scale to size the streaks relative to the model
  const modelScale = useMemo(() => {
    geometry.computeBoundingSphere();
    return geometry.boundingSphere?.radius || 1.0;
  }, [geometry]);

  const { instancedGeo, numInstances } = useMemo(() => {
    const posOriginal = geometry.getAttribute("position").array;
    const indices = geometry.getIndex()?.array;

    const isCellData = association === "cell";
    const count = isCellData ? velocityData.length / 3 : posOriginal.length / 3;

    // Use a small thin cylinder
    const baseCylinder = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 5);
    baseCylinder.rotateX(Math.PI / 2); // Align cylinder along Z axis locally so we can orient it easily if needed, or keep Y axis

    const instancedGeo = new THREE.InstancedBufferGeometry().copy(baseCylinder);

    const randoms = new Float32Array(count);
    const velocityMags = new Float32Array(count);

    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0); // Cylinder default length is along Y axis
    const matrices = new Float32Array(count * 16);

    // Streak thickness relative to the overall model scale
    const thickness = modelScale * 0.003;

    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line react-hooks/purity
      randoms[i] = Math.random();

      let px: number, py: number, pz: number;
      if (isCellData && indices && i * 3 + 2 < indices.length) {
        const a = indices[i * 3];
        const b = indices[i * 3 + 1];
        const c = indices[i * 3 + 2];
        px = (posOriginal[a * 3] + posOriginal[b * 3] + posOriginal[c * 3]) / 3.0;
        py = (posOriginal[a * 3 + 1] + posOriginal[b * 3 + 1] + posOriginal[c * 3 + 1]) / 3.0;
        pz = (posOriginal[a * 3 + 2] + posOriginal[b * 3 + 2] + posOriginal[c * 3 + 2]) / 3.0;
      } else {
        px = posOriginal[i * 3];
        py = posOriginal[i * 3 + 1];
        pz = posOriginal[i * 3 + 2];
      }

      const vx = velocityData[i * 3];
      const vy = velocityData[i * 3 + 1];
      const vz = velocityData[i * 3 + 2];

      const vel = new THREE.Vector3(vx, vy, vz);
      const mag = vel.length();
      velocityMags[i] = mag;

      dummy.position.set(px, py, pz);
      if (mag > 0.0001) {
        // Orient cylinder length (Y axis) along the velocity vector
        dummy.quaternion.setFromUnitVectors(up, vel.clone().normalize());
      }
      // Set the thickness. The length (Y) is 1.0 here, we'll stretch it in the shader based on velocity
      dummy.scale.set(thickness, 1.0, thickness);

      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, i * 16);
    }

    instancedGeo.setAttribute("instanceMatrix", new THREE.InstancedBufferAttribute(matrices, 16));
    instancedGeo.setAttribute("randoms", new THREE.InstancedBufferAttribute(randoms, 1));
    instancedGeo.setAttribute("velocityMag", new THREE.InstancedBufferAttribute(velocityMags, 1));

    return { instancedGeo, numInstances: count };
  }, [geometry, velocityData, association, modelScale]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        maxTime: { value: 2.0 },
        scale: { value: scale }, // global multiplier for streak speed/length
        colormap: { value: colormapTexture },
        vMin: { value: vMin },
        vMax: { value: vMax },
      },
      vertexShader: `
        attribute float randoms;
        attribute float velocityMag;
        
        uniform float time;
        uniform float maxTime;
        uniform float scale;
        uniform float vMin;
        uniform float vMax;
        
        varying float vAlpha;
        varying float vColorT;

        void main() {
          float t = mod(time + randoms * maxTime, maxTime);
          
          vec3 localPos = position;
          
          // Make the streaks much longer relative to the local velocity magnitude
          float streakLen = velocityMag * scale * 25.0; 
          localPos.y *= streakLen; 
          
          // Move the streak forward along its local Y axis (which is aligned with velocity)
          localPos.y += velocityMag * t * scale * 5.0;
          
          // Fade the tail (local Y goes from -0.5 to 0.5 before scaling)
          float tailFade = smoothstep(-0.5, 0.5, position.y);
          float timeFade = 1.0 - (t / maxTime);
          
          vAlpha = timeFade * tailFade;
          
          vColorT = (vMax > vMin) ? clamp((velocityMag - vMin) / (vMax - vMin), 0.0, 1.0) : 0.5;
          
          vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(localPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D colormap;
        varying float vAlpha;
        varying float vColorT;
        void main() {
          vec4 color = texture2D(colormap, vec2(vColorT, 0.5));
          gl_FragColor = vec4(color.rgb, vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [scale, colormapTexture, vMin, vMax]);

  useFrame((state) => {
    if (material.uniforms) {
      // eslint-disable-next-line react-hooks/immutability
      material.uniforms.time.value = state.clock.elapsedTime * 0.5;
    }
  });

  return <instancedMesh ref={meshRef} args={[instancedGeo, material, numInstances]} visible={animate} />;
};

// ── Color Legend ─────────────────────────────────────────────────

const ColorLegend: React.FC<{
  preset: ColormapPreset;
  min: number;
  max: number;
  fieldName: string;
  unit?: string;
}> = ({ preset, min, max, fieldName, unit }) => {
  const steps = 8;
  const formatValue = (v: number) => {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
    if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(1);
    return v.toFixed(2);
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        bottom: 16,
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
        {fieldName}
        {unit && <span style={{ display: "block", fontWeight: 400, fontSize: 8 }}>({unit})</span>}
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
        }}
      >
        {Array.from({ length: steps }).map((_, i) => {
          const t = 1 - i / (steps - 1); // Top = max
          return (
            <div
              key={i}
              style={{
                flex: 1,
                background: sampleColormapCss(preset, t),
              }}
            />
          );
        })}
      </div>
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
        <span style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>{formatValue(max)}</span>
        <span style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>
          {formatValue((max + min) / 2)}
        </span>
        <span style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>{formatValue(min)}</span>
      </div>
    </div>
  );
};

// ── Control Panel ───────────────────────────────────────────────

const controlStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  bottom: 12,
  display: "flex",
  gap: 8,
  alignItems: "center",
  background: "var(--color-canvas-default)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 8,
  padding: "6px 12px",
  zIndex: 5,
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

const sliderLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--color-fg-default)",
  whiteSpace: "nowrap",
};

// ── Camera Controller ───────────────────────────────────────────

const CameraController: React.FC<{ orbitControlsRef: any }> = ({ orbitControlsRef }) => {
  const { camera } = useThree();
  const [targetPin, setTargetPin] = useState<SpatialPin | null>(null);

  useEffect(() => {
    const handleFocus = (e: Event) => {
      const pin = (e as CustomEvent<SpatialPin>).detail;
      if (!pin || !orbitControlsRef.current) return;
      setTargetPin(pin);
    };

    window.addEventListener("focus-spatial-pin", handleFocus);
    return () => window.removeEventListener("focus-spatial-pin", handleFocus);
  }, [orbitControlsRef]);

  useFrame(() => {
    if (targetPin && orbitControlsRef.current) {
      // Lerp camera position
      camera.position.lerp(new THREE.Vector3(...targetPin.cameraPosition), 0.05);
      // Lerp camera target
      orbitControlsRef.current.target.lerp(new THREE.Vector3(...targetPin.cameraTarget), 0.05);
      orbitControlsRef.current.update();

      // Check if arrived (approx)
      if (camera.position.distanceTo(new THREE.Vector3(...targetPin.cameraPosition)) < 0.1) {
        setTargetPin(null);
      }
    }
  });

  return null;
};

// ── Main Component ──────────────────────────────────────────────

const SimulationResultViewer: React.FC<SimulationResultViewerProps> = ({ viewConfig, isFullScreen, onPinCreated }) => {
  const [vtuData, setVtuData] = useState<VtuParseResult | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Visualization state
  const [activeField, setActiveField] = useState<string>("");
  const [colormapPreset, setColormapPreset] = useState<ColormapPreset>("turbo");
  const [loadFactor, setLoadFactor] = useState(100);
  const [animateFlow, setAnimateFlow] = useState(true);
  const orbitControlsRef = useRef<any>(null);

  const isThumbnail = new URLSearchParams(window.location.search).get("thumbnail") === "true";

  // Load and parse the VTU data
  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        let vtuXml: string;

        if (viewConfig.vtuInline) {
          // Inline VTU XML in the view config (for demo/seed data)
          vtuXml = viewConfig.vtuInline;
        } else if (viewConfig.url) {
          const res = await fetch(viewConfig.url);
          if (!res.ok) throw new Error("Failed to fetch VTU file");
          vtuXml = await res.text();
        } else {
          throw new Error("No VTU data source provided");
        }

        const parsed = parseVtu(vtuXml);

        if (!active) return;

        // Build Three.js BufferGeometry
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(parsed.positions, 3));

        if (parsed.normals) {
          geo.setAttribute("normal", new THREE.Float32BufferAttribute(parsed.normals, 3));
        } else {
          geo.computeVertexNormals();
        }

        if (parsed.indices.length > 0) {
          geo.setIndex(new THREE.Uint32BufferAttribute(parsed.indices, 1));
        }

        // Center and scale
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

        setVtuData(parsed);
        setGeometry(geo);

        // Default to first scalar field
        const scalarFields = parsed.fields.filter((f) => f.numComponents === 1 && f.association === "point");
        if (scalarFields.length > 0) {
          setActiveField(scalarFields[0].name);
        }
      } catch (err: any) {
        if (active) setError(err.message || "Failed to parse simulation data");
      } finally {
        if (active) {
          setLoading(false);
          setTimeout(() => {
            (window as any).__ARTIFACT_READY = true;
          }, 1500);
        }
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, [viewConfig.url, viewConfig.vtuInline]);

  // Compute the colormap texture
  const colormapTexture = useMemo(() => createColormapTexture(colormapPreset), [colormapPreset]);

  // Get the active field data
  const currentField: VtuField | undefined = vtuData?.fields.find((f) => f.name === activeField);

  // Get displacement field (if any)
  const displacementField: VtuField | undefined = vtuData?.fields.find(
    (f) => f.name.toLowerCase().includes("displacement") || f.name.toLowerCase().includes("disp"),
  );

  // Get velocity field (if any)
  const velocityField: VtuField | undefined = vtuData?.fields.find(
    (f) => f.name.toLowerCase().includes("velocity") || f.name.toLowerCase().includes("vel"),
  );

  // Available scalar fields for the dropdown
  const scalarFields: FieldMeta[] = useMemo(() => {
    if (!vtuData) return [];
    return vtuData.fields
      .filter((f) => f.numComponents === 1 && f.association === "point")
      .map((f) => ({
        name: f.name,
        association: f.association,
        numComponents: f.numComponents,
        range: f.range,
        unit: viewConfig.fieldUnits?.[f.name],
      }));
  }, [vtuData, viewConfig.fieldUnits]);

  // ── Render states ──

  if (error) {
    return (
      <Box p={3} backgroundColor="var(--color-danger-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">{error}</Text>
      </Box>
    );
  }

  if (loading || !geometry || !vtuData) {
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
        <Text ml={3}>Parsing simulation results...</Text>
      </Box>
    );
  }

  const fieldUnit = viewConfig.fieldUnits?.[activeField];

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
          <span
            style={{
              fontSize: 11,
              color: "var(--color-fg-muted)",
              fontFamily: "monospace",
            }}
          >
            {vtuData.numPoints.toLocaleString()} nodes · {vtuData.numCells.toLocaleString()} cells
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
        </div>
      )}

      {/* Color legend */}
      {currentField && !isThumbnail && (
        <ColorLegend
          preset={colormapPreset}
          min={currentField.range[0]}
          max={currentField.range[1]}
          fieldName={activeField}
          unit={fieldUnit}
        />
      )}

      {/* 3D Canvas */}
      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 50], fov: 50 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 8]} intensity={0.6} />

        <Suspense fallback={<Loader />}>
          {currentField && geometry && (
            <group>
              <ScalarMesh
                geometry={geometry}
                scalarData={currentField.data}
                scalarMin={currentField.range[0]}
                scalarMax={currentField.range[1]}
                colormapTexture={colormapTexture}
                displacementData={displacementField ? displacementField.data : null}
                displacementScale={(loadFactor / 100.0) * 200}
                loadFactor={loadFactor}
                activeField={activeField}
                onPinCreated={onPinCreated}
              />
              {velocityField && (
                <FlowStreaks
                  geometry={geometry}
                  velocityData={velocityField.data}
                  association={velocityField.association}
                  vMin={velocityField.range[0]}
                  vMax={velocityField.range[1]}
                  colormapTexture={colormapTexture}
                  scale={0.02} // Adjust this based on your velocity magnitude vs mesh scale
                  animate={animateFlow}
                />
              )}
            </group>
          )}
          <CameraController orbitControlsRef={orbitControlsRef} />
        </Suspense>
        <OrbitControls ref={orbitControlsRef} makeDefault />
      </Canvas>

      {/* Bottom control bar */}
      {!isThumbnail && (
        <div style={controlStyle}>
          {/* Field selector */}
          {scalarFields.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={sliderLabelStyle}>Field</span>
              <select value={activeField} onChange={(e) => setActiveField(e.target.value)} style={selectStyle}>
                {scalarFields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Animated Flow toggle */}
          {velocityField && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <input
                id="animate-flow-cb"
                type="checkbox"
                checked={animateFlow}
                onChange={(e) => setAnimateFlow(e.target.checked)}
                style={{ accentColor: "#8b5cf6", cursor: "pointer", width: 14, height: 14 }}
              />
              <label htmlFor="animate-flow-cb" style={{ ...sliderLabelStyle, cursor: "pointer", margin: 0 }}>
                Animate Flow
              </label>
            </div>
          )}

          {/* Colormap selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={sliderLabelStyle}>Color</span>
            <select
              value={colormapPreset}
              onChange={(e) => setColormapPreset(e.target.value as ColormapPreset)}
              style={selectStyle}
            >
              {COLORMAP_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Load factor slider */}
          {displacementField && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={sliderLabelStyle}>Load %</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={loadFactor}
                onChange={(e) => setLoadFactor(parseFloat(e.target.value))}
                style={{ width: 60, accentColor: "#8b5cf6" }}
              />
              <span style={{ ...sliderLabelStyle, width: 28, textAlign: "right" }}>{loadFactor}%</span>
            </div>
          )}
        </div>
      )}
    </Box>
  );
};

export default SimulationResultViewer;
