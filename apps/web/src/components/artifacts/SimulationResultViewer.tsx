// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SimulationResultViewer
 *
 * Interactive 3D viewer for FEA/CFD simulation results.
 * Renders VTU meshes with scalar field overlays using custom
 * colormap shaders, with field selection, colormap presets,
 * deformation scaling, and a color legend bar.
 */

import { Spinner, Text } from "@primer/react";
import { Html, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type ColormapPreset, createColormapTexture } from "../../util/colormap";
import { type VtuField, type VtuParseResult, parseVtu } from "../../util/vtu-parser";
import Box from "../Box";
import AutoThumbnailCapture from "./AutoThumbnailCapture";
import SafeOrbitControls from "./SafeOrbitControls";
import {
  CameraController,
  type CameraPreset,
  ColorLegend,
  type FieldMeta,
  FlowStreaks,
  ScalarMesh,
  type SimulationResultViewerProps,
  ViewerControlsBar,
  ViewerHeaderBar,
} from "./simulation-result";
import ViewportCameraControls from "./ViewportCameraControls";

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

export const SimulationResultViewer: React.FC<SimulationResultViewerProps> = ({
  artifactId,
  viewConfig,
  isFullScreen,
  onPinCreated,
  onThreadNodeSelected,
}) => {
  const [vtuData, setVtuData] = useState<VtuParseResult | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Visualization state
  const [activeField, setActiveField] = useState<string>("");
  const [colormapPreset, setColormapPreset] = useState<ColormapPreset>("turbo");
  const [loadFactor, setLoadFactor] = useState(100);
  const [animateFlow, setAnimateFlow] = useState(true);
  const [isWireframe, setIsWireframe] = useState(false);
  const [presetTrigger, setPresetTrigger] = useState<{ preset: CameraPreset; timestamp: number } | null>(null);
  const [probeData, setProbeData] = useState<{ point: [number, number, number]; value: number } | null>(null);
  const orbitControlsRef = useRef<any>(null);

  const isThumbnail = new URLSearchParams(window.location.search).get("thumbnail") === "true";

  // Load and parse the VTU data
  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        let vtuXml: string;

        const targetUrl = viewConfig.url || viewConfig.resultVtuUrl || viewConfig.resultUrl || viewConfig.fileUrl;

        if (viewConfig.vtuInline) {
          // Inline VTU XML in the view config (for demo/seed data)
          vtuXml = viewConfig.vtuInline;
        } else if (targetUrl) {
          const res = await fetch(targetUrl);
          if (!res.ok) throw new Error(`Failed to fetch VTU file (${res.status} ${res.statusText})`);
          vtuXml = await res.text();
        } else {
          throw new Error("No VTU data source provided for simulation results");
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
          setActiveField(scalarFields[0]!.name);
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
  }, [viewConfig.url, viewConfig.resultVtuUrl, viewConfig.resultUrl, viewConfig.fileUrl, viewConfig.vtuInline]);

  // Compute the colormap texture
  const colormapTexture = useMemo(() => createColormapTexture(colormapPreset), [colormapPreset]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      colormapTexture.dispose();
    };
  }, [colormapTexture]);

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
        borderRadius="0"
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
      borderRadius="0"
      overflow="hidden"
      position="relative"
      style={{ background: "transparent" }}
    >
      {/* Header info bar */}
      {!isThumbnail && (
        <ViewerHeaderBar vtuData={vtuData} viewConfig={viewConfig} onThreadNodeSelected={onThreadNodeSelected} />
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

      {/* Viewport Camera & Render Controls */}
      <ViewportCameraControls
        topOffset={!isThumbnail ? "52px" : "12px"}
        onPresetSelect={(preset) => setPresetTrigger({ preset, timestamp: Date.now() })}
        isWireframe={isWireframe}
        onToggleWireframe={setIsWireframe}
      />

      {/* 3D Canvas */}
      <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, 0, 50], fov: 50 }}>
        <AutoThumbnailCapture
          artifactId={artifactId}
          hasThumbnail={Boolean(viewConfig.thumbnailUrl || viewConfig.thumbnail_url)}
        />
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
                isWireframe={isWireframe}
                onProbePoint={setProbeData}
              />
              {probeData && (
                <Html
                  position={probeData.point}
                  style={{ pointerEvents: "none", transform: "translate3d(-50%, -130%, 0)" }}
                >
                  <div
                    style={{
                      background: "rgba(15, 23, 42, 0.92)",
                      backdropFilter: "blur(8px)",
                      color: "#38bdf8",
                      border: "1px solid rgba(56, 189, 248, 0.5)",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono, monospace)",
                      whiteSpace: "nowrap",
                      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.5)",
                    }}
                  >
                    {activeField}: {probeData.value.toFixed(2)} {fieldUnit || ""}
                  </div>
                </Html>
              )}
              {velocityField && (
                <FlowStreaks
                  geometry={geometry}
                  velocityData={velocityField.data}
                  association={velocityField.association}
                  vMin={velocityField.range[0]}
                  vMax={velocityField.range[1]}
                  colormapTexture={colormapTexture}
                  scale={0.02}
                  animate={animateFlow}
                  downsampleFactor={isThumbnail ? 100 : 1}
                />
              )}
            </group>
          )}
          <CameraController orbitControlsRef={orbitControlsRef} presetTrigger={presetTrigger} />
        </Suspense>
        <SafeOrbitControls controlsRef={orbitControlsRef} isFullScreen={isFullScreen} />
      </Canvas>

      {/* Bottom control bar */}
      {!isThumbnail && (
        <ViewerControlsBar
          scalarFields={scalarFields}
          activeField={activeField}
          setActiveField={setActiveField}
          velocityField={velocityField}
          animateFlow={animateFlow}
          setAnimateFlow={setAnimateFlow}
          colormapPreset={colormapPreset}
          setColormapPreset={setColormapPreset}
          displacementField={displacementField}
          loadFactor={loadFactor}
          setLoadFactor={setLoadFactor}
        />
      )}
    </Box>
  );
};

export default SimulationResultViewer;
